import { Router } from 'express';
import { authenticate, requireVerified, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { validationSchemas } from '../utils/validator';
import OnboardingIdentityController from '../controllers/onboarding-identity.controller';

const router = Router();
const controller = new OnboardingIdentityController();

/**
 * POST /api/v1/onboarding/driver/identity
 * Submit driver identity documents for admin review.
 * Auth: verified drivers only.
 */
router.post(
  '/',
  authenticate,
  requireVerified(),
  authorize('driver'),
  validate(validationSchemas.driverIdentitySubmission),
  controller.submitIdentity.bind(controller)
);

/**
 * GET /api/v1/onboarding/driver/identity/status
 * Fetch current identity submission + verification state.
 * Auth: verified drivers only.
 */
router.get(
  '/status',
  authenticate,
  requireVerified(),
  authorize('driver'),
  controller.getStatus.bind(controller)
);

export default router;