import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { QualificationService } from '../services/qualification.service';

export class QualificationController {
  // ============================================
  // PASSENGER QUALIFICATION ROUTES
  // ============================================

  /**
   * Get passenger qualification progress
   * GET /api/v1/qualification/passenger/progress
   */
  async getPassengerProgress(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const result = await QualificationService.getPassengerQualification(userId);
    return ApiResponseHandler.success(res, result);
  }

  /**
   * Get passenger PINGRIDE progress
   * GET /api/v1/qualification/passenger/pingride
   */
  async getPassengerPINGRIDE(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const progress = await QualificationService.getPassengerQualificationForUI(userId);
    return ApiResponseHandler.success(res, progress);
  }

  /**
   * Get passenger qualification status (simplified)
   * GET /api/v1/qualification/passenger/status
   */
  async getPassengerStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const result = await QualificationService.getPassengerQualification(userId);
    
    // Determine status properly
    let status: string = 'not_started';
    if (result.qualification?.qualification_status === 'qualified') {
      status = 'qualified';
    } else if (result.qualification?.qualification_status === 'in_progress') {
      status = 'in_progress';
    } else if (result.qualification?.qualification_status === 'excluded') {
      status = 'excluded';
    }

    return ApiResponseHandler.success(res, {
      status,
      spend: result.eligibleSpend,
      threshold: result.threshold,
      remaining: result.remaining,
      isWinner: result.qualification?.winner_selected || false,
    });
  }

  // ============================================
  // DRIVER QUALIFICATION ROUTES
  // ============================================

  /**
   * Get driver qualification progress
   * GET /api/v1/qualification/driver/progress
   */
  async getDriverProgress(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const result = await QualificationService.getDriverQualification(userId);
    return ApiResponseHandler.success(res, result);
  }

  /**
   * Get driver PINGRIDE progress
   * GET /api/v1/qualification/driver/pingride
   */
  async getDriverPINGRIDE(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const progress = await QualificationService.getDriverQualificationForUI(userId);
    return ApiResponseHandler.success(res, progress);
  }

  /**
   * Get driver qualification status (simplified)
   * GET /api/v1/qualification/driver/status
   */
  async getDriverStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const result = await QualificationService.getDriverQualification(userId);
    
    // Determine status properly
    let status: string = 'not_started';
    if (result.qualification?.qualification_status === 'qualified') {
      status = 'qualified';
    } else if (result.qualification?.qualification_status === 'in_progress') {
      status = 'in_progress';
    } else if (result.qualification?.qualification_status === 'excluded') {
      status = 'excluded';
    }

    return ApiResponseHandler.success(res, {
      status,
      contribution: result.qualifyingContribution,
      threshold: result.threshold,
      remaining: result.remaining,
      isWinner: result.qualification?.winner_selected || false,
    });
  }

  // ============================================
  // ADMIN ROUTES
  // ============================================

  /**
   * Get all passenger qualifications (Admin)
   * GET /api/v1/qualification/admin/passengers
   */
  async getAdminPassengerQualifications(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const result = await QualificationService.getAllPassengerQualifications(programmePeriodId);
    const summary = await QualificationService.getQualificationSummary(programmePeriodId);

    return ApiResponseHandler.success(res, {
      qualifications: result,
      summary: summary.passengers,
      meta: {
        pagination: {
          page,
          limit,
          total: result.length,
          pages: Math.ceil(result.length / limit),
        }
      }
    });
  }

  /**
   * Get all driver qualifications (Admin)
   * GET /api/v1/qualification/admin/drivers
   */
  async getAdminDriverQualifications(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const qualifications = await QualificationService.getAllDriverQualifications(programmePeriodId);
    const summary = await QualificationService.getQualificationSummary(programmePeriodId);

    return ApiResponseHandler.success(res, {
      qualifications,
      summary: summary.drivers,
      meta: {
        pagination: {
          page,
          limit,
          total: qualifications.length,
          pages: Math.ceil(qualifications.length / limit),
        }
      }
    });
  }

  /**
   * Get qualified passengers (Admin)
   * GET /api/v1/qualification/admin/passengers/qualified
   */
  async getQualifiedPassengers(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const qualified = await QualificationService.getQualifiedPassengers(programmePeriodId);
    return ApiResponseHandler.success(res, qualified);
  }

  /**
   * Get qualified drivers (Admin)
   * GET /api/v1/qualification/admin/drivers/qualified
   */
  async getQualifiedDrivers(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const qualified = await QualificationService.getQualifiedDrivers(programmePeriodId);
    return ApiResponseHandler.success(res, qualified);
  }

  /**
   * Exclude a user from qualification (Admin)
   * POST /api/v1/qualification/admin/exclude
   */
  async excludeUser(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { user_id, user_type, programme_period_id, reason } = req.body;

    if (!user_id || !user_type || !programme_period_id || !reason) {
      return ApiResponseHandler.validationError(
        res,
        'user_id, user_type, programme_period_id, and reason are required'
      );
    }

    if (user_type === 'passenger') {
      await QualificationService.excludePassenger(user_id, programme_period_id, reason);
    } else if (user_type === 'driver') {
      await QualificationService.excludeDriver(user_id, programme_period_id, reason);
    } else {
      return ApiResponseHandler.validationError(res, 'user_type must be passenger or driver');
    }

    return ApiResponseHandler.success(res, null, {
      message: `User ${user_id} excluded from qualification`,
    });
  }

  /**
   * Reverse qualification (Admin)
   * POST /api/v1/qualification/admin/reverse
   */
  async reverseQualification(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { user_id, user_type, programme_period_id, reason } = req.body;

    if (!user_id || !user_type || !programme_period_id || !reason) {
      return ApiResponseHandler.validationError(
        res,
        'user_id, user_type, programme_period_id, and reason are required'
      );
    }

    if (user_type === 'passenger') {
      await QualificationService.reversePassengerQualification(user_id, programme_period_id, reason);
    } else if (user_type === 'driver') {
      await QualificationService.reverseDriverQualification(user_id, programme_period_id, reason);
    } else {
      return ApiResponseHandler.validationError(res, 'user_type must be passenger or driver');
    }

    return ApiResponseHandler.success(res, null, {
      message: `Qualification reversed for user ${user_id}`,
    });
  }

  /**
   * Manually mark passenger as qualified (Admin)
   * POST /api/v1/qualification/admin/passenger/mark-qualified
   */
  async markPassengerQualified(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { passenger_id, programme_period_id, spend_amount } = req.body;

    if (!passenger_id || !programme_period_id) {
      return ApiResponseHandler.validationError(res, 'passenger_id and programme_period_id are required');
    }

    const qualification = await QualificationService.markPassengerQualified(
      passenger_id,
      programme_period_id,
      spend_amount
    );

    return ApiResponseHandler.success(res, qualification, {
      message: `Passenger ${passenger_id} marked as qualified`,
    });
  }

  /**
   * Manually mark driver as qualified (Admin)
   * POST /api/v1/qualification/admin/driver/mark-qualified
   */
  async markDriverQualified(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { driver_id, programme_period_id, contribution_amount } = req.body;

    if (!driver_id || !programme_period_id) {
      return ApiResponseHandler.validationError(res, 'driver_id and programme_period_id are required');
    }

    const qualification = await QualificationService.markDriverQualified(
      driver_id,
      programme_period_id,
      contribution_amount
    );

    return ApiResponseHandler.success(res, qualification, {
      message: `Driver ${driver_id} marked as qualified`,
    });
  }

  /**
   * Get qualification summary (Admin)
   * GET /api/v1/qualification/admin/summary
   */
  async getQualificationSummary(req: AuthRequest, res: Response): Promise<Response> {
    const programmePeriodId = req.query.periodId as string;
    if (!programmePeriodId) {
      return ApiResponseHandler.validationError(res, 'Programme period ID is required');
    }

    const summary = await QualificationService.getQualificationSummary(programmePeriodId);
    return ApiResponseHandler.success(res, summary);
  }
}

export default QualificationController;