import { UserModel } from '../models/user.model';
import DriverModel from '../models/driver.model';
import VehicleModel from '../models/vehicle.model';
import DriverDocumentModel from '../models/driver-document.model';
import KYCModel from '../models/kyc.model';
import { SubaccountService } from './subaccount.service';
import {
  IDriverProfile,
  ICreateDriverProfile,
  IUpdateDriverProfile,
  ICreateVehicle,
  IDriverLocation
} from '../types';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/error.middleware';
import logger from '../utils/logger';

export class DriverService {
  /**
   * Get driver profile by user ID
   */
  static async getProfile(userId: string): Promise<IDriverProfile> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const profile = await DriverModel.getByUserId(userId);
    if (!profile) {
      throw new NotFoundError('Driver profile not found');
    }

    return profile;
  }

  /**
   * Create driver profile
   */
  static async createProfile(
    userId: string,
    data: ICreateDriverProfile
  ): Promise<IDriverProfile> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check if driver profile already exists
    const existing = await DriverModel.getByUserId(userId);
    if (existing) {
      throw new ConflictError('Driver profile already exists');
    }

    // Update user role to driver if needed
    if (user.role !== 'driver') {
      // Note: This should be handled via a separate role update endpoint
      // For now, we'll just create the profile
    }

    const profile = await DriverModel.create(userId, data);
    
    // Create initial KYC record
    await KYCModel.create(profile.id, 'pending');

    return profile;
  }

  /**
   * Update driver profile
   */
  static async updateProfile(
    userId: string,
    data: IUpdateDriverProfile
  ): Promise<IDriverProfile> {
    // ✅ Removed unused profile variable
    const updated = await DriverModel.update(userId, data);
    if (!updated) {
      throw new ValidationError('No valid fields to update');
    }
    return updated;
  }

  /**
   * Get driver by ID
   */
  static async getDriverById(driverId: string): Promise<IDriverProfile> {
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }
    return driver;
  }

  /**
   * Get vehicles for driver
   */
  static async getVehicles(userId: string): Promise<any[]> {
    const profile = await this.getProfile(userId);
    return VehicleModel.getByDriverId(profile.id);
  }

  /**
   * Add vehicle for driver
   */
  static async addVehicle(
    userId: string,
    data: ICreateVehicle
  ): Promise<any> {
    const profile = await this.getProfile(userId);
    
    // Check if registration number already exists
    const existing = await VehicleModel.getByDriverId(profile.id);
    if (existing.some(v => v.registration_number === data.registration_number)) {
      throw new ConflictError('Vehicle registration number already exists');
    }

    return VehicleModel.create(profile.id, data);
  }

  /**
   * Update vehicle
   */
  static async updateVehicle(
    userId: string,
    vehicleId: string,
    data: Partial<ICreateVehicle>
  ): Promise<any> {
    const profile = await this.getProfile(userId);
    const vehicle = await VehicleModel.getById(vehicleId);
    
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found');
    }
    if (vehicle.driver_id !== profile.id) {
      throw new ValidationError('Vehicle does not belong to this driver');
    }

    const updated = await VehicleModel.update(vehicleId, data);
    if (!updated) {
      throw new ValidationError('No valid fields to update');
    }
    return updated;
  }

  /**
   * Delete vehicle
   */
  static async deleteVehicle(
    userId: string,
    vehicleId: string
  ): Promise<void> {
    const profile = await this.getProfile(userId);
    const vehicle = await VehicleModel.getById(vehicleId);
    
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found');
    }
    if (vehicle.driver_id !== profile.id) {
      throw new ValidationError('Vehicle does not belong to this driver');
    }

    await VehicleModel.delete(vehicleId);
  }

  /**
   * Go online/offline
   */
  static async setAvailability(
    userId: string,
    isOnline: boolean,
    location?: { latitude: number; longitude: number }
  ): Promise<IDriverProfile> {
    const profile = await this.getProfile(userId);
    
    // Check if driver is approved and KYC is complete
    if (isOnline) {
      if (profile.kyc_status !== 'approved') {
        throw new ValidationError('KYC not approved');
      }
      if (profile.driver_status !== 'active' && profile.driver_status !== 'approved') {
        throw new ValidationError('Driver not active');
      }
    }

    const updated = await DriverModel.updateAvailability(
      profile.id,
      isOnline,
      location?.latitude,
      location?.longitude
    );
    
    if (!updated) {
      throw new ValidationError('Failed to update availability');
    }
    
    return updated;
  }

  /**
   * Update driver location
   */
  static async updateLocation(
    userId: string,
    location: IDriverLocation
  ): Promise<void> {
    const profile = await this.getProfile(userId);
    
    if (!profile.is_online) {
      throw new ValidationError('Driver is offline');
    }

    await DriverModel.updateLocation(
      profile.id,
      location.latitude,
      location.longitude
    );
  }

  /**
   * Get KYC status
   */
  static async getKYCStatus(userId: string): Promise<any> {
    const profile = await this.getProfile(userId);
    const kycRecords = await KYCModel.getByDriverId(profile.id);
    const documents = await DriverDocumentModel.getByDriverId(profile.id);
    
    return {
      kyc_status: profile.kyc_status,
      records: kycRecords,
      documents: documents.map(d => ({
        id: d.id,
        type: d.document_type,
        status: d.verification_status,
        submitted_at: d.created_at,
      })),
    };
  }

  /**
   * Submit KYC document
   */
  static async submitDocument(
    userId: string,
    data: {
      document_type: string;
      document_number?: string;
      document_url: string;
      expiry_date?: string;
    }
  ): Promise<any> {
    const profile = await this.getProfile(userId);
    
    // Update KYC status to under_review if pending
    if (profile.kyc_status === 'pending') {
      await DriverModel.updateKycStatus(profile.id, 'under_review');
    }

    return DriverDocumentModel.create(profile.id, data);
  }

  /**
   * Get documents
   */
  static async getDocuments(userId: string): Promise<any[]> {
    const profile = await this.getProfile(userId);
    return DriverDocumentModel.getByDriverId(profile.id);
  }

  // ============================================
  // SUBACCOUNT MANAGEMENT (NEW)
  // ============================================

  /**
   * Get driver's subaccount code
   * @param driverId - The driver ID
   * @returns The subaccount code or null
   */
  static async getDriverSubaccount(driverId: string): Promise<string | null> {
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }
    return driver.subaccount_code || null;
  }

  /**
   * Ensure a driver has a subaccount
   * If subaccount exists, returns it. If not, creates one.
   * 
   * @param driverId - The driver ID
   * @returns The subaccount code
   * @throws ValidationError if driver has no bank details
   */
  static async ensureSubaccountExists(driverId: string): Promise<string> {
    // Check if driver already has a subaccount
    const subaccount = await this.getDriverSubaccount(driverId);
    if (subaccount) {
      logger.info(`Driver ${driverId} already has subaccount: ${subaccount}`);
      return subaccount;
    }
    
    // If no subaccount, try to create one
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }
    
    if (!driver.bank_code || !driver.account_number) {
      throw new ValidationError('Driver has no bank details. Please update bank details first.');
    }
    
    logger.info(`Creating subaccount for driver ${driverId}`);
    
    // Create subaccount using SubaccountService
    const result = await SubaccountService.ensureDriverSubaccount(
      driverId,
      driver.bank_code,
      driver.account_number,
      driver.account_name || `${driver.first_name} ${driver.last_name}`
    );
    
    if (!result.success || !result.subaccount_code) {
      throw new ValidationError(result.message || 'Failed to create subaccount');
    }
    
    logger.info(`Subaccount created for driver ${driverId}: ${result.subaccount_code}`);
    return result.subaccount_code;
  }

  /**
   * Get driver's subaccount details
   * @param driverId - The driver ID
   * @returns Subaccount details from Paystack
   */
  static async getDriverSubaccountDetails(driverId: string): Promise<any> {
    return SubaccountService.getDriverSubaccountDetails(driverId);
  }

  /**
   * Update driver's bank details and subaccount
   * @param driverId - The driver ID
   * @param bankCode - New bank code
   * @param accountNumber - New account number
   * @param accountName - New account name (optional)
   * @returns Updated driver profile
   */
  static async updateDriverBankDetails(
    driverId: string,
    bankCode: string,
    accountNumber: string,
    accountName?: string
  ): Promise<IDriverProfile> {
    // Get driver
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }

    // Update bank details in database
    const updatedDriver = await DriverModel.updateBankDetails(driverId, {
      bank_code: bankCode,
      account_number: accountNumber,
      account_name: accountName || `${driver.first_name} ${driver.last_name}`,
    });

    if (!updatedDriver) {
      throw new ValidationError('Failed to update bank details');
    }

    // Ensure subaccount exists
    await this.ensureSubaccountExists(driverId);

    logger.info(`Bank details updated for driver ${driverId}: ${bankCode}, account: ${accountNumber.slice(-4)}`);
    return updatedDriver;
  }

  /**
   * Check if driver has a subaccount
   * @param driverId - The driver ID
   * @returns True if driver has an active subaccount
   */
  static async hasActiveSubaccount(driverId: string): Promise<boolean> {
    return DriverModel.hasActiveSubaccount(driverId);
  }

  /**
   * Check if driver has bank details
   * @param driverId - The driver ID
   * @returns True if driver has bank details
   */
  static async hasBankDetails(driverId: string): Promise<boolean> {
    return DriverModel.hasBankDetails(driverId);
  }

  // ============================================
  // ADMIN METHODS
  // ============================================

  /**
   * Admin: Approve KYC
   */
  static async approveKYC(
    driverId: string,
    adminId: string
  ): Promise<IDriverProfile> {
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }

    // Update KYC status
    const updated = await DriverModel.updateKycStatus(driverId, 'approved');
    if (!updated) {
      throw new ValidationError('Failed to approve KYC');
    }

    // Update KYC record
    const kycRecord = await KYCModel.getLatest(driverId);
    if (kycRecord) {
      await KYCModel.updateStatus(kycRecord.id, 'approved');
    }

    // Update driver status to active
    await DriverModel.updateStatus(driverId, 'active');

    logger.info(`KYC approved for driver: ${driverId} by admin: ${adminId}`);
    return updated;
  }

  /**
   * Admin: Reject KYC
   */
  static async rejectKYC(
    driverId: string,
    reason: string,
    adminId: string
  ): Promise<IDriverProfile> {
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }

    const updated = await DriverModel.updateKycStatus(driverId, 'rejected', reason);
    if (!updated) {
      throw new ValidationError('Failed to reject KYC');
    }

    // Update KYC record
    const kycRecord = await KYCModel.getLatest(driverId);
    if (kycRecord) {
      await KYCModel.updateStatus(kycRecord.id, 'rejected', undefined, reason);
    }

    logger.info(`KYC rejected for driver: ${driverId} by admin: ${adminId}`);
    return updated;
  }

  /**
   * Get active drivers
   */
  static async getActiveDrivers(limit?: number): Promise<IDriverProfile[]> {
    return DriverModel.getActiveDrivers(limit);
  }

  /**
   * Get drivers near a location
   */
  static async getDriversNear(
    latitude: number,
    longitude: number,
    radiusKm: number = 5
  ): Promise<IDriverProfile[]> {
    return DriverModel.getDriversNear(latitude, longitude, radiusKm);
  }

  /**
   * Admin: Get drivers without subaccounts
   * @param limit - Maximum number of drivers to return
   * @returns Array of drivers without subaccounts
   */
  static async getDriversWithoutSubaccount(limit: number = 100): Promise<IDriverProfile[]> {
    return DriverModel.getDriversWithoutSubaccount(limit);
  }

  /**
   * Admin: Batch create subaccounts for drivers
   * @param driverIds - Array of driver IDs
   * @returns Batch creation results
   */
  static async batchCreateSubaccounts(
    driverIds: string[]
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: Array<{ driverId: string; success: boolean; message: string; subaccount_code?: string }>;
  }> {
    const result = await SubaccountService.batchCreateSubaccounts(driverIds);
    
    // Transform to match the expected return type
    return {
      total: result.total,
      successful: result.successful,
      failed: result.failed,
      results: result.results.map(r => ({
        driverId: r.driverId,
        success: r.result.success,
        message: r.result.message || (r.result.success ? 'Subaccount created' : 'Failed to create subaccount'),
        subaccount_code: r.result.subaccount_code,
      })),
    };
  }

  /**
   * Admin: Retry subaccount creation for a driver
   * @param driverId - The driver ID
   * @returns Updated driver profile
   */
  static async retrySubaccountCreation(driverId: string): Promise<IDriverProfile> {
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new NotFoundError('Driver not found');
    }

    if (!driver.bank_code || !driver.account_number) {
      throw new ValidationError('Driver has no bank details. Please update bank details first.');
    }

    // Reset status to pending
    await DriverModel.updateSubaccountStatus(driverId, 'pending');

    // Create subaccount
    const result = await SubaccountService.createDriverSubaccount({
      driverId: driver.id,
      userId: driver.user_id,
      firstName: driver.first_name,
      lastName: driver.last_name,
      bankCode: driver.bank_code,
      accountNumber: driver.account_number,
      accountName: driver.account_name || `${driver.first_name} ${driver.last_name}`,
    });

    if (!result.success) {
      throw new ValidationError(result.message || 'Failed to create subaccount');
    }

    // Get updated driver
    const updatedDriver = await DriverModel.getById(driverId);
    if (!updatedDriver) {
      throw new NotFoundError('Driver not found after subaccount creation');
    }

    logger.info(`Subaccount retry successful for driver ${driverId}: ${result.subaccount_code}`);
    return updatedDriver;
  }
}

export default DriverService;