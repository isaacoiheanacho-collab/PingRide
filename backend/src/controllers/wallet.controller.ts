// ============================================
// WALLET.CONTROLLER.TS - MODIFIED
// ============================================

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { WalletService } from '../services/wallet.service';
import { DriverLedgerModel } from '../models/driver-ledger.model';
import { DriverModel } from '../models/driver.model';
import { VirtualAccountService } from '../services/virtual-account.service';
import { BankTransferEventModel } from '../models/bank-transfer-event.model';

export class WalletController {
  // ============================================
  // WALLET ROUTES (PASSENGER)
  // ============================================

  /**
   * Get wallet balance
   * GET /api/v1/wallet/balance
   */
  async getBalance(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const balance = await WalletService.getBalance(userId);
    const wallet = await WalletService.getWalletByUserId(userId);

    return ApiResponseHandler.success(res, {
      balance,
      currency: wallet.currency,
      wallet_id: wallet.id,
      status: wallet.status,
    });
  }

  /**
   * Get wallet details
   * GET /api/v1/wallet
   */
  async getWallet(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const wallet = await WalletService.getWalletByUserId(userId);
    return ApiResponseHandler.success(res, wallet);
  }

  /**
   * Get wallet transactions
   * GET /api/v1/wallet/transactions
   */
  async getTransactions(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const result = await WalletService.getTransactions(userId, page, limit);

    return ApiResponseHandler.success(res, result.transactions, {
      meta: {
        timestamp: new Date().toISOString(),
        pagination: {
          page,
          limit,
          total: result.total,
          pages: Math.ceil(result.total / limit),
        }
      }
    });
  }

  /**
   * Get wallet summary
   * GET /api/v1/wallet/summary
   */
  async getSummary(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const summary = await WalletService.getWalletSummary(userId);
    return ApiResponseHandler.success(res, summary);
  }

  /**
   * Get top-up info (actual top-up via bank transfer webhook)
   * GET /api/v1/wallet/top-up-info
   */
  async getTopUpInfo(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const account = await VirtualAccountService.getVirtualAccount(userId);

    return ApiResponseHandler.success(res, {
      message: 'Fund your wallet via bank transfer to your virtual account',
      virtual_account: account ? {
        account_number: account.account_number,
        bank_name: account.bank_name,
        account_name: account.account_name,
      } : null,
      instructions: [
        'Transfer funds to your virtual account number',
        'Funds will be automatically credited to your wallet',
        'You can then use your wallet to pay for rides',
      ],
    });
  }

  /**
   * Get transaction by ID
   * GET /api/v1/wallet/transactions/:transactionId
   */
  async getTransactionById(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { transactionId } = req.params;
    const transactionIdStr = Array.isArray(transactionId) ? transactionId[0] : transactionId;

    const transaction = await WalletService.getTransactionById(transactionIdStr);

    if (!transaction) {
      return ApiResponseHandler.notFound(res, 'Transaction not found');
    }

    // Verify ownership
    const wallet = await WalletService.getWalletByUserId(userId);
    if (transaction.wallet_id !== wallet.id) {
      return ApiResponseHandler.forbidden(res, 'Transaction does not belong to you');
    }

    return ApiResponseHandler.success(res, transaction);
  }

  /**
   * Freeze wallet
   * POST /api/v1/wallet/freeze
   */
  async freezeWallet(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { reason } = req.body;

    if (!reason) {
      return ApiResponseHandler.validationError(res, 'Reason is required');
    }

    const wallet = await WalletService.freezeWallet(userId, reason);
    return ApiResponseHandler.success(res, wallet, {
      message: 'Wallet frozen successfully',
    });
  }

  /**
   * Unfreeze wallet
   * POST /api/v1/wallet/unfreeze
   */
  async unfreezeWallet(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const wallet = await WalletService.unfreezeWallet(userId);
    return ApiResponseHandler.success(res, wallet, {
      message: 'Wallet unfrozen successfully',
    });
  }

  // ============================================
  // DRIVER WALLET ROUTES (READ-ONLY)
  // ============================================

  /**
   * Get driver ledger (READ-ONLY)
   * GET /api/v1/wallet/driver/ledger
   */
  async getDriverLedger(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await this.getDriverProfileByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const ledger = await DriverLedgerModel.getByDriverId(driver.id);
    if (!ledger) {
      return ApiResponseHandler.notFound(res, 'Driver ledger not found');
    }

    return ApiResponseHandler.success(res, {
      ...ledger,
      _note: 'Informational only. Payments are automatic via Paystack subaccount.',
    });
  }

  /**
   * Get driver ledger transactions (READ-ONLY)
   * GET /api/v1/wallet/driver/transactions
   */
  async getDriverTransactions(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await this.getDriverProfileByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const result = await DriverLedgerModel.getTransactionsByDriverId(driver.id, page, limit);

    return ApiResponseHandler.success(res, {
      transactions: result.transactions,
      total: result.total,
      _note: 'Historical data. Current payments are automatic via Paystack subaccount.',
    });
  }

  /**
   * Get driver balance summary (READ-ONLY)
   * GET /api/v1/wallet/driver/summary
   */
  async getDriverSummary(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await this.getDriverProfileByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const ledger = await DriverLedgerModel.getByDriverId(driver.id);
    if (!ledger) {
      return ApiResponseHandler.notFound(res, 'Driver ledger not found');
    }

    const summary = {
      digitalEarnings: ledger.digital_earnings || 0,
      cashCommissionDebt: ledger.cash_commission_debt || 0,
      bonusEarnings: ledger.bonus_earnings || 0,
      adjustmentEarnings: ledger.adjustment_earnings || 0,
      totalCommissionDeducted: ledger.total_commission_deducted || 0,
      totalWithdrawals: ledger.total_withdrawals || 0,
      totalRefunds: ledger.total_refunds || 0,
      netBalance: ledger.net_balance || 0,
      withdrawableBalance: ledger.withdrawable_balance || 0,
    };

    return ApiResponseHandler.success(res, {
      ...summary,
      _note: 'Informational only. Payments are automatic via Paystack subaccount.',
    });
  }

  /**
   * Get driver withdrawal history (READ-ONLY)
   * GET /api/v1/wallet/driver/withdrawals
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This endpoint shows historical withdrawal data only.
   */
  async getWithdrawals(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await this.getDriverProfileByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    // ✅ READ ONLY - historical data
    const result = await WalletService.getWithdrawals(driver.id, page, limit);

    return ApiResponseHandler.success(res, {
      withdrawals: result.withdrawals,
      total: result.total,
      _note: 'Historical data. Current payments are automatic via Paystack subaccount.',
    });
  }

  // ============================================
  // VIRTUAL ACCOUNT ROUTES
  // ============================================

  /**
   * GET /api/v1/wallet/detailed
   * Get detailed wallet balance breakdown
   */
  async getDetailedBalance(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponseHandler.unauthorized(res, 'Not authenticated');
      }

      const balance = await WalletService.getDetailedBalance(userId);
      return ApiResponseHandler.success(res, balance);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'WALLET_BALANCE_ERROR', message, 400);
    }
  }

  /**
   * GET /api/v1/wallet/virtual-account
   * Get passenger's virtual account details
   */
  async getVirtualAccount(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponseHandler.unauthorized(res, 'Not authenticated');
      }

      const account = await VirtualAccountService.getVirtualAccount(userId);

      if (!account) {
        return ApiResponseHandler.notFound(res, 'Virtual account not found');
      }

      return ApiResponseHandler.success(res, {
        account_number: account.account_number,
        bank_name: account.bank_name,
        account_name: account.account_name,
        status: account.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'VIRTUAL_ACCOUNT_ERROR', message, 400);
    }
  }

  /**
   * GET /api/v1/wallet/bank-transfers
   * Get bank transfer history
   */
  async getBankTransfers(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponseHandler.unauthorized(res, 'Not authenticated');
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await BankTransferEventModel.getByUserId(userId, page, limit);

      return ApiResponseHandler.success(res, {
        data: result.events,
        pagination: {
          page,
          limit,
          total: result.total,
          pages: Math.ceil(result.total / limit),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'BANK_TRANSFER_ERROR', message, 400);
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Get driver profile by user ID
   */
  private async getDriverProfileByUserId(userId: string): Promise<any | null> {
    return DriverModel.getByUserId(userId);
  }
}

export default WalletController;