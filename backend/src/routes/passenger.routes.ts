import { Router } from 'express';
import PassengerController from '../controllers/passenger.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const passengerController = new PassengerController();

// Validation schemas
const updateProfileSchema = Joi.object({
  first_name: Joi.string().min(1).max(100).optional(),
  last_name: Joi.string().min(1).max(100).optional(),
  profile_photo_url: Joi.string().uri().optional(),
  date_of_birth: Joi.date().optional(),
  gender: Joi.string().valid('male', 'female', 'other', 'prefer_not_to_say').optional(),
});

const updatePreferencesSchema = Joi.object({
  preferred_vehicle_type: Joi.string().valid('standard', 'premium', 'executive').optional(),
  music_preference: Joi.string().valid('quiet', 'radio', 'podcast', 'any').optional(),
  conversation_preference: Joi.string().valid('quiet', 'friendly', 'business', 'any').optional(),
  max_wait_time: Joi.number().min(0).max(60).optional(),
  notify_promotions: Joi.boolean().optional(),
  notify_ride_updates: Joi.boolean().optional(),
});

const createLocationSchema = Joi.object({
  label: Joi.string().min(1).max(50).required(),
  address: Joi.string().required(),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  is_default: Joi.boolean().optional(),
});

const updateLocationSchema = Joi.object({
  label: Joi.string().min(1).max(50).optional(),
  address: Joi.string().optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
  is_default: Joi.boolean().optional(),
});

// All passenger routes require authentication
router.use(authenticate);

// Profile routes
router.get('/profile', passengerController.getProfile.bind(passengerController));
router.patch('/profile', validate(updateProfileSchema), passengerController.updateProfile.bind(passengerController));

// Preferences routes
router.get('/preferences', passengerController.getPreferences.bind(passengerController));
router.patch('/preferences', validate(updatePreferencesSchema), passengerController.updatePreferences.bind(passengerController));

// Stats routes
router.get('/stats', passengerController.getStats.bind(passengerController));

// Saved locations routes
router.get('/locations', passengerController.getSavedLocations.bind(passengerController));
router.post('/locations', validate(createLocationSchema), passengerController.createSavedLocation.bind(passengerController));
router.patch('/locations/:id', validate(updateLocationSchema), passengerController.updateSavedLocation.bind(passengerController));
router.delete('/locations/:id', passengerController.deleteSavedLocation.bind(passengerController));

export default router;