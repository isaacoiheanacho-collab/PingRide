import { Router } from 'express';
import AuthController from '../controllers/auth.controller';
import { validate } from '../middleware/validation.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { validationSchemas } from '../utils/validator';

const router = Router();
const authController = new AuthController();

// Public routes
router.post(
  '/register',
  validate(validationSchemas.register),
  authController.register.bind(authController)
);

router.post(
  '/verify-otp',
  validate(validationSchemas.verifyOTP),
  authController.verifyOTP.bind(authController)
);

router.post(
  '/resend-otp',
  validate(validationSchemas.resendOTP),
  authController.resendOTP.bind(authController)
);

router.post(
  '/login',
  validate(validationSchemas.login),
  authController.login.bind(authController)
);

router.post(
  '/refresh',
  validate(validationSchemas.refreshToken),
  authController.refreshToken.bind(authController)
);

router.post(
  '/reset-password',
  validate(validationSchemas.resetPasswordRequest),
  authController.requestPasswordReset.bind(authController)
);

router.post(
  '/reset-password-confirm',
  validate(validationSchemas.resetPasswordConfirm),
  authController.confirmPasswordReset.bind(authController)
);

// Protected routes (require authentication)
router.post(
  '/logout',
  authenticate,
  authController.logout.bind(authController)
);

router.post(
  '/change-password',
  authenticate,
  validate(validationSchemas.changePassword),
  authController.changePassword.bind(authController)
);

export default router;