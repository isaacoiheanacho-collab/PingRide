import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { VehicleComplianceService } from '../services/vehicle-compliance.service';
import { ConsentService } from '../services/consent.service';
import logger from '../utils/logger';

export class OnboardingVehicleController {
  /**
   * POST /api/v1/onboarding/driver/vehicle
   * Submit vehicle compliance documents for admin review.
   */
  async submitVehicle(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      await ConsentService.assertConsent(userId, 'kyc_data_sharing');

      const { vehicle_id, ...rest } = req.body;

      const result = await VehicleComplianceService.submitVehicle(
        userId,
        vehicle_id,
        { vehicle_id, ...rest }
      );

      logger.info(
        `Phase 2D vehicle compliance submitted by user ${userId} for vehicle ${vehicle_id}`
      );

      return ApiResponseHandler.success(res, result, {
        message: 'Vehicle compliance documents submitted. Awaiting admin review.',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error('Vehicle compliance submission failed:', {
        userId,
        error: errorMessage,
      });
      return ApiResponseHandler.error(
        res,
        'ONBOARDING_VEHICLE_SUBMIT_ERROR',
        errorMessage,
        400
      );
    }
  }

  /**
   * GET /api/v1/onboarding/driver/vehicle/status?vehicleId=...
   * Fetch current vehicle compliance submission + verification state.
   *
   * If `vehicleId` is omitted, we fall back to the driver's primary vehicle.
   */
  async getStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const vehicleId = req.query.vehicleId as string | undefined;

      // If no vehicleId provided, resolve driver's primary vehicle
      let targetVehicleId = vehicleId;

      if (!targetVehicleId) {
        const { DriverModel } = await import('../models/driver.model');
        const { VehicleModel } = await import('../models/vehicle.model');
        const driver = await DriverModel.getByUserId(userId);
        if (!driver) {
          return ApiResponseHandler.notFound(res, 'Driver profile not found');
        }
        const primary = await VehicleModel.getPrimary(driver.id);
        if (!primary) {
          return ApiResponseHandler.notFound(res, 'No vehicle found for this driver');
        }
        targetVehicleId = primary.id;
      }

      const status = await VehicleComplianceService.getVehicleStatus(targetVehicleId);
      return ApiResponseHandler.success(res, status);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch vehicle status';
      logger.error('Vehicle status fetch failed:', { userId, error: errorMessage });
      return ApiResponseHandler.error(
        res,
        'ONBOARDING_VEHICLE_STATUS_ERROR',
        errorMessage,
        400
      );
    }
  }
}

export default OnboardingVehicleController;