import pool from '../config/database';
import { 
  IPayment, 
  ICreatePayment, 
  IUpdatePayment,
  IPaymentAuthorisation,
  ICreatePaymentAuthorisation,
  IRefund,
  ICreateRefund
} from '../types/payment.types';
import logger from '../utils/logger';

export class PaymentModel {
  // ============================================
  // PAYMENT CRUD
  // ============================================

  /**
   * Create a payment record
   */
  static async create(data: ICreatePayment): Promise<IPayment> {
    const result = await pool.query(
      `INSERT INTO payments (
        ride_id,
        passenger_id,
        driver_id,
        amount,
        currency,
        payment_method,
        status,
        payment_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        data.ride_id || null,
        data.passenger_id,
        data.driver_id || null,
        data.amount,
        data.currency || 'NGN',
        data.payment_method,
        'pending',
        data.payment_type || 'ride',
      ]
    );
    logger.info(`Payment created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  /**
   * Get payment by ID
   */
  static async getById(id: string): Promise<IPayment | null> {
    const result = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get payment by gateway reference
   */
  static async getByGatewayReference(reference: string): Promise<IPayment | null> {
    const result = await pool.query(
      'SELECT * FROM payments WHERE gateway_reference = $1',
      [reference]
    );
    return result.rows[0] || null;
  }

  /**
   * Get payment by ride ID
   */
  static async getByRideId(rideId: string): Promise<IPayment | null> {
    const result = await pool.query(
      'SELECT * FROM payments WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1',
      [rideId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get payments by passenger ID with pagination
   */
  static async getByPassengerId(
    passengerId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ payments: IPayment[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM payments 
       WHERE passenger_id = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [passengerId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM payments WHERE passenger_id = $1',
      [passengerId]
    );

    return {
      payments: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get payments by driver ID with pagination
   */
  static async getByDriverId(
    driverId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ payments: IPayment[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM payments 
       WHERE driver_id = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM payments WHERE driver_id = $1',
      [driverId]
    );

    return {
      payments: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get all payments with pagination and filters
   */
  static async getAll(
    page: number = 1,
    limit: number = 100,
    filters?: {
      status?: string;
      payment_method?: string;
      payment_type?: string;
      start_date?: Date;
      end_date?: Date;
    }
  ): Promise<{ payments: IPayment[]; total: number }> {
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

    if (filters?.payment_method) {
      conditions.push(`payment_method = $${paramCount}`);
      params.push(filters.payment_method);
      countParams.push(filters.payment_method);
      paramCount++;
    }

    if (filters?.payment_type) {
      conditions.push(`payment_type = $${paramCount}`);
      params.push(filters.payment_type);
      countParams.push(filters.payment_type);
      paramCount++;
    }

    if (filters?.start_date) {
      conditions.push(`created_at >= $${paramCount}`);
      params.push(filters.start_date);
      countParams.push(filters.start_date);
      paramCount++;
    }

    if (filters?.end_date) {
      conditions.push(`created_at <= $${paramCount}`);
      params.push(filters.end_date);
      countParams.push(filters.end_date);
      paramCount++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT * FROM payments 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    params.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) as total FROM payments 
      ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);

    return {
      payments: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Update payment
   */
  static async update(id: string, data: IUpdatePayment): Promise<IPayment | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.status !== undefined) {
      updates.push(`status = $${paramCount}`);
      values.push(data.status);
      paramCount++;
    }

    if (data.gateway_reference !== undefined) {
      updates.push(`gateway_reference = $${paramCount}`);
      values.push(data.gateway_reference);
      paramCount++;
    }

    if (data.gateway_response !== undefined) {
      updates.push(`gateway_response = $${paramCount}`);
      values.push(data.gateway_response);
      paramCount++;
    }

    if (data.authorised_at !== undefined) {
      updates.push(`authorised_at = $${paramCount}`);
      values.push(data.authorised_at);
      paramCount++;
    }

    if (data.captured_at !== undefined) {
      updates.push(`captured_at = $${paramCount}`);
      values.push(data.captured_at);
      paramCount++;
    }

    if (data.paid_at !== undefined) {
      updates.push(`paid_at = $${paramCount}`);
      values.push(data.paid_at);
      paramCount++;
    }

    if (data.commission_amount !== undefined) {
      updates.push(`commission_amount = $${paramCount}`);
      values.push(data.commission_amount);
      paramCount++;
    }

    if (data.commission_rate !== undefined) {
      updates.push(`commission_rate = $${paramCount}`);
      values.push(data.commission_rate);
      paramCount++;
    }

    if (data.driver_earnings !== undefined) {
      updates.push(`driver_earnings = $${paramCount}`);
      values.push(data.driver_earnings);
      paramCount++;
    }

    if (data.processed_at !== undefined) {
      updates.push(`processed_at = $${paramCount}`);
      values.push(data.processed_at);
      paramCount++;
    }

    if (data.settled_at !== undefined) {
      updates.push(`settled_at = $${paramCount}`);
      values.push(data.settled_at);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE payments 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update payment status
   */
  static async updateStatus(id: string, status: string): Promise<IPayment | null> {
    const result = await pool.query(
      `UPDATE payments 
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark payment as paid
   */
  static async markPaid(id: string, gatewayResponse?: any): Promise<IPayment | null> {
    const result = await pool.query(
      `UPDATE payments 
       SET status = 'paid', paid_at = NOW(), gateway_response = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [gatewayResponse || null, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark payment as failed
   */
  static async markFailed(id: string, reason?: string): Promise<IPayment | null> {
    const result = await pool.query(
      `UPDATE payments 
       SET status = 'failed', gateway_response = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ error: reason || 'Payment failed' }), id]
    );
    return result.rows[0] || null;
  }

  /**
   * Check if payment exists
   */
  static async exists(id: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT 1 FROM payments WHERE id = $1',
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get payment with details (ride, passenger, driver)
   */
  static async getWithDetails(id: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        p.*,
        pp.first_name as passenger_first_name,
        pp.last_name as passenger_last_name,
        u.phone_number as passenger_phone,
        dp.first_name as driver_first_name,
        dp.last_name as driver_last_name,
        r.status as ride_status,
        r.pickup_address,
        r.destination_address
       FROM payments p
       JOIN passenger_profiles pp ON p.passenger_id = pp.id
       JOIN users u ON pp.user_id = u.id
       LEFT JOIN driver_profiles dp ON p.driver_id = dp.id
       LEFT JOIN rides r ON p.ride_id = r.id
       WHERE p.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  // ============================================
  // PAYMENT AUTHORISATIONS
  // ============================================

  /**
   * Create payment authorisation
   */
  static async createAuthorisation(data: ICreatePaymentAuthorisation): Promise<IPaymentAuthorisation> {
    const result = await pool.query(
      `INSERT INTO payment_authorisations (
        ride_id,
        passenger_id,
        amount,
        payment_method,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        data.ride_id,
        data.passenger_id,
        data.amount,
        data.payment_method,
        data.expires_at,
      ]
    );
    logger.info(`Payment authorisation created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  /**
   * Get authorisation by ID
   */
  static async getAuthorisationById(id: string): Promise<IPaymentAuthorisation | null> {
    const result = await pool.query(
      'SELECT * FROM payment_authorisations WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get authorisation by ride ID
   */
  static async getAuthorisationByRideId(rideId: string): Promise<IPaymentAuthorisation | null> {
    const result = await pool.query(
      'SELECT * FROM payment_authorisations WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1',
      [rideId]
    );
    return result.rows[0] || null;
  }

  /**
   * Update authorisation status
   */
  static async updateAuthorisationStatus(
    id: string,
    status: 'pending' | 'authorised' | 'captured' | 'failed' | 'expired',
    gatewayReference?: string
  ): Promise<IPaymentAuthorisation | null> {
    const updates = [`status = $1`, `updated_at = NOW()`];
    const params: any[] = [status];

    if (gatewayReference) {
      updates.push(`gateway_reference = $${params.length + 1}`);
      params.push(gatewayReference);
    }

    if (status === 'authorised') {
      updates.push(`authorised_at = NOW()`);
    }

    params.push(id);

    const result = await pool.query(
      `UPDATE payment_authorisations 
       SET ${updates.join(', ')} 
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }

  /**
   * Mark authorisation as expired
   */
  static async expireAuthorisation(id: string): Promise<IPaymentAuthorisation | null> {
    const result = await pool.query(
      `UPDATE payment_authorisations 
       SET status = 'expired', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Check if authorisation is valid
   */
  static async isAuthorisationValid(id: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1 FROM payment_authorisations 
       WHERE id = $1 
         AND status = 'authorised'
         AND expires_at > NOW()
       LIMIT 1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // REFUNDS
  // ============================================

  /**
   * Create refund
   */
  static async createRefund(data: ICreateRefund): Promise<IRefund> {
    const result = await pool.query(
      `INSERT INTO refunds (
        transaction_id,
        ride_id,
        passenger_id,
        refund_amount,
        reason,
        initiated_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        data.transaction_id,
        data.ride_id,
        data.passenger_id,
        data.refund_amount,
        data.reason,
        data.initiated_by,
      ]
    );
    logger.info(`Refund created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  /**
   * Get refund by ID
   */
  static async getRefundById(id: string): Promise<IRefund | null> {
    const result = await pool.query(
      'SELECT * FROM refunds WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get refunds by payment ID
   */
  static async getRefundsByPaymentId(paymentId: string): Promise<IRefund[]> {
    const result = await pool.query(
      'SELECT * FROM refunds WHERE transaction_id = $1 ORDER BY created_at DESC',
      [paymentId]
    );
    return result.rows;
  }

  /**
   * Get refunds by passenger ID
   */
  static async getRefundsByPassengerId(
    passengerId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ refunds: IRefund[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM refunds 
       WHERE passenger_id = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [passengerId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM refunds WHERE passenger_id = $1',
      [passengerId]
    );

    return {
      refunds: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Update refund status
   */
  static async updateRefundStatus(
    id: string,
    status: 'pending' | 'processed' | 'failed',
    gatewayReference?: string
  ): Promise<IRefund | null> {
    const updates = [`status = $1`, `updated_at = NOW()`];
    const params: any[] = [status];

    if (status === 'processed') {
      updates.push(`processed_at = NOW()`);
    }

    if (gatewayReference) {
      updates.push(`gateway_reference = $${params.length + 1}`);
      params.push(gatewayReference);
    }

    params.push(id);

    const result = await pool.query(
      `UPDATE refunds 
       SET ${updates.join(', ')} 
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }

  // ============================================
  // AGGREGATE FUNCTIONS
  // ============================================

  /**
   * Get total revenue
   */
  static async getTotalRevenue(startDate?: Date, endDate?: Date): Promise<number> {
    let query = `SELECT COALESCE(SUM(amount), 0) as total 
                 FROM payments WHERE status = 'paid'`;
    const params: any[] = [];

    if (startDate && endDate) {
      query += ` AND created_at BETWEEN $1 AND $2`;
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ` AND created_at >= $1`;
      params.push(startDate);
    } else if (endDate) {
      query += ` AND created_at <= $1`;
      params.push(endDate);
    }

    const result = await pool.query(query, params);
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get total commission
   */
  static async getTotalCommission(startDate?: Date, endDate?: Date): Promise<number> {
    let query = `SELECT COALESCE(SUM(commission_amount), 0) as total 
                 FROM payments WHERE status = 'paid'`;
    const params: any[] = [];

    if (startDate && endDate) {
      query += ` AND created_at BETWEEN $1 AND $2`;
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ` AND created_at >= $1`;
      params.push(startDate);
    } else if (endDate) {
      query += ` AND created_at <= $1`;
      params.push(endDate);
    }

    const result = await pool.query(query, params);
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get payment count by status
   */
  static async getCountByStatus(): Promise<Record<string, number>> {
    const result = await pool.query(
      'SELECT status, COUNT(*) as count FROM payments GROUP BY status'
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }
    return counts;
  }

  /**
   * Get total refunded amount
   */
  static async getTotalRefunded(startDate?: Date, endDate?: Date): Promise<number> {
    let query = `SELECT COALESCE(SUM(refund_amount), 0) as total 
                 FROM refunds WHERE status = 'processed'`;
    const params: any[] = [];

    if (startDate && endDate) {
      query += ` AND created_at BETWEEN $1 AND $2`;
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ` AND created_at >= $1`;
      params.push(startDate);
    } else if (endDate) {
      query += ` AND created_at <= $1`;
      params.push(endDate);
    }

    const result = await pool.query(query, params);
    return parseFloat(result.rows[0]?.total || '0');
  }
}

export default PaymentModel;