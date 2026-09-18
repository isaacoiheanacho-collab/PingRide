import { Router } from 'express';
import { authenticate, requireVerified, authorize } from '../middleware/auth.middleware';
import PaymentController from '../controllers/payment.controller';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const paymentController = new PaymentController();

// Validation schemas
const initializePaymentSchema = Joi.object({
  ride_id: Joi.string().uuid().required(),
  amount: Joi.number().positive().required(),
  payment_method: Joi.string().valid('wallet').required(),
  email: Joi.string().email().optional(),
});

const verifyPaymentSchema = Joi.object({
  reference: Joi.string().required(),
});

const processPaymentSchema = Joi.object({
  payment_id: Joi.string().uuid().required(),
  amount: Joi.number().positive().optional(),
});

const refundSchema = Joi.object({
  amount: Joi.number().positive().required(),
  reason: Joi.string().required(),
});

// ============================================
// PAYMENT ROUTES (verified users)
// ============================================

router.post(
  '/initialize',
  authenticate,
  requireVerified(),
  validate(initializePaymentSchema),
  paymentController.initializePayment.bind(paymentController)
);

router.post(
  '/verify',
  authenticate,
  requireVerified(),
  validate(verifyPaymentSchema),
  paymentController.verifyPayment.bind(paymentController)
);

router.post(
  '/process',
  authenticate,
  requireVerified(),
  validate(processPaymentSchema),
  paymentController.processPayment.bind(paymentController)
);

router.post(
  '/:paymentId/refund',
  authenticate,
  requireVerified(),
  validate(refundSchema),
  paymentController.createRefund.bind(paymentController)
);

router.get(
  '/passenger',
  authenticate,
  requireVerified(),
  paymentController.getPaymentsByPassenger.bind(paymentController)
);

router.get(
  '/driver',
  authenticate,
  requireVerified(),
  paymentController.getPaymentsByDriver.bind(paymentController)
);

// Static capability check — safe for any authenticated user.
// Not gated by requireVerified.
router.get(
  '/config/status',
  authenticate,
  paymentController.getConfigStatus.bind(paymentController)
);

router.get(
  '/:paymentId',
  authenticate,
  requireVerified(),
  paymentController.getPaymentById.bind(paymentController)
);

router.get(
  '/:paymentId/details',
  authenticate,
  requireVerified(),
  paymentController.getPaymentWithDetails.bind(paymentController)
);

// ============================================
// ADMIN PAYMENT ROUTES (Admin only)
// ============================================

router.get(
  '/admin/summary',
  authenticate,
  requireVerified(),
  authorize('admin', 'super_admin'),
  paymentController.getPaymentSummary.bind(paymentController)
);

router.get(
  '/admin/all',
  authenticate,
  requireVerified(),
  authorize('admin', 'super_admin'),
  paymentController.getAllPayments.bind(paymentController)
);

export default router;