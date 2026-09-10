import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import DriverService from '../services/driver.service';
import { BankService } from '../services/bank.service';
import { SubaccountService } from '../services/subaccount.service';
import { DriverModel } from '../models/driver.model';
import { UserModel } from '../models/user.model';
import logger from '../utils/logger';  // ✅ ADDED: Missing import

export class DriverController {
  /**
   * Get driver profile
   */
  async getProfile(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const profile = await DriverService.getProfile(userId);
    const user = await UserModel.findById(userId);
    
    return ApiResponseHandler.success(res, {
      ...profile,
      user: {
        id: user?.id,
        phone_number: user?.phone_number,
        email: user?.email,
        status: user?.status,
      }
    });
  }

  /**
   * Create driver profile
   */
  async createProfile(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const {
      first_name, last_name, profile_photo_url, date_of_birth,
      driver_license_number, driver_license_expiry,
      address, state_of_origin, emergency_contact_name,
      emergency_contact_phone, has_air_conditioning,
      has_working_stereo, interior_air_freshener
    } = req.body;

    const profile = await DriverService.createProfile(userId, {
      first_name,
      last_name,
      profile_photo_url,
      date_of_birth,
      driver_license_number,
      driver_license_expiry,
      address,
      state_of_origin,
      emergency_contact_name,
      emergency_contact_phone,
      has_air_conditioning,
      has_working_stereo,
      interior_air_freshener,
    });

    return ApiResponseHandler.success(res, profile, {
      message: 'Driver profile created successfully'
    });
  }

  /**
   * Update driver profile
   */
  async updateProfile(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const {
      first_name, last_name, profile_photo_url, date_of_birth,
      driver_license_number, driver_license_expiry,
      address, state_of_origin, emergency_contact_name,
      emergency_contact_phone, has_air_conditioning,
      has_working_stereo, interior_air_freshener
    } = req.body;

    const profile = await DriverService.updateProfile(userId, {
      first_name,
      last_name,
      profile_photo_url,
      date_of_birth,
      driver_license_number,
      driver_license_expiry,
      address,
      state_of_origin,
      emergency_contact_name,
      emergency_contact_phone,
      has_air_conditioning,
      has_working_stereo,
      interior_air_freshener,
    });

    return ApiResponseHandler.success(res, profile, {
      message: 'Profile updated successfully'
    });
  }

  // ============================================
  // BANK & SUBACCOUNT MANAGEMENT
  // ============================================

  /**
   * Get list of banks for dropdown
   * GET /api/v1/driver/banks
   */
  async getBanks(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const banks = await BankService.getBanks();
      
      const formattedBanks = banks.map((bank) => ({
        code: bank.code,
        name: bank.name,
        slug: bank.slug,
      }));

      return ApiResponseHandler.success(res, formattedBanks);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error fetching banks:', error);  // ✅ Now works
      return ApiResponseHandler.error(
        res,
        'BANK_FETCH_ERROR',
        `Failed to fetch banks: ${errorMessage}`,
        500
      );
    }
  }

  /**
   * Get popular banks for dropdown
   * GET /api/v1/driver/banks/popular
   */
  async getPopularBanks(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const banks = await BankService.getPopularBanks();
      
      const formattedBanks = banks.map((bank) => ({
        code: bank.code,
        name: bank.name,
        slug: bank.slug,
      }));

      return ApiResponseHandler.success(res, formattedBanks);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error fetching popular banks:', error);  // ✅ Now works
      return ApiResponseHandler.error(
        res,
        'BANK_FETCH_ERROR',
        `Failed to fetch popular banks: ${errorMessage}`,
        500
      );
    }
  }

  /**
   * Get driver bank details
   * GET /api/v1/driver/bank-details
   */
  async getBankDetails(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.notFound(res, 'Driver profile not found');
    }

    let subaccountDetails = null;
    if (driver.subaccount_code) {
      try {
        subaccountDetails = await SubaccountService.getDriverSubaccountDetails(driver.id);
      } catch (error) {
        logger.warn('Failed to fetch subaccount details:', error);  // ✅ Now works
      }
    }

    return ApiResponseHandler.success(res, {
      bank_code: driver.bank_code,
      account_number: driver.account_number,
      account_name: driver.account_name,
      subaccount_code: driver.subaccount_code,
      subaccount_status: driver.subaccount_status,
      subaccount_created_at: driver.subaccount_created_at,
      has_bank_details: !!(driver.bank_code && driver.account_number),
      has_active_subaccount: driver.subaccount_status === 'active',
      subaccount_details: subaccountDetails,
    });
  }

  /**
   * Update driver bank details
   * POST /api/v1/driver/bank-details
   */
  async updateBankDetails(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { bank_code, account_number } = req.body;

    if (!bank_code || !account_number) {
      return ApiResponseHandler.validationError(
        res,
        'bank_code and account_number are required'
      );
    }

    if (!/^[0-9]{10}$/.test(account_number)) {
      return ApiResponseHandler.validationError(
        res,
        'Account number must be 10 digits'
      );
    }

    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.notFound(res, 'Driver profile not found');
    }

    try {
      const validation = await BankService.validateBankAccount(
        bank_code,
        account_number
      );

      if (!validation.valid) {
        return ApiResponseHandler.validationError(
          res,
          validation.message || 'Invalid bank account details'
        );
      }

      const updatedDriver = await DriverModel.updateBankDetails(driver.id, {
        bank_code,
        account_number,
        account_name: validation.account_name || `${driver.first_name} ${driver.last_name}`,
      });

      if (!updatedDriver) {
        return ApiResponseHandler.error(
          res,
          'UPDATE_FAILED',
          'Failed to update bank details',
          500
        );
      }

      let subaccountResult;
      try {
        subaccountResult = await SubaccountService.ensureDriverSubaccount(
          driver.id,
          bank_code,
          account_number,
          validation.account_name
        );
      } catch (subaccountError) {
        logger.error('Subaccount creation failed:', subaccountError);  // ✅ Now works
        return ApiResponseHandler.success(res, {
          bank_code,
          account_number,
          account_name: validation.account_name,
          subaccount_code: null,
          subaccount_status: 'pending',
          subaccount_message: 'Bank details updated but subaccount creation is pending. Please try again later.',
        }, {
          message: 'Bank details updated. Subaccount creation is pending.',
        });
      }

      if (!subaccountResult.success) {
        await DriverModel.updateSubaccountStatus(driver.id, 'failed');
        
        return ApiResponseHandler.success(res, {
          bank_code,
          account_number,
          account_name: validation.account_name,
          subaccount_code: null,
          subaccount_status: 'failed',
          subaccount_message: subaccountResult.message || 'Subaccount creation failed',
        }, {
          message: 'Bank details updated but subaccount creation failed. Please contact support.',
        });
      }

      logger.info(`Bank details updated for driver ${driver.id}: ${bank_code}, account: ${account_number.slice(-4)}`);  // ✅ Now works

      return ApiResponseHandler.success(res, {
        bank_code,
        account_number,
        account_name: validation.account_name,
        subaccount_code: subaccountResult.subaccount_code,
        subaccount_status: 'active',
        subaccount_message: subaccountResult.message || 'Subaccount created successfully',
      }, {
        message: 'Bank details updated and subaccount created successfully',
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error updating bank details for driver ${driver.id}:`, error);  // ✅ Now works
      return ApiResponseHandler.error(
        res,
        'UPDATE_ERROR',
        `Failed to update bank details: ${errorMessage}`,
        500
      );
    }
  }

  /**
   * Get driver subaccount details
   * GET /api/v1/driver/subaccount
   */
  async getSubaccountDetails(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return ApiResponseHandler.notFound(res, 'Driver profile not found');
    }

    if (!driver.subaccount_code) {
      return ApiResponseHandler.success(res, {
        has_subaccount: false,
        message: 'No subaccount found for this driver',
      });
    }

    try {
      const details = await SubaccountService.getDriverSubaccountDetails(driver.id);
      
      if (!details) {
        return ApiResponseHandler.success(res, {
          has_subaccount: true,
          subaccount_code: driver.subaccount_code,
          status: driver.subaccount_status || 'unknown',
          message: 'Subaccount found but details could not be fetched',
        });
      }

      return ApiResponseHandler.success(res, {
        has_subaccount: true,
        subaccount_code: details.subaccount_code,
        subaccount_id: details.subaccount_id,
        business_name: details.business_name,
        bank_name: details.bank_name,
        bank_code: details.bank_code,
        account_number: details.account_number,
        account_name: details.account_name,
        percentage_charge: details.percentage_charge,
        status: details.status,
        created_at: details.created_at,
        paystack_data: details.paystack_data,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error fetching subaccount details for driver ${driver.id}:`, error);  // ✅ Now works
      return ApiResponseHandler.error(
        res,
        'SUBACCOUNT_FETCH_ERROR',
        `Failed to fetch subaccount details: ${errorMessage}`,
        500
      );
    }
  }

  /**
   * Validate bank account (without saving)
   * POST /api/v1/driver/validate-bank
   */
  async validateBankAccount(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { bank_code, account_number } = req.body;

    if (!bank_code || !account_number) {
      return ApiResponseHandler.validationError(
        res,
        'bank_code and account_number are required'
      );
    }

    try {
      const validation = await BankService.validateBankAccount(
        bank_code,
        account_number
      );

      if (!validation.valid) {
        return ApiResponseHandler.success(res, {
          valid: false,
          message: validation.message || 'Invalid bank account',
        });
      }

      return ApiResponseHandler.success(res, {
        valid: true,
        account_name: validation.account_name,
        bank_name: validation.bank_name,
        bank_code: validation.bank_code,
        formatted_account: BankService.formatAccountNumber(account_number),
        masked_account: BankService.maskAccountNumber(account_number),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error validating bank account:', error);  // ✅ Now works
      return ApiResponseHandler.error(
        res,
        'VALIDATION_ERROR',
        `Failed to validate bank account: ${errorMessage}`,
        500
      );
    }
  }

  // ============================================
  // VEHICLE MANAGEMENT
  // ============================================

  /**
   * Get vehicles
   */
  async getVehicles(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const vehicles = await DriverService.getVehicles(userId);
    return ApiResponseHandler.success(res, vehicles);
  }

  /**
   * Add vehicle
   */
  async addVehicle(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const {
      registration_number, make, model, year, colour, vehicle_type,
      is_primary, seat_count, registration_document_url,
      insurance_document_url, roadworthiness_document_url,
      registration_expiry, insurance_expiry, roadworthiness_expiry
    } = req.body;

    const vehicle = await DriverService.addVehicle(userId, {
      registration_number,
      make,
      model,
      year,
      colour,
      vehicle_type,
      is_primary,
      seat_count,
      registration_document_url,
      insurance_document_url,
      roadworthiness_document_url,
      registration_expiry,
      insurance_expiry,
      roadworthiness_expiry,
    });

    return ApiResponseHandler.success(res, vehicle, {
      message: 'Vehicle added successfully'
    });
  }

  /**
   * Update vehicle
   */
  async updateVehicle(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { vehicleId } = req.params;
    const vehicleIdStr = Array.isArray(vehicleId) ? vehicleId[0] : vehicleId;

    const {
      registration_number, make, model, year, colour, vehicle_type,
      is_primary, seat_count, registration_document_url,
      insurance_document_url, roadworthiness_document_url,
      registration_expiry, insurance_expiry, roadworthiness_expiry
    } = req.body;

    const vehicle = await DriverService.updateVehicle(userId, vehicleIdStr, {
      registration_number,
      make,
      model,
      year,
      colour,
      vehicle_type,
      is_primary,
      seat_count,
      registration_document_url,
      insurance_document_url,
      roadworthiness_document_url,
      registration_expiry,
      insurance_expiry,
      roadworthiness_expiry,
    });

    return ApiResponseHandler.success(res, vehicle, {
      message: 'Vehicle updated successfully'
    });
  }

  /**
   * Delete vehicle
   */
  async deleteVehicle(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { vehicleId } = req.params;
    const vehicleIdStr = Array.isArray(vehicleId) ? vehicleId[0] : vehicleId;

    await DriverService.deleteVehicle(userId, vehicleIdStr);

    return ApiResponseHandler.success(res, null, {
      message: 'Vehicle deleted successfully'
    });
  }

  // ============================================
  // AVAILABILITY MANAGEMENT
  // ============================================

  /**
   * Go online
   */
  async goOnline(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await DriverModel.getByUserId(userId);
    if (driver) {
      if (!driver.bank_code || !driver.account_number) {
        return ApiResponseHandler.validationError(
          res,
          'Please add your bank details before going online'
        );
      }
      if (driver.subaccount_status !== 'active') {
        return ApiResponseHandler.validationError(
          res,
          'Your subaccount is not active. Please contact support.'
        );
      }
    }

    const { latitude, longitude } = req.body;
    const profile = await DriverService.setAvailability(
      userId,
      true,
      latitude && longitude ? { latitude, longitude } : undefined
    );

    return ApiResponseHandler.success(res, profile, {
      message: 'Driver is now online'
    });
  }

  /**
   * Go offline
   */
  async goOffline(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const profile = await DriverService.setAvailability(userId, false);

    return ApiResponseHandler.success(res, profile, {
      message: 'Driver is now offline'
    });
  }

  /**
   * Update location
   */
  async updateLocation(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { latitude, longitude, speed_kmh, heading, accuracy_meters } = req.body;

    if (!latitude || !longitude) {
      return ApiResponseHandler.validationError(res, 'Latitude and longitude are required');
    }

    await DriverService.updateLocation(userId, {
      driver_id: userId,
      latitude,
      longitude,
      speed_kmh,
      heading,
      accuracy_meters,
    });

    return ApiResponseHandler.success(res, null, {
      message: 'Location updated successfully'
    });
  }

  // ============================================
  // KYC & DOCUMENT MANAGEMENT
  // ============================================

  /**
   * Get KYC status
   */
  async getKYCStatus(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const status = await DriverService.getKYCStatus(userId);
    return ApiResponseHandler.success(res, status);
  }

  /**
   * Submit document
   */
  async submitDocument(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { document_type, document_number, document_url, expiry_date } = req.body;

    if (!document_type || !document_url) {
      return ApiResponseHandler.validationError(res, 'Document type and URL are required');
    }

    const document = await DriverService.submitDocument(userId, {
      document_type,
      document_number,
      document_url,
      expiry_date,
    });

    return ApiResponseHandler.success(res, document, {
      message: 'Document submitted successfully'
    });
  }

  /**
   * Get documents
   */
  async getDocuments(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const documents = await DriverService.getDocuments(userId);
    return ApiResponseHandler.success(res, documents);
  }

  // ============================================
  // ADMIN ROUTES
  // ============================================

  /**
   * Admin: Approve KYC
   */
  async approveKYC(req: Request, res: Response): Promise<Response> {
    const { driverId } = req.params;
    const driverIdStr = Array.isArray(driverId) ? driverId[0] : driverId;

    const adminId = (req as any).user?.id;

    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const driver = await DriverService.approveKYC(driverIdStr, adminId);
    return ApiResponseHandler.success(res, driver, {
      message: 'KYC approved successfully'
    });
  }

  /**
   * Admin: Reject KYC
   */
  async rejectKYC(req: Request, res: Response): Promise<Response> {
    const { driverId } = req.params;
    const driverIdStr = Array.isArray(driverId) ? driverId[0] : driverId;

    const adminId = (req as any).user?.id;
    const { reason } = req.body;

    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    if (!reason) {
      return ApiResponseHandler.validationError(res, 'Rejection reason is required');
    }

    const driver = await DriverService.rejectKYC(driverIdStr, reason, adminId);
    return ApiResponseHandler.success(res, driver, {
      message: 'KYC rejected successfully'
    });
  }

  /**
   * Get active drivers (admin only)
   */
  async getActiveDrivers(req: Request, res: Response): Promise<Response> {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const drivers = await DriverService.getActiveDrivers(limit);
    return ApiResponseHandler.success(res, drivers);
  }

  /**
   * Get drivers near location
   */
  async getDriversNear(req: Request, res: Response): Promise<Response> {
    const latitude = parseFloat(req.query.latitude as string);
    const longitude = parseFloat(req.query.longitude as string);
    const radius = req.query.radius ? parseFloat(req.query.radius as string) : 5;

    if (isNaN(latitude) || isNaN(longitude)) {
      return ApiResponseHandler.validationError(res, 'Valid latitude and longitude are required');
    }

    const drivers = await DriverService.getDriversNear(latitude, longitude, radius);
    return ApiResponseHandler.success(res, drivers);
  }

  /**
   * Admin: Get drivers without subaccounts
   * GET /api/v1/driver/admin/no-subaccount
   */
  async getDriversWithoutSubaccount(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const drivers = await DriverModel.getDriversWithoutSubaccount(limit);

    return ApiResponseHandler.success(res, {
      count: drivers.length,
      drivers: drivers.map((d) => ({
        id: d.id,
        user_id: d.user_id,
        first_name: d.first_name,
        last_name: d.last_name,
        bank_code: d.bank_code,
        account_number: d.account_number,
        account_name: d.account_name,
        subaccount_status: d.subaccount_status,
      })),
    });
  }

  /**
   * Admin: Batch create subaccounts for drivers
   * POST /api/v1/driver/admin/batch-subaccount
   */
  async batchCreateSubaccounts(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { driver_ids } = req.body;

    if (!driver_ids || !Array.isArray(driver_ids) || driver_ids.length === 0) {
      return ApiResponseHandler.validationError(
        res,
        'driver_ids array is required'
      );
    }

    try {
      const result = await SubaccountService.batchCreateSubaccounts(driver_ids);

      return ApiResponseHandler.success(res, result, {
        message: `Batch subaccount creation completed: ${result.successful} successful, ${result.failed} failed`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error in batch subaccount creation:', error);  // ✅ Now works
      return ApiResponseHandler.error(
        res,
        'BATCH_SUBACCOUNT_ERROR',
        `Failed to batch create subaccounts: ${errorMessage}`,
        500
      );
    }
  }

  /**
   * Admin: Retry subaccount creation for a driver
   * POST /api/v1/driver/admin/retry-subaccount/:driverId
   */
  async retrySubaccount(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { driverId } = req.params;
    const driverIdStr = Array.isArray(driverId) ? driverId[0] : driverId;

    try {
      const result = await SubaccountService.retryFailedSubaccount(driverIdStr);

      if (result.success) {
        return ApiResponseHandler.success(res, result, {
          message: 'Subaccount created successfully',
        });
      } else {
        return ApiResponseHandler.error(
          res,
          'SUBACCOUNT_RETRY_FAILED',
          result.message || 'Failed to create subaccount',
          400
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error retrying subaccount for driver ${driverIdStr}:`, error);  // ✅ Now works
      return ApiResponseHandler.error(
        res,
        'SUBACCOUNT_RETRY_ERROR',
        `Failed to retry subaccount creation: ${errorMessage}`,
        500
      );
    }
  }
}

export default DriverController;