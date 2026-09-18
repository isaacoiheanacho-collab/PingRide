import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { DriverIdentityService } from '../services/driver-identity.service';
import { ConsentService } from '../services/consent.service';
import logger from '../utils/logger';

export class OnboardingIdentityController {
  /**
   * POST /api/v1/onboarding/driver/identity
   * Submit driver identity documents for admin review.
   */
  async submitIdentity(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      // NDPA: require KYC data-sharing consent before accepting submission
      await ConsentService.assertConsent(userId, 'kyc_data_sharing');

      const result = await DriverIdentityService.submitIdentity(userId, req.body);

      logger.info(`Phase 2C identity submitted by user ${userId}`);

      return ApiResponseHandler.success(res, result, {
        message: 'Identity documents submitted. Awaiting admin review.',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('Identity submission failed:', { userId, error: errorMessage });
      return ApiResponseHandler.error(
        res,
        'ONBOARDING_IDENTITY_SUBMIT_ERROR',
        errorMessage,
        400
      );
    }
  }

  /**
   * GET /api/v1/onboarding/driver/identity/status
   * Fetch current identity submission + verification state.
   */
  async getStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const status = await DriverIdentityService.getIdentityStatus(userId);
      return ApiResponseHandler.success(res, status);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch identity status';
      logger.error('Identity status fetch failed:', { userId, error: errorMessage });
      return ApiResponseHandler.error(
        res,
        'ONBOARDING_IDENTITY_STATUS_ERROR',
        errorMessage,
        400
      );
    }
  }
}

export default OnboardingIdentityController;