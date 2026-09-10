import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { ProgrammePeriodModel } from '../models/programme-period.model';
import { PassengerQualificationModel } from '../models/passenger-qualification.model';
import { DriverQualificationModel } from '../models/driver-qualification.model';
import { QualificationService } from '../services/qualification.service';
import { RebateFundService } from '../services/rebate-fund.service';
import { WinnerSelectionService } from '../services/winner-selection.service';
import { FraudDetectionService } from '../services/fraud-detection.service';
import { ICreateProgrammePeriod } from '../types';
import logger from '../utils/logger'; // ✅ ADDED: Missing import

export class AdminIncentiveController {
  // ============================================
  // PROGRAMME PERIOD MANAGEMENT
  // ============================================

  /**
   * Create a new programme period
   * POST /api/v1/admin/incentive/programme/create
   */
  async createProgrammePeriod(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const data: ICreateProgrammePeriod = req.body;

    // Validate required fields
    if (!data.year || !data.start_date || !data.end_date) {
      return ApiResponseHandler.validationError(
        res,
        'year, start_date, and end_date are required'
      );
    }

    // Validate dates
    const dateValidation = ProgrammePeriodModel.validateDates(data.start_date, data.end_date);
    if (!dateValidation.valid) {
      return ApiResponseHandler.validationError(res, dateValidation.message || 'Invalid date range');
    }

    // Check if programme period already exists for this year
    const existing = await ProgrammePeriodModel.getByYear(data.year);
    if (existing) {
      return ApiResponseHandler.conflict(res, `Programme period for ${data.year} already exists`);
    }

    const period = await ProgrammePeriodModel.create({
      ...data,
      created_by: adminId,
    });

    return ApiResponseHandler.success(res, period, {
      message: `Programme period ${data.year} created successfully`,
    });
  }

  /**
   * Get all programme periods
   * GET /api/v1/admin/incentive/programme/list
   */
  async getProgrammePeriods(req: AuthRequest, res: Response): Promise<Response> {
    const status = req.query.status as string | undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const result = await ProgrammePeriodModel.getAll(status, page, limit);

    return ApiResponseHandler.success(res, result.periods, {
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
   * Get programme period by ID
   * GET /api/v1/admin/incentive/programme/:id
   */
  async getProgrammePeriodById(req: AuthRequest, res: Response): Promise<Response> {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    const period = await ProgrammePeriodModel.getById(idStr);

    if (!period) {
      return ApiResponseHandler.notFound(res, 'Programme period not found');
    }

    return ApiResponseHandler.success(res, period);
  }

  /**
   * Update programme period status
   * PATCH /api/v1/admin/incentive/programme/:id/status
   */
  async updateProgrammePeriodStatus(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    const { status } = req.body;

    if (!status) {
      return ApiResponseHandler.validationError(res, 'status is required');
    }

    if (!['draft', 'active', 'closed', 'archived'].includes(status)) {
      return ApiResponseHandler.validationError(
        res,
        'status must be one of: draft, active, closed, archived'
      );
    }

    const period = await ProgrammePeriodModel.updateStatus(idStr, status, adminId);

    if (!period) {
      return ApiResponseHandler.notFound(res, 'Programme period not found');
    }

    return ApiResponseHandler.success(res, period, {
      message: `Programme period status updated to ${status}`,
    });
  }

  /**
   * Update programme period configuration
   * PATCH /api/v1/admin/incentive/programme/:id/config
   */
  async updateProgrammePeriodConfig(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    const config = req.body;

    const period = await ProgrammePeriodModel.updateConfig(idStr, config, adminId);

    if (!period) {
      return ApiResponseHandler.notFound(res, 'Programme period not found');
    }

    return ApiResponseHandler.success(res, period, {
      message: 'Programme period configuration updated',
    });
  }

  /**
   * Get active programme period
   * GET /api/v1/admin/incentive/programme/active
   */
  async getActiveProgrammePeriod(_req: AuthRequest, res: Response): Promise<Response> {
    const period = await ProgrammePeriodModel.getActive();

    if (!period) {
      return ApiResponseHandler.success(res, null, {
        message: 'No active programme period found',
      });
    }

    // Get active counts
    const passengerCount = await ProgrammePeriodModel.getActivePassengerCount(period.id);
    const driverCount = await ProgrammePeriodModel.getActiveDriverCount(period.id);

    return ApiResponseHandler.success(res, {
      ...period,
      active_passenger_count: passengerCount,
      active_driver_count: driverCount,
    });
  }

  // ============================================
  // COMPLETE PROGRAMME WORKFLOW
  // ============================================

  /**
   * Complete programme workflow (Admin)
   * POST /api/v1/admin/incentive/programme/:id/complete
   * 
   * This endpoint:
   * 1. Closes the programme period
   * 2. Selects winners (if not already selected)
   * 3. Calculates rebate allocations (if fund available)
   * 4. Issues credits (if allocations exist)
   */
  async completeProgrammeWorkflow(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    // 1. Close the programme period
    const period = await ProgrammePeriodModel.updateStatus(idStr, 'closed', adminId);
    if (!period) {
      return ApiResponseHandler.notFound(res, 'Programme period not found');
    }

    // 2. Check if winners already exist for this period
    const existingWinners = await WinnerSelectionService.getActiveWinners(idStr);
    let selectionResult;

    if (existingWinners.length > 0) {
      // Winners already selected - use existing
      logger.info(`Winners already exist for period ${idStr}, skipping selection`);
      selectionResult = {
        passengerWinners: {
          userType: 'passenger' as const,
          programmePeriodId: idStr,
          totalActiveUsers: await ProgrammePeriodModel.getActivePassengerCount(idStr),
          winnerCapacity: 0,
          totalQualified: 0,
          oversubscribed: false,
          winners: existingWinners.filter(w => w.user_type === 'passenger'),
          status: 'all_selected' as const,
        },
        driverWinners: {
          userType: 'driver' as const,
          programmePeriodId: idStr,
          totalActiveUsers: await ProgrammePeriodModel.getActiveDriverCount(idStr),
          winnerCapacity: 0,
          totalQualified: 0,
          oversubscribed: false,
          winners: existingWinners.filter(w => w.user_type === 'driver'),
          status: 'all_selected' as const,
        },
        summary: {
          totalPassengerWinners: existingWinners.filter(w => w.user_type === 'passenger').length,
          totalDriverWinners: existingWinners.filter(w => w.user_type === 'driver').length,
          totalWinners: existingWinners.length,
          passengerQualified: 0,
          driverQualified: 0,
          passengerCapacity: 0,
          driverCapacity: 0,
        }
      };
    } else {
      // Select winners
      selectionResult = await WinnerSelectionService.completeWinnerSelection(idStr);
    }

    // 3. Get active passenger winners for rebate allocation
    const passengerWinners = await WinnerSelectionService.getActiveWinners(idStr, 'passenger');
    const winnerIds = passengerWinners.map((w) => w.id);

    // Check if there's any fund balance to allocate
    const availableBalance = await RebateFundService.getAvailableBalance(idStr);

    if (winnerIds.length > 0 && availableBalance > 0) {
      try {
        // 4. Calculate and create rebate allocations
        const allocationResult = await RebateFundService.allocateRebates(idStr, winnerIds);

        // 5. Approve allocations
        const allocationIds = allocationResult.allocations.map((a) => a.id);
        await RebateFundService.approveAllocations(allocationIds);

        // 6. Issue credits
        const creditResult = await RebateFundService.issueCreditsForPeriod(idStr);

        return ApiResponseHandler.success(res, {
          programmePeriod: period,
          selection: selectionResult,
          allocations: allocationResult,
          credits: creditResult,
        }, {
          message: `Programme ${period.year} completed successfully. ${selectionResult.summary.totalWinners} winners, ${creditResult.issued} credits issued.`,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Error completing programme workflow';
        logger.error('Error in completeProgrammeWorkflow:', error);
        return ApiResponseHandler.error(res, 'PROGRAMME_COMPLETION_ERROR', errorMessage, 500);
      }
    } else {
      // No winners or no fund balance - just close the period
      const message = winnerIds.length === 0 
        ? `Programme ${period.year} closed. No passenger winners found.`
        : `Programme ${period.year} closed. ${winnerIds.length} winners selected but no rebates allocated (fund balance is ₦0).`;

      return ApiResponseHandler.success(res, {
        programmePeriod: period,
        selection: selectionResult,
        allocations: [],
        credits: { issued: 0, totalAmount: 0, credits: [] },
        message,
      }, {
        message,
      });
    }
  }

  // ============================================
  // FRAUD ADMIN ROUTES
  // ============================================

  /**
   * Run fraud detection batch (Admin)
   * POST /api/v1/admin/incentive/fraud/run-batch
   */
  async runFraudDetectionBatch(req: AuthRequest, res: Response): Promise<Response> {
    const { programme_period_id } = req.body;

    if (!programme_period_id) {
      return ApiResponseHandler.validationError(res, 'programme_period_id is required');
    }

    const result = await FraudDetectionService.batchDetectFraud(programme_period_id);

    return ApiResponseHandler.success(res, result, {
      message: `Fraud detection batch completed. ${result.fraudCasesCreated} cases created.`,
    });
  }

  /**
   * Get fraud summary (Admin)
   * GET /api/v1/admin/incentive/fraud/summary
   */
  async getFraudSummary(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;

    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const summary = await FraudDetectionService.getFraudSummary(programmePeriodId);

    return ApiResponseHandler.success(res, summary);
  }

  /**
   * Get pending fraud cases (Admin)
   * GET /api/v1/admin/incentive/fraud/pending
   */
  async getPendingFraudCases(_req: AuthRequest, res: Response): Promise<Response> {
    const page = parseInt(_req.query.page as string, 10) || 1;
    const limit = parseInt(_req.query.limit as string, 10) || 100;

    const result = await FraudDetectionService.getPendingFraudCases(page, limit);

    return ApiResponseHandler.success(res, result.cases, {
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
   * Get exclusion summary (Admin)
   * GET /api/v1/admin/incentive/exclusions/summary
   */
  async getExclusionSummary(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;

    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const summary = await FraudDetectionService.getExclusionSummary(programmePeriodId);

    return ApiResponseHandler.success(res, summary);
  }

  // ============================================
  // COMPLETE INCENTIVE DASHBOARD
  // ============================================

  /**
   * Get complete incentive dashboard data (Admin)
   * GET /api/v1/admin/incentive/dashboard
   */
  async getIncentiveDashboard(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    let periodId = programmePeriodId;

    // If no period provided, get the active or most recent period
    if (!periodId) {
      const period = await ProgrammePeriodModel.getCurrent() || await ProgrammePeriodModel.getActive();
      if (period) {
        periodId = period.id;
      }
    }

    if (!periodId) {
      return ApiResponseHandler.success(res, {
        programmePeriod: null,
        message: 'No programme period found',
      });
    }

    const period = await ProgrammePeriodModel.getById(periodId);

    // Get qualification summary
    const qualificationSummary = await QualificationService.getQualificationSummary(periodId);

    // Get fund summary
    const fundSummary = await RebateFundService.getFundSummary(periodId);

    // Get winner summary
    const winnerSummary = await WinnerSelectionService.getWinnerSummary(periodId);

    // Get fraud summary
    const fraudSummary = await FraudDetectionService.getFraudSummary(periodId);

    // Get exclusion summary
    const exclusionSummary = await FraudDetectionService.getExclusionSummary(periodId);

    // Get active counts
    const activePassengers = await ProgrammePeriodModel.getActivePassengerCount(periodId);
    const activeDrivers = await ProgrammePeriodModel.getActiveDriverCount(periodId);

    // Get qualified counts
    const qualifiedPassengers = await PassengerQualificationModel.getQualifiedCount(periodId);
    const qualifiedDrivers = await DriverQualificationModel.getQualifiedCount(periodId);

    // Get winner counts
    const passengerWinners = await WinnerSelectionService.getWinnerCount(periodId, 'passenger', 'active');
    const driverWinners = await WinnerSelectionService.getWinnerCount(periodId, 'driver', 'active');

    return ApiResponseHandler.success(res, {
      programmePeriod: period,
      summary: {
        activePassengers,
        activeDrivers,
        qualifiedPassengers,
        qualifiedDrivers,
        passengerWinners,
        driverWinners,
        totalWinners: passengerWinners + driverWinners,
      },
      qualification: qualificationSummary,
      fund: fundSummary,
      winners: winnerSummary,
      fraud: fraudSummary,
      exclusions: exclusionSummary,
    });
  }
}

export default AdminIncentiveController;