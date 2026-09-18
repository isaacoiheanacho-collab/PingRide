import { RideRequestModel } from '../models/ride-request.model';
import { RideBidModel } from '../models/ride-bid.model';
import { RideModel } from '../models/ride.model';
import { DriverModel } from '../models/driver.model';
import { PassengerModel } from '../models/passenger.model';
import { UserModel } from '../models/user.model';
import { PaymentModel } from '../models/payment.model';
import { PaymentService } from './payment.service';
import { ICreateRideRequest, ICreateBid, IRideStatusUpdate, IRide } from '../types';
import { ISplitPaymentResponse } from '../types/payment.types';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/error.middleware';
import logger from '../utils/logger';
import pool from '../config/database';

export class RideService {
  /**
   * Get bidding window seconds from database configuration
   */
  static async getBiddingWindowSeconds(): Promise<number> {
    try {
      const result = await pool.query(
        "SELECT value FROM platform_configuration WHERE key = 'bidding_window_seconds'"
      );

      if (result.rows.length > 0) {
        const config = result.rows[0].value;
        const parsedConfig = typeof config === 'string' ? JSON.parse(config) : config;
        return parsedConfig.default || 30;
      }
      return 30;
    } catch (error) {
      logger.error('Error fetching bidding window configuration:', error);
      return 30;
    }
  }

  /**
   * Create a ride request
   */
  static async createRideRequest(
    passengerId: string,
    data: ICreateRideRequest
  ): Promise<any> {
    // Check if passenger has active ride
    const hasActive = await RideRequestModel.hasActiveRide(passengerId);
    if (hasActive) {
      throw new ConflictError('You already have an active ride request');
    }

    // Get passenger profile
    const passenger = await PassengerModel.getProfile(passengerId);
    if (!passenger) {
      throw new ValidationError('Passenger profile not found');
    }

    // Get bidding window from configuration
    const biddingWindowSeconds = await this.getBiddingWindowSeconds();

    // Create ride request
    const rideRequest = await RideRequestModel.create(passengerId, data, biddingWindowSeconds);

    // Start bidding window
    await RideRequestModel.startBidding(rideRequest.id, biddingWindowSeconds);

    logger.info(`Ride request created: ${rideRequest.id} for passenger: ${passengerId}`);

    return {
      rideRequest,
      message: 'Ride request created successfully. Bidding window is open.',
      bidding_ends_at: rideRequest.bidding_ends_at,
    };
  }

  /**
   * Get ride request by ID
   */
  static async getRideRequest(rideRequestId: string): Promise<any> {
    const rideRequest = await RideRequestModel.getById(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }
    return rideRequest;
  }

  /**
   * Get ride request with passenger info
   */
  static async getRideRequestWithPassenger(rideRequestId: string): Promise<any> {
    const rideRequest = await RideRequestModel.getWithPassenger(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }
    return rideRequest;
  }

  /**
   * Get bids for a ride request
   */
  static async getBids(rideRequestId: string): Promise<any[]> {
    const rideRequest = await RideRequestModel.getById(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }

    return RideBidModel.getByRideRequest(rideRequestId);
  }

  /**
   * Submit a bid
   */
  static async submitBid(
    driverId: string,
    data: ICreateBid
  ): Promise<any> {
    // Check if driver is active and approved
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }
    if (driver.kyc_status !== 'approved') {
      throw new ValidationError('KYC not approved');
    }
    if (driver.driver_status !== 'active') {
      throw new ValidationError('Driver not active');
    }

    // Check if ride request exists and is in bidding state
    const rideRequest = await RideRequestModel.getById(data.ride_request_id);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }
    if (rideRequest.status !== 'bidding') {
      throw new ValidationError('Ride request is not in bidding state');
    }

    // Check if bidding window is still open
    if (rideRequest.bidding_ends_at && new Date() > new Date(rideRequest.bidding_ends_at)) {
      throw new ValidationError('Bidding window has closed');
    }

    // Check if driver already submitted a bid
    const existing = await RideBidModel.getByDriverAndRide(data.ride_request_id, driverId);
    if (existing) {
      throw new ConflictError('You already submitted a bid for this ride');
    }

    // Create bid
    const bid = await RideBidModel.create(data);
    logger.info(`Bid submitted: ${bid.id} for ride: ${data.ride_request_id}`);

    return {
      bid,
      message: 'Bid submitted successfully',
      expires_at: rideRequest.bidding_ends_at,
    };
  }

  /**
   * Select a bid (passenger selects driver)
   */
  static async selectBid(
    passengerId: string,
    rideRequestId: string,
    bidId: string
  ): Promise<any> {
    // Verify passenger owns the ride request
    const rideRequest = await RideRequestModel.getById(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }
    if (rideRequest.passenger_id !== passengerId) {
      throw new ValidationError('You do not own this ride request');
    }
    if (rideRequest.status !== 'bidding') {
      throw new ValidationError('Ride request is not in bidding state');
    }

    // Check if bidding window is still open
    if (rideRequest.bidding_ends_at && new Date() > new Date(rideRequest.bidding_ends_at)) {
      throw new ValidationError('Bidding window has closed');
    }

    // Get bid details
    const bid = await RideBidModel.getById(bidId);
    if (!bid) {
      throw new NotFoundError('Bid not found');
    }
    // Use ride_id (DB column) rather than ride_request_id
    if (bid.ride_id !== rideRequestId) {
      throw new ValidationError('Bid does not belong to this ride request');
    }
    if (bid.status !== 'pending') {
      throw new ValidationError('Bid is no longer available');
    }

    // Select the bid (accept selected, reject others)
    const result = await RideBidModel.selectBid(rideRequestId, bidId);

    // Update ride request status
    await RideRequestModel.updateStatus(rideRequestId, 'assigned', {
      selected_driver_id: bid.driver_id,
      selected_bid_id: bidId,
    });

    // Create the actual ride from the selected bid
    const ride = await RideModel.createFromBid(
      rideRequestId,
      passengerId,
      bid.driver_id,
      bidId,
      bid.bid_amount,
      rideRequest.pickup_latitude,
      rideRequest.pickup_longitude,
      rideRequest.pickup_address,
      rideRequest.destination_latitude,
      rideRequest.destination_longitude,
      rideRequest.destination_address
    );

    logger.info(`Bid selected: ${bidId} for ride: ${rideRequestId}`);

    return {
      ride,
      selectedBid: result.selected,
      rejectedBids: result.rejected,
      message: 'Driver selected successfully',
    };
  }

  /**
   * Update ride status (driver side)
   *
   * On 'ride_completed', updates driver stats, passenger ride count, and
   * passenger lifetime spend.
   *
   * Qualification + rebate tracking is NOT done here. It is deferred to
   * PaymentService.trackRideForQualification(), which fires when the ride
   * payment succeeds (via split payment or wallet). This prevents
   * double-counting the same ride into passenger/driver qualification
   * registries and the rebate fund.
   */
  static async updateRideStatus(
    driverId: string,
    rideId: string,
    statusData: IRideStatusUpdate
  ): Promise<any> {
    // Get ride
    const ride = await RideModel.getById(rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found');
    }
    if (ride.driver_id !== driverId) {
      throw new ValidationError('You do not own this ride');
    }

    // Validate status transition to match database CHECK constraint
    const validTransitions: Record<string, string[]> = {
      'confirmed': ['driver_en_route', 'cancelled'],
      'driver_en_route': ['driver_arrived', 'cancelled'],
      'driver_arrived': ['ride_started', 'cancelled'],
      'ride_started': ['ride_in_progress', 'cancelled'],
      'ride_in_progress': ['ride_completed', 'cancelled'],
      'ride_completed': [],
      'cancelled': [],
      'failed': [],
      'expired': [],
      'requested': ['confirmed', 'cancelled'],
      'bidding': ['confirmed', 'cancelled'],
      'bid_selected': ['confirmed', 'cancelled'],
    };

    const allowed = validTransitions[ride.status] || [];
    if (!allowed.includes(statusData.status)) {
      throw new ValidationError(`Invalid status transition from ${ride.status} to ${statusData.status}`);
    }

    // Update ride status
    const updatedRide = await RideModel.updateStatus(rideId, statusData.status);

    // ============================================
    // RIDE COMPLETION — STATS ONLY
    // ============================================
    if (statusData.status === 'ride_completed') {
      // Update driver earnings aggregate
      await DriverModel.incrementRideStats(driverId, ride.bid_amount || 0);

      // ride.passenger_id is a passenger_profiles.id.
      // PassengerModel.incrementRideCount / updateLifetimeSpend filter on
      // users.id, so we resolve the profile row first to get its user_id.
      const passengerRow = await pool.query(
        'SELECT user_id FROM passenger_profiles WHERE id = $1',
        [ride.passenger_id]
      );

      if (passengerRow.rows.length === 0) {
        logger.error(
          `Ride ${rideId} completed but passenger profile ${ride.passenger_id} not found — passenger stats not updated`
        );
      } else {
        const passengerUserId = passengerRow.rows[0].user_id;
        await PassengerModel.incrementRideCount(passengerUserId);
        await PassengerModel.updateLifetimeSpend(passengerUserId, ride.bid_amount || 0);
      }

      // Qualification, rebate contribution, and programme-period association
      // are handled by PaymentService when the ride payment succeeds. Do not
      // duplicate them here.
      logger.debug(
        `Ride ${rideId} completed — qualification and rebate tracking deferred to PaymentService`
      );
    }
    // ============================================

    logger.info(`Ride status updated: ${rideId} -> ${statusData.status}`);

    return updatedRide;
  }

  /**
   * Get ride by ID with details
   */
  static async getRide(rideId: string): Promise<any> {
    const ride = await RideModel.getWithDetails(rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found');
    }
    return ride;
  }

  /**
   * Get active rides for driver
   */
  static async getActiveRidesForDriver(driverId: string): Promise<any[]> {
    return RideModel.getActiveByDriver(driverId);
  }

  /**
   * Get active rides for passenger
   */
  static async getActiveRidesForPassenger(passengerId: string): Promise<any[]> {
    return RideModel.getActiveByPassenger(passengerId);
  }

  /**
   * Get ride history for passenger
   */
  static async getRideHistoryForPassenger(
    passengerId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const offset = (page - 1) * limit;
    const result = await RideModel.getHistoryByPassenger(passengerId, limit, offset);
    return {
      rides: result.rides,
      pagination: {
        page,
        limit,
        total: result.total,
        pages: Math.ceil(result.total / limit),
      },
    };
  }

  /**
   * Cancel ride
   */
  static async cancelRide(
    userId: string,
    rideId: string,
    userType: 'passenger' | 'driver',
    reason?: string
  ): Promise<any> {
    const ride = await RideModel.getById(rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found');
    }

    // Verify ownership
    if (userType === 'passenger' && ride.passenger_id !== userId) {
      throw new ValidationError('You do not own this ride');
    }
    if (userType === 'driver' && ride.driver_id !== userId) {
      throw new ValidationError('You do not own this ride');
    }

    // Check if ride can be cancelled
    const cancellableStatuses = ['confirmed', 'driver_en_route', 'driver_arrived', 'ride_started', 'ride_in_progress'];
    if (!cancellableStatuses.includes(ride.status)) {
      throw new ValidationError(`Ride cannot be cancelled in ${ride.status} state`);
    }

    // Update ride status
    const updatedRide = await RideModel.updateStatus(rideId, 'cancelled');

    // Update ride request status
    await RideRequestModel.updateStatus(ride.ride_request_id, 'cancelled', {
      cancelled_by: userType,
      cancellation_reason: reason || 'Cancelled by ' + userType,
    });

    // Mark ride as NOT eligible for qualification on cancellation
    if (ride.programme_period_id) {
      await pool.query(
        `UPDATE rides 
         SET ride_eligible_for_qualification = false,
             qualification_exclusion_reason = 'Cancelled by ' || $1,
             updated_at = NOW()
         WHERE id = $2`,
        [userType, rideId]
      );
    }

    logger.info(`Ride cancelled: ${rideId} by ${userType}`);

    return {
      ride: updatedRide,
      message: 'Ride cancelled successfully',
    };
  }

  // ============================================
  // SPLIT PAYMENT METHODS
  // ============================================

  /**
   * Complete a ride and initiate split payment
   */
  static async completeRideWithPayment(
    rideId: string,
    passengerUserId: string
  ): Promise<{
    ride: IRide;
    payment: ISplitPaymentResponse;
  }> {
    // 1. Get ride details
    const ride = await RideModel.getWithDetails(rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found');
    }

    // 2. Verify ride is in completed state
    if (ride.status !== 'ride_completed') {
      throw new ValidationError('Ride must be completed before payment');
    }

    // 3. Check if payment already exists
    const existingPayment = await PaymentModel.getByRideId(rideId);
    if (existingPayment && existingPayment.status === 'paid') {
      throw new ConflictError('Ride already paid');
    }

    // 4. Get passenger email
    const passenger = await PassengerModel.getProfile(passengerUserId);
    if (!passenger) {
      throw new NotFoundError('Passenger profile not found');
    }

    const user = await UserModel.findById(passengerUserId);
    if (!user?.email) {
      throw new ValidationError('Passenger email required for payment');
    }

    // 5. Get driver details to verify subaccount
    const driver = await DriverModel.getById(ride.driver_id);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }

    if (!driver.subaccount_code || driver.subaccount_status !== 'active') {
      throw new ValidationError('Driver does not have an active subaccount. Please contact support.');
    }

    // 6. Initialize split payment
    const paymentResult = await PaymentService.initializeSplitPayment({
      ride_id: rideId,
      passenger_id: ride.passenger_id,
      driver_id: ride.driver_id,
      amount: ride.bid_amount || 0,
      passenger_email: user.email,
    });

    logger.info(`Split payment initiated for ride ${rideId}`, {
      rideId,
      passengerId: ride.passenger_id,
      driverId: ride.driver_id,
      amount: ride.bid_amount,
      reference: paymentResult.reference,
    });

    return {
      ride,
      payment: paymentResult,
    };
  }

  /**
   * Check if a ride is ready for payment
   */
  static async canPayForRide(
    rideId: string,
    passengerUserId: string
  ): Promise<{
    canPay: boolean;
    message?: string;
    ride?: IRide;
    driverHasSubaccount?: boolean;
    paymentExists?: boolean;
  }> {
    try {
      // 1. Get ride details
      const ride = await RideModel.getWithDetails(rideId);
      if (!ride) {
        return { canPay: false, message: 'Ride not found' };
      }

      // 2. Verify passenger owns the ride
      const passenger = await PassengerModel.getProfile(passengerUserId);
      if (!passenger || ride.passenger_id !== passenger.id) {
        return { canPay: false, message: 'You do not own this ride' };
      }

      // 3. Verify ride is completed
      if (ride.status !== 'ride_completed') {
        return {
          canPay: false,
          message: `Ride must be completed before payment. Current status: ${ride.status}`,
          ride,
        };
      }

      // 4. Check if payment already exists
      const existingPayment = await PaymentModel.getByRideId(rideId);
      if (existingPayment && existingPayment.status === 'paid') {
        return {
          canPay: false,
          message: 'Ride already paid',
          ride,
          paymentExists: true,
        };
      }

      // 5. Check driver subaccount
      const driver = await DriverModel.getById(ride.driver_id);
      if (!driver) {
        return {
          canPay: false,
          message: 'Driver not found',
          ride,
        };
      }

      const driverHasSubaccount = !!(driver.subaccount_code && driver.subaccount_status === 'active');
      if (!driverHasSubaccount) {
        return {
          canPay: false,
          message: 'Driver does not have an active subaccount. Please contact support.',
          ride,
          driverHasSubaccount: false,
        };
      }

      return {
        canPay: true,
        ride,
        driverHasSubaccount: true,
        paymentExists: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error checking ride payment eligibility: ${rideId}`, { error: message });
      return { canPay: false, message: `Failed to check payment eligibility: ${message}` };
    }
  }

  /**
   * Get payment status for a ride
   */
  static async getRidePaymentStatus(rideId: string): Promise<{
    hasPayment: boolean;
    paymentStatus?: string;
    paymentId?: string;
    amount?: number;
    paidAt?: Date;
    reference?: string;
  }> {
    const payment = await PaymentModel.getByRideId(rideId);

    if (!payment) {
      return { hasPayment: false };
    }

    return {
      hasPayment: true,
      paymentStatus: payment.status,
      paymentId: payment.id,
      amount: payment.amount,
      paidAt: payment.paid_at || undefined,
      reference: payment.gateway_reference || undefined,
    };
  }

  /**
   * V2.0: Check if a ride is eligible for qualification
   */
  static async isRideEligibleForQualification(rideId: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT ride_eligible_for_qualification 
       FROM rides 
       WHERE id = $1`,
      [rideId]
    );
    return result.rows[0]?.ride_eligible_for_qualification !== false;
  }

  /**
   * V2.0: Update ride qualification eligibility
   */
  static async updateRideEligibility(
    rideId: string,
    eligible: boolean,
    reason?: string
  ): Promise<void> {
    await pool.query(
      `UPDATE rides 
       SET ride_eligible_for_qualification = $1,
           qualification_exclusion_reason = CASE 
             WHEN $1 = false AND $2 IS NOT NULL THEN $2 
             WHEN $1 = false THEN 'Excluded by admin' 
             ELSE NULL 
           END,
           updated_at = NOW()
       WHERE id = $3`,
      [eligible, reason || null, rideId]
    );
    logger.info(`Ride ${rideId} eligibility updated to ${eligible}`);
  }

  /**
   * V2.0: Get ride with incentive data
   */
  static async getRideWithIncentiveData(rideId: string): Promise<any> {
    const ride = await RideModel.getWithDetails(rideId);
    if (!ride) {
      throw new NotFoundError('Ride not found');
    }

    // Get programme period details
    let programmePeriod = null;
    if (ride.programme_period_id) {
      const { ProgrammePeriodModel } = await import('../models/programme-period.model');
      programmePeriod = await ProgrammePeriodModel.getById(ride.programme_period_id);
    }

    // Get payment status
    const paymentStatus = await this.getRidePaymentStatus(rideId);

    return {
      ...ride,
      programme_period: programmePeriod,
      payment: paymentStatus,
    };
  }
}

export default RideService;