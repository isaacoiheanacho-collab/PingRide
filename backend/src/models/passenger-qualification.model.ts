import pool from '../config/database';
import { IPassengerQualification, QualificationStatus } from '../types';
import logger from '../utils/logger';

export class PassengerQualificationModel {
    private static readonly DEFAULT_THRESHOLD = 500000; // ₦500,000

    /**
     * Get passenger qualification record by passenger ID and programme period ID
     */
    static async getByPassenger(
        passengerId: string,
        programmePeriodId: string
    ): Promise<IPassengerQualification | null> {
        const result = await pool.query(
            `SELECT * FROM passenger_qualification_registry 
             WHERE passenger_id = $1 AND programme_period_id = $2`,
            [passengerId, programmePeriodId]
        );
        return result.rows[0] || null;
    }

    /**
     * Get passenger qualification by ID
     */
    static async getById(id: string): Promise<IPassengerQualification | null> {
        const result = await pool.query(
            'SELECT * FROM passenger_qualification_registry WHERE id = $1',
            [id]
        );
        return result.rows[0] || null;
    }

    /**
     * Get all passenger qualifications for a programme period
     */
    static async getByProgrammePeriod(
        programmePeriodId: string,
        page: number = 1,
        limit: number = 100
    ): Promise<{ qualifications: IPassengerQualification[]; total: number }> {
        const offset = (page - 1) * limit;
        const result = await pool.query(
            `SELECT * FROM passenger_qualification_registry 
             WHERE programme_period_id = $1 
             ORDER BY eligible_annual_spend DESC
             LIMIT $2 OFFSET $3`,
            [programmePeriodId, limit, offset]
        );

        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM passenger_qualification_registry 
             WHERE programme_period_id = $1`,
            [programmePeriodId]
        );

        return {
            qualifications: result.rows,
            total: parseInt(countResult.rows[0]?.total || '0', 10)
        };
    }

    /**
     * Get qualified passengers for a programme period
     */
    static async getQualifiedPassengers(programmePeriodId: string): Promise<IPassengerQualification[]> {
        const result = await pool.query(
            `SELECT * FROM passenger_qualification_registry 
             WHERE programme_period_id = $1 
               AND qualification_status = 'qualified'
               AND (fraud_review_status IS NULL OR fraud_review_status != 'excluded')
             ORDER BY eligible_annual_spend DESC`,
            [programmePeriodId]
        );
        return result.rows;
    }

    /**
     * Get qualified passenger count for a programme period
     */
    static async getQualifiedCount(programmePeriodId: string): Promise<number> {
        const result = await pool.query(
            `SELECT COUNT(*) as count FROM passenger_qualification_registry 
             WHERE programme_period_id = $1 
               AND qualification_status = 'qualified'
               AND (fraud_review_status IS NULL OR fraud_review_status != 'excluded')`,
            [programmePeriodId]
        );
        return parseInt(result.rows[0]?.count || '0', 10);
    }

    /**
     * Get passenger qualification with full passenger details
     * ✅ FIXED: Added p.user_id and u.id as users_id
     */
    static async getWithPassengerDetails(passengerId: string, programmePeriodId: string): Promise<any> {
        const result = await pool.query(
            `SELECT 
                q.*,
                p.first_name,
                p.last_name,
                p.total_rides,
                p.lifetime_spend,
                p.user_id,           -- ✅ Added: passenger_profiles.user_id (references users.id)
                u.phone_number,
                u.email,
                u.id as users_id     -- ✅ Added: actual users.id
             FROM passenger_qualification_registry q
             JOIN passenger_profiles p ON q.passenger_id = p.id
             JOIN users u ON p.user_id = u.id
             WHERE q.passenger_id = $1 AND q.programme_period_id = $2`,
            [passengerId, programmePeriodId]
        );
        return result.rows[0] || null;
    }

    /**
     * Create or update passenger qualification record
     * Adds the spend amount to the existing total
     */
    static async createOrUpdate(
        passengerId: string,
        programmePeriodId: string,
        spendAmount: number
    ): Promise<IPassengerQualification> {
        const existing = await this.getByPassenger(passengerId, programmePeriodId);

        if (existing) {
            // Update existing record
            const newSpend = existing.eligible_annual_spend + spendAmount;
            const threshold = await this.getThreshold(programmePeriodId);
            const isQualified = newSpend >= threshold;

            const result = await pool.query(
                `UPDATE passenger_qualification_registry 
                 SET eligible_annual_spend = $1,
                     qualification_status = $2,
                     qualification_date = CASE 
                       WHEN $2 = 'qualified' AND qualification_date IS NULL THEN NOW() 
                       ELSE qualification_date 
                     END,
                     last_progress_update = NOW(),
                     updated_at = NOW()
                 WHERE id = $3
                 RETURNING *`,
                [newSpend, isQualified ? 'qualified' : 'in_progress', existing.id]
            );

            logger.debug(`Updated passenger qualification: ${passengerId}, spend: ${newSpend}`);
            return result.rows[0];
        } else {
            // Create new record
            const threshold = await this.getThreshold(programmePeriodId);
            const isQualified = spendAmount >= threshold;
            const initialStatus = spendAmount > 0 ? (isQualified ? 'qualified' : 'in_progress') : 'not_started';

            const result = await pool.query(
                `INSERT INTO passenger_qualification_registry (
                    passenger_id,
                    programme_period_id,
                    eligible_annual_spend,
                    qualification_status,
                    qualification_date,
                    last_progress_update
                ) VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'qualified' THEN NOW() ELSE NULL END, NOW())
                RETURNING *`,
                [passengerId, programmePeriodId, spendAmount, initialStatus]
            );

            logger.info(`Created passenger qualification: ${passengerId} in period ${programmePeriodId}`);
            return result.rows[0];
        }
    }

    /**
     * Mark passenger as qualified (force qualification)
     */
    static async markQualified(
        passengerId: string,
        programmePeriodId: string,
        spendAmount?: number
    ): Promise<IPassengerQualification | null> {
        const existing = await this.getByPassenger(passengerId, programmePeriodId);
        const threshold = await this.getThreshold(programmePeriodId);
        const finalSpend = spendAmount ?? existing?.eligible_annual_spend ?? threshold;

        if (existing) {
            const result = await pool.query(
                `UPDATE passenger_qualification_registry 
                 SET eligible_annual_spend = GREATEST($1, eligible_annual_spend),
                     qualification_status = 'qualified',
                     qualification_date = COALESCE(qualification_date, NOW()),
                     last_progress_update = NOW(),
                     updated_at = NOW()
                 WHERE id = $2
                 RETURNING *`,
                [finalSpend, existing.id]
            );
            return result.rows[0] || null;
        } else {
            const result = await pool.query(
                `INSERT INTO passenger_qualification_registry (
                    passenger_id,
                    programme_period_id,
                    eligible_annual_spend,
                    qualification_status,
                    qualification_date,
                    last_progress_update
                ) VALUES ($1, $2, $3, 'qualified', NOW(), NOW())
                RETURNING *`,
                [passengerId, programmePeriodId, finalSpend]
            );
            return result.rows[0];
        }
    }

    /**
     * Exclude passenger from qualification
     */
    static async exclude(
        passengerId: string,
        programmePeriodId: string,
        reason: string
    ): Promise<void> {
        await pool.query(
            `UPDATE passenger_qualification_registry 
             SET qualification_status = 'excluded',
                 fraud_review_status = 'excluded',
                 fraud_review_notes = $1,
                 updated_at = NOW()
             WHERE passenger_id = $2 AND programme_period_id = $3`,
            [reason, passengerId, programmePeriodId]
        );
        logger.warn(`Passenger excluded from qualification: ${passengerId}, reason: ${reason}`);
    }

    /**
     * Reverse qualification (for fraud or correction)
     */
    static async reverseQualification(
        passengerId: string,
        programmePeriodId: string,
        reason: string
    ): Promise<void> {
        const existing = await this.getByPassenger(passengerId, programmePeriodId);
        if (!existing) {
            return;
        }

        // If currently qualified, reverse to in_progress
        // If currently in_progress, reverse to not_started
        let newStatus: QualificationStatus = 'in_progress';
        if (existing.qualification_status === 'not_started') {
            newStatus = 'not_started';
        }

        await pool.query(
            `UPDATE passenger_qualification_registry 
             SET qualification_status = $1,
                 qualification_date = NULL,
                 fraud_review_status = 'under_review',
                 fraud_review_notes = $2,
                 winner_selected = false,
                 rebate_allocated = 0,
                 rebate_credited = false,
                 updated_at = NOW()
             WHERE passenger_id = $3 AND programme_period_id = $4
             RETURNING *`,
            [newStatus, reason, passengerId, programmePeriodId]
        );
        logger.warn(`Passenger qualification reversed: ${passengerId}, reason: ${reason}`);
    }

    /**
     * Update passenger rank position (for winner selection)
     */
    static async updateRank(programmePeriodId: string): Promise<void> {
        await pool.query(
            `WITH ranked AS (
                SELECT 
                    id, 
                    ROW_NUMBER() OVER (ORDER BY eligible_annual_spend DESC) as rank
                FROM passenger_qualification_registry
                WHERE programme_period_id = $1 
                    AND qualification_status = 'qualified'
                    AND (fraud_review_status IS NULL OR fraud_review_status != 'excluded')
            )
            UPDATE passenger_qualification_registry 
            SET rank_position = ranked.rank,
                updated_at = NOW()
            FROM ranked
            WHERE passenger_qualification_registry.id = ranked.id`,
            [programmePeriodId]
        );
        logger.debug(`Updated ranks for passenger qualifications in period ${programmePeriodId}`);
    }

    /**
     * Mark passenger as winner selected
     */
    static async markWinnerSelected(
        passengerId: string,
        programmePeriodId: string,
        rebateAmount: number
    ): Promise<void> {
        await pool.query(
            `UPDATE passenger_qualification_registry 
             SET winner_selected = true,
                 rebate_allocated = $1,
                 updated_at = NOW()
             WHERE passenger_id = $2 AND programme_period_id = $3`,
            [rebateAmount, passengerId, programmePeriodId]
        );
        logger.info(`Passenger marked as winner: ${passengerId}, rebate: ${rebateAmount}`);
    }

    /**
     * Mark passenger rebate as credited
     */
    static async markRebateCredited(
        passengerId: string,
        programmePeriodId: string
    ): Promise<void> {
        await pool.query(
            `UPDATE passenger_qualification_registry 
             SET rebate_credited = true,
                 updated_at = NOW()
             WHERE passenger_id = $1 AND programme_period_id = $2`,
            [passengerId, programmePeriodId]
        );
        logger.info(`Passenger rebate credited: ${passengerId}`);
    }

    /**
     * Reset passenger rebate credit status
     */
    static async resetRebateCredit(
        passengerId: string,
        programmePeriodId: string
    ): Promise<void> {
        await pool.query(
            `UPDATE passenger_qualification_registry 
             SET rebate_credited = false,
                 updated_at = NOW()
             WHERE passenger_id = $1 AND programme_period_id = $2`,
            [passengerId, programmePeriodId]
        );
    }

    /**
     * Check if passenger is qualified
     */
    static async isQualified(passengerId: string, programmePeriodId: string): Promise<boolean> {
        const result = await pool.query(
            `SELECT 1 FROM passenger_qualification_registry 
             WHERE passenger_id = $1 
               AND programme_period_id = $2 
               AND qualification_status = 'qualified'
               AND (fraud_review_status IS NULL OR fraud_review_status != 'excluded')
             LIMIT 1`,
            [passengerId, programmePeriodId]
        );
        return (result.rowCount ?? 0) > 0;
    }

    /**
     * Get total eligible spend for a passenger across all programme periods
     */
    static async getTotalEligibleSpend(passengerId: string): Promise<number> {
        const result = await pool.query(
            `SELECT COALESCE(SUM(eligible_annual_spend), 0) as total 
             FROM passenger_qualification_registry 
             WHERE passenger_id = $1 
               AND qualification_status != 'excluded'`,
            [passengerId]
        );
        return parseFloat(result.rows[0]?.total || '0');
    }

    /**
     * Get all excluded passengers for a programme period
     */
    static async getExcludedPassengers(programmePeriodId: string): Promise<IPassengerQualification[]> {
        const result = await pool.query(
            `SELECT * FROM passenger_qualification_registry 
             WHERE programme_period_id = $1 
               AND fraud_review_status = 'excluded'
             ORDER BY created_at DESC`,
            [programmePeriodId]
        );
        return result.rows;
    }

    /**
     * Get the threshold for a programme period
     * Falls back to default if period not found
     */
    private static async getThreshold(programmePeriodId: string): Promise<number> {
        const result = await pool.query(
            'SELECT passenger_threshold FROM programme_periods WHERE id = $1',
            [programmePeriodId]
        );
        return parseFloat(result.rows[0]?.passenger_threshold || String(this.DEFAULT_THRESHOLD));
    }
}

export default PassengerQualificationModel;