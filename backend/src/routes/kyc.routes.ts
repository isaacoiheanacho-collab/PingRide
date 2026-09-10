import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { KYCModel } from '../models/kyc.model';
import { ApiResponseHandler } from '../utils/response';
import { AuthRequest } from '../middleware/auth.middleware';
import { Response } from 'express';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const submitBVNSchema = Joi.object({
  bvn: Joi.string()
    .length(11)
    .pattern(/^[0-9]{11}$/)
    .required()
    .messages({
      'string.length': 'BVN must be 11 digits',
      'string.pattern.base': 'BVN must contain only numbers',
      'any.required': 'BVN is required',
    }),
});

const submitNINSchema = Joi.object({
  nin: Joi.string()
    .length(11)
    .pattern(/^[0-9]{11}$/)
    .required()
    .messages({
      'string.length': 'NIN must be 11 digits',
      'string.pattern.base': 'NIN must contain only numbers',
      'any.required': 'NIN is required',
    }),
});

const updateKYCStatusSchema = Joi.object({
  userId: Joi.string().uuid().required().messages({
    'any.required': 'User ID is required',
    'string.uuid': 'Invalid user ID format',
  }),
  status: Joi.string()
    .valid('pending', 'verified', 'failed')
    .required()
    .messages({
      'any.only': 'Status must be one of: pending, verified, failed',
      'any.required': 'Status is required',
    }),
  failureReason: Joi.string().optional(),
});

// ============================================
// PASSENGER KYC ROUTES (Protected)
// ============================================

/**
 * GET /api/v1/kyc/passenger/status
 * Get passenger KYC status
 */
router.get(
  '/passenger/status',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponseHandler.unauthorized(res, 'Not authenticated');
      }

      const kycStatus = await KYCModel.getPassengerKYC(userId);
      
      if (!kycStatus) {
        return ApiResponseHandler.success(res, {
          kyc_status: 'pending',
          message: 'Passenger profile not found. Please complete your profile.',
        });
      }

      return ApiResponseHandler.success(res, kycStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

/**
 * POST /api/v1/kyc/passenger/bvn
 * Submit BVN for KYC verification
 */
router.post(
  '/passenger/bvn',
  authenticate,
  validate(submitBVNSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponseHandler.unauthorized(res, 'Not authenticated');
      }

      const { bvn } = req.body;

      const success = await KYCModel.submitPassengerBVN(userId, bvn);
      
      if (!success) {
        return ApiResponseHandler.notFound(res, 'Passenger profile not found');
      }

      return ApiResponseHandler.success(
        res,
        { status: 'pending', message: 'BVN submitted successfully. Awaiting verification.' },
        { message: 'BVN submitted successfully' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

/**
 * POST /api/v1/kyc/passenger/nin
 * Submit NIN for KYC verification
 */
router.post(
  '/passenger/nin',
  authenticate,
  validate(submitNINSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponseHandler.unauthorized(res, 'Not authenticated');
      }

      const { nin } = req.body;

      const success = await KYCModel.submitPassengerNIN(userId, nin);
      
      if (!success) {
        return ApiResponseHandler.notFound(res, 'Passenger profile not found');
      }

      return ApiResponseHandler.success(
        res,
        { status: 'pending', message: 'NIN submitted successfully. Awaiting verification.' },
        { message: 'NIN submitted successfully' }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

/**
 * GET /api/v1/kyc/passenger/details
 * Get passenger KYC with full details (including user info)
 */
router.get(
  '/passenger/details',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return ApiResponseHandler.unauthorized(res, 'Not authenticated');
      }

      const details = await KYCModel.getPassengerKYCWithDetails(userId);
      
      if (!details) {
        return ApiResponseHandler.notFound(res, 'Passenger profile not found');
      }

      return ApiResponseHandler.success(res, details);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

// ============================================
// ADMIN KYC ROUTES (Admin only)
// ============================================

/**
 * PUT /api/v1/kyc/passenger/status
 * Update passenger KYC status (admin only)
 */
router.put(
  '/passenger/status',
  authenticate,
  authorize('admin', 'super_admin'),
  validate(updateKYCStatusSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.user?.id;
      if (!adminId) {
        return ApiResponseHandler.unauthorized(res, 'Not authenticated');
      }

      const { userId, status, failureReason } = req.body;

      const success = await KYCModel.updatePassengerKYC(
        userId,
        status,
        adminId,
        failureReason
      );

      if (!success) {
        return ApiResponseHandler.notFound(res, 'Passenger profile not found');
      }

      return ApiResponseHandler.success(
        res,
        { userId, status, updated: true },
        { message: `KYC status updated to ${status}` }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

/**
 * GET /api/v1/kyc/passenger/pending
 * Get passengers with pending KYC (admin only)
 */
router.get(
  '/passenger/pending',
  authenticate,
  authorize('admin', 'super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 100;

      const result = await KYCModel.getPendingPassengerKYC(page, limit);

      return ApiResponseHandler.success(res, result.passengers, {
        meta: {
          timestamp: new Date().toISOString(),
          pagination: {
            page,
            limit,
            total: result.total,
            pages: Math.ceil(result.total / limit),
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

/**
 * GET /api/v1/kyc/stats
 * Get KYC statistics (admin only)
 */
router.get(
  '/stats',
  authenticate,
  authorize('admin', 'super_admin'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const stats = await KYCModel.getPassengerKYCStats();

      return ApiResponseHandler.success(res, {
        total: stats.total,
        pending: stats.pending,
        verified: stats.verified,
        failed: stats.failed,
        verified_percentage: stats.total > 0 
          ? Math.round((stats.verified / stats.total) * 100) 
          : 0,
        pending_percentage: stats.total > 0 
          ? Math.round((stats.pending / stats.total) * 100) 
          : 0,
        failed_percentage: stats.total > 0 
          ? Math.round((stats.failed / stats.total) * 100) 
          : 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

/**
 * GET /api/v1/kyc/passenger/all
 * Get all passenger KYC with pagination (admin only)
 */
router.get(
  '/passenger/all',
  authenticate,
  authorize('admin', 'super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 100;
      const status = req.query.status as 'pending' | 'verified' | 'failed' | undefined;

      const result = await KYCModel.getAllPassengerKYC(page, limit, status);

      return ApiResponseHandler.success(res, result.passengers, {
        meta: {
          timestamp: new Date().toISOString(),
          pagination: {
            page,
            limit,
            total: result.total,
            pages: Math.ceil(result.total / limit),
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

/**
 * GET /api/v1/kyc/passenger/:userId
 * Get passenger KYC by user ID (admin only)
 */
router.get(
  '/passenger/:userId',
  authenticate,
  authorize('admin', 'super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req.params;
      const userIdStr = Array.isArray(userId) ? userId[0] : userId;

      const details = await KYCModel.getPassengerKYCWithDetails(userIdStr);

      if (!details) {
        return ApiResponseHandler.notFound(res, 'Passenger profile not found');
      }

      return ApiResponseHandler.success(res, details);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return ApiResponseHandler.error(res, 'KYC_ERROR', message, 400);
    }
  }
);

export default router;