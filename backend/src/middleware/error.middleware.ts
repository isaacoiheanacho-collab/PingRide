import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { ApiResponseHandler } from '../utils/response';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR', details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 409, 'CONFLICT', details);
  }
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error(`Error: ${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  if (err instanceof AppError) {
    ApiResponseHandler.error(res, err.code, err.message, err.statusCode, err.details);
    return;
  }

  // Handle specific error types
  if (err.name === 'JsonWebTokenError') {
    ApiResponseHandler.error(res, 'INVALID_TOKEN', 'Invalid authentication token', 401);
    return;
  }

  if (err.name === 'TokenExpiredError') {
    ApiResponseHandler.error(res, 'TOKEN_EXPIRED', 'Authentication token expired', 401);
    return;
  }

  // Default: Internal Server Error
  ApiResponseHandler.serverError(
    res,
    process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  );
}