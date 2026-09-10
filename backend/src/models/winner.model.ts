import pool from '../config/database';
import { IWinner } from '../types';
import logger from '../utils/logger';

export class WinnerModel {
  /**
   * Create a winner record
   */
  static async create(data: {
    userId: string;
    userType: 'passenger' | 'driver';
    programmePeriodId: string;
    qualificationRegistryId: string;
    eligibleValue: number;
    rankPosition: number;
  }): Promise<IWinner> {
    const result = await pool.query(
      `INSERT INTO winners (
        user_id,
        user_type,
        programme_period_id,
        qualification_registry_id,
        eligible_value,
        rank_position,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        data.userId,
        data.userType,
        data.programmePeriodId,
        data.qualificationRegistryId,
        data.eligibleValue,
        data.rankPosition,
        'active',
      ]
    );

    logger.info(`Winner created: ${data.userId} (${data.userType}) for period ${data.programmePeriodId}`);
    return result.rows[0];
  }

  /**
   * Get winner by ID
   */
  static async getById(id: string): Promise<IWinner | null> {
    const result = await pool.query(
      'SELECT * FROM winners WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get winner by user ID and programme period
   */
  static async getByUserAndPeriod(
    userId: string,
    programmePeriodId: string
  ): Promise<IWinner | null> {
    const result = await pool.query(
      `SELECT * FROM winners 
       WHERE user_id = $1 AND programme_period_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [userId, programmePeriodId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all winners for a programme period
   */
  static async getByProgrammePeriod(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver',
    page: number = 1,
    limit: number = 100
  ): Promise<{ winners: IWinner[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = `SELECT * FROM winners WHERE programme_period_id = $1`;
    const params: any[] = [programmePeriodId];

    if (userType) {
      query += ` AND user_type = $${params.length + 1}`;
      params.push(userType);
    }

    query += ` ORDER BY rank_position ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    // Count query
    let countQuery = `SELECT COUNT(*) as total FROM winners WHERE programme_period_id = $1`;
    const countParams: any[] = [programmePeriodId];

    if (userType) {
      countQuery += ` AND user_type = $2`;
      countParams.push(userType);
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);

    return {
      winners: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get active winners for a programme period
   */
  static async getActiveWinners(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver'
  ): Promise<IWinner[]> {
    let query = `SELECT * FROM winners 
                 WHERE programme_period_id = $1 AND status = 'active'`;
    const params: any[] = [programmePeriodId];

    if (userType) {
      query += ` AND user_type = $2`;
      params.push(userType);
    }

    query += ` ORDER BY rank_position ASC`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get winners by user type
   */
  static async getByUserType(
    userType: 'passenger' | 'driver',
    programmePeriodId?: string
  ): Promise<IWinner[]> {
    let query = `SELECT * FROM winners WHERE user_type = $1`;
    const params: any[] = [userType];

    if (programmePeriodId) {
      query += ` AND programme_period_id = $2`;
      params.push(programmePeriodId);
    }

    query += ` ORDER BY rank_position ASC`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get winner with full user details
   */
  static async getWithUserDetails(winnerId: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        w.*,
        u.phone_number,
        u.email,
        CASE 
          WHEN w.user_type = 'passenger' THEN 
            p.first_name || ' ' || p.last_name
          WHEN w.user_type = 'driver' THEN 
            d.first_name || ' ' || d.last_name
          ELSE NULL
        END as full_name,
        CASE 
          WHEN w.user_type = 'passenger' THEN 
            p.rating_as_passenger
          WHEN w.user_type = 'driver' THEN 
            d.rating_average
          ELSE NULL
        END as rating,
        CASE 
          WHEN w.user_type = 'passenger' THEN 
            p.total_rides
          WHEN w.user_type = 'driver' THEN 
            d.total_rides
          ELSE NULL
        END as total_rides
       FROM winners w
       JOIN users u ON w.user_id = u.id
       LEFT JOIN passenger_profiles p ON w.user_type = 'passenger' AND p.user_id = w.user_id
       LEFT JOIN driver_profiles d ON w.user_type = 'driver' AND d.user_id = w.user_id
       WHERE w.id = $1`,
      [winnerId]
    );
    return result.rows[0] || null;
  }

  /**
   * Update winner status
   */
  static async updateStatus(
    winnerId: string,
    status: 'active' | 'disqualified' | 'paid'
  ): Promise<IWinner | null> {
    const result = await pool.query(
      `UPDATE winners 
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, winnerId]
    );
    return result.rows[0] || null;
  }

  /**
   * Disqualify a winner
   */
  static async disqualify(
    winnerId: string,
    reason: string
  ): Promise<IWinner | null> {
    const result = await pool.query(
      `UPDATE winners 
       SET status = 'disqualified',
           disqualification_reason = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason, winnerId]
    );

    if (result.rows[0]) {
      logger.warn(`Winner disqualified: ${winnerId}, reason: ${reason}`);
    }

    return result.rows[0] || null;
  }

  /**
   * Mark winner as paid
   */
  static async markPaid(winnerId: string): Promise<IWinner | null> {
    const result = await pool.query(
      `UPDATE winners 
       SET status = 'paid',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [winnerId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get winner count for a programme period
   */
  static async getCount(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver',
    status?: 'active' | 'disqualified' | 'paid'
  ): Promise<number> {
    let query = `SELECT COUNT(*) as count FROM winners WHERE programme_period_id = $1`;
    const params: any[] = [programmePeriodId];

    if (userType) {
      query += ` AND user_type = $${params.length + 1}`;
      params.push(userType);
    }

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Replace a disqualified winner with the next qualified user
   */
  static async replaceWinner(
    disqualifiedWinnerId: string,
    replacementUserId: string,
    replacementQualificationRegistryId: string,
    replacementEligibleValue: number,
    replacementRankPosition: number
  ): Promise<IWinner | null> {
    // Use transaction for atomicity
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the original winner
      const originalResult = await client.query(
        'SELECT * FROM winners WHERE id = $1 FOR UPDATE',
        [disqualifiedWinnerId]
      );

      if (originalResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const original = originalResult.rows[0];

      // Mark the original as disqualified if not already
      await client.query(
        `UPDATE winners 
         SET status = 'disqualified',
             disqualification_reason = 'Replaced by next qualified user',
             updated_at = NOW()
         WHERE id = $1`,
        [disqualifiedWinnerId]
      );

      // Create the replacement winner
      const replacementResult = await client.query(
        `INSERT INTO winners (
          user_id,
          user_type,
          programme_period_id,
          qualification_registry_id,
          eligible_value,
          rank_position,
          replacement_winner_id,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          replacementUserId,
          original.user_type,
          original.programme_period_id,
          replacementQualificationRegistryId,
          replacementEligibleValue,
          replacementRankPosition,
          disqualifiedWinnerId,
          'active',
        ]
      );

      await client.query('COMMIT');

      logger.info(`Winner replaced: ${disqualifiedWinnerId} -> ${replacementUserId}`);
      return replacementResult.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all disqualified winners for a programme period
   */
  static async getDisqualifiedWinners(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver'
  ): Promise<IWinner[]> {
    let query = `SELECT * FROM winners 
                 WHERE programme_period_id = $1 AND status = 'disqualified'`;
    const params: any[] = [programmePeriodId];

    if (userType) {
      query += ` AND user_type = $2`;
      params.push(userType);
    }

    query += ` ORDER BY rank_position ASC`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Get all paid winners for a programme period
   */
  static async getPaidWinners(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver'
  ): Promise<IWinner[]> {
    let query = `SELECT * FROM winners 
                 WHERE programme_period_id = $1 AND status = 'paid'`;
    const params: any[] = [programmePeriodId];

    if (userType) {
      query += ` AND user_type = $2`;
      params.push(userType);
    }

    query += ` ORDER BY rank_position ASC`;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Check if a user is a winner for a programme period
   */
  static async isWinner(
    userId: string,
    programmePeriodId: string
  ): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM winners 
       WHERE user_id = $1 
         AND programme_period_id = $2 
         AND status = 'active'
       LIMIT 1`,
      [userId, programmePeriodId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete winners for a programme period (for cleanup/rollback)
   */
  static async deleteByProgrammePeriod(programmePeriodId: string): Promise<number> {
    const result = await pool.query(
      'DELETE FROM winners WHERE programme_period_id = $1 RETURNING id',
      [programmePeriodId]
    );
    logger.warn(`Deleted ${result.rowCount} winners for period ${programmePeriodId}`);
    return result.rowCount || 0;
  }

  /**
   * Get winners summary for a programme period
   */
  static async getSummary(programmePeriodId: string): Promise<{
    total: number;
    active: number;
    disqualified: number;
    paid: number;
    passengerCount: number;
    driverCount: number;
  }> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'disqualified' THEN 1 END) as disqualified,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid,
        COUNT(CASE WHEN user_type = 'passenger' THEN 1 END) as passenger_count,
        COUNT(CASE WHEN user_type = 'driver' THEN 1 END) as driver_count
       FROM winners
       WHERE programme_period_id = $1`,
      [programmePeriodId]
    );

    return {
      total: parseInt(result.rows[0]?.total || '0', 10),
      active: parseInt(result.rows[0]?.active || '0', 10),
      disqualified: parseInt(result.rows[0]?.disqualified || '0', 10),
      paid: parseInt(result.rows[0]?.paid || '0', 10),
      passengerCount: parseInt(result.rows[0]?.passenger_count || '0', 10),
      driverCount: parseInt(result.rows[0]?.driver_count || '0', 10),
    };
  }
}

export default WinnerModel;