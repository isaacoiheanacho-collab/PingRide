import bcrypt from 'bcrypt';
import { UserModel } from '../models/user.model';
import { PassengerModel } from '../models/passenger.model';
import { DriverModel } from '../models/driver.model';
import { OTPService } from './otp.service';
import { generateTokens, verifyRefreshToken } from '../utils/jwt';
import { VirtualAccountService } from './virtual-account.service';
import { SubaccountService } from './subaccount.service';
import {
  IRegisterRequest,
  ILoginRequest,
  IAuthResponse,
  IRefreshTokenRequest,
  IChangePasswordRequest,
  IResetPasswordConfirmRequest,
  IOnboardingState,
} from '../types';
import { ConflictError, UnauthorizedError, ValidationError, NotFoundError } from '../middleware/error.middleware';
import logger from '../utils/logger';

export class AuthService {
  private static readonly SALT_ROUNDS = 12;

  /**
   * Phase 1 — General Registration
   *
   * Collects only: first_name, last_name, phone_number, password, user_type.
   * Creates the user in `pending_verification` state and a minimal profile.
   * Sends OTP. Does NOT provision DVA, subaccount, KYC, or issue tokens.
   * Phase 1 completes when the user verifies their OTP.
   */
  static async register(data: IRegisterRequest): Promise<IAuthResponse> {
    // ============================================
    // STEP 1: DUPLICATE CHECK
    // ============================================

    const phoneExists = await UserModel.phoneExists(data.phone_number);
    if (phoneExists) {
      throw new ConflictError('Phone number already registered');
    }

    // ============================================
    // STEP 2: CREATE USER
    // ============================================

    const passwordHash = await bcrypt.hash(data.password, this.SALT_ROUNDS);

    const user = await UserModel.create(
      data.phone_number,
      passwordHash,
      data.user_type
    );

    // ============================================
    // STEP 3: CREATE MINIMAL PROFILE
    // Only first_name + last_name.
    // KYC / bank / license / vehicle fields arrive in Phase 2+.
    // ============================================

    if (data.user_type === 'passenger') {
      try {
        await PassengerModel.createProfile(user.id, {
          first_name: data.first_name,
          last_name: data.last_name,
        });
        logger.info(`Minimal passenger profile created for user: ${user.id}`);
      } catch (error) {
        logger.error(`Failed to create passenger profile for user ${user.id}:`, error);
        // Don't block registration if profile creation fails;
        // the client can retry Phase 1 or an admin can repair it.
      }
    } else if (data.user_type === 'driver') {
      try {
        await DriverModel.create(user.id, {
          first_name: data.first_name,
          last_name: data.last_name,
        });
        logger.info(`Minimal driver profile created for user: ${user.id}`);
      } catch (error) {
        logger.error(`Failed to create driver profile for user ${user.id}:`, error);
        // Same as above — don't block registration.
      }
    }

    // ============================================
    // STEP 4: SEND OTP
    // ============================================

    await OTPService.sendOTP(data.phone_number, 'registration');

    // ============================================
    // STEP 5: RETURN
    // No tokens yet — they are issued after OTP verification.
    // ============================================

    logger.info(`User registered (Phase 1): ${user.id} (${user.phone_number}) [${user.role}]`);

    const onboarding: IOnboardingState = {
      phase: 'awaiting_otp',
      next_step: 'verify_otp',
      completed: false,
    };

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
      onboarding,
    };
  }

  /**
   * Verify OTP — completes Phase 1
   *
   * Activates the user, issues tokens, and returns the onboarding state
   * indicating which Phase 2 step is next (passenger_kyc or driver_bank).
   */
  static async verifyRegistrationOTP(
    phoneNumber: string,
    otp: string
  ): Promise<{
    success: boolean;
    user: {
      id: string;
      phone_number: string;
      email?: string;
      first_name: string;
      last_name: string;
      role: string;
      status: string;
    };
    tokens: ReturnType<typeof generateTokens>;
    onboarding: IOnboardingState;
  }> {
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

    // Activate user
    await UserModel.verifyPhone(user.id);

    // Reload so we get the fresh status
    const freshUser = await UserModel.findById(user.id);
    if (!freshUser) {
      throw new NotFoundError('User not found after verification');
    }

    // Fetch names from the profile created in Phase 1
    let firstName = '';
    let lastName = '';

    if (freshUser.role === 'passenger') {
      const profile = await PassengerModel.getProfile(freshUser.id);
      if (profile) {
        firstName = profile.first_name || '';
        lastName = profile.last_name || '';
      }
    } else if (freshUser.role === 'driver') {
      const profile = await DriverModel.getByUserId(freshUser.id);
      if (profile) {
        firstName = profile.first_name || '';
        lastName = profile.last_name || '';
      }
    }

    // Issue tokens now that the phone is verified
    const tokens = generateTokens(freshUser);

    // Next step depends on role
    const nextStep: IOnboardingState['next_step'] =
      freshUser.role === 'driver' ? 'driver_bank' : 'passenger_kyc';

    const onboarding: IOnboardingState = {
      phase: 'role_onboarding',
      next_step: nextStep,
      completed: false,
    };

    logger.info(`User verified (Phase 1 complete): ${freshUser.id} (${freshUser.phone_number})`);

    return {
      success: true,
      user: {
        id: freshUser.id,
        phone_number: freshUser.phone_number,
        email: freshUser.email,
        first_name: firstName,
        last_name: lastName,
        role: freshUser.role,
        status: freshUser.status,
      },
      tokens,
      onboarding,
    };
  }

  /**
   * Login user
   *
   * Accepts both `active` and `pending_verification` users. A pending user
   * receives tokens so they can complete OTP verification inside the app
   * (avoids re-registration and avoids the SMS cost of sending another OTP
   * just to hold a session).
   *
   * Sensitive routes are gated by the `requireVerified` middleware — the
   * tokens a pending user receives only unlock profile and onboarding
   * endpoints.
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

    // Reject suspended / deactivated / locked outright.
    // Allow 'active' and 'pending_verification'.
    if (user.status !== 'active' && user.status !== 'pending_verification') {
      throw new UnauthorizedError(`Account ${user.status}`);
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

    // STEP 8: Compute onboarding state (derived)
    // Pending users get `awaiting_otp` before any role-specific step.
    const onboarding = await this.getOnboardingState(user.id, user.role, user.status, {
      subaccountStatus,
    });

    logger.info(`User logged in: ${user.id} (${user.phone_number}) [status=${user.status}]`);

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
      onboarding,
    };
  }

  /**
   * Refresh access token
   *
   * Accepts both `active` and `pending_verification` users so a pending
   * user's token can be refreshed without forcing them to log in again.
   * Suspended / deactivated / locked users are still rejected.
   */
  static async refreshToken(
    data: IRefreshTokenRequest
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const decoded = verifyRefreshToken(data.refresh_token);
    if (!decoded) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Find user
    const user = await UserModel.findById(decoded.sub);
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Allow both 'active' and 'pending_verification'.
    if (user.status !== 'active' && user.status !== 'pending_verification') {
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
   * Derive onboarding state from existing data.
   *
   * Precedence:
   *   1. `pending_verification` → awaiting_otp / verify_otp
   *   2. passenger role         → passenger_kyc (until DVA active)
   *   3. driver role            → driver_bank (until subaccount active)
   *   4. admin/support/ops      → completed
   *
   * Phase 1 tasks are complete once the user has verified their OTP.
   * Phase 2 tasks are tracked by downstream records
   * (virtual_accounts for passengers, driver_profiles.subaccount_code
   * for drivers). No schema change required.
   */
  private static async getOnboardingState(
    userId: string,
    role: string,
    status: string,
    opts?: { subaccountStatus?: string }
  ): Promise<IOnboardingState> {
    // 1. Pending verification short-circuits everything else.
    if (status === 'pending_verification') {
      return {
        phase: 'awaiting_otp',
        next_step: 'verify_otp',
        completed: false,
      };
    }

    // 2. Passenger Phase 2 = DVA provisioning
    if (role === 'passenger') {
      const pool = (await import('../config/database')).default;
      const result = await pool.query(
        `SELECT 1 FROM virtual_accounts WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [userId]
      );
      const hasDVA = (result.rowCount ?? 0) > 0;

      return {
        phase: hasDVA ? 'completed' : 'role_onboarding',
        next_step: hasDVA ? null : 'passenger_kyc',
        completed: hasDVA,
      };
    }

    // 3. Driver Phase 2 = subaccount creation
    if (role === 'driver') {
      const hasActiveSubaccount = opts?.subaccountStatus === 'active';

      return {
        phase: hasActiveSubaccount ? 'completed' : 'role_onboarding',
        next_step: hasActiveSubaccount ? null : 'driver_bank',
        completed: hasActiveSubaccount,
      };
    }

    // 4. Admin / support / operations — nothing to onboard
    return {
      phase: 'completed',
      next_step: null,
      completed: true,
    };
  }
}

export default AuthService;