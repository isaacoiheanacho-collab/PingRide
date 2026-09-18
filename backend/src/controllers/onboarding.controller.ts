import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { OnboardingService } from '../services/onboarding.service';
import logger from '../utils/logger';

export class OnboardingController {
  /**
   * GET /api/v1/onboarding/status
   *
   * Returns the current user's onboarding state.
   * Available to any authenticated user (passenger, driver, admin).
   * The response shape depends on the user's role.
   */
  async getStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const status = await OnboardingService.getStatus(userId);
      return ApiResponseHandler.success(res, status);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch onboarding status';
      logger.error('Failed to get onboarding status:', error);
      return ApiResponseHandler.error(
        res,
        'ONBOARDING_STATUS_ERROR',
        errorMessage,
        400
      );
    }
  }

  /**
   * POST /api/v1/onboarding/passenger/kyc
   *
   * Phase 2A — collect BVN + bank details, resolve via Paystack,
   * issue DVA (Wema Bank), and link it to the passenger profile.
   *
   * Body:
   *   - email                (string, valid email)
   *   - bvn                  (11 digits)
   *   - bank_account_number  (10 digits)
   *   - bank_code            (string, from dropdown)
   *   - bank_name            (string, from dropdown)
   */
  async completePassengerKYC(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const result = await OnboardingService.completePassengerKYC(userId, req.body);

      logger.info(
        `Phase 2A DVA provisioned for user ${userId}: ${result.virtual_account.account_number}`
      );

      return ApiResponseHandler.success(res, result, {
        message: 'Virtual account provisioned successfully',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('Phase 2A (passenger KYC) failed:', {
        userId,
        error: errorMessage,
      });

      return ApiResponseHandler.error(
        res,
        'ONBOARDING_PASSENGER_KYC_ERROR',
        errorMessage,
        400
      );
    }
  }

  /**
   * POST /api/v1/onboarding/driver/bank
   *
   * Phase 2B — collect settlement bank details, resolve account name
   * via Paystack, and create a Paystack subaccount for payouts.
   *
   * Body:
   *   - email                       (string, valid email)
   *   - settlement_bank_name        (string)
   *   - settlement_bank_code        (string)
   *   - settlement_account_number   (10-digit string)
   */
  async completeDriverBank(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const result = await OnboardingService.completeDriverBank(userId, req.body);

      logger.info(
        `Phase 2B subaccount created for user ${userId}: ${result.subaccount_code}`
      );

      return ApiResponseHandler.success(res, result, {
        message: 'Settlement subaccount created successfully',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('Phase 2B (driver bank) failed:', {
        userId,
        error: errorMessage,
      });

      return ApiResponseHandler.error(
        res,
        'ONBOARDING_DRIVER_BANK_ERROR',
        errorMessage,
        400
      );
    }
  }
}

export default OnboardingController;