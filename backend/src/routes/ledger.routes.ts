// ============================================
// LEDGER.ROUTES.TS - MODIFIED
// ============================================

import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import LedgerController from '../controllers/ledger.controller';

const router = Router();
const ledgerController = new LedgerController();

// ❌ REMOVED - Validation schemas no longer needed
// const failSettlementSchema = Joi.object({
//   reason: Joi.string().required(),
// });

// ============================================
// DRIVER LEDGER ROUTES (READ-ONLY)
// ============================================

// ✅ KEEP - All GET routes (read-only)
router.get('/driver', authenticate, ledgerController.getDriverLedger.bind(ledgerController));
router.get('/driver/summary', authenticate, ledgerController.getDriverLedgerSummary.bind(ledgerController));
router.get('/driver/transactions', authenticate, ledgerController.getDriverTransactions.bind(ledgerController));
router.get('/driver/earnings', authenticate, ledgerController.getDriverEarnings.bind(ledgerController));
router.get('/driver/commission', authenticate, ledgerController.getDriverCommission.bind(ledgerController));
router.get('/driver/withdrawals-total', authenticate, ledgerController.getDriverWithdrawalsTotal.bind(ledgerController));

// ============================================
// DRIVER SETTLEMENT ROUTES (READ-ONLY)
// ============================================

// ✅ KEEP - All GET routes (read-only)
router.get('/settlements', authenticate, ledgerController.getDriverSettlements.bind(ledgerController));
router.get('/settlements/summary', authenticate, ledgerController.getDriverSettlementSummary.bind(ledgerController));
router.get('/settlements/:settlementId', authenticate, ledgerController.getSettlementById.bind(ledgerController));

// ============================================
// ADMIN LEDGER ROUTES (READ-ONLY)
// ============================================

// ✅ KEEP - All GET routes (read-only)
router.get('/admin/drivers', authenticate, authorize('admin', 'super_admin'), ledgerController.getAllDriverLedgers.bind(ledgerController));
router.get('/admin/settlements', authenticate, authorize('admin', 'super_admin'), ledgerController.getAllSettlements.bind(ledgerController));
router.get('/admin/settlements/summary', authenticate, authorize('admin', 'super_admin'), ledgerController.getGlobalSettlementSummary.bind(ledgerController));

// ❌ REMOVED - All settlement processing routes (POST)
// Settlements are now automatic via Paystack subaccount.
// 
// REMOVED:
// router.post('/admin/settlements/:settlementId/process', ...)
// router.post('/admin/settlements/:settlementId/complete', ...)
// router.post('/admin/settlements/:settlementId/fail', ...)
// router.post('/admin/settlements/process-all', ...)
// router.post('/admin/settlements/complete-all', ...)

export default router;