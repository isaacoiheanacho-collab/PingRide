import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import logger from '../utils/logger';
import pool from '../config/database';

export class AdminKycReviewController {
  // ============================================
  // IDENTITY REVIEW (Phase 2C)
  // ============================================

  /**
   * GET /api/v1/admin/kyc/identity/pending
   * List driver identity submissions awaiting admin review.
   */
  async listPendingIdentity(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = (page - 1) * limit;

    try {
      const result = await pool.query(
        `SELECT
           d.id              AS driver_id,
           d.user_id         AS driver_user_id,
           d.first_name,
           d.last_name,
           d.driver_license_number,
           d.driver_license_expiry,
           d.license_photo_url,
           d.license_back_url,
           d.nin,
           d.nin_id_card_url,
           d.bvn,
           d.date_of_birth,
           d.selfie_url,
           d.identity_submitted_at,
           d.identity_review_notes,
           u.phone_number,
           u.email
         FROM driver_profiles d
         JOIN users u ON d.user_id = u.id
         WHERE d.identity_fully_verified = FALSE
           AND d.identity_submitted_at IS NOT NULL
           AND d.identity_reviewed_at IS NULL
         ORDER BY d.identity_submitted_at ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const countResult = await pool.query(
        `SELECT COUNT(*) AS total
         FROM driver_profiles d
         WHERE d.identity_fully_verified = FALSE
           AND d.identity_submitted_at IS NOT NULL
           AND d.identity_reviewed_at IS NULL`
      );

      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      return ApiResponseHandler.success(res, result.rows, {
        meta: {
          timestamp: new Date().toISOString(),
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('List pending identity reviews failed:', { adminId, error: msg });
      return ApiResponseHandler.error(
        res,
        'ADMIN_KYC_IDENTITY_LIST_ERROR',
        msg,
        400
      );
    }
  }

  /**
   * PATCH /api/v1/admin/kyc/identity/:driverId/review
   * Approve or reject a driver's identity submission.
   *
   * Body:
   *   decision: 'approve' | 'reject'
   *   notes?: string (required on reject)
   *   license_verified?: boolean
   *   nin_verified?: boolean
   *   bvn_verified?: boolean
   */
  async reviewIdentity(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { driverId } = req.params;
    const driverIdStr = Array.isArray(driverId) ? driverId[0] : driverId;
    const { decision, notes, license_verified, nin_verified, bvn_verified } =
      req.body;

    try {
      const driverRow = await pool.query(
        'SELECT id, identity_submitted_at, identity_fully_verified FROM driver_profiles WHERE id = $1',
        [driverIdStr]
      );
      if (driverRow.rows.length === 0) {
        return ApiResponseHandler.notFound(res, 'Driver not found');
      }

      const driver = driverRow.rows[0];
      if (!driver.identity_submitted_at) {
        return ApiResponseHandler.validationError(
          res,
          'Driver has not submitted identity documents'
        );
      }

      if (decision === 'approve') {
        const lv = license_verified !== undefined ? license_verified : true;
        const nv = nin_verified !== undefined ? nin_verified : true;
        const bv = bvn_verified !== undefined ? bvn_verified : true;

        if (!lv || !nv || !bv) {
          return ApiResponseHandler.validationError(
            res,
            'Cannot fully approve unless license, NIN, and BVN are all verified'
          );
        }

        await pool.query(
          `UPDATE driver_profiles
           SET license_verified = TRUE,
               nin_verified = TRUE,
               bvn_verified = TRUE,
               identity_fully_verified = TRUE,
               identity_verified_at = NOW(),
               identity_reviewed_at = NOW(),
               identity_reviewed_by = $1,
               identity_review_notes = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [adminId, notes || 'Approved by admin', driverIdStr]
        );

        logger.info(`Identity approved for driver ${driverIdStr} by admin ${adminId}`);
        return ApiResponseHandler.success(res, { driver_id: driverIdStr, decision: 'approve' }, {
          message: 'Identity approved',
        });
      } else if (decision === 'reject') {
        if (!notes || notes.trim().length === 0) {
          return ApiResponseHandler.validationError(res, 'Rejection reason is required');
        }

        await pool.query(
          `UPDATE driver_profiles
           SET license_verified = FALSE,
               nin_verified = FALSE,
               bvn_verified = FALSE,
               identity_fully_verified = FALSE,
               identity_verified_at = NULL,
               identity_reviewed_at = NOW(),
               identity_reviewed_by = $1,
               identity_review_notes = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [adminId, notes, driverIdStr]
        );

        logger.warn(`Identity rejected for driver ${driverIdStr} by admin ${adminId}: ${notes}`);
        return ApiResponseHandler.success(res, { driver_id: driverIdStr, decision: 'reject' }, {
          message: 'Identity rejected',
        });
      } else {
        return ApiResponseHandler.validationError(res, 'Invalid decision');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Review identity failed:', { adminId, driverIdStr, error: msg });
      return ApiResponseHandler.error(res, 'ADMIN_KYC_IDENTITY_REVIEW_ERROR', msg, 400);
    }
  }

  // ============================================
  // VEHICLE DOCUMENT REVIEW (Phase 2D)
  // ============================================

  /**
   * GET /api/v1/admin/kyc/vehicle/pending
   * List vehicle compliance submissions awaiting admin review.
   */
  async listPendingVehicles(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = (page - 1) * limit;

    try {
      const result = await pool.query(
        `SELECT
           v.id              AS vehicle_id,
           v.driver_id,
           v.registration_number AS plate_number,
           v.make,
           v.model,
           v.year,
           v.poc_document_url,
           v.vehicle_license_url,
           v.roadworthiness_document_url,
           v.hackney_permit_url,
           v.insurance_document_url,
           v.insurance_policy_number,
           v.insurance_provider,
           v.insurance_expiry,
           v.compliance_submitted_at,
           v.compliance_notes,
           d.first_name,
           d.last_name,
           d.user_id          AS driver_user_id,
           u.phone_number,
           u.email
         FROM vehicles v
         JOIN driver_profiles d ON v.driver_id = d.id
         JOIN users u ON d.user_id = u.id
         WHERE v.compliance_fully_verified = FALSE
           AND v.compliance_submitted_at IS NOT NULL
           AND v.compliance_reviewed_at IS NULL
         ORDER BY v.compliance_submitted_at ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const countResult = await pool.query(
        `SELECT COUNT(*) AS total
         FROM vehicles v
         WHERE v.compliance_fully_verified = FALSE
           AND v.compliance_submitted_at IS NOT NULL
           AND v.compliance_reviewed_at IS NULL`
      );

      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      return ApiResponseHandler.success(res, result.rows, {
        meta: {
          timestamp: new Date().toISOString(),
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('List pending vehicle reviews failed:', { adminId, error: msg });
      return ApiResponseHandler.error(
        res,
        'ADMIN_KYC_VEHICLE_LIST_ERROR',
        msg,
        400
      );
    }
  }

  /**
   * PATCH /api/v1/admin/kyc/vehicle/:vehicleId/documents/:documentType/review
   * Approve or reject an individual vehicle document.
   *
   * documentType: 'poc' | 'vehicle_license' | 'roadworthiness' | 'hackney_permit' | 'insurance'
   * Body: { decision: 'approve' | 'reject', notes?: string }
   *
   * When ALL five documents are approved, `compliance_fully_verified` flips to TRUE,
   * `plate_verified` is set to TRUE (admin implicitly approved the plate when
   * signing off on all documents), and `compliance_reviewed_at` is set.
   */
  async reviewVehicleDocument(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { vehicleId, documentType } = req.params;
    const vehicleIdStr = Array.isArray(vehicleId) ? vehicleId[0] : vehicleId;
    const docType = Array.isArray(documentType) ? documentType[0] : documentType;

    const { decision, notes } = req.body;

    // Map document_type → column name
    const columnMap: Record<string, string> = {
      poc: 'poc_verified',
      vehicle_license: 'vehicle_license_verified',
      roadworthiness: 'roadworthiness_verified',
      hackney_permit: 'hackney_permit_verified',
      insurance: 'insurance_verified',
    };

    const column = columnMap[docType];
    if (!column) {
      return ApiResponseHandler.validationError(
        res,
        'Invalid documentType. Must be one of: poc, vehicle_license, roadworthiness, hackney_permit, insurance'
      );
    }

    if (decision === 'reject' && (!notes || notes.trim().length === 0)) {
      return ApiResponseHandler.validationError(res, 'Rejection reason is required');
    }

    try {
      const vehicleRow = await pool.query(
        'SELECT id, compliance_submitted_at FROM vehicles WHERE id = $1',
        [vehicleIdStr]
      );
      if (vehicleRow.rows.length === 0) {
        return ApiResponseHandler.notFound(res, 'Vehicle not found');
      }
      if (!vehicleRow.rows[0].compliance_submitted_at) {
        return ApiResponseHandler.validationError(
          res,
          'Vehicle compliance has not been submitted'
        );
      }

      // Update the individual column
      await pool.query(
        `UPDATE vehicles SET ${column} = $1, updated_at = NOW() WHERE id = $2`,
        [decision === 'approve', vehicleIdStr]
      );

      // Re-check: are all 5 docs approved?
      const allRow = await pool.query(
        `SELECT
           plate_verified,
           poc_verified,
           vehicle_license_verified,
           roadworthiness_verified,
           hackney_permit_verified,
           insurance_verified
         FROM vehicles
         WHERE id = $1`,
        [vehicleIdStr]
      );

      const r = allRow.rows[0];
      const allApproved =
        r.poc_verified === true &&
        r.vehicle_license_verified === true &&
        r.roadworthiness_verified === true &&
        r.hackney_permit_verified === true &&
        r.insurance_verified === true;

      if (allApproved) {
        // Admin signing off on all five documents is treated as plate approval.
        // plate_verified is set here so the flag accurately reflects reality.
        await pool.query(
          `UPDATE vehicles
           SET compliance_fully_verified = TRUE,
               compliance_verified_at = NOW(),
               compliance_reviewed_at = NOW(),
               compliance_reviewed_by = $1,
               compliance_notes = $2,
               plate_verified = TRUE,
               plate_verified_at = COALESCE(plate_verified_at, NOW()),
               updated_at = NOW()
           WHERE id = $3`,
          [adminId, notes || 'All documents approved', vehicleIdStr]
        );
        logger.info(`Vehicle ${vehicleIdStr} fully compliant (approved by ${adminId})`);
      } else if (decision === 'reject') {
        await pool.query(
          `UPDATE vehicles
           SET compliance_fully_verified = FALSE,
               compliance_reviewed_at = NOW(),
               compliance_reviewed_by = $1,
               compliance_notes = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [adminId, `${docType} rejected: ${notes}`, vehicleIdStr]
        );
        logger.warn(
          `Vehicle ${vehicleIdStr} document ${docType} rejected by ${adminId}: ${notes}`
        );
      }

      return ApiResponseHandler.success(
        res,
        {
          vehicle_id: vehicleIdStr,
          document_type: docType,
          decision,
          compliance_fully_verified: allApproved,
        },
        {
          message: allApproved
            ? 'Document approved. Vehicle is now fully compliant.'
            : `Document ${decision === 'approve' ? 'approved' : 'rejected'}.`,
        }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Review vehicle document failed:', {
        adminId,
        vehicleIdStr,
        docType,
        error: msg,
      });
      return ApiResponseHandler.error(res, 'ADMIN_KYC_VEHICLE_REVIEW_ERROR', msg, 400);
    }
  }
}

export default AdminKycReviewController;