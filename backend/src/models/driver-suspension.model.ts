import pool from '../config/database';
import logger from '../utils/logger';

// ============================================
// SUSPENSION REASON CODES
// ============================================
// Keep in sync with the CHECK constraint on
// driver_suspensions.reason_code.

export type SuspensionReasonCode =
  | 'cash_violation'
  | 'bad_service_reviews'
  | 'kyc_fraud'
  | 'vehicle_document_fraud'
  | 'kyc_expired'
  | 'repeated_no_show'
  | 'safety_complaint'
  | 'fraud_detection'
  | 'manual_admin'
  | 'other';

export type SuspensionStatus = 'suspended' | 'reinstated';

export interface IDriverSuspension {
  id: string;
  driver_id: string;
  reason_code: SuspensionReasonCode;
  reason: string;
  violation_id: string | null;
  status: SuspensionStatus;
  suspended_at: Date;
  reinstated_at: Date | null;
  suspended_by: string | null;
  reinstated_by: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateDriverSuspension {
  driver_id: string;
  reason_code: SuspensionReasonCode;
  reason: string;                 // human-readable summary
  violation_id?: string | null;
  suspended_by?: string | null;   // null = system-triggered
  notes?: string | null;
}

export interface IGetSuspensionsFilter {
  status?: SuspensionStatus;
  driver_id?: string;
  reason_code?: SuspensionReasonCode;
  from?: Date;
  to?: Date;
}

export class DriverSuspensionModel {
  // ============================================
  // WRITE
  // ============================================

  /**
   * Record a suspension.
   *
   * The caller is responsible for actually flipping
   * driver_profiles.driver_status. This method only writes the audit row.
   */
  static async create(
    data: ICreateDriverSuspension
  ): Promise<IDriverSuspension> {
    const result = await pool.query(
      `INSERT INTO driver_suspensions (
        driver_id,
        reason_code,
        reason,
        violation_id,
        status,
        suspended_at,
        suspended_by,
        notes
      ) VALUES ($1, $2, $3, $4, 'suspended', NOW(), $5, $6)
      RETURNING *`,
      [
        data.driver_id,
        data.reason_code,
        data.reason,
        data.violation_id || null,
        data.suspended_by || null,
        data.notes || null,
      ]
    );

    logger.warn(
      `Driver suspension recorded: driver=${data.driver_id} reason=${data.reason_code}`
    );
    return result.rows[0];
  }

  /**
   * Mark a suspension as reinstated.
   */
  static async reinstate(
    suspensionId: string,
    reinstatedBy: string,
    notes?: string
  ): Promise<IDriverSuspension | null> {
    const result = await pool.query(
      `UPDATE driver_suspensions
       SET status = 'reinstated',
           reinstated_at = NOW(),
           reinstated_by = $1,
           notes = COALESCE($2, notes),
           updated_at = NOW()
       WHERE id = $3 AND status = 'suspended'
       RETURNING *`,
      [reinstatedBy, notes || null, suspensionId]
    );

    if (result.rows[0]) {
      logger.info(
        `Driver suspension reinstated: id=${suspensionId} by=${reinstatedBy}`
      );
    }
    return result.rows[0] || null;
  }

  // ============================================
  // READ — SINGLE ROW
  // ============================================

  static async getById(id: string): Promise<IDriverSuspension | null> {
    const result = await pool.query(
      'SELECT * FROM driver_suspensions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Latest suspension row for a driver (any status).
   */
  static async getLatestByDriver(
    driverId: string
  ): Promise<IDriverSuspension | null> {
    const result = await pool.query(
      `SELECT * FROM driver_suspensions
       WHERE driver_id = $1
       ORDER BY suspended_at DESC
       LIMIT 1`,
      [driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * The currently-active suspension for a driver, if any.
   * Returns null if the driver has no open suspension.
   */
  static async getActiveByDriver(
    driverId: string
  ): Promise<IDriverSuspension | null> {
    const result = await pool.query(
      `SELECT * FROM driver_suspensions
       WHERE driver_id = $1 AND status = 'suspended'
       ORDER BY suspended_at DESC
       LIMIT 1`,
      [driverId]
    );
    return result.rows[0] || null;
  }

  // ============================================
  // READ — AGGREGATE / BOOLEAN
  // ============================================

  /**
   * Is the driver currently suspended?
   */
  static async isCurrentlySuspended(driverId: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM driver_suspensions
       WHERE driver_id = $1 AND status = 'suspended'
       LIMIT 1`,
      [driverId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Total number of suspensions a driver has ever received.
   * Used by the escalation ladder.
   */
  static async countByDriver(driverId: string): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM driver_suspensions WHERE driver_id = $1',
      [driverId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Count suspensions by reason_code over a window (or all time).
   * Useful for analytics and for admin dashboards.
   */
  static async countByReasonCode(
    reasonCode?: SuspensionReasonCode
  ): Promise<Record<string, number>> {
    let query = `SELECT reason_code, COUNT(*) as count
                 FROM driver_suspensions`;
    const params: any[] = [];

    if (reasonCode) {
      query += ' WHERE reason_code = $1';
      params.push(reasonCode);
    }

    query += ' GROUP BY reason_code';

    const result = await pool.query(query, params);
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.reason_code] = parseInt(row.count, 10);
    }
    return counts;
  }

  /**
   * Count suspensions by status (suspended vs reinstated).
   */
  static async countByStatus(): Promise<Record<SuspensionStatus, number>> {
    const result = await pool.query(
      `SELECT status, COUNT(*) as count
       FROM driver_suspensions
       GROUP BY status`
    );

    const counts: Record<SuspensionStatus, number> = {
      suspended: 0,
      reinstated: 0,
    };

    for (const row of result.rows) {
      if (row.status in counts) {
        counts[row.status as SuspensionStatus] = parseInt(row.count, 10);
      }
    }
    return counts;
  }

  // ============================================
  // READ — LISTS (ADMIN)
  // ============================================

  static async getAll(
    filters: IGetSuspensionsFilter = {},
    page: number = 1,
    limit: number = 100
  ): Promise<{ suspensions: IDriverSuspension[]; total: number }> {
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: any[] = [];
    const countParams: any[] = [];
    let paramCount = 1;

    if (filters.status) {
      conditions.push(`status = $${paramCount}`);
      params.push(filters.status);
      countParams.push(filters.status);
      paramCount++;
    }

    if (filters.driver_id) {
      conditions.push(`driver_id = $${paramCount}`);
      params.push(filters.driver_id);
      countParams.push(filters.driver_id);
      paramCount++;
    }

    if (filters.reason_code) {
      conditions.push(`reason_code = $${paramCount}`);
      params.push(filters.reason_code);
      countParams.push(filters.reason_code);
      paramCount++;
    }

    if (filters.from) {
      conditions.push(`suspended_at >= $${paramCount}`);
      params.push(filters.from);
      countParams.push(filters.from);
      paramCount++;
    }

    if (filters.to) {
      conditions.push(`suspended_at <= $${paramCount}`);
      params.push(filters.to);
      countParams.push(filters.to);
      paramCount++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT * FROM driver_suspensions
      ${whereClause}
      ORDER BY suspended_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) as total FROM driver_suspensions
      ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams),
    ]);

    return {
      suspensions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10),
    };
  }

  /**
   * Suspension with the driver's name and phone, for admin tables.
   */
  static async getWithDriverDetails(id: string): Promise<any> {
    const result = await pool.query(
      `SELECT
         ds.*,
         d.first_name AS driver_first_name,
         d.last_name  AS driver_last_name,
         d.driver_status,
         u.phone_number AS driver_phone,
         u.email        AS driver_email
       FROM driver_suspensions ds
       JOIN driver_profiles d ON ds.driver_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE ds.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * All currently-suspended drivers with their driver details.
   * For the admin "currently suspended" tab.
   */
  static async getAllActiveWithDriverDetails(
    page: number = 1,
    limit: number = 100
  ): Promise<{ suspensions: any[]; total: number }> {
    const offset = (page - 1) * limit;

    const [result, countResult] = await Promise.all([
      pool.query(
        `SELECT
           ds.*,
           d.first_name AS driver_first_name,
           d.last_name  AS driver_last_name,
           d.driver_status,
           d.total_commission_owed,
           u.phone_number AS driver_phone,
           u.email        AS driver_email
         FROM driver_suspensions ds
         JOIN driver_profiles d ON ds.driver_id = d.id
         JOIN users u ON d.user_id = u.id
         WHERE ds.status = 'suspended'
         ORDER BY ds.suspended_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) as total FROM driver_suspensions WHERE status = 'suspended'`
      ),
    ]);

    return {
      suspensions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10),
    };
  }
}

export default DriverSuspensionModel;