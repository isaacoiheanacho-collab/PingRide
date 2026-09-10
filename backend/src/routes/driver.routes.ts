import { Router } from 'express';
import DriverController from '../controllers/driver.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import Joi from 'joi';

const router = Router();
const driverController = new DriverController();

// ============================================
// VALIDATION SCHEMAS
// ============================================

const createProfileSchema = Joi.object({
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required(),
  profile_photo_url: Joi.string().uri().optional(),
  date_of_birth: Joi.date().optional(),
  driver_license_number: Joi.string().required(),
  driver_license_expiry: Joi.date().required(),
  address: Joi.string().optional(),
  state_of_origin: Joi.string().optional(),
  emergency_contact_name: Joi.string().optional(),
  emergency_contact_phone: Joi.string().optional(),
  has_air_conditioning: Joi.boolean().optional(),
  has_working_stereo: Joi.boolean().optional(),
  interior_air_freshener: Joi.boolean().optional(),
  // Bank details for driver subaccount
  bank_code: Joi.string().optional(),
  account_number: Joi.string().optional(),
});

const updateProfileSchema = Joi.object({
  first_name: Joi.string().min(1).max(100).optional(),
  last_name: Joi.string().min(1).max(100).optional(),
  profile_photo_url: Joi.string().uri().optional(),
  date_of_birth: Joi.date().optional(),
  driver_license_number: Joi.string().optional(),
  driver_license_expiry: Joi.date().optional(),
  address: Joi.string().optional(),
  state_of_origin: Joi.string().optional(),
  emergency_contact_name: Joi.string().optional(),
  emergency_contact_phone: Joi.string().optional(),
  has_air_conditioning: Joi.boolean().optional(),
  has_working_stereo: Joi.boolean().optional(),
  interior_air_freshener: Joi.boolean().optional(),
});

const createVehicleSchema = Joi.object({
  registration_number: Joi.string().required(),
  make: Joi.string().required(),
  model: Joi.string().required(),
  year: Joi.number().min(1900).max(2099).optional(),
  colour: Joi.string().optional(),
  vehicle_type: Joi.string().valid('standard', 'premium', 'executive', 'luxury').required(),
  is_primary: Joi.boolean().optional(),
  seat_count: Joi.number().min(1).max(20).optional(),
  registration_document_url: Joi.string().uri().optional(),
  insurance_document_url: Joi.string().uri().optional(),
  roadworthiness_document_url: Joi.string().uri().optional(),
  registration_expiry: Joi.date().optional(),
  insurance_expiry: Joi.date().optional(),
  roadworthiness_expiry: Joi.date().optional(),
});

const updateVehicleSchema = Joi.object({
  registration_number: Joi.string().optional(),
  make: Joi.string().optional(),
  model: Joi.string().optional(),
  year: Joi.number().min(1900).max(2099).optional(),
  colour: Joi.string().optional(),
  vehicle_type: Joi.string().valid('standard', 'premium', 'executive', 'luxury').optional(),
  is_primary: Joi.boolean().optional(),
  seat_count: Joi.number().min(1).max(20).optional(),
  registration_document_url: Joi.string().uri().optional(),
  insurance_document_url: Joi.string().uri().optional(),
  roadworthiness_document_url: Joi.string().uri().optional(),
  registration_expiry: Joi.date().optional(),
  insurance_expiry: Joi.date().optional(),
  roadworthiness_expiry: Joi.date().optional(),
});

const updateLocationSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  speed_kmh: Joi.number().min(0).optional(),
  heading: Joi.number().min(0).max(360).optional(),
  accuracy_meters: Joi.number().min(0).optional(),
});

const submitDocumentSchema = Joi.object({
  document_type: Joi.string().valid('national_id', 'passport', 'driver_license', 'utility_bill', 'profile_photo', 'insurance', 'vehicle_registration', 'roadworthiness').required(),
  document_number: Joi.string().optional(),
  document_url: Joi.string().uri().required(),
  expiry_date: Joi.date().optional(),
});

const rejectKYCSchema = Joi.object({
  reason: Joi.string().required(),
});

// ============================================
// BANK & SUBACCOUNT VALIDATION SCHEMAS (NEW)
// ============================================

const updateBankDetailsSchema = Joi.object({
  bank_code: Joi.string().required(),
  account_number: Joi.string().length(10).pattern(/^[0-9]{10}$/).required()
    .messages({
      'string.length': 'Account number must be exactly 10 digits',
      'string.pattern.base': 'Account number must contain only numbers',
      'any.required': 'Account number is required',
    }),
});

const validateBankSchema = Joi.object({
  bank_code: Joi.string().required(),
  account_number: Joi.string().length(10).pattern(/^[0-9]{10}$/).required()
    .messages({
      'string.length': 'Account number must be exactly 10 digits',
      'string.pattern.base': 'Account number must contain only numbers',
      'any.required': 'Account number is required',
    }),
});

const batchSubaccountSchema = Joi.object({
  driver_ids: Joi.array().items(Joi.string().uuid()).min(1).required()
    .messages({
      'array.min': 'At least one driver ID is required',
      'array.items': 'Invalid driver ID format',
      'any.required': 'driver_ids array is required',
    }),
});

// ============================================
// ALL DRIVER ROUTES REQUIRE AUTHENTICATION
// ============================================

router.use(authenticate);

// ============================================
// PROFILE ROUTES
// ============================================

router.get('/profile', driverController.getProfile.bind(driverController));
router.post('/profile', validate(createProfileSchema), driverController.createProfile.bind(driverController));
router.patch('/profile', validate(updateProfileSchema), driverController.updateProfile.bind(driverController));

// ============================================
// BANK & SUBACCOUNT ROUTES (NEW)
// ============================================

// Get list of banks for dropdown
router.get('/banks', driverController.getBanks.bind(driverController));

// Get popular banks
router.get('/banks/popular', driverController.getPopularBanks.bind(driverController));

// Get driver bank details
router.get('/bank-details', driverController.getBankDetails.bind(driverController));

// Update bank details and create subaccount
router.post('/bank-details', validate(updateBankDetailsSchema), driverController.updateBankDetails.bind(driverController));

// Validate bank account without saving
router.post('/validate-bank', validate(validateBankSchema), driverController.validateBankAccount.bind(driverController));

// Get subaccount details from Paystack
router.get('/subaccount', driverController.getSubaccountDetails.bind(driverController));

// ============================================
// VEHICLE ROUTES
// ============================================

router.get('/vehicles', driverController.getVehicles.bind(driverController));
router.post('/vehicles', validate(createVehicleSchema), driverController.addVehicle.bind(driverController));
router.patch('/vehicles/:vehicleId', validate(updateVehicleSchema), driverController.updateVehicle.bind(driverController));
router.delete('/vehicles/:vehicleId', driverController.deleteVehicle.bind(driverController));

// ============================================
// AVAILABILITY ROUTES
// ============================================

router.post('/online', driverController.goOnline.bind(driverController));
router.post('/offline', driverController.goOffline.bind(driverController));

// ============================================
// LOCATION ROUTES
// ============================================

router.post('/location', validate(updateLocationSchema), driverController.updateLocation.bind(driverController));

// ============================================
// KYC & DOCUMENT ROUTES
// ============================================

router.get('/kyc', driverController.getKYCStatus.bind(driverController));
router.get('/documents', driverController.getDocuments.bind(driverController));
router.post('/documents', validate(submitDocumentSchema), driverController.submitDocument.bind(driverController));

// ============================================
// ADMIN ROUTES
// ============================================

// Admin: KYC Management
router.patch('/admin/kyc/:driverId/approve', authorize('admin', 'super_admin'), driverController.approveKYC.bind(driverController));
router.patch('/admin/kyc/:driverId/reject', authorize('admin', 'super_admin'), validate(rejectKYCSchema), driverController.rejectKYC.bind(driverController));

// Admin: Driver Management
router.get('/admin/active', authorize('admin', 'super_admin'), driverController.getActiveDrivers.bind(driverController));
router.get('/admin/near', authorize('admin', 'super_admin'), driverController.getDriversNear.bind(driverController));

// Admin: Subaccount Management
router.get('/admin/no-subaccount', authorize('admin', 'super_admin'), driverController.getDriversWithoutSubaccount.bind(driverController));
router.post('/admin/batch-subaccount', authorize('admin', 'super_admin'), validate(batchSubaccountSchema), driverController.batchCreateSubaccounts.bind(driverController));
router.post('/admin/retry-subaccount/:driverId', authorize('admin', 'super_admin'), driverController.retrySubaccount.bind(driverController));

export default router;