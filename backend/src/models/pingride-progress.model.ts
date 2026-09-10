import pool from '../config/database';
import {
  IPINGRIDEProgress,
  IPINGRIDELetter,
  IPassengerPINGRIDEProgress,
  IDriverPINGRIDEProgress,
} from '../types';
import logger from '../utils/logger';

// PINGRIDE letter configuration
export const PINGRIDE_LETTERS: Omit<IPINGRIDELetter, 'isCompleted' | 'achievedAt'>[] = [
  { position: 1, char: 'P', thresholdMin: 0, thresholdMax: 12.5 },
  { position: 2, char: 'I', thresholdMin: 12.5, thresholdMax: 25 },
  { position: 3, char: 'N', thresholdMin: 25, thresholdMax: 37.5 },
  { position: 4, char: 'G', thresholdMin: 37.5, thresholdMax: 50 },
  { position: 5, char: 'R', thresholdMin: 50, thresholdMax: 62.5 },
  { position: 6, char: 'I', thresholdMin: 62.5, thresholdMax: 75 },
  { position: 7, char: 'D', thresholdMin: 75, thresholdMax: 87.5 },
  { position: 8, char: 'E', thresholdMin: 87.5, thresholdMax: 100 },
];

// Default thresholds (overridden by programme_periods table)
export const DEFAULT_PASSENGER_THRESHOLD = 500000;
export const DEFAULT_DRIVER_THRESHOLD = 15000000;

export class PINGRIDEProgressModel {
  /**
   * Calculate PINGRIDE progress based on current value and threshold
   */
  static calculateProgress(
    userId: string,
    userType: 'passenger' | 'driver',
    programmePeriodId: string,
    currentValue: number,
    threshold: number
  ): IPINGRIDEProgress {
    const progressPercentage = threshold > 0 ? Math.min((currentValue / threshold) * 100, 100) : 0;
    const isComplete = progressPercentage >= 100;

    const letters: IPINGRIDELetter[] = PINGRIDE_LETTERS.map((letter) => ({
      ...letter,
      isCompleted: progressPercentage >= letter.thresholdMax,
      achievedAt: undefined,
    }));

    const nextMilestone = letters.find((l) => !l.isCompleted) ?? null;

    return {
      userId,
      userType,
      programmePeriodId,
      letters,
      overallProgress: progressPercentage,
      threshold,
      currentValue,
      isComplete,
      completedAt: isComplete ? new Date() : undefined,
      nextMilestone,
    };
  }

  /**
   * Calculate passenger PINGRIDE progress
   */
  static calculatePassengerProgress(
    passengerId: string,
    programmePeriodId: string,
    currentSpend: number
  ): IPINGRIDEProgress {
    return this.calculateProgress(
      passengerId,
      'passenger',
      programmePeriodId,
      currentSpend,
      DEFAULT_PASSENGER_THRESHOLD
    );
  }

  /**
   * Calculate driver PINGRIDE progress
   */
  static calculateDriverProgress(
    driverId: string,
    programmePeriodId: string,
    currentContribution: number
  ): IPINGRIDEProgress {
    return this.calculateProgress(
      driverId,
      'driver',
      programmePeriodId,
      currentContribution,
      DEFAULT_DRIVER_THRESHOLD
    );
  }

  /**
   * Get threshold from programme period
   */
  private static async getThreshold(programmePeriodId: string, userType: 'passenger' | 'driver'): Promise<number> {
    const result = await pool.query(
      `SELECT ${userType === 'passenger' ? 'passenger_threshold' : 'driver_threshold'} 
       FROM programme_periods WHERE id = $1`,
      [programmePeriodId]
    );
    return parseFloat(result.rows[0]?.[userType === 'passenger' ? 'passenger_threshold' : 'driver_threshold'] || '0');
  }

  /**
   * Get passenger PINGRIDE progress from database
   */
  static async getPassengerProgress(
    passengerId: string,
    programmePeriodId: string
  ): Promise<IPINGRIDEProgress | null> {
    const result = await pool.query(
      `SELECT * FROM passenger_qualification_progress 
       WHERE passenger_id = $1 AND programme_period_id = $2
       ORDER BY letter_position`,
      [passengerId, programmePeriodId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const registryResult = await pool.query(
      `SELECT eligible_annual_spend FROM passenger_qualification_registry 
       WHERE passenger_id = $1 AND programme_period_id = $2`,
      [passengerId, programmePeriodId]
    );

    const currentSpend = parseFloat(registryResult.rows[0]?.eligible_annual_spend || '0');
    const threshold = await this.getThreshold(programmePeriodId, 'passenger') || DEFAULT_PASSENGER_THRESHOLD;
    const progress = this.calculateProgress(passengerId, 'passenger', programmePeriodId, currentSpend, threshold);

    const dbLetters = result.rows;
    const mergedLetters: IPINGRIDELetter[] = progress.letters.map((letter) => {
      const dbLetter = dbLetters.find((l) => l.letter_position === letter.position);
      return {
        ...letter,
        achievedAt: dbLetter?.achieved_at || undefined,
      };
    });

    const nextMilestone = mergedLetters.find((l) => !l.isCompleted) ?? null;

    return {
      ...progress,
      letters: mergedLetters,
      nextMilestone,
    };
  }

  /**
   * Get driver PINGRIDE progress from database
   */
  static async getDriverProgress(
    driverId: string,
    programmePeriodId: string
  ): Promise<IPINGRIDEProgress | null> {
    const result = await pool.query(
      `SELECT * FROM driver_qualification_progress 
       WHERE driver_id = $1 AND programme_period_id = $2
       ORDER BY letter_position`,
      [driverId, programmePeriodId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const registryResult = await pool.query(
      `SELECT qualifying_contribution FROM driver_qualification_registry 
       WHERE driver_id = $1 AND programme_period_id = $2`,
      [driverId, programmePeriodId]
    );

    const currentContribution = parseFloat(registryResult.rows[0]?.qualifying_contribution || '0');
    const threshold = await this.getThreshold(programmePeriodId, 'driver') || DEFAULT_DRIVER_THRESHOLD;
    const progress = this.calculateProgress(driverId, 'driver', programmePeriodId, currentContribution, threshold);

    const dbLetters = result.rows;
    const mergedLetters: IPINGRIDELetter[] = progress.letters.map((letter) => {
      const dbLetter = dbLetters.find((l) => l.letter_position === letter.position);
      return {
        ...letter,
        achievedAt: dbLetter?.achieved_at || undefined,
      };
    });

    const nextMilestone = mergedLetters.find((l) => !l.isCompleted) ?? null;

    return {
      ...progress,
      letters: mergedLetters,
      nextMilestone,
    };
  }

  /**
   * Upsert passenger PINGRIDE progress
   */
  static async upsertPassengerProgress(
    passengerId: string,
    programmePeriodId: string,
    currentSpend: number
  ): Promise<void> {
    const threshold = await this.getThreshold(programmePeriodId, 'passenger') || DEFAULT_PASSENGER_THRESHOLD;
    const progress = this.calculatePassengerProgress(passengerId, programmePeriodId, currentSpend);
    progress.threshold = threshold;
    progress.overallProgress = threshold > 0 ? Math.min((currentSpend / threshold) * 100, 100) : 0;
    progress.isComplete = progress.overallProgress >= 100;
    progress.letters = PINGRIDE_LETTERS.map((letter) => ({
      ...letter,
      isCompleted: progress.overallProgress >= letter.thresholdMax,
      achievedAt: undefined,
    }));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const letter of progress.letters) {
        const isCompleted = letter.isCompleted;

        await client.query(
          `INSERT INTO passenger_qualification_progress (
            passenger_id,
            programme_period_id,
            letter_position,
            letter_char,
            is_completed,
            progress_percentage,
            cumulative_spend_at_milestone,
            achieved_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5 THEN NOW() ELSE NULL END)
          ON CONFLICT (passenger_id, programme_period_id, letter_position)
          DO UPDATE SET
            is_completed = EXCLUDED.is_completed,
            progress_percentage = EXCLUDED.progress_percentage,
            cumulative_spend_at_milestone = EXCLUDED.cumulative_spend_at_milestone,
            achieved_at = CASE 
              WHEN EXCLUDED.is_completed AND NOT passenger_qualification_progress.is_completed 
              THEN NOW() 
              ELSE passenger_qualification_progress.achieved_at 
            END,
            updated_at = NOW()`,
          [
            passengerId,
            programmePeriodId,
            letter.position,
            letter.char,
            isCompleted,
            progress.overallProgress,
            currentSpend,
          ]
        );
      }

      await client.query('COMMIT');
      logger.debug(`Upserted passenger PINGRIDE progress for ${passengerId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error upserting passenger PINGRIDE progress:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Upsert driver PINGRIDE progress
   */
  static async upsertDriverProgress(
    driverId: string,
    programmePeriodId: string,
    currentContribution: number
  ): Promise<void> {
    const threshold = await this.getThreshold(programmePeriodId, 'driver') || DEFAULT_DRIVER_THRESHOLD;
    const progress = this.calculateDriverProgress(driverId, programmePeriodId, currentContribution);
    progress.threshold = threshold;
    progress.overallProgress = threshold > 0 ? Math.min((currentContribution / threshold) * 100, 100) : 0;
    progress.isComplete = progress.overallProgress >= 100;
    progress.letters = PINGRIDE_LETTERS.map((letter) => ({
      ...letter,
      isCompleted: progress.overallProgress >= letter.thresholdMax,
      achievedAt: undefined,
    }));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const letter of progress.letters) {
        const isCompleted = letter.isCompleted;

        await client.query(
          `INSERT INTO driver_qualification_progress (
            driver_id,
            programme_period_id,
            letter_position,
            letter_char,
            is_completed,
            progress_percentage,
            cumulative_contribution_at_milestone,
            achieved_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5 THEN NOW() ELSE NULL END)
          ON CONFLICT (driver_id, programme_period_id, letter_position)
          DO UPDATE SET
            is_completed = EXCLUDED.is_completed,
            progress_percentage = EXCLUDED.progress_percentage,
            cumulative_contribution_at_milestone = EXCLUDED.cumulative_contribution_at_milestone,
            achieved_at = CASE 
              WHEN EXCLUDED.is_completed AND NOT driver_qualification_progress.is_completed 
              THEN NOW() 
              ELSE driver_qualification_progress.achieved_at 
            END,
            updated_at = NOW()`,
          [
            driverId,
            programmePeriodId,
            letter.position,
            letter.char,
            isCompleted,
            progress.overallProgress,
            currentContribution,
          ]
        );
      }

      await client.query('COMMIT');
      logger.debug(`Upserted driver PINGRIDE progress for ${driverId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error upserting driver PINGRIDE progress:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get the next letter milestone for a passenger
   */
  static async getPassengerNextMilestone(
    passengerId: string,
    programmePeriodId: string
  ): Promise<IPINGRIDELetter | null> {
    const progress = await this.getPassengerProgress(passengerId, programmePeriodId);
    if (!progress) {
      return null;
    }

    return progress.nextMilestone ?? null;
  }

  /**
   * Get the next letter milestone for a driver
   */
  static async getDriverNextMilestone(
    driverId: string,
    programmePeriodId: string
  ): Promise<IPINGRIDELetter | null> {
    const progress = await this.getDriverProgress(driverId, programmePeriodId);
    if (!progress) {
      return null;
    }

    return progress.nextMilestone ?? null;
  }

  /**
   * Get the completed letter count for a passenger
   */
  static async getPassengerCompletedLetterCount(
    passengerId: string,
    programmePeriodId: string
  ): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM passenger_qualification_progress 
       WHERE passenger_id = $1 
         AND programme_period_id = $2 
         AND is_completed = true`,
      [passengerId, programmePeriodId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Get the completed letter count for a driver
   */
  static async getDriverCompletedLetterCount(
    driverId: string,
    programmePeriodId: string
  ): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM driver_qualification_progress 
       WHERE driver_id = $1 
         AND programme_period_id = $2 
         AND is_completed = true`,
      [driverId, programmePeriodId]
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Reset passenger PINGRIDE progress
   */
  static async resetPassengerProgress(
    passengerId: string,
    programmePeriodId: string
  ): Promise<void> {
    await pool.query(
      `UPDATE passenger_qualification_progress 
       SET is_completed = false,
           achieved_at = NULL,
           updated_at = NOW()
       WHERE passenger_id = $1 AND programme_period_id = $2`,
      [passengerId, programmePeriodId]
    );
    logger.warn(`Reset passenger PINGRIDE progress: ${passengerId}`);
  }

  /**
   * Reset driver PINGRIDE progress
   */
  static async resetDriverProgress(
    driverId: string,
    programmePeriodId: string
  ): Promise<void> {
    await pool.query(
      `UPDATE driver_qualification_progress 
       SET is_completed = false,
           achieved_at = NULL,
           updated_at = NOW()
       WHERE driver_id = $1 AND programme_period_id = $2`,
      [driverId, programmePeriodId]
    );
    logger.warn(`Reset driver PINGRIDE progress: ${driverId}`);
  }

  /**
   * Get all passenger PINGRIDE progress for a programme period (admin)
   */
  static async getAllPassengerProgress(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ progress: IPassengerPINGRIDEProgress[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM passenger_qualification_progress 
       WHERE programme_period_id = $1 
       ORDER BY passenger_id, letter_position
       LIMIT $2 OFFSET $3`,
      [programmePeriodId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM passenger_qualification_progress 
       WHERE programme_period_id = $1`,
      [programmePeriodId]
    );

    return {
      progress: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Get all driver PINGRIDE progress for a programme period (admin)
   */
  static async getAllDriverProgress(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ progress: IDriverPINGRIDEProgress[]; total: number }> {
    const offset = (page - 1) * limit;
    const result = await pool.query(
      `SELECT * FROM driver_qualification_progress 
       WHERE programme_period_id = $1 
       ORDER BY driver_id, letter_position
       LIMIT $2 OFFSET $3`,
      [programmePeriodId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM driver_qualification_progress 
       WHERE programme_period_id = $1`,
      [programmePeriodId]
    );

    return {
      progress: result.rows,
      total: parseInt(countResult.rows[0]?.total || '0', 10)
    };
  }

  /**
   * Format PINGRIDE progress for UI display
   */
  static formatForDisplay(progress: IPINGRIDEProgress): {
    letters: Array<{ char: string; isCompleted: boolean; color: string }>;
    progressPercentage: number;
    isComplete: boolean;
  } {
    const letters = progress.letters.map((letter) => ({
      char: letter.char,
      isCompleted: letter.isCompleted,
      color: letter.isCompleted ? '#22C55E' : '#EF4444',
    }));

    return {
      letters,
      progressPercentage: progress.overallProgress,
      isComplete: progress.isComplete,
    };
  }

  /**
   * Get progress message based on current state
   */
  static getProgressMessage(progress: IPINGRIDEProgress): string {
    if (progress.isComplete) {
      return '🎉 Congratulations! You have qualified for the programme!';
    }

    const completedCount = progress.letters.filter((l) => l.isCompleted).length;
    const nextLetter = progress.nextMilestone;

    if (completedCount === 0) {
      return 'Start your journey. Complete your first ride to begin.';
    }

    if (nextLetter) {
      return `You have completed ${completedCount} of 8 letters. Next milestone: Letter "${nextLetter.char}" at ${nextLetter.thresholdMax}% progress.`;
    }

    return `You have completed ${completedCount} of 8 letters. Keep going!`;
  }
}

export default PINGRIDEProgressModel;