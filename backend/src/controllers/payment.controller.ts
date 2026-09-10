import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { PaymentService } from '../services/payment.service';
import { PaystackService } from '../services/paystack.service';

export class PaymentController {
  // ============================================
  // PAYMENT INITIATION
  // ============================================

  /**
   * Initialize a payment
   * POST /api/v1/payments/initialize
   */
  async initializePayment(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { ride_id, amount, payment_method, email } = req.body;

    if (!ride_id || !amount || !payment_method) {
      return ApiResponseHandler.validationError(res, 'ride_id, amount, and payment_method are required');
    }

    // Get passenger profile ID
    const passenger = await this.getPassengerProfileByUserId(userId);
    if (!passenger) {
      return ApiResponseHandler.validationError(res, 'Passenger profile not found');
    }

    try {
      const result = await PaymentService.initializePayment({
        ride_id,
        passenger_id: passenger.id,
        amount,
        payment_method,
        email,
      });

      return ApiResponseHandler.success(res, result, {
        message: 'Payment initialized successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment initialization failed';
      return ApiResponseHandler.error(res, 'PAYMENT_INIT_ERROR', errorMessage, 400);
    }
  }

  /**
   * Verify a payment
   * POST /api/v1/payments/verify
   */
  async verifyPayment(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { reference } = req.body;

    if (!reference) {
      return ApiResponseHandler.validationError(res, 'Reference is required');
    }

    try {
      const payment = await PaymentService.verifyPayment({ reference });
      return ApiResponseHandler.success(res, payment, {
        message: 'Payment verified successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment verification failed';
      return ApiResponseHandler.error(res, 'PAYMENT_VERIFY_ERROR', errorMessage, 400);
    }
  }

  /**
   * Process a payment
   * POST /api/v1/payments/process
   */
  async processPayment(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { payment_id, amount } = req.body;

    if (!payment_id) {
      return ApiResponseHandler.validationError(res, 'payment_id is required');
    }

    try {
      const payment = await PaymentService.processPayment({ payment_id, amount });
      return ApiResponseHandler.success(res, payment, {
        message: 'Payment processed successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment processing failed';
      return ApiResponseHandler.error(res, 'PAYMENT_PROCESS_ERROR', errorMessage, 400);
    }
  }

  // ============================================
  // PAYMENT LOOKUP
  // ============================================

  /**
   * Get payment by ID
   * GET /api/v1/payments/:paymentId
   */
  async getPaymentById(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { paymentId } = req.params;
    const paymentIdStr = Array.isArray(paymentId) ? paymentId[0] : paymentId;

    const payment = await PaymentService.getPaymentById(paymentIdStr);
    if (!payment) {
      return ApiResponseHandler.notFound(res, 'Payment not found');
    }

    // Verify ownership
    const isOwner = await this.isPaymentOwner(userId, payment);
    if (!isOwner) {
      return ApiResponseHandler.forbidden(res, 'You do not have access to this payment');
    }

    return ApiResponseHandler.success(res, payment);
  }

  /**
   * Get payment with details
   * GET /api/v1/payments/:paymentId/details
   */
  async getPaymentWithDetails(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { paymentId } = req.params;
    const paymentIdStr = Array.isArray(paymentId) ? paymentId[0] : paymentId;

    const payment = await PaymentService.getPaymentWithDetails(paymentIdStr);
    if (!payment) {
      return ApiResponseHandler.notFound(res, 'Payment not found');
    }

    return ApiResponseHandler.success(res, payment);
  }

  /**
   * Get payments by passenger
   * GET /api/v1/payments/passenger
   */
  async getPaymentsByPassenger(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const passenger = await this.getPassengerProfileByUserId(userId);
    if (!passenger) {
      return ApiResponseHandler.validationError(res, 'Passenger profile not found');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const result = await PaymentService.getPaymentsByPassenger(passenger.id, page, limit);

    return ApiResponseHandler.success(res, result.payments, {
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
   * Get payments by driver
   * GET /api/v1/payments/driver
   */
  async getPaymentsByDriver(req: AuthRequest, res: Response): Promise<Response> {
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

    const result = await PaymentService.getPaymentsByDriver(driver.id, page, limit);

    return ApiResponseHandler.success(res, result.payments, {
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
  // REFUNDS
  // ============================================

  /**
   * Create a refund
   * POST /api/v1/payments/:paymentId/refund
   */
  async createRefund(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { paymentId } = req.params;
    const paymentIdStr = Array.isArray(paymentId) ? paymentId[0] : paymentId;

    const { amount, reason } = req.body;

    if (!amount || amount <= 0) {
      return ApiResponseHandler.validationError(res, 'Amount must be greater than zero');
    }

    if (!reason) {
      return ApiResponseHandler.validationError(res, 'Reason is required');
    }

    try {
      const refund = await PaymentService.createRefund({
        payment_id: paymentIdStr,
        amount,
        reason,
      });

      return ApiResponseHandler.success(res, refund, {
        message: 'Refund created successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Refund creation failed';
      return ApiResponseHandler.error(res, 'REFUND_ERROR', errorMessage, 400);
    }
  }

  // ============================================
  // PAYMENT SUMMARY
  // ============================================

  /**
   * Get payment summary (Admin)
   * GET /api/v1/payments/admin/summary
   */
  async getPaymentSummary(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const summary = await PaymentService.getPaymentSummary();
      return ApiResponseHandler.success(res, summary);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get payment summary';
      return ApiResponseHandler.error(res, 'PAYMENT_SUMMARY_ERROR', errorMessage, 400);
    }
  }

  /**
   * Get all payments (Admin)
   * GET /api/v1/payments/admin/all
   */
  async getAllPayments(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    const filters = {
      status: req.query.status as string | undefined,
      payment_method: req.query.payment_method as string | undefined,
      payment_type: req.query.payment_type as string | undefined,
      start_date: req.query.start_date ? new Date(req.query.start_date as string) : undefined,
      end_date: req.query.end_date ? new Date(req.query.end_date as string) : undefined,
    };

    try {
      const result = await PaymentService.getAllPayments(page, limit, filters);

      return ApiResponseHandler.success(res, result.payments, {
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get payments';
      return ApiResponseHandler.error(res, 'PAYMENTS_FETCH_ERROR', errorMessage, 400);
    }
  }

  // ============================================
  // PAYSTACK STATUS CHECK
  // ============================================

  /**
   * Check if Paystack is configured
   * GET /api/v1/payments/config/status
   */
  async getConfigStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    return ApiResponseHandler.success(res, {
      paystack_configured: PaystackService.isConfigured(),
      currency: 'NGN',
    });
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Get passenger profile by user ID
   */
  private async getPassengerProfileByUserId(userId: string): Promise<any | null> {
    const pool = (await import('../config/database')).default;
    const result = await pool.query(
      'SELECT * FROM passenger_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get driver profile by user ID
   */
  private async getDriverProfileByUserId(userId: string): Promise<any | null> {
    const pool = (await import('../config/database')).default;
    const result = await pool.query(
      'SELECT * FROM driver_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Check if user is payment owner
   */
  private async isPaymentOwner(userId: string, payment: any): Promise<boolean> {
    const pool = (await import('../config/database')).default;

    // Check if user is the passenger
    const passenger = await pool.query(
      'SELECT * FROM passenger_profiles WHERE user_id = $1 AND id = $2',
      [userId, payment.passenger_id]
    );
    if (passenger.rows.length > 0) {
      return true;
    }

    // Check if user is the driver
    const driver = await pool.query(
      'SELECT * FROM driver_profiles WHERE user_id = $1 AND id = $2',
      [userId, payment.driver_id]
    );
    if (driver.rows.length > 0) {
      return true;
    }

    // Check if user is admin
    const admin = await pool.query(
      'SELECT * FROM admin_profiles WHERE user_id = $1',
      [userId]
    );
    if (admin.rows.length > 0) {
      return true;
    }

    return false;
  }
}

export default PaymentController;