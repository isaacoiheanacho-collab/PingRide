import { Router } from 'express';
import { authenticate, requireVerified, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { validationSchemas } from '../utils/validator';
import OnboardingController from '../controllers/onboarding.controller';

const router = Router();
const controller = new OnboardingController();

// ============================================
// ONBOARDING ROUTES (Phase 2)
// All routes require authentication.
// ============================================

/**
 * GET /api/v1/onboarding/status
 *
 * Returns the current user's onboarding state.
 * Response shape depends on role (passenger / driver / admin).
 *
 * Available to: any authenticated user (including pending_verification).
 * This route must stay open — it is how a pending user sees what step
 * they need to complete next.
 */
router.get(
  '/status',
  authenticate,
  controller.getStatus.bind(controller)
);

/**
 * POST /api/v1/onboarding/passenger/kyc
 *
 * Phase 2A — passenger BVN + bank → Paystack DVA (Wema Bank).
 *
 * Runs the full chain on Paystack:
 *   1. POST /customer                              → customer_code
 *   2. POST /customer/{code}/identification        → NIBSS validation (202)
 *   3. POST /dedicated_account                     → DVA number (sync)
 *
 * On success, `virtual_accounts` row is created and linked to
 * `passenger_profiles.virtual_account_id`. This is the completion
 * signal for the passenger onboarding flow.
 *
 * Body:
 *   - email
 *   - bvn                  (11 digits)
 *   - bank_account_number  (10 digits)
 *   - bank_code            (string, from dropdown)
 *   - bank_name            (string, from dropdown)
 *
 * Available to: verified passengers only.
 */
router.post(
  '/passenger/kyc',
  authenticate,
  requireVerified(),
  authorize('passenger'),
  validate(validationSchemas.passengerOnboarding),
  controller.completePassengerKYC.bind(controller)
);

/**
 * POST /api/v1/onboarding/driver/bank
 *
 * Phase 2B — driver settlement bank + Paystack subaccount.
 *
 * Body:
 *   - email
 *   - settlement_bank_name
 *   - settlement_bank_code
 *   - settlement_account_number
 *
 * Available to: verified drivers only.
 */
router.post(
  '/driver/bank',
  authenticate,
  requireVerified(),
  authorize('driver'),
  validate(validationSchemas.driverOnboarding),
  controller.completeDriverBank.bind(controller)
);

export default router;