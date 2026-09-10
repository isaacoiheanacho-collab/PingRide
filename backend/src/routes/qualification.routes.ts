import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { QualificationController } from '../controllers/qualification.controller';

const router = Router();
const controller = new QualificationController();

// ============================================
// PASSENGER ROUTES (Authenticated)
// ============================================

/**
 * Get passenger qualification progress
 * GET /api/v1/qualification/passenger/progress
 * Returns: spend, threshold, remaining, qualification status
 */
router.get(
  '/passenger/progress',
  authenticate,
  controller.getPassengerProgress.bind(controller)
);

/**
 * Get passenger PINGRIDE letter progress
 * GET /api/v1/qualification/passenger/pingride
 * Returns: 8 letters with completion status, overall progress %
 */
router.get(
  '/passenger/pingride',
  authenticate,
  controller.getPassengerPINGRIDE.bind(controller)
);

/**
 * Get passenger qualification status (simplified)
 * GET /api/v1/qualification/passenger/status
 * Returns: status, spend, threshold, remaining
 */
router.get(
  '/passenger/status',
  authenticate,
  controller.getPassengerStatus.bind(controller)
);

// ============================================
// DRIVER ROUTES (Authenticated)
// ============================================

/**
 * Get driver qualification progress
 * GET /api/v1/qualification/driver/progress
 * Returns: contribution, threshold, remaining, qualification status
 */
router.get(
  '/driver/progress',
  authenticate,
  controller.getDriverProgress.bind(controller)
);

/**
 * Get driver PINGRIDE letter progress
 * GET /api/v1/qualification/driver/pingride
 * Returns: 8 letters with completion status, overall progress %
 */
router.get(
  '/driver/pingride',
  authenticate,
  controller.getDriverPINGRIDE.bind(controller)
);

/**
 * Get driver qualification status (simplified)
 * GET /api/v1/qualification/driver/status
 * Returns: status, contribution, threshold, remaining
 */
router.get(
  '/driver/status',
  authenticate,
  controller.getDriverStatus.bind(controller)
);

// ============================================
// ADMIN ROUTES (Admin only)
// ============================================

/**
 * Get all passenger qualifications (Admin)
 * GET /api/v1/qualification/admin/passengers
 * Query: periodId (required)
 */
router.get(
  '/admin/passengers',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getAdminPassengerQualifications.bind(controller)
);

/**
 * Get all driver qualifications (Admin)
 * GET /api/v1/qualification/admin/drivers
 * Query: periodId (required)
 */
router.get(
  '/admin/drivers',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getAdminDriverQualifications.bind(controller)
);

/**
 * Get qualified passengers (Admin)
 * GET /api/v1/qualification/admin/passengers/qualified
 * Query: periodId (required)
 */
router.get(
  '/admin/passengers/qualified',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getQualifiedPassengers.bind(controller)
);

/**
 * Get qualified drivers (Admin)
 * GET /api/v1/qualification/admin/drivers/qualified
 * Query: periodId (required)
 */
router.get(
  '/admin/drivers/qualified',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getQualifiedDrivers.bind(controller)
);

/**
 * Get qualification summary (Admin)
 * GET /api/v1/qualification/admin/summary
 * Query: periodId (required)
 */
router.get(
  '/admin/summary',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getQualificationSummary.bind(controller)
);

/**
 * Exclude a user from qualification (Admin)
 * POST /api/v1/qualification/admin/exclude
 * Body: { user_id, user_type, programme_period_id, reason }
 */
router.post(
  '/admin/exclude',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.excludeUser.bind(controller)
);

/**
 * Reverse qualification (Admin)
 * POST /api/v1/qualification/admin/reverse
 * Body: { user_id, user_type, programme_period_id, reason }
 */
router.post(
  '/admin/reverse',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.reverseQualification.bind(controller)
);

/**
 * Manually mark passenger as qualified (Admin)
 * POST /api/v1/qualification/admin/passenger/mark-qualified
 * Body: { passenger_id, programme_period_id, spend_amount (optional) }
 */
router.post(
  '/admin/passenger/mark-qualified',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.markPassengerQualified.bind(controller)
);

/**
 * Manually mark driver as qualified (Admin)
 * POST /api/v1/qualification/admin/driver/mark-qualified
 * Body: { driver_id, programme_period_id, contribution_amount (optional) }
 */
router.post(
  '/admin/driver/mark-qualified',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.markDriverQualified.bind(controller)
);

export default router;