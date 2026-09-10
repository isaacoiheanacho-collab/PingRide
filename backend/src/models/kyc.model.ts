import pool from '../config/database';
import { IKYCVerification } from '../types';
import logger from '../utils/logger';

export class KYCModel {
  // ============================================
  // DRIVER KYC METHODS (EXISTING)
  // ============================================

  /**
   * Get KYC records by driver ID
   */
  static async getByDriverId(driverId: string): Promise<IKYCVerification[]> {
    const query = 'SELECT * FROM driver_kyc_records WHERE driver_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [driverId]);
    return result.rows;
  }

  /**
   * Get latest KYC record for driver
   */
  static async getLatest(driverId: string): Promise<IKYCVerification | null> {
    const query = 'SELECT * FROM driver_kyc_records WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1';
    const result = await pool.query(query, [driverId]);
    return result.rows[0] || null;
  }

  /**
   * Create KYC record
   */
  static async create(
    driverId: string,
    status: string = 'pending'
  ): Promise<IKYCVerification> {
    const query = `
      INSERT INTO driver_kyc_records (
        driver_id, verification_status
      ) VALUES ($1, $2)
      RETURNING *
    `;
    const result = await pool.query(query, [driverId, status]);
    logger.info(`KYC record created for driver: ${driverId}`);
    return result.rows[0];
  }

  /**
   * Update KYC status
   */
  static async updateStatus(
    id: string,
    status: string,
    provider?: string,
    rejectionReason?: string
  ): Promise<IKYCVerification | null> {
    const updates = [
      `verification_status = $1`,
      `verified_at = ${status === 'approved' ? 'NOW()' : 'NULL'}`,
      `updated_at = NOW()`
    ];
    const values: any[] = [status];

    if (provider !== undefined) {
      updates.push(`verification_provider = $${values.length + 1}`);
      values.push(provider);
    }

    if (rejectionReason !== undefined) {
      updates.push(`rejection_reason = $${values.length + 1}`);
      values.push(rejectionReason);
    }

    values.push(id);

    const query = `
      UPDATE driver_kyc_records 
      SET ${updates.join(', ')} 
      WHERE id = $${values.length}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Check if driver has approved KYC
   */
  static async isApproved(driverId: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM driver_kyc_records 
      WHERE driver_id = $1 AND verification_status = 'approved'
      LIMIT 1
    `;
    const result = await pool.query(query, [driverId]);
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // PASSENGER KYC METHODS (NEW)
  // ============================================

  /**
   * Get passenger KYC status from passenger_profiles
   */
  static async getPassengerKYC(userId: string): Promise<{
    kyc_status: 'pending' | 'verified' | 'failed';
    kyc_verified_at?: Date;
    kyc_verified_by?: string;
    kyc_failure_reason?: string;
    bvn?: string;
    nin?: string;
  } | null> {
    const result = await pool.query(
      `SELECT kyc_status, kyc_verified_at, kyc_verified_by, kyc_failure_reason, bvn, nin
       FROM passenger_profiles 
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Update passenger KYC status
   */
  static async updatePassengerKYC(
    userId: string,
    status: 'pending' | 'verified' | 'failed',
    verifiedBy?: string,
    failureReason?: string
  ): Promise<boolean> {
    const query = `
      UPDATE passenger_profiles 
      SET kyc_status = $1,
          kyc_verified_at = CASE 
              WHEN $1 = 'verified' THEN NOW() 
              ELSE kyc_verified_at 
          END,
          kyc_verified_by = CASE 
              WHEN $1 = 'verified' AND $2 IS NOT NULL THEN $2 
              ELSE kyc_verified_by 
          END,
          kyc_failure_reason = CASE 
              WHEN $1 = 'failed' AND $3 IS NOT NULL THEN $3 
              WHEN $1 = 'failed' AND $3 IS NULL THEN 'KYC verification failed' 
              ELSE NULL 
          END,
          updated_at = NOW()
      WHERE user_id = $4
    `;
    const values = [status, verifiedBy || null, failureReason || null, userId];
    const result = await pool.query(query, values);
    
    if ((result.rowCount ?? 0) > 0) {
      logger.info(`Passenger KYC status updated for user ${userId}: ${status}`);
      return true;
    }
    return false;
  }

  /**
   * Submit passenger BVN for KYC verification
   */
  static async submitPassengerBVN(userId: string, bvn: string): Promise<boolean> {
    const query = `
      UPDATE passenger_profiles 
      SET bvn = $1, 
          kyc_status = 'pending',
          kyc_failure_reason = NULL,
          updated_at = NOW()
      WHERE user_id = $2
    `;
    const result = await pool.query(query, [bvn, userId]);
    if ((result.rowCount ?? 0) > 0) {
      logger.info(`BVN submitted for passenger: ${userId}`);
      return true;
    }
    return false;
  }

  /**
   * Submit passenger NIN for KYC verification
   */
  static async submitPassengerNIN(userId: string, nin: string): Promise<boolean> {
    const query = `
      UPDATE passenger_profiles 
      SET nin = $1, 
          kyc_status = 'pending',
          kyc_failure_reason = NULL,
          updated_at = NOW()
      WHERE user_id = $2
    `;
    const result = await pool.query(query, [nin, userId]);
    if ((result.rowCount ?? 0) > 0) {
      logger.info(`NIN submitted for passenger: ${userId}`);
      return true;
    }
    return false;
  }

  /**
   * Get passenger KYC stats (admin)
   */
  static async getPassengerKYCStats(): Promise<{
    total: number;
    pending: number;
    verified: number;
    failed: number;
  }> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN kyc_status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN kyc_status = 'verified' THEN 1 END) as verified,
        COUNT(CASE WHEN kyc_status = 'failed' THEN 1 END) as failed
       FROM passenger_profiles`
    );

    const row = result.rows[0];
    return {
      total: parseInt(row?.total || '0', 10),
      pending: parseInt(row?.pending || '0', 10),
      verified: parseInt(row?.verified || '0', 10),
      failed: parseInt(row?.failed || '0', 10),
    };
  }

  /**
   * Get passengers with pending KYC (admin)
   */
  static async getPendingPassengerKYC(
    page: number = 1,
    limit: number = 100
  ): Promise<{ passengers: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT 
        p.*,
        u.phone_number,
        u.email,
        u.status as user_status
       FROM passenger_profiles p
       JOIN users u ON p.user_id = u.id
       WHERE p.kyc_status = 'pending'
       ORDER BY p.created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM passenger_profiles WHERE kyc_status = 'pending'`
    );

    return {
      passengers: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get passenger KYC with full details (admin)
   */
  static async getPassengerKYCWithDetails(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        p.*,
        u.phone_number,
        u.email,
        u.status as user_status,
        va.account_number as virtual_account_number,
        va.bank_name as virtual_account_bank,
        va.status as virtual_account_status
       FROM passenger_profiles p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN virtual_accounts va ON p.virtual_account_id = va.id
       WHERE p.user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all passenger KYC with pagination (admin)
   */
  static async getAllPassengerKYC(
    page: number = 1,
    limit: number = 100,
    status?: 'pending' | 'verified' | 'failed'
  ): Promise<{ passengers: any[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = `
      SELECT 
        p.*,
        u.phone_number,
        u.email,
        u.status as user_status
       FROM passenger_profiles p
       JOIN users u ON p.user_id = u.id
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      query += ` WHERE p.kyc_status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    let countQuery = `SELECT COUNT(*) as total FROM passenger_profiles`;
    if (status) {
      countQuery += ` WHERE kyc_status = $1`;
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, status ? [status] : [])
    ]);

    return {
      passengers: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }
}

export default KYCModel;