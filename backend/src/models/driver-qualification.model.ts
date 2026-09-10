import pool from '../config/database';
import { IDriverQualification, QualificationStatus } from '../types';
import logger from '../utils/logger';

export class DriverQualificationModel {
  private static readonly DEFAULT_THRESHOLD = 15000000; // ₦15,000,000

  /**
   * Get driver qualification record by driver ID and programme period ID
   */
  static async getByDriver(
    driverId: string,
    programmePeriodId: string
  ): Promise<IDriverQualification | null> {
    const result = await pool.query(
      `SELECT * FROM driver_qualification_registry 
       WHERE driver_id = $1 AND programme_period_id = $2`,
      [driverId, programmePeriodId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get driver qualification by ID
   */
  static async getById(id: string): Promise<IDriverQualification | null> {
    const result = await pool.query(
      'SELECT * FROM driver_qualification_registry WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all driver qualifications for a programme period
   */
  static async getByProgrammePeriod(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ qualifications: IDriverQualification[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM driver_qualification_registry 
       WHERE programme_period_id = $1 
       ORDER BY qualifying_contribution DESC
       LIMIT $2 OFFSET $3`,
      [programmePeriodId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM driver_qualification_registry 
       WHERE programme_period_id = $1`,
      [programmePeriodId]
    );

    return {
      qualifications: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get qualified drivers for a programme period
   */
  static async getQualifiedDrivers(programmePeriodId: string): Promise<IDriverQualification[]> {
    const result = await pool.query(
      `SELECT * FROM driver_qualification_registry 
       WHERE programme_period_id = $1 
         AND qualification_status = 'qualified'
         AND (fraud_review_status IS NULL OR fraud_review_status != 'excluded')
       ORDER BY qualifying_contribution DESC`,
      [programmePeriodId]
    );
    return result.rows;
  }

  /**
   * Get qualified driver count for a programme period
   */
  static async getQualifiedCount(programmePeriodId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM driver_qualification_registry 
       WHERE programme_period_id = $1 
         AND qualification_status = 'qualified'
         AND (fraud_review_status IS NULL OR fraud_review_status != 'excluded')`,
      [programmePeriodId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Get driver qualification with full driver details
   * ✅ FIXED: Added d.user_id and u.id as users_id
   */
  static async getWithDriverDetails(driverId: string, programmePeriodId: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        q.*,
        d.first_name,
        d.last_name,
        d.total_rides,
        d.total_earnings,
        d.rating_average,
        d.user_id,           -- ✅ Added: driver_profiles.user_id (references users.id)
        u.phone_number,
        u.email,
        u.id as users_id     -- ✅ Added: actual users.id
       FROM driver_qualification_registry q
       JOIN driver_profiles d ON q.driver_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE q.driver_id = $1 AND q.programme_period_id = $2`,
      [driverId, programmePeriodId]
    );
    return result.rows[0] || null;
  }

  /**
   * Create or update driver qualification record
   * Adds the contribution amount to the existing total
   */
  static async createOrUpdate(
    driverId: string,
    programmePeriodId: string,
    contributionAmount: number
  ): Promise<IDriverQualification> {
    const existing = await this.getByDriver(driverId, programmePeriodId);

    if (existing) {
      // Update existing record
      const newContribution = existing.qualifying_contribution + contributionAmount;
      const threshold = await this.getThreshold(programmePeriodId);
      const isQualified = newContribution >= threshold;

      const result = await pool.query(
        `UPDATE driver_qualification_registry 
         SET qualifying_contribution = $1,
             qualification_status = $2,
             qualification_date = CASE 
               WHEN $2 = 'qualified' AND qualification_date IS NULL THEN NOW() 
               ELSE qualification_date 
             END,
             last_progress_update = NOW(),
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [newContribution, isQualified ? 'qualified' : 'in_progress', existing.id]
      );

      logger.debug(`Updated driver qualification: ${driverId}, contribution: ${newContribution}`);
      return result.rows[0];
    } else {
      // Create new record
      const threshold = await this.getThreshold(programmePeriodId);
      const isQualified = contributionAmount >= threshold;
      const initialStatus = contributionAmount > 0 ? (isQualified ? 'qualified' : 'in_progress') : 'not_started';

      const result = await pool.query(
        `INSERT INTO driver_qualification_registry (
          driver_id,
          programme_period_id,
          qualifying_contribution,
          qualification_status,
          qualification_date,
          last_progress_update
        ) VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'qualified' THEN NOW() ELSE NULL END, NOW())
        RETURNING *`,
        [driverId, programmePeriodId, contributionAmount, initialStatus]
      );

      logger.info(`Created driver qualification: ${driverId} in period ${programmePeriodId}`);
      return result.rows[0];
    }
  }

  /**
   * Mark driver as qualified (force qualification)
   */
  static async markQualified(
    driverId: string,
    programmePeriodId: string,
    contributionAmount?: number
  ): Promise<IDriverQualification | null> {
    const existing = await this.getByDriver(driverId, programmePeriodId);
    const threshold = await this.getThreshold(programmePeriodId);
    const finalContribution = contributionAmount ?? existing?.qualifying_contribution ?? threshold;

    if (existing) {
      const result = await pool.query(
        `UPDATE driver_qualification_registry 
         SET qualifying_contribution = GREATEST($1, qualifying_contribution),
             qualification_status = 'qualified',
             qualification_date = COALESCE(qualification_date, NOW()),
             last_progress_update = NOW(),
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [finalContribution, existing.id]
      );
      return result.rows[0] || null;
    } else {
      const result = await pool.query(
        `INSERT INTO driver_qualification_registry (
          driver_id,
          programme_period_id,
          qualifying_contribution,
          qualification_status,
          qualification_date,
          last_progress_update
        ) VALUES ($1, $2, $3, 'qualified', NOW(), NOW())
        RETURNING *`,
        [driverId, programmePeriodId, finalContribution]
      );
      return result.rows[0];
    }
  }

  /**
   * Exclude driver from qualification
   */
  static async exclude(
    driverId: string,
    programmePeriodId: string,
    reason: string
  ): Promise<void> {
    await pool.query(
      `UPDATE driver_qualification_registry 
       SET qualification_status = 'excluded',
           fraud_review_status = 'excluded',
           fraud_review_notes = $1,
           updated_at = NOW()
       WHERE driver_id = $2 AND programme_period_id = $3`,
      [reason, driverId, programmePeriodId]
    );
    logger.warn(`Driver excluded from qualification: ${driverId}, reason: ${reason}`);
  }

  /**
   * Reverse qualification (for fraud or correction)
   */
  static async reverseQualification(
    driverId: string,
    programmePeriodId: string,
    reason: string
  ): Promise<void> {
    const existing = await this.getByDriver(driverId, programmePeriodId);
    if (!existing) {
      return;
    }

    let newStatus: QualificationStatus = 'in_progress';
    if (existing.qualification_status === 'not_started') {
      newStatus = 'not_started';
    }

    await pool.query(
      `UPDATE driver_qualification_registry 
       SET qualification_status = $1,
           qualification_date = NULL,
           fraud_review_status = 'under_review',
           fraud_review_notes = $2,
           winner_selected = false,
           profit_share_allocated = 0,
           profit_share_paid = false,
           updated_at = NOW()
       WHERE driver_id = $3 AND programme_period_id = $4
       RETURNING *`,
      [newStatus, reason, driverId, programmePeriodId]
    );
    logger.warn(`Driver qualification reversed: ${driverId}, reason: ${reason}`);
  }

  /**
   * Update driver rank position (for winner selection)
   */
  static async updateRank(programmePeriodId: string): Promise<void> {
    await pool.query(
      `WITH ranked AS (
        SELECT 
          id, 
          ROW_NUMBER() OVER (ORDER BY qualifying_contribution DESC) as rank
        FROM driver_qualification_registry
        WHERE programme_period_id = $1 
          AND qualification_status = 'qualified'
          AND (fraud_review_status IS NULL OR fraud_review_status != 'excluded')
      )
      UPDATE driver_qualification_registry 
      SET rank_position = ranked.rank,
          updated_at = NOW()
      FROM ranked
      WHERE driver_qualification_registry.id = ranked.id`,
      [programmePeriodId]
    );
    logger.debug(`Updated ranks for driver qualifications in period ${programmePeriodId}`);
  }

  /**
   * Mark driver as winner selected
   */
  static async markWinnerSelected(
    driverId: string,
    programmePeriodId: string,
    profitShareAmount: number
  ): Promise<void> {
    await pool.query(
      `UPDATE driver_qualification_registry 
       SET winner_selected = true,
           profit_share_allocated = $1,
           updated_at = NOW()
       WHERE driver_id = $2 AND programme_period_id = $3`,
      [profitShareAmount, driverId, programmePeriodId]
    );
    logger.info(`Driver marked as winner: ${driverId}, profit share: ${profitShareAmount}`);
  }

  /**
   * Mark driver profit share as paid
   */
  static async markProfitSharePaid(
    driverId: string,
    programmePeriodId: string
  ): Promise<void> {
    await pool.query(
      `UPDATE driver_qualification_registry 
       SET profit_share_paid = true,
           updated_at = NOW()
       WHERE driver_id = $1 AND programme_period_id = $2`,
      [driverId, programmePeriodId]
    );
    logger.info(`Driver profit share paid: ${driverId}`);
  }

  /**
   * Check if driver is qualified
   */
  static async isQualified(driverId: string, programmePeriodId: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM driver_qualification_registry 
       WHERE driver_id = $1 
         AND programme_period_id = $2 
         AND qualification_status = 'qualified'
         AND (fraud_review_status IS NULL OR fraud_review_status != 'excluded')
       LIMIT 1`,
      [driverId, programmePeriodId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get total qualifying contribution for a driver across all programme periods
   */
  static async getTotalQualifyingContribution(driverId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COALESCE(SUM(qualifying_contribution), 0) as total 
       FROM driver_qualification_registry 
       WHERE driver_id = $1 
         AND qualification_status != 'excluded'`,
      [driverId]
    );
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get all excluded drivers for a programme period
   */
  static async getExcludedDrivers(programmePeriodId: string): Promise<IDriverQualification[]> {
    const result = await pool.query(
      `SELECT * FROM driver_qualification_registry 
       WHERE programme_period_id = $1 
         AND fraud_review_status = 'excluded'
       ORDER BY created_at DESC`,
      [programmePeriodId]
    );
    return result.rows;
  }

  /**
   * Get the threshold for a programme period
   * Falls back to default if period not found
   */
  private static async getThreshold(programmePeriodId: string): Promise<number> {
    const result = await pool.query(
      'SELECT driver_threshold FROM programme_periods WHERE id = $1',
      [programmePeriodId]
    );
    return parseFloat(result.rows[0]?.driver_threshold || String(this.DEFAULT_THRESHOLD));
  }
}

export default DriverQualificationModel;