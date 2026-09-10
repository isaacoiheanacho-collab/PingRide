import { RideRequestModel } from '../models/ride-request.model';
import { RideBidModel } from '../models/ride-bid.model';
import { DriverModel } from '../models/driver.model';
import { IRideBid } from '../types';
import { ValidationError, NotFoundError } from '../middleware/error.middleware';
import logger from '../utils/logger';

export class BidEngineService {
  /**
   * Broadcast ride request to eligible drivers
   */
  static async broadcastRide(rideRequestId: string): Promise<{ driversNotified: number; drivers: any[] }> {
    const rideRequest = await RideRequestModel.getById(rideRequestId);
    if (!rideRequest) {
      throw new NotFoundError('Ride request not found');
    }

    if (rideRequest.status !== 'bidding') {
      throw new ValidationError('Ride request is not in bidding state');
    }

    const eligibleDrivers = await this.getEligibleDrivers(
      rideRequest.pickup_latitude,
      rideRequest.pickup_longitude,
      5
    );

    logger.info(`Broadcasting ride ${rideRequestId} to ${eligibleDrivers.length} eligible drivers`);

    return {
      driversNotified: eligibleDrivers.length,
      drivers: eligibleDrivers,
    };
  }

  /**
   * Get eligible drivers for a ride
   */
  static async getEligibleDrivers(
    latitude: number,
    longitude: number,
    radiusKm: number = 5
  ): Promise<any[]> {
    const drivers = await DriverModel.getDriversNear(latitude, longitude, radiusKm);
    
    const eligibleDrivers = drivers.filter(driver => {
      if (!driver.is_online) return false;
      if (driver.driver_status !== 'active') return false;
      if (driver.kyc_status !== 'approved') return false;
      return true;
    });

    return eligibleDrivers;
  }

  /**
   * Validate bid against rules
   */
  static async validateBid(
    rideRequestId: string,
    driverId: string,
    bidAmount: number,
    etaMinutes: number
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const rideRequest = await RideRequestModel.getById(rideRequestId);
    
    if (!rideRequest) {
      errors.push('Ride request not found');
      return { valid: false, errors };
    }

    // Debug logging to see what's happening
    logger.debug('Bid validation - rideRequest:', {
      id: rideRequest.id,
      status: rideRequest.status,
      bidding_ends_at: rideRequest.bidding_ends_at,
      bidding_ends_at_type: typeof rideRequest.bidding_ends_at,
      bidding_ends_at_is_date: rideRequest.bidding_ends_at instanceof Date,
      bidding_ends_at_value: rideRequest.bidding_ends_at ? rideRequest.bidding_ends_at.toISOString() : null
    });

    if (rideRequest.status !== 'bidding') {
      errors.push('Ride request is not in bidding state');
    }

    // FIXED: Proper date comparison with timezone handling
    if (rideRequest.bidding_ends_at) {
      // Ensure we have a Date object
      const endDate = rideRequest.bidding_ends_at instanceof Date 
        ? rideRequest.bidding_ends_at 
        : new Date(rideRequest.bidding_ends_at);
      
      const now = new Date();
      
      // Debug logging
      logger.debug('Date comparison:', {
        now: now.toISOString(),
        now_timestamp: now.getTime(),
        endDate: endDate.toISOString(),
        endDate_timestamp: endDate.getTime(),
        isExpired: now.getTime() > endDate.getTime(),
        timeDiffSeconds: (endDate.getTime() - now.getTime()) / 1000
      });
      
      // Compare using timestamps to avoid timezone issues
      if (now.getTime() > endDate.getTime()) {
        errors.push('Bidding window has closed');
      }
    } else {
      // If bidding_ends_at is null, the window hasn't been started properly
      errors.push('Bidding window has not been started');
    }

    if (bidAmount < 0) {
      errors.push('Bid amount must be greater than 0');
    }

    if (etaMinutes < 1 || etaMinutes > 120) {
      errors.push('ETA must be between 1 and 120 minutes');
    }

    const existingBid = await RideBidModel.getByDriverAndRide(rideRequestId, driverId);
    if (existingBid && existingBid.status === 'pending') {
      errors.push('Driver already submitted a bid for this ride');
    }

    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      errors.push('Driver not found');
    } else {
      if (driver.kyc_status !== 'approved') {
        errors.push('Driver KYC not approved');
      }
      if (driver.driver_status !== 'active') {
        errors.push('Driver not active');
      }
      if (!driver.is_online) {
        errors.push('Driver is offline');
      }
    }

    logger.debug('Bid validation result:', { valid: errors.length === 0, errors });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Rank bids using algorithm
   */
  static async rankBids(rideRequestId: string): Promise<IRideBid[]> {
    // ✅ Use type assertion to include driver_rating
    const bids = await RideBidModel.getByRideRequest(rideRequestId) as (IRideBid & { driver_rating?: number })[];
    
    const pendingBids = bids.filter(bid => bid.status === 'pending');
    
    if (pendingBids.length === 0) {
      return [];
    }

    const maxBid = Math.max(...pendingBids.map(b => b.bid_amount));
    const minBid = Math.min(...pendingBids.map(b => b.bid_amount));
    const maxEta = Math.max(...pendingBids.map(b => b.eta_minutes));
    const minEta = Math.min(...pendingBids.map(b => b.eta_minutes));

    const rankedBids = pendingBids.map((bid) => {
      // Score components (0-1 scale)
      const fareScore = maxBid === minBid ? 0.5 : 1 - ((bid.bid_amount - minBid) / (maxBid - minBid));
      const etaScore = maxEta === minEta ? 0.5 : 1 - ((bid.eta_minutes - minEta) / (maxEta - minEta));
      
      // ✅ driver_rating now exists on the type
      const driverRating = bid.driver_rating || 4.0;
      const ratingScore = driverRating / 5;
      
      const weights = {
        fare: 0.40,
        eta: 0.25,
        rating: 0.20,
        vehicle: 0.10,
        acceptance: 0.05,
      };
      
      const score = (
        (fareScore * weights.fare) +
        (etaScore * weights.eta) +
        (ratingScore * weights.rating) +
        (0.5 * weights.vehicle) +
        (0.5 * weights.acceptance)
      );

      return {
        ...bid,
        score,
        rank: 0,
      };
    });

    // Sort by score descending
    rankedBids.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Assign ranks
    rankedBids.forEach((bid, index) => {
      bid.rank = index + 1;
    });

    // Update ranks in database
    for (const bid of rankedBids) {
      await RideBidModel.updateStatus(bid.id, bid.status, { rank: bid.rank });
    }

    logger.info(`Ranked ${rankedBids.length} bids for ride ${rideRequestId}`);

    return rankedBids;
  }

  /**
   * Expire bids for a ride
   */
  static async expireBids(rideRequestId: string): Promise<number> {
    const expiredCount = await RideBidModel.expireAll(rideRequestId);
    if (expiredCount > 0) {
      logger.info(`Expired ${expiredCount} bids for ride ${rideRequestId}`);
    }
    return expiredCount;
  }

  /**
   * Check if ride has any bids
   */
  static async hasBids(rideRequestId: string): Promise<boolean> {
    const bids = await RideBidModel.getActiveByRideRequest(rideRequestId);
    return bids.length > 0;
  }

  /**
   * Get best bid for a ride (lowest fare, highest rating combination)
   */
  static async getBestBid(rideRequestId: string): Promise<IRideBid | null> {
    // ✅ Use type assertion to include driver_rating
    const bids = await RideBidModel.getActiveByRideRequest(rideRequestId) as (IRideBid & { driver_rating?: number })[];
    
    if (bids.length === 0) {
      return null;
    }

    bids.sort((a, b) => {
      if (a.bid_amount !== b.bid_amount) {
        return a.bid_amount - b.bid_amount;
      }
      // ✅ driver_rating now exists
      return (b.driver_rating || 0) - (a.driver_rating || 0);
    });

    return bids[0] || null;
  }
}

export default BidEngineService;