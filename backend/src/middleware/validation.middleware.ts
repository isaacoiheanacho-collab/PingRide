import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ApiResponseHandler } from '../utils/response';

/**
 * Validate request against Joi schema
 */
export function validate(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      ApiResponseHandler.validationError(res, 'Validation failed', { errors: details });
      return;
    }

    // Replace req.body with validated data
    req.body = value;
    next();
  };
}

/**
 * Validate query parameters
 */
export function validateQuery(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      ApiResponseHandler.validationError(res, 'Invalid query parameters', { errors: details });
      return;
    }

    req.query = value;
    next();
  };
}

/**
 * Validate URL parameters
 */
export function validateParams(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      ApiResponseHandler.validationError(res, 'Invalid parameters', { errors: details });
      return;
    }

    req.params = value;
    next();
  };
}

export default {
  validate,
  validateQuery,
  validateParams,
};