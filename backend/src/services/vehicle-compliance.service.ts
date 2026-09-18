import { UserModel } from '../models/user.model';
import { DriverModel } from '../models/driver.model';
import { VehicleModel } from '../models/vehicle.model';
import {
  IVehicleComplianceSubmission,
  IVehicleComplianceStatusResponse,
} from '../types';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../middleware/error.middleware';
import logger from '../utils/logger';
import pool from '../config/database';

/**
 * Phase 2D — Vehicle Compliance Service (Manual Review Workflow)
 *
 * Collects vehicle compliance documents and hands them off to an admin
 * review queue. Actual verification is performed manually by an admin
 * using official Nigerian portals:
 *
 *   - Plate Number / Vehicle Registration  → AutoReg (verify.autoreg.ng)
 *                                            or State VIS portal
 *   - Insurance                            → NIID (askniid.org)
 *                                            or USSD *565*11#
 *   - Roadworthiness                       → State VIS portal / AutoReg
 *   - Hackney Permit                       → State VIS portal / AutoReg
 *   - Proof of Ownership (POC)             → Manual review against vehicle
 *
 * The service itself does NOT call any external API. It only persists the
 * submission and marks each document as `pending_admin_review`.
 */
export class VehicleComplianceService {
  // ============================================
  // SUBMIT VEHICLE COMPLIANCE DOCUMENTS
  // ============================================

  /**
   * Phase 2D — Driver submits vehicle compliance documents for admin review.
   *
   * Pre-conditions:
   *   1. User must exist and be a driver.
   *   2. Driver profile must exist.
   *   3. Vehicle must exist AND belong to this driver.
   *   4. Vehicle compliance must NOT already be fully verified (idempotency guard).
   *
   * On success:
   *   - Persists plate number, insurance policy, and all 5 document URLs
   *   - Sets all *_verified flags to FALSE
   *   - Marks status as `pending_admin_review`
   *   - Returns the current vehicle compliance status
   */
  static async submitVehicle(
    driverUserId: string,
    vehicleId: string,
    data: IVehicleComplianceSubmission
  ): Promise<IVehicleComplianceStatusResponse> {
    // 1. Load user + driver
    const user = await UserModel.findById(driverUserId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (user.role !== 'driver') {
      throw new ValidationError('Only drivers can submit vehicle compliance documents');
    }

    const driver = await DriverModel.getByUserId(driverUserId);
    if (!driver) {
      throw new NotFoundError('Driver profile not found');
    }

    // 2. Verify vehicle exists and belongs to this driver
    const vehicle = await VehicleModel.getById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found');
    }
    if (vehicle.driver_id !== driver.id) {
      throw new ValidationError('Vehicle does not belong to this driver');
    }

    // 3. Idempotency guard — if already fully verified, reject
    if (vehicle.compliance_fully_verified === true) {
      throw new ConflictError(
        'Vehicle compliance already verified. Contact support if you need to re-submit.'
      );
    }

    // 4. Soft check: identity should ideally be approved first (Phase 2C).
    if (driver.identity_fully_verified !== true) {
      logger.warn(
        `Driver ${driver.id} is submitting vehicle compliance before identity is approved. ` +
          'Phase 2C (identity) appears incomplete.'
      );
    }

    // 5. Persist submission
    try {
      await pool.query(
        `UPDATE vehicles
         SET registration_number = $1,
             plate_owner_name = NULL,
             plate_owner_match = NULL,
             poc_document_url = $2,
             vehicle_license_url = $3,
             roadworthiness_document_url = $4,
             hackney_permit_url = $5,
             insurance_document_url = $6,
             insurance_policy_number = $7,
             insurance_provider = $8,
             insurance_expiry = $9,
             plate_verified = FALSE,
             poc_verified = FALSE,
             vehicle_license_verified = FALSE,
             roadworthiness_verified = FALSE,
             hackney_permit_verified = FALSE,
             insurance_verified = FALSE,
             compliance_fully_verified = FALSE,
             compliance_verified_at = NULL,
             compliance_notes = 'awaiting_admin_review',
             compliance_submitted_at = NOW(),
             compliance_reviewed_at = NULL,
             compliance_reviewed_by = NULL,
             updated_at = NOW()
         WHERE id = $10`,
        [
          data.plate_number,
          data.poc_document_url,
          data.vehicle_license_url,
          data.roadworthiness_document_url,
          data.hackney_permit_url,
          data.insurance_document_url,
          data.insurance_policy_number,
          data.insurance_provider || null,
          data.insurance_expiry || null,
          vehicleId,
        ]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(
        `Failed to persist vehicle compliance submission for vehicle ${vehicleId}: ${msg}`
      );
      throw new Error('Failed to save vehicle compliance submission. Please try again.');
    }

    logger.info(
      `Phase 2D vehicle compliance submitted for vehicle ${vehicleId} by driver ${driver.id} — pending admin review`
    );

    // 6. Return current status
    return this.getVehicleStatus(vehicleId);
  }

  // ============================================
  // GET VEHICLE COMPLIANCE STATUS
  // ============================================

  /**
   * Phase 2D — Fetch the vehicle's current compliance submission + verification state.
   *
   * Derives `submission_status` from combination of:
   *   - `compliance_notes` (set to 'awaiting_admin_review' on submit)
   *   - `compliance_fully_verified` (TRUE when admin approves all documents)
   *   - `compliance_reviewed_at` (timestamp of final approval or rejection)
   *
   * `current stage` returns the next onboarding step:
   *   - `driver_identity` if identity is still incomplete
   *   - `driver_vehicle`  if identity is approved but vehicle compliance is not
   *   - `completed`       if both are approved
   */
  static async getVehicleStatus(
    vehicleId: string
  ): Promise<IVehicleComplianceStatusResponse> {
    // 1. Load vehicle
    const vehicle = await VehicleModel.getById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle not found');
    }

    // 2. Load driver so we can determine next_step
    const driver = await DriverModel.getById(vehicle.driver_id);

    // 3. Fetch compliance columns
    const row = await this.fetchComplianceRow(vehicleId);

    const plateVerified = row?.plate_verified === true;
    const pocVerified = row?.poc_verified === true;
    const vehicleLicenseVerified = row?.vehicle_license_verified === true;
    const roadworthinessVerified = row?.roadworthiness_verified === true;
    const hackneyVerified = row?.hackney_permit_verified === true;
    const insuranceVerified = row?.insurance_verified === true;
    const fullyVerified = row?.compliance_fully_verified === true;
    const submittedAt = row?.compliance_submitted_at ?? null;
    const reviewedAt = row?.compliance_reviewed_at ?? null;
    const reviewNotes: string | null = row?.compliance_notes ?? null;

    let submissionStatus: IVehicleComplianceStatusResponse['submission_status'] =
      'not_submitted';

    if (fullyVerified) {
      submissionStatus = 'approved';
    } else if (reviewedAt && !fullyVerified) {
      // Reviewed but not fully verified → rejected
      submissionStatus = 'rejected';
    } else if (submittedAt) {
      submissionStatus = 'pending_admin_review';
    }

    // 4. Determine next_step (identity takes priority)
    const identityApproved = driver?.identity_fully_verified === true;

    let nextStep: IVehicleComplianceStatusResponse['next_step'] = null;
    if (!identityApproved) {
      nextStep = 'driver_identity';
    } else if (!fullyVerified) {
      nextStep = 'driver_vehicle';
    } else {
      nextStep = 'completed';
    }

    return {
      submission_status: submissionStatus,
      plate_verified: plateVerified,
      poc_verified: pocVerified,
      vehicle_license_verified: vehicleLicenseVerified,
      roadworthiness_verified: roadworthinessVerified,
      hackney_permit_verified: hackneyVerified,
      insurance_verified: insuranceVerified,
      compliance_fully_verified: fullyVerified,
      rejection_reason: submissionStatus === 'rejected' ? reviewNotes : null,
      submitted_at: submittedAt ? new Date(submittedAt).toISOString() : null,
      reviewed_at: reviewedAt ? new Date(reviewedAt).toISOString() : null,
      next_step: nextStep,
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Fetch compliance-related columns from vehicles.
   */
  private static async fetchComplianceRow(vehicleId: string): Promise<any | null> {
    const result = await pool.query(
      `SELECT
         plate_verified,
         poc_verified,
         vehicle_license_verified,
         roadworthiness_verified,
         hackney_permit_verified,
         insurance_verified,
         compliance_fully_verified,
         compliance_submitted_at,
         compliance_reviewed_at,
         compliance_notes
       FROM vehicles
       WHERE id = $1`,
      [vehicleId]
    );
    return result.rows[0] || null;
  }
}

export default VehicleComplianceService;