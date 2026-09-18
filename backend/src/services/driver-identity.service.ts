import { UserModel } from '../models/user.model';
import { DriverModel } from '../models/driver.model';
import {
  IDriverIdentitySubmission,
  IDriverIdentityStatusResponse,
} from '../types';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../middleware/error.middleware';
import logger from '../utils/logger';
import pool from '../config/database';

/**
 * Phase 2C — Driver Identity Service (Manual Review Workflow)
 *
 * This service collects driver identity documents and hands them off to
 * an admin review queue. Actual verification is performed manually by an
 * admin using official Nigerian government portals:
 *
 *   - Driver's License  → FRSC NDL Portal (ndlverification.frsc.gov.ng)
 *                          or USSD *338*LicenseNumber#
 *   - NIN              → NIMC Self-Service Portal (nimc.gov.ng)
 *   - BVN              → Bank USSD / NIBSS
 *   - Selfie           → Visual match against license photo
 *
 * The service itself does NOT call any external KYC API. It only persists
 * the submission and marks the driver's identity record as
 * `pending_admin_review`.
 */
export class DriverIdentityService {
  // ============================================
  // SUBMIT IDENTITY DOCUMENTS
  // ============================================

  /**
   * Phase 2C — Driver submits identity documents for admin review.
   *
   * Pre-conditions:
   *   1. User must exist and be a driver.
   *   2. Driver profile must exist.
   *   3. Identity must NOT already be fully verified (idempotency guard).
   *   4. Driver must have completed Phase 2B (subaccount active) — optional
   *      but recommended gate. We log a warning if missing but do not block.
   *
   * On success:
   *   - Persists license number/expiry, NIN, BVN, DOB, photo URLs
   *   - Sets verification flags to FALSE
   *   - Marks status as `pending_admin_review`
   *   - Returns the current identity status
   */
  static async submitIdentity(
    driverUserId: string,
    data: IDriverIdentitySubmission
  ): Promise<IDriverIdentityStatusResponse> {
    // 1. Load user + driver
    const user = await UserModel.findById(driverUserId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (user.role !== 'driver') {
      throw new ValidationError('Only drivers can submit identity documents');
    }

    const driver = await DriverModel.getByUserId(driverUserId);
    if (!driver) {
      throw new NotFoundError('Driver profile not found');
    }

    // 2. Idempotency guard — if already fully verified, reject
    if (driver.identity_fully_verified === true) {
      throw new ConflictError(
        'Identity already verified. Contact support if you need to re-submit.'
      );
    }

    // 3. Soft check: Phase 2B should ideally be done first (subaccount active)
    if (driver.subaccount_status !== 'active') {
      logger.warn(
        `Driver ${driver.id} is submitting identity without an active subaccount. ` +
          'Phase 2B (bank/subaccount) appears incomplete.'
      );
    }

    // 4. Persist submission
    try {
      await pool.query(
        `UPDATE driver_profiles
         SET driver_license_number = $1,
             driver_license_expiry = $2,
             license_photo_url = $3,
             license_back_url = $4,
             nin = $5,
             nin_id_card_url = $6,
             bvn = $7,
             date_of_birth = $8,
             selfie_url = $9,
             license_verified = FALSE,
             nin_verified = FALSE,
             bvn_verified = FALSE,
             identity_fully_verified = FALSE,
             identity_verified_at = NULL,
             identity_review_notes = 'awaiting_admin_review',
             identity_submitted_at = NOW(),
             identity_reviewed_at = NULL,
             identity_reviewed_by = NULL,
             updated_at = NOW()
         WHERE id = $10`,
        [
          data.license_number,
          data.license_expiry_date,
          data.license_front_url,
          data.license_back_url,
          data.nin,
          data.nin_id_card_url,
          data.bvn,
          data.date_of_birth,
          data.selfie_url,
          driver.id,
        ]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Failed to persist driver identity submission for ${driver.id}: ${msg}`);
      throw new Error('Failed to save identity submission. Please try again.');
    }

    logger.info(
      `Phase 2C identity submitted by driver ${driver.id} — pending admin review`
    );

    // 5. Return current status
    return this.getIdentityStatus(driverUserId);
  }

  // ============================================
  // GET IDENTITY STATUS
  // ============================================

  /**
   * Phase 2C — Fetch the driver's current identity submission + verification state.
   *
   * Derives `submission_status` from combination of:
   *   - `identity_review_notes` (set to 'awaiting_admin_review' on submit)
   *   - `identity_fully_verified` (TRUE when admin approves)
   *   - `identity_verified_at` (timestamp of approval)
   *   - `identity_rejected_at` / `identity_rejection_reason` (set on reject)
   *
   * `needs_recheck` is TRUE when:
   *   - Identity is approved, AND
   *   - Approval is older than 365 days (annual license renewal window)
   *
   * `current stage` returns the driver's next onboarding step:
   *   - `driver_identity` if not yet approved
   *   - `driver_vehicle`  if identity approved but vehicle compliance incomplete
   *   - `completed`       if both identity + vehicle compliance approved
   */
  static async getIdentityStatus(
    driverUserId: string
  ): Promise<IDriverIdentityStatusResponse> {
    // 1. Load user + driver
    const user = await UserModel.findById(driverUserId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (user.role !== 'driver') {
      throw new ValidationError('Only drivers can access identity status');
    }

    const driver = await DriverModel.getByUserId(driverUserId);
    if (!driver) {
      throw new NotFoundError('Driver profile not found');
    }

    // 2. Determine submission status
    //    We look at driver_profiles fields set by submitIdentity() + admin review.
    const row = await this.fetchIdentityRow(driver.id);

    const licenseVerified = row?.license_verified === true;
    const ninVerified = row?.nin_verified === true;
    const bvnVerified = row?.bvn_verified === true;
    const fullyVerified = row?.identity_fully_verified === true;
    const submittedAt = row?.identity_submitted_at ?? null;
    const reviewedAt = row?.identity_reviewed_at ?? null;
    const reviewNotes: string | null = row?.identity_review_notes ?? null;

    let submissionStatus: IDriverIdentityStatusResponse['submission_status'] =
      'not_submitted';

    if (fullyVerified) {
      submissionStatus = 'approved';
    } else if (reviewedAt) {
      // Was reviewed but not fully verified → rejected
      submissionStatus = 'rejected';
    } else if (submittedAt) {
      submissionStatus = 'pending_admin_review';
    }

    // 3. Determine needs_recheck
    //    Annual renewal window — trigger re-verification after 365 days.
    let needsRecheck = false;
    if (fullyVerified && reviewedAt) {
      const approvedAt = new Date(reviewedAt);
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      needsRecheck = approvedAt < oneYearAgo;
    }

    // 4. Determine next step
    //    Vehicle compliance is checked in Phase 2D — we look at the primary
    //    vehicle's compliance status if a vehicle exists.
    const vehicleComplianceApproved = await this.isVehicleComplianceApproved(driver.id);

    let nextStep: IDriverIdentityStatusResponse['next_step'] = null;
    if (!fullyVerified) {
      nextStep = 'driver_identity';
    } else if (!vehicleComplianceApproved) {
      nextStep = 'driver_vehicle';
    } else {
      nextStep = 'completed';
    }

    return {
      submission_status: submissionStatus,
      license_verified: licenseVerified,
      nin_verified: ninVerified,
      bvn_verified: bvnVerified,
      identity_fully_verified: fullyVerified,
      needs_recheck: needsRecheck,
      rejection_reason:
        submissionStatus === 'rejected' ? reviewNotes : null,
      submitted_at: submittedAt ? new Date(submittedAt).toISOString() : null,
      reviewed_at: reviewedAt ? new Date(reviewedAt).toISOString() : null,
      next_step: nextStep,
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Fetch identity-related columns from driver_profiles.
   */
  private static async fetchIdentityRow(driverId: string): Promise<any | null> {
    const result = await pool.query(
      `SELECT
         license_verified,
         nin_verified,
         bvn_verified,
         identity_fully_verified,
         identity_submitted_at,
         identity_reviewed_at,
         identity_review_notes
       FROM driver_profiles
       WHERE id = $1`,
      [driverId]
    );
    return result.rows[0] || null;
  }

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

export default DriverIdentityService;