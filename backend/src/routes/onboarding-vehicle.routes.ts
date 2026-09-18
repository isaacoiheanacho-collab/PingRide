import { Router } from 'express';
import { authenticate, requireVerified, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { validationSchemas } from '../utils/validator';
import OnboardingVehicleController from '../controllers/onboarding-vehicle.controller';

const router = Router();
const controller = new OnboardingVehicleController();

/**
 * POST /api/v1/onboarding/driver/vehicle
 * Submit vehicle compliance documents for admin review.
 * Auth: verified drivers only.
 */
router.post(
  '/',
  authenticate,
  requireVerified(),
  authorize('driver'),
  validate(validationSchemas.vehicleComplianceSubmission),
  controller.submitVehicle.bind(controller)
);

/**
 * GET /api/v1/onboarding/driver/vehicle/status?vehicleId=...
 * Fetch current vehicle compliance submission + verification state.
 * Falls back to the driver's primary vehicle if vehicleId is omitted.
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