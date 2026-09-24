import { Server as SocketIOServer, Socket } from 'socket.io';
import { SocketUser } from './auth.handshake';
import { DriverLocationService } from '../services/driver-location.service';
import { locationRateLimiter } from './location-rate-limiter';
import logger from '../utils/logger';

/**
 * Driver location streaming — socket handler.
 *
 * Wires the client→server event `driver:location_update` onto each
 * connected driver socket. The handler validates, rate-limits, caches,
 * and forwards location updates to the passenger's ride room.
 *
 * Registered by `connection.manager.ts` on every new connection. Never
 * touches the EventBus directly — that is `DriverLocationService`'s job.
 *
 * ────────────────────────────────────────────────────────────────────
 * Validation rules (all backend-enforced, none trusted from the client):
 *
 *   1. Rate limit     — minimum 3s between accepted updates per driver.
 *                       A single premature update is dropped silently.
 *                       5 consecutive drops within 30s → disconnect.
 *
 *   2. Field shape    — lat ∈ [-90, 90], lng ∈ [-180, 180],
 *                       heading ∈ [0, 360], speedKmh ∈ [0, 200].
 *
 *   3. Bounding box   — Nigeria-only. Rejects pings outside Nigeria,
 *                       and rejects pings inside Lagos State (the
 *                       platform does not operate in Lagos).
 *
 *   4. Freshness      — recordedAt must be within the last 15 seconds.
 *                       Older pings are dropped (network retry, bug).
 *
 * ────────────────────────────────────────────────────────────────────
 * On a valid update:
 *
 *   1. Hand off to DriverLocationService.processLocationUpdate()
 *   2. Service writes Redis (TTL env.cacheDriverLocationTtl)
 *   3. Service looks up the driver's active ride
 *   4. If active, service emits `driver:location` to that ride's room
 *
 * ────────────────────────────────────────────────────────────────────
 * What this handler does NOT do:
 *
 *   - No Postgres writes. Redis is the live cache.
 *   - No ETA computation. That's W8.
 *   - No business gates (KYC, suspension). Enforced at go-online time.
 */

// ============================================
// BOUNDING BOXES
// ============================================

/**
 * Nigeria envelope. Anything outside this is definitively not a
 * Nigerian driver — malformed payload, spoofed coordinates, or a
 * lat/lng swap. Small margin beyond Nigeria's actual extent is
 * deliberate.
 */
const NIGERIA_BBOX = {
  latMin: 4.0,
  latMax: 14.0,
  lngMin: 2.5,
  lngMax: 15.0,
};

/**
 * Lagos State envelope. The platform does not operate in Lagos.
 * Coordinates inside this box are rejected with an explicit error log
 * so operations can see the exclusion being enforced in real time.
 */
const LAGOS_BBOX = {
  latMin: 6.30,
  latMax: 6.75,
  lngMin: 3.10,
  lngMax: 3.65,
};

/**
 * Maximum age (ms) of a `recordedAt` timestamp before the update is
 * dropped. 15 seconds is generous for mobile-network jitter but
 * catches stale retries and stuck clients.
 */
const MAX_RECORDED_AT_AGE_MS = 15_000;

/**
 * How far in the future a `recordedAt` can be before it's rejected.
 * Client clocks drift; 60 seconds of drift is tolerated, more is not.
 */
const MAX_CLOCK_SKEW_MS = 60_000;

// ============================================
// PAYLOAD SHAPE (client → server)
// ============================================

interface IDriverLocationUpdate {
  lat?: number;
  lng?: number;
  heading?: number | null;
  speedKmh?: number | null;
  /** ISO 8601 timestamp from the client. Optional; server time is used if missing. */
  recordedAt?: string;
}

// ============================================
// HANDLER REGISTRATION
// ============================================

/**
 * Register all driver-location socket handlers on a freshly-connected
 * socket. Called from `connection.manager.ts`.
 *
 * Attaches listeners only. All emits go through DriverLocationService,
 * which forwards via `EventBus.emitToRide`.
 */
export function registerDriverLocationHandlers(
  _io: SocketIOServer,
  socket: Socket
): void {
  const user = (socket as any).user as SocketUser | undefined;

  if (!user) {
    // Auth middleware guarantees a user. If we get here, something is
    // wrong at the connection layer — log and skip registration.
    logger.error(
      `registerDriverLocationHandlers: socket ${socket.id} has no user attached`
    );
    return;
  }

  // Only drivers receive location-update handlers. Passengers and admins
  // cannot emit this event.
  if (user.role !== 'driver') {
    return;
  }

  socket.on(
    'driver:location_update',
    async (raw: IDriverLocationUpdate) => {
      try {
        await handleLocationUpdate(socket, user, raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logger.error(
          `driver:location_update handler error for socket ${socket.id} (driver ${user.id}): ${msg}`
        );
        // Swallow — a single bad update must not disconnect a driver
        // mid-ride.
      }
    }
  );

  // When the socket disconnects, forget the driver's rate-limit state
  // so the in-memory map does not grow unboundedly on a long-running
  // server.
  socket.on('disconnect', () => {
    try {
      locationRateLimiter.forget(user.id);
    } catch {
      // ignore — cleanup is best-effort
    }
  });
}

// ============================================
// HANDLER IMPLEMENTATION
// ============================================

async function handleLocationUpdate(
  socket: Socket,
  user: SocketUser,
  raw: IDriverLocationUpdate
): Promise<void> {
  const driverUserId = user.id;

  // ─────────────────────────────────────────────
  // STEP 1 — Rate limit
  // ─────────────────────────────────────────────

  const rateCheck = locationRateLimiter.check(driverUserId);
  if (!rateCheck.allowed) {
    if (rateCheck.action === 'disconnect') {
      logger.warn(
        `Disconnecting driver ${driverUserId} (socket ${socket.id}): ${rateCheck.reason}`
      );
      socket.disconnect(true);
      return;
    }

    logger.debug(
      `Dropped driver:location_update from ${driverUserId} — rate-limited (${rateCheck.reason})`
    );
    return;
  }

  // ─────────────────────────────────────────────
  // STEP 2 — Field shape validation
  // ─────────────────────────────────────────────

  if (
    typeof raw?.lat !== 'number' ||
    typeof raw?.lng !== 'number' ||
    !Number.isFinite(raw.lat) ||
    !Number.isFinite(raw.lng)
  ) {
    logger.warn(
      `Rejected driver:location_update from ${driverUserId}: missing or non-numeric lat/lng`
    );
    return;
  }

  const lat = raw.lat;
  const lng = raw.lng;

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    logger.warn(
      `Rejected driver:location_update from ${driverUserId}: coordinates out of range (lat=${lat}, lng=${lng})`
    );
    return;
  }

  let heading: number | null = null;
  if (raw.heading !== undefined && raw.heading !== null) {
    if (
      typeof raw.heading !== 'number' ||
      !Number.isFinite(raw.heading) ||
      raw.heading < 0 ||
      raw.heading > 360
    ) {
      logger.warn(
        `Rejected driver:location_update from ${driverUserId}: invalid heading (${raw.heading})`
      );
      return;
    }
    heading = raw.heading;
  }

  let speedKmh: number | null = null;
  if (raw.speedKmh !== undefined && raw.speedKmh !== null) {
    if (
      typeof raw.speedKmh !== 'number' ||
      !Number.isFinite(raw.speedKmh) ||
      raw.speedKmh < 0
    ) {
      logger.warn(
        `Rejected driver:location_update from ${driverUserId}: invalid speedKmh (${raw.speedKmh})`
      );
      return;
    }
    if (raw.speedKmh > 200) {
      logger.warn(
        `Rejected driver:location_update from ${driverUserId}: implausible speedKmh (${raw.speedKmh})`
      );
      return;
    }
    speedKmh = raw.speedKmh;
  }

  // ─────────────────────────────────────────────
  // STEP 3 — Bounding box (Nigeria envelope + Lagos exclusion)
  // ─────────────────────────────────────────────

  if (!isInsideNigeria(lat, lng)) {
    logger.warn(
      `Rejected driver:location_update from ${driverUserId}: outside Nigeria (lat=${lat}, lng=${lng})`
    );
    return;
  }

  if (isInsideLagos(lat, lng)) {
    // Business rule: the platform does not operate in Lagos. Log at
    // error level so operations can see the exclusion being hit and
    // count it. The update is dropped, not forwarded.
    logger.error(
      `Rejected driver:location_update from ${driverUserId}: inside Lagos State (excluded market) (lat=${lat}, lng=${lng})`
    );
    return;
  }

  // ─────────────────────────────────────────────
  // STEP 4 — Freshness
  // ─────────────────────────────────────────────

  const now = Date.now();
  let recordedAtMs = now;

  if (raw.recordedAt) {
    const parsed = Date.parse(raw.recordedAt);
    if (!Number.isFinite(parsed)) {
      logger.warn(
        `Rejected driver:location_update from ${driverUserId}: invalid recordedAt (${raw.recordedAt})`
      );
      return;
    }
    recordedAtMs = parsed;
  }

  const ageMs = now - recordedAtMs;

  if (ageMs > MAX_RECORDED_AT_AGE_MS) {
    logger.warn(
      `Rejected driver:location_update from ${driverUserId}: stale (age ${Math.round(ageMs / 1000)}s)`
    );
    return;
  }

  if (ageMs < -MAX_CLOCK_SKEW_MS) {
    logger.warn(
      `Rejected driver:location_update from ${driverUserId}: recordedAt is too far in the future (age ${Math.round(ageMs / 1000)}s)`
    );
    return;
  }

  // ─────────────────────────────────────────────
  // STEP 5 — Hand off to the service layer
  // ─────────────────────────────────────────────

  await DriverLocationService.processLocationUpdate({
    driverUserId,
    lat,
    lng,
    heading,
    speedKmh,
    recordedAt: new Date(recordedAtMs).toISOString(),
  });
}

// ============================================
// BOUNDING BOX HELPERS
// ============================================

function isInsideNigeria(lat: number, lng: number): boolean {
  return (
    lat >= NIGERIA_BBOX.latMin &&
    lat <= NIGERIA_BBOX.latMax &&
    lng >= NIGERIA_BBOX.lngMin &&
    lng <= NIGERIA_BBOX.lngMax
  );
}

function isInsideLagos(lat: number, lng: number): boolean {
  return (
    lat >= LAGOS_BBOX.latMin &&
    lat <= LAGOS_BBOX.latMax &&
    lng >= LAGOS_BBOX.lngMin &&
    lng <= LAGOS_BBOX.lngMax
  );
}