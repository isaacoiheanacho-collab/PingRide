import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import RideService from '../services/ride.service';
import { DriverModel } from '../models/driver.model';
import logger from '../utils/logger';

export class RideController {
  /**
   * Create a ride request (Passenger)
   */
  async createRideRequest(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const {
      pickup_latitude, pickup_longitude, pickup_address,
      destination_latitude, destination_longitude, destination_address,
      vehicle_type,
    } = req.body;

    const result = await RideService.createRideRequest(userId, {
      pickup_latitude,
      pickup_longitude,
      pickup_address,
      destination_latitude,
      destination_longitude,
      destination_address,
      vehicle_type,
    });

    return ApiResponseHandler.success(res, result, {
      message: result.message,
    });
  }

  /**
   * Get ride request details
   */
  async getRideRequest(req: AuthRequest, res: Response): Promise<Response> {
    const { rideRequestId } = req.params;
    const rideRequestIdStr = Array.isArray(rideRequestId) ? rideRequestId[0] : rideRequestId;

    const rideRequest = await RideService.getRideRequestWithPassenger(rideRequestIdStr);
    return ApiResponseHandler.success(res, rideRequest);
  }

  /**
   * Get bids for a ride request
   */
  async getBids(req: AuthRequest, res: Response): Promise<Response> {
    const { rideRequestId } = req.params;
    const rideRequestIdStr = Array.isArray(rideRequestId) ? rideRequestId[0] : rideRequestId;

    const bids = await RideService.getBids(rideRequestIdStr);
    return ApiResponseHandler.success(res, bids);
  }

  /**
   * Submit a bid (Driver)
   */
  async submitBid(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    // Get driver profile by user ID
    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const { ride_request_id, bid_amount, eta_minutes, driver_notes } = req.body;

    const result = await RideService.submitBid(driver.id, {
      ride_request_id,
      driver_id: driver.id,
      bid_amount,
      eta_minutes,
      driver_notes,
    });

    return ApiResponseHandler.success(res, result, {
      message: result.message,
    });
  }

  /**
   * Select a bid (Passenger)
   */
  async selectBid(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { rideRequestId, bidId } = req.params;
    const rideRequestIdStr = Array.isArray(rideRequestId) ? rideRequestId[0] : rideRequestId;
    const bidIdStr = Array.isArray(bidId) ? bidId[0] : bidId;

    const result = await RideService.selectBid(userId, rideRequestIdStr, bidIdStr);
    return ApiResponseHandler.success(res, result, {
      message: result.message,
    });
  }

  /**
   * Update ride status (Driver)
   */
  async updateRideStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { rideId } = req.params;
    const rideIdStr = Array.isArray(rideId) ? rideId[0] : rideId;

    const { status, latitude, longitude, notes } = req.body;

    // Get driver profile
    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const result = await RideService.updateRideStatus(driver.id, rideIdStr, {
      ride_id: rideIdStr,
      status,
      latitude,
      longitude,
      notes,
    });

    return ApiResponseHandler.success(res, result, {
      message: `Ride status updated to ${status}`,
    });
  }

  /**
   * Get ride details
   */
  async getRide(req: AuthRequest, res: Response): Promise<Response> {
    const { rideId } = req.params;
    const rideIdStr = Array.isArray(rideId) ? rideId[0] : rideId;

    const ride = await RideService.getRide(rideIdStr);
    return ApiResponseHandler.success(res, ride);
  }

  /**
   * Get active rides for driver
   */
  async getActiveRidesForDriver(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const rides = await RideService.getActiveRidesForDriver(driver.id);
    return ApiResponseHandler.success(res, rides);
  }

  /**
   * Get active rides for passenger
   */
  async getActiveRidesForPassenger(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const rides = await RideService.getActiveRidesForPassenger(userId);
    return ApiResponseHandler.success(res, rides);
  }

  /**
   * Get ride history for passenger
   */
  async getRideHistory(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = await RideService.getRideHistoryForPassenger(userId, page, limit);
    return ApiResponseHandler.success(res, result);
  }

  /**
   * Cancel ride
   */
  async cancelRide(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { rideId } = req.params;
    const rideIdStr = Array.isArray(rideId) ? rideId[0] : rideId;

    const { reason } = req.body;

    // Determine if user is passenger or driver
    const driver = await DriverModel.getByUserId(userId);
    const userType = driver ? 'driver' : 'passenger';

    const result = await RideService.cancelRide(userId, rideIdStr, userType, reason);
    return ApiResponseHandler.success(res, result, {
      message: result.message,
    });
  }

  // ============================================
  // SPLIT PAYMENT ENDPOINTS (NEW - Task 5)
  // ============================================

  /**
   * Initiate payment for a completed ride
   * POST /api/v1/rides/:rideId/pay
   * 
   * This endpoint initiates a split payment for a completed ride.
   * The payment is processed via Paystack with automatic split to:
   * - Driver subaccount (82.5%)
   * - PingRide subaccount (15%)
   * - Rebate subaccount (1.5%)
   */
  async payForRide(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    
    const { rideId } = req.params;
    const rideIdStr = Array.isArray(rideId) ? rideId[0] : rideId;
    
    try {
      // First, check if the ride is ready for payment
      const canPayResult = await RideService.canPayForRide(rideIdStr, userId);
      
      if (!canPayResult.canPay) {
        return ApiResponseHandler.validationError(
          res,
          canPayResult.message || 'Ride is not ready for payment'
        );
      }
      
      // Initialize split payment
      const result = await RideService.completeRideWithPayment(
        rideIdStr,
        userId
      );
      
      logger.info(`Payment initiated for ride ${rideIdStr} by user ${userId}`, {
        reference: result.payment.reference,
        amount: result.ride.bid_amount,
      });
      
      return ApiResponseHandler.success(res, {
        ride: {
          id: result.ride.id,
          status: result.ride.status,
          bid_amount: result.ride.bid_amount,
          driver_id: result.ride.driver_id,
          passenger_id: result.ride.passenger_id,
        },
        payment: {
          authorization_url: result.payment.authorization_url,
          reference: result.payment.reference,
          access_code: result.payment.access_code,
          payment_id: result.payment.payment_id,
        },
        message: 'Payment initiated. Please complete payment via Paystack.',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Payment initiation failed for ride ${rideIdStr}:`, error);
      
      return ApiResponseHandler.error(
        res,
        'PAYMENT_INIT_ERROR',
        `Failed to initiate payment: ${errorMessage}`,
        400
      );
    }
  }

  /**
   * Check if a ride is ready for payment
   * GET /api/v1/rides/:rideId/pay/check
   * 
   * This endpoint checks if a ride is ready for payment without initiating it.
   * Useful for UI to show payment button or status.
   */
  async checkPaymentEligibility(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    
    const { rideId } = req.params;
    const rideIdStr = Array.isArray(rideId) ? rideId[0] : rideId;
    
    try {
      const result = await RideService.canPayForRide(rideIdStr, userId);
      
      return ApiResponseHandler.success(res, {
        can_pay: result.canPay,
        message: result.message || null,
        ride_status: result.ride?.status || null,
        driver_has_subaccount: result.driverHasSubaccount || false,
        payment_exists: result.paymentExists || false,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Payment eligibility check failed for ride ${rideIdStr}:`, error);
      
      return ApiResponseHandler.error(
        res,
        'PAYMENT_CHECK_ERROR',
        `Failed to check payment eligibility: ${errorMessage}`,
        400
      );
    }
  }

  /**
   * Get payment status for a ride
   * GET /api/v1/rides/:rideId/payment-status
   * 
   * This endpoint returns the payment status for a ride.
   */
  async getPaymentStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    
    const { rideId } = req.params;
    const rideIdStr = Array.isArray(rideId) ? rideId[0] : rideId;
    
    try {
      // Verify ride ownership
      const ride = await RideService.getRide(rideIdStr);
      if (!ride) {
        return ApiResponseHandler.notFound(res, 'Ride not found');
      }
      
      // Check if user owns the ride
      const passenger = await DriverModel.getByUserId(userId);
      // If user is not a driver, check if they are the passenger
      if (!passenger) {
        // Check passenger ownership
        const passengerProfile = await (await import('../models/passenger.model')).PassengerModel.getProfile(userId);
        if (!passengerProfile || ride.passenger_id !== passengerProfile.id) {
          return ApiResponseHandler.forbidden(res, 'You do not own this ride');
        }
      } else {
        // User is a driver, check if they are the driver for this ride
        if (ride.driver_id !== passenger.id) {
          return ApiResponseHandler.forbidden(res, 'You do not own this ride');
        }
      }
      
      const paymentStatus = await RideService.getRidePaymentStatus(rideIdStr);
      
      return ApiResponseHandler.success(res, {
        ride_id: rideIdStr,
        has_payment: paymentStatus.hasPayment,
        payment_status: paymentStatus.paymentStatus || null,
        payment_id: paymentStatus.paymentId || null,
        amount: paymentStatus.amount || null,
        paid_at: paymentStatus.paidAt || null,
        reference: paymentStatus.reference || null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Payment status check failed for ride ${rideIdStr}:`, error);
      
      return ApiResponseHandler.error(
        res,
        'PAYMENT_STATUS_ERROR',
        `Failed to get payment status: ${errorMessage}`,
        400
      );
    }
  }

  /**
   * Get ride with payment status and incentive data
   * GET /api/v1/rides/:rideId/full
   * 
   * This endpoint returns full ride details including payment status and incentive data.
   */
  async getFullRideDetails(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    
    const { rideId } = req.params;
    const rideIdStr = Array.isArray(rideId) ? rideId[0] : rideId;
    
    try {
      const ride = await RideService.getRideWithIncentiveData(rideIdStr);
      if (!ride) {
        return ApiResponseHandler.notFound(res, 'Ride not found');
      }
      
      return ApiResponseHandler.success(res, ride);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to get full ride details for ${rideIdStr}:`, error);
      
      return ApiResponseHandler.error(
        res,
        'RIDE_DETAILS_ERROR',
        `Failed to get ride details: ${errorMessage}`,
        400
      );
    }
  }
}

export default RideController;