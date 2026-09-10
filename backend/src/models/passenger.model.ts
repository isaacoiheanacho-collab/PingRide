import pool from '../config/database';
import { IPassengerProfile, IUpdatePassengerProfile } from '../types';
import logger from '../utils/logger';

export class PassengerModel {
  /**
   * Get passenger profile by user ID
   */
  static async getProfile(userId: string): Promise<IPassengerProfile | null> {
    const query = 'SELECT * FROM passenger_profiles WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Create passenger profile
   */
  static async createProfile(
    userId: string,
    data: {
      first_name: string;
      last_name: string;
      profile_photo_url?: string;
      date_of_birth?: string;
      gender?: string;
      bvn?: string;
      nin?: string;
      kyc_status?: string;
    }
  ): Promise<IPassengerProfile> {
    const query = `
      INSERT INTO passenger_profiles (
        user_id, first_name, last_name, profile_photo_url, 
        date_of_birth, gender, trust_score, total_rides, lifetime_spend,
        bvn, nin, kyc_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;
    const values = [
      userId,
      data.first_name,
      data.last_name,
      data.profile_photo_url || null,
      data.date_of_birth || null,
      data.gender || null,
      4.0,
      0,
      0.00,
      data.bvn || null,
      data.nin || null,
      data.kyc_status || 'pending',
    ];
    const result = await pool.query(query, values);
    logger.info(`Passenger profile created for user: ${userId}`);
    return result.rows[0];
  }

  /**
   * Update passenger profile
   */
  static async updateProfile(
    userId: string,
    data: IUpdatePassengerProfile
  ): Promise<IPassengerProfile | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.first_name !== undefined) {
      updates.push(`first_name = $${paramCount}`);
      values.push(data.first_name);
      paramCount++;
    }
    if (data.last_name !== undefined) {
      updates.push(`last_name = $${paramCount}`);
      values.push(data.last_name);
      paramCount++;
    }
    if (data.profile_photo_url !== undefined) {
      updates.push(`profile_photo_url = $${paramCount}`);
      values.push(data.profile_photo_url);
      paramCount++;
    }
    if (data.date_of_birth !== undefined) {
      updates.push(`date_of_birth = $${paramCount}`);
      values.push(data.date_of_birth);
      paramCount++;
    }
    if (data.gender !== undefined) {
      updates.push(`gender = $${paramCount}`);
      values.push(data.gender);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const query = `
      UPDATE passenger_profiles 
      SET ${updates.join(', ')} 
      WHERE user_id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Increment ride count for passenger
   */
  static async incrementRideCount(userId: string): Promise<void> {
    const query = `
      UPDATE passenger_profiles 
      SET total_rides = total_rides + 1, updated_at = NOW() 
      WHERE user_id = $1
    `;
    await pool.query(query, [userId]);
  }

  /**
   * Update lifetime spend
   */
  static async updateLifetimeSpend(userId: string, amount: number): Promise<void> {
    const query = `
      UPDATE passenger_profiles 
      SET lifetime_spend = lifetime_spend + $1, updated_at = NOW() 
      WHERE user_id = $2
    `;
    await pool.query(query, [amount, userId]);
  }

  /**
   * Update trust score
   */
  static async updateTrustScore(userId: string, score: number): Promise<void> {
    const query = `
      UPDATE passenger_profiles 
      SET trust_score = $1, updated_at = NOW() 
      WHERE user_id = $2
    `;
    await pool.query(query, [score, userId]);
  }

  /**
   * Get passenger by ID with user info
   */
  static async getPassengerWithUser(passengerId: string): Promise<any> {
    const query = `
      SELECT 
        p.*,
        u.phone_number,
        u.email,
        u.status as account_status
      FROM passenger_profiles p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = $1
    `;
    const result = await pool.query(query, [passengerId]);
    return result.rows[0] || null;
  }

  /**
   * Check if passenger profile exists
   */
  static async profileExists(userId: string): Promise<boolean> {
    const query = 'SELECT 1 FROM passenger_profiles WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // VIRTUAL ACCOUNT METHODS
  // ============================================

  /**
   * Link virtual account to passenger profile
   */
  static async linkVirtualAccount(userId: string, virtualAccountId: string): Promise<void> {
    const query = `
      UPDATE passenger_profiles 
      SET virtual_account_id = $1, updated_at = NOW()
      WHERE user_id = $2
    `;
    await pool.query(query, [virtualAccountId, userId]);
    logger.info(`Virtual account ${virtualAccountId} linked to passenger ${userId}`);
  }

  /**
   * Get passenger's virtual account ID
   */
  static async getVirtualAccountId(userId: string): Promise<string | null> {
    const result = await pool.query(
      'SELECT virtual_account_id FROM passenger_profiles WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.virtual_account_id || null;
  }

  /**
   * Get passenger with virtual account details
   */
  static async getProfileWithVirtualAccount(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        p.*,
        va.account_number,
        va.bank_name,
        va.account_name as virtual_account_name,
        va.status as virtual_account_status
       FROM passenger_profiles p
       LEFT JOIN virtual_accounts va ON p.virtual_account_id = va.id
       WHERE p.user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  // ============================================
  // KYC METHODS
  // ============================================

  /**
   * Update passenger KYC status
   */
  static async updateKYCStatus(
    userId: string,
    status: 'pending' | 'verified' | 'failed',
    verifiedBy?: string,
    failureReason?: string
  ): Promise<IPassengerProfile | null> {
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
      RETURNING *
    `;
    const values = [status, verifiedBy || null, failureReason || null, userId];
    const result = await pool.query(query, values);
    
    if (result.rows[0]) {
      logger.info(`KYC status updated for passenger ${userId}: ${status}`);
    }
    
    return result.rows[0] || null;
  }

  /**
   * Get passenger KYC status
   */
  static async getKYCStatus(userId: string): Promise<{
    kyc_status: 'pending' | 'verified' | 'failed';
    kyc_verified_at?: Date;
    kyc_verified_by?: string;
    kyc_failure_reason?: string;
  } | null> {
    const result = await pool.query(
      `SELECT kyc_status, kyc_verified_at, kyc_verified_by, kyc_failure_reason 
       FROM passenger_profiles 
       WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Submit BVN for verification (pass to Paystack)
   */
  static async submitBVN(userId: string, bvn: string): Promise<void> {
    await pool.query(
      `UPDATE passenger_profiles 
       SET bvn = $1, 
           kyc_status = 'pending',
           kyc_failure_reason = NULL,
           updated_at = NOW()
       WHERE user_id = $2`,
      [bvn, userId]
    );
    logger.info(`BVN submitted for passenger: ${userId}`);
  }

  /**
   * Submit NIN for verification (pass to Paystack)
   */
  static async submitNIN(userId: string, nin: string): Promise<void> {
    await pool.query(
      `UPDATE passenger_profiles 
       SET nin = $1, 
           kyc_status = 'pending',
           kyc_failure_reason = NULL,
           updated_at = NOW()
       WHERE user_id = $2`,
      [nin, userId]
    );
    logger.info(`NIN submitted for passenger: ${userId}`);
  }

  /**
   * Get passenger with full KYC details
   */
  static async getProfileWithKYC(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        p.*,
        va.account_number,
        va.bank_name,
        va.account_name as virtual_account_name,
        va.status as virtual_account_status
       FROM passenger_profiles p
       LEFT JOIN virtual_accounts va ON p.virtual_account_id = va.id
       WHERE p.user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all passengers with pending KYC (admin)
   */
  static async getPendingKYC(
    page: number = 1,
    limit: number = 100
  ): Promise<{ passengers: IPassengerProfile[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM passenger_profiles 
       WHERE kyc_status = 'pending' 
       ORDER BY created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM passenger_profiles 
       WHERE kyc_status = 'pending'`
    );

    return {
      passengers: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get KYC stats (admin)
   */
  static async getKYCStats(): Promise<{
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
   * Verify KYC with Paystack (trigger external verification)
   */
  static async verifyKYCWithPaystack(userId: string): Promise<{
    success: boolean;
    message: string;
    status?: string;
  }> {
    const profile = await this.getProfile(userId);
    if (!profile) {
      return { success: false, message: 'Passenger profile not found' };
    }

    // Check if BVN or NIN is provided
    if (!profile.bvn && !profile.nin) {
      return { success: false, message: 'No BVN or NIN provided for verification' };
    }

    try {
      // ✅ FIXED: Correct import path
      const { PaystackService } = await import('../services/paystack.service');
      
      // Get user for customer code
      const user = await pool.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      
      if (!user.rows[0]) {
        return { success: false, message: 'User not found' };
      }

      // Get virtual account to get customer code
      const virtualAccount = await pool.query(
        'SELECT * FROM virtual_accounts WHERE user_id = $1 AND status = $2',
        [userId, 'active']
      );

      if (!virtualAccount.rows[0]) {
        return { success: false, message: 'Virtual account not found' };
      }

      const customerCode = virtualAccount.rows[0].metadata?.customer_code;
      if (!customerCode) {
        return { success: false, message: 'Paystack customer code not found' };
      }

      // Submit identification to Paystack
      const identificationData = {
        country: 'NG',
        type: profile.bvn ? 'bvn' as const : 'nin' as const,
        value: profile.bvn || profile.nin || '',
      };

      const response = await PaystackService.submitIdentification(
        customerCode,
        identificationData
      );

      if (response.status) {
        await this.updateKYCStatus(userId, 'verified');
        return { success: true, message: 'KYC verified successfully', status: 'verified' };
      } else {
        await this.updateKYCStatus(userId, 'failed', undefined, response.message || 'KYC verification failed');
        return { success: false, message: response.message || 'KYC verification failed', status: 'failed' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`KYC verification failed for user ${userId}:`, error);
      await this.updateKYCStatus(userId, 'failed', undefined, errorMessage);
      return { success: false, message: `KYC verification failed: ${errorMessage}`, status: 'failed' };
    }
  }

  // ============================================
  // KYC DOCUMENT METHODS (NEW)
  // ============================================

  /**
   * Add KYC document record
   */
  static async addKycDocument(
    userId: string,
    documentType: string,
    documentUrl: string,
    mimeType: string,
    fileSize: number
  ): Promise<any> {
    const result = await pool.query(
      `INSERT INTO passenger_kyc_documents (
        user_id,
        document_type,
        document_url,
        mime_type,
        file_size,
        upload_status
      ) VALUES ($1, $2, $3, $4, $5, 'uploaded')
      RETURNING *`,
      [userId, documentType, documentUrl, mimeType, fileSize]
    );
    logger.info(`KYC document added for passenger ${userId}: ${documentType}`);
    return result.rows[0];
  }

  /**
   * Get KYC documents for a passenger
   */
  static async getKycDocuments(userId: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT * FROM passenger_kyc_documents 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Get KYC document by ID
   */
  static async getKycDocumentById(documentId: string): Promise<any | null> {
    const result = await pool.query(
      'SELECT * FROM passenger_kyc_documents WHERE id = $1',
      [documentId]
    );
    return result.rows[0] || null;
  }

  /**
   * Update KYC document verification status (admin)
   */
  static async updateKycDocumentVerification(
    documentId: string,
    status: 'pending' | 'verified' | 'rejected',
    notes?: string,
    verifiedBy?: string
  ): Promise<any | null> {
    const query = `
      UPDATE passenger_kyc_documents 
      SET verification_status = $1,
          verification_notes = $2,
          verified_by = $3,
          verified_at = CASE 
            WHEN $1 IN ('verified', 'rejected') THEN NOW() 
            ELSE verified_at 
          END,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    const values = [status, notes || null, verifiedBy || null, documentId];
    const result = await pool.query(query, values);
    
    if (result.rows[0]) {
      logger.info(`KYC document ${documentId} verification status updated to: ${status}`);
    }
    
    return result.rows[0] || null;
  }

  /**
   * Delete KYC document
   */
  static async deleteKycDocument(documentId: string, userId: string): Promise<boolean> {
    // Verify ownership before deletion
    const doc = await this.getKycDocumentById(documentId);
    if (!doc || doc.user_id !== userId) {
      return false;
    }

    await pool.query(
      'DELETE FROM passenger_kyc_documents WHERE id = $1 AND user_id = $2',
      [documentId, userId]
    );
    logger.info(`KYC document deleted: ${documentId}`);
    return true;
  }

  /**
   * Get all KYC documents for admin
   */
  static async getAllKycDocuments(
    page: number = 1,
    limit: number = 100,
    verificationStatus?: string
  ): Promise<{ documents: any[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = `
      SELECT 
        d.*,
        u.phone_number,
        u.email,
        p.first_name,
        p.last_name
      FROM passenger_kyc_documents d
      JOIN users u ON d.user_id = u.id
      JOIN passenger_profiles p ON d.user_id = p.user_id
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (verificationStatus) {
      query += ` WHERE d.verification_status = $${paramCount}`;
      params.push(verificationStatus);
      paramCount++;
    }

    query += ` ORDER BY d.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    let countQuery = 'SELECT COUNT(*) as total FROM passenger_kyc_documents';
    if (verificationStatus) {
      countQuery += ` WHERE verification_status = $1`;
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, verificationStatus ? [verificationStatus] : [])
    ]);

    return {
      documents: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get KYC document statistics (admin)
   */
  static async getKycDocumentStats(): Promise<{
    total: number;
    uploaded: number;
    pending: number;
    verified: number;
    rejected: number;
  }> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN upload_status = 'uploaded' THEN 1 END) as uploaded,
        COUNT(CASE WHEN verification_status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN verification_status = 'verified' THEN 1 END) as verified,
        COUNT(CASE WHEN verification_status = 'rejected' THEN 1 END) as rejected
       FROM passenger_kyc_documents`
    );

    const row = result.rows[0];
    return {
      total: parseInt(row?.total || '0', 10),
      uploaded: parseInt(row?.uploaded || '0', 10),
      pending: parseInt(row?.pending || '0', 10),
      verified: parseInt(row?.verified || '0', 10),
      rejected: parseInt(row?.rejected || '0', 10),
    };
  }

  /**
   * Check if passenger has any KYC documents
   */
  static async hasKycDocuments(userId: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT 1 FROM passenger_kyc_documents WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get latest KYC document for a passenger
   */
  static async getLatestKycDocument(userId: string): Promise<any | null> {
    const result = await pool.query(
      `SELECT * FROM passenger_kyc_documents 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }
}

export default PassengerModel;