import { Router } from 'express';
import UserController from '../controllers/user.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const userController = new UserController();

// Validation schemas
const updateProfileSchema = Joi.object({
  first_name: Joi.string().min(1).max(100).optional(),
  last_name: Joi.string().min(1).max(100).optional(),
  email: Joi.string().email().optional(),
  preferred_language: Joi.string().min(2).max(10).optional(),
  profile_photo_url: Joi.string().uri().optional(),
  date_of_birth: Joi.date().optional(),
  gender: Joi.string().valid('male', 'female', 'other', 'prefer_not_to_say').optional(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid('active', 'suspended', 'deactivated', 'locked').required(),
  reason: Joi.string().optional(),
});

// Protected routes (authenticated)
router.get('/profile', authenticate, userController.getProfile.bind(userController));
router.patch('/profile', authenticate, validate(updateProfileSchema), userController.updateProfile.bind(userController));

// Admin only routes
router.get('/admin/users', authenticate, authorize('admin', 'super_admin'), userController.getUsers.bind(userController));
router.get('/admin/users/search', authenticate, authorize('admin', 'super_admin'), userController.searchUsers.bind(userController));
router.get('/admin/users/:id', authenticate, authorize('admin', 'super_admin'), userController.getUserById.bind(userController));
router.patch('/admin/users/:id/status', authenticate, authorize('admin', 'super_admin'), validate(updateStatusSchema), userController.updateStatus.bind(userController));
router.delete('/admin/users/:id', authenticate, authorize('admin', 'super_admin'), userController.deleteUser.bind(userController));

export default router;