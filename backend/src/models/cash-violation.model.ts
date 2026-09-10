import pool from '../config/database';
import { 
  ICashViolation, 
  ICreateCashViolation, 
  IUpdateCashViolation 
} from '../types/payment.types';
import logger from '../utils/logger';

export class CashViolationModel {
  // ============================================
  // CASH VIOLATION CRUD
  // ============================================

  /**
   * Create a cash violation
   */
  static async create(data: ICreateCashViolation): Promise<ICashViolation> {
    const result = await pool.query(
      `INSERT INTO cash_violations (
        ride_id,
        passenger_id,
        driver_id,
        fare_amount,
        commission_amount,
        penalty_level
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        data.ride_id,
        data.passenger_id,
        data.driver_id,
        data.fare_amount,
        data.commission_amount,
        data.penalty_level || 'first',
      ]
    );
    logger.warn(`Cash violation created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  /**
   * Get violation by ID
   */
  static async getById(id: string): Promise<ICashViolation | null> {
    const result = await pool.query(
      'SELECT * FROM cash_violations WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get violations by driver ID with pagination
   */
  static async getByDriverId(
    driverId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ violations: ICashViolation[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM cash_violations 
       WHERE driver_id = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM cash_violations WHERE driver_id = $1',
      [driverId]
    );

    return {
      violations: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get violations by ride ID
   */
  static async getByRideId(rideId: string): Promise<ICashViolation | null> {
    const result = await pool.query(
      'SELECT * FROM cash_violations WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1',
      [rideId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all violations with pagination
   */
  static async getAll(
    page: number = 1,
    limit: number = 100,
    filters?: {
      driver_id?: string;
      penalty_level?: string;
      driver_suspended?: boolean;
      driver_reinstated?: boolean;
    }
  ): Promise<{ violations: ICashViolation[]; total: number }> {
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: any[] = [];
    const countParams: any[] = [];
    let paramCount = 1;

    if (filters?.driver_id) {
      conditions.push(`driver_id = $${paramCount}`);
      params.push(filters.driver_id);
      countParams.push(filters.driver_id);
      paramCount++;
    }

    if (filters?.penalty_level) {
      conditions.push(`penalty_level = $${paramCount}`);
      params.push(filters.penalty_level);
      countParams.push(filters.penalty_level);
      paramCount++;
    }

    if (filters?.driver_suspended !== undefined) {
      conditions.push(`driver_suspended = $${paramCount}`);
      params.push(filters.driver_suspended);
      countParams.push(filters.driver_suspended);
      paramCount++;
    }

    if (filters?.driver_reinstated !== undefined) {
      conditions.push(`driver_reinstated = $${paramCount}`);
      params.push(filters.driver_reinstated);
      countParams.push(filters.driver_reinstated);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT * FROM cash_violations 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) as total FROM cash_violations 
      ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);

    return {
      violations: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Update cash violation
   */
  static async update(id: string, data: IUpdateCashViolation): Promise<ICashViolation | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.passenger_deducted !== undefined) {
      updates.push(`passenger_deducted = $${paramCount}`);
      values.push(data.passenger_deducted);
      paramCount++;
    }

    if (data.driver_suspended !== undefined) {
      updates.push(`driver_suspended = $${paramCount}`);
      values.push(data.driver_suspended);
      paramCount++;
    }

    if (data.driver_reinstated !== undefined) {
      updates.push(`driver_reinstated = $${paramCount}`);
      values.push(data.driver_reinstated);
      paramCount++;
    }

    if (data.driver_payment_confirmed !== undefined) {
      updates.push(`driver_payment_confirmed = $${paramCount}`);
      values.push(data.driver_payment_confirmed);
      paramCount++;
    }

    if (data.violation_count !== undefined) {
      updates.push(`violation_count = $${paramCount}`);
      values.push(data.violation_count);
      paramCount++;
    }

    if (data.penalty_level !== undefined) {
      updates.push(`penalty_level = $${paramCount}`);
      values.push(data.penalty_level);
      paramCount++;
    }

    if (data.resolved_at !== undefined) {
      updates.push(`resolved_at = $${paramCount}`);
      values.push(data.resolved_at);
      paramCount++;
    }

    if (data.resolved_by !== undefined) {
      updates.push(`resolved_by = $${paramCount}`);
      values.push(data.resolved_by);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE cash_violations 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update penalty level
   */
  static async updatePenaltyLevel(
    id: string,
    penaltyLevel: 'first' | 'second' | 'third' | 'permanent'
  ): Promise<ICashViolation | null> {
    const result = await pool.query(
      `UPDATE cash_violations 
       SET penalty_level = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [penaltyLevel, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark driver as suspended
   */
  static async suspendDriver(id: string): Promise<ICashViolation | null> {
    const result = await pool.query(
      `UPDATE cash_violations 
       SET driver_suspended = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark driver as reinstated
   */
  static async reinstateDriver(id: string): Promise<ICashViolation | null> {
    const result = await pool.query(
      `UPDATE cash_violations 
       SET driver_reinstated = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark passenger as deducted
   */
  static async markPassengerDeducted(id: string): Promise<ICashViolation | null> {
    const result = await pool.query(
      `UPDATE cash_violations 
       SET passenger_deducted = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark driver payment as confirmed
   */
  static async confirmDriverPayment(id: string): Promise<ICashViolation | null> {
    const result = await pool.query(
      `UPDATE cash_violations 
       SET driver_payment_confirmed = true, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Resolve violation
   */
  static async resolve(
    id: string,
    resolvedBy: string
  ): Promise<ICashViolation | null> {
    const result = await pool.query(
      `UPDATE cash_violations 
       SET resolved_at = NOW(), resolved_by = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [resolvedBy, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Check if driver has active violations
   */
  static async hasActiveViolations(driverId: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM cash_violations 
       WHERE driver_id = $1 
         AND driver_suspended = true 
         AND driver_reinstated = false
       LIMIT 1`,
      [driverId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get violation count for a driver
   */
  static async getViolationCount(driverId: string): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM cash_violations WHERE driver_id = $1',
      [driverId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Get active violations count for a driver
   */
  static async getActiveViolationCount(driverId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM cash_violations 
       WHERE driver_id = $1 
         AND driver_reinstated = false`,
      [driverId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Get current penalty level for a driver
   */
  static async getCurrentPenaltyLevel(
    driverId: string
  ): Promise<'first' | 'second' | 'third' | 'permanent' | null> {
    const result = await pool.query(
      `SELECT penalty_level FROM cash_violations 
       WHERE driver_id = $1 
         AND driver_reinstated = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [driverId]
    );
    return result.rows[0]?.penalty_level || null;
  }

  // ============================================
  // AGGREGATE FUNCTIONS
  // ============================================

  /**
   * Get total violations count
   */
  static async getTotalCount(): Promise<number> {
    const result = await pool.query('SELECT COUNT(*) as count FROM cash_violations');
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Get total unpaid commission
   */
  static async getTotalUnpaidCommission(): Promise<number> {
    const result = await pool.query(
      `SELECT COALESCE(SUM(commission_amount), 0) as total 
       FROM cash_violations 
       WHERE driver_payment_confirmed = false`
    );
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get violation count by penalty level
   */
  static async getCountByPenaltyLevel(): Promise<Record<string, number>> {
    const result = await pool.query(
      'SELECT penalty_level, COUNT(*) as count FROM cash_violations GROUP BY penalty_level'
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.penalty_level] = parseInt(row.count, 10);
    }
    return counts;
  }

  /**
   * Get violation with ride and driver details
   */
  static async getWithDetails(id: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        cv.*,
        pp.first_name as passenger_first_name,
        pp.last_name as passenger_last_name,
        u.phone_number as passenger_phone,
        dp.first_name as driver_first_name,
        dp.last_name as driver_last_name,
        du.phone_number as driver_phone,
        r.status as ride_status,
        r.pickup_address,
        r.destination_address
       FROM cash_violations cv
       JOIN passenger_profiles pp ON cv.passenger_id = pp.id
       JOIN users u ON pp.user_id = u.id
       JOIN driver_profiles dp ON cv.driver_id = dp.id
       JOIN users du ON dp.user_id = du.id
       JOIN rides r ON cv.ride_id = r.id
       WHERE cv.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get violations summary for a driver
   */
  static async getDriverViolationSummary(driverId: string): Promise<{
    totalViolations: number;
    activeViolations: number;
    resolvedViolations: number;
    currentPenaltyLevel: string;
    totalCommissionOwed: number;
  }> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_violations,
        COUNT(CASE WHEN driver_reinstated = false THEN 1 END) as active_violations,
        COUNT(CASE WHEN driver_reinstated = true THEN 1 END) as resolved_violations,
        COUNT(CASE WHEN driver_payment_confirmed = false THEN 1 END) as unpaid_commission_count,
        COALESCE(SUM(CASE WHEN driver_payment_confirmed = false THEN commission_amount ELSE 0 END), 0) as total_commission_owed
       FROM cash_violations
       WHERE driver_id = $1`,
      [driverId]
    );

    const row = result.rows[0];
    const penaltyLevel = await this.getCurrentPenaltyLevel(driverId);

    return {
      totalViolations: parseInt(row?.total_violations || '0', 10),
      activeViolations: parseInt(row?.active_violations || '0', 10),
      resolvedViolations: parseInt(row?.resolved_violations || '0', 10),
      currentPenaltyLevel: penaltyLevel || 'none',
      totalCommissionOwed: parseFloat(row?.total_commission_owed || '0'),
    };
  }
}

export default CashViolationModel;