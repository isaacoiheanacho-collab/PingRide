import pool from '../config/database';
import { 
  ISettlement, 
  ICreateSettlement, 
  IUpdateSettlement 
} from '../types/payment.types';
import logger from '../utils/logger';

export class SettlementModel {
  // ============================================
  // SETTLEMENT CRUD
  // ============================================

  /**
   * Create a settlement
   */
  static async create(data: ICreateSettlement): Promise<ISettlement> {
    const result = await pool.query(
      `INSERT INTO settlements (
        driver_id,
        period_start,
        period_end,
        total_earnings,
        total_commission,
        net_payout,
        payout_method,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        data.driver_id,
        data.period_start,
        data.period_end,
        data.total_earnings,
        data.total_commission,
        data.net_payout,
        data.payout_method,
        'pending',
      ]
    );
    logger.info(`Settlement created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  /**
   * Get settlement by ID
   */
  static async getById(id: string): Promise<ISettlement | null> {
    const result = await pool.query(
      'SELECT * FROM settlements WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get settlements by driver ID with pagination
   */
  static async getByDriverId(
    driverId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ settlements: ISettlement[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM settlements 
       WHERE driver_id = $1 
       ORDER BY period_start DESC
       LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM settlements WHERE driver_id = $1',
      [driverId]
    );

    return {
      settlements: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get all settlements with pagination and filters
   */
  static async getAll(
    page: number = 1,
    limit: number = 100,
    filters?: {
      status?: string;
      driver_id?: string;
      start_date?: string;
      end_date?: string;
    }
  ): Promise<{ settlements: ISettlement[]; total: number }> {
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: any[] = [];
    const countParams: any[] = [];
    let paramCount = 1;

    if (filters?.status) {
      conditions.push(`status = $${paramCount}`);
      params.push(filters.status);
      countParams.push(filters.status);
      paramCount++;
    }

    if (filters?.driver_id) {
      conditions.push(`driver_id = $${paramCount}`);
      params.push(filters.driver_id);
      countParams.push(filters.driver_id);
      paramCount++;
    }

    if (filters?.start_date) {
      conditions.push(`period_end >= $${paramCount}`);
      params.push(filters.start_date);
      countParams.push(filters.start_date);
      paramCount++;
    }

    if (filters?.end_date) {
      conditions.push(`period_start <= $${paramCount}`);
      params.push(filters.end_date);
      countParams.push(filters.end_date);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT * FROM settlements 
      ${whereClause}
      ORDER BY period_start DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) as total FROM settlements 
      ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);

    return {
      settlements: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get settlement by period and driver
   */
  static async getByPeriodAndDriver(
    driverId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<ISettlement | null> {
    const result = await pool.query(
      `SELECT * FROM settlements 
       WHERE driver_id = $1 
         AND period_start = $2 
         AND period_end = $3
       LIMIT 1`,
      [driverId, periodStart, periodEnd]
    );
    return result.rows[0] || null;
  }

  /**
   * Get pending settlements
   */
  static async getPendingSettlements(
    page: number = 1,
    limit: number = 100
  ): Promise<{ settlements: ISettlement[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM settlements 
       WHERE status = 'pending' 
       ORDER BY period_start ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      "SELECT COUNT(*) as total FROM settlements WHERE status = 'pending'"
    );

    return {
      settlements: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Update settlement
   */
  static async update(id: string, data: IUpdateSettlement): Promise<ISettlement | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.status !== undefined) {
      updates.push(`status = $${paramCount}`);
      values.push(data.status);
      paramCount++;
    }

    if (data.reference !== undefined) {
      updates.push(`reference = $${paramCount}`);
      values.push(data.reference);
      paramCount++;
    }

    if (data.processed_at !== undefined) {
      updates.push(`processed_at = $${paramCount}`);
      values.push(data.processed_at);
      paramCount++;
    }

    if (data.paid_at !== undefined) {
      updates.push(`paid_at = $${paramCount}`);
      values.push(data.paid_at);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE settlements 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update settlement status
   */
  static async updateStatus(
    id: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    reference?: string
  ): Promise<ISettlement | null> {
    const updates = [`status = $1`, `updated_at = NOW()`];
    const params: any[] = [status];

    if (status === 'processing') {
      updates.push(`processed_at = NOW()`);
    }

    if (status === 'completed') {
      updates.push(`paid_at = NOW()`);
    }

    if (reference) {
      updates.push(`reference = $${params.length + 1}`);
      params.push(reference);
    }

    params.push(id);

    const result = await pool.query(
      `UPDATE settlements 
       SET ${updates.join(', ')} 
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }

  /**
   * Mark settlement as processing
   */
  static async markProcessing(id: string, reference?: string): Promise<ISettlement | null> {
    return this.updateStatus(id, 'processing', reference);
  }

  /**
   * Mark settlement as completed
   */
  static async markCompleted(id: string, reference?: string): Promise<ISettlement | null> {
    return this.updateStatus(id, 'completed', reference);
  }

  /**
   * Mark settlement as failed
   */
  static async markFailed(id: string, reason?: string): Promise<ISettlement | null> {
    const result = await pool.query(
      `UPDATE settlements 
       SET status = 'failed',
           reference = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason || 'Settlement failed', id]
    );
    return result.rows[0] || null;
  }

  // ============================================
  // AGGREGATE FUNCTIONS
  // ============================================

  /**
   * Get total payouts for a driver
   */
  static async getTotalPayouts(driverId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COALESCE(SUM(net_payout), 0) as total 
       FROM settlements 
       WHERE driver_id = $1 AND status = 'completed'`,
      [driverId]
    );
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get total pending payouts
   */
  static async getTotalPendingPayouts(): Promise<number> {
    const result = await pool.query(
      `SELECT COALESCE(SUM(net_payout), 0) as total 
       FROM settlements 
       WHERE status IN ('pending', 'processing')`
    );
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get settlement count by status
   */
  static async getCountByStatus(): Promise<Record<string, number>> {
    const result = await pool.query(
      'SELECT status, COUNT(*) as count FROM settlements GROUP BY status'
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }
    return counts;
  }

  /**
   * Get settlement with driver details
   */
  static async getWithDriverDetails(id: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        s.*,
        d.first_name as driver_first_name,
        d.last_name as driver_last_name,
        u.phone_number as driver_phone,
        d.total_earnings as driver_total_earnings,
        d.total_rides as driver_total_rides
       FROM settlements s
       JOIN driver_profiles d ON s.driver_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE s.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get settlements summary for a driver
   */
  static async getDriverSettlementSummary(driverId: string): Promise<{
    totalSettlements: number;
    totalEarnings: number;
    totalCommission: number;
    totalPayout: number;
    pendingCount: number;
    completedCount: number;
  }> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_settlements,
        COALESCE(SUM(total_earnings), 0) as total_earnings,
        COALESCE(SUM(total_commission), 0) as total_commission,
        COALESCE(SUM(net_payout), 0) as total_payout,
        COUNT(CASE WHEN status IN ('pending', 'processing') THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count
       FROM settlements
       WHERE driver_id = $1`,
      [driverId]
    );

    const row = result.rows[0];
    return {
      totalSettlements: parseInt(row?.total_settlements || '0', 10),
      totalEarnings: parseFloat(row?.total_earnings || '0'),
      totalCommission: parseFloat(row?.total_commission || '0'),
      totalPayout: parseFloat(row?.total_payout || '0'),
      pendingCount: parseInt(row?.pending_count || '0', 10),
      completedCount: parseInt(row?.completed_count || '0', 10),
    };
  }

  /**
   * Get settlements by date range
   */
  static async getByDateRange(
    startDate: string,
    endDate: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ settlements: ISettlement[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM settlements 
       WHERE period_start >= $1 AND period_end <= $2
       ORDER BY period_start DESC
       LIMIT $3 OFFSET $4`,
      [startDate, endDate, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM settlements 
       WHERE period_start >= $1 AND period_end <= $2`,
      [startDate, endDate]
    );

    return {
      settlements: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get all settlements with driver info (admin)
   */
  static async getAllWithDriverDetails(
    page: number = 1,
    limit: number = 100,
    status?: string
  ): Promise<{ settlements: any[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = `
      SELECT 
        s.*,
        d.first_name as driver_first_name,
        d.last_name as driver_last_name,
        u.phone_number as driver_phone
      FROM settlements s
      JOIN driver_profiles d ON s.driver_id = d.id
      JOIN users u ON d.user_id = u.id
    `;
    const params: any[] = [];

    if (status) {
      query += ` WHERE s.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY s.period_start DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    let countQuery = 'SELECT COUNT(*) as total FROM settlements s';
    if (status) {
      countQuery += ` WHERE s.status = $1`;
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, status ? [status] : [])
    ]);

    return {
      settlements: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }
}

export default SettlementModel;