import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { UserModel } from '../models/user.model';
import { ApiResponseHandler } from '../utils/response';
import logger from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    phone: string;
    role: string;
    userType: string;
    status: string;
  };
}

// Statuses that are allowed to hold a valid token.
// - 'active'                — fully verified
// - 'pending_verification'  — registered, waiting for OTP verification
//
// Anything else (suspended, deactivated, locked) cannot authenticate.
const TOKEN_HOLDING_STATUSES = ['active', 'pending_verification'];

/**
 * Authenticate JWT token with retry for database connection.
 *
 * Accepts both `active` and `pending_verification` users. Routes that must
 * NOT be reachable before phone verification should chain `requireVerified`
 * after this middleware.
 */
export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ApiResponseHandler.unauthorized(res, 'No token provided');
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      ApiResponseHandler.unauthorized(res, 'Invalid or expired token');
      return;
    }

    // Try to get user with retry
    let user = null;
    let retries = 3;

    while (retries > 0 && !user) {
      try {
        user = await UserModel.findById(decoded.sub);
      } catch (err) {
        retries--;
        if (retries === 0) {
          throw err;
        }
        // Wait 2 seconds before retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!user) {
      ApiResponseHandler.unauthorized(res, 'User not found');
      return;
    }

    if (!TOKEN_HOLDING_STATUSES.includes(user.status)) {
      ApiResponseHandler.unauthorized(res, `Account ${user.status}`);
      return;
    }

    // Attach user to request
    req.user = {
      id: user.id,
      phone: user.phone_number,
      role: user.role,
      userType: user.role,
      status: user.status,
    };

    next();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Authentication error:', errorMsg);

    // If it's a connection error, give a helpful message
    if (errorMsg.includes('Connection terminated') || errorMsg.includes('timeout')) {
      ApiResponseHandler.error(
        res,
        'DB_CONNECTION_ERROR',
        'Database connection issue. Please try again in a few seconds.',
        503
      );
      return;
    }

    ApiResponseHandler.unauthorized(res, 'Authentication failed');
  }
}

/**
 * Require the authenticated user to have a fully verified account.
 *
 * Must be used AFTER `authenticate`. Rejects users whose status is
 * `pending_verification`.
 *
 * Use this on every route that involves money, accepting a ride, placing a
 * bid, or advancing onboarding milestones.
 *
 * Routes that should stay open to `pending_verification` users:
 *   - GET  /api/v1/users/profile
 *   - GET  /api/v1/onboarding/status
 *   - POST /api/v1/auth/verify-otp
 *   - POST /api/v1/auth/resend-otp
 *   - POST /api/v1/auth/logout
 */
export function requireVerified() {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      ApiResponseHandler.unauthorized(res, 'Not authenticated');
      return;
    }

    if (req.user.status !== 'active') {
      ApiResponseHandler.forbidden(
        res,
        'Phone number not verified. Please verify your OTP before continuing.'
      );
      return;
    }

    next();
  };
}

/**
 * Authorize user by role
 */
export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      ApiResponseHandler.unauthorized(res, 'Not authenticated');
      return;
    }

    if (!roles.includes(req.user.role)) {
      ApiResponseHandler.forbidden(res, 'Insufficient permissions');
      return;
    }

    next();
  };
}

/**
 * Optional authentication (doesn't fail if no token)
 */
export async function optionalAuthenticate(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    if (decoded) {
      try {
        const user = await UserModel.findById(decoded.sub);
        if (user && TOKEN_HOLDING_STATUSES.includes(user.status)) {
          req.user = {
            id: user.id,
            phone: user.phone_number,
            role: user.role,
            userType: user.role,
            status: user.status,
          };
        }
      } catch {
        // Silently fail for optional auth
      }
    }

    next();
  } catch {
    next();
  }
}

export default {
  authenticate,
  requireVerified,
  authorize,
  optionalAuthenticate,
};