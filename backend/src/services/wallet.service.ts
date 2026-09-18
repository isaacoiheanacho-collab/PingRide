// ============================================
// WALLET.SERVICE.TS - MODIFIED
// ============================================

import { WalletModel } from '../models/wallet.model';
import { WalletTransactionModel } from '../models/wallet-transaction.model';
import {
  IWallet,
  ICreateWallet,
  IUpdateWallet,
  IWalletTransaction
} from '../types/payment.types';
import logger from '../utils/logger';
import pool from '../config/database';

export class WalletService {
  // ============================================
  // WALLET MANAGEMENT
  // ============================================

  /**
   * Create wallet for a user
   */
  static async createWallet(data: ICreateWallet): Promise<IWallet> {
    const existing = await WalletModel.getByUserId(data.user_id);
    if (existing) {
      throw new Error('Wallet already exists for this user');
    }

    const wallet = await WalletModel.create(data);
    logger.info(`Wallet created for user: ${data.user_id}`);
    return wallet;
  }

  /**
   * Get wallet by user ID
   */
  static async getWalletByUserId(userId: string): Promise<IWallet> {
    const wallet = await WalletModel.getByUserId(userId);
    if (!wallet) {
      return this.createWallet({ user_id: userId });
    }
    return wallet;
  }

  /**
   * Get wallet by ID
   */
  static async getWalletById(id: string): Promise<IWallet | null> {
    return WalletModel.getById(id);
  }

  /**
   * Get wallet total balance
   * Total = deposited_balance + rebate_credit_balance + promotional_balance
   * The legacy `balance` column is no longer used.
   */
  static async getBalance(userId: string): Promise<number> {
    const wallet = await this.getWalletByUserId(userId);
    return (
      (wallet.deposited_balance || 0) +
      (wallet.rebate_credit_balance || 0) +
      (wallet.promotional_balance || 0)
    );
  }

  /**
   * Update wallet (status / freeze fields only)
   */
  static async updateWallet(id: string, data: IUpdateWallet): Promise<IWallet | null> {
    return WalletModel.update(id, data);
  }

  /**
   * Freeze wallet
   */
  static async freezeWallet(userId: string, reason: string): Promise<IWallet | null> {
    const wallet = await this.getWalletByUserId(userId);
    return WalletModel.freeze(wallet.id, reason);
  }

  /**
   * Unfreeze wallet
   */
  static async unfreezeWallet(userId: string): Promise<IWallet | null> {
    const wallet = await this.getWalletByUserId(userId);
    return WalletModel.unfreeze(wallet.id);
  }

  /**
   * Check if wallet is active
   */
  static async isWalletActive(userId: string): Promise<boolean> {
    const wallet = await this.getWalletByUserId(userId);
    return wallet.status === 'active';
  }

  /**
   * Check if wallet is frozen
   */
  static async isWalletFrozen(userId: string): Promise<boolean> {
    const wallet = await this.getWalletByUserId(userId);
    return wallet.status === 'frozen';
  }

  // ============================================
  // WALLET TRANSACTIONS
  // ============================================

  /**
   * Get wallet transactions
   */
  static async getTransactions(
    userId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ transactions: IWalletTransaction[]; total: number }> {
    const wallet = await this.getWalletByUserId(userId);
    return WalletModel.getTransactionsByWalletId(wallet.id, page, limit);
  }

  /**
   * Get transaction by ID
   */
  static async getTransactionById(id: string): Promise<IWalletTransaction | null> {
    return WalletTransactionModel.getById(id);
  }

  /**
   * Get transactions by reference
   */
  static async getTransactionsByReference(
    referenceType: string,
    referenceId: string
  ): Promise<IWalletTransaction[]> {
    return WalletTransactionModel.getByReference(referenceType, referenceId);
  }

  /**
   * Credit wallet (delegates to deposited funds)
   * Legacy wrapper — routes money into deposited_balance.
   */
  static async credit(
    userId: string,
    amount: number,
    description: string,
    referenceType?: string,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    return this.creditDepositedFunds(
      userId,
      amount,
      description,
      referenceType || 'deposit',
      referenceId,
      metadata
    );
  }

  /**
   * Debit wallet (delegates to deposited funds)
   * Legacy wrapper — routes money out of deposited_balance.
   */
  static async debit(
    userId: string,
    amount: number,
    description: string,
    referenceType?: string,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    return this.debitDepositedFunds(
      userId,
      amount,
      description,
      referenceType || 'payment',
      referenceId,
      metadata
    );
  }

  /**
   * Top up wallet
   */
  static async topUp(
    userId: string,
    amount: number,
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    return this.creditDepositedFunds(
      userId,
      amount,
      'Wallet top-up',
      'top_up',
      referenceId,
      metadata
    );
  }

  /**
   * Process payment from wallet
   */
  static async processPayment(
    userId: string,
    amount: number,
    referenceId: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    return this.debitDepositedFunds(
      userId,
      amount,
      'Ride payment',
      'payment',
      referenceId,
      metadata
    );
  }

  /**
   * Refund to wallet
   */
  static async refund(
    userId: string,
    amount: number,
    referenceId: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    return this.creditDepositedFunds(
      userId,
      amount,
      'Payment refund',
      'refund',
      referenceId,
      metadata
    );
  }

  /**
   * Reverse a transaction
   * Uses the three-column wallet model: reverses into deposited_balance.
   * - Reversing a debit (payment/withdrawal) → credit deposited funds back
   * - Reversing a credit (deposit/refund/bonus/top_up) → debit deposited funds
   */
  static async reverseTransaction(
    transactionId: string,
    reason: string
  ): Promise<IWalletTransaction | null> {
    const transaction = await WalletTransactionModel.getById(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== 'completed') {
      throw new Error('Only completed transactions can be reversed');
    }

    const wallet = await WalletModel.getById(transaction.wallet_id);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const isDebit =
      transaction.transaction_type === 'payment' ||
      transaction.transaction_type === 'withdrawal' ||
      transaction.transaction_type === 'rebate_usage';

    if (isDebit) {
      // Reverse a debit → credit deposited funds back
      await WalletModel.creditDeposited(
        wallet.id,
        transaction.amount,
        `Reversal: ${transaction.description}`,
        'adjustment',
        transaction.id,
        { reversal_reason: reason, original_transaction_id: transaction.id }
      );
    } else {
      // Reverse a credit → debit deposited funds
      const currentDeposited = parseFloat(String(wallet.deposited_balance)) || 0;
      if (currentDeposited < transaction.amount) {
        throw new Error('Cannot reverse: insufficient deposited balance');
      }

      await WalletModel.debitDeposited(
        wallet.id,
        transaction.amount,
        `Reversal: ${transaction.description}`,
        'adjustment',
        transaction.id,
        { reversal_reason: reason, original_transaction_id: transaction.id }
      );
    }

    return WalletTransactionModel.markReversed(transactionId, reason);
  }

  // ============================================
  // DEPOSITED FUNDS OPERATIONS
  // ============================================

  /**
   * Credit deposited funds (bank transfer / card top-up)
   */
  static async creditDepositedFunds(
    userId: string,
    amount: number,
    description: string,
    referenceType: string = 'deposit',
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.status !== 'active') {
      throw new Error('Wallet is not active');
    }

    const result = await WalletModel.creditDeposited(
      wallet.id,
      amount,
      description,
      referenceType,
      referenceId,
      metadata
    );

    logger.info(`Deposited funds credited: ${userId}, amount: ${amount}`);
    return result;
  }

  /**
   * Debit deposited funds
   */
  static async debitDepositedFunds(
    userId: string,
    amount: number,
    description: string,
    referenceType: string = 'payment',
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.status !== 'active') {
      throw new Error('Wallet is not active');
    }

    const currentDeposited = parseFloat(String(wallet.deposited_balance)) || 0;
    if (currentDeposited < amount) {
      throw new Error('Insufficient deposited balance');
    }

    const result = await WalletModel.debitDeposited(
      wallet.id,
      amount,
      description,
      referenceType,
      referenceId,
      metadata
    );

    logger.info(`Deposited funds debited: ${userId}, amount: ${amount}`);
    return result;
  }

  // ============================================
  // REBATE CREDIT OPERATIONS
  // ============================================

  /**
   * Credit rebate credits (PingRide-issued)
   */
  static async creditRebateCredits(
    userId: string,
    amount: number,
    description: string,
    referenceType: string = 'rebate',
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.status !== 'active') {
      throw new Error('Wallet is not active');
    }

    const result = await WalletModel.creditRebate(
      wallet.id,
      amount,
      description,
      referenceType,
      referenceId,
      metadata
    );

    logger.info(`Rebate credits credited: ${userId}, amount: ${amount}`);
    return result;
  }

  /**
   * Debit rebate credits
   */
  static async debitRebateCredits(
    userId: string,
    amount: number,
    description: string,
    referenceType: string = 'payment',
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.status !== 'active') {
      throw new Error('Wallet is not active');
    }

    const rebateBalance = wallet.rebate_credit_balance || 0;
    if (rebateBalance < amount) {
      throw new Error('Insufficient rebate credit balance');
    }

    const result = await WalletModel.debitRebate(
      wallet.id,
      amount,
      description,
      referenceType,
      referenceId,
      metadata
    );

    logger.info(`Rebate credits debited: ${userId}, amount: ${amount}`);
    return result;
  }

  // ============================================
  // PAYMENT WITH PRIORITY (CREDITS FIRST)
  // ============================================

  /**
   * Pay for a ride - uses credits first, then deposited funds
   * Priority: Rebate Credits → Promotional Credits → Deposited Funds
   */
  static async payForRide(
    userId: string,
    rideId: string,
    amount: number,
    metadata?: any
  ): Promise<{
    wallet: IWallet;
    transactions: IWalletTransaction[];
    usedCredits: { type: string; amount: number }[];
  }> {
    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.status !== 'active') {
      throw new Error('Wallet is not active');
    }

    if (amount <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }

    const totalBalance =
      (wallet.deposited_balance || 0) +
      (wallet.rebate_credit_balance || 0) +
      (wallet.promotional_balance || 0);

    if (totalBalance < amount) {
      throw new Error(
        `Insufficient balance. Available: ${totalBalance}, Required: ${amount}`
      );
    }

    let remainingAmount = amount;
    const usedCredits: { type: string; amount: number }[] = [];
    const transactions: IWalletTransaction[] = [];
    let currentWallet = wallet;

    // Step 1: Use rebate credits first (PingRide-issued, non-withdrawable)
    if (currentWallet.rebate_credit_balance > 0 && remainingAmount > 0) {
      const toUse = Math.min(remainingAmount, currentWallet.rebate_credit_balance);
      const result = await WalletModel.debitRebate(
        currentWallet.id,
        toUse,
        `Ride payment - ${rideId} (rebate credits)`,
        'ride',
        rideId,
        {
          ...metadata,
          ride_id: rideId,
          credit_type: 'rebate',
          priority: 1,
        }
      );
      transactions.push(result.transaction);
      usedCredits.push({ type: 'rebate', amount: toUse });
      remainingAmount -= toUse;
      currentWallet = result.wallet;

      logger.info(
        `Used rebate credits for ride ${rideId}: ${toUse}, remaining: ${remainingAmount}`
      );
    }

    // Step 2: Use promotional credits if available (PingRide-issued)
    if (currentWallet.promotional_balance > 0 && remainingAmount > 0) {
      const promoBalance = currentWallet.promotional_balance;
      logger.info(
        `Promotional credits available: ${promoBalance}, but debit method not yet implemented. Skipping.`
      );

      // TODO: When promotional debit is implemented in WalletModel:
      // const toUse = Math.min(remainingAmount, currentWallet.promotional_balance);
      // const result = await WalletModel.debitPromotional(...)
    }

    // Step 3: Use deposited funds for remaining (customer-funded, withdrawable)
    if (remainingAmount > 0 && currentWallet.deposited_balance > 0) {
      const toUse = Math.min(remainingAmount, currentWallet.deposited_balance);
      const result = await WalletModel.debitDeposited(
        currentWallet.id,
        toUse,
        `Ride payment - ${rideId} (deposited funds)`,
        'ride',
        rideId,
        {
          ...metadata,
          ride_id: rideId,
          credit_type: 'deposited',
          priority: 3,
        }
      );
      transactions.push(result.transaction);
      usedCredits.push({ type: 'deposited', amount: toUse });
      remainingAmount -= toUse;
      currentWallet = result.wallet;

      logger.info(
        `Used deposited funds for ride ${rideId}: ${toUse}, remaining: ${remainingAmount}`
      );
    }

    // Step 4: Check if fully paid
    if (remainingAmount > 0) {
      const totalUsed = amount - remainingAmount;
      throw new Error(`Insufficient balance. Need ${amount}, have ${totalUsed}`);
    }

    const finalWallet = await this.getWalletByUserId(userId);

    logger.info(
      `Ride payment completed: ${rideId}, amount: ${amount}, credits used: ${usedCredits.length} types`
    );

    return {
      wallet: finalWallet!,
      transactions,
      usedCredits,
    };
  }

  /**
   * Check if user can pay for a ride with their current balance
   */
  static async canPayForRide(
    userId: string,
    amount: number
  ): Promise<{
    canPay: boolean;
    breakdown: {
      rebateCredits: number;
      promotionalCredits: number;
      depositedFunds: number;
      totalAvailable: number;
      shortfall: number;
    };
  }> {
    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      return {
        canPay: false,
        breakdown: {
          rebateCredits: 0,
          promotionalCredits: 0,
          depositedFunds: 0,
          totalAvailable: 0,
          shortfall: amount,
        },
      };
    }

    const rebateCredits = wallet.rebate_credit_balance || 0;
    const promotionalCredits = wallet.promotional_balance || 0;
    const depositedFunds = wallet.deposited_balance || 0;
    const totalAvailable = rebateCredits + promotionalCredits + depositedFunds;

    return {
      canPay: totalAvailable >= amount,
      breakdown: {
        rebateCredits,
        promotionalCredits,
        depositedFunds,
        totalAvailable,
        shortfall: Math.max(0, amount - totalAvailable),
      },
    };
  }

  /**
   * Get payment priority breakdown for a ride
   */
  static async getPaymentBreakdown(
    userId: string,
    amount: number
  ): Promise<{
    total: number;
    rebateCredits: number;
    promotionalCredits: number;
    depositedFunds: number;
    remainingAfterCredits: number;
  }> {
    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      return {
        total: 0,
        rebateCredits: 0,
        promotionalCredits: 0,
        depositedFunds: 0,
        remainingAfterCredits: amount,
      };
    }

    let remaining = amount;
    let rebateUsed = 0;
    let promotionalUsed = 0;
    let depositedUsed = 0;

    const rebateBalance = wallet.rebate_credit_balance || 0;
    if (remaining > 0 && rebateBalance > 0) {
      rebateUsed = Math.min(remaining, rebateBalance);
      remaining -= rebateUsed;
    }

    const promoBalance = wallet.promotional_balance || 0;
    if (remaining > 0 && promoBalance > 0) {
      promotionalUsed = Math.min(remaining, promoBalance);
      remaining -= promotionalUsed;
    }

    const depositedBalance = wallet.deposited_balance || 0;
    if (remaining > 0 && depositedBalance > 0) {
      depositedUsed = Math.min(remaining, depositedBalance);
      remaining -= depositedUsed;
    }

    return {
      total: amount,
      rebateCredits: rebateUsed,
      promotionalCredits: promotionalUsed,
      depositedFunds: depositedUsed,
      remainingAfterCredits: remaining,
    };
  }

  // ============================================
  // BALANCE RETRIEVAL
  // ============================================

  /**
   * Get detailed wallet balances
   */
  static async getDetailedBalance(userId: string): Promise<{
    deposited: number;
    rebateCredit: number;
    promotional: number;
    total: number;
  }> {
    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      return { deposited: 0, rebateCredit: 0, promotional: 0, total: 0 };
    }

    const deposited = wallet.deposited_balance || 0;
    const rebateCredit = wallet.rebate_credit_balance || 0;
    const promotional = wallet.promotional_balance || 0;

    return {
      deposited,
      rebateCredit,
      promotional,
      total: deposited + rebateCredit + promotional,
    };
  }

  /**
   * Get available balance for a specific purpose
   */
  static async getAvailableBalance(
    userId: string,
    purpose: 'ride' | 'withdrawal'
  ): Promise<number> {
    const balance = await this.getDetailedBalance(userId);

    if (purpose === 'withdrawal') {
      // Only deposited funds can be withdrawn
      return balance.deposited;
    }

    // For rides, all balances are available
    return balance.total;
  }

  // ============================================
  // WALLET SUMMARY
  // ============================================

  /**
   * Get wallet summary for a user
   */
  static async getWalletSummary(userId: string): Promise<{
    wallet: IWallet;
    totalCredits: number;
    totalDebits: number;
    transactionCount: number;
  }> {
    const wallet = await this.getWalletByUserId(userId);

    const [totalCredits, totalDebits, transactionCount] = await Promise.all([
      WalletTransactionModel.getTotalCredits(wallet.id),
      WalletTransactionModel.getTotalDebits(wallet.id),
      WalletModel.getTransactionCount(userId)
    ]);

    return {
      wallet,
      totalCredits,
      totalDebits,
      transactionCount,
    };
  }

  /**
   * Get transaction history summary
   */
  static async getTransactionHistorySummary(
    userId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{
    transactions: IWalletTransaction[];
    total: number;
    totalCredits: number;
    totalDebits: number;
  }> {
    const wallet = await this.getWalletByUserId(userId);
    const [transactionsResult, totalCredits, totalDebits] = await Promise.all([
      WalletModel.getTransactionsByWalletId(wallet.id, page, limit),
      WalletTransactionModel.getTotalCredits(wallet.id),
      WalletTransactionModel.getTotalDebits(wallet.id)
    ]);

    return {
      transactions: transactionsResult.transactions,
      total: transactionsResult.total,
      totalCredits,
      totalDebits,
    };
  }

  // ============================================
  // DEPRECATED METHODS (Kept for backwards compatibility)
  // ============================================

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * Read-only historical access.
   */
  static async getWithdrawals(
    driverId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ withdrawals: any[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM withdrawals 
       WHERE driver_id = $1 
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM withdrawals WHERE driver_id = $1',
      [driverId]
    );

    return {
      withdrawals: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * DO NOT USE for new operations.
   */
  static async createWithdrawal(
    driverId: string,
    amount: number,
    method: string,
    accountName: string,
    accountNumber: string,
    bankName?: string
  ): Promise<any> {
    logger.warn(
      '⚠️ createWithdrawal() is DEPRECATED. Payments are automatic via Paystack subaccount.'
    );

    const ledger = await pool.query(
      'SELECT * FROM driver_ledger WHERE driver_id = $1',
      [driverId]
    );
    if (ledger.rows.length === 0) {
      throw new Error('Driver ledger not found');
    }

    const ledgerRow = ledger.rows[0];
    if (parseFloat(ledgerRow.withdrawable_balance) < amount) {
      throw new Error('Insufficient withdrawable balance');
    }

    const result = await pool.query(
      `INSERT INTO withdrawals (
        driver_id,
        wallet_id,
        amount,
        method,
        account_name,
        account_number,
        bank_name,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *`,
      [
        driverId,
        ledgerRow.id,
        amount,
        method,
        accountName,
        accountNumber,
        bankName || null,
      ]
    );

    logger.info(`Withdrawal requested: ${driverId}, amount: ${amount}`);
    return result.rows[0];
  }

  /**
   * @deprecated Withdrawals are now automatic via Paystack subaccount.
   * DO NOT USE for new operations.
   */
  static async processWithdrawal(
    withdrawalId: string,
    status: 'processing' | 'completed' | 'failed',
    reference?: string,
    failureReason?: string
  ): Promise<any> {
    logger.warn(
      '⚠️ processWithdrawal() is DEPRECATED. Payments are automatic via Paystack subaccount.'
    );

    const result = await pool.query(
      `UPDATE withdrawals 
       SET status = $1,
           reference = $2,
           processed_at = CASE WHEN $1 IN ('processing', 'completed') THEN NOW() ELSE NULL END,
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END,
           failure_reason = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, reference || null, failureReason || null, withdrawalId]
    );

    logger.info(`Withdrawal ${withdrawalId} status updated to: ${status}`);
    return result.rows[0] || null;
  }

  // ============================================
  // PROMOTIONAL CREDIT OPERATIONS (PLACEHOLDER)
  // ============================================

  /**
   * Credit promotional credits
   * TODO: Implement dedicated promotional balance handler in WalletModel.
   */
  static async creditPromotionalCredits(
    userId: string,
    amount: number,
    description: string,
    referenceType: string = 'promotional',
    referenceId?: string,
    metadata?: any
  ): Promise<{ wallet: IWallet; transaction: IWalletTransaction }> {
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const wallet = await this.getWalletByUserId(userId);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    if (wallet.status !== 'active') {
      throw new Error('Wallet is not active');
    }

    // TODO: Route to WalletModel.creditPromotional once it exists.
    // Until then, promotional credits go into the deposited_balance bucket.
    const result = await this.creditDepositedFunds(
      userId,
      amount,
      `${description} (promotional)`,
      referenceType || 'promotional',
      referenceId,
      metadata
    );

    logger.info(`Promotional credits credited: ${userId}, amount: ${amount}`);
    return result;
  }

  // ============================================
  // REBATE CREDIT EXPIRY CHECK
  // ============================================

  /**
   * Expire rebate credits that have passed expiry
   * Scheduled job.
   */
  static async expireRebateCredits(): Promise<{
    expired: number;
    totalAmount: number;
  }> {
    try {
      const result = await pool.query(
        `SELECT id, passenger_id, remaining_amount 
         FROM rebate_credits 
         WHERE status = 'active' 
           AND expires_at < NOW()`
      );

      if (result.rows.length === 0) {
        return { expired: 0, totalAmount: 0 };
      }

      let totalAmount = 0;
      let expiredCount = 0;

      for (const credit of result.rows) {
        await pool.query(
          `UPDATE rebate_credits 
           SET status = 'expired', updated_at = NOW() 
           WHERE id = $1`,
          [credit.id]
        );

        const wallet = await this.getWalletByUserId(credit.passenger_id);
        if (wallet) {
          const newRebateBalance = Math.max(
            0,
            (wallet.rebate_credit_balance || 0) - credit.remaining_amount
          );
          await pool.query(
            `UPDATE wallets 
             SET rebate_credit_balance = $1, updated_at = NOW() 
             WHERE id = $2`,
            [newRebateBalance, wallet.id]
          );

          await WalletTransactionModel.create({
            wallet_id: wallet.id,
            transaction_type: 'adjustment',
            amount: credit.remaining_amount,
            balance_before: wallet.rebate_credit_balance || 0,
            balance_after: newRebateBalance,
            reference_type: 'rebate_expiry',
            reference_id: credit.id,
            description: 'Rebate credit expired',
            metadata: { credit_id: credit.id },
          });

          totalAmount += credit.remaining_amount;
          expiredCount++;
        }
      }

      logger.info(`Expired ${expiredCount} rebate credits, total amount: ${totalAmount}`);
      return { expired: expiredCount, totalAmount };
    } catch (error) {
      logger.error('Error expiring rebate credits:', error);
      throw error;
    }
  }
}

export default WalletService;