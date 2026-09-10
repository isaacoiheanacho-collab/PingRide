import bcrypt from 'bcrypt';
import { UserModel } from '../models/user.model';
import { PassengerModel } from '../models/passenger.model';
import { DriverModel } from '../models/driver.model';
import { OTPService } from './otp.service';
import { generateTokens, verifyRefreshToken } from '../utils/jwt';
import { VirtualAccountService } from './virtual-account.service';
import { BankService } from './bank.service';
import { SubaccountService } from './subaccount.service';
import { 
  IRegisterRequest, 
  ILoginRequest, 
  IAuthResponse,
  IRefreshTokenRequest,
  IChangePasswordRequest,
  IResetPasswordConfirmRequest
} from '../types';
import { ConflictError, UnauthorizedError, ValidationError, NotFoundError } from '../middleware/error.middleware';
import logger from '../utils/logger';

export class AuthService {
  private static readonly SALT_ROUNDS = 12;

  /**
   * Register a new user - with virtual account provisioning and KYC
   * 
   * Integration Flow:
   * 1. Validate user input (phone, email, password)
   * 2. Create user in database
   * 3. Send OTP for verification
   * 4. Create passenger profile with KYC data (if passenger)
   * 5. Create driver profile with subaccount (if driver)
   * 6. Provision Virtual Account (DVA) with split support (if passenger)
   * 7. Generate JWT tokens
   * 8. Return user data and tokens
   */
  static async register(data: IRegisterRequest): Promise<IAuthResponse> {
    // ============================================
    // STEP 1: VALIDATE USER INPUT
    // ============================================
    
    // Check if phone already exists
    const phoneExists = await UserModel.phoneExists(data.phone_number);
    if (phoneExists) {
      throw new ConflictError('Phone number already registered');
    }

    // Check if email exists (if provided)
    if (data.email) {
      const emailExists = await UserModel.emailExists(data.email);
      if (emailExists) {
        throw new ConflictError('Email already registered');
      }
    }

    // Validate BVN/NIN if provided
    if (data.bvn && !this.validateBVN(data.bvn)) {
      throw new ValidationError('Invalid BVN format. BVN must be 11 digits.');
    }
    if (data.nin && !this.validateNIN(data.nin)) {
      throw new ValidationError('Invalid NIN format. NIN must be 11 digits.');
    }

    // Validate driver bank details if provided
    if (data.user_type === 'driver' && data.bank_code && data.account_number) {
      // Validate bank code exists
      const isValidBank = await BankService.isValidBankCode(data.bank_code);
      if (!isValidBank) {
        throw new ValidationError('Invalid bank code. Please select a valid bank.');
      }
      
      // Validate account number format (10 digits for Nigeria)
      if (!/^[0-9]{10}$/.test(data.account_number)) {
        throw new ValidationError('Account number must be 10 digits.');
      }
    }

    // ============================================
    // STEP 2: CREATE USER
    // ============================================

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, this.SALT_ROUNDS);

    // Create user
    const user = await UserModel.create(
      data.phone_number,
      passwordHash,
      data.user_type,
      data.email
    );

    // ============================================
    // STEP 3: SEND OTP
    // ============================================

    // Send OTP for phone verification
    await OTPService.sendOTP(data.phone_number, 'registration');

    // ============================================
    // STEP 4: CREATE PASSENGER PROFILE (if passenger)
    // ============================================
    
    if (data.user_type === 'passenger') {
      try {
        await PassengerModel.createProfile(user.id, {
          first_name: data.first_name,
          last_name: data.last_name,
          profile_photo_url: data.profile_photo_url,
          date_of_birth: data.date_of_birth,
          gender: data.gender,
          bvn: data.bvn,
          nin: data.nin,
          kyc_status: data.bvn || data.nin ? 'pending' : 'pending',
        });
        logger.info(`Passenger profile created for user: ${user.id}`);
      } catch (error) {
        logger.error(`Failed to create passenger profile for user ${user.id}:`, error);
        // Don't block registration if profile creation fails
      }
    }

    // ============================================
    // STEP 5: CREATE DRIVER PROFILE WITH SUBACCOUNT (if driver)
    // ============================================
    
    if (data.user_type === 'driver') {
      try {
        // 5.1: Create driver profile
        const driver = await DriverModel.create(user.id, {
          first_name: data.first_name,
          last_name: data.last_name,
          profile_photo_url: data.profile_photo_url,
          date_of_birth: data.date_of_birth,
          driver_license_number: data.driver_license_number || '',
          driver_license_expiry: data.driver_license_expiry || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          address: data.address,
          state_of_origin: data.state_of_origin,
          emergency_contact_name: data.emergency_contact_name,
          emergency_contact_phone: data.emergency_contact_phone,
          has_air_conditioning: data.has_air_conditioning,
          has_working_stereo: data.has_working_stereo,
          interior_air_freshener: data.interior_air_freshener,
          // Bank details for subaccount
          bank_code: data.bank_code,
          account_number: data.account_number,
        });
        logger.info(`Driver profile created for user: ${user.id}`);

        // 5.2: Validate and store bank details if provided
        if (data.bank_code && data.account_number) {
          try {
            const validation = await BankService.validateBankAccount(
              data.bank_code,
              data.account_number
            );
            
            if (!validation.valid) {
              logger.warn(`Bank account validation failed for driver ${driver.id}: ${validation.message}`);
              // Don't throw - driver can update bank details later
            } else {
              // Update driver with validated account name
              await DriverModel.updateBankDetails(driver.id, {
                bank_code: data.bank_code,
                account_number: data.account_number,
                account_name: validation.account_name || `${data.first_name} ${data.last_name}`,
              });
              
              // 5.3: Create Paystack subaccount
              try {
                const subaccountResult = await SubaccountService.createDriverSubaccount({
                  driverId: driver.id,
                  userId: user.id,
                  firstName: data.first_name,
                  lastName: data.last_name,
                  bankCode: data.bank_code,
                  accountNumber: data.account_number,
                  accountName: validation.account_name || `${data.first_name} ${data.last_name}`,
                  phoneNumber: data.phone_number,
                  email: data.email,
                });

                if (subaccountResult.success) {
                  logger.info(`Subaccount created for driver ${driver.id}: ${subaccountResult.subaccount_code}`);
                } else {
                  logger.warn(`Subaccount creation failed for driver ${driver.id}: ${subaccountResult.message}`);
                  // Driver can retry later via admin or update bank details
                }
              } catch (subaccountError) {
                logger.error(`Failed to create subaccount for driver ${driver.id}:`, subaccountError);
                // Don't block registration if subaccount creation fails
                // Driver can retry later
              }
            }
          } catch (validationError) {
            logger.error(`Bank validation error for driver ${driver.id}:`, validationError);
            // Don't block registration - driver can update bank details later
          }
        } else {
          logger.info(`Driver ${driver.id} registered without bank details. They can add bank details later.`);
        }

      } catch (error) {
        logger.error(`Failed to complete driver registration for user ${user.id}:`, error);
        // Don't block registration if driver profile creation fails
        // User can complete driver profile later
      }
    }

    // ============================================
    // STEP 6: PROVISION VIRTUAL ACCOUNT (DVA) for PASSENGERS
    // ============================================
    
    if (data.user_type === 'passenger') {
      try {
        const splitConfig = await this.getDefaultSplitConfig();
        
        await VirtualAccountService.provisionVirtualAccount(
          user.id,
          splitConfig
        );
        logger.info(`Virtual account provisioned for new passenger: ${user.id}`, {
          has_split: !!splitConfig?.split_code || !!splitConfig?.subaccount,
        });
      } catch (error) {
        // Don't block registration if virtual account fails
        // Log and continue - can be retried later
        logger.error(`Failed to provision virtual account for user ${user.id}:`, error);
      }
    }

    // ============================================
    // STEP 7: GENERATE TOKENS
    // ============================================

    const tokens = generateTokens(user);

    // ============================================
    // STEP 8: RETURN RESPONSE
    // ============================================

    logger.info(`User registered: ${user.id} (${user.phone_number})`);

    return {
      user: {
        id: user.id,
        phone_number: user.phone_number,
        email: user.email || undefined,
        first_name: data.first_name,
        last_name: data.last_name,
        role: user.role,
        status: user.status,
      },
      tokens,
    };
  }

  /**
   * Verify OTP for registration
   */
  static async verifyRegistrationOTP(
    phoneNumber: string,
    otp: string
  ): Promise<{ success: boolean; user: any }> {
    // Verify OTP
    const result = await OTPService.verifyOTP(phoneNumber, otp, 'registration');
    if (!result.valid) {
      throw new ValidationError(result.message);
    }

    // Find user
    const user = await UserModel.findByPhone(phoneNumber);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Update user status
    await UserModel.verifyPhone(user.id);

    logger.info(`User verified: ${user.id} (${user.phone_number})`);

    return {
      success: true,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        email: user.email,
        role: user.role,
        status: 'active',
      },
    };
  }

  /**
   * Login user
   * 
   * Integration Flow:
   * 1. Find user by phone
   * 2. Check account status (locked, active, verified)
   * 3. Verify password
   * 4. Reset login attempts
   * 5. Update last login
   * 6. Generate JWT tokens
   * 7. Return user data with profile info
   */
  static async login(data: ILoginRequest): Promise<IAuthResponse> {
    // STEP 1: Find user by phone
    const user = await UserModel.findByPhone(data.phone_number);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // STEP 2: Check account status
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new UnauthorizedError('Account locked. Please try again later');
    }

    if (user.status !== 'active' && user.status !== 'pending_verification') {
      throw new UnauthorizedError(`Account ${user.status}`);
    }

    if (user.status === 'pending_verification' && !user.phone_verified) {
      throw new UnauthorizedError('Phone number not verified');
    }

    // STEP 3: Verify password
    const isValidPassword = await bcrypt.compare(data.password, user.password_hash);
    if (!isValidPassword) {
      await UserModel.incrementLoginAttempts(user.id);
      throw new UnauthorizedError('Invalid credentials');
    }

    // STEP 4: Reset login attempts on successful login
    await UserModel.resetLoginAttempts(user.id);

    // STEP 5: Update last login
    await UserModel.updateLastLogin(user.id);

    // STEP 6: Generate tokens
    const tokens = generateTokens(user);

    // STEP 7: Get user profile info
    let firstName = '';
    let lastName = '';
    let subaccountCode: string | undefined;
    let subaccountStatus: string | undefined;
    
    if (user.role === 'passenger') {
      const passenger = await PassengerModel.getProfile(user.id);
      if (passenger) {
        firstName = passenger.first_name || '';
        lastName = passenger.last_name || '';
      }
    } else if (user.role === 'driver') {
      const driver = await DriverModel.getByUserId(user.id);
      if (driver) {
        firstName = driver.first_name || '';
        lastName = driver.last_name || '';
        subaccountCode = driver.subaccount_code;
        subaccountStatus = driver.subaccount_status;
      }
    }

    logger.info(`User logged in: ${user.id} (${user.phone_number})`);

    return {
      user: {
        id: user.id,
        phone_number: user.phone_number,
        email: user.email || undefined,
        first_name: firstName,
        last_name: lastName,
        role: user.role,
        status: user.status,
        // Additional driver info for response
        ...(subaccountCode && { subaccount_code: subaccountCode }),
        ...(subaccountStatus && { subaccount_status: subaccountStatus }),
      },
      tokens,
    };
  }

  /**
   * Refresh access token
   */
  static async refreshToken(data: IRefreshTokenRequest): Promise<{ accessToken: string; expiresIn: number }> {
    const decoded = verifyRefreshToken(data.refresh_token);
    if (!decoded) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Find user
    const user = await UserModel.findById(decoded.sub);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new UnauthorizedError('Account not active');
    }

    // Generate new tokens
    const tokens = generateTokens(user);

    logger.info(`Token refreshed for user: ${user.id}`);

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    };
  }

  /**
   * Change password
   */
  static async changePassword(
    userId: string,
    data: IChangePasswordRequest
  ): Promise<{ success: boolean; message: string }> {
    // Find user
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(data.current_password, user.password_hash);
    if (!isValidPassword) {
      throw new ValidationError('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(data.new_password, this.SALT_ROUNDS);

    // Update password
    await UserModel.updatePassword(userId, newPasswordHash);

    logger.info(`Password changed for user: ${userId}`);

    return {
      success: true,
      message: 'Password changed successfully',
    };
  }

  /**
   * Request password reset
   */
  static async requestPasswordReset(phoneNumber: string): Promise<{ success: boolean; message: string }> {
    // Check if user exists
    const user = await UserModel.findByPhone(phoneNumber);
    if (!user) {
      // Don't reveal if user exists for security
      return {
        success: true,
        message: 'If the phone number exists, a reset OTP will be sent',
      };
    }

    // Send OTP
    await OTPService.sendOTP(phoneNumber, 'password_reset');

    logger.info(`Password reset requested for user: ${user.id}`);

    return {
      success: true,
      message: 'Password reset OTP sent',
    };
  }

  /**
   * Confirm password reset
   */
  static async confirmPasswordReset(data: IResetPasswordConfirmRequest): Promise<{ success: boolean; message: string }> {
    // Verify OTP
    const result = await OTPService.verifyOTP(data.phone_number, data.otp, 'password_reset');
    if (!result.valid) {
      throw new ValidationError(result.message);
    }

    // Find user
    const user = await UserModel.findByPhone(data.phone_number);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(data.new_password, this.SALT_ROUNDS);

    // Update password
    await UserModel.updatePassword(user.id, newPasswordHash);

    logger.info(`Password reset confirmed for user: ${user.id}`);

    return {
      success: true,
      message: 'Password reset successfully',
    };
  }

  /**
   * Logout user (invalidate tokens)
   * In a real implementation, you would blacklist the tokens
   */
  static async logout(userId: string): Promise<{ success: boolean; message: string }> {
    logger.info(`User logged out: ${userId}`);
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  // ============================================
  // ADMIN UTILITY METHODS
  // ============================================

  /**
   * Retry virtual account provisioning for existing users
   * Admin utility to provision virtual accounts for users who missed it
   */
  static async retryVirtualAccountProvisioning(
    userId: string,
    options?: { split_code?: string; subaccount?: string }
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await UserModel.findById(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      await VirtualAccountService.provisionVirtualAccount(userId, options);
      logger.info(`Virtual account provisioned for user: ${userId}`);
      return { success: true, message: 'Virtual account provisioned successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to provision virtual account for user ${userId}:`, error);
      return { success: false, message: `Failed to provision: ${errorMessage}` };
    }
  }

  /**
   * Retry subaccount creation for a driver (admin utility)
   */
  static async retryDriverSubaccountCreation(
    driverId: string
  ): Promise<{ success: boolean; message: string; subaccount_code?: string }> {
    try {
      const driver = await DriverModel.getById(driverId);
      if (!driver) {
        return { success: false, message: 'Driver not found' };
      }

      if (!driver.bank_code || !driver.account_number) {
        return { success: false, message: 'Driver has no bank details. Please update bank details first.' };
      }

      const result = await SubaccountService.retryFailedSubaccount(driverId);

      if (result.success) {
        return {
          success: true,
          message: 'Subaccount created successfully',
          subaccount_code: result.subaccount_code,
        };
      } else {
        return {
          success: false,
          message: result.message || 'Failed to create subaccount',
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to retry subaccount creation for driver ${driverId}:`, error);
      return { success: false, message: `Failed to create subaccount: ${errorMessage}` };
    }
  }

  /**
   * Update passenger KYC status (admin utility)
   */
  static async updatePassengerKYC(
    userId: string,
    status: 'pending' | 'verified' | 'failed',
    verifiedBy?: string,
    failureReason?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await UserModel.findById(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const passenger = await PassengerModel.getProfile(userId);
      if (!passenger) {
        return { success: false, message: 'Passenger profile not found' };
      }

      await PassengerModel.updateKYCStatus(userId, status, verifiedBy, failureReason);
      logger.info(`KYC status updated for passenger ${userId}: ${status}`);
      return { success: true, message: `KYC status updated to ${status}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to update KYC status for user ${userId}:`, error);
      return { success: false, message: `Failed to update KYC: ${errorMessage}` };
    }
  }

  /**
   * Submit BVN for KYC verification
   */
  static async submitBVN(userId: string, bvn: string): Promise<{ success: boolean; message: string }> {
    try {
      // Validate BVN format
      if (!this.validateBVN(bvn)) {
        return { success: false, message: 'Invalid BVN format. BVN must be 11 digits.' };
      }

      const user = await UserModel.findById(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const passenger = await PassengerModel.getProfile(userId);
      if (!passenger) {
        return { success: false, message: 'Passenger profile not found' };
      }

      await PassengerModel.submitBVN(userId, bvn);
      logger.info(`BVN submitted for passenger ${userId}`);
      return { success: true, message: 'BVN submitted successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to submit BVN for user ${userId}:`, error);
      return { success: false, message: `Failed to submit BVN: ${errorMessage}` };
    }
  }

  /**
   * Submit NIN for KYC verification
   */
  static async submitNIN(userId: string, nin: string): Promise<{ success: boolean; message: string }> {
    try {
      // Validate NIN format
      if (!this.validateNIN(nin)) {
        return { success: false, message: 'Invalid NIN format. NIN must be 11 digits.' };
      }

      const user = await UserModel.findById(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const passenger = await PassengerModel.getProfile(userId);
      if (!passenger) {
        return { success: false, message: 'Passenger profile not found' };
      }

      await PassengerModel.submitNIN(userId, nin);
      logger.info(`NIN submitted for passenger ${userId}`);
      return { success: true, message: 'NIN submitted successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to submit NIN for user ${userId}:`, error);
      return { success: false, message: `Failed to submit NIN: ${errorMessage}` };
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Validate BVN (Bank Verification Number)
   * BVN must be exactly 11 digits
   */
  private static validateBVN(bvn: string): boolean {
    return /^[0-9]{11}$/.test(bvn);
  }

  /**
   * Validate NIN (National Identification Number)
   * NIN must be exactly 11 digits
   */
  private static validateNIN(nin: string): boolean {
    return /^[0-9]{11}$/.test(nin);
  }

  /**
   * Get default split configuration from environment or database
   */
  private static async getDefaultSplitConfig(): Promise<{ split_code?: string; subaccount?: string } | undefined> {
    try {
      // Check if default split is configured in database
      const pool = (await import('../config/database')).default;
      const result = await pool.query(
        `SELECT value FROM platform_configuration 
         WHERE key = 'default_dva_split_config' AND category = 'payment'`
      );

      if (result.rows.length > 0) {
        const config = result.rows[0].value;
        return typeof config === 'string' ? JSON.parse(config) : config;
      }

      // Fallback to environment variables
      const splitCode = process.env.DEFAULT_DVA_SPLIT_CODE;
      const subaccount = process.env.DEFAULT_DVA_SUBACCOUNT;

      if (splitCode || subaccount) {
        return { split_code: splitCode, subaccount };
      }

      return undefined;
    } catch (error) {
      logger.warn('Failed to get default split configuration:', error);
      return undefined;
    }
  }

  /**
   * Get driver registration status (helper for frontend)
   */
  static async getDriverRegistrationStatus(userId: string): Promise<{
    hasBankDetails: boolean;
    hasSubaccount: boolean;
    subaccountStatus: string | null;
    isComplete: boolean;
  }> {
    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      return {
        hasBankDetails: false,
        hasSubaccount: false,
        subaccountStatus: null,
        isComplete: false,
      };
    }

    const hasBankDetails = !!(driver.bank_code && driver.account_number);
    const hasSubaccount = !!(driver.subaccount_code && driver.subaccount_status === 'active');

    return {
      hasBankDetails,
      hasSubaccount,
      subaccountStatus: driver.subaccount_status || null,
      isComplete: hasBankDetails && hasSubaccount,
    };
  }
}

export default AuthService;