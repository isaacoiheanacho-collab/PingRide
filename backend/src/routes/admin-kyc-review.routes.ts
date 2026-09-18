import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { validationSchemas } from '../utils/validator';
import AdminKycReviewController from '../controllers/admin-kyc-review.controller';

const router = Router();
const controller = new AdminKycReviewController();

// ============================================
// ADMIN KYC REVIEW ROUTES (Phase 2C + 2D)
//
// Manual review queue for driver identity (2C) and vehicle
// compliance (2D). All routes require an authenticated user
// with role 'admin' or 'operations'.
//
// Note: IUser role enum does not include 'super_admin' —
// the roles with review privileges are:
//   'admin'       — KYC administrators
//   'operations'  — operations staff with KYC review authority
// ============================================

// ============================================
// IDENTITY REVIEW (Phase 2C)
// ============================================

/**
 * GET /api/v1/admin/kyc/identity/pending
 * List driver identity submissions awaiting admin review.
 * Auth: admin, operations.
 */
router.get(
  '/identity/pending',
  authenticate,
  authorize('admin', 'operations'),
  controller.listPendingIdentity.bind(controller)
);

/**
 * PATCH /api/v1/admin/kyc/identity/:driverId/review
 * Approve or reject a driver's identity submission.
 * Auth: admin, operations.
 */
router.patch(
  '/identity/:driverId/review',
  authenticate,
  authorize('admin', 'operations'),
  validate(validationSchemas.identityReview),
  controller.reviewIdentity.bind(controller)
);

// ============================================
// VEHICLE DOCUMENT REVIEW (Phase 2D)
// ============================================

/**
 * GET /api/v1/admin/kyc/vehicle/pending
 * List vehicle compliance submissions awaiting admin review.
 * Auth: admin, operations.
 */
router.get(
  '/vehicle/pending',
  authenticate,
  authorize('admin', 'operations'),
  controller.listPendingVehicles.bind(controller)
);

/**
 * PATCH /api/v1/admin/kyc/vehicle/:vehicleId/documents/:documentType/review
 * Approve or reject an individual vehicle document.
 * Auth: admin, operations.
 */
router.patch(
  '/vehicle/:vehicleId/documents/:documentType/review',
  authenticate,
  authorize('admin', 'operations'),
  validate(validationSchemas.vehicleDocumentReview),
  controller.reviewVehicleDocument.bind(controller)
);

export default router;