// ============================================
// LEDGER.CONTROLLER.TS - MODIFIED
// ============================================

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { DriverLedgerModel } from '../models/driver-ledger.model';
import { DriverModel } from '../models/driver.model';

export class LedgerController {
  // ============================================
  // DRIVER LEDGER ROUTES (READ-ONLY)
  // ============================================

  /**
   * Get driver ledger (READ-ONLY)
   * GET /api/v1/ledger/driver
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
   * Get driver ledger summary (READ-ONLY)
   * GET /api/v1/ledger/driver/summary
   */
  async getDriverLedgerSummary(req: AuthRequest, res: Response): Promise<Response> {
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
   * Get driver ledger transactions (READ-ONLY)
   * GET /api/v1/ledger/driver/transactions
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
   * Get driver earnings summary (READ-ONLY)
   * GET /api/v1/ledger/driver/earnings
   */
  async getDriverEarnings(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await this.getDriverProfileByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const earnings = await DriverLedgerModel.getTotalEarnings(driver.id);
    return ApiResponseHandler.success(res, {
      ...earnings,
      _note: 'Informational only. Payments are automatic via Paystack subaccount.',
    });
  }

  /**
   * Get driver total commission (READ-ONLY)
   * GET /api/v1/ledger/driver/commission
   */
  async getDriverCommission(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await this.getDriverProfileByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const commission = await DriverLedgerModel.getTotalCommissionDeducted(driver.id);
    return ApiResponseHandler.success(res, {
      total_commission: commission,
      _note: 'Informational only. Payments are automatic via Paystack subaccount.',
    });
  }

  // ============================================
  // ADMIN LEDGER ROUTES (READ-ONLY)
  // ============================================

  /**
   * Get all driver ledgers (Admin - READ-ONLY)
   * GET /api/v1/ledger/admin/drivers
   */
  async getAllDriverLedgers(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const isAdmin = await this.isAdmin(userId);
    if (!isAdmin) {
      return ApiResponseHandler.forbidden(res, 'Admin access required');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const result = await DriverLedgerModel.getAllWithDriverDetails(page, limit);

    return ApiResponseHandler.success(res, {
      ledgers: result.ledgers,
      total: result.total,
      _note: 'Informational only. Driver payments are automatic via Paystack subaccount.',
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

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Get driver profile by user ID
   */
  private async getDriverProfileByUserId(userId: string): Promise<any | null> {
    return DriverModel.getByUserId(userId);
  }

  /**
   * Check if user is admin
   */
  private async isAdmin(userId: string): Promise<boolean> {
    const pool = (await import('../config/database')).default;
    const result = await pool.query(
      'SELECT * FROM admin_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows.length > 0;
  }
}

export default LedgerController;