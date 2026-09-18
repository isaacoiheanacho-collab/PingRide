import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { ConsentService } from '../services/consent.service';
import logger from '../utils/logger';

/**
 * Onboarding Consent Controller (NDPA 2023)
 *
 * Thin HTTP layer over ConsentService. Records and reports the
 * authenticated user's consent state for the four supported
 * consent types:
 *   - terms_of_service
 *   - privacy_policy
 *   - kyc_data_sharing
 *   - liveness_capture
 *
 * The Phase 2C / 2D submission endpoints require `kyc_data_sharing`
 * consent to have been granted first — see
 * OnboardingIdentityController.submitIdentity and
 * OnboardingVehicleController.submitVehicle.
 */
export class OnboardingConsentController {
  /**
   * POST /api/v1/onboarding/consent
   *
   * Record a consent event (grant) for the authenticated user.
   * Append-only — repeated calls write additional rows; the most
   * recent row wins for `hasConsent()`.
   *
   * Body (validated by `validationSchemas.recordConsent`):
   *   - consent_type     ('terms_of_service' | 'privacy_policy'
   *                       | 'kyc_data_sharing' | 'liveness_capture')
   *   - consent_version  (string, 1-20 chars)
   *
   * Auth: any authenticated user.
   */
  async recordConsent(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { consent_type, consent_version } = req.body as {
      consent_type: string;
      consent_version: string;
    };

    // Best-effort capture of request provenance for NDPA audit trail.
    // `req.ip` is populated by Express; behind a proxy, `app.set('trust proxy', ...)`
    // must be enabled for this to reflect the real client IP.
    const ip =
      req.ip ||
      (req.headers['x-forwarded-for'] as string | undefined) ||
      undefined;
    const userAgent = req.get('user-agent') || undefined;

    try {
      const row = await ConsentService.record(
        userId,
        consent_type as any, // validated by Joi; narrow cast is safe here
        consent_version,
        ip,
        userAgent
      );

      logger.info(
        `Consent recorded via API: user=${userId} type=${consent_type} version=${consent_version}`
      );

      return ApiResponseHandler.success(res, row, {
        message: 'Consent recorded',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Record consent failed:', { userId, consent_type, error: msg });
      return ApiResponseHandler.error(
        res,
        'ONBOARDING_CONSENT_RECORD_ERROR',
        msg,
        400
      );
    }
  }

  /**
   * GET /api/v1/onboarding/consent
   *
   * Return a summary of the authenticated user's current consent state
   * for all four consent types.
   *
   * Response shape:
   *   {
   *     terms_of_service: boolean,
   *     privacy_policy:   boolean,
   *     kyc_data_sharing: boolean,
   *     liveness_capture: boolean
   *   }
   *
   * Auth: any authenticated user.
   */
  async getConsentSummary(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const summary = await ConsentService.getConsentSummary(userId);
      return ApiResponseHandler.success(res, summary);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Fetch consent summary failed:', { userId, error: msg });
      return ApiResponseHandler.error(
        res,
        'ONBOARDING_CONSENT_SUMMARY_ERROR',
        msg,
        400
      );
    }
  }
}

export default OnboardingConsentController;