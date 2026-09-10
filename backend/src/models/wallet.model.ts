import pool from '../config/database';
import { IWallet, ICreateWallet, IUpdateWallet, IWalletTransaction, ICreateWalletTransaction } from '../types/payment.types';
import logger from '../utils/logger';

export class WalletModel {
  // ============================================
  // WALLET CRUD
  // ============================================

  /**
   * Get wallet by user ID
   */
  static async getByUserId(userId: string): Promise<IWallet | null> {
    const result = await pool.query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get wallet by ID
   */
  static async getById(id: string): Promise<IWallet | null> {
    const result = await pool.query(
      'SELECT * FROM wallets WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Create wallet
   */
  static async create(data: ICreateWallet): Promise<IWallet> {
    const result = await pool.query(
      `INSERT INTO wallets (
        user_id,
        currency
      ) VALUES ($1, $2)
      RETURNING *`,
      [data.user_id, data.currency || 'NGN']
    );
    logger.info(`Wallet created for user: ${data.user_id}`);
    return result.rows[0];
  }

  /**
   * Update wallet
   */
  static async update(id: string, data: IUpdateWallet): Promise<IWallet | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.balance !== undefined) {
      updates.push(`balance = $${paramCount}`);
      values.push(data.balance);
      paramCount++;
    }

    if (data.status !== undefined) {
      updates.push(`status = $${paramCount}`);
      values.push(data.status);
      paramCount++;
    }

    if (data.frozen_at !== undefined) {
      updates.push(`frozen_at = $${paramCount}`);
      values.push(data.frozen_at);
      paramCount++;
    }

    if (data.frozen_reason !== undefined) {
      updates.push(`frozen_reason = $${paramCount}`);
      values.push(data.frozen_reason);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE wallets 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update wallet balance (with transaction)
   */
  static async updateBalance(id: string, newBalance: number): Promise<IWallet | null> {
    const result = await pool.query(
      `UPDATE wallets 
       SET balance = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newBalance, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Freeze wallet
   */
  static async freeze(id: string, reason: string): Promise<IWallet | null> {
    const result = await pool.query(
      `UPDATE wallets 
       SET status = 'frozen', frozen_at = NOW(), frozen_reason = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason, id]
    );
    return result.rows[0] || null;
  }

  /**
   * Unfreeze wallet
   */
  static async unfreeze(id: string): Promise<IWallet | null> {
    const result = await pool.query(
      `UPDATE wallets 
       SET status = 'active', frozen_at = NULL, frozen_reason = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Check if wallet exists for user
   */
  static async exists(userId: string): Promise<boolean> {
    const result = await pool.query(
      'SELECT 1 FROM wallets WHERE user_id = $1',
      [userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ============================================
  // WALLET TRANSACTIONS
  // ============================================

  /**
   * Create wallet transaction
   */
  static async createTransaction(data: ICreateWalletTransaction): Promise<IWalletTransaction> {
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        data.wallet_id,
        data.transaction_type,
        data.amount,
        data.balance_before,
        data.balance_after,
        data.reference_type || 'topup',
        data.reference_id || null,
        data.description,
        'completed',
        data.metadata || null,
      ]
    );
    return result.rows[0];
  }

  /**
   * Get transactions by wallet ID
   */
  static async getTransactionsByWalletId(
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
   * Get transactions by user ID
   */
  static async getTransactionsByUserId(
    userId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IWalletTransaction[]; total: number }> {
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT wt.* FROM wallet_transactions wt
       JOIN wallets w ON wt.wallet_id = w.id
       WHERE w.user_id = $1 
       ORDER BY wt.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM wallet_transactions wt
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
   * Get transaction by ID
   */
  static async getTransactionById(id: string): Promise<IWalletTransaction | null> {
    const result = await pool.query(
      'SELECT * FROM wallet_transactions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Update transaction status
   */
  static async updateTransactionStatus(
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
   * Get transactions by reference
   */
  static async getTransactionsByReference(
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
   * Get total transactions count for user
   */
  static async getTransactionCount(userId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM wallet_transactions wt
       JOIN wallets w ON wt.wallet_id = w.id
       WHERE w.user_id = $1`,
      [userId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Get wallet with user info
   */
  static async getWalletWithUser(walletId: string): Promise<any> {
    const result = await pool.query(
      `SELECT 
        w.*,
        u.phone_number,
        u.email,
        u.role
       FROM wallets w
       JOIN users u ON w.user_id = u.id
       WHERE w.id = $1`,
      [walletId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get all wallets with pagination
   */
  static async getAllWallets(
    page: number = 1,
    limit: number = 100,
    status?: string
  ): Promise<{ wallets: IWallet[]; total: number }> {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM wallets';
    const params: any[] = [];
    const countParams: any[] = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
      countParams.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    let countQuery = 'SELECT COUNT(*) as total FROM wallets';
    if (status) {
      countQuery += ' WHERE status = $1';
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams)
    ]);

    return {
      wallets: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Credit wallet (add funds)
   */
  static async credit(
    walletId: string,
    amount: number,
    description: string,
    referenceType?: string,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const walletResult = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [walletId]
      );

      if (walletResult.rows.length === 0) {
        throw new Error('Wallet not found');
      }

      const wallet = walletResult.rows[0];
      const newBalance = parseFloat(wallet.balance) + amount;

      const updatedWalletResult = await client.query(
        'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [newBalance, walletId]
      );

      const transactionResult = await client.query(
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
          walletId,
          'top_up',
          amount,
          wallet.balance,
          newBalance,
          referenceType || 'topup',
          referenceId || null,
          description,
          'completed',
          metadata || null,
        ]
      );

      await client.query('COMMIT');

      logger.info(`Wallet credited: ${walletId}, amount: ${amount}`);
      return {
        wallet: updatedWalletResult.rows[0],
        transaction: transactionResult.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Debit wallet (deduct funds)
   */
  static async debit(
    walletId: string,
    amount: number,
    description: string,
    referenceType?: string,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const walletResult = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [walletId]
      );

      if (walletResult.rows.length === 0) {
        throw new Error('Wallet not found');
      }

      const wallet = walletResult.rows[0];
      const currentBalance = parseFloat(wallet.balance);

      if (currentBalance < amount) {
        throw new Error('Insufficient wallet balance');
      }

      const newBalance = currentBalance - amount;

      const updatedWalletResult = await client.query(
        'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [newBalance, walletId]
      );

      const transactionResult = await client.query(
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
          walletId,
          'payment',
          amount,
          currentBalance,
          newBalance,
          referenceType || 'ride',
          referenceId || null,
          description,
          'completed',
          metadata || null,
        ]
      );

      await client.query('COMMIT');

      logger.info(`Wallet debited: ${walletId}, amount: ${amount}`);
      return {
        wallet: updatedWalletResult.rows[0],
        transaction: transactionResult.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================
  // NEW: SPLIT BALANCE METHODS (V2.0)
  // ============================================

  /**
   * Credit deposited funds (customer-funded)
   */
  static async creditDeposited(
    walletId: string,
    amount: number,
    description: string,
    referenceType?: string,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const walletResult = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [walletId]
      );

      if (walletResult.rows.length === 0) {
        throw new Error('Wallet not found');
      }

      const wallet = walletResult.rows[0];
      const currentDeposited = parseFloat(wallet.deposited_balance) || 0;
      const newDeposited = currentDeposited + amount;

      const updatedWallet = await client.query(
        `UPDATE wallets 
         SET deposited_balance = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING *`,
        [newDeposited, walletId]
      );

      const transaction = await client.query(
        `INSERT INTO wallet_transactions (
          wallet_id, transaction_type, amount, 
          balance_before, balance_after, 
          reference_type, reference_id, description, 
          status, metadata, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING *`,
        [
          walletId,
          'deposit',
          amount,
          currentDeposited,
          newDeposited,
          referenceType || 'deposit',
          referenceId || null,
          description,
          'completed',
          metadata || null,
        ]
      );

      await client.query('COMMIT');
      return {
        wallet: updatedWallet.rows[0],
        transaction: transaction.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Debit deposited funds
   */
  static async debitDeposited(
    walletId: string,
    amount: number,
    description: string,
    referenceType?: string,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const walletResult = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [walletId]
      );

      if (walletResult.rows.length === 0) {
        throw new Error('Wallet not found');
      }

      const wallet = walletResult.rows[0];
      const currentDeposited = parseFloat(wallet.deposited_balance) || 0;

      if (currentDeposited < amount) {
        throw new Error('Insufficient deposited balance');
      }

      const newDeposited = currentDeposited - amount;

      const updatedWallet = await client.query(
        `UPDATE wallets 
         SET deposited_balance = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING *`,
        [newDeposited, walletId]
      );

      const transaction = await client.query(
        `INSERT INTO wallet_transactions (
          wallet_id, transaction_type, amount, 
          balance_before, balance_after, 
          reference_type, reference_id, description, 
          status, metadata, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING *`,
        [
          walletId,
          'payment',
          amount,
          currentDeposited,
          newDeposited,
          referenceType || 'payment',
          referenceId || null,
          description,
          'completed',
          metadata || null,
        ]
      );

      await client.query('COMMIT');
      return {
        wallet: updatedWallet.rows[0],
        transaction: transaction.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Credit rebate credits (PingRide-issued, non-withdrawable)
   */
  static async creditRebate(
    walletId: string,
    amount: number,
    description: string,
    referenceType?: string,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const walletResult = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [walletId]
      );

      if (walletResult.rows.length === 0) {
        throw new Error('Wallet not found');
      }

      const wallet = walletResult.rows[0];
      const currentRebate = parseFloat(wallet.rebate_credit_balance) || 0;
      const newRebate = currentRebate + amount;

      const updatedWallet = await client.query(
        `UPDATE wallets 
         SET rebate_credit_balance = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING *`,
        [newRebate, walletId]
      );

      const transaction = await client.query(
        `INSERT INTO wallet_transactions (
          wallet_id, transaction_type, amount, 
          balance_before, balance_after, 
          reference_type, reference_id, description, 
          status, metadata, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING *`,
        [
          walletId,
          'rebate_credit',
          amount,
          currentRebate,
          newRebate,
          referenceType || 'rebate',
          referenceId || null,
          description,
          'completed',
          metadata || null,
        ]
      );

      await client.query('COMMIT');
      return {
        wallet: updatedWallet.rows[0],
        transaction: transaction.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Debit rebate credits
   */
  static async debitRebate(
    walletId: string,
    amount: number,
    description: string,
    referenceType?: string,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const walletResult = await client.query(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [walletId]
      );

      if (walletResult.rows.length === 0) {
        throw new Error('Wallet not found');
      }

      const wallet = walletResult.rows[0];
      const currentRebate = parseFloat(wallet.rebate_credit_balance) || 0;

      if (currentRebate < amount) {
        throw new Error('Insufficient rebate credit balance');
      }

      const newRebate = currentRebate - amount;

      const updatedWallet = await client.query(
        `UPDATE wallets 
         SET rebate_credit_balance = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING *`,
        [newRebate, walletId]
      );

      const transaction = await client.query(
        `INSERT INTO wallet_transactions (
          wallet_id, transaction_type, amount, 
          balance_before, balance_after, 
          reference_type, reference_id, description, 
          status, metadata, completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING *`,
        [
          walletId,
          'rebate_usage',
          amount,
          currentRebate,
          newRebate,
          referenceType || 'ride',
          referenceId || null,
          description,
          'completed',
          metadata || null,
        ]
      );

      await client.query('COMMIT');
      return {
        wallet: updatedWallet.rows[0],
        transaction: transaction.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get wallet with all balances
   */
  static async getBalances(walletId: string): Promise<{
    deposited: number;
    rebate: number;
    promotional: number;
    total: number;
  } | null> {
    const result = await pool.query(
      `SELECT 
        deposited_balance,
        rebate_credit_balance,
        promotional_balance,
        (COALESCE(deposited_balance, 0) + COALESCE(rebate_credit_balance, 0) + COALESCE(promotional_balance, 0)) as total_balance
       FROM wallets 
       WHERE id = $1`,
      [walletId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      deposited: parseFloat(row.deposited_balance) || 0,
      rebate: parseFloat(row.rebate_credit_balance) || 0,
      promotional: parseFloat(row.promotional_balance) || 0,
      total: parseFloat(row.total_balance) || 0,
    };
  }
}

export default WalletModel;