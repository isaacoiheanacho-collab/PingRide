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
  // BVN must be exactly 11 digits
  if (!/^[0-9]{11}$/.test(bvn)) return false;
  return true;
};

/**
 * Validate NIN (National Identification Number)
 * NIN must be exactly 11 digits
 */
export const validateNIN = (nin: string): boolean => {
  if (!nin) return false;
  // NIN must be exactly 11 digits
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
// MAIN VALIDATION SCHEMAS
// ============================================

export const validationSchemas = {
  // Register validation (UPDATED: added admin, support, operations)
  register: Joi.object({
    phone_number: Joi.string()
      .pattern(phoneRegex)
      .required()
      .messages({
        'string.pattern.base': 'Phone number must be a valid Nigerian number (+234XXXXXXXXXX)',
        'any.required': 'Phone number is required',
      }),
    email: Joi.string()
      .email()
      .optional()
      .messages({
        'string.email': 'Invalid email format',
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
    first_name: Joi.string()
      .pattern(nameRegex)
      .min(1)
      .max(100)
      .required()
      .messages({
        'string.pattern.base': 'First name can only contain letters, spaces, hyphens, and apostrophes',
        'any.required': 'First name is required',
      }),
    last_name: Joi.string()
      .pattern(nameRegex)
      .min(1)
      .max(100)
      .required()
      .messages({
        'string.pattern.base': 'Last name can only contain letters, spaces, hyphens, and apostrophes',
        'any.required': 'Last name is required',
      }),
    user_type: Joi.string()
      .valid('passenger', 'driver', 'admin', 'support', 'operations')
      .default('passenger')
      .messages({
        'any.only': 'User type must be one of: passenger, driver, admin, support, operations',
      }),
    // ============================================
    // NEW: KYC FIELDS (Optional during registration)
    // ============================================
    bvn: optionalBvnValidation,
    nin: optionalNinValidation,
    profile_photo_url: Joi.string().uri().optional(),
    date_of_birth: Joi.date().optional(),
    gender: Joi.string()
      .valid('male', 'female', 'other', 'prefer_not_to_say')
      .optional(),
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
  // NEW: KYC VALIDATION SCHEMAS
  // ============================================

  // Submit BVN validation
  submitBVN: Joi.object({
    bvn: bvnValidation,
  }),

  // Submit NIN validation
  submitNIN: Joi.object({
    nin: ninValidation,
  }),

  // Update passenger KYC status (admin)
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

  // Verify KYC with Paystack
  verifyKYC: Joi.object({
    user_id: Joi.string().uuid().required().messages({
      'any.required': 'User ID is required',
      'string.uuid': 'Invalid user ID format',
    }),
  }),
};

export default validationSchemas;