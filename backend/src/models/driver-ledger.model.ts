// ============================================
// DRIVER-LEDGER.MODEL.TS - MODIFIED
// ============================================

import pool from '../config/database';
import {
  IDriverLedger,
  IDriverLedgerTransaction
} from '../types/payment.types';
import logger from '../utils/logger';

export class DriverLedgerModel {
  // ============================================
  // DRIVER LEDGER CRUD (READ-ONLY)
  // ============================================

  /**
   * Get ledger by driver ID (READ-ONLY)
   */
  static async getByDriverId(driverId: string): Promise<IDriverLedger | null> {
    const result = await pool.query(
      'SELECT * FROM driver_ledger WHERE driver_id = $1',
      [driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get ledger by ID (READ-ONLY)
   */
  static async getById(id: string): Promise<IDriverLedger | null> {
    const result = await pool.query(
      'SELECT * FROM driver_ledger WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all ledgers with pagination (READ-ONLY)
   */
  static async getAll(
    page: number = 1,
    limit: number = 100,
    status?: string
  ): Promise<{ ledgers: IDriverLedger[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM driver_ledger';
    const params: any[] = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    let countQuery = 'SELECT COUNT(*) as total FROM driver_ledger';
    if (status) {
      countQuery += ' WHERE status = $1';
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, status ? [status] : [])
    ]);

    return {
      ledgers: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Check if ledger exists for driver (READ-ONLY)
   */
  static async exists(driverId: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT 1 FROM driver_ledger WHERE driver_id = $1',
      [driverId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // LEDGER BALANCE OPERATIONS (READ-ONLY)
  // ============================================

  /**
   * Get withdrawable balance (READ-ONLY)
   */
  static async getWithdrawableBalance(driverId: string): Promise<number> {
    const result = await pool.query(
      'SELECT withdrawable_balance FROM driver_ledger WHERE driver_id = $1',
      [driverId]
    );
    return parseFloat(result.rows[0]?.withdrawable_balance || '0');
  }

  /**
   * Get net balance (READ-ONLY)
   */
  static async getNetBalance(driverId: string): Promise<number> {
    const result = await pool.query(
      'SELECT net_balance FROM driver_ledger WHERE driver_id = $1',
      [driverId]
    );
    return parseFloat(result.rows[0]?.net_balance || '0');
  }

  /**
   * Check if driver has sufficient withdrawable balance (READ-ONLY)
   */
  static async hasSufficientBalance(driverId: string, amount: number): Promise<boolean> {
    const balance = await this.getWithdrawableBalance(driverId);
    return balance >= amount;
  }

  // ============================================
  // LEDGER TRANSACTIONS (READ-ONLY)
  // ============================================

  /**
   * Get transactions by ledger ID (READ-ONLY)
   */
  static async getTransactionsByLedgerId(
    ledgerId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IDriverLedgerTransaction[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM driver_ledger_transactions 
       WHERE driver_ledger_id = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [ledgerId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM driver_ledger_transactions WHERE driver_ledger_id = $1',
      [ledgerId]
    );

    return {
      transactions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get transactions by driver ID (READ-ONLY)
   */
  static async getTransactionsByDriverId(
    driverId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IDriverLedgerTransaction[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT dlt.* 
       FROM driver_ledger_transactions dlt
       JOIN driver_ledger dl ON dlt.driver_ledger_id = dl.id
       WHERE dl.driver_id = $1 
       ORDER BY dlt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total 
       FROM driver_ledger_transactions dlt
       JOIN driver_ledger dl ON dlt.driver_ledger_id = dl.id
       WHERE dl.driver_id = $1`,
      [driverId]
    );

    return {
      transactions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get transaction by ID (READ-ONLY)
   */
  static async getTransactionById(id: string): Promise<IDriverLedgerTransaction | null> {
    const result = await pool.query(
      'SELECT * FROM driver_ledger_transactions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get transactions by reference (READ-ONLY)
   */
  static async getTransactionsByReference(
    referenceType: string,
    referenceId: string
  ): Promise<IDriverLedgerTransaction[]> {
    const result = await pool.query(
      `SELECT * FROM driver_ledger_transactions 
       WHERE reference_type = $1 AND reference_id = $2
       ORDER BY created_at DESC`,
      [referenceType, referenceId]
    );
    return result.rows;
  }

  /**
   * Get latest transaction for a driver (READ-ONLY)
   */
  static async getLatestTransaction(driverId: string): Promise<IDriverLedgerTransaction | null> {
    const result = await pool.query(
      `SELECT dlt.* 
       FROM driver_ledger_transactions dlt
       JOIN driver_ledger dl ON dlt.driver_ledger_id = dl.id
       WHERE dl.driver_id = $1
       ORDER BY dlt.created_at DESC 
       LIMIT 1`,
      [driverId]
    );
    return result.rows[0] || null;
  }

  // ============================================
  // AGGREGATE FUNCTIONS (READ-ONLY)
  // ============================================

  /**
   * Get total earnings for a driver (READ-ONLY)
   */
  static async getTotalEarnings(driverId: string): Promise<{
    digital: number;
    bonus: number;
    adjustment: number;
    total: number;
  }> {
    const result = await pool.query(
      `SELECT 
        digital_earnings,
        bonus_earnings,
        adjustment_earnings,
        (digital_earnings + bonus_earnings + adjustment_earnings) as total
       FROM driver_ledger 
       WHERE driver_id = $1`,
      [driverId]
    );

    const row = result.rows[0];
    return {
      digital: parseFloat(row?.digital_earnings || '0'),
      bonus: parseFloat(row?.bonus_earnings || '0'),
      adjustment: parseFloat(row?.adjustment_earnings || '0'),
      total: parseFloat(row?.total || '0'),
    };
  }

  /**
   * Get total commission deducted (READ-ONLY)
   */
  static async getTotalCommissionDeducted(driverId: string): Promise<number> {
    const result = await pool.query(
      'SELECT total_commission_deducted FROM driver_ledger WHERE driver_id = $1',
      [driverId]
    );
    return parseFloat(result.rows[0]?.total_commission_deducted || '0');
  }

  /**
   * Get total withdrawals (READ-ONLY)
   */
  static async getTotalWithdrawals(driverId: string): Promise<number> {
    const result = await pool.query(
      'SELECT total_withdrawals FROM driver_ledger WHERE driver_id = $1',
      [driverId]
    );
    return parseFloat(result.rows[0]?.total_withdrawals || '0');
  }

  /**
   * Get ledger summary for a driver (READ-ONLY)
   */
  static async getDriverLedgerSummary(driverId: string): Promise<{
    digitalEarnings: number;
    cashCommissionDebt: number;
    bonusEarnings: number;
    adjustmentEarnings: number;
    totalCommissionDeducted: number;
    totalWithdrawals: number;
    totalRefunds: number;
    netBalance: number;
    withdrawableBalance: number;
  }> {
    const result = await pool.query(
      `SELECT 
        digital_earnings,
        cash_commission_debt,
        bonus_earnings,
        adjustment_earnings,
        total_commission_deducted,
        total_withdrawals,
        total_refunds,
        net_balance,
        withdrawable_balance
       FROM driver_ledger 
       WHERE driver_id = $1`,
      [driverId]
    );

    const row = result.rows[0];
    return {
      digitalEarnings: parseFloat(row?.digital_earnings || '0'),
      cashCommissionDebt: parseFloat(row?.cash_commission_debt || '0'),
      bonusEarnings: parseFloat(row?.bonus_earnings || '0'),
      adjustmentEarnings: parseFloat(row?.adjustment_earnings || '0'),
      totalCommissionDeducted: parseFloat(row?.total_commission_deducted || '0'),
      totalWithdrawals: parseFloat(row?.total_withdrawals || '0'),
      totalRefunds: parseFloat(row?.total_refunds || '0'),
      netBalance: parseFloat(row?.net_balance || '0'),
      withdrawableBalance: parseFloat(row?.withdrawable_balance || '0'),
    };
  }

  /**
   * Get ledger with driver details (READ-ONLY)
   */
  static async getWithDriverDetails(driverId: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        dl.*,
        d.first_name as driver_first_name,
        d.last_name as driver_last_name,
        u.phone_number as driver_phone,
        d.total_rides,
        d.total_earnings as driver_total_earnings
       FROM driver_ledger dl
       JOIN driver_profiles d ON dl.driver_id = d.id
       JOIN users u ON d.user_id = u.id
       WHERE dl.driver_id = $1`,
      [driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all ledgers with driver details (READ-ONLY)
   */
  static async getAllWithDriverDetails(
    page: number = 1,
    limit: number = 100
  ): Promise<{ ledgers: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT 
        dl.*,
        d.first_name as driver_first_name,
        d.last_name as driver_last_name,
        u.phone_number as driver_phone
       FROM driver_ledger dl
       JOIN driver_profiles d ON dl.driver_id = d.id
       JOIN users u ON d.user_id = u.id
       ORDER BY dl.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query('SELECT COUNT(*) as total FROM driver_ledger');

    return {
      ledgers: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  // ============================================
  // INFORMATIONAL RECORDING (V2.0)
  // ============================================
  //
  // The driver ledger is now informational only.
  // Paystack splits each ride payment directly to the driver's
  // subaccount — real money never flows through this ledger.
  //
  // These methods write transaction rows so the driver's app can
  // display earnings history, but they do NOT change
  // driver_ledger.net_balance or driver_ledger.withdrawable_balance.
  //
  // balance_before = balance_after = current net_balance (unchanged).

  /**
   * Record an earning row (informational only, no balance change)
   * Called after a split payment succeeds via Paystack.
   */
  static async recordEarningInformational(
    driverId: string,
    amount: number,
    reference: string,
    description?: string,
    metadata?: any
  ): Promise<IDriverLedgerTransaction | null> {
    const ledger = await this.getByDriverId(driverId);
    if (!ledger) {
      logger.warn(
        `recordEarningInformational: no ledger found for driver ${driverId}`
      );
      return null;
    }

    const currentBalance = parseFloat(String(ledger.net_balance)) || 0;

    const result = await pool.query(
      `INSERT INTO driver_ledger_transactions (
        driver_ledger_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reference_type,
        reference_id,
        description,
        metadata,
        status,
        completed_at
      ) VALUES ($1, 'earning', $2, $3, $4, 'payment', $5, $6, $7, 'completed', NOW())
      RETURNING *`,
      [
        ledger.id,
        amount,
        currentBalance,
        currentBalance,
        reference,
        description || `Ride earning (informational) — ref ${reference}`,
        metadata || null,
      ]
    );

    logger.debug(
      `Informational earning recorded for driver ${driverId}: ${amount} (ref ${reference})`
    );
    return result.rows[0] || null;
  }

  /**
   * Record a commission row (informational only, no balance change)
   * Called alongside recordEarningInformational when a split
   * payment succeeds, so the driver's app can show gross / net.
   */
  static async recordCommissionInformational(
    driverId: string,
    amount: number,
    reference: string,
    description?: string,
    metadata?: any
  ): Promise<IDriverLedgerTransaction | null> {
    const ledger = await this.getByDriverId(driverId);
    if (!ledger) {
      logger.warn(
        `recordCommissionInformational: no ledger found for driver ${driverId}`
      );
      return null;
    }

    const currentBalance = parseFloat(String(ledger.net_balance)) || 0;

    const result = await pool.query(
      `INSERT INTO driver_ledger_transactions (
        driver_ledger_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reference_type,
        reference_id,
        description,
        metadata,
        status,
        completed_at
      ) VALUES ($1, 'commission', $2, $3, $4, 'payment', $5, $6, $7, 'completed', NOW())
      RETURNING *`,
      [
        ledger.id,
        amount,
        currentBalance,
        currentBalance,
        reference,
        description || `Ride commission (informational) — ref ${reference}`,
        metadata || null,
      ]
    );

    logger.debug(
      `Informational commission recorded for driver ${driverId}: ${amount} (ref ${reference})`
    );
    return result.rows[0] || null;
  }

  // ============================================
  // DEPRECATED WRITE METHODS (Kept for rollback)
  // ============================================

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async create(driverId: string): Promise<IDriverLedger> {
    console.warn('⚠️ DriverLedgerModel.create() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `INSERT INTO driver_ledger (
        driver_id
      ) VALUES ($1)
      RETURNING *`,
      [driverId]
    );
    logger.info(`Driver ledger created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async createIfNotExists(driverId: string): Promise<IDriverLedger> {
    console.warn('⚠️ DriverLedgerModel.createIfNotExists() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const existing = await this.getByDriverId(driverId);
    if (existing) {
      return existing;
    }
    return this.create(driverId);
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async updateStatus(
    id: string,
    status: 'active' | 'suspended' | 'closed'
  ): Promise<IDriverLedger | null> {
    console.warn('⚠️ DriverLedgerModel.updateStatus() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `UPDATE driver_ledger 
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );
    return result.rows[0] || null;
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async addDigitalEarnings(
    driverId: string,
    amount: number
  ): Promise<IDriverLedger | null> {
    console.warn('⚠️ DriverLedgerModel.addDigitalEarnings() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `UPDATE driver_ledger 
       SET digital_earnings = digital_earnings + $1,
           net_balance = net_balance + $1,
           withdrawable_balance = withdrawable_balance + $1,
           updated_at = NOW()
       WHERE driver_id = $2
       RETURNING *`,
      [amount, driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async addBonus(
    driverId: string,
    amount: number
  ): Promise<IDriverLedger | null> {
    console.warn('⚠️ DriverLedgerModel.addBonus() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `UPDATE driver_ledger 
       SET bonus_earnings = bonus_earnings + $1,
           net_balance = net_balance + $1,
           withdrawable_balance = withdrawable_balance + $1,
           updated_at = NOW()
       WHERE driver_id = $2
       RETURNING *`,
      [amount, driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async addAdjustment(
    driverId: string,
    amount: number
  ): Promise<IDriverLedger | null> {
    console.warn('⚠️ DriverLedgerModel.addAdjustment() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `UPDATE driver_ledger 
       SET adjustment_earnings = adjustment_earnings + $1,
           net_balance = net_balance + $1,
           withdrawable_balance = withdrawable_balance + $1,
           updated_at = NOW()
       WHERE driver_id = $2
       RETURNING *`,
      [amount, driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async deductCommission(
    driverId: string,
    amount: number
  ): Promise<IDriverLedger | null> {
    console.warn('⚠️ DriverLedgerModel.deductCommission() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `UPDATE driver_ledger 
       SET total_commission_deducted = total_commission_deducted + $1,
           net_balance = net_balance - $1,
           withdrawable_balance = withdrawable_balance - $1,
           updated_at = NOW()
       WHERE driver_id = $2
       RETURNING *`,
      [amount, driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async addCashCommissionDebt(
    driverId: string,
    amount: number
  ): Promise<IDriverLedger | null> {
    console.warn('⚠️ DriverLedgerModel.addCashCommissionDebt() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `UPDATE driver_ledger 
       SET cash_commission_debt = cash_commission_debt + $1,
           net_balance = net_balance - $1,
           updated_at = NOW()
       WHERE driver_id = $2
       RETURNING *`,
      [amount, driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async deductWithdrawal(
    driverId: string,
    amount: number
  ): Promise<IDriverLedger | null> {
    console.warn('⚠️ DriverLedgerModel.deductWithdrawal() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `UPDATE driver_ledger 
       SET total_withdrawals = total_withdrawals + $1,
           withdrawable_balance = withdrawable_balance - $1,
           updated_at = NOW()
       WHERE driver_id = $2
       RETURNING *`,
      [amount, driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async addRefund(
    driverId: string,
    amount: number
  ): Promise<IDriverLedger | null> {
    console.warn('⚠️ DriverLedgerModel.addRefund() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `UPDATE driver_ledger 
       SET total_refunds = total_refunds + $1,
           net_balance = net_balance - $1,
           withdrawable_balance = withdrawable_balance - $1,
           updated_at = NOW()
       WHERE driver_id = $2
       RETURNING *`,
      [amount, driverId]
    );
    return result.rows[0] || null;
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async createTransaction(data: {
    driver_ledger_id: string;
    transaction_type: string;
    amount: number;
    balance_before: number;
    balance_after: number;
    reference_type?: string;
    reference_id?: string;
    description: string;
    metadata?: any;
    status?: string;
  }): Promise<IDriverLedgerTransaction> {
    console.warn('⚠️ DriverLedgerModel.createTransaction() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const result = await pool.query(
      `INSERT INTO driver_ledger_transactions (
        driver_ledger_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reference_type,
        reference_id,
        description,
        metadata,
        status,
        completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        data.driver_ledger_id,
        data.transaction_type,
        data.amount,
        data.balance_before,
        data.balance_after,
        data.reference_type || null,
        data.reference_id || null,
        data.description,
        data.metadata || null,
        data.status || 'completed',
      ]
    );
    logger.info(`Driver ledger transaction created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * This method is kept for historical data and potential rollback.
   * DO NOT USE for new operations.
   */
  static async updateTransactionStatus(
    id: string,
    status: 'pending' | 'completed' | 'failed' | 'reversed'
  ): Promise<IDriverLedgerTransaction | null> {
    console.warn('⚠️ DriverLedgerModel.updateTransactionStatus() is DEPRECATED. Payments are automatic via Paystack subaccount.');

    const updates = [`status = $1`, `updated_at = NOW()`];
    const params: any[] = [status];

    if (status === 'completed') {
      updates.push(`completed_at = NOW()`);
    }

    params.push(id);

    const result = await pool.query(
      `UPDATE driver_ledger_transactions 
       SET ${updates.join(', ')} 
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }
}

export default DriverLedgerModel;