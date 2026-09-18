// ============================================
// WALLET.ROUTES.TS - MODIFIED
// ============================================

import { Router } from 'express';
import { authenticate, requireVerified } from '../middleware/auth.middleware';
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

// ============================================
// WALLET ROUTES (READ-ONLY — open to any authenticated user)
// ============================================
//
// A pending_verification user is allowed to look at their own wallet
// state so they can see the balance they'll fund once verified. They
// cannot spend it or freeze it until verified.

router.get(
  '/balance',
  authenticate,
  walletController.getBalance.bind(walletController)
);

router.get(
  '/',
  authenticate,
  walletController.getWallet.bind(walletController)
);

router.get(
  '/summary',
  authenticate,
  walletController.getSummary.bind(walletController)
);

router.get(
  '/transactions',
  authenticate,
  walletController.getTransactions.bind(walletController)
);

router.get(
  '/transactions/:transactionId',
  authenticate,
  walletController.getTransactionById.bind(walletController)
);

router.get(
  '/top-up-info',
  authenticate,
  walletController.getTopUpInfo.bind(walletController)
);

router.get(
  '/detailed',
  authenticate,
  walletController.getDetailedBalance.bind(walletController)
);

router.get(
  '/virtual-account',
  authenticate,
  walletController.getVirtualAccount.bind(walletController)
);

router.get(
  '/bank-transfers',
  authenticate,
  walletController.getBankTransfers.bind(walletController)
);

// ============================================
// WALLET WRITE ROUTES (verified users)
// ============================================

router.post(
  '/freeze',
  authenticate,
  requireVerified(),
  validate(freezeWalletSchema),
  walletController.freezeWallet.bind(walletController)
);

router.post(
  '/unfreeze',
  authenticate,
  requireVerified(),
  walletController.unfreezeWallet.bind(walletController)
);

// ============================================
// DRIVER WALLET ROUTES (verified drivers)
// ============================================

router.get(
  '/driver/ledger',
  authenticate,
  requireVerified(),
  walletController.getDriverLedger.bind(walletController)
);

router.get(
  '/driver/summary',
  authenticate,
  requireVerified(),
  walletController.getDriverSummary.bind(walletController)
);

router.get(
  '/driver/transactions',
  authenticate,
  requireVerified(),
  walletController.getDriverTransactions.bind(walletController)
);

router.get(
  '/driver/withdrawals',
  authenticate,
  requireVerified(),
  walletController.getWithdrawals.bind(walletController)
);

export default router;