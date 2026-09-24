import { getRedisClient } from '../config/redis';
import { EventBus } from '../realtime/event.bus';
import { env } from '../config/env';
import pool from '../config/database';
import logger from '../utils/logger';

/**
 * DriverLocationService
 *
 * Domain layer for driver location streaming. Called by the socket
 * handler (`driver-location.handlers.ts`) after validation and rate
 * limiting. Called by W8's ETA service to read the cached position.
 *
 * Responsibilities:
 *   - Write the latest location to Redis (`driver:loc:{driverId}`) with
 *     a short TTL. The TTL is the safety net: if the driver's socket
 *     dies, the cached position expires and reads return null.
 *   - Find the driver's currently-active ride, if any.
 *   - If a ride is active, forward the location to that ride's room via
 *     `EventBus.emitToRide(rideId, 'driver:location', payload)`.
 *
 * Non-responsibilities:
 *   - No socket access. No `Socket`, no `Server`, no direct `io.to`.
 *   - No validation of incoming updates. The handler does that.
 *   - No persistence to Postgres. Historical GPS tracks are out of
 *     scope for Phase 6.
 *   - No rate limiting. The handler does that.
 *
 * The `processLocationUpdate` method is deliberately fire-and-forget
 * from the caller's perspective: it does not throw if Redis is down, if
 * the driver has no active ride, or if the EventBus is not attached.
 * Failures are logged at warn/error level but never bubble up — a
 * dropped location update must not disconnect the driver.
 */

// ============================================
// TYPES
// ============================================

/**
 * Shape of the value stored in Redis at `driver:loc:{driverId}`.
 *
 * This is also the shape W8's ETA service will read. Keep it stable.
 * Adding fields is backward compatible; removing or renaming is not.
 */
export interface ICachedDriverLocation {
  driverId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedKmh: number | null;
  /** ISO timestamp the client reported for the sample. */
  recordedAt: string;
  /** ISO timestamp the server accepted and cached it. */
  cachedAt: string;
}

/**
 * Input to `processLocationUpdate`. Already validated by the handler.
 * Every field is guaranteed to be in range.
 */
export interface IProcessLocationUpdateInput {
  driverUserId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedKmh: number | null;
  /** ISO timestamp. Already freshness-checked by the handler. */
  recordedAt: string;
}

/**
 * Row returned from the active-ride lookup. Only the fields we need.
 */
interface IActiveRide {
  id: string;
}

// ============================================
// REDIS KEY HELPERS
// ============================================

/**
 * Cache key for a driver's last-known location. Uses the driver's
 * `users.id` (not `driver_profiles.id`) because that is the identifier
 * we have at the socket layer.
 */
function redisKeyFor(driverUserId: string): string {
  return `driver:loc:${driverUserId}`;
}

// ============================================
// SERVICE
// ============================================

export class DriverLocationService {
  /**
   * Process a validated location update.
   *
   *   1. Write to Redis with TTL `env.cacheDriverLocationTtl` seconds.
   *   2. Look up the driver's active ride.
   *   3. If a ride is active, emit `driver:location` to that ride's room.
   *
   * Every step is wrapped so that a failure in one does not prevent
   * the others. A Redis outage should still allow the passenger to see
   * the location, and vice versa.
   */
  static async processLocationUpdate(
    input: IProcessLocationUpdateInput
  ): Promise<void> {
    const cached: ICachedDriverLocation = {
      driverId: input.driverUserId,
      lat: input.lat,
      lng: input.lng,
      heading: input.heading,
      speedKmh: input.speedKmh,
      recordedAt: input.recordedAt,
      cachedAt: new Date().toISOString(),
    };

    // ─────────────────────────────────────────────
    // STEP 1 — Redis write
    // ─────────────────────────────────────────────
    await this.writeCache(input.driverUserId, cached);

    // ─────────────────────────────────────────────
    // STEP 2 — Active ride lookup
    // ─────────────────────────────────────────────
    const activeRide = await this.findActiveRide(input.driverUserId);

    if (!activeRide) {
      // Driver is online but not on a ride. Nothing to forward. The
      // cached location is the only useful output of this update.
      logger.debug(
        `Driver ${input.driverUserId} location cached; no active ride to forward to`
      );
      return;
    }

    // ─────────────────────────────────────────────
    // STEP 3 — Forward to the ride room
    // ─────────────────────────────────────────────
    try {
      EventBus.emitToRide(activeRide.id, 'driver:location', {
        rideId: activeRide.id,
        driverId: input.driverUserId,
        lat: input.lat,
        lng: input.lng,
        heading: input.heading,
        speedKmh: input.speedKmh,
        recordedAt: input.recordedAt,
      });

      logger.debug(
        `Driver ${input.driverUserId} location forwarded to ride ${activeRide.id}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(
        `Failed to forward driver ${input.driverUserId} location to ride ${activeRide.id}: ${msg}`
      );
      // Swallow — the cache write already succeeded, so the passenger's
      // next read (or the next update) will recover.
    }
  }

  /**
   * Read a driver's last-cached location. Returns null if the cache
   * entry has expired or Redis is unavailable.
   *
   * Used by W8's ETA service.
   */
  static async getCachedLocation(
    driverUserId: string
  ): Promise<ICachedDriverLocation | null> {
    try {
      const redis = getRedisClient();
      if (!redis || !redis.isOpen) {
        logger.warn(
          `getCachedLocation: Redis unavailable, returning null for driver ${driverUserId}`
        );
        return null;
      }

      const raw = await redis.get(redisKeyFor(driverUserId));
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as ICachedDriverLocation;

      // Defensive: verify the shape we expect.
      if (
        typeof parsed?.lat !== 'number' ||
        typeof parsed?.lng !== 'number' ||
        typeof parsed?.cachedAt !== 'string'
      ) {
        logger.warn(
          `getCachedLocation: malformed cache entry for driver ${driverUserId}`
        );
        return null;
      }

      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(
        `getCachedLocation failed for driver ${driverUserId}: ${msg}`
      );
      return null;
    }
  }

  /**
   * Look up the driver's currently-active ride. A ride is "active" if
   * its status is one of: confirmed, driver_en_route, driver_arrived,
   * ride_started, ride_in_progress.
   *
   * Returns null if the driver has no active ride.
   *
   * Note: driver_profiles.id is not users.id. The ride table stores
   * driver_profiles.id in `driver_id`. We translate from the socket
   * layer's users.id to driver_profiles.id via a JOIN.
   */
  static async findActiveRide(
    driverUserId: string
  ): Promise<IActiveRide | null> {
    try {
      const result = await pool.query<IActiveRide>(
        `SELECT r.id
           FROM rides r
           JOIN driver_profiles d ON d.id = r.driver_id
          WHERE d.user_id = $1
            AND r.status IN (
              'confirmed',
              'driver_en_route',
              'driver_arrived',
              'ride_started',
              'ride_in_progress'
            )
          ORDER BY r.created_at DESC
          LIMIT 1`,
        [driverUserId]
      );
      return result.rows[0] ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(
        `findActiveRide failed for driver ${driverUserId}: ${msg}`
      );
      return null;
    }
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Write the cached location with TTL. Never throws.
   */
  private static async writeCache(
    driverUserId: string,
    value: ICachedDriverLocation
  ): Promise<void> {
    try {
      const redis = getRedisClient();
      if (!redis || !redis.isOpen) {
        logger.warn(
          `writeCache: Redis unavailable, location not cached for driver ${driverUserId}`
        );
        return;
      }

      const ttl = env.cacheDriverLocationTtl;
      await redis.setEx(redisKeyFor(driverUserId), ttl, JSON.stringify(value));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(
        `writeCache failed for driver ${driverUserId}: ${msg}`
      );
      // Swallow — the forward to the ride room still proceeds.
    }
  }
}

export default DriverLocationService;