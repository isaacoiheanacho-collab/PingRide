import pool from '../config/database';
import {
  IFraudCase,
  FraudCaseType,
  FraudSeverity,
  FraudCaseStatus,
  IQualificationExclusion,
  ExclusionType,
} from '../types';
import logger from '../utils/logger';

export class FraudCaseModel {
  // ============================================
  // FRAUD CASES
  // ============================================

  /**
   * Create a fraud case
   */
  static async create(data: {
    programmePeriodId: string;
    caseType: FraudCaseType;
    passengerId?: string;
    driverId?: string;
    rideIds?: string[];
    suspicionScore: number;
    description?: string;
    evidence?: any;
    severity: FraudSeverity;
    detectedBy?: string;
  }): Promise<IFraudCase> {
    const result = await pool.query(
      `INSERT INTO incentive_fraud_cases (
        programme_period_id,
        case_type,
        passenger_id,
        driver_id,
        ride_ids,
        suspicion_score,
        description,
        evidence,
        severity,
        detected_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *`,
      [
        data.programmePeriodId,
        data.caseType,
        data.passengerId || null,
        data.driverId || null,
        data.rideIds || [],
        data.suspicionScore,
        data.description || null,
        data.evidence || null,
        data.severity,
      ]
    );

    logger.warn(`Fraud case created: ${result.rows[0].id} (${data.caseType})`);
    return result.rows[0];
  }

  /**
   * Get fraud case by ID
   */
  static async getById(id: string): Promise<IFraudCase | null> {
    const result = await pool.query(
      'SELECT * FROM incentive_fraud_cases WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get fraud cases by programme period
   */
  static async getByProgrammePeriod(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM incentive_fraud_cases 
       WHERE programme_period_id = $1 
       ORDER BY suspicion_score DESC, detected_at DESC
       LIMIT $2 OFFSET $3`,
      [programmePeriodId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM incentive_fraud_cases 
       WHERE programme_period_id = $1`,
      [programmePeriodId]
    );

    return {
      cases: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get fraud cases by status
   */
  static async getByStatus(
    status: FraudCaseStatus,
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM incentive_fraud_cases 
       WHERE status = $1 
       ORDER BY suspicion_score DESC, detected_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM incentive_fraud_cases 
       WHERE status = $1`,
      [status]
    );

    return {
      cases: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get fraud cases by user (passenger or driver)
   */
  static async getByUser(
    userId: string,
    userType: 'passenger' | 'driver',
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    const column = userType === 'passenger' ? 'passenger_id' : 'driver_id';
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT * FROM incentive_fraud_cases 
       WHERE ${column} = $1 
       ORDER BY detected_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM incentive_fraud_cases 
       WHERE ${column} = $1`,
      [userId]
    );

    return {
      cases: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get fraud cases by severity
   */
  static async getBySeverity(
    severity: FraudSeverity,
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM incentive_fraud_cases 
       WHERE severity = $1 
       ORDER BY detected_at DESC
       LIMIT $2 OFFSET $3`,
      [severity, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM incentive_fraud_cases 
       WHERE severity = $1`,
      [severity]
    );

    return {
      cases: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get fraud cases by type
   */
  static async getByType(
    caseType: FraudCaseType,
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM incentive_fraud_cases 
       WHERE case_type = $1 
       ORDER BY detected_at DESC
       LIMIT $2 OFFSET $3`,
      [caseType, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM incentive_fraud_cases 
       WHERE case_type = $1`,
      [caseType]
    );

    return {
      cases: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get pending fraud cases (detected or investigating)
   */
  static async getPendingCases(
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM incentive_fraud_cases 
       WHERE status IN ('detected', 'investigating') 
       ORDER BY severity DESC, suspicion_score DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM incentive_fraud_cases 
       WHERE status IN ('detected', 'investigating')`
    );

    return {
      cases: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Update fraud case status
   */
  static async updateStatus(
    caseId: string,
    status: FraudCaseStatus,
    notes?: string,
    resolvedBy?: string
  ): Promise<IFraudCase | null> {
    const updates: string[] = [`status = $1`, `updated_at = NOW()`];
    const params: any[] = [status];

    if (status === 'investigating') {
      updates.push(`investigated_at = NOW()`);
    }

    if (status === 'confirmed' || status === 'dismissed' || status === 'resolved') {
      updates.push(`resolved_at = NOW()`);
      if (resolvedBy) {
        updates.push(`resolved_by = $${params.length + 1}`);
        params.push(resolvedBy);
      }
    }

    if (notes) {
      updates.push(`resolution_notes = $${params.length + 1}`);
      params.push(notes);
    }

    params.push(caseId);

    const result = await pool.query(
      `UPDATE incentive_fraud_cases 
       SET ${updates.join(', ')} 
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );

    if (result.rows[0]) {
      logger.info(`Fraud case ${caseId} status updated to: ${status}`);
    }

    return result.rows[0] || null;
  }

  /**
   * Assign investigator to fraud case
   */
  static async assignInvestigator(
    caseId: string,
    investigatorId: string
  ): Promise<IFraudCase | null> {
    const result = await pool.query(
      `UPDATE incentive_fraud_cases 
       SET investigated_by = $1,
           status = 'investigating',
           investigated_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [investigatorId, caseId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get fraud cases count by status
   */
  static async getCountByStatus(): Promise<Record<FraudCaseStatus, number>> {
    const result = await pool.query(
      `SELECT status, COUNT(*) as count 
       FROM incentive_fraud_cases 
       GROUP BY status`
    );

    const counts: Record<FraudCaseStatus, number> = {
      detected: 0,
      investigating: 0,
      confirmed: 0,
      dismissed: 0,
      resolved: 0,
    };

    for (const row of result.rows) {
      if (row.status in counts) {
        counts[row.status as FraudCaseStatus] = parseInt(row.count, 10);
      }
    }

    return counts;
  }

  /**
   * Get fraud cases with high suspicion score (> 70)
   */
  static async getHighSuspicionCases(
    threshold: number = 70,
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM incentive_fraud_cases 
       WHERE suspicion_score >= $1 
         AND status NOT IN ('resolved', 'dismissed')
       ORDER BY suspicion_score DESC
       LIMIT $2 OFFSET $3`,
      [threshold, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM incentive_fraud_cases 
       WHERE suspicion_score >= $1 
         AND status NOT IN ('resolved', 'dismissed')`,
      [threshold]
    );

    return {
      cases: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Delete fraud case (for cleanup/testing)
   */
  static async delete(id: string): Promise<void> {
    await pool.query(
      'DELETE FROM incentive_fraud_cases WHERE id = $1',
      [id]
    );
    logger.warn(`Fraud case deleted: ${id}`);
  }

  // ============================================
  // QUALIFICATION EXCLUSIONS
  // ============================================

  /**
   * Create a qualification exclusion
   */
  static async createExclusion(data: {
    programmePeriodId: string;
    userType: 'passenger' | 'driver';
    userId: string;
    fraudCaseId?: string;
    exclusionType: ExclusionType;
    exclusionReason: string;
    affectedAmount?: number;
  }): Promise<IQualificationExclusion> {
    const result = await pool.query(
      `INSERT INTO qualification_exclusions (
        programme_period_id,
        user_type,
        user_id,
        fraud_case_id,
        exclusion_type,
        exclusion_reason,
        affected_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        data.programmePeriodId,
        data.userType,
        data.userId,
        data.fraudCaseId || null,
        data.exclusionType,
        data.exclusionReason,
        data.affectedAmount || null,
      ]
    );

    logger.warn(`Qualification exclusion created: ${data.userId} (${data.userType}) - ${data.exclusionType}`);
    return result.rows[0];
  }

  /**
   * Get exclusion by ID
   */
  static async getExclusionById(id: string): Promise<IQualificationExclusion | null> {
    const result = await pool.query(
      'SELECT * FROM qualification_exclusions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get exclusions by user
   */
  static async getExclusionsByUser(
    userId: string,
    userType: 'passenger' | 'driver'
  ): Promise<IQualificationExclusion[]> {
    const result = await pool.query(
      `SELECT * FROM qualification_exclusions 
       WHERE user_id = $1 AND user_type = $2
       ORDER BY created_at DESC`,
      [userId, userType]
    );
    return result.rows;
  }

  /**
   * Get exclusions by programme period
   */
  static async getExclusionsByPeriod(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ exclusions: IQualificationExclusion[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM qualification_exclusions 
       WHERE programme_period_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [programmePeriodId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM qualification_exclusions 
       WHERE programme_period_id = $1`,
      [programmePeriodId]
    );

    return {
      exclusions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get active exclusions (not reversed)
   */
  static async getActiveExclusions(programmePeriodId: string): Promise<IQualificationExclusion[]> {
    const result = await pool.query(
      `SELECT * FROM qualification_exclusions 
       WHERE programme_period_id = $1 AND reversed = false
       ORDER BY created_at DESC`,
      [programmePeriodId]
    );
    return result.rows;
  }

  /**
   * Check if a user is excluded
   */
  static async isExcluded(
    userId: string,
    userType: 'passenger' | 'driver',
    programmePeriodId: string
  ): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM qualification_exclusions 
       WHERE user_id = $1 
         AND user_type = $2 
         AND programme_period_id = $3 
         AND reversed = false
       LIMIT 1`,
      [userId, userType, programmePeriodId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Reverse an exclusion
   */
  static async reverseExclusion(
    exclusionId: string,
    reversedBy: string,
    reason?: string
  ): Promise<IQualificationExclusion | null> {
    const result = await pool.query(
      `UPDATE qualification_exclusions 
       SET reversed = true,
           reversed_at = NOW(),
           reversed_by = $1,
           exclusion_reason = CASE 
             WHEN $2 IS NOT NULL THEN exclusion_reason || ' (Reversed: ' || $2 || ')' 
             ELSE exclusion_reason 
           END,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [reversedBy, reason || null, exclusionId]
    );

    if (result.rows[0]) {
      logger.info(`Exclusion reversed: ${exclusionId} by ${reversedBy}`);
    }

    return result.rows[0] || null;
  }

  /**
   * Get all exclusions for a fraud case
   */
  static async getExclusionsByFraudCase(fraudCaseId: string): Promise<IQualificationExclusion[]> {
    const result = await pool.query(
      `SELECT * FROM qualification_exclusions 
       WHERE fraud_case_id = $1
       ORDER BY created_at DESC`,
      [fraudCaseId]
    );
    return result.rows;
  }

  /**
   * Get exclusion summary for a programme period
   */
  static async getExclusionSummary(programmePeriodId: string): Promise<{
    total: number;
    active: number;
    reversed: number;
    passengerCount: number;
    driverCount: number;
    byType: Record<ExclusionType, number>;
  }> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN reversed = false THEN 1 END) as active,
        COUNT(CASE WHEN reversed = true THEN 1 END) as reversed,
        COUNT(CASE WHEN user_type = 'passenger' THEN 1 END) as passenger_count,
        COUNT(CASE WHEN user_type = 'driver' THEN 1 END) as driver_count
       FROM qualification_exclusions
       WHERE programme_period_id = $1`,
      [programmePeriodId]
    );

    // Get counts by type
    const typeResult = await pool.query(
      `SELECT exclusion_type, COUNT(*) as count 
       FROM qualification_exclusions 
       WHERE programme_period_id = $1
       GROUP BY exclusion_type`,
      [programmePeriodId]
    );

    const byType: Record<ExclusionType, number> = {
      qualification_reversal: 0,
      winner_disqualification: 0,
      programme_ban: 0,
      temporary_suspension: 0,
    };

    for (const row of typeResult.rows) {
      byType[row.exclusion_type as ExclusionType] = parseInt(row.count, 10);
    }

    return {
      total: parseInt(result.rows[0]?.total || '0', 10),
      active: parseInt(result.rows[0]?.active || '0', 10),
      reversed: parseInt(result.rows[0]?.reversed || '0', 10),
      passengerCount: parseInt(result.rows[0]?.passenger_count || '0', 10),
      driverCount: parseInt(result.rows[0]?.driver_count || '0', 10),
      byType,
    };
  }
}

export default FraudCaseModel;