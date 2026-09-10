import pool from '../config/database';
import { DriverLedgerModel } from '../models/driver-ledger.model';
import logger from '../utils/logger';

export class ReconciliationService {
  // ============================================
  // RECONCILIATION TYPES
  // ============================================

  /**
   * Reconcile all payments
   * Compare internal payment records with Paystack transactions
   */
  static async reconcilePayments(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    total: number;
    matched: number;
    unmatched: number;
    discrepancies: Array<{
      payment_id: string;
      gateway_reference: string;
      issue: string;
    }>;
  }> {
    // Get all payments with gateway references
    const result = await pool.query(
      `SELECT * FROM payments 
       WHERE gateway_reference IS NOT NULL
         ${startDate ? 'AND created_at >= $1' : ''}
         ${endDate ? `AND created_at <= ${startDate ? '$2' : '$1'}` : ''}
       ORDER BY created_at DESC`,
      startDate ? [startDate, endDate] : endDate ? [endDate] : []
    );

    const payments = result.rows;
    let matched = 0;
    let unmatched = 0;
    const discrepancies: Array<{
      payment_id: string;
      gateway_reference: string;
      issue: string;
    }> = [];

    for (const payment of payments) {
      try {
        // Check if payment has gateway response
        if (payment.gateway_response) {
          const gatewayStatus = payment.gateway_response.status || payment.gateway_response.data?.status;
          
          // Check if internal status matches gateway status
          if (payment.status === 'paid' && gatewayStatus !== 'success') {
            discrepancies.push({
              payment_id: payment.id,
              gateway_reference: payment.gateway_reference,
              issue: `Payment marked as paid but gateway status is ${gatewayStatus}`,
            });
          } else if (payment.status === 'pending' && gatewayStatus === 'success') {
            discrepancies.push({
              payment_id: payment.id,
              gateway_reference: payment.gateway_reference,
              issue: `Payment marked as pending but gateway status is success`,
            });
          }
          matched++;
        } else {
          // Payment has gateway reference but no response
          // This could be a payment that was initialized but not verified
          discrepancies.push({
            payment_id: payment.id,
            gateway_reference: payment.gateway_reference,
            issue: 'Gateway reference present but no gateway response',
          });
          unmatched++;
        }
      } catch (error) {
        logger.error(`Error reconciling payment ${payment.id}:`, error);
        discrepancies.push({
          payment_id: payment.id,
          gateway_reference: payment.gateway_reference,
          issue: 'Error processing reconciliation',
        });
        unmatched++;
      }
    }

    logger.info(`Payment reconciliation complete: ${matched} matched, ${unmatched} unmatched, ${discrepancies.length} discrepancies`);
    return {
      total: payments.length,
      matched,
      unmatched,
      discrepancies,
    };
  }

  /**
   * Reconcile settlements
   * Check if all settlements have been processed correctly
   */
  static async reconcileSettlements(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    issues: Array<{
      settlement_id: string;
      driver_id: string;
      issue: string;
    }>;
  }> {
    const result = await pool.query(
      `SELECT * FROM settlements 
       ${startDate ? 'WHERE created_at >= $1' : ''}
       ${endDate ? `AND created_at <= ${startDate ? '$2' : '$1'}` : ''}
       ORDER BY created_at DESC`,
      startDate ? [startDate, endDate] : endDate ? [endDate] : []
    );

    const settlements = result.rows;
    const issues: Array<{
      settlement_id: string;
      driver_id: string;
      issue: string;
    }> = [];

    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const settlement of settlements) {
      switch (settlement.status) {
        case 'pending':
          pending++;
          break;
        case 'processing':
          processing++;
          break;
        case 'completed':
          completed++;
          // Check if driver ledger was updated
          const ledger = await DriverLedgerModel.getByDriverId(settlement.driver_id);
          if (!ledger) {
            issues.push({
              settlement_id: settlement.id,
              driver_id: settlement.driver_id,
              issue: 'Settlement completed but driver ledger not found',
            });
          }
          break;
        case 'failed':
          failed++;
          issues.push({
            settlement_id: settlement.id,
            driver_id: settlement.driver_id,
            issue: `Settlement failed${settlement.reference ? `: ${settlement.reference}` : ''}`,
          });
          break;
      }
    }

    logger.info(`Settlement reconciliation complete: ${settlements.length} total, ${completed} completed`);
    return {
      total: settlements.length,
      pending,
      processing,
      completed,
      failed,
      issues,
    };
  }

  /**
   * Reconcile wallet transactions
   * Check if wallet balances match transaction history
   */
  static async reconcileWallets(): Promise<{
    walletsChecked: number;
    walletsMismatched: number;
    mismatches: Array<{
      wallet_id: string;
      user_id: string;
      expectedBalance: number;
      actualBalance: number;
      difference: number;
    }>;
  }> {
    const wallets = await pool.query(
      `SELECT w.*, 
        COALESCE(SUM(CASE 
          WHEN wt.transaction_type IN ('top_up', 'refund', 'bonus') THEN wt.amount
          WHEN wt.transaction_type IN ('payment', 'withdrawal', 'commission') THEN -wt.amount
          ELSE 0
        END), 0) as calculated_balance
       FROM wallets w
       LEFT JOIN wallet_transactions wt ON w.id = wt.wallet_id AND wt.status = 'completed'
       GROUP BY w.id`
    );

    let walletsMismatched = 0;
    const mismatches: Array<{
      wallet_id: string;
      user_id: string;
      expectedBalance: number;
      actualBalance: number;
      difference: number;
    }> = [];

    for (const wallet of wallets.rows) {
      const actualBalance = parseFloat(wallet.balance);
      const calculatedBalance = parseFloat(wallet.calculated_balance);

      if (Math.abs(actualBalance - calculatedBalance) > 0.01) {
        walletsMismatched++;
        mismatches.push({
          wallet_id: wallet.id,
          user_id: wallet.user_id,
          expectedBalance: calculatedBalance,
          actualBalance,
          difference: actualBalance - calculatedBalance,
        });
      }
    }

    logger.info(`Wallet reconciliation complete: ${wallets.rows.length} wallets checked, ${walletsMismatched} mismatched`);
    return {
      walletsChecked: wallets.rows.length,
      walletsMismatched,
      mismatches,
    };
  }

  /**
   * Reconcile driver ledgers
   * Check if driver ledger balances match transaction history
   */
  static async reconcileDriverLedgers(): Promise<{
    ledgersChecked: number;
    ledgersMismatched: number;
    mismatches: Array<{
      driver_id: string;
      expectedBalance: number;
      actualBalance: number;
      difference: number;
    }>;
  }> {
    const ledgers = await pool.query(
      `SELECT dl.*,
        (dl.digital_earnings + dl.bonus_earnings + dl.adjustment_earnings - 
         dl.total_commission_deducted - dl.total_withdrawals - dl.total_refunds) as calculated_balance
       FROM driver_ledger dl`
    );

    let ledgersMismatched = 0;
    const mismatches: Array<{
      driver_id: string;
      expectedBalance: number;
      actualBalance: number;
      difference: number;
    }> = [];

    for (const ledger of ledgers.rows) {
      const actualNetBalance = parseFloat(ledger.net_balance);
      const calculatedBalance = parseFloat(ledger.calculated_balance);

      if (Math.abs(actualNetBalance - calculatedBalance) > 0.01) {
        ledgersMismatched++;
        mismatches.push({
          driver_id: ledger.driver_id,
          expectedBalance: calculatedBalance,
          actualBalance: actualNetBalance,
          difference: actualNetBalance - calculatedBalance,
        });
      }
    }

    logger.info(`Driver ledger reconciliation complete: ${ledgers.rows.length} ledgers checked, ${ledgersMismatched} mismatched`);
    return {
      ledgersChecked: ledgers.rows.length,
      ledgersMismatched,
      mismatches,
    };
  }

  // ============================================
  // DAILY RECONCILIATION
  // ============================================

  /**
   * Run daily reconciliation
   * Checks payments, settlements, wallets, and driver ledgers
   */
  static async runDailyReconciliation(date: string): Promise<{
    date: string;
    payments: {
      total: number;
      matched: number;
      unmatched: number;
      discrepancies: number;
    };
    settlements: {
      total: number;
      completed: number;
      issues: number;
    };
    wallets: {
      checked: number;
      mismatched: number;
    };
    driverLedgers: {
      checked: number;
      mismatched: number;
    };
  }> {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const [paymentResult, settlementResult, walletResult, ledgerResult] = await Promise.all([
      this.reconcilePayments(startDate, endDate),
      this.reconcileSettlements(startDate, endDate),
      this.reconcileWallets(),
      this.reconcileDriverLedgers(),
    ]);

    return {
      date,
      payments: {
        total: paymentResult.total,
        matched: paymentResult.matched,
        unmatched: paymentResult.unmatched,
        discrepancies: paymentResult.discrepancies.length,
      },
      settlements: {
        total: settlementResult.total,
        completed: settlementResult.completed,
        issues: settlementResult.issues.length,
      },
      wallets: {
        checked: walletResult.walletsChecked,
        mismatched: walletResult.walletsMismatched,
      },
      driverLedgers: {
        checked: ledgerResult.ledgersChecked,
        mismatched: ledgerResult.ledgersMismatched,
      },
    };
  }

  // ============================================
  // DISCREPANCY MANAGEMENT
  // ============================================

  /**
   * Get all discrepancies
   */
  static async getAllDiscrepancies(): Promise<{
    payments: Array<{
      payment_id: string;
      gateway_reference: string;
      issue: string;
    }>;
    settlements: Array<{
      settlement_id: string;
      driver_id: string;
      issue: string;
    }>;
    wallets: Array<{
      wallet_id: string;
      user_id: string;
      expectedBalance: number;
      actualBalance: number;
      difference: number;
    }>;
    driverLedgers: Array<{
      driver_id: string;
      expectedBalance: number;
      actualBalance: number;
      difference: number;
    }>;
  }> {
    const [paymentResult, settlementResult, walletResult, ledgerResult] = await Promise.all([
      this.reconcilePayments(),
      this.reconcileSettlements(),
      this.reconcileWallets(),
      this.reconcileDriverLedgers(),
    ]);

    return {
      payments: paymentResult.discrepancies,
      settlements: settlementResult.issues,
      wallets: walletResult.mismatches,
      driverLedgers: ledgerResult.mismatches,
    };
  }

  /**
   * Fix a wallet discrepancy
   * Adjusts wallet balance to match calculated balance
   */
  static async fixWalletDiscrepancy(
    walletId: string
  ): Promise<{
    fixed: boolean;
    message: string;
    oldBalance?: number;
    newBalance?: number;
  }> {
    const result = await pool.query(
      `SELECT w.*, 
        COALESCE(SUM(CASE 
          WHEN wt.transaction_type IN ('top_up', 'refund', 'bonus') THEN wt.amount
          WHEN wt.transaction_type IN ('payment', 'withdrawal', 'commission') THEN -wt.amount
          ELSE 0
        END), 0) as calculated_balance
       FROM wallets w
       LEFT JOIN wallet_transactions wt ON w.id = wt.wallet_id AND wt.status = 'completed'
       WHERE w.id = $1
       GROUP BY w.id`,
      [walletId]
    );

    if (result.rows.length === 0) {
      return { fixed: false, message: 'Wallet not found' };
    }

    const wallet = result.rows[0];
    const oldBalance = parseFloat(wallet.balance);
    const calculatedBalance = parseFloat(wallet.calculated_balance);

    if (Math.abs(oldBalance - calculatedBalance) < 0.01) {
      return { fixed: true, message: 'Wallet balance is correct' };
    }

    // Update wallet balance to match calculated balance
    await pool.query(
      'UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2',
      [calculatedBalance, walletId]
    );

    logger.info(`Wallet discrepancy fixed: ${walletId}, balance updated from ${oldBalance} to ${calculatedBalance}`);
    return {
      fixed: true,
      message: 'Wallet balance corrected',
      oldBalance,
      newBalance: calculatedBalance,
    };
  }

  /**
   * Fix a driver ledger discrepancy
   * Adjusts net balance to match calculated balance
   */
  static async fixDriverLedgerDiscrepancy(
    driverId: string
  ): Promise<{
    fixed: boolean;
    message: string;
    oldBalance?: number;
    newBalance?: number;
  }> {
    const result = await pool.query(
      `SELECT dl.*,
        (dl.digital_earnings + dl.bonus_earnings + dl.adjustment_earnings - 
         dl.total_commission_deducted - dl.total_withdrawals - dl.total_refunds) as calculated_balance
       FROM driver_ledger dl
       WHERE dl.driver_id = $1`,
      [driverId]
    );

    if (result.rows.length === 0) {
      return { fixed: false, message: 'Driver ledger not found' };
    }

    const ledger = result.rows[0];
    const oldBalance = parseFloat(ledger.net_balance);
    const calculatedBalance = parseFloat(ledger.calculated_balance);

    if (Math.abs(oldBalance - calculatedBalance) < 0.01) {
      return { fixed: true, message: 'Driver ledger balance is correct' };
    }

    // Update ledger balance to match calculated balance
    await pool.query(
      'UPDATE driver_ledger SET net_balance = $1, updated_at = NOW() WHERE driver_id = $2',
      [calculatedBalance, driverId]
    );

    logger.info(`Driver ledger discrepancy fixed: ${driverId}, balance updated from ${oldBalance} to ${calculatedBalance}`);
    return {
      fixed: true,
      message: 'Driver ledger balance corrected',
      oldBalance,
      newBalance: calculatedBalance,
    };
  }

  // ============================================
  // REPORTING
  // ============================================

  /**
   * Get reconciliation report
   */
  static async getReconciliationReport(
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    period: {
      start: Date | null;
      end: Date | null;
    };
    summary: {
      totalPayments: number;
      totalRevenue: number;
      totalCommission: number;
      totalSettlements: number;
      totalSettlementAmount: number;
      totalRefunds: number;
      totalRefundAmount: number;
    };
    discrepancies: {
      paymentCount: number;
      settlementCount: number;
      walletCount: number;
      ledgerCount: number;
    };
  }> {
    const [payments, settlements, refunds, discrepancies] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total, COALESCE(SUM(commission_amount), 0) as commission
         FROM payments 
         WHERE status = 'paid'
         ${startDate ? 'AND created_at >= $1' : ''}
         ${endDate ? `AND created_at <= ${startDate ? '$2' : '$1'}` : ''}`,
        startDate ? [startDate, endDate] : endDate ? [endDate] : []
      ),
      pool.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(net_payout), 0) as total
         FROM settlements 
         WHERE status = 'completed'
         ${startDate ? 'AND created_at >= $1' : ''}
         ${endDate ? `AND created_at <= ${startDate ? '$2' : '$1'}` : ''}`,
        startDate ? [startDate, endDate] : endDate ? [endDate] : []
      ),
      pool.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(refund_amount), 0) as total
         FROM refunds 
         WHERE status = 'processed'
         ${startDate ? 'AND created_at >= $1' : ''}
         ${endDate ? `AND created_at <= ${startDate ? '$2' : '$1'}` : ''}`,
        startDate ? [startDate, endDate] : endDate ? [endDate] : []
      ),
      this.getAllDiscrepancies(),
    ]);

    const paymentRow = payments.rows[0];
    const settlementRow = settlements.rows[0];
    const refundRow = refunds.rows[0];

    return {
      period: {
        start: startDate || null,
        end: endDate || null,
      },
      summary: {
        totalPayments: parseInt(paymentRow?.count || '0', 10),
        totalRevenue: parseFloat(paymentRow?.total || '0'),
        totalCommission: parseFloat(paymentRow?.commission || '0'),
        totalSettlements: parseInt(settlementRow?.count || '0', 10),
        totalSettlementAmount: parseFloat(settlementRow?.total || '0'),
        totalRefunds: parseInt(refundRow?.count || '0', 10),
        totalRefundAmount: parseFloat(refundRow?.total || '0'),
      },
      discrepancies: {
        paymentCount: discrepancies.payments.length,
        settlementCount: discrepancies.settlements.length,
        walletCount: discrepancies.wallets.length,
        ledgerCount: discrepancies.driverLedgers.length,
      },
    };
  }
}

export default ReconciliationService;