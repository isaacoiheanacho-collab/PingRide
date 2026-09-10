import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { IJWTPayload, ITokens, IUser } from '../types';
import logger from './logger';

/**
 * Generate access and refresh tokens
 */
export function generateTokens(user: IUser): ITokens {
  const payload: IJWTPayload = {
    sub: user.id,
    phone: user.phone_number,
    role: user.role,
    userType: user.role,
  };

  // ✅ Fixed: Type assertion for options
  const accessToken = jwt.sign(
    payload,
    env.jwtSecret,
    {
      expiresIn: env.jwtAccessExpiry as string,
      issuer: 'pingride-api',
      audience: 'pingride-client',
    } as jwt.SignOptions
  );

  // ✅ Fixed: Type assertion for options
  const refreshToken = jwt.sign(
    { sub: user.id },
    env.jwtRefreshSecret,
    {
      expiresIn: env.jwtRefreshExpiry as string,
      issuer: 'pingride-api',
      audience: 'pingride-client',
    } as jwt.SignOptions
  );

  const decoded = jwt.decode(accessToken) as { exp: number };
  const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

  return {
    accessToken,
    refreshToken,
    expiresIn,
  };
}

/**
 * Verify access token
 */
export function verifyAccessToken(token: string): IJWTPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'pingride-api',
      audience: 'pingride-client',
    }) as IJWTPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('Access token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('Invalid access token:', error.message);
    } else {
      logger.error('Token verification error:', error);
    }
    return null;
  }
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): { sub: string } | null {
  try {
    const decoded = jwt.verify(token, env.jwtRefreshSecret, {
      algorithms: ['HS256'],
      issuer: 'pingride-api',
      audience: 'pingride-client',
    }) as { sub: string };
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('Refresh token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('Invalid refresh token:', error.message);
    } else {
      logger.error('Refresh token verification error:', error);
    }
    return null;
  }
}

/**
 * Decode token without verification
 */
export function decodeToken(token: string): any {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

export default {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
};