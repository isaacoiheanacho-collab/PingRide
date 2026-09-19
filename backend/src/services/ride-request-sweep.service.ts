import pool from '../config/database';
import logger from '../utils/logger';

export interface ISweepResult {
  expiredRequests: number;
  expiredBids: number;
  olderThanMinutes: number;
}

export class RideRequestSweepService {
  /**
   * Sweep stale ride_requests and their orphaned pending bids.
   *
   * What this does, in a single transaction:
   *   1. Expire every ride_request in 'bidding' status whose bidding window
   *      has closed AND whose creation is older than `olderThanMinutes`.
   *      The age filter prevents sweeping requests that just went stale
   *      seconds ago — a grace period.
   *   2. Cascade: expire every 'pending' bid whose parent ride_request is
   *      now 'expired'. This clears the driver's "waiting for decision"
   *      prompt for requests that will never be acted on.
   *
   * Called by:
   *   - Admin endpoint POST /api/v1/admin/ride-requests/sweep
   *   - (Future) Any scheduled job the operator chooses to wire up
   *
   * Idempotent: running it twice with no intervening state change expires
   * nothing the second time.
   */
  static async sweep(olderThanMinutes: number = 5): Promise<ISweepResult> {
    // Guard rail — reject nonsense inputs from the caller
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes < 0) {
      throw new Error('olderThanMinutes must be a non-negative number');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ────────────────────────────────────────────
      // 1. Expire stale ride_requests
      // ────────────────────────────────────────────
      const expiredRequestsResult = await client.query(
        `UPDATE ride_requests
         SET status = 'expired',
             updated_at = NOW() AT TIME ZONE 'UTC'
         WHERE status = 'bidding'
           AND bidding_ends_at IS NOT NULL
           AND bidding_ends_at < NOW() AT TIME ZONE 'UTC'
           AND created_at < NOW() AT TIME ZONE 'UTC' - ($1 || ' minutes')::INTERVAL
         RETURNING id`,
        [olderThanMinutes]
      );

      const expiredRequestIds = expiredRequestsResult.rows.map((r) => r.id);
      const expiredRequests = expiredRequestIds.length;

      // ────────────────────────────────────────────
      // 2. Cascade to bids whose request is now expired
      // ────────────────────────────────────────────
      // We scope this to the ids we just expired. This is stricter than
      // "any bid whose ride_request is expired" because it avoids touching
      // bids from earlier sweeps (they were already handled) or bids tied
      // to requests expired through other paths (e.g. cancellation).
      let expiredBids = 0;
      if (expiredRequestIds.length > 0) {
        const expiredBidsResult = await client.query(
          `UPDATE ride_bids
           SET status = 'expired',
               updated_at = NOW() AT TIME ZONE 'UTC'
           WHERE status = 'pending'
             AND ride_id = ANY($1::uuid[])
           RETURNING id`,
          [expiredRequestIds]
        );
        expiredBids = expiredBidsResult.rows.length;
      }

      await client.query('COMMIT');

      if (expiredRequests > 0 || expiredBids > 0) {
        logger.info(
          `Ride request sweep: ${expiredRequests} request(s) expired, ` +
          `${expiredBids} bid(s) cascaded (olderThanMinutes=${olderThanMinutes})`
        );
      } else {
        logger.debug(
          `Ride request sweep: nothing to clean up (olderThanMinutes=${olderThanMinutes})`
        );
      }

      return {
        expiredRequests,
        expiredBids,
        olderThanMinutes,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Ride request sweep failed: ${msg}`);
      throw error;
    } finally {
      client.release();
    }
  }
}

export default RideRequestSweepService;