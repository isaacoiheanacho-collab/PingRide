import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { WinnerSelectionService } from '../services/winner-selection.service';
import { ProgrammePeriodModel } from '../models/programme-period.model';
import { WinnerModel } from '../models/winner.model';

export class WinnerController {
  // ============================================
  // USER WINNER ROUTES
  // ============================================

  /**
   * Check if current user is a winner
   * GET /api/v1/winner/status
   */
  async getWinnerStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const period = await ProgrammePeriodModel.getCurrent();
    if (!period) {
      return ApiResponseHandler.success(res, {
        isWinner: false,
        message: 'No active programme period',
      });
    }

    const isWinner = await WinnerSelectionService.isWinner(userId, period.id);
    const winner = await WinnerSelectionService.getWinnerByUserAndPeriod(userId, period.id);

    return ApiResponseHandler.success(res, {
      isWinner,
      winner: winner || null,
      programmePeriod: period,
    });
  }

  /**
   * Get current user's winner details
   * GET /api/v1/winner/details
   */
  async getWinnerDetails(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const period = await ProgrammePeriodModel.getCurrent();
    if (!period) {
      return ApiResponseHandler.success(res, {
        isWinner: false,
        message: 'No active programme period',
      });
    }

    const winner = await WinnerSelectionService.getWinnerByUserAndPeriod(userId, period.id);

    if (!winner) {
      return ApiResponseHandler.success(res, {
        isWinner: false,
        message: 'You are not a winner for the current programme period',
      });
    }

    const details = await WinnerModel.getWithUserDetails(winner.id);

    return ApiResponseHandler.success(res, {
      isWinner: true,
      winner: details,
    });
  }

  // ============================================
  // ADMIN WINNER ROUTES
  // ============================================

  /**
   * Select passenger winners (Admin)
   * POST /api/v1/winner/admin/select-passengers
   */
  async selectPassengerWinners(req: AuthRequest, res: Response): Promise<Response> {
    const { programme_period_id } = req.body;

    if (!programme_period_id) {
      return ApiResponseHandler.validationError(res, 'programme_period_id is required');
    }

    const result = await WinnerSelectionService.selectPassengerWinners(programme_period_id);

    return ApiResponseHandler.success(res, result, {
      message: `Selected ${result.winners.length} passenger winners`,
    });
  }

  /**
   * Select driver winners (Admin)
   * POST /api/v1/winner/admin/select-drivers
   */
  async selectDriverWinners(req: AuthRequest, res: Response): Promise<Response> {
    const { programme_period_id } = req.body;

    if (!programme_period_id) {
      return ApiResponseHandler.validationError(res, 'programme_period_id is required');
    }

    const result = await WinnerSelectionService.selectDriverWinners(programme_period_id);

    return ApiResponseHandler.success(res, result, {
      message: `Selected ${result.winners.length} driver winners`,
    });
  }

  /**
   * Select all winners (Admin)
   * POST /api/v1/winner/admin/select-all
   */
  async selectAllWinners(req: AuthRequest, res: Response): Promise<Response> {
    const { programme_period_id } = req.body;

    if (!programme_period_id) {
      return ApiResponseHandler.validationError(res, 'programme_period_id is required');
    }

    const result = await WinnerSelectionService.completeWinnerSelection(programme_period_id);

    return ApiResponseHandler.success(res, result, {
      message: `Selected ${result.summary.totalWinners} total winners`,
    });
  }

  /**
   * Get all winners (Admin)
   * GET /api/v1/winner/admin/winners
   */
  async getWinners(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    const userType = req.query.userType as 'passenger' | 'driver' | undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const result = await WinnerSelectionService.getWinners(programmePeriodId, userType, page, limit);
    const summary = await WinnerSelectionService.getWinnerSummary(programmePeriodId);

    return ApiResponseHandler.success(res, {
      winners: result.winners,
      summary,
      meta: {
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
   * Get active winners (Admin)
   * GET /api/v1/winner/admin/winners/active
   */
  async getActiveWinners(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    const userType = req.query.userType as 'passenger' | 'driver' | undefined;

    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const winners = await WinnerSelectionService.getActiveWinners(programmePeriodId, userType);
    return ApiResponseHandler.success(res, winners);
  }

  /**
   * Get winner by ID (Admin)
   * GET /api/v1/winner/admin/winners/:winnerId
   */
  async getWinnerById(req: AuthRequest, res: Response): Promise<Response> {
    const { winnerId } = req.params;
    const winnerIdStr = Array.isArray(winnerId) ? winnerId[0] : winnerId;

    const winner = await WinnerSelectionService.getWinnerById(winnerIdStr);

    if (!winner) {
      return ApiResponseHandler.notFound(res, 'Winner not found');
    }

    const details = await WinnerModel.getWithUserDetails(winner.id);

    return ApiResponseHandler.success(res, details);
  }

  /**
   * Disqualify a winner (Admin)
   * POST /api/v1/winner/admin/disqualify
   */
  async disqualifyWinner(req: AuthRequest, res: Response): Promise<Response> {
    const { winner_id, reason } = req.body;

    if (!winner_id || !reason) {
      return ApiResponseHandler.validationError(res, 'winner_id and reason are required');
    }

    const winner = await WinnerSelectionService.disqualifyWinner(winner_id, reason);

    if (!winner) {
      return ApiResponseHandler.notFound(res, 'Winner not found');
    }

    return ApiResponseHandler.success(res, winner, {
      message: `Winner ${winner_id} disqualified`,
    });
  }

  /**
   * Replace a disqualified winner (Admin)
   * POST /api/v1/winner/admin/replace
   */
  async replaceWinner(req: AuthRequest, res: Response): Promise<Response> {
    const { winner_id } = req.body;

    if (!winner_id) {
      return ApiResponseHandler.validationError(res, 'winner_id is required');
    }

    const replacement = await WinnerSelectionService.replaceWinner(winner_id);

    if (!replacement) {
      return ApiResponseHandler.success(res, null, {
        message: 'No replacement winner found',
      });
    }

    return ApiResponseHandler.success(res, replacement, {
      message: `Winner ${winner_id} replaced successfully`,
    });
  }

  /**
   * Get winner statistics (Admin)
   * GET /api/v1/winner/admin/stats
   */
  async getWinnerStats(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;

    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const stats = await WinnerSelectionService.getWinnerStats(programmePeriodId);

    return ApiResponseHandler.success(res, stats);
  }

  /**
   * Get winner summary (Admin)
   * GET /api/v1/winner/admin/summary
   */
  async getWinnerSummary(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;

    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const summary = await WinnerSelectionService.getWinnerSummary(programmePeriodId);

    return ApiResponseHandler.success(res, summary);
  }

  /**
   * Get disqualified winners (Admin)
   * GET /api/v1/winner/admin/disqualified
   */
  async getDisqualifiedWinners(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    const userType = req.query.userType as 'passenger' | 'driver' | undefined;

    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const winners = await WinnerSelectionService.getDisqualifiedWinners(programmePeriodId, userType);
    return ApiResponseHandler.success(res, winners);
  }

  /**
   * Mark winner as paid (Admin)
   * POST /api/v1/winner/admin/mark-paid
   */
  async markWinnerPaid(req: AuthRequest, res: Response): Promise<Response> {
    const { winner_id } = req.body;

    if (!winner_id) {
      return ApiResponseHandler.validationError(res, 'winner_id is required');
    }

    const winner = await WinnerSelectionService.markWinnerPaid(winner_id);

    if (!winner) {
      return ApiResponseHandler.notFound(res, 'Winner not found');
    }

    return ApiResponseHandler.success(res, winner, {
      message: `Winner ${winner_id} marked as paid`,
    });
  }
}

export default WinnerController;