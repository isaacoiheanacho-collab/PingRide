import logger from '../utils/logger';

/**
 * Per-driver rate limiter for `driver:location_update`.
 *
 * Purpose: prevent a misbehaving or buggy client from flooding the
 * server with location updates. The mobile app should send at most one
 * update every 3 seconds. Anything faster is dropped.
 *
 * Scope: in-memory, per-process. Phase 6 runs single-process, so this
 * is sufficient. When Phase 9+ introduces the Redis adapter for
 * horizontal scaling, this must move to a Redis-backed token bucket.
 *
 * Policy:
 *   - MIN_INTERVAL_MS (3s) between accepted updates for the same driver.
 *   - A single early update is dropped silently. No penalty.
 *   - If a driver sends 5 consecutive early updates within
 *     ABUSE_WINDOW_MS, the caller is instructed to disconnect them.
 *     This catches buggy clients that ignore the throttle and keep
 *     hammering the socket.
 *   - The consecutive-drop counter resets whenever a valid update is
 *     accepted, or after ABUSE_WINDOW_MS has passed since the first
 *     early drop.
 */

const MIN_INTERVAL_MS = 3_000;
const ABUSE_WINDOW_MS = 30_000;
const MAX_CONSECUTIVE_DROPS = 5;

interface IThrottleEntry {
  /** Timestamp (ms) of the last ACCEPTED update for this driver. */
  lastAcceptedAt: number;
  /** Count of consecutive drops since the last accepted update. */
  consecutiveDrops: number;
  /** Timestamp (ms) of the first drop in the current run. */
  firstDropAt: number;
}

export interface IRateCheckResult {
  allowed: boolean;
  /** Human-readable reason, for logging. Only set when allowed = false. */
  reason?: string;
  /** If set, the caller must call socket.disconnect(true). */
  action?: 'disconnect';
}

class LocationRateLimiter {
  private entries: Map<string, IThrottleEntry> = new Map();

  /**
   * Check whether an incoming location update from the given driver
   * should be processed. Updates the internal state.
   *
   * Returns:
   *   { allowed: true }                    — process this update
   *   { allowed: false, reason }           — drop this update
   *   { allowed: false, reason, action: 'disconnect' }
   *                                        — drop this update AND
   *                                          disconnect the driver
   */
  check(driverUserId: string): IRateCheckResult {
    const now = Date.now();
    const entry = this.entries.get(driverUserId);

    // First update we've ever seen from this driver — always accept.
    if (!entry) {
      this.entries.set(driverUserId, {
        lastAcceptedAt: now,
        consecutiveDrops: 0,
        firstDropAt: 0,
      });
      return { allowed: true };
    }

    const sinceLastAccepted = now - entry.lastAcceptedAt;

    // Fast path: enough time has passed. Accept and reset the drop
    // counters.
    if (sinceLastAccepted >= MIN_INTERVAL_MS) {
      entry.lastAcceptedAt = now;
      entry.consecutiveDrops = 0;
      entry.firstDropAt = 0;
      return { allowed: true };
    }

    // Too soon. Increment the drop counter.
    //
    // If the previous run of drops is stale (older than ABUSE_WINDOW_MS),
    // treat this as a fresh run — the driver has been quiet for a while
    // and is not being abusive.
    if (
      entry.firstDropAt === 0 ||
      now - entry.firstDropAt > ABUSE_WINDOW_MS
    ) {
      entry.firstDropAt = now;
      entry.consecutiveDrops = 1;
    } else {
      entry.consecutiveDrops += 1;
    }

    const msUntilAllowed = MIN_INTERVAL_MS - sinceLastAccepted;

    // Abuse threshold reached — instruct the caller to disconnect.
    if (entry.consecutiveDrops >= MAX_CONSECUTIVE_DROPS) {
      logger.warn(
        `LocationRateLimiter: driver ${driverUserId} exceeded ${MAX_CONSECUTIVE_DROPS} consecutive drops in ${ABUSE_WINDOW_MS / 1000}s — disconnect advised`
      );
      return {
        allowed: false,
        reason: `${MAX_CONSECUTIVE_DROPS} consecutive rate-limited updates`,
        action: 'disconnect',
      };
    }

    // Single drop — normal for jittery mobile networks. Quietly reject.
    return {
      allowed: false,
      reason: `only ${sinceLastAccepted}ms since last accepted (min ${MIN_INTERVAL_MS}ms, ${msUntilAllowed}ms remaining)`,
    };
  }

  /**
   * Forget a driver's state. Called when a driver disconnects, so the
   * in-memory map does not grow unboundedly on long-running servers.
   */
  forget(driverUserId: string): void {
    this.entries.delete(driverUserId);
  }

  /**
   * Diagnostic only. Returns the current size of the map. Used by the
   * health endpoint if you want to expose it later.
   */
  size(): number {
    return this.entries.size;
  }
}

/**
 * Singleton. Every socket shares one limiter — the limit is per driver,
 * not per socket, so a driver on two devices still gets one budget.
 */
export const locationRateLimiter = new LocationRateLimiter();

export default locationRateLimiter;