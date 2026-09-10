import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import AuthService from '../services/auth.service';
import AuditService from '../services/audit.service';
import logger from '../utils/logger';

export class AuthController {
  /**
   * Register a new user
   */
  async register(req: Request, res: Response): Promise<Response> {
    try {
      const result = await AuthService.register(req.body);
      
      // Audit log
      await AuditService.logAuthEvent(
        result.user.id,
        'REGISTER',
        'success',
        { ip: req.ip, userAgent: req.headers['user-agent'] }
      );
      
      return ApiResponseHandler.created(
        res, 
        result, 
        'Registration successful. Please verify your phone number.'
      );
    } catch (error) {
      // Audit log failure
      await AuditService.logAuthEvent(
        undefined,
        'REGISTER',
        'failure',
        { ip: req.ip, userAgent: req.headers['user-agent'], reason: (error as Error).message }
      );
      
      logger.error('Registration error:', error);
      throw error;
    }
  }

  /**
   * Verify OTP for registration
   */
  async verifyOTP(req: Request, res: Response): Promise<Response> {
    const { phone_number, otp } = req.body;
    try {
      const result = await AuthService.verifyRegistrationOTP(phone_number, otp);
      
      // Audit log
      await AuditService.logAuthEvent(
        result.user.id,
        'VERIFY_OTP',
        'success',
        { ip: req.ip, userAgent: req.headers['user-agent'] }
      );
      
      return ApiResponseHandler.success(res, result, {
        message: 'Phone number verified successfully'
      });
    } catch (error) {
      // Audit log failure
      await AuditService.logAuthEvent(
        undefined,
        'VERIFY_OTP',
        'failure',
        { ip: req.ip, userAgent: req.headers['user-agent'], reason: (error as Error).message }
      );
      throw error;
    }
  }

  /**
   * Login user
   */
  async login(req: Request, res: Response): Promise<Response> {
    try {
      const result = await AuthService.login(req.body);
      
      // Audit log
      await AuditService.logAuthEvent(
        result.user.id,
        'LOGIN',
        'success',
        { ip: req.ip, userAgent: req.headers['user-agent'] }
      );
      
      return ApiResponseHandler.success(res, result, {
        message: 'Login successful'
      });
    } catch (error) {
      // Audit log failure
      await AuditService.logAuthEvent(
        undefined,
        'LOGIN',
        'failure',
        { ip: req.ip, userAgent: req.headers['user-agent'], reason: (error as Error).message }
      );
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(req: Request, res: Response): Promise<Response> {
    const { refresh_token } = req.body;
    try {
      const result = await AuthService.refreshToken({ refresh_token });
      
      // Audit log (we don't have user ID from refresh token easily, but we could decode it)
      return ApiResponseHandler.success(res, result, {
        message: 'Token refreshed successfully'
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    
    try {
      const result = await AuthService.logout(userId);
      
      // Audit log
      await AuditService.logAuthEvent(
        userId,
        'LOGOUT',
        'success',
        { ip: req.ip, userAgent: req.headers['user-agent'] }
      );
      
      return ApiResponseHandler.success(res, result, {
        message: 'Logged out successfully'
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Change password
   */
  async changePassword(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    
    try {
      const result = await AuthService.changePassword(userId, req.body);
      
      // Audit log
      await AuditService.logAuthEvent(
        userId,
        'CHANGE_PASSWORD',
        'success',
        { ip: req.ip, userAgent: req.headers['user-agent'] }
      );
      
      return ApiResponseHandler.success(res, result, {
        message: 'Password changed successfully'
      });
    } catch (error) {
      // Audit log failure
      await AuditService.logAuthEvent(
        userId,
        'CHANGE_PASSWORD',
        'failure',
        { ip: req.ip, userAgent: req.headers['user-agent'], reason: (error as Error).message }
      );
      throw error;
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(req: Request, res: Response): Promise<Response> {
    const { phone_number } = req.body;
    try {
      const result = await AuthService.requestPasswordReset(phone_number);
      
      // We don't have user ID here yet, but we could look it up
      return ApiResponseHandler.success(res, result);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Confirm password reset
   */
  async confirmPasswordReset(req: Request, res: Response): Promise<Response> {
    try {
      const result = await AuthService.confirmPasswordReset(req.body);
      
      // Audit log
      await AuditService.logAuthEvent(
        undefined,
        'RESET_PASSWORD',
        'success',
        { ip: req.ip, userAgent: req.headers['user-agent'] }
      );
      
      return ApiResponseHandler.success(res, result, {
        message: 'Password reset successfully'
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Resend OTP
   */
  async resendOTP(req: Request, res: Response): Promise<Response> {
    const { phone_number, purpose } = req.body;
    const { OTPService } = await import('../services/otp.service');
    const result = await OTPService.resendOTP(phone_number, purpose || 'registration');
    return ApiResponseHandler.success(res, result);
  }
}

export default AuthController;