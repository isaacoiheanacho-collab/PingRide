import { CashViolationModel } from '../models/cash-violation.model';
import { DriverSuspensionModel } from '../models/driver-suspension.model';
import { WalletService } from './wallet.service';
import {
  ICashViolation,
  ICreateCashViolation,
  IUpdateCashViolation,
  CashViolationPenaltyLevel
} from '../types/payment.types';
import logger from '../utils/logger';

export class PenaltyService {
  // ============================================
  // PENALTY MANAGEMENT
  // ============================================

  /**
   * Create a cash violation
   */
  static async createViolation(
    data: ICreateCashViolation
  ): Promise<ICashViolation> {
    // Check if violation already exists for this ride
    const existing = await CashViolationModel.getByRideId(data.ride_id);
    if (existing) {
      throw new Error('Violation already exists for this ride');
    }

    const violation = await CashViolationModel.create(data);

    // Apply penalty immediately
    await this.applyPenalty(violation);

    logger.warn(`Cash violation created: ${violation.id}`);
    return violation;
  }

  /**
   * Get violation by ID
   */
  static async getViolationById(id: string): Promise<ICashViolation | null> {
    return CashViolationModel.getById(id);
  }

  /**
   * Get violations by driver
   */
  static async getViolationsByDriver(
    driverId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ violations: ICashViolation[]; total: number }> {
    return CashViolationModel.getByDriverId(driverId, page, limit);
  }

  /**
   * Get all violations
   */
  static async getAllViolations(
    page: number = 1,
    limit: number = 100,
    filters?: {
      driver_id?: string;
      penalty_level?: string;
      driver_suspended?: boolean;
      driver_reinstated?: boolean;
    }
  ): Promise<{ violations: ICashViolation[]; total: number }> {
    return CashViolationModel.getAll(page, limit, filters);
  }

  /**
   * Update violation
   */
  static async updateViolation(
    id: string,
    data: IUpdateCashViolation
  ): Promise<ICashViolation | null> {
    return CashViolationModel.update(id, data);
  }

  /**
   * Get violation with details
   */
  static async getViolationWithDetails(id: string): Promise<any> {
    return CashViolationModel.getWithDetails(id);
  }

  /**
   * Get driver violation summary
   */
  static async getDriverViolationSummary(driverId: string): Promise<{
    totalViolations: number;
    activeViolations: number;
    resolvedViolations: number;
    currentPenaltyLevel: string;
    totalCommissionOwed: number;
  }> {
    return CashViolationModel.getDriverViolationSummary(driverId);
  }

  /**
   * Get the driver's current unpaid commission balance
   * Read directly from driver_profiles.total_commission_owed.
   */
  static async getDriverCommissionOwed(driverId: string): Promise<number> {
    const pool = (await import('../config/database')).default;
    const result = await pool.query(
      'SELECT total_commission_owed FROM driver_profiles WHERE id = $1',
      [driverId]
    );
    return parseFloat(result.rows[0]?.total_commission_owed || '0');
  }

  // ============================================
  // PENALTY ACTIONS
  // ============================================

  /**
   * Apply penalty for a violation
   */
  private static async applyPenalty(
    violation: ICashViolation
  ): Promise<void> {
    // Apply penalty based on penalty level
    switch (violation.penalty_level) {
      case 'first':
        await this.applyFirstPenalty(violation);
        break;
      case 'second':
        await this.applySecondPenalty(violation);
        break;
      case 'third':
        await this.applyThirdPenalty(violation);
        break;
      case 'permanent':
        await this.applyPermanentPenalty(violation);
        break;
    }
  }

  /**
   * Apply first penalty: Suspend driver temporarily
   */
  private static async applyFirstPenalty(
    violation: ICashViolation
  ): Promise<void> {
    // Suspend driver
    await CashViolationModel.suspendDriver(violation.id);

    // Increase the driver's outstanding commission debt
    await this.incrementCommissionOwed(
      violation.driver_id,
      violation.commission_amount
    );

    // Record the suspension event
    await DriverSuspensionModel.create({
      driver_id: violation.driver_id,
      reason_code: 'cash_violation',
      reason: `Cash violation — penalty level: ${violation.penalty_level}`,
      violation_id: violation.id,
      suspended_by: null,
      notes: `Commission debt increased by ₦${violation.commission_amount.toFixed(2)}`,
    });

    // Update driver status in driver_profiles
    await this.updateDriverStatus(violation.driver_id, 'suspended');

    logger.warn(`First penalty applied to driver ${violation.driver_id}: Suspended`);
  }

  /**
   * Apply second penalty: Suspend driver and deduct from passenger wallet
   */
  private static async applySecondPenalty(
    violation: ICashViolation
  ): Promise<void> {
    // Suspend driver
    await CashViolationModel.suspendDriver(violation.id);

    // Increase the driver's outstanding commission debt
    await this.incrementCommissionOwed(
      violation.driver_id,
      violation.commission_amount
    );

    // Record the suspension event
    await DriverSuspensionModel.create({
      driver_id: violation.driver_id,
      reason_code: 'cash_violation',
      reason: `Cash violation — penalty level: ${violation.penalty_level}`,
      violation_id: violation.id,
      suspended_by: null,
      notes: `Commission debt increased by ₦${violation.commission_amount.toFixed(2)}`,
    });

    // Deduct from passenger wallet
    const passenger = await this.getPassengerUserId(violation.passenger_id);
    if (passenger) {
      try {
        await WalletService.debit(
          passenger,
          violation.fare_amount,
          'Cash violation penalty',
          'cash_violation',
          violation.id
        );
        await CashViolationModel.markPassengerDeducted(violation.id);
      } catch (error) {
        logger.error(`Failed to deduct from passenger wallet: ${error}`);
      }
    }

    // Update driver status
    await this.updateDriverStatus(violation.driver_id, 'suspended');

    logger.warn(`Second penalty applied to driver ${violation.driver_id}: Suspended + passenger deducted`);
  }

  /**
   * Apply third penalty: Permanent suspension
   */
  private static async applyThirdPenalty(
    violation: ICashViolation
  ): Promise<void> {
    // Suspend driver
    await CashViolationModel.suspendDriver(violation.id);

    // Increase the driver's outstanding commission debt
    await this.incrementCommissionOwed(
      violation.driver_id,
      violation.commission_amount
    );

    // Record the suspension event
    await DriverSuspensionModel.create({
      driver_id: violation.driver_id,
      reason_code: 'cash_violation',
      reason: `Cash violation — penalty level: ${violation.penalty_level}`,
      violation_id: violation.id,
      suspended_by: null,
      notes: `Commission debt increased by ₦${violation.commission_amount.toFixed(2)}`,
    });

    // Update driver status
    await this.updateDriverStatus(violation.driver_id, 'suspended');

    logger.warn(`Third penalty applied to driver ${violation.driver_id}: Extended suspension`);
  }

  /**
   * Apply permanent penalty: Ban driver
   */
  private static async applyPermanentPenalty(
    violation: ICashViolation
  ): Promise<void> {
    // Suspend driver
    await CashViolationModel.suspendDriver(violation.id);

    // Increase the driver's outstanding commission debt
    await this.incrementCommissionOwed(
      violation.driver_id,
      violation.commission_amount
    );

    // Record the suspension event
    await DriverSuspensionModel.create({
      driver_id: violation.driver_id,
      reason_code: 'cash_violation',
      reason: `Cash violation — penalty level: permanent`,
      violation_id: violation.id,
      suspended_by: null,
      notes: `Permanent ban. Commission debt increased by ₦${violation.commission_amount.toFixed(2)}`,
    });

    // Update driver status to deactivated
    await this.updateDriverStatus(violation.driver_id, 'deactivated');

    logger.warn(`Permanent penalty applied to driver ${violation.driver_id}: Deactivated`);
  }

  // ============================================
  // PENALTY ESCALATION
  // ============================================

  /**
   * Escalate penalty level for a violation
   */
  static async escalatePenalty(
    violationId: string
  ): Promise<ICashViolation | null> {
    const violation = await CashViolationModel.getById(violationId);
    if (!violation) {
      throw new Error('Violation not found');
    }

    const nextLevels: Record<CashViolationPenaltyLevel, CashViolationPenaltyLevel> = {
      'first': 'second',
      'second': 'third',
      'third': 'permanent',
      'permanent': 'permanent',
    };

    const nextLevel = nextLevels[violation.penalty_level];
    const updated = await CashViolationModel.updatePenaltyLevel(violationId, nextLevel);

    // Re-apply penalty with new level
    if (updated) {
      await this.applyPenalty(updated);
    }

    logger.warn(`Penalty escalated: ${violationId} -> ${nextLevel}`);
    return updated;
  }

  /**
   * Get next penalty level for a driver
   */
  static async getNextPenaltyLevel(
    driverId: string
  ): Promise<CashViolationPenaltyLevel> {
    const currentLevel = await CashViolationModel.getCurrentPenaltyLevel(driverId);

    const nextLevels: Record<string, CashViolationPenaltyLevel> = {
      'first': 'second',
      'second': 'third',
      'third': 'permanent',
      'permanent': 'permanent',
    };

    if (!currentLevel) {
      return 'first';
    }

    return nextLevels[currentLevel] || 'first';
  }

  // ============================================
  // REINSTATEMENT
  // ============================================

  /**
   * Reinstate driver after paying penalty
   */
  static async reinstateDriver(
    violationId: string,
    reinstatedBy: string
  ): Promise<ICashViolation | null> {
    const violation = await CashViolationModel.getById(violationId);
    if (!violation) {
      throw new Error('Violation not found');
    }

    if (!violation.driver_suspended) {
      throw new Error('Driver is not suspended');
    }

    // Check the driver's outstanding commission debt
    const owed = await this.getDriverCommissionOwed(violation.driver_id);
    if (owed > 0) {
      throw new Error(
        `Driver has unpaid commission debt of ₦${owed.toFixed(2)}`
      );
    }

    // Reinstate driver
    const updated = await CashViolationModel.reinstateDriver(violationId);

    // Update driver status
    await this.updateDriverStatus(violation.driver_id, 'active');

    // Resolve violation
    await CashViolationModel.resolve(violationId, reinstatedBy);

    // Close the active suspension row (if any)
    const activeSuspension = await DriverSuspensionModel.getActiveByDriver(
      violation.driver_id
    );
    if (activeSuspension) {
      await DriverSuspensionModel.reinstate(
        activeSuspension.id,
        reinstatedBy,
        `Debt cleared. Reinstated via violation ${violationId}.`
      );
    }

    logger.info(`Driver reinstated: ${violation.driver_id} after paying penalty`);
    return updated;
  }

  /**
   * Confirm driver payment
   */
  static async confirmDriverPayment(
    violationId: string
  ): Promise<ICashViolation | null> {
    const violation = await CashViolationModel.getById(violationId);
    if (!violation) {
      throw new Error('Violation not found');
    }

    // Mark payment as confirmed
    const updated = await CashViolationModel.confirmDriverPayment(violationId);

    // Reduce the driver's outstanding commission debt by the amount paid
    if (updated) {
      await this.decrementCommissionOwed(
        violation.driver_id,
        violation.commission_amount
      );
    }

    logger.info(`Driver payment confirmed: ${violation.driver_id}`);
    return updated;
  }

  // ============================================
  // COMMISSION OWED (driver_profiles.total_commission_owed)
  // ============================================

  /**
   * Increase a driver's outstanding commission debt
   */
  private static async incrementCommissionOwed(
    driverId: string,
    amount: number
  ): Promise<void> {
    const pool = (await import('../config/database')).default;

    await pool.query(
      `UPDATE driver_profiles
       SET total_commission_owed = total_commission_owed + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [amount, driverId]
    );
  }

  /**
   * Decrease a driver's outstanding commission debt (floored at zero
   * by the CHECK constraint; GREATEST is a defensive belt-and-braces).
   */
  private static async decrementCommissionOwed(
    driverId: string,
    amount: number
  ): Promise<void> {
    const pool = (await import('../config/database')).default;

    await pool.query(
      `UPDATE driver_profiles
       SET total_commission_owed = GREATEST(0, total_commission_owed - $1),
           updated_at = NOW()
       WHERE id = $2`,
      [amount, driverId]
    );
  }

  // ============================================
  // DRIVER STATUS
  // ============================================

  /**
   * Update driver status in driver_profiles
   */
  private static async updateDriverStatus(
    driverId: string,
    status: string
  ): Promise<void> {
    const pool = (await import('../config/database')).default;

    await pool.query(
      'UPDATE driver_profiles SET driver_status = $1, updated_at = NOW() WHERE id = $2',
      [status, driverId]
    );
  }

  /**
   * Get passenger user ID from passenger profile ID
   */
  private static async getPassengerUserId(
    passengerId: string
  ): Promise<string | null> {
    const pool = (await import('../config/database')).default;

    const result = await pool.query(
      'SELECT user_id FROM passenger_profiles WHERE id = $1',
      [passengerId]
    );
    return result.rows[0]?.user_id || null;
  }

  // ============================================
  // PENALTY SUMMARY
  // ============================================

  /**
   * Get global penalty summary
   */
  static async getPenaltySummary(): Promise<{
    totalViolations: number;
    activeViolations: number;
    totalUnpaidCommission: number;
    suspendedDrivers: number;
    countByPenaltyLevel: Record<string, number>;
  }> {
    const [
      totalViolations,
      activeViolations,
      totalUnpaidCommission,
      countByPenaltyLevel,
      suspendedDrivers,
    ] = await Promise.all([
      CashViolationModel.getTotalCount(),
      this.getActiveViolationsCount(),
      this.getTotalUnpaidCommissionAcrossDrivers(),
      CashViolationModel.getCountByPenaltyLevel(),
      this.getSuspendedDriversCount(),
    ]);

    return {
      totalViolations,
      activeViolations,
      totalUnpaidCommission,
      suspendedDrivers,
      countByPenaltyLevel,
    };
  }

  /**
   * Get active violations count
   */
  private static async getActiveViolationsCount(): Promise<number> {
    const pool = (await import('../config/database')).default;

    const result = await pool.query(
      'SELECT COUNT(*) as count FROM cash_violations WHERE driver_reinstated = false'
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Get suspended drivers count
   */
  private static async getSuspendedDriversCount(): Promise<number> {
    const pool = (await import('../config/database')).default;

    const result = await pool.query(
      "SELECT COUNT(*) as count FROM driver_profiles WHERE driver_status = 'suspended'"
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Sum the outstanding commission owed across all drivers.
   * Reads driver_profiles.total_commission_owed (single indexed scan).
   */
  private static async getTotalUnpaidCommissionAcrossDrivers(): Promise<number> {
    const pool = (await import('../config/database')).default;

    const result = await pool.query(
      'SELECT COALESCE(SUM(total_commission_owed), 0) as total FROM driver_profiles'
    );
    return parseFloat(result.rows[0]?.total || '0');
  }
}

export default PenaltyService;