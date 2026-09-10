import { getRedisClient } from '../config/redis';
import logger from './logger';

const OTP_EXPIRY_SECONDS = 300; // 5 minutes
const MAX_ATTEMPTS = 3;

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function storeOTP(
  phoneNumber: string,
  otp: string,
  purpose: string = 'verification'
): Promise<void> {
  try {
    const redis = getRedisClient();
    
    // ✅ Check if Redis is connected
    if (!redis || !redis.isOpen) {
      logger.warn(`⚠️ Redis not connected, OTP not stored for ${phoneNumber}`);
      return;
    }
    
    const key = `otp:${purpose}:${phoneNumber}`;
    await redis.setEx(key, OTP_EXPIRY_SECONDS, JSON.stringify({
      otp,
      attempts: 0,
      purpose,
      created_at: new Date().toISOString()
    }));
    
    logger.info(`📱 OTP stored for ${phoneNumber} (${purpose})`);
  } catch (error) {
    logger.error('Failed to store OTP:', error);
  }
}

export async function verifyOTP(
  phoneNumber: string,
  otp: string,
  purpose: string = 'verification'
): Promise<{ valid: boolean; message: string }> {
  try {
    const redis = getRedisClient();
    
    if (!redis || !redis.isOpen) {
      return { valid: false, message: 'Redis not available' };
    }
    
    const key = `otp:${purpose}:${phoneNumber}`;
    const data = await redis.get(key);
    
    if (!data) {
      return { valid: false, message: 'OTP expired or not found' };
    }
    
    const otpData = JSON.parse(data);
    
    if (otpData.attempts >= MAX_ATTEMPTS) {
      await redis.del(key);
      return { valid: false, message: 'Too many failed attempts' };
    }
    
    if (otpData.otp !== otp) {
      otpData.attempts += 1;
      await redis.setEx(key, OTP_EXPIRY_SECONDS, JSON.stringify(otpData));
      return { valid: false, message: 'Invalid OTP' };
    }
    
    await redis.del(key);
    return { valid: true, message: 'OTP verified successfully' };
  } catch (error) {
    logger.error('Failed to verify OTP:', error);
    return { valid: false, message: 'Failed to verify OTP' };
  }
}

export async function resendOTP(
  phoneNumber: string,
  purpose: string = 'verification'
): Promise<string> {
  const redis = getRedisClient();
  const key = `otp:${purpose}:${phoneNumber}`;
  
  const existing = await redis.get(key);
  if (existing) {
    const data = JSON.parse(existing);
    const created = new Date(data.created_at);
    const secondsSinceCreation = (Date.now() - created.getTime()) / 1000;
    if (secondsSinceCreation < 30) {
      throw new Error('Please wait 30 seconds before requesting a new OTP');
    }
  }
  
  const newOTP = generateOTP();
  await storeOTP(phoneNumber, newOTP, purpose);
  return newOTP;
}

export async function clearOTP(
  phoneNumber: string,
  purpose: string = 'verification'
): Promise<void> {
  try {
    const redis = getRedisClient();
    if (redis && redis.isOpen) {
      const key = `otp:${purpose}:${phoneNumber}`;
      await redis.del(key);
    }
  } catch (error) {
    logger.error('Failed to clear OTP:', error);
  }
}

export default {
  generateOTP,
  storeOTP,
  verifyOTP,
  resendOTP,
  clearOTP,
};