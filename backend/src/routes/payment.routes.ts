import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import PaymentController from '../controllers/payment.controller';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const paymentController = new PaymentController();

// Validation schemas
const initializePaymentSchema = Joi.object({
  ride_id: Joi.string().uuid().required(),
  amount: Joi.number().positive().required(),
  payment_method: Joi.string().valid('card', 'bank_transfer', 'wallet', 'cash', 'promo_code').required(),
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
// PAYMENT ROUTES (All authenticated)
// ============================================

router.post('/initialize', authenticate, validate(initializePaymentSchema), paymentController.initializePayment.bind(paymentController));
router.post('/verify', authenticate, validate(verifyPaymentSchema), paymentController.verifyPayment.bind(paymentController));
router.post('/process', authenticate, validate(processPaymentSchema), paymentController.processPayment.bind(paymentController));
router.post('/:paymentId/refund', authenticate, validate(refundSchema), paymentController.createRefund.bind(paymentController));

router.get('/passenger', authenticate, paymentController.getPaymentsByPassenger.bind(paymentController));
router.get('/driver', authenticate, paymentController.getPaymentsByDriver.bind(paymentController));
router.get('/config/status', authenticate, paymentController.getConfigStatus.bind(paymentController));
router.get('/:paymentId', authenticate, paymentController.getPaymentById.bind(paymentController));
router.get('/:paymentId/details', authenticate, paymentController.getPaymentWithDetails.bind(paymentController));

// ============================================
// ADMIN PAYMENT ROUTES (Admin only)
// ============================================

router.get('/admin/summary', authenticate, authorize('admin', 'super_admin'), paymentController.getPaymentSummary.bind(paymentController));
router.get('/admin/all', authenticate, authorize('admin', 'super_admin'), paymentController.getAllPayments.bind(paymentController));

export default router;