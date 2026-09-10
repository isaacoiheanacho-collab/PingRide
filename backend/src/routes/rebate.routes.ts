import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { RebateController } from '../controllers/rebate.controller';

const router = Router();
const controller = new RebateController();

// ============================================
// PASSENGER REBATE ROUTES (Authenticated)
// ============================================

/**
 * Get passenger rebate credits
 * GET /api/v1/rebate/credits
 * Query: status (optional) - active, used, expired, cancelled
 */
router.get(
  '/credits',
  authenticate,
  controller.getCredits.bind(controller)
);

/**
 * Get passenger rebate credit balance
 * GET /api/v1/rebate/credits/balance
 */
router.get(
  '/credits/balance',
  authenticate,
  controller.getCreditBalance.bind(controller)
);

/**
 * Get passenger active credits
 * GET /api/v1/rebate/credits/active
 */
router.get(
  '/credits/active',
  authenticate,
  controller.getActiveCredits.bind(controller)
);

/**
 * Get credit by ID
 * GET /api/v1/rebate/credits/:creditId
 */
router.get(
  '/credits/:creditId',
  authenticate,
  controller.getCreditById.bind(controller)
);

// ============================================
// ADMIN REBATE ROUTES (Admin only)
// ============================================

/**
 * Get rebate fund balance (Admin)
 * GET /api/v1/rebate/admin/fund-balance
 * Query: periodId (optional)
 */
router.get(
  '/admin/fund-balance',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getFundBalance.bind(controller)
);

/**
 * Get rebate fund summary (Admin)
 * GET /api/v1/rebate/admin/fund-summary
 * Query: periodId (required)
 */
router.get(
  '/admin/fund-summary',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getFundSummary.bind(controller)
);

/**
 * Get current fund balance for UI (Admin)
 * GET /api/v1/rebate/admin/current-fund
 */
router.get(
  '/admin/current-fund',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getCurrentFundForUI.bind(controller)
);

/**
 * Get all contributions (Admin)
 * GET /api/v1/rebate/admin/contributions
 * Query: periodId (required)
 */
router.get(
  '/admin/contributions',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getContributions.bind(controller)
);

/**
 * Get all allocations (Admin)
 * GET /api/v1/rebate/admin/allocations
 * Query: periodId (required)
 */
router.get(
  '/admin/allocations',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getAllocations.bind(controller)
);

/**
 * Approve allocations (Admin)
 * POST /api/v1/rebate/admin/allocations/approve
 * Body: { allocation_ids: string[] }
 */
router.post(
  '/admin/allocations/approve',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.approveAllocations.bind(controller)
);

/**
 * Issue credits for a programme period (Admin)
 * POST /api/v1/rebate/admin/issue-credits
 * Body: { programme_period_id }
 */
router.post(
  '/admin/issue-credits',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.issueCreditsForPeriod.bind(controller)
);

export default router;