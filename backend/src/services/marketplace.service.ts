import { RideRequestModel } from '../models/ride-request.model';
import { RideBidModel } from '../models/ride-bid.model';
import { RideModel } from '../models/ride.model';
import { PassengerModel } from '../models/passenger.model';
import { DriverModel } from '../models/driver.model';
import { VehicleModel } from '../models/vehicle.model';
import BidEngineService from './bid-engine.service';
import { EventBus } from '../realtime/event.bus';
import { broadcastGeohashes } from '../realtime/driver-location';
import { ICreateRideRequest, ICreateBid } from '../types';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/error.middleware';
import logger from '../utils/logger';
import pool from '../config/database';

/**
 * Simple timezone lookup based on coordinates
 * For production, use a library like 'tz-lookup' or Google Maps Time Zone API
 * This function currently defaults to Africa/Lagos for testing
 */
function getTimezoneFromCoordinates(_lat: number, _lng: number): string {
  // For now, default to Africa/Lagos
  // In production, use: https://www.npmjs.com/package/tz-lookup
  // or Google Maps Time Zone API
  return 'Africa/Lagos';
}

export class MarketplaceService {
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
      return 30; // Default fallback
    } catch (error) {
      logger.error('Error fetching bidding window configuration:', error);
      return 30; // Fallback to 30 seconds on error
    }
  }

  static async requestRide(passengerUserId: string, data: ICreateRideRequest): Promise<any> {
    // Get passenger profile using user ID from JWT
    const passenger = await PassengerModel.getProfile(passengerUserId);
    if (!passenger) {
      throw new ValidationError('Passenger profile not found');
    }

    // Check if passenger has active ride
    const hasActive = await RideRequestModel.hasActiveRide(passengerUserId);
    if (hasActive) {
      throw new ConflictError('You already have an active ride request');
    }

    // Get timezone from pickup location (for IANA timezone support)
    const timezoneId = getTimezoneFromCoordinates(
      data.pickup_latitude,
      data.pickup_longitude
    );

    // Get bidding window from configuration
    const biddingWindowSeconds = await this.getBiddingWindowSeconds();

    // Create ride request using passenger_profiles.id
    const rideRequest = await RideRequestModel.create(passenger.id, data, biddingWindowSeconds);

    // Start bidding with the configured window.
    // startBidding does an UPDATE ... RETURNING *, so its return value is the
    // row with bidding_started_at and bidding_ends_at populated. The earlier
    // `rideRequest` object does not have those fields set (create() does not
    // write them), so we use bidStarted as the source of truth from here on.
    const bidStarted = await RideRequestModel.startBidding(rideRequest.id, biddingWindowSeconds);
    if (!bidStarted) {
      throw new ValidationError('Failed to start bidding window');
    }

    const broadcastResult = await BidEngineService.broadcastRide(bidStarted.id);

    // ============================================
    // REALTIME BROADCAST — emit ride:requested to every online driver
    // in the 9 geohash cells surrounding the pickup point.
    // ============================================
    // Geohash precision-5 cells are ~4.9km × 4.9km. Emitting to the
    // passenger's cell plus its 8 neighbours covers a ~15km × 15km
    // area — comfortably larger than the 5km search radius configured
    // in DRIVER_SEARCH_RADIUS_KM. A driver cannot be in two cells at
    // once, so no duplicate delivery occurs.
    const geohashes = broadcastGeohashes(
      bidStarted.pickup_latitude,
      bidStarted.pickup_longitude
    );
    const requestedPayload = {
      rideRequestId: bidStarted.id,
      pickup: {
        lat: bidStarted.pickup_latitude,
        lng: bidStarted.pickup_longitude,
        address: bidStarted.pickup_address,
      },
      dropoff: {
        lat: bidStarted.destination_latitude,
        lng: bidStarted.destination_longitude,
        address: bidStarted.destination_address,
      },
      distanceKm: bidStarted.estimated_distance_km,
      estimatedDurationMin: bidStarted.estimated_duration_min,
      biddingEndsAt: bidStarted.bidding_ends_at!.toISOString(),
    };
    for (const geohash of geohashes) {
      EventBus.emitToDriversNear(geohash, 'ride:requested', requestedPayload);
    }
    logger.info(
      `Ride request ${bidStarted.id} broadcast to ${geohashes.length} geohash cells ` +
      `(centre ${geohashes[0]})`
    );

    return {
      rideRequest: bidStarted,
      broadcast: broadcastResult,
      message: 'Ride request created successfully. Bidding window is open.',
      bidding_ends_at: bidStarted.bidding_ends_at,
      timezone: timezoneId,
    };
  }

  static async getRideRequestWithBids(rideRequestId: string): Promise<any> {
    const rideRequest = await RideRequestModel.getWithPassenger(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }

    const bids = await RideBidModel.getByRideRequest(rideRequestId);
    const rankedBids = await BidEngineService.rankBids(rideRequestId);

    return {
      rideRequest,
      bids: rankedBids.length > 0 ? rankedBids : bids,
      total_bids: bids.length,
    };
  }

  static async submitBid(driverId: string, data: ICreateBid): Promise<any> {
    // Validate the bid using BidEngineService
    const validation = await BidEngineService.validateBid(
      data.ride_request_id,
      driverId,
      data.bid_amount,
      data.eta_minutes
    );

    if (!validation.valid) {
      // Join all errors into a single message
      throw new ValidationError(validation.errors.join(', '));
    }

    // Create the bid
    const bid = await RideBidModel.create(data);

    logger.info(`Bid submitted: ${bid.id} for ride ${data.ride_request_id} by driver ${driverId}`);

    // ============================================
    // REALTIME — emit ride:bid_received to the passenger's user room.
    // ============================================
    // Non-blocking. If any lookup or emit fails, the bid is still recorded
    // in the DB and the driver still gets a success response. The passenger
    // app can always fetch bids via GET /marketplace/requests/:id — the
    // socket event is an accelerator, not the source of truth.
    try {
      // 1. Resolve the passenger's userId (the room target).
      //    ride_requests.passenger_id is passenger_profiles.id, not users.id.
      const passengerRow = await pool.query(
        'SELECT user_id FROM passenger_profiles WHERE id = $1',
        [(await RideRequestModel.getById(data.ride_request_id))?.passenger_id]
      );
      const passengerUserId: string | undefined = passengerRow.rows[0]?.user_id;

      if (!passengerUserId) {
        logger.warn(
          `submitBid: passenger userId not found for ride_request ${data.ride_request_id} — skipping bid_received emit`
        );
      } else {
        // 2. Load driver + vehicle for the display payload.
        const driver = await DriverModel.getById(driverId);
        const vehicle = await VehicleModel.getPrimary(driverId);

        // 3. Build the payload to match BidReceivedPayload in events.ts.
        const payload = {
          bidId: bid.id,
          rideRequestId: data.ride_request_id,
          driverId: driverId,
          driverDisplayName: driver
            ? `${driver.first_name} ${driver.last_name}`.trim()
            : 'Driver',
          driverRating: driver?.rating_average != null
            ? parseFloat(String(driver.rating_average))
            : null,
          vehicleType: vehicle?.vehicle_type ?? 'standard',
          vehicleMake: vehicle?.make ?? null,
          vehicleModel: vehicle?.model ?? null,
          vehicleRegistration: vehicle?.registration_number ?? null,
          bidAmount: parseFloat(String(bid.bid_amount)),
          etaMinutes: bid.eta_minutes,
          expiresAt: (
            (await RideRequestModel.getById(data.ride_request_id))?.bidding_ends_at ??
            new Date()
          ).toISOString(),
        };

        EventBus.emitToUser(passengerUserId, 'ride:bid_received', payload);
        logger.debug(
          `Emitted ride:bid_received → user:${passengerUserId} (bid ${bid.id})`
        );
      }
    } catch (emitErr) {
      const msg = emitErr instanceof Error ? emitErr.message : 'Unknown error';
      logger.error(
        `submitBid: failed to emit ride:bid_received for bid ${bid.id}: ${msg}`
      );
    }

    return {
      bid,
      message: 'Bid submitted successfully',
    };
  }

  static async selectBid(
    passengerUserId: string,
    rideRequestId: string,
    bidId: string
  ): Promise<any> {
    const passenger = await PassengerModel.getProfile(passengerUserId);
    if (!passenger) {
      throw new ValidationError('Passenger profile not found');
    }

    const rideRequest = await RideRequestModel.getById(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }
    if (rideRequest.passenger_id !== passenger.id) {
      throw new ValidationError('You do not own this ride request');
    }
    if (rideRequest.status !== 'bidding') {
      throw new ValidationError('Ride request is not in bidding state');
    }

    // FIXED: Use Date comparison with UTC timestamps
    if (rideRequest.bidding_ends_at && new Date() > new Date(rideRequest.bidding_ends_at)) {
      throw new ValidationError('Bidding window has closed');
    }

    const bid = await RideBidModel.getById(bidId);
    if (!bid) {
      throw new NotFoundError('Bid not found');
    }
    // FIXED: Use ride_id instead of ride_request_id
    if (bid.ride_id !== rideRequestId) {
      throw new ValidationError('Bid does not belong to this ride request');
    }
    if (bid.status !== 'pending') {
      throw new ValidationError('Bid is no longer available');
    }

    const result = await RideBidModel.selectBid(rideRequestId, bidId);

    await RideRequestModel.updateStatus(rideRequestId, 'assigned', {
      selected_driver_id: bid.driver_id,
      selected_bid_id: bidId,
    });

    const ride = await RideModel.createFromBid(
      rideRequestId,
      passenger.id,
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

    logger.info(`Bid selected: ${bidId} for ride ${rideRequestId}`);

    return {
      ride,
      selectedBid: result.selected,
      rejectedBids: result.rejected,
      message: 'Driver selected successfully',
    };
  }

  /**
   * Cancel a ride request (passenger, own request only).
   *
   * Only cancellable while status is 'pending' or 'bidding'. Once a bid is
   * selected (status='assigned'), the ride exists and cancellation must go
   * through RideService.cancelRide instead.
   *
   * @param passengerUserId  users.id of the requester
   * @param rideRequestId    ride_requests.id
   * @param reason           optional free-text reason
   */
  static async cancelRideRequest(
    passengerUserId: string,
    rideRequestId: string,
    reason?: string
  ): Promise<any> {
    // 1. Load passenger profile (maps users.id -> passenger_profiles.id)
    const passenger = await PassengerModel.getProfile(passengerUserId);
    if (!passenger) {
      throw new ValidationError('Passenger profile not found');
    }

    // 2. Load the ride request
    const rideRequest = await RideRequestModel.getById(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }

    // 3. Ownership check
    if (rideRequest.passenger_id !== passenger.id) {
      throw new ValidationError('You do not own this ride request');
    }

    // 4. State check — only pending or bidding can be cancelled here
    if (rideRequest.status !== 'pending' && rideRequest.status !== 'bidding') {
      throw new ValidationError(
        `Ride request cannot be cancelled in ${rideRequest.status} state`
      );
    }

    // 5. Update — RideRequestModel.updateStatus handles cancelled_by
    //    and cancelled_at as a side effect when cancelled_by is set.
    const updated = await RideRequestModel.updateStatus(rideRequestId, 'cancelled', {
      cancelled_by: 'passenger',
      cancellation_reason: reason || 'Cancelled by passenger',
    });

    if (!updated) {
      throw new ValidationError('Failed to cancel ride request');
    }

    logger.info(
      `Ride request cancelled: ${rideRequestId} by passenger ${passenger.id}` +
      (reason ? ` — ${reason}` : '')
    );

    return {
      rideRequest: updated,
      message: 'Ride request cancelled successfully',
    };
  }

  static async getActiveRideForPassenger(passengerUserId: string): Promise<any> {
    const activeRequests = await RideRequestModel.getActiveByPassenger(passengerUserId);
    if (activeRequests.length === 0) {
      return null;
    }

    const rideRequest = activeRequests[0];
    const bids = await RideBidModel.getByRideRequest(rideRequest.id);

    return {
      rideRequest,
      bids,
    };
  }

  static async getActiveRideForDriver(driverId: string): Promise<any> {
    const activeRides = await RideModel.getActiveByDriver(driverId);
    if (activeRides.length === 0) {
      return null;
    }

    const ride = activeRides[0];
    const rideWithDetails = await RideModel.getWithDetails(ride.id);

    return rideWithDetails;
  }

  static async autoExpireRideRequests(): Promise<number> {
    const expiredCount = await RideRequestModel.expireExpiredRequests();
    if (expiredCount > 0) {
      logger.info(`Auto-expired ${expiredCount} ride requests`);
    }
    return expiredCount;
  }

  static async handleNoBids(rideRequestId: string): Promise<void> {
    const rideRequest = await RideRequestModel.getById(rideRequestId);
    if (!rideRequest) {
      return;
    }

    if (rideRequest.status === 'bidding') {
      const hasBids = await BidEngineService.hasBids(rideRequestId);
      if (!hasBids) {
        await RideRequestModel.updateStatus(rideRequestId, 'expired');
        logger.info(`Ride request ${rideRequestId} expired due to no bids`);
      }
    }
  }
}

export default MarketplaceService;