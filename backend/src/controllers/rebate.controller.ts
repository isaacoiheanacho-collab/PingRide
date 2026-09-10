import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { RebateFundService } from '../services/rebate-fund.service';
import { PassengerModel } from '../models/passenger.model';

export class RebateController {
  // ============================================
  // PASSENGER REBATE ROUTES
  // ============================================

  /**
   * Get passenger rebate credits
   * GET /api/v1/rebate/credits
   */
  async getCredits(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const status = req.query.status as 'active' | 'used' | 'expired' | 'cancelled' | undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    // Get passenger profile to get passenger_id
    const passenger = await PassengerModel.getProfile(userId);
    if (!passenger) {
      return ApiResponseHandler.validationError(res, 'Passenger profile not found');
    }

    const result = await RebateFundService.getCreditsByPassenger(passenger.id, status, page, limit);

    return ApiResponseHandler.success(res, result.credits, {
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
   * Get passenger rebate credit balance
   * GET /api/v1/rebate/credits/balance
   */
  async getCreditBalance(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    // Get passenger profile to get passenger_id
    const passenger = await PassengerModel.getProfile(userId);
    if (!passenger) {
      return ApiResponseHandler.validationError(res, 'Passenger profile not found');
    }

    const balance = await RebateFundService.getAvailableCreditBalance(passenger.id);

    return ApiResponseHandler.success(res, {
      balance,
      currency: 'NGN',
    });
  }

  /**
   * Get passenger active credits
   * GET /api/v1/rebate/credits/active
   */
  async getActiveCredits(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    // Get passenger profile to get passenger_id
    const passenger = await PassengerModel.getProfile(userId);
    if (!passenger) {
      return ApiResponseHandler.validationError(res, 'Passenger profile not found');
    }

    const credits = await RebateFundService.getActiveCreditsByPassenger(passenger.id);

    return ApiResponseHandler.success(res, credits);
  }

  /**
   * Get credit by ID
   * GET /api/v1/rebate/credits/:creditId
   */
  async getCreditById(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { creditId } = req.params;
    const creditIdStr = Array.isArray(creditId) ? creditId[0] : creditId;

    const credit = await RebateFundService.getCreditById(creditIdStr);

    if (!credit) {
      return ApiResponseHandler.notFound(res, 'Credit not found');
    }

    // Get passenger profile to check ownership
    const passenger = await PassengerModel.getProfile(userId);
    if (!passenger || credit.passenger_id !== passenger.id) {
      return ApiResponseHandler.forbidden(res, 'Credit does not belong to you');
    }

    return ApiResponseHandler.success(res, credit);
  }

  // ============================================
  // ADMIN REBATE ROUTES
  // ============================================

  /**
   * Get rebate fund balance (Admin)
   * GET /api/v1/rebate/admin/fund-balance
   */
  async getFundBalance(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;

    let balance;
    if (programmePeriodId) {
      balance = await RebateFundService.getFundBalance(programmePeriodId);
    } else {
      balance = await RebateFundService.getCurrentFundBalance();
    }

    return ApiResponseHandler.success(res, balance);
  }

  /**
   * Get rebate fund summary (Admin)
   * GET /api/v1/rebate/admin/fund-summary
   */
  async getFundSummary(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const summary = await RebateFundService.getFundSummary(programmePeriodId);
    return ApiResponseHandler.success(res, summary);
  }

  /**
   * Get all contributions (Admin)
   * GET /api/v1/rebate/admin/contributions
   */
  async getContributions(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const result = await RebateFundService.getContributions(programmePeriodId, page, limit);

    return ApiResponseHandler.success(res, result.contributions, {
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
   * Get all allocations (Admin)
   * GET /api/v1/rebate/admin/allocations
   */
  async getAllocations(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const result = await RebateFundService.getAllocations(programmePeriodId, page, limit);

    return ApiResponseHandler.success(res, result.allocations, {
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
   * Approve allocations (Admin)
   * POST /api/v1/rebate/admin/allocations/approve
   */
  async approveAllocations(req: AuthRequest, res: Response): Promise<Response> {
    const { allocation_ids } = req.body;

    if (!allocation_ids || !Array.isArray(allocation_ids) || allocation_ids.length === 0) {
      return ApiResponseHandler.validationError(res, 'allocation_ids array is required');
    }

    const count = await RebateFundService.approveAllocations(allocation_ids);

    return ApiResponseHandler.success(res, {
      approved: count,
      totalRequested: allocation_ids.length,
    }, {
      message: `${count} allocations approved`,
    });
  }

  /**
   * Issue credits for a programme period (Admin)
   * POST /api/v1/rebate/admin/issue-credits
   */
  async issueCreditsForPeriod(req: AuthRequest, res: Response): Promise<Response> {
    const { programme_period_id } = req.body;

    if (!programme_period_id) {
      return ApiResponseHandler.validationError(res, 'programme_period_id is required');
    }

    const result = await RebateFundService.issueCreditsForPeriod(programme_period_id);

    return ApiResponseHandler.success(res, result, {
      message: `Issued ${result.issued} credits totaling ₦${result.totalAmount}`,
    });
  }

  /**
   * Get current fund balance for UI (Admin)
   * GET /api/v1/rebate/admin/current-fund
   */
  async getCurrentFundForUI(_req: AuthRequest, res: Response): Promise<Response> {
    const fundData = await RebateFundService.getCurrentFundBalanceForUI();

    if (!fundData) {
      return ApiResponseHandler.success(res, {
        balance: 0,
        totalContributions: 0,
        totalAllocations: 0,
        totalCredited: 0,
        totalUsed: 0,
        totalExpired: 0,
        available: 0,
        periodName: 'No active programme period',
        periodYear: 0,
      });
    }

    return ApiResponseHandler.success(res, fundData);
  }
}

export default RebateController;