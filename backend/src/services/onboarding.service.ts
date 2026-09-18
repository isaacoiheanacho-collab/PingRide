import { UserModel } from '../models/user.model';
import { DriverModel } from '../models/driver.model';
import { BankService } from './bank.service';
import { SubaccountService } from './subaccount.service';
import { VirtualAccountService } from './virtual-account.service';
import {
  IDriverOnboardingRequest,
  IPassengerOnboardingRequest,
  IOnboardingStatusResponse,
} from '../types';
import { ValidationError, NotFoundError } from '../middleware/error.middleware';
import logger from '../utils/logger';
import pool from '../config/database';

export class OnboardingService {
  /**
   * Derive the current onboarding state for a user.
   * No schema change — everything is derived from existing records.
   *
   * Driver flow (Phase 2):
   *   1. Phase 2B — bank / subaccount    → 'driver_bank'
   *   2. Phase 2C — identity KYC          → 'driver_identity'
   *   3. Phase 2D — vehicle compliance    → 'driver_vehicle'
   *   4. All approved                     → phase 'completed', next_step null
   *
   * Passenger flow (Phase 2A — DVA):
   *   - No active DVA                     → 'passenger_kyc'
   *   - Active DVA exists                 → phase 'completed', next_step null
   */
  static async getStatus(userId: string): Promise<IOnboardingStatusResponse> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // ============================================
    // DRIVER BRANCH
    // ============================================
    if (user.role === 'driver') {
      const driver = await DriverModel.getByUserId(userId);
      if (!driver) {
        throw new NotFoundError('Driver profile not found');
      }

      const hasActiveSubaccount = driver.subaccount_status === 'active';
      const identityApproved = driver.identity_fully_verified === true;
      const vehicleComplianceApproved = await this.isVehicleComplianceApproved(
        driver.id
      );

      // ------------------------------------------------------------
      // Step 1 — Phase 2B: bank / subaccount
      // ------------------------------------------------------------
      if (!hasActiveSubaccount) {
        return {
          role: 'driver',
          phase: 'role_onboarding',
          next_step: 'driver_bank',
          completed: false,
          details: {
            has_bank_details: !!(driver.bank_code && driver.account_number),
            subaccount_status: driver.subaccount_status || null,
            identity_fully_verified: identityApproved,
            vehicle_compliance_approved: vehicleComplianceApproved,
          },
        };
      }

      // ------------------------------------------------------------
      // Step 2 — Phase 2C: identity KYC
      // ------------------------------------------------------------
      if (!identityApproved) {
        return {
          role: 'driver',
          phase: 'role_onboarding',
          next_step: 'driver_identity',
          completed: false,
          details: {
            subaccount_code: driver.subaccount_code || null,
            subaccount_status: driver.subaccount_status || null,
            identity_fully_verified: false,
            identity_submitted_at: driver.identity_submitted_at || null,
            identity_review_notes: driver.identity_review_notes || null,
            vehicle_compliance_approved: vehicleComplianceApproved,
          },
        };
      }

      // ------------------------------------------------------------
      // Step 3 — Phase 2D: vehicle compliance
      // ------------------------------------------------------------
      if (!vehicleComplianceApproved) {
        return {
          role: 'driver',
          phase: 'role_onboarding',
          next_step: 'driver_vehicle',
          completed: false,
          details: {
            subaccount_code: driver.subaccount_code || null,
            subaccount_status: driver.subaccount_status || null,
            identity_fully_verified: true,
            identity_verified_at: driver.identity_verified_at || null,
            vehicle_compliance_approved: false,
          },
        };
      }

      // ------------------------------------------------------------
      // Step 4 — All done
      // ------------------------------------------------------------
      return {
        role: 'driver',
        phase: 'completed',
        next_step: null,
        completed: true,
        details: {
          subaccount_code: driver.subaccount_code || null,
          subaccount_status: driver.subaccount_status || null,
          identity_fully_verified: true,
          identity_verified_at: driver.identity_verified_at || null,
          vehicle_compliance_approved: true,
        },
      };
    }

    // ============================================
    // PASSENGER BRANCH — DVA presence is the completion signal
    // ============================================
    if (user.role === 'passenger') {
      const row = await pool.query(
        `SELECT pa.virtual_account_id,
                va.status AS va_status,
                va.account_number,
                va.bank_name,
                va.account_name
         FROM passenger_profiles pa
         LEFT JOIN virtual_accounts va ON pa.virtual_account_id = va.id
         WHERE pa.user_id = $1`,
        [userId]
      );

      // No passenger profile yet — treat as pending Phase 2A.
      if (row.rows.length === 0) {
        return {
          role: 'passenger',
          phase: 'role_onboarding',
          next_step: 'passenger_kyc',
          completed: false,
          details: {
            has_profile: false,
          },
        };
      }

      const p = row.rows[0];
      const hasDVA = p.va_status === 'active';

      if (hasDVA) {
        return {
          role: 'passenger',
          phase: 'completed',
          next_step: null,
          completed: true,
          details: {
            virtual_account_number: p.account_number,
            virtual_account_bank: p.bank_name,
            virtual_account_name: p.account_name,
          },
        };
      }

      // No active DVA → still needs Phase 2A.
      return {
        role: 'passenger',
        phase: 'role_onboarding',
        next_step: 'passenger_kyc',
        completed: false,
        details: {
          has_dva: false,
        },
      };
    }

    // ============================================
    // ADMIN / SUPPORT / OPERATIONS — nothing to onboard
    // ============================================
    return {
      role: user.role as 'passenger' | 'driver',
      phase: 'completed',
      next_step: null,
      completed: true,
    };
  }

  /**
   * Phase 2A — Passenger BVN + bank → Paystack customer → identification → DVA.
   *
   * Steps:
   * 1. Verify role = passenger
   * 2. Idempotency — if DVA already active, return it
   * 3. Save email to users.email if not set
   * 4. Provision DVA via VirtualAccountService
   *    (customer → NIBSS identification → dedicated_account)
   * 5. Return DVA details + refreshed onboarding state
   *
   * No admin approval. No NIN. DVA issuance is the completion signal.
   */
  static async completePassengerKYC(
    userId: string,
    data: IPassengerOnboardingRequest
  ): Promise<{
    virtual_account: {
      account_number: string;
      bank_name: string;
      account_name: string;
    };
    onboarding: IOnboardingStatusResponse;
  }> {
    // 1. Load user, ensure role = passenger
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (user.role !== 'passenger') {
      throw new ValidationError('Only passengers can complete this step');
    }

    const passenger = await UserModel.getPassengerProfile(userId);
    if (!passenger) {
      throw new NotFoundError('Passenger profile not found');
    }

    // 2. Idempotency — if DVA already active, return it without calling Paystack
    const existingRow = await pool.query(
      `SELECT va.account_number, va.bank_name, va.account_name
       FROM passenger_profiles pa
       JOIN virtual_accounts va ON pa.virtual_account_id = va.id
       WHERE pa.user_id = $1 AND va.status = 'active'
       LIMIT 1`,
      [userId]
    );

    if (existingRow.rows.length > 0) {
      const existing = existingRow.rows[0];
      logger.info(
        `Passenger ${userId} already has active DVA ${existing.account_number}`
      );
      const onboarding = await this.getStatus(userId);
      return {
        virtual_account: {
          account_number: existing.account_number,
          bank_name: existing.bank_name,
          account_name: existing.account_name,
        },
        onboarding,
      };
    }

    // 3. Save email if not already set
    if (data.email && user.email !== data.email) {
      try {
        await UserModel.updateProfile(userId, { email: data.email });
        logger.info(`Email updated for passenger ${userId}`);
      } catch (err) {
        logger.warn(`Failed to save email for passenger ${userId}`, err);
      }
    }

    // 4. Provision DVA via Paystack — this runs the full chain:
    //    create customer → submit identification (BVN + bank) → issue DVA
    const virtualAccount = await VirtualAccountService.provisionVirtualAccount(
      userId,
      {
        preferred_bank: 'wema-bank',
        bvn: data.bvn,
        bank_account_number: data.bank_account_number,
        bank_code: data.bank_code,
        bank_name: data.bank_name,
        email: data.email,
        firstName: passenger.first_name,
        lastName: passenger.last_name,
      }
    );

    logger.info(
      `Phase 2A complete for passenger ${userId}: DVA ${virtualAccount.account_number}`
    );

    // 5. Return DVA details + refreshed onboarding state
    const onboarding = await this.getStatus(userId);

    return {
      virtual_account: {
        account_number: virtualAccount.account_number,
        bank_name: virtualAccount.bank_name,
        account_name: virtualAccount.account_name,
      },
      onboarding,
    };
  }

  /**
   * Phase 2B — Complete driver bank + subaccount creation.
   *
   * Steps:
   * 1. Verify role = driver
   * 2. If subaccount already active with same bank/account, return it (idempotent)
   * 3. Save email to users.email if not set
   * 4. Resolve bank account name via Paystack
   * 5. Compare resolved name vs Phase 1 name (flag mismatch, don't reject)
   * 6. Save bank details to driver_profiles
   * 7. Create Paystack subaccount
   * 8. Return subaccount_code + onboarding state
   */
  static async completeDriverBank(
    userId: string,
    data: IDriverOnboardingRequest
  ): Promise<{
    subaccount_code: string;
    account_name: string;
    name_match: boolean;
    onboarding: IOnboardingStatusResponse;
  }> {
    // 1. Load user + driver
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (user.role !== 'driver') {
      throw new ValidationError('Only drivers can complete this step');
    }

    const driver = await DriverModel.getByUserId(userId);
    if (!driver) {
      throw new NotFoundError('Driver profile not found');
    }

    // 2. Idempotency — if already active with same bank/account, return existing
    if (
      driver.subaccount_status === 'active' &&
      driver.subaccount_code &&
      driver.bank_code === data.settlement_bank_code &&
      driver.account_number === data.settlement_account_number
    ) {
      logger.info(
        `Driver ${driver.id} already has active subaccount ${driver.subaccount_code}`
      );
      const onboarding = await this.getStatus(userId);
      return {
        subaccount_code: driver.subaccount_code,
        account_name: driver.account_name || '',
        name_match: true,
        onboarding,
      };
    }

    // 3. Save email if not set
    if (data.email && user.email !== data.email) {
      try {
        await UserModel.updateProfile(userId, { email: data.email });
        logger.info(`Email updated for driver ${driver.id}`);
      } catch (err) {
        logger.warn(`Failed to save email for driver ${driver.id}`, err);
      }
    }

    // 4. Resolve bank account via Paystack
    const validation = await BankService.validateBankAccount(
      data.settlement_bank_code,
      data.settlement_account_number
    );

    if (!validation.valid || !validation.account_name) {
      throw new ValidationError(
        validation.message || 'Could not resolve bank account. Please check the details.'
      );
    }

    const resolvedName = validation.account_name.trim();
    const expectedName = `${driver.first_name} ${driver.last_name}`.trim().toLowerCase();
    const resolvedNameLower = resolvedName.toLowerCase();

    // 5. Loose name match — flag mismatch, don't reject
    const nameMatch =
      resolvedNameLower === expectedName ||
      resolvedNameLower.includes(driver.last_name.toLowerCase()) ||
      expectedName.includes(resolvedNameLower);

    if (!nameMatch) {
      logger.warn(
        `Driver ${driver.id} bank name mismatch: expected "${driver.first_name} ${driver.last_name}", got "${resolvedName}"`
      );
    }

    // 6. Save bank details to driver_profiles
    await DriverModel.updateBankDetails(driver.id, {
      bank_code: data.settlement_bank_code,
      account_number: data.settlement_account_number,
      account_name: resolvedName,
    });

    // 7. Create Paystack subaccount via SubaccountService
    const subaccountResult = await SubaccountService.createDriverSubaccount({
      driverId: driver.id,
      userId: user.id,
      firstName: driver.first_name,
      lastName: driver.last_name,
      bankCode: data.settlement_bank_code,
      accountNumber: data.settlement_account_number,
      accountName: resolvedName,
      phoneNumber: user.phone_number,
      email: data.email,
    });

    if (!subaccountResult.success || !subaccountResult.subaccount_code) {
      logger.error(
        `Subaccount creation failed for driver ${driver.id}: ${subaccountResult.message}`
      );
      throw new Error(
        subaccountResult.message ||
          'Failed to create subaccount. Please try again or contact support.'
      );
    }

    logger.info(
      `Phase 2B complete for driver ${driver.id}: subaccount ${subaccountResult.subaccount_code}`
    );

    // 8. Return subaccount_code + refreshed onboarding state
    const onboarding = await this.getStatus(userId);
    return {
      subaccount_code: subaccountResult.subaccount_code,
      account_name: resolvedName,
      name_match: nameMatch,
      onboarding,
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Determine whether the driver's primary vehicle compliance is fully approved.
   * Returns FALSE if no vehicle exists.
   */
  private static async isVehicleComplianceApproved(
    driverId: string
  ): Promise<boolean> {
    const result = await pool.query(
      `SELECT compliance_fully_verified
       FROM vehicles
       WHERE driver_id = $1
       ORDER BY is_primary DESC, created_at DESC
       LIMIT 1`,
      [driverId]
    );
    return result.rows[0]?.compliance_fully_verified === true;
  }
}

export default OnboardingService;