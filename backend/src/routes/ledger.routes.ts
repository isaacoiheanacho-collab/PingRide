// ============================================
// LEDGER.ROUTES.TS - MODIFIED
// ============================================

import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import LedgerController from '../controllers/ledger.controller';

const router = Router();
const ledgerController = new LedgerController();

// ============================================
// DRIVER LEDGER ROUTES (READ-ONLY)
// ============================================

router.get('/driver', authenticate, ledgerController.getDriverLedger.bind(ledgerController));
router.get('/driver/summary', authenticate, ledgerController.getDriverLedgerSummary.bind(ledgerController));
router.get('/driver/transactions', authenticate, ledgerController.getDriverTransactions.bind(ledgerController));
router.get('/driver/earnings', authenticate, ledgerController.getDriverEarnings.bind(ledgerController));
router.get('/driver/commission', authenticate, ledgerController.getDriverCommission.bind(ledgerController));

// ============================================
// ADMIN LEDGER ROUTES (READ-ONLY)
// ============================================

router.get('/admin/drivers', authenticate, authorize('admin', 'super_admin'), ledgerController.getAllDriverLedgers.bind(ledgerController));

export default router;