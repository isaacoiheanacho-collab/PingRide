import { ProgrammePeriodModel } from '../models/programme-period.model';
import { PassengerQualificationModel } from '../models/passenger-qualification.model';
import { RebateFundModel } from '../models/rebate-fund.model';
import { WinnerModel } from '../models/winner.model';
import {
  IRebateFundBalance,
  IRebateFundContribution,
  IRebateAllocation,
  IRebateCredit,
  IRebateCreditUsage,
} from '../types';
import logger from '../utils/logger';

export class RebateFundService {
  private static readonly DEFAULT_CONTRIBUTION_RATE = 1.0; // 1%
  private static readonly DEFAULT_CREDIT_EXPIRY_DAYS = 90;

  // ============================================
  // CONTRIBUTIONS
  // ============================================

  /**
   * Record a rebate fund contribution from a completed ride
   * Called when a ride is completed
   */
  static async recordContribution(
    rideId: string,
    passengerId: string,
    fareAmount: number
  ): Promise<{
    recorded: boolean;
    contribution?: IRebateFundContribution;
    contributionAmount?: number;
    rate?: number;
    reason?: string;
  }> {
    // Get the current active programme period
    const period = await ProgrammePeriodModel.getCurrent();
    if (!period) {
      logger.warn('No active programme period found for rebate contribution');
      return { recorded: false, reason: 'No active programme period' };
    }

    // Get contribution rate from period configuration
    const contributionRate = period.rebate_contribution_rate || this.DEFAULT_CONTRIBUTION_RATE;

    try {
      const contribution = await RebateFundModel.recordContribution(
        rideId,
        period.id,
        passengerId,
        fareAmount,
        contributionRate
      );

      logger.debug(`Rebate contribution recorded: ride ${rideId}, amount ${contribution.contribution_amount}`);

      return {
        recorded: true,
        contribution,
        contributionAmount: contribution.contribution_amount,
        rate: contributionRate,
      };
    } catch (error) {
      logger.error('Error recording rebate contribution:', error);
      return { recorded: false, reason: 'Error recording contribution' };
    }
  }

  /**
   * Get rebate fund balance for the current period
   */
  static async getCurrentFundBalance(): Promise<IRebateFundBalance | null> {
    const period = await ProgrammePeriodModel.getCurrent();
    if (!period) {
      return null;
    }
    return RebateFundModel.getBalance(period.id);
  }

  /**
   * Get rebate fund balance for a specific programme period
   */
  static async getFundBalance(programmePeriodId: string): Promise<IRebateFundBalance | null> {
    return RebateFundModel.getBalance(programmePeriodId);
  }

  /**
   * Get available balance for distribution
   */
  static async getAvailableBalance(programmePeriodId: string): Promise<number> {
    return RebateFundModel.getAvailableBalance(programmePeriodId);
  }

  /**
   * Get all contributions for a programme period
   */
  static async getContributions(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ contributions: IRebateFundContribution[]; total: number }> {
    return RebateFundModel.getContributions(programmePeriodId, page, limit);
  }

  /**
   * Get contributions by passenger
   */
  static async getContributionsByPassenger(
    passengerId: string,
    programmePeriodId: string
  ): Promise<IRebateFundContribution[]> {
    return RebateFundModel.getContributionsByPassenger(passengerId, programmePeriodId);
  }

  /**
   * Get total contributions for a programme period
   */
  static async getTotalContributions(programmePeriodId: string): Promise<number> {
    return RebateFundModel.getTotalContributions(programmePeriodId);
  }

  // ============================================
  // ALLOCATIONS
  // ============================================

  /**
   * Calculate and create rebate allocations for winners
   */
  static async allocateRebates(
    programmePeriodId: string,
    winnerIds: string[]
  ): Promise<{
    allocations: IRebateAllocation[];
    totalAllocated: number;
    averageAllocation: number;
    fundSufficiencyChecked: boolean;
    scaled: boolean;
    scaleFactor?: number;
  }> {
    // Validate winnerIds
    if (!winnerIds || winnerIds.length === 0) {
      throw new Error('No winners provided for allocation');
    }

    // Get winners
    const winners = await WinnerModel.getActiveWinners(programmePeriodId);
    const selectedWinners = winners.filter((w) => winnerIds.includes(w.id));

    if (selectedWinners.length === 0) {
      throw new Error('No winners found for allocation');
    }

    // Get available fund balance
    const availableBalance = await RebateFundModel.getAvailableBalance(programmePeriodId);
    if (availableBalance <= 0) {
      throw new Error('Insufficient fund balance for allocation');
    }

    // Get period configuration for individual cap
    const period = await ProgrammePeriodModel.getById(programmePeriodId);
    if (!period) {
      throw new Error('Programme period not found');
    }

    const individualCap = period.individual_reward_cap || null;

    // Calculate provisional equal allocation
    const provisionalAllocation = availableBalance / selectedWinners.length;

    // Prepare allocation data
    const allocationData = selectedWinners.map((winner) => {
      // Get qualification registry ID based on user type
      let qualificationRegistryId = winner.qualification_registry_id;

      // Apply individual cap if configured
      let finalAllocation = provisionalAllocation;
      let individualCapApplied: number | null = null;

      if (individualCap && provisionalAllocation > individualCap) {
        finalAllocation = individualCap;
        individualCapApplied = individualCap;
      }

      return {
        passengerId: winner.user_id,
        programmePeriodId: programmePeriodId,
        qualificationRegistryId: qualificationRegistryId,
        eligibleAnnualSpend: winner.eligible_value,
        provisionalAllocation: provisionalAllocation,
        individualCapApplied: individualCapApplied || 0,
        finalAllocation: finalAllocation,
        fundSufficiencyApplied: false,
      };
    });

    // Check fund sufficiency after cap application
    const totalRequired = allocationData.reduce((sum, a) => sum + a.finalAllocation, 0);
    let scaled = false;
    let scaleFactor = 1;

    if (totalRequired > availableBalance) {
      // Scale proportionally
      scaleFactor = availableBalance / totalRequired;
      scaled = true;

      for (const data of allocationData) {
        data.finalAllocation = data.finalAllocation * scaleFactor;
        data.fundSufficiencyApplied = true;
      }
    }

    // Create allocations in database
    const allocations = await RebateFundModel.createAllocations(allocationData);

    // Update winner records with allocation amounts
    for (const allocation of allocations) {
      const winner = selectedWinners.find((w) => w.user_id === allocation.passenger_id);
      if (winner) {
        await WinnerModel.updateStatus(winner.id, 'active');
      }
    }

    const totalAllocated = allocations.reduce((sum, a) => sum + a.final_allocation, 0);

    logger.info(`Rebate allocations created: ${allocations.length} winners, total ${totalAllocated}`);

    return {
      allocations,
      totalAllocated,
      averageAllocation: allocations.length > 0 ? totalAllocated / allocations.length : 0,
      fundSufficiencyChecked: true,
      scaled,
      scaleFactor: scaled ? scaleFactor : undefined,
    };
  }

  /**
   * Get allocations for a programme period
   */
  static async getAllocations(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ allocations: IRebateAllocation[]; total: number }> {
    return RebateFundModel.getAllocationsByPeriod(programmePeriodId, page, limit);
  }

  /**
   * Get allocations by passenger
   */
  static async getAllocationsByPassenger(
    passengerId: string,
    programmePeriodId: string
  ): Promise<IRebateAllocation[]> {
    return RebateFundModel.getAllocationsByPassenger(passengerId, programmePeriodId);
  }

  /**
   * Approve allocations
   */
  static async approveAllocations(allocationIds: string[]): Promise<number> {
    const count = await RebateFundModel.approveAllocations(allocationIds);
    logger.info(`Approved ${count} rebate allocations`);
    return count;
  }

  /**
   * Get allocation by ID
   */
  static async getAllocationById(id: string): Promise<IRebateAllocation | null> {
    return RebateFundModel.getAllocationById(id);
  }

  /**
   * Update allocation status
   */
  static async updateAllocationStatus(
    allocationId: string,
    status: 'pending' | 'approved' | 'distributed' | 'expired'
  ): Promise<IRebateAllocation | null> {
    return RebateFundModel.updateAllocationStatus(allocationId, status);
  }

  // ============================================
  // CREDITS
  // ============================================

  /**
   * Issue rebate credits to a passenger
   */
  static async issueCredit(
    passengerId: string,
    allocationId: string,
    amount: number,
    expiresAt?: Date
  ): Promise<IRebateCredit> {
    const credit = await RebateFundModel.issueCredit(
      passengerId,
      allocationId,
      amount,
      expiresAt
    );

    // Mark passenger rebate as credited in qualification registry
    const allocation = await RebateFundModel.getAllocationById(allocationId);
    if (allocation) {
      await PassengerQualificationModel.markRebateCredited(
        passengerId,
        allocation.programme_period_id
      );
    }

    logger.info(`Rebate credit issued: ${amount} to passenger ${passengerId}`);
    return credit;
  }

  /**
   * Issue credits to all approved allocations for a programme period
   */
  static async issueCreditsForPeriod(
    programmePeriodId: string
  ): Promise<{
    issued: number;
    totalAmount: number;
    credits: IRebateCredit[];
  }> {
    const allocationsResult = await RebateFundModel.getAllocationsByPeriod(programmePeriodId);
    const approvedAllocations = allocationsResult.allocations.filter((a) => a.allocation_status === 'approved');

    if (approvedAllocations.length === 0) {
      logger.warn(`No approved allocations found for period ${programmePeriodId}`);
      return {
        issued: 0,
        totalAmount: 0,
        credits: [],
      };
    }

    const credits: IRebateCredit[] = [];
    let totalAmount = 0;

    for (const allocation of approvedAllocations) {
      const credit = await this.issueCredit(
        allocation.passenger_id,
        allocation.id,
        allocation.final_allocation
      );
      credits.push(credit);
      totalAmount += credit.credit_amount;
    }

    logger.info(`Issued ${credits.length} rebate credits for period ${programmePeriodId}`);

    return {
      issued: credits.length,
      totalAmount,
      credits,
    };
  }

  /**
   * Get credits by passenger
   */
  static async getCreditsByPassenger(
    passengerId: string,
    status?: 'active' | 'used' | 'expired' | 'cancelled',
    page: number = 1,
    limit: number = 100
  ): Promise<{ credits: IRebateCredit[]; total: number }> {
    return RebateFundModel.getCreditsByPassenger(passengerId, status, page, limit);
  }

  /**
   * Get active credits by passenger
   */
  static async getActiveCreditsByPassenger(passengerId: string): Promise<IRebateCredit[]> {
    const result = await RebateFundModel.getCreditsByPassenger(passengerId, 'active');
    return result.credits;
  }

  /**
   * Get credit by ID
   */
  static async getCreditById(id: string): Promise<IRebateCredit | null> {
    return RebateFundModel.getCreditById(id);
  }

  /**
   * Get available credit balance for a passenger
   */
  static async getAvailableCreditBalance(passengerId: string): Promise<number> {
    return RebateFundModel.getAvailableCreditBalance(passengerId);
  }

  /**
   * Use a rebate credit for a ride
   */
  static async useCredit(
    creditId: string,
    rideId: string,
    passengerId: string,
    fareAmount: number
  ): Promise<{
    used: boolean;
    usage?: IRebateCreditUsage;
    credit?: IRebateCredit;
    amountUsed?: number;
    remainingBalance?: number;
    reason?: string;
  }> {
    try {
      const credit = await RebateFundModel.getCreditById(creditId);

      if (!credit) {
        return { used: false, reason: 'Credit not found' };
      }

      if (credit.passenger_id !== passengerId) {
        return { used: false, reason: 'Credit does not belong to this passenger' };
      }

      if (credit.status !== 'active') {
        return { used: false, reason: 'Credit is not active' };
      }

      if (credit.expires_at && new Date(credit.expires_at) < new Date()) {
        return { used: false, reason: 'Credit has expired' };
      }

      if (credit.remaining_amount <= 0) {
        return { used: false, reason: 'No remaining credit balance' };
      }

      // Determine amount to use (min of fare and available credit)
      // If fareAmount is 0, we don't need to use any credit
      if (fareAmount <= 0) {
        return { used: false, reason: 'Fare amount is zero or negative' };
      }

      const amountToUse = Math.min(fareAmount, credit.remaining_amount);

      if (amountToUse <= 0) {
        return { used: false, reason: 'Invalid amount to use' };
      }

      // Use the credit
      const usage = await RebateFundModel.useCredit(
        creditId,
        rideId,
        passengerId,
        amountToUse,
        fareAmount
      );

      // Get updated credit
      const updatedCredit = await RebateFundModel.getCreditById(creditId);

      logger.info(`Rebate credit used: ${amountToUse} on ride ${rideId} by passenger ${passengerId}`);

      return {
        used: true,
        usage,
        credit: updatedCredit || undefined,
        amountUsed: amountToUse,
        remainingBalance: updatedCredit?.remaining_amount || 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error using credit';
      logger.error('Error using rebate credit:', error);
      return { used: false, reason: message };
    }
  }

  /**
   * Apply credits automatically to a ride fare
   * Uses the oldest active credits first (FIFO)
   */
  static async applyCreditsToRide(
    passengerId: string,
    rideId: string,
    fareAmount: number
  ): Promise<{
    applied: boolean;
    totalUsed: number;
    remainingFare: number;
    usageRecords: IRebateCreditUsage[];
    reason?: string;
  }> {
    // Get all active credits for the passenger, ordered by expiry (oldest first)
    const creditsResult = await RebateFundModel.getCreditsByPassenger(passengerId, 'active');
    const credits = creditsResult.credits;

    if (credits.length === 0) {
      return {
        applied: false,
        totalUsed: 0,
        remainingFare: fareAmount,
        usageRecords: [],
        reason: 'No active credits available',
      };
    }

    // Sort by expiry date (oldest first)
    credits.sort((a, b) => {
      if (!a.expires_at) return 1;
      if (!b.expires_at) return -1;
      return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
    });

    let remainingFare = fareAmount;
    const usageRecords: IRebateCreditUsage[] = [];
    let totalUsed = 0;

    for (const credit of credits) {
      if (remainingFare <= 0) break;

      const amountToUse = Math.min(remainingFare, credit.remaining_amount);

      if (amountToUse > 0) {
        try {
          const usage = await RebateFundModel.useCredit(
            credit.id,
            rideId,
            passengerId,
            amountToUse,
            fareAmount
          );
          usageRecords.push(usage);
          totalUsed += amountToUse;
          remainingFare -= amountToUse;
        } catch (error) {
          logger.error(`Error applying credit ${credit.id}:`, error);
          // Continue with next credit
        }
      }
    }

    return {
      applied: totalUsed > 0,
      totalUsed,
      remainingFare,
      usageRecords,
    };
  }

  /**
   * Expire credits that have passed expiry date
   */
  static async expireCredits(): Promise<number> {
    const count = await RebateFundModel.expireCredits();
    if (count > 0) {
      logger.info(`Expired ${count} rebate credits`);
    }
    return count;
  }

  /**
   * Cancel a credit (for fraud or manual adjustment)
   */
  static async cancelCredit(creditId: string, reason: string): Promise<IRebateCredit | null> {
    const credit = await RebateFundModel.cancelCredit(creditId, reason);
    if (credit) {
      logger.warn(`Rebate credit cancelled: ${creditId}, reason: ${reason}`);
    }
    return credit;
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Check if fund is sufficient for allocations
   */
  static async checkFundSufficiency(
    programmePeriodId: string,
    totalRequired: number
  ): Promise<{ sufficient: boolean; available: number; shortfall: number }> {
    return RebateFundModel.checkFundSufficiency(programmePeriodId, totalRequired);
  }

  /**
   * Get complete fund summary for a programme period
   */
  static async getFundSummary(programmePeriodId: string): Promise<{
    balance: IRebateFundBalance | null;
    totalContributions: number;
    totalAllocations: number;
    totalCredited: number;
    totalUtilised: number;
    totalExpired: number;
    currentBalance: number;
    availableBalance: number;
    contributionCount: number;
    allocationCount: number;
    creditCount: number;
  }> {
    return RebateFundModel.getFundSummary(programmePeriodId);
  }

  /**
   * Reserve funds for distribution
   */
  static async reserveFunds(programmePeriodId: string, amount: number): Promise<IRebateFundBalance | null> {
    return RebateFundModel.reserveFunds(programmePeriodId, amount);
  }

  /**
   * Release reserved funds
   */
  static async releaseReservedFunds(programmePeriodId: string, amount: number): Promise<IRebateFundBalance | null> {
    return RebateFundModel.releaseReservedFunds(programmePeriodId, amount);
  }

  /**
   * Calculate proportional allocation when fund is insufficient
   */
  static calculateProportionalAllocation(
    allocations: Array<{ passengerId: string; provisionalAllocation: number }>,
    availableFund: number
  ): Array<{ passengerId: string; provisionalAllocation: number; finalAllocation: number; scaleFactor: number }> {
    return RebateFundModel.calculateProportionalAllocation(allocations, availableFund);
  }

  /**
   * Get contribution rate from programme period
   */
  static async getContributionRate(programmePeriodId: string): Promise<number> {
    const period = await ProgrammePeriodModel.getById(programmePeriodId);
    if (!period) {
      return this.DEFAULT_CONTRIBUTION_RATE;
    }
    return period.rebate_contribution_rate || this.DEFAULT_CONTRIBUTION_RATE;
  }

  /**
   * Get default credit expiry days
   */
  static getDefaultCreditExpiryDays(): number {
    return this.DEFAULT_CREDIT_EXPIRY_DAYS;
  }

  /**
   * Get fund balance for the current period (simplified for UI)
   */
  static async getCurrentFundBalanceForUI(): Promise<{
    balance: number;
    totalContributions: number;
    totalAllocations: number;
    totalCredited: number;
    totalUsed: number;
    totalExpired: number;
    available: number;
    periodName: string;
    periodYear: number;
  } | null> {
    const period = await ProgrammePeriodModel.getCurrent();
    if (!period) {
      return null;
    }

    const balance = await RebateFundModel.getBalance(period.id);

    return {
      balance: balance?.current_balance || 0,
      totalContributions: balance?.total_contributions || 0,
      totalAllocations: balance?.total_allocated || 0,
      totalCredited: balance?.total_credited || 0,
      totalUsed: balance?.total_utilised || 0,
      totalExpired: balance?.total_expired || 0,
      available: (balance?.current_balance || 0) - (balance?.reserved_amount || 0),
      periodName: `Programme ${period.year}`,
      periodYear: period.year,
    };
  }

  /**
   * Mark a contribution as ineligible (fraud reversal)
   */
  static async markContributionIneligible(
    contributionId: string,
    reason: string
  ): Promise<void> {
    await RebateFundModel.markContributionIneligible(contributionId, reason);
    logger.warn(`Rebate contribution marked ineligible: ${contributionId}, reason: ${reason}`);
  }
}

export default RebateFundService;