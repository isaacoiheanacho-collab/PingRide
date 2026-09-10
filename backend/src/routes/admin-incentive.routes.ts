import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { AdminIncentiveController } from '../controllers/admin-incentive.controller';

const router = Router();
const controller = new AdminIncentiveController();

// ============================================
// ALL ROUTES REQUIRE ADMIN AUTHENTICATION
// ============================================

// Programme Period Management
router.post(
  '/programme/create',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.createProgrammePeriod.bind(controller)
);

router.get(
  '/programme/list',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getProgrammePeriods.bind(controller)
);

// ✅ FIXED: Move /active BEFORE /:id
router.get(
  '/programme/active',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getActiveProgrammePeriod.bind(controller)
);

router.get(
  '/programme/:id',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getProgrammePeriodById.bind(controller)
);

router.patch(
  '/programme/:id/status',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.updateProgrammePeriodStatus.bind(controller)
);

router.patch(
  '/programme/:id/config',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.updateProgrammePeriodConfig.bind(controller)
);

router.post(
  '/programme/:id/complete',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.completeProgrammeWorkflow.bind(controller)
);

// Fraud Management
router.post(
  '/fraud/run-batch',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.runFraudDetectionBatch.bind(controller)
);

router.get(
  '/fraud/summary',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getFraudSummary.bind(controller)
);

router.get(
  '/fraud/pending',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getPendingFraudCases.bind(controller)
);

// Exclusion Management
router.get(
  '/exclusions/summary',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getExclusionSummary.bind(controller)
);

// Complete Dashboard
router.get(
  '/dashboard',
  authenticate,
  authorize('admin', 'super_admin'),
  controller.getIncentiveDashboard.bind(controller)
);

export default router;