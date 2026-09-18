import { env } from '../config/env';
import logger from '../utils/logger';
import { generateOTP, storeOTP, verifyOTP, resendOTP, clearOTP } from '../utils/otp';

export class OTPService {
  /**
   * Generate and send OTP
   */
  static async sendOTP(
    phoneNumber: string,
    purpose: 'registration' | 'login' | 'password_reset' | 'phone_change'
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Generate OTP
      const otp = generateOTP();

      // Store OTP in Redis
      await storeOTP(phoneNumber, otp, purpose);

      // TODO: Integrate with SMS service
      // In development, log the OTP so it can be read from the console.
      // In production, the SMS service must deliver it. Never log the OTP
      // value in production — logs are shipped to third-party services and
      // are not an authorised channel for one-time secrets.
      if (env.nodeEnv !== 'production') {
        logger.debug(`📱 OTP for ${phoneNumber} (${purpose}): ${otp}`);
      } else {
        logger.info(`📱 OTP dispatched for ${phoneNumber} (${purpose})`);
      }

      // In production, send SMS here
      // await SMSService.sendOTP(phoneNumber, otp);

      return {
        success: true,
        message: 'OTP sent successfully',
      };
    } catch (error) {
      logger.error('Failed to send OTP:', error);
      return {
        success: false,
        message: 'Failed to send OTP',
      };
    }
  }

  /**
   * Verify OTP
   */
  static async verifyOTP(
    phoneNumber: string,
    otp: string,
    purpose: 'registration' | 'login' | 'password_reset' | 'phone_change'
  ): Promise<{ valid: boolean; message: string }> {
    try {
      const result = await verifyOTP(phoneNumber, otp, purpose);
      return result;
    } catch (error) {
      logger.error('Failed to verify OTP:', error);
      return {
        valid: false,
        message: 'Failed to verify OTP',
      };
    }
  }

  /**
   * Resend OTP
   */
  static async resendOTP(
    phoneNumber: string,
    purpose: 'registration' | 'login' | 'password_reset' | 'phone_change'
  ): Promise<{ success: boolean; message: string; otp?: string }> {
    try {
      const otp = await resendOTP(phoneNumber, purpose);

      // Same rule as sendOTP: never log the OTP value in production.
      if (env.nodeEnv !== 'production') {
        logger.debug(`📱 Resent OTP for ${phoneNumber} (${purpose}): ${otp}`);
      } else {
        logger.info(`📱 OTP resent for ${phoneNumber} (${purpose})`);
      }

      return {
        success: true,
        message: 'OTP resent successfully',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resend OTP';
      logger.error('Failed to resend OTP:', error);
      return {
        success: false,
        message,
      };
    }
  }

  /**
   * Clear OTP
   */
  static async clearOTP(
    phoneNumber: string,
    purpose: 'registration' | 'login' | 'password_reset' | 'phone_change'
  ): Promise<void> {
    await clearOTP(phoneNumber, purpose);
  }
}

export default OTPService;