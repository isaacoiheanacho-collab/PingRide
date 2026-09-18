import Joi from 'joi';

// Phone number validation for Nigeria (+234)
const phoneRegex = /^\+234[0-9]{10}$/;

// Password validation: min 8 chars, at least one uppercase, lowercase, number, special char
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])/;

// Name validation: letters, spaces, hyphens, apostrophes
const nameRegex = /^[a-zA-Z\s\-']+$/;

// ============================================
// BVN/NIN VALIDATION HELPERS
// ============================================

/**
 * Validate BVN (Bank Verification Number)
 * BVN must be exactly 11 digits
 */
export const validateBVN = (bvn: string): boolean => {
  if (!bvn) return false;
  if (!/^[0-9]{11}$/.test(bvn)) return false;
  return true;
};

/**
 * Validate NIN (National Identification Number)
 * NIN must be exactly 11 digits
 */
export const validateNIN = (nin: string): boolean => {
  if (!nin) return false;
  if (!/^[0-9]{11}$/.test(nin)) return false;
  return true;
};

/**
 * Format BVN to remove any non-digit characters
 */
export const formatBVN = (bvn: string): string => {
  return bvn.replace(/\D/g, '');
};

/**
 * Format NIN to remove any non-digit characters
 */
export const formatNIN = (nin: string): string => {
  return nin.replace(/\D/g, '');
};

// ============================================
// BVN/NIN JOI VALIDATION SCHEMAS
// ============================================

export const bvnValidation = Joi.string()
  .length(11)
  .pattern(/^[0-9]{11}$/)
  .required()
  .messages({
    'string.length': 'BVN must be exactly 11 digits',
    'string.pattern.base': 'BVN must contain only numbers (0-9)',
    'any.required': 'BVN is required',
  });

export const ninValidation = Joi.string()
  .length(11)
  .pattern(/^[0-9]{11}$/)
  .required()
  .messages({
    'string.length': 'NIN must be exactly 11 digits',
    'string.pattern.base': 'NIN must contain only numbers (0-9)',
    'any.required': 'NIN is required',
  });

export const optionalBvnValidation = Joi.string()
  .length(11)
  .pattern(/^[0-9]{11}$/)
  .optional()
  .messages({
    'string.length': 'BVN must be exactly 11 digits',
    'string.pattern.base': 'BVN must contain only numbers (0-9)',
  });

export const optionalNinValidation = Joi.string()
  .length(11)
  .pattern(/^[0-9]{11}$/)
  .optional()
  .messages({
    'string.length': 'NIN must be exactly 11 digits',
    'string.pattern.base': 'NIN must contain only numbers (0-9)',
  });

// ============================================
// URL VALIDATION HELPER
// ============================================

const uploadedFileUrlSchema = Joi.string()
  .uri({ scheme: ['http', 'https'] })
  .max(1000)
  .required()
  .messages({
    'string.uri': 'Must be a valid URL',
    'string.max': 'URL is too long',
    'any.required': 'URL is required',
  });

// ============================================
// MAIN VALIDATION SCHEMAS
// ============================================

export const validationSchemas = {
  // ============================================
  // PHASE 1 — GENERAL REGISTRATION
  // ============================================
  register: Joi.object({
    first_name: Joi.string()
      .pattern(nameRegex)
      .min(1)
      .max(100)
      .required()
      .messages({
        'string.pattern.base': 'First name can only contain letters, spaces, hyphens, and apostrophes',
        'string.min': 'First name is required',
        'string.max': 'First name must be at most 100 characters',
        'any.required': 'First name is required',
      }),
    last_name: Joi.string()
      .pattern(nameRegex)
      .min(1)
      .max(100)
      .required()
      .messages({
        'string.pattern.base': 'Last name can only contain letters, spaces, hyphens, and apostrophes',
        'string.min': 'Last name is required',
        'string.max': 'Last name must be at most 100 characters',
        'any.required': 'Last name is required',
      }),
    phone_number: Joi.string()
      .pattern(phoneRegex)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be a valid Nigerian number (+234XXXXXXXXXX)',
        'any.required': 'Phone number is required',
      }),
    password: Joi.string()
      .min(8)
      .pattern(passwordRegex)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters',
        'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character',
        'any.required': 'Password is required',
      }),
    user_type: Joi.string()
      .valid('passenger', 'driver')
      .required()
      .messages({
        'any.only': 'User type must be either passenger or driver',
        'any.required': 'User type is required',
      }),
  }),

  // ============================================
  // PHASE 2A — PASSENGER KYC / DVA
  // Collects BVN + bank details for Paystack customer creation,
  // NIBSS identification, and DVA issuance (Wema Bank).
  // No NIN. No admin approval.
  // ============================================
  passengerOnboarding: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'A valid email address is required',
        'any.required': 'Email is required',
      }),
    bvn: Joi.string()
      .length(11)
      .pattern(/^[0-9]{11}$/)
      .required()
      .messages({
        'string.length': 'BVN must be exactly 11 digits',
        'string.pattern.base': 'BVN must contain only digits',
        'any.required': 'BVN is required',
      }),
    bank_account_number: Joi.string()
      .length(10)
      .pattern(/^[0-9]{10}$/)
      .required()
      .messages({
        'string.length': 'Account number must be exactly 10 digits',
        'string.pattern.base': 'Account number must contain only digits',
        'any.required': 'Account number is required',
      }),
    bank_code: Joi.string()
      .min(1)
      .max(10)
      .required()
      .messages({
        'any.required': 'Bank code is required',
      }),
    bank_name: Joi.string()
      .min(1)
      .max(100)
      .required()
      .messages({
        'any.required': 'Bank name is required',
      }),
  }),

  // ============================================
  // PHASE 2B — DRIVER BANK / SUBACCOUNT
  // ============================================
  driverOnboarding: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'A valid email address is required',
        'any.required': 'Email is required',
      }),
    settlement_bank_name: Joi.string()
      .min(1)
      .max(100)
      .required()
      .messages({
        'string.min': 'Bank name is required',
        'any.required': 'Bank name is required',
      }),
    settlement_bank_code: Joi.string()
      .min(1)
      .max(10)
      .required()
      .messages({
        'any.required': 'Bank code is required',
      }),
    settlement_account_number: Joi.string()
      .length(10)
      .pattern(/^[0-9]{10}$/)
      .required()
      .messages({
        'string.length': 'Account number must be exactly 10 digits',
        'string.pattern.base': 'Account number must contain only digits',
        'any.required': 'Account number is required',
      }),
  }),

  // ============================================
  // NDPA — CONSENT RECORDING
  // ============================================
  recordConsent: Joi.object({
    consent_type: Joi.string()
      .valid(
        'terms_of_service',
        'privacy_policy',
        'kyc_data_sharing',
        'liveness_capture'
      )
      .required()
      .messages({
        'any.only':
          'consent_type must be one of: terms_of_service, privacy_policy, kyc_data_sharing, liveness_capture',
        'any.required': 'consent_type is required',
      }),
    consent_version: Joi.string()
      .min(1)
      .max(20)
      .required()
      .messages({
        'string.min': 'consent_version is required',
        'string.max': 'consent_version must be at most 20 characters',
        'any.required': 'consent_version is required',
      }),
  }),

  // ============================================
  // PHASE 2C — DRIVER IDENTITY SUBMISSION
  // ============================================
  driverIdentitySubmission: Joi.object({
    license_number: Joi.string()
      .min(3)
      .max(50)
      .required()
      .messages({
        'string.min': 'License number is required',
        'string.max': 'License number is too long',
        'any.required': 'License number is required',
      }),
    license_expiry_date: Joi.date()
      .iso()
      .required()
      .messages({
        'date.format': 'License expiry date must be a valid date (YYYY-MM-DD)',
        'any.required': 'License expiry date is required',
      }),
    license_front_url: uploadedFileUrlSchema,
    license_back_url: uploadedFileUrlSchema,

    nin: ninValidation,
    nin_id_card_url: uploadedFileUrlSchema,

    bvn: bvnValidation,

    date_of_birth: Joi.date()
      .iso()
      .required()
      .messages({
        'date.format': 'Date of birth must be a valid date (YYYY-MM-DD)',
        'any.required': 'Date of birth is required',
      }),

    selfie_url: uploadedFileUrlSchema,
  }),

  // ============================================
  // PHASE 2D — VEHICLE COMPLIANCE SUBMISSION
  // ============================================
  vehicleComplianceSubmission: Joi.object({
    vehicle_id: Joi.string()
      .uuid()
      .required()
      .messages({
        'string.uuid': 'Invalid vehicle ID',
        'any.required': 'Vehicle ID is required',
      }),
    plate_number: Joi.string()
      .min(3)
      .max(20)
      .required()
      .messages({
        'string.min': 'Plate number is required',
        'string.max': 'Plate number is too long',
        'any.required': 'Plate number is required',
      }),

    poc_document_url: uploadedFileUrlSchema,
    vehicle_license_url: uploadedFileUrlSchema,
    roadworthiness_document_url: uploadedFileUrlSchema,
    hackney_permit_url: uploadedFileUrlSchema,
    insurance_document_url: uploadedFileUrlSchema,

    insurance_policy_number: Joi.string()
      .min(3)
      .max(100)
      .required()
      .messages({
        'string.min': 'Insurance policy number is required',
        'any.required': 'Insurance policy number is required',
      }),
    insurance_provider: Joi.string().max(255).optional(),
    insurance_expiry: Joi.date().iso().optional().messages({
      'date.format': 'Insurance expiry must be a valid date (YYYY-MM-DD)',
    }),
  }),

  // ============================================
  // ADMIN — IDENTITY REVIEW (Phase 2C)
  // ============================================
  identityReview: Joi.object({
    decision: Joi.string()
      .valid('approve', 'reject')
      .required()
      .messages({
        'any.only': 'Decision must be either approve or reject',
        'any.required': 'Decision is required',
      }),
    notes: Joi.string()
      .max(1000)
      .when('decision', {
        is: 'reject',
        then: Joi.required().messages({
          'any.required': 'Rejection reason is required',
        }),
        otherwise: Joi.optional(),
      }),
    license_verified: Joi.boolean().optional(),
    nin_verified: Joi.boolean().optional(),
    bvn_verified: Joi.boolean().optional(),
  }),

  // ============================================
  // ADMIN — VEHICLE DOCUMENT REVIEW (Phase 2D)
  // ============================================
  vehicleDocumentReview: Joi.object({
    decision: Joi.string()
      .valid('approve', 'reject')
      .required()
      .messages({
        'any.only': 'Decision must be either approve or reject',
        'any.required': 'Decision is required',
      }),
    notes: Joi.string()
      .max(1000)
      .when('decision', {
        is: 'reject',
        then: Joi.required().messages({
          'any.required': 'Rejection reason is required',
        }),
        otherwise: Joi.optional(),
      }),
  }),

  // Login validation
  login: Joi.object({
    phone_number: Joi.string()
      .pattern(phoneRegex)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be a valid Nigerian number (+234XXXXXXXXXX)',
        'any.required': 'Phone number is required',
      }),
    password: Joi.string()
      .required()
      .messages({
        'any.required': 'Password is required',
      }),
    device_id: Joi.string().optional(),
    device_type: Joi.string()
      .valid('ios', 'android', 'web')
      .optional(),
  }),

  // OTP Verification validation
  verifyOTP: Joi.object({
    phone_number: Joi.string()
      .pattern(phoneRegex)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be a valid Nigerian number (+234XXXXXXXXXX)',
        'any.required': 'Phone number is required',
      }),
    otp: Joi.string()
      .length(6)
      .pattern(/^[0-9]{6}$/)
      .required()
      .messages({
        'string.length': 'OTP must be 6 digits',
        'string.pattern.base': 'OTP must contain only numbers',
        'any.required': 'OTP is required',
      }),
    purpose: Joi.string()
      .valid('registration', 'login', 'password_reset', 'phone_change')
      .default('registration'),
  }),

  // Resend OTP validation
  resendOTP: Joi.object({
    phone_number: Joi.string()
      .pattern(phoneRegex)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be a valid Nigerian number (+234XXXXXXXXXX)',
        'any.required': 'Phone number is required',
      }),
    purpose: Joi.string()
      .valid('registration', 'login', 'password_reset', 'phone_change')
      .default('registration'),
  }),

  // Refresh token validation
  refreshToken: Joi.object({
    refresh_token: Joi.string()
      .required()
      .messages({
        'any.required': 'Refresh token is required',
      }),
  }),

  // Change password validation
  changePassword: Joi.object({
    current_password: Joi.string()
      .required()
      .messages({
        'any.required': 'Current password is required',
      }),
    new_password: Joi.string()
      .min(8)
      .pattern(passwordRegex)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters',
        'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character',
        'any.required': 'New password is required',
      }),
  }),

  // Reset password request validation
  resetPasswordRequest: Joi.object({
    phone_number: Joi.string()
      .pattern(phoneRegex)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be a valid Nigerian number (+234XXXXXXXXXX)',
        'any.required': 'Phone number is required',
      }),
  }),

  // Reset password confirm validation
  resetPasswordConfirm: Joi.object({
    phone_number: Joi.string()
      .pattern(phoneRegex)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be a valid Nigerian number (+234XXXXXXXXXX)',
        'any.required': 'Phone number is required',
      }),
    otp: Joi.string()
      .length(6)
      .pattern(/^[0-9]{6}$/)
      .required()
      .messages({
        'string.length': 'OTP must be 6 digits',
        'string.pattern.base': 'OTP must contain only numbers',
        'any.required': 'OTP is required',
      }),
    new_password: Joi.string()
      .min(8)
      .pattern(passwordRegex)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters',
        'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character',
        'any.required': 'New password is required',
      }),
  }),

  // ============================================
  // KYC VALIDATION SCHEMAS
  // ============================================

  submitBVN: Joi.object({
    bvn: bvnValidation,
  }),

  submitNIN: Joi.object({
    nin: ninValidation,
  }),

  updateKYCStatus: Joi.object({
    user_id: Joi.string().uuid().required().messages({
      'any.required': 'User ID is required',
      'string.uuid': 'Invalid user ID format',
    }),
    status: Joi.string()
      .valid('pending', 'verified', 'failed')
      .required()
      .messages({
        'any.only': 'Status must be one of: pending, verified, failed',
        'any.required': 'Status is required',
      }),
    failure_reason: Joi.string().optional(),
  }),

  verifyKYC: Joi.object({
    user_id: Joi.string().uuid().required().messages({
      'any.required': 'User ID is required',
      'string.uuid': 'Invalid user ID format',
    }),
  }),
};

export default validationSchemas;