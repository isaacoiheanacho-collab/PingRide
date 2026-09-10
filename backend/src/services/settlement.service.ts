// ============================================
// SETTLEMENT.SERVICE.TS - CORRECTED
// ============================================

import { SettlementModel } from '../models/settlement.model';
import { DriverLedgerModel } from '../models/driver-ledger.model';
import { 
  ISettlement, 
  ICreateSettlement
  // ✅ REMOVED: IUpdateSettlement - not used in this file
} from '../types/payment.types';
import logger from '../utils/logger';
import pool from '../config/database';

export class SettlementService {
  // ============================================
  // READ-ONLY SETTLEMENT MANAGEMENT
  // ============================================

  /**
   * Get settlement by ID (READ-ONLY)
   */
  static async getSettlementById(id: string): Promise<ISettlement | null> {
    return SettlementModel.getById(id);
  }

  /**
   * Get settlement with driver details (READ-ONLY)
   */
  static async getSettlementWithDetails(id: string): Promise<any> {
    return SettlementModel.getWithDriverDetails(id);
  }

  /**
   * Get settlements by driver (READ-ONLY)
   */
  static async getSettlementsByDriver(
    driverId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ settlements: ISettlement[]; total: number }> {
    return SettlementModel.getByDriverId(driverId, page, limit);
  }

  /**
   * Get all settlements (READ-ONLY)
   */
  static async getAllSettlements(
    page: number = 1,
    limit: number = 100,
    filters?: {
      status?: string;
      driver_id?: string;
      start_date?: string;
      end_date?: string;
    }
  ): Promise<{ settlements: ISettlement[]; total: number }> {
    return SettlementModel.getAll(page, limit, filters);
  }

  /**
   * Get all settlements with driver details (READ-ONLY)
   */
  static async getAllSettlementsWithDetails(
    page: number = 1,
    limit: number = 100,
    status?: string
  ): Promise<{ settlements: any[]; total: number }> {
    return SettlementModel.getAllWithDriverDetails(page, limit, status);
  }

  /**
   * Get pending settlements (READ-ONLY)
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is kept for historical data access only.
   */
  static async getPendingSettlements(
    page: number = 1,
    limit: number = 100
  ): Promise<{ settlements: ISettlement[]; total: number }> {
    return SettlementModel.getPendingSettlements(page, limit);
  }

  // ============================================
  // SETTLEMENT SUMMARY (READ-ONLY)
  // ============================================

  /**
   * Get settlement summary for a driver (READ-ONLY)
   */
  static async getDriverSettlementSummary(driverId: string): Promise<{
    totalSettlements: number;
    totalEarnings: number;
    totalCommission: number;
    totalPayout: number;
    pendingCount: number;
    completedCount: number;
  }> {
    return SettlementModel.getDriverSettlementSummary(driverId);
  }

  /**
   * Get global settlement summary (READ-ONLY)
   */
  static async getGlobalSettlementSummary(): Promise<{
    totalPending: number;
    totalProcessing: number;
    totalCompleted: number;
    totalFailed: number;
    totalPayoutAmount: number;
  }> {
    const [counts, totalPayout] = await Promise.all([
      SettlementModel.getCountByStatus(),
      SettlementModel.getTotalPendingPayouts()
    ]);

    return {
      totalPending: counts.pending || 0,
      totalProcessing: counts.processing || 0,
      totalCompleted: counts.completed || 0,
      totalFailed: counts.failed || 0,
      totalPayoutAmount: totalPayout,
    };
  }

  /**
   * Get settlements by date range (READ-ONLY)
   */
  static async getSettlementsByDateRange(
    startDate: string,
    endDate: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ settlements: ISettlement[]; total: number }> {
    return SettlementModel.getByDateRange(startDate, endDate, page, limit);
  }

  // ============================================
  // DEPRECATED METHODS (Kept for backwards compatibility)
  // ============================================

  /**
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is DEPRECATED. DO NOT USE for new operations.
   * It is kept for potential rollback only.
   */
  static async createSettlement(
    data: ICreateSettlement
  ): Promise<ISettlement> {
    logger.warn('⚠️ createSettlement() is DEPRECATED. Settlements are automatic via Paystack subaccount.');
    
    // Check if settlement already exists for this period
    const existing = await SettlementModel.getByPeriodAndDriver(
      data.driver_id,
      data.period_start,
      data.period_end
    );

    if (existing) {
      throw new Error('Settlement already exists for this period');
    }

    const settlement = await SettlementModel.create(data);
    logger.info(`Settlement created: ${settlement.id}`);
    return settlement;
  }

  /**
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is DEPRECATED. DO NOT USE for new operations.
   * It is kept for potential rollback only.
   */
  static async generateSettlement(
    driverId: string,
    periodStart: string,
    periodEnd: string,
    payoutMethod: 'bank_transfer' | 'mobile_money' | 'wallet'
  ): Promise<ISettlement> {
    logger.warn('⚠️ generateSettlement() is DEPRECATED. Settlements are automatic via Paystack subaccount.');
    
    // Get driver's earnings for the period
    const earnings = await this.calculateDriverEarnings(driverId, periodStart, periodEnd);

    if (earnings.totalEarnings === 0 && earnings.totalCommission === 0) {
      throw new Error('No earnings found for this period');
    }

    const netPayout = earnings.totalEarnings - earnings.totalCommission;

    // Create settlement
    return this.createSettlement({
      driver_id: driverId,
      period_start: periodStart,
      period_end: periodEnd,
      total_earnings: earnings.totalEarnings,
      total_commission: earnings.totalCommission,
      net_payout: netPayout,
      payout_method: payoutMethod,
    });
  }

  /**
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is DEPRECATED. DO NOT USE for new operations.
   * It is kept for potential rollback only.
   */
  static async processSettlement(
    id: string,
    reference?: string
  ): Promise<ISettlement | null> {
    logger.warn('⚠️ processSettlement() is DEPRECATED. Settlements are automatic via Paystack subaccount.');
    
    const settlement = await SettlementModel.getById(id);
    if (!settlement) {
      throw new Error('Settlement not found');
    }

    if (settlement.status !== 'pending') {
      throw new Error('Only pending settlements can be processed');
    }

    const updated = await SettlementModel.markProcessing(id, reference);
    logger.info(`Settlement processing started: ${id}`);
    return updated;
  }

  /**
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is DEPRECATED. DO NOT USE for new operations.
   * It is kept for potential rollback only.
   */
  static async completeSettlement(
    id: string,
    reference?: string
  ): Promise<ISettlement | null> {
    logger.warn('⚠️ completeSettlement() is DEPRECATED. Settlements are automatic via Paystack subaccount.');
    
    const settlement = await SettlementModel.getById(id);
    if (!settlement) {
      throw new Error('Settlement not found');
    }

    if (settlement.status !== 'processing') {
      throw new Error('Only processing settlements can be completed');
    }

    const updated = await SettlementModel.markCompleted(id, reference);
    
    // If completed, update driver ledger
    if (updated) {
      await this.updateDriverLedgerAfterSettlement(updated);
    }

    logger.info(`Settlement completed: ${id}`);
    return updated;
  }

  /**
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is DEPRECATED. DO NOT USE for new operations.
   * It is kept for potential rollback only.
   */
  static async failSettlement(
    id: string,
    reason: string
  ): Promise<ISettlement | null> {
    logger.warn('⚠️ failSettlement() is DEPRECATED. Settlements are automatic via Paystack subaccount.');
    
    const settlement = await SettlementModel.getById(id);
    if (!settlement) {
      throw new Error('Settlement not found');
    }

    if (settlement.status !== 'processing') {
      throw new Error('Only processing settlements can be failed');
    }

    const updated = await SettlementModel.markFailed(id, reason);
    logger.info(`Settlement failed: ${id}, reason: ${reason}`);
    return updated;
  }

  /**
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is DEPRECATED. DO NOT USE for new operations.
   * It is kept for potential rollback only.
   */
  static async generateSettlementsForPeriod(
    periodStart: string,
    periodEnd: string,
    payoutMethod: 'bank_transfer' | 'mobile_money' | 'wallet'
  ): Promise<{
    generated: number;
    skipped: number;
    failed: number;
    settlements: ISettlement[];
  }> {
    logger.warn('⚠️ generateSettlementsForPeriod() is DEPRECATED. Settlements are automatic via Paystack subaccount.');
    
    // Get all drivers with earnings
    const drivers = await pool.query(
      `SELECT DISTINCT driver_id 
       FROM payments 
       WHERE status = 'paid' 
         AND created_at BETWEEN $1 AND $2`,
      [periodStart, periodEnd]
    );

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const settlements: ISettlement[] = [];

    for (const driver of drivers.rows) {
      try {
        const settlement = await this.generateSettlement(
          driver.driver_id,
          periodStart,
          periodEnd,
          payoutMethod
        );
        settlements.push(settlement);
        generated++;
      } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
          skipped++;
        } else {
          failed++;
          logger.error(`Failed to generate settlement for driver ${driver.driver_id}:`, error);
        }
      }
    }

    logger.info(`Batch settlement generation: ${generated} generated, ${skipped} skipped, ${failed} failed`);
    return {
      generated,
      skipped,
      failed,
      settlements,
    };
  }

  /**
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is DEPRECATED. DO NOT USE for new operations.
   * It is kept for potential rollback only.
   */
  static async processAllPendingSettlements(): Promise<{
    processed: number;
    failed: number;
  }> {
    logger.warn('⚠️ processAllPendingSettlements() is DEPRECATED. Settlements are automatic via Paystack subaccount.');
    
    const { settlements } = await SettlementModel.getPendingSettlements();
    let processed = 0;
    let failed = 0;

    for (const settlement of settlements) {
      try {
        await this.processSettlement(settlement.id);
        processed++;
      } catch (error) {
        failed++;
        logger.error(`Failed to process settlement ${settlement.id}:`, error);
      }
    }

    logger.info(`Batch settlement processing: ${processed} processed, ${failed} failed`);
    return {
      processed,
      failed,
    };
  }

  /**
   * @deprecated Settlements are now automatic via Paystack subaccount.
   * This method is DEPRECATED. DO NOT USE for new operations.
   * It is kept for potential rollback only.
   */
  static async completeAllProcessingSettlements(): Promise<{
    completed: number;
    failed: number;
  }> {
    logger.warn('⚠️ completeAllProcessingSettlements() is DEPRECATED. Settlements are automatic via Paystack subaccount.');
    
    const result = await pool.query(
      `SELECT * FROM settlements WHERE status = 'processing'`
    );

    let completed = 0;
    let failed = 0;

    for (const settlement of result.rows) {
      try {
        await this.completeSettlement(settlement.id);
        completed++;
      } catch (error) {
        failed++;
        logger.error(`Failed to complete settlement ${settlement.id}:`, error);
      }
    }

    logger.info(`Batch settlement completion: ${completed} completed, ${failed} failed`);
    return {
      completed,
      failed,
    };
  }

  /**
   * Calculate driver earnings for a period
   * @deprecated Used only by deprecated methods
   */
  private static async calculateDriverEarnings(
    driverId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<{
    totalEarnings: number;
    totalCommission: number;
    rideCount: number;
  }> {
    const result = await pool.query(
      `SELECT 
        COALESCE(SUM(driver_earnings), 0) as total_earnings,
        COALESCE(SUM(commission_amount), 0) as total_commission,
        COUNT(*) as ride_count
       FROM payments
       WHERE driver_id = $1 
         AND status = 'paid'
         AND created_at BETWEEN $2 AND $3`,
      [driverId, periodStart, periodEnd]
    );

    const row = result.rows[0];
    return {
      totalEarnings: parseFloat(row?.total_earnings || '0'),
      totalCommission: parseFloat(row?.total_commission || '0'),
      rideCount: parseInt(row?.ride_count || '0', 10),
    };
  }

  /**
   * Update driver ledger after settlement completion
   * @deprecated Used only by deprecated methods
   */
  private static async updateDriverLedgerAfterSettlement(
    settlement: ISettlement
  ): Promise<void> {
    // Deduct from driver ledger
    const ledger = await DriverLedgerModel.getByDriverId(settlement.driver_id);
    if (ledger) {
      await DriverLedgerModel.deductWithdrawal(
        settlement.driver_id,
        settlement.net_payout
      );

      // Create ledger transaction
      await DriverLedgerModel.createTransaction({
        driver_ledger_id: ledger.id,
        transaction_type: 'withdrawal',
        amount: settlement.net_payout,
        balance_before: ledger.withdrawable_balance,
        balance_after: ledger.withdrawable_balance - settlement.net_payout,
        reference_type: 'settlement',
        reference_id: settlement.id,
        description: `Settlement payout: ${settlement.period_start} to ${settlement.period_end}`,
      });
    }
  }
}

export default SettlementService;