import pool from '../config/database';
import { IProgrammePeriod, ICreateProgrammePeriod } from '../types';
import logger from '../utils/logger';

export class ProgrammePeriodModel {
  /**
   * Get the currently active programme period
   * Returns the first active period ordered by creation date
   */
  static async getActive(): Promise<IProgrammePeriod | null> {
    const result = await pool.query(
      `SELECT * FROM programme_periods 
       WHERE status = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      ['active']
    );
    return result.rows[0] || null;
  }

  /**
   * Get the current programme period based on date range
   * Returns the active period where today is between start_date and end_date
   */
  static async getCurrent(): Promise<IProgrammePeriod | null> {
    const result = await pool.query(
      `SELECT * FROM programme_periods 
       WHERE status = 'active' 
         AND NOW() BETWEEN start_date AND end_date
       ORDER BY created_at DESC 
       LIMIT 1`
    );
    return result.rows[0] || null;
  }

  /**
   * Get a programme period by ID
   */
  static async getById(id: string): Promise<IProgrammePeriod | null> {
    const result = await pool.query(
      'SELECT * FROM programme_periods WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get programme period by year
   */
  static async getByYear(year: number): Promise<IProgrammePeriod | null> {
    const result = await pool.query(
      'SELECT * FROM programme_periods WHERE year = $1 ORDER BY created_at DESC LIMIT 1',
      [year]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all programme periods with optional status filter
   */
  static async getAll(status?: string, page: number = 1, limit: number = 20): Promise<{ periods: IProgrammePeriod[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM programme_periods';
    let countQuery = 'SELECT COUNT(*) as total FROM programme_periods';
    const params: any[] = [];
    const countParams: any[] = [];

    if (status) {
      query += ' WHERE status = $1';
      countQuery += ' WHERE status = $1';
      params.push(status);
      countParams.push(status);
    }

    query += ` ORDER BY year DESC, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);

    return {
      periods: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Create a new programme period
   */
  static async create(data: ICreateProgrammePeriod): Promise<IProgrammePeriod> {
    const query = `
      INSERT INTO programme_periods (
        year,
        start_date,
        end_date,
        passenger_threshold,
        driver_threshold,
        winner_cap_percentage,
        individual_reward_cap,
        rebate_contribution_rate,
        profit_pool_percentage,
        status,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      data.year,
      data.start_date,
      data.end_date,
      data.passenger_threshold ?? 500000.00,
      data.driver_threshold ?? 15000000.00,
      data.winner_cap_percentage ?? 1.00,
      data.individual_reward_cap ?? null,
      data.rebate_contribution_rate ?? 1.00,
      data.profit_pool_percentage ?? 1.00,
      data.status || 'draft',
      data.created_by || null,
    ];

    const result = await pool.query(query, values);
    logger.info(`Programme period created: ${result.rows[0].year} (${result.rows[0].id})`);
    return result.rows[0];
  }

  /**
   * Update programme period status
   */
  static async updateStatus(
    id: string,
    status: 'draft' | 'active' | 'closed' | 'archived',
    updatedBy?: string
  ): Promise<IProgrammePeriod | null> {
    // Build the SET clause based on the target status
    let statusClause = `status = $1, updated_at = NOW()`;
    const params: any[] = [status];

    // Add timestamp fields based on status transition
    if (status === 'active') {
      statusClause += `, opened_at = COALESCE(opened_at, NOW())`;
    } else if (status === 'closed') {
      statusClause += `, closed_at = COALESCE(closed_at, NOW())`;
    } else if (status === 'archived') {
      statusClause += `, archived_at = COALESCE(archived_at, NOW())`;
    }

    if (updatedBy) {
      statusClause += `, updated_by = $${params.length + 1}`;
      params.push(updatedBy);
    }

    params.push(id);

    const query = `
      UPDATE programme_periods 
      SET ${statusClause}
      WHERE id = $${params.length}
      RETURNING *
    `;

    const result = await pool.query(query, params);
    
    if (result.rows[0]) {
      logger.info(`Programme period ${id} status updated to: ${status}`);
    }
    
    return result.rows[0] || null;
  }

  /**
   * Update programme period configuration
   */
  static async updateConfig(
    id: string,
    data: Partial<ICreateProgrammePeriod>,
    updatedBy?: string
  ): Promise<IProgrammePeriod | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    const fields: Record<string, any> = {
      passenger_threshold: data.passenger_threshold,
      driver_threshold: data.driver_threshold,
      winner_cap_percentage: data.winner_cap_percentage,
      individual_reward_cap: data.individual_reward_cap,
      rebate_contribution_rate: data.rebate_contribution_rate,
      profit_pool_percentage: data.profit_pool_percentage,
    };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (data.start_date) {
      updates.push(`start_date = $${paramCount}`);
      values.push(data.start_date);
      paramCount++;
    }

    if (data.end_date) {
      updates.push(`end_date = $${paramCount}`);
      values.push(data.end_date);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);

    if (updatedBy) {
      updates.push(`updated_by = $${paramCount}`);
      values.push(updatedBy);
      paramCount++;
    }

    values.push(id);

    const query = `
      UPDATE programme_periods 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    
    if (result.rows[0]) {
      logger.info(`Programme period ${id} configuration updated`);
    }
    
    return result.rows[0] || null;
  }

  /**
   * Calculate active passenger count for a programme period
   * Counts distinct passengers who completed at least one eligible ride
   */
  static async getActivePassengerCount(periodId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT passenger_id) as count 
       FROM rides 
       WHERE programme_period_id = $1 
         AND status = 'ride_completed'
         AND ride_eligible_for_qualification = true
         AND fraud_review_status = 'clean'`,
      [periodId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Calculate active driver count for a programme period
   * Counts distinct drivers who completed at least one eligible ride
   */
  static async getActiveDriverCount(periodId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT driver_id) as count 
       FROM rides 
       WHERE programme_period_id = $1 
         AND status = 'ride_completed'
         AND ride_eligible_for_qualification = true
         AND fraud_review_status = 'clean'`,
      [periodId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Update active counts for a programme period
   */
  static async updateActiveCounts(periodId: string): Promise<void> {
    const passengerCount = await this.getActivePassengerCount(periodId);
    const driverCount = await this.getActiveDriverCount(periodId);

    await pool.query(
      `UPDATE programme_periods 
       SET active_passenger_count = $1,
           active_driver_count = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [passengerCount, driverCount, periodId]
    );

    logger.info(`Updated active counts for period ${periodId}: ${passengerCount} passengers, ${driverCount} drivers`);
  }

  /**
   * Check if a programme period exists
   */
  static async exists(id: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT 1 FROM programme_periods WHERE id = $1',
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get the default/current programme period
   * Falls back to active period if no current date-range period exists
   */
  static async getDefault(): Promise<IProgrammePeriod | null> {
    // Try to get the current period first
    const current = await this.getCurrent();
    if (current) {
      return current;
    }

    // Fall back to any active period
    const active = await this.getActive();
    if (active) {
      return active;
    }

    // Fall back to the most recent period
    const result = await pool.query(
      'SELECT * FROM programme_periods ORDER BY year DESC, created_at DESC LIMIT 1'
    );
    return result.rows[0] || null;
  }

  /**
   * Validate programme period dates
   */
  static validateDates(startDate: Date | string, endDate: Date | string): { valid: boolean; message?: string } {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { valid: false, message: 'Invalid date format' };
    }

    if (start >= end) {
      return { valid: false, message: 'Start date must be before end date' };
    }

    return { valid: true };
  }

  /**
   * Get the winner capacity for a programme period
   * Returns 1% of active users (rounded down, minimum 1)
   */
  static async getWinnerCapacity(periodId: string, userType: 'passenger' | 'driver'): Promise<number> {
    const period = await this.getById(periodId);
    if (!period) {
      return 0;
    }

    let activeCount: number;
    if (userType === 'passenger') {
      activeCount = await this.getActivePassengerCount(periodId);
    } else {
      activeCount = await this.getActiveDriverCount(periodId);
    }

    // winner_cap_percentage is stored as 1.00 meaning 1%
    const capacity = Math.max(1, Math.floor(activeCount * (period.winner_cap_percentage / 100)));
    return capacity;
  }
}

export default ProgrammePeriodModel;