import pool from '../config/database';
import logger from '../utils/logger';

export interface IAuditLog {
  actor_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  old_values?: any;
  new_values?: any;
  ip_address?: string;
  user_agent?: string;
  status: 'success' | 'failure';
  failure_reason?: string;
}

export class AuditService {
  static async log(data: IAuditLog): Promise<void> {
    try {
      const query = `
        INSERT INTO audit_logs (
          actor_id, action, entity_type, entity_id, 
          old_values, new_values, ip_address, user_agent,
          status, failure_reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `;
      const values = [
        data.actor_id || null,
        data.action,
        data.entity_type,
        data.entity_id || null,
        data.old_values ? JSON.stringify(data.old_values) : null,
        data.new_values ? JSON.stringify(data.new_values) : null,
        data.ip_address || null,
        data.user_agent || null,
        data.status,
        data.failure_reason || null,
      ];
      await pool.query(query, values);
    } catch (error) {
      // Don't let audit logging failures break the main operation
      logger.error('Failed to write audit log:', error);
    }
  }

  static async logAuthEvent(
    userId: string | undefined,
    action: string,
    status: 'success' | 'failure',
    details?: { ip?: string; userAgent?: string; reason?: string }
  ): Promise<void> {
    await this.log({
      actor_id: userId,
      action,
      entity_type: 'auth',
      entity_id: userId,
      ip_address: details?.ip,
      user_agent: details?.userAgent,
      status,
      failure_reason: details?.reason,
    });
  }
}

export default AuditService;