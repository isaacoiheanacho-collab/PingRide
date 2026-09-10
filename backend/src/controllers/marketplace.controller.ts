import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import MarketplaceService from '../services/marketplace.service';
import { DriverModel } from '../models/driver.model';

export class MarketplaceController {
  async requestRide(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const {
      pickup_latitude, pickup_longitude, pickup_address,
      destination_latitude, destination_longitude, destination_address,
      vehicle_type,
    } = req.body;

    const result = await MarketplaceService.requestRide(userId, {
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

  async getRideRequestWithBids(req: Request, res: Response): Promise<Response> {
    const { rideRequestId } = req.params;
    const rideRequestIdStr = Array.isArray(rideRequestId) ? rideRequestId[0] : rideRequestId;

    const result = await MarketplaceService.getRideRequestWithBids(rideRequestIdStr);
    return ApiResponseHandler.success(res, result);
  }

  async submitBid(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const { ride_request_id, bid_amount, eta_minutes, driver_notes } = req.body;

    const result = await MarketplaceService.submitBid(driver.id, {
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

  async selectBid(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { rideRequestId, bidId } = req.params;
    const rideRequestIdStr = Array.isArray(rideRequestId) ? rideRequestId[0] : rideRequestId;
    const bidIdStr = Array.isArray(bidId) ? bidId[0] : bidId;

    const result = await MarketplaceService.selectBid(userId, rideRequestIdStr, bidIdStr);
    return ApiResponseHandler.success(res, result, {
      message: result.message,
    });
  }

  async getActiveRideForPassenger(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const result = await MarketplaceService.getActiveRideForPassenger(userId);
    if (!result) {
      return ApiResponseHandler.success(res, { active: false, message: 'No active ride found' });
    }

    return ApiResponseHandler.success(res, { active: true, ...result });
  }

  async getActiveRideForDriver(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.validationError(res, 'Driver profile not found');
    }

    const result = await MarketplaceService.getActiveRideForDriver(driver.id);
    if (!result) {
      return ApiResponseHandler.success(res, { active: false, message: 'No active ride found' });
    }

    return ApiResponseHandler.success(res, { active: true, ...result });
  }

  async getEligibleDrivers(req: Request, res: Response): Promise<Response> {
    const { latitude, longitude, radius } = req.query;
    
    if (!latitude || !longitude) {
      return ApiResponseHandler.validationError(res, 'Latitude and longitude are required');
    }

    const { BidEngineService } = await import('../services/bid-engine.service');
    const drivers = await BidEngineService.getEligibleDrivers(
      parseFloat(latitude as string),
      parseFloat(longitude as string),
      radius ? parseFloat(radius as string) : 5
    );

    return ApiResponseHandler.success(res, {
      drivers,
      count: drivers.length,
    });
  }
}

export default MarketplaceController;