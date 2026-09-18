import { Router } from 'express';
import { authenticate, requireVerified } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { validationSchemas } from '../utils/validator';
import OnboardingConsentController from '../controllers/onboarding-consent.controller';

const router = Router();
const controller = new OnboardingConsentController();

// ============================================
// ONBOARDING CONSENT ROUTES (NDPA 2023)
//
// All routes require authentication and a verified phone number.
// Any authenticated, verified user may record or inspect their own
// consent — this is not role-gated.
//
// Used by the Phase 2C / 2D flow: before submitting identity or
// vehicle documents, the driver must grant `kyc_data_sharing`
// consent, or the submission endpoints will reject with a
// ValidationError (see ConsentService.assertConsent).
// ============================================

/**
 * POST /api/v1/onboarding/consent
 *
 * Record a consent event (grant) for the authenticated user.
 * Append-only — calling this twice just writes two rows; the most
 * recent row wins for `hasConsent()` checks.
 *
 * Body:
 *   - consent_type     ('terms_of_service' | 'privacy_policy'
 *                       | 'kyc_data_sharing' | 'liveness_capture')
 *   - consent_version  (semantic version string, e.g. "1.0")
 *
 * Auth: verified users only.
 */
router.post(
  '/',
  authenticate,
  requireVerified(),
  validate(validationSchemas.recordConsent),
  controller.recordConsent.bind(controller)
);

/**
 * GET /api/v1/onboarding/consent
 *
 * Return a summary of the authenticated user's current consent state
 * for all four consent types (true = currently granted).
 *
 * Auth: verified users only.
 */
router.get(
  '/',
  authenticate,
  requireVerified(),
  controller.getConsentSummary.bind(controller)
);

export default router;