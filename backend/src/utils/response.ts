import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
    message?: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  };
}

export class ApiResponseHandler {
  static success<T>(
    res: Response,
    data: T,
    options?: {
      statusCode?: number;
      message?: string;
      meta?: ApiResponse['meta'];
    }
  ): Response {
    const statusCode = options?.statusCode || 200;
    const response: ApiResponse<T> = {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...(options?.message && { message: options.message }),
        ...options?.meta,
      },
    };
    return res.status(statusCode).json(response);
  }

  static error(
    res: Response,
    code: string,
    message: string,
    statusCode: number = 400,
    details?: any
  ): Response {
    const response: ApiResponse = {
      success: false,
      error: {
        code,
        message,
        details,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
    return res.status(statusCode).json(response);
  }

  static created<T>(res: Response, data: T, message?: string, meta?: ApiResponse['meta']): Response {
    return this.success(res, data, { statusCode: 201, message, meta });
  }

  static noContent(res: Response): Response {
    return res.status(204).send();
  }

  static badRequest(res: Response, message: string, details?: any): Response {
    return this.error(res, 'BAD_REQUEST', message, 400, details);
  }

  static unauthorized(res: Response, message: string = 'Unauthorized'): Response {
    return this.error(res, 'UNAUTHORIZED', message, 401);
  }

  static forbidden(res: Response, message: string = 'Forbidden'): Response {
    return this.error(res, 'FORBIDDEN', message, 403);
  }

  static notFound(res: Response, message: string = 'Not Found'): Response {
    return this.error(res, 'NOT_FOUND', message, 404);
  }

  static conflict(res: Response, message: string, details?: any): Response {
    return this.error(res, 'CONFLICT', message, 409, details);
  }

  static validationError(res: Response, message: string, details?: any): Response {
    return this.error(res, 'VALIDATION_ERROR', message, 422, details);
  }

  static serverError(res: Response, message: string = 'Internal Server Error'): Response {
    return this.error(res, 'SERVER_ERROR', message, 500);
  }
}