import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { WinnerController } from '../controllers/winner.controller';

const router = Router();
const controller = new WinnerController();

// ============================================
// USER WINNER ROUTES (Authenticated)
// ============================================

/**
 * Check if current user is a winner
 * GET /api/v1/winner/status
 */
router.get(
  '/status',
  authenticate,
  controller.getWinnerStatus.bind(controller)
);

/**
 * Get current user's winner details
 * GET /api/v1/winner/details
 */
router.get(
  '/details',
  authenticate,
  controller.getWinnerDetails.bind(controller)
);

// ============================================
// ADMIN WINNER ROUTES (Admin only)
// ============================================

/**
 * Select passenger winners (Admin)
 * POST /api/v1/winner/admin/select-passengers
 * Body: { programme_period_id }
 */
router.post(
  '/admin/select-passengers',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.selectPassengerWinners.bind(controller)
);

/**
 * Select driver winners (Admin)
 * POST /api/v1/winner/admin/select-drivers
 * Body: { programme_period_id }
 */
router.post(
  '/admin/select-drivers',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.selectDriverWinners.bind(controller)
);

/**
 * Select all winners (Admin)
 * POST /api/v1/winner/admin/select-all
 * Body: { programme_period_id }
 */
router.post(
  '/admin/select-all',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.selectAllWinners.bind(controller)
);

/**
 * Get all winners (Admin)
 * GET /api/v1/winner/admin/winners
 * Query: periodId (required), userType (optional)
 */
router.get(
  '/admin/winners',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getWinners.bind(controller)
);

/**
 * Get active winners (Admin)
 * GET /api/v1/winner/admin/winners/active
 * Query: periodId (required), userType (optional)
 */
router.get(
  '/admin/winners/active',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getActiveWinners.bind(controller)
);

/**
 * Get winner by ID (Admin)
 * GET /api/v1/winner/admin/winners/:winnerId
 */
router.get(
  '/admin/winners/:winnerId',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getWinnerById.bind(controller)
);

/**
 * Disqualify a winner (Admin)
 * POST /api/v1/winner/admin/disqualify
 * Body: { winner_id, reason }
 */
router.post(
  '/admin/disqualify',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.disqualifyWinner.bind(controller)
);

/**
 * Replace a disqualified winner (Admin)
 * POST /api/v1/winner/admin/replace
 * Body: { winner_id }
 */
router.post(
  '/admin/replace',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.replaceWinner.bind(controller)
);

/**
 * Get winner statistics (Admin)
 * GET /api/v1/winner/admin/stats
 * Query: periodId (required)
 */
router.get(
  '/admin/stats',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getWinnerStats.bind(controller)
);

/**
 * Get winner summary (Admin)
 * GET /api/v1/winner/admin/summary
 * Query: periodId (required)
 */
router.get(
  '/admin/summary',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getWinnerSummary.bind(controller)
);

/**
 * Get disqualified winners (Admin)
 * GET /api/v1/winner/admin/disqualified
 * Query: periodId (required), userType (optional)
 */
router.get(
  '/admin/disqualified',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getDisqualifiedWinners.bind(controller)
);

/**
 * Mark winner as paid (Admin)
 * POST /api/v1/winner/admin/mark-paid
 * Body: { winner_id }
 */
router.post(
  '/admin/mark-paid',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.markWinnerPaid.bind(controller)
);

export default router;