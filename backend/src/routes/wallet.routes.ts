// ============================================
// WALLET.ROUTES.TS - MODIFIED
// ============================================

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import WalletController from '../controllers/wallet.controller';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const walletController = new WalletController();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const freezeWalletSchema = Joi.object({
  reason: Joi.string().required(),
});

// ❌ REMOVED - withdrawSchema is no longer needed
// const withdrawSchema = Joi.object({
//   amount: Joi.number().positive().required(),
//   method: Joi.string().valid('bank_transfer', 'mobile_money', 'cash').required(),
//   account_name: Joi.string().required(),
//   account_number: Joi.string().required(),
//   bank_name: Joi.string().optional(),
// });

// ❌ REMOVED - topUpSchema is no longer needed (top-up via bank transfer webhook)
// const topUpSchema = Joi.object({
//   amount: Joi.number().positive().required(),
//   reference_id: Joi.string().uuid().optional(),
//   metadata: Joi.object().optional(),
// });

// ============================================
// WALLET ROUTES (All authenticated)
// ============================================

// ✅ KEEP - Passenger wallet routes
router.get('/balance', authenticate, walletController.getBalance.bind(walletController));
router.get('/', authenticate, walletController.getWallet.bind(walletController));
router.get('/summary', authenticate, walletController.getSummary.bind(walletController));
router.get('/transactions', authenticate, walletController.getTransactions.bind(walletController));
router.get('/transactions/:transactionId', authenticate, walletController.getTransactionById.bind(walletController));

// ❌ REMOVED - top-up endpoint (handled via bank transfer webhook)
// router.post('/top-up', authenticate, validate(topUpSchema), walletController.topUp.bind(walletController));

// Wallet freeze/unfreeze
router.post('/freeze', authenticate, validate(freezeWalletSchema), walletController.freezeWallet.bind(walletController));
router.post('/unfreeze', authenticate, walletController.unfreezeWallet.bind(walletController));

// Top-up info (shows virtual account details for bank transfer)
router.get('/top-up-info', authenticate, walletController.getTopUpInfo.bind(walletController));

// ============================================
// DRIVER WALLET ROUTES (READ-ONLY)
// ============================================

// ✅ KEEP - Driver read-only routes
router.get('/driver/ledger', authenticate, walletController.getDriverLedger.bind(walletController));
router.get('/driver/summary', authenticate, walletController.getDriverSummary.bind(walletController));
router.get('/driver/transactions', authenticate, walletController.getDriverTransactions.bind(walletController));
router.get('/driver/withdrawals', authenticate, walletController.getWithdrawals.bind(walletController));

// ❌ REMOVED - Driver withdrawal write route
// Withdrawals are now automatic via Paystack subaccount.
// Drivers receive payments instantly when passengers pay for rides.
// router.post('/driver/withdraw', authenticate, validate(withdrawSchema), walletController.requestWithdrawal.bind(walletController));

// ============================================
// VIRTUAL ACCOUNT ROUTES (PHASE 10)
// ============================================

// ✅ KEEP - Virtual account routes
router.get('/detailed', authenticate, walletController.getDetailedBalance.bind(walletController));
router.get('/virtual-account', authenticate, walletController.getVirtualAccount.bind(walletController));
router.get('/bank-transfers', authenticate, walletController.getBankTransfers.bind(walletController));

export default router;