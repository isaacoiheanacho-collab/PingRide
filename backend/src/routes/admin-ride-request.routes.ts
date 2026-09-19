import { Router } from 'express';
import { authenticate, requireVerified, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import AdminRideRequestController from '../controllers/admin-ride-request.controller';
import Joi from 'joi';

const router = Router();
const controller = new AdminRideRequestController();

// ============================================
// VALIDATION
// ============================================

const sweepSchema = Joi.object({
  olderThanMinutes: Joi.number()
    .min(0)
    .max(10080) // 7 days cap — prevents accidentally sweeping the whole table
    .optional()
    .messages({
      'number.min': 'olderThanMinutes must be 0 or greater',
      'number.max': 'olderThanMinutes must be 10080 (7 days) or less',
    }),
});

// ============================================
// ADMIN RIDE REQUEST MAINTENANCE
//
// Admin/operations-only cleanup endpoints. Sweep expires stale ride_requests
// and cascades to their orphaned pending bids. On-demand only — not scheduled.
// ============================================

/**
 * POST /api/v1/admin/ride-requests/sweep
 *
 * Expire stale ride requests and cascade to their pending bids.
 * Body: { olderThanMinutes?: number } (default 5)
 * Auth: admin, operations.
 */
router.post(
  '/sweep',
  authenticate,
  requireVerified(),
  authorize('admin', 'operations'),
  validate(sweepSchema),
  controller.sweep.bind(controller)
);

export default router;