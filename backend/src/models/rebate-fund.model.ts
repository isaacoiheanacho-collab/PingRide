import pool from '../config/database';
import {
    IRebateFundBalance,
    IRebateFundContribution,
    IRebateAllocation,
    IRebateCredit,
    IRebateCreditUsage,
} from '../types';
import logger from '../utils/logger';

export class RebateFundModel {
    private static readonly DEFAULT_CONTRIBUTION_RATE = 1.0; // 1%

    // ============================================
    // REBATE FUND BALANCE
    // ============================================

    /**
     * Get rebate fund balance for a programme period
     */
    static async getBalance(programmePeriodId: string): Promise<IRebateFundBalance | null> {
        const result = await pool.query(
            `SELECT * FROM rebate_fund_balance 
             WHERE programme_period_id = $1`,
            [programmePeriodId]
        );
        return result.rows[0] || null;
    }

    /**
     * Create or update rebate fund balance
     */
    static async upsertBalance(
        programmePeriodId: string,
        contributionAmount: number
    ): Promise<IRebateFundBalance> {
        const existing = await this.getBalance(programmePeriodId);

        if (existing) {
            const result = await pool.query(
                `UPDATE rebate_fund_balance 
                 SET total_contributions = total_contributions + $1,
                     current_balance = current_balance + $1,
                     updated_at = NOW()
                 WHERE programme_period_id = $2
                 RETURNING *`,
                [contributionAmount, programmePeriodId]
            );
            return result.rows[0];
        } else {
            const result = await pool.query(
                `INSERT INTO rebate_fund_balance (
                    programme_period_id,
                    total_contributions,
                    current_balance
                ) VALUES ($1, $2, $3)
                RETURNING *`,
                [programmePeriodId, contributionAmount, contributionAmount]
            );
            return result.rows[0];
        }
    }

    /**
     * Update rebate fund balance with allocation
     */
    static async updateBalanceWithAllocation(
        programmePeriodId: string,
        allocationAmount: number
    ): Promise<IRebateFundBalance | null> {
        const result = await pool.query(
            `UPDATE rebate_fund_balance 
             SET total_allocated = total_allocated + $1,
                 current_balance = current_balance - $1,
                 updated_at = NOW()
             WHERE programme_period_id = $2
             RETURNING *`,
            [allocationAmount, programmePeriodId]
        );
        return result.rows[0] || null;
    }

    /**
     * Update rebate fund balance with credit issuance
     */
    static async updateBalanceWithCredit(
        programmePeriodId: string,
        creditAmount: number
    ): Promise<IRebateFundBalance | null> {
        const result = await pool.query(
            `UPDATE rebate_fund_balance 
             SET total_credited = total_credited + $1,
                 updated_at = NOW()
             WHERE programme_period_id = $2
             RETURNING *`,
            [creditAmount, programmePeriodId]
        );
        return result.rows[0] || null;
    }

    /**
     * Update rebate fund balance with credit usage
     */
    static async updateBalanceWithUsage(
        programmePeriodId: string,
        usageAmount: number
    ): Promise<IRebateFundBalance | null> {
        const result = await pool.query(
            `UPDATE rebate_fund_balance 
             SET total_utilised = total_utilised + $1,
                 updated_at = NOW()
             WHERE programme_period_id = $2
             RETURNING *`,
            [usageAmount, programmePeriodId]
        );
        return result.rows[0] || null;
    }

    /**
     * Update rebate fund balance with expired credits
     */
    static async updateBalanceWithExpiry(
        programmePeriodId: string,
        expiredAmount: number
    ): Promise<IRebateFundBalance | null> {
        const result = await pool.query(
            `UPDATE rebate_fund_balance 
             SET total_expired = total_expired + $1,
                 current_balance = current_balance + $1,
                 updated_at = NOW()
             WHERE programme_period_id = $2
             RETURNING *`,
            [expiredAmount, programmePeriodId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get available balance for distribution
     */
    static async getAvailableBalance(programmePeriodId: string): Promise<number> {
        const balance = await this.getBalance(programmePeriodId);
        if (!balance) {
            return 0;
        }
        return balance.current_balance - balance.reserved_amount;
    }

    /**
     * Reserve funds for distribution
     */
    static async reserveFunds(
        programmePeriodId: string,
        amount: number
    ): Promise<IRebateFundBalance | null> {
        const result = await pool.query(
            `UPDATE rebate_fund_balance 
             SET reserved_amount = reserved_amount + $1,
                 updated_at = NOW()
             WHERE programme_period_id = $2
             RETURNING *`,
            [amount, programmePeriodId]
        );
        return result.rows[0] || null;
    }

    /**
     * Release reserved funds
     */
    static async releaseReservedFunds(
        programmePeriodId: string,
        amount: number
    ): Promise<IRebateFundBalance | null> {
        const result = await pool.query(
            `UPDATE rebate_fund_balance 
             SET reserved_amount = GREATEST(0, reserved_amount - $1),
                 updated_at = NOW()
             WHERE programme_period_id = $2
             RETURNING *`,
            [amount, programmePeriodId]
        );
        return result.rows[0] || null;
    }

    // ============================================
    // REBATE FUND CONTRIBUTIONS
    // ============================================

    /**
     * Record a rebate fund contribution from a ride
     */
    static async recordContribution(
        rideId: string,
        programmePeriodId: string,
        passengerId: string,
        fareAmount: number,
        contributionRate: number = RebateFundModel.DEFAULT_CONTRIBUTION_RATE
    ): Promise<IRebateFundContribution> {
        const contributionAmount = fareAmount * (contributionRate / 100);

        const result = await pool.query(
            `INSERT INTO rebate_fund_contributions (
                ride_id,
                programme_period_id,
                passenger_id,
                contribution_amount,
                fare_amount,
                contribution_percentage
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [
                rideId,
                programmePeriodId,
                passengerId,
                contributionAmount,
                fareAmount,
                contributionRate,
            ]
        );

        // Update fund balance
        await this.upsertBalance(programmePeriodId, contributionAmount);

        logger.debug(`Rebate contribution recorded: ride ${rideId}, amount ${contributionAmount}`);
        return result.rows[0];
    }

    /**
     * Get contributions for a programme period
     */
    static async getContributions(
        programmePeriodId: string,
        page: number = 1,
        limit: number = 100
    ): Promise<{ contributions: IRebateFundContribution[]; total: number }> {
        const offset = (page - 1) * limit;
        const result = await pool.query(
            `SELECT * FROM rebate_fund_contributions 
             WHERE programme_period_id = $1 
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [programmePeriodId, limit, offset]
        );

        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM rebate_fund_contributions 
             WHERE programme_period_id = $1`,
            [programmePeriodId]
        );

        return {
            contributions: result.rows,
            total: parseInt(countResult.rows[0]?.total || '0', 10)
        };
    }

    /**
     * Get contributions by passenger
     */
    static async getContributionsByPassenger(
        passengerId: string,
        programmePeriodId: string
    ): Promise<IRebateFundContribution[]> {
        const result = await pool.query(
            `SELECT * FROM rebate_fund_contributions 
             WHERE passenger_id = $1 AND programme_period_id = $2 
             ORDER BY created_at DESC`,
            [passengerId, programmePeriodId]
        );
        return result.rows;
    }

    /**
     * Get total contributions for a programme period
     */
    static async getTotalContributions(programmePeriodId: string): Promise<number> {
        const result = await pool.query(
            `SELECT COALESCE(SUM(contribution_amount), 0) as total 
             FROM rebate_fund_contributions 
             WHERE programme_period_id = $1`,
            [programmePeriodId]
        );
        return parseFloat(result.rows[0]?.total || '0');
    }

    /**
     * Mark contribution as ineligible (for fraud or reversal)
     */
    static async markContributionIneligible(
        contributionId: string,
        reason: string
    ): Promise<void> {
        // Get contribution details first
        const contribution = await pool.query(
            `SELECT * FROM rebate_fund_contributions WHERE id = $1`,
            [contributionId]
        );

        if (contribution.rows.length === 0) {
            return;
        }

        const { programme_period_id, contribution_amount } = contribution.rows[0];

        // Update contribution
        await pool.query(
            `UPDATE rebate_fund_contributions 
             SET ride_eligible = false,
                 excluded_reason = $1,
                 updated_at = NOW()
             WHERE id = $2`,
            [reason, contributionId]
        );

        // Update fund balance (remove contribution)
        await pool.query(
            `UPDATE rebate_fund_balance 
             SET total_contributions = GREATEST(0, total_contributions - $1),
                 current_balance = GREATEST(0, current_balance - $1),
                 updated_at = NOW()
             WHERE programme_period_id = $2`,
            [contribution_amount, programme_period_id]
        );

        logger.warn(`Rebate contribution marked ineligible: ${contributionId}, reason: ${reason}`);
    }

    // ============================================
    // REBATE ALLOCATIONS
    // ============================================

    /**
     * Create rebate allocations for winners
     */
    static async createAllocations(
        allocations: Array<{
            passengerId: string;
            programmePeriodId: string;
            qualificationRegistryId: string;
            eligibleAnnualSpend: number;
            provisionalAllocation: number;
            individualCapApplied: number;
            finalAllocation: number;
            fundSufficiencyApplied: boolean;
        }>
    ): Promise<IRebateAllocation[]> {
        const results: IRebateAllocation[] = [];

        for (const allocation of allocations) {
            const result = await pool.query(
                `INSERT INTO rebate_allocations (
                    passenger_id,
                    programme_period_id,
                    qualification_registry_id,
                    eligible_annual_spend,
                    provisional_allocation,
                    individual_cap_applied,
                    final_allocation,
                    fund_sufficiency_applied,
                    allocation_status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *`,
                [
                    allocation.passengerId,
                    allocation.programmePeriodId,
                    allocation.qualificationRegistryId,
                    allocation.eligibleAnnualSpend,
                    allocation.provisionalAllocation,
                    allocation.individualCapApplied,
                    allocation.finalAllocation,
                    allocation.fundSufficiencyApplied,
                    'pending',
                ]
            );

            results.push(result.rows[0]);
        }

        // Update fund balance with total allocation
        const totalAllocation = allocations.reduce((sum, a) => sum + a.finalAllocation, 0);
        if (totalAllocation > 0 && allocations.length > 0) {
            await this.updateBalanceWithAllocation(
                allocations[0].programmePeriodId,
                totalAllocation
            );
        }

        logger.info(`Created ${results.length} rebate allocations`);
        return results;
    }

    /**
     * Get allocation by ID
     */
    static async getAllocationById(id: string): Promise<IRebateAllocation | null> {
        const result = await pool.query(
            'SELECT * FROM rebate_allocations WHERE id = $1',
            [id]
        );
        return result.rows[0] || null;
    }

    /**
     * Get allocations by programme period
     */
    static async getAllocationsByPeriod(
        programmePeriodId: string,
        page: number = 1,
        limit: number = 100
    ): Promise<{ allocations: IRebateAllocation[]; total: number }> {
        const offset = (page - 1) * limit;
        const result = await pool.query(
            `SELECT * FROM rebate_allocations 
             WHERE programme_period_id = $1 
             ORDER BY final_allocation DESC
             LIMIT $2 OFFSET $3`,
            [programmePeriodId, limit, offset]
        );

        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM rebate_allocations 
             WHERE programme_period_id = $1`,
            [programmePeriodId]
        );

        return {
            allocations: result.rows,
            total: parseInt(countResult.rows[0]?.total || '0', 10)
        };
    }

    /**
     * Get allocations by passenger
     */
    static async getAllocationsByPassenger(
        passengerId: string,
        programmePeriodId: string
    ): Promise<IRebateAllocation[]> {
        const result = await pool.query(
            `SELECT * FROM rebate_allocations 
             WHERE passenger_id = $1 AND programme_period_id = $2`,
            [passengerId, programmePeriodId]
        );
        return result.rows;
    }

    /**
     * Update allocation status
     */
    static async updateAllocationStatus(
        allocationId: string,
        status: 'pending' | 'approved' | 'distributed' | 'expired'
    ): Promise<IRebateAllocation | null> {
        const updates: string[] = [`allocation_status = $1`, `updated_at = NOW()`];
        const params: any[] = [status];

        if (status === 'approved') {
            updates.push(`approved_at = NOW()`);
        } else if (status === 'distributed') {
            updates.push(`distributed_at = NOW()`);
        }

        params.push(allocationId);

        const result = await pool.query(
            `UPDATE rebate_allocations 
             SET ${updates.join(', ')} 
             WHERE id = $${params.length}
             RETURNING *`,
            params
        );
        return result.rows[0] || null;
    }

    /**
     * Approve allocations
     */
    static async approveAllocations(allocationIds: string[]): Promise<number> {
        const result = await pool.query(
            `UPDATE rebate_allocations 
             SET allocation_status = 'approved',
                 approved_at = NOW(),
                 updated_at = NOW()
             WHERE id = ANY($1) AND allocation_status = 'pending'
             RETURNING id`,
            [allocationIds]
        );
        logger.info(`Approved ${result.rowCount} rebate allocations`);
        return result.rowCount || 0;
    }

    // ============================================
    // REBATE CREDITS
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
        // Calculate expiry date (default 90 days)
        const expiryDate = expiresAt || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

        const result = await pool.query(
            `INSERT INTO rebate_credits (
                passenger_id,
                allocation_id,
                credit_amount,
                remaining_amount,
                expires_at,
                status
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [passengerId, allocationId, amount, amount, expiryDate, 'active']
        );

        // Update allocation status to distributed
        await this.updateAllocationStatus(allocationId, 'distributed');

        // Update fund balance
        const allocation = await this.getAllocationById(allocationId);
        if (allocation) {
            await this.updateBalanceWithCredit(allocation.programme_period_id, amount);
        }

        logger.info(`Rebate credit issued: ${amount} to passenger ${passengerId}`);
        return result.rows[0];
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
        const offset = (page - 1) * limit;
        let query = `SELECT * FROM rebate_credits WHERE passenger_id = $1`;
        const params: any[] = [passengerId];

        if (status) {
            query += ` AND status = $2`;
            params.push(status);
        }

        query += ` ORDER BY expires_at ASC, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);

        // Count query
        let countQuery = `SELECT COUNT(*) as total FROM rebate_credits WHERE passenger_id = $1`;
        const countParams: any[] = [passengerId];

        if (status) {
            countQuery += ` AND status = $2`;
            countParams.push(status);
        }

        const countResult = await pool.query(countQuery, countParams);

        return {
            credits: result.rows,
            total: parseInt(countResult.rows[0]?.total || '0', 10)
        };
    }

    /**
     * Get credit by ID
     */
    static async getCreditById(id: string): Promise<IRebateCredit | null> {
        const result = await pool.query(
            'SELECT * FROM rebate_credits WHERE id = $1',
            [id]
        );
        return result.rows[0] || null;
    }

    /**
     * Get available credit balance for a passenger
     */
    static async getAvailableCreditBalance(passengerId: string): Promise<number> {
        const result = await pool.query(
            `SELECT COALESCE(SUM(remaining_amount), 0) as total 
             FROM rebate_credits 
             WHERE passenger_id = $1 
               AND status = 'active' 
               AND expires_at > NOW()`,
            [passengerId]
        );
        return parseFloat(result.rows[0]?.total || '0');
    }

    /**
     * Use a rebate credit for a ride
     */
    static async useCredit(
        creditId: string,
        rideId: string,
        passengerId: string,
        amountToUse: number,
        fareAmount: number
    ): Promise<IRebateCreditUsage> {
        const credit = await this.getCreditById(creditId);
        if (!credit) {
            throw new Error('Credit not found');
        }

        if (credit.status !== 'active') {
            throw new Error('Credit is not active');
        }

        if (credit.expires_at && new Date(credit.expires_at) < new Date()) {
            throw new Error('Credit has expired');
        }

        if (credit.remaining_amount < amountToUse) {
            throw new Error('Insufficient credit balance');
        }

        // Start transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Update credit
            const newRemaining = credit.remaining_amount - amountToUse;
            const newStatus = newRemaining === 0 ? 'used' : 'active';

            const creditResult = await client.query(
                `UPDATE rebate_credits 
                 SET used_amount = used_amount + $1,
                     remaining_amount = $2,
                     status = $3,
                     updated_at = NOW()
                 WHERE id = $4
                 RETURNING *`,
                [amountToUse, newRemaining, newStatus, creditId]
            );

            // Check that the update succeeded
            if (creditResult.rows.length === 0) {
                throw new Error('Failed to update credit');
            }

            // Record usage
            const usageResult = await client.query(
                `INSERT INTO rebate_credit_usage (
                    credit_id,
                    ride_id,
                    passenger_id,
                    amount_used,
                    fare_amount
                ) VALUES ($1, $2, $3, $4, $5)
                RETURNING *`,
                [creditId, rideId, passengerId, amountToUse, fareAmount]
            );

            // Update fund balance
            await client.query(
                `UPDATE rebate_fund_balance 
                 SET total_utilised = total_utilised + $1,
                     updated_at = NOW()
                 WHERE programme_period_id = (
                     SELECT programme_period_id FROM rebate_allocations WHERE id = $2
                 )`,
                [amountToUse, credit.allocation_id]
            );

            await client.query('COMMIT');

            logger.info(`Rebate credit used: ${amountToUse} from credit ${creditId} on ride ${rideId}`);
            return usageResult.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Expire credits that have passed expiry date
     */
    static async expireCredits(): Promise<number> {
        // Use a single query to get expired credits and update them
        const result = await pool.query(
            `UPDATE rebate_credits 
             SET status = 'expired',
                 updated_at = NOW()
             WHERE status = 'active' 
               AND expires_at < NOW()
             RETURNING id, passenger_id, remaining_amount`
        );

        const expiredCredits = result.rows;

        // Update fund balance for each expired credit
        for (const credit of expiredCredits) {
            // Get allocation to find programme period
            const allocation = await pool.query(
                `SELECT programme_period_id FROM rebate_allocations 
                 WHERE id = (SELECT allocation_id FROM rebate_credits WHERE id = $1)`,
                [credit.id]
            );

            if (allocation.rows.length > 0) {
                await this.updateBalanceWithExpiry(
                    allocation.rows[0].programme_period_id,
                    parseFloat(credit.remaining_amount)
                );
            }
        }

        if (expiredCredits.length > 0) {
            logger.info(`Expired ${expiredCredits.length} rebate credits`);
        }

        return expiredCredits.length;
    }

    /**
     * Cancel a credit (for fraud or manual adjustment)
     */
    static async cancelCredit(creditId: string, reason: string): Promise<IRebateCredit | null> {
        const credit = await this.getCreditById(creditId);
        if (!credit) {
            return null;
        }

        const result = await pool.query(
            `UPDATE rebate_credits 
             SET status = 'cancelled',
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [creditId]
        );

        logger.warn(`Rebate credit cancelled: ${creditId}, reason: ${reason}`);
        return result.rows[0] || null;
    }

    // ============================================
    // REBATE CREDIT USAGE
    // ============================================

    /**
     * Get credit usage by ride
     */
    static async getUsageByRide(rideId: string): Promise<IRebateCreditUsage[]> {
        const result = await pool.query(
            'SELECT * FROM rebate_credit_usage WHERE ride_id = $1',
            [rideId]
        );
        return result.rows;
    }

    /**
     * Get credit usage by credit
     */
    static async getUsageByCredit(creditId: string): Promise<IRebateCreditUsage[]> {
        const result = await pool.query(
            'SELECT * FROM rebate_credit_usage WHERE credit_id = $1 ORDER BY created_at DESC',
            [creditId]
        );
        return result.rows;
    }

    /**
     * Get total credit usage by passenger
     */
    static async getTotalUsageByPassenger(passengerId: string): Promise<number> {
        const result = await pool.query(
            `SELECT COALESCE(SUM(amount_used), 0) as total 
             FROM rebate_credit_usage 
             WHERE passenger_id = $1`,
            [passengerId]
        );
        return parseFloat(result.rows[0]?.total || '0');
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    /**
     * Calculate proportional allocation when fund is insufficient
     */
    static calculateProportionalAllocation(
        allocations: Array<{ passengerId: string; provisionalAllocation: number }>,
        availableFund: number
    ): Array<{ passengerId: string; provisionalAllocation: number; finalAllocation: number; scaleFactor: number }> {
        const totalRequired = allocations.reduce((sum, a) => sum + a.provisionalAllocation, 0);

        if (totalRequired === 0) {
            return allocations.map((a) => ({
                ...a,
                finalAllocation: 0,
                scaleFactor: 0,
            }));
        }

        const scaleFactor = availableFund / totalRequired;

        // Cap scale factor at 1.0 (no scaling up)
        const finalScaleFactor = Math.min(scaleFactor, 1.0);

        return allocations.map((a) => ({
            ...a,
            finalAllocation: Math.round(a.provisionalAllocation * finalScaleFactor * 100) / 100,
            scaleFactor: finalScaleFactor,
        }));
    }

    /**
     * Check if fund is sufficient for allocations
     */
    static async checkFundSufficiency(
        programmePeriodId: string,
        totalRequired: number
    ): Promise<{ sufficient: boolean; available: number; shortfall: number }> {
        const available = await this.getAvailableBalance(programmePeriodId);

        return {
            sufficient: available >= totalRequired,
            available,
            shortfall: Math.max(0, totalRequired - available),
        };
    }

    /**
     * Get rebate fund summary for a programme period
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
        const balance = await this.getBalance(programmePeriodId);

        // Get counts
        const contributionCount = await pool.query(
            'SELECT COUNT(*) as count FROM rebate_fund_contributions WHERE programme_period_id = $1',
            [programmePeriodId]
        );

        const allocationCount = await pool.query(
            'SELECT COUNT(*) as count FROM rebate_allocations WHERE programme_period_id = $1',
            [programmePeriodId]
        );

        const creditCount = await pool.query(
            'SELECT COUNT(*) as count FROM rebate_credits WHERE allocation_id IN (SELECT id FROM rebate_allocations WHERE programme_period_id = $1)',
            [programmePeriodId]
        );

        return {
            balance: balance || null,
            totalContributions: balance?.total_contributions || 0,
            totalAllocations: balance?.total_allocated || 0,
            totalCredited: balance?.total_credited || 0,
            totalUtilised: balance?.total_utilised || 0,
            totalExpired: balance?.total_expired || 0,
            currentBalance: balance?.current_balance || 0,
            availableBalance: (balance?.current_balance || 0) - (balance?.reserved_amount || 0),
            contributionCount: parseInt(contributionCount.rows[0]?.count || '0', 10),
            allocationCount: parseInt(allocationCount.rows[0]?.count || '0', 10),
            creditCount: parseInt(creditCount.rows[0]?.count || '0', 10),
        };
    }
}

export default RebateFundModel;