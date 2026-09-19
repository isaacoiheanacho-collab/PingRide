import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import RideRequestSweepService from '../services/ride-request-sweep.service';
import logger from '../utils/logger';

export class AdminRideRequestController {
  /**
   * POST /api/v1/admin/ride-requests/sweep
   *
   * Admin-triggered cleanup of stale ride requests and their orphaned bids.
   *
   * Body (all optional):
   *   - olderThanMinutes  (number, default 5, min 0)
   *     Only expire requests whose `created_at` is older than this many
   *     minutes AND whose bidding window has already closed. The age gate
   *     is a grace period so we never sweep a request the passenger is
   *     actively deciding on.
   *
   * Returns:
   *   { expiredRequests, expiredBids, olderThanMinutes }
   */
  async sweep(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { olderThanMinutes } = req.body as { olderThanMinutes?: number };

    try {
      const result = await RideRequestSweepService.sweep(olderThanMinutes);

      logger.info(
        `Admin ${adminId} ran ride request sweep: ${result.expiredRequests} request(s), ` +
        `${result.expiredBids} bid(s) expired (olderThanMinutes=${result.olderThanMinutes})`
      );

      return ApiResponseHandler.success(res, result, {
        message: `Sweep complete: ${result.expiredRequests} request(s) and ${result.expiredBids} bid(s) expired`,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Ride request sweep failed:', { adminId, error: msg });
      return ApiResponseHandler.error(
        res,
        'ADMIN_RIDE_REQUEST_SWEEP_ERROR',
        msg,
        400
      );
    }
  }
}

export default AdminRideRequestController;