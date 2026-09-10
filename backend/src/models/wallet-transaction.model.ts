import pool from '../config/database';
import { IWalletTransaction, ICreateWalletTransaction } from '../types/payment.types';
import logger from '../utils/logger';

export class WalletTransactionModel {
  // ============================================
  // CREATE TRANSACTION
  // ============================================

  /**
   * Create a wallet transaction
   */
  static async create(data: ICreateWalletTransaction): Promise<IWalletTransaction> {
    const result = await pool.query(
      `INSERT INTO wallet_transactions (
        wallet_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reference_type,
        reference_id,
        description,
        status,
        metadata,
        completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        data.wallet_id,
        data.transaction_type,
        data.amount,
        data.balance_before,
        data.balance_after,
        data.reference_type || null,
        data.reference_id || null,
        data.description,
        'completed',
        data.metadata || null,
      ]
    );
    logger.info(`Wallet transaction created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  /**
   * Create a pending transaction
   */
  static async createPending(data: ICreateWalletTransaction): Promise<IWalletTransaction> {
    const result = await pool.query(
      `INSERT INTO wallet_transactions (
        wallet_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reference_type,
        reference_id,
        description,
        status,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
      RETURNING *`,
      [
        data.wallet_id,
        data.transaction_type,
        data.amount,
        data.balance_before,
        data.balance_after,
        data.reference_type || null,
        data.reference_id || null,
        data.description,
        data.metadata || null,
      ]
    );
    logger.info(`Pending wallet transaction created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  // ============================================
  // GET TRANSACTIONS
  // ============================================

  /**
   * Get transaction by ID
   */
  static async getById(id: string): Promise<IWalletTransaction | null> {
    const result = await pool.query(
      'SELECT * FROM wallet_transactions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Get transactions by wallet ID with pagination
   */
  static async getByWalletId(
    walletId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IWalletTransaction[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM wallet_transactions 
       WHERE wallet_id = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [walletId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM wallet_transactions WHERE wallet_id = $1',
      [walletId]
    );

    return {
      transactions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get transactions by user ID with pagination
   */
  static async getByUserId(
    userId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IWalletTransaction[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT wt.* 
       FROM wallet_transactions wt
       JOIN wallets w ON wt.wallet_id = w.id
       WHERE w.user_id = $1 
       ORDER BY wt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total 
       FROM wallet_transactions wt
       JOIN wallets w ON wt.wallet_id = w.id
       WHERE w.user_id = $1`,
      [userId]
    );

    return {
      transactions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get transactions by status
   */
  static async getByStatus(
    status: 'pending' | 'completed' | 'failed' | 'reversed',
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IWalletTransaction[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM wallet_transactions 
       WHERE status = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM wallet_transactions WHERE status = $1',
      [status]
    );

    return {
      transactions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get transactions by type
   */
  static async getByType(
    transactionType: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IWalletTransaction[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM wallet_transactions 
       WHERE transaction_type = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [transactionType, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM wallet_transactions WHERE transaction_type = $1',
      [transactionType]
    );

    return {
      transactions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get transactions by reference
   */
  static async getByReference(
    referenceType: string,
    referenceId: string
  ): Promise<IWalletTransaction[]> {
    const result = await pool.query(
      `SELECT * FROM wallet_transactions 
       WHERE reference_type = $1 AND reference_id = $2
       ORDER BY created_at DESC`,
      [referenceType, referenceId]
    );
    return result.rows;
  }

  /**
   * Get transactions by date range
   */
  static async getByDateRange(
    startDate: Date,
    endDate: Date,
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IWalletTransaction[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM wallet_transactions 
       WHERE created_at BETWEEN $1 AND $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [startDate, endDate, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM wallet_transactions WHERE created_at BETWEEN $1 AND $2',
      [startDate, endDate]
    );

    return {
      transactions: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  // ============================================
  // UPDATE TRANSACTIONS
  // ============================================

  /**
   * Update transaction status
   */
  static async updateStatus(
    id: string,
    status: 'pending' | 'completed' | 'failed' | 'reversed'
  ): Promise<IWalletTransaction | null> {
    const updates = [`status = $1`, `updated_at = NOW()`];
    const params: any[] = [status];

    if (status === 'completed') {
      updates.push(`completed_at = NOW()`);
    } else if (status === 'reversed') {
      updates.push(`reversed_at = NOW()`);
    }

    params.push(id);

    const result = await pool.query(
      `UPDATE wallet_transactions 
       SET ${updates.join(', ')} 
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }

  /**
   * Mark transaction as failed
   */
  static async markFailed(id: string, reason?: string): Promise<IWalletTransaction | null> {
    const result = await pool.query(
      `UPDATE wallet_transactions 
       SET status = 'failed',
           metadata = COALESCE(metadata, '{}')::jsonb || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ error: reason || 'Transaction failed' }), id]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark transaction as reversed
   */
  static async markReversed(id: string, reason?: string): Promise<IWalletTransaction | null> {
    const result = await pool.query(
      `UPDATE wallet_transactions 
       SET status = 'reversed',
           reversed_at = NOW(),
           metadata = COALESCE(metadata, '{}')::jsonb || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ reversalReason: reason || 'Transaction reversed' }), id]
    );
    return result.rows[0] || null;
  }

  /**
   * Update transaction metadata
   */
  static async updateMetadata(id: string, metadata: any): Promise<IWalletTransaction | null> {
    const result = await pool.query(
      `UPDATE wallet_transactions 
       SET metadata = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [metadata, id]
    );
    return result.rows[0] || null;
  }

  // ============================================
  // DELETE TRANSACTIONS
  // ============================================

  /**
   * Delete transaction (for cleanup/testing)
   */
  static async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM wallet_transactions WHERE id = $1', [id]);
    logger.warn(`Wallet transaction deleted: ${id}`);
  }

  /**
   * Delete all transactions for a wallet
   */
  static async deleteByWalletId(walletId: string): Promise<number> {
    const result = await pool.query(
      'DELETE FROM wallet_transactions WHERE wallet_id = $1 RETURNING id',
      [walletId]
    );
    logger.warn(`Deleted ${result.rowCount} transactions for wallet ${walletId}`);
    return result.rowCount || 0;
  }

  // ============================================
  // AGGREGATE FUNCTIONS
  // ============================================

  /**
   * Get total credits for a wallet
   */
  static async getTotalCredits(walletId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total 
       FROM wallet_transactions 
       WHERE wallet_id = $1 
         AND transaction_type IN ('top_up', 'refund', 'bonus')
         AND status = 'completed'`,
      [walletId]
    );
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get total debits for a wallet
   */
  static async getTotalDebits(walletId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total 
       FROM wallet_transactions 
       WHERE wallet_id = $1 
         AND transaction_type IN ('payment', 'withdrawal', 'commission')
         AND status = 'completed'`,
      [walletId]
    );
    return parseFloat(result.rows[0]?.total || '0');
  }

  /**
   * Get transaction count by type for a wallet
   */
  static async getTransactionCountByType(walletId: string): Promise<Record<string, number>> {
    const result = await pool.query(
      `SELECT transaction_type, COUNT(*) as count
       FROM wallet_transactions
       WHERE wallet_id = $1
       GROUP BY transaction_type`,
      [walletId]
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.transaction_type] = parseInt(row.count, 10);
    }
    return counts;
  }

  /**
   * Get latest transaction for a wallet
   */
  static async getLatestTransaction(walletId: string): Promise<IWalletTransaction | null> {
    const result = await pool.query(
      `SELECT * FROM wallet_transactions 
       WHERE wallet_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [walletId]
    );
    return result.rows[0] || null;
  }
}

export default WalletTransactionModel;