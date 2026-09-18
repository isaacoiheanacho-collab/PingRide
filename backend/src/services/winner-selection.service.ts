import { ProgrammePeriodModel } from '../models/programme-period.model';
import { PassengerQualificationModel } from '../models/passenger-qualification.model';
import { DriverQualificationModel } from '../models/driver-qualification.model';
import { WinnerModel } from '../models/winner.model';
import {
  IPassengerQualification,
  IDriverQualification,
  IWinner,
  IWinnerSelectionResult,
} from '../types';
import logger from '../utils/logger';

export class WinnerSelectionService {
  // ============================================
  // PASSENGER WINNER SELECTION
  // ============================================

  static async selectPassengerWinners(
    programmePeriodId: string
  ): Promise<IWinnerSelectionResult> {
    const period = await ProgrammePeriodModel.getById(programmePeriodId);
    if (!period) {
      throw new Error('Programme period not found');
    }

    if (period.status !== 'closed') {
      throw new Error('Programme period must be closed before selecting winners');
    }

    const qualified = await PassengerQualificationModel.getQualifiedPassengers(programmePeriodId);
    const qualifiedCount = qualified.length;

    const activeCount = await ProgrammePeriodModel.getActivePassengerCount(programmePeriodId);
    const capacity = Math.max(1, Math.floor(activeCount * (period.winner_cap_percentage / 100)));

    let winners: IPassengerQualification[] = [];
    let status: 'no_qualified' | 'all_selected' | 'selected_by_ranking' = 'no_qualified';

    if (qualifiedCount === 0) {
      status = 'no_qualified';
      logger.info(`No qualified passengers for period ${programmePeriodId}`);
    } else if (qualifiedCount <= capacity) {
      winners = qualified;
      status = 'all_selected';
      logger.info(`All ${qualifiedCount} qualified passengers selected as winners for period ${programmePeriodId}`);
    } else {
      const sorted = [...qualified].sort((a, b) => b.eligible_annual_spend - a.eligible_annual_spend);
      winners = sorted.slice(0, capacity);
      status = 'selected_by_ranking';
      logger.info(`Selected top ${capacity} of ${qualifiedCount} qualified passengers as winners for period ${programmePeriodId}`);
    }

    const winnerRecords: IWinner[] = [];

    for (let i = 0; i < winners.length; i++) {
      const winner = winners[i];
      if (!winner) continue;

      const details = await PassengerQualificationModel.getWithPassengerDetails(
        winner.passenger_id,
        programmePeriodId
      );

      if (!details) {
        logger.error(`Could not get passenger details for ${winner.passenger_id}`);
        continue;
      }

      const record = await WinnerModel.create({
        userId: details.users_id,
        userType: 'passenger',
        programmePeriodId: programmePeriodId,
        qualificationRegistryId: winner.id,
        eligibleValue: winner.eligible_annual_spend,
        rankPosition: i + 1,
      });
      winnerRecords.push(record);

      await PassengerQualificationModel.markWinnerSelected(
        winner.passenger_id,
        programmePeriodId,
        0
      );
    }

    await PassengerQualificationModel.updateRank(programmePeriodId);

    return {
      userType: 'passenger',
      programmePeriodId,
      totalActiveUsers: activeCount,
      winnerCapacity: capacity,
      totalQualified: qualifiedCount,
      oversubscribed: qualifiedCount > capacity,
      winners: winnerRecords,
      status,
    };
  }

  // ============================================
  // DRIVER WINNER SELECTION
  // ============================================

  static async selectDriverWinners(
    programmePeriodId: string
  ): Promise<IWinnerSelectionResult> {
    const period = await ProgrammePeriodModel.getById(programmePeriodId);
    if (!period) {
      throw new Error('Programme period not found');
    }

    if (period.status !== 'closed') {
      throw new Error('Programme period must be closed before selecting winners');
    }

    const qualified = await DriverQualificationModel.getQualifiedDrivers(programmePeriodId);
    const qualifiedCount = qualified.length;

    const activeCount = await ProgrammePeriodModel.getActiveDriverCount(programmePeriodId);
    const capacity = Math.max(1, Math.floor(activeCount * (period.winner_cap_percentage / 100)));

    let winners: IDriverQualification[] = [];
    let status: 'no_qualified' | 'all_selected' | 'selected_by_ranking' = 'no_qualified';

    if (qualifiedCount === 0) {
      status = 'no_qualified';
      logger.info(`No qualified drivers for period ${programmePeriodId}`);
    } else if (qualifiedCount <= capacity) {
      winners = qualified;
      status = 'all_selected';
      logger.info(`All ${qualifiedCount} qualified drivers selected as winners for period ${programmePeriodId}`);
    } else {
      const sorted = [...qualified].sort((a, b) => b.qualifying_contribution - a.qualifying_contribution);
      winners = sorted.slice(0, capacity);
      status = 'selected_by_ranking';
      logger.info(`Selected top ${capacity} of ${qualifiedCount} qualified drivers as winners for period ${programmePeriodId}`);
    }

    const winnerRecords: IWinner[] = [];

    for (let i = 0; i < winners.length; i++) {
      const winner = winners[i];
      if (!winner) continue;

      const details = await DriverQualificationModel.getWithDriverDetails(
        winner.driver_id,
        programmePeriodId
      );

      if (!details) {
        logger.error(`Could not get driver details for ${winner.driver_id}`);
        continue;
      }

      const record = await WinnerModel.create({
        userId: details.users_id,
        userType: 'driver',
        programmePeriodId: programmePeriodId,
        qualificationRegistryId: winner.id,
        eligibleValue: winner.qualifying_contribution,
        rankPosition: i + 1,
      });
      winnerRecords.push(record);

      await DriverQualificationModel.markWinnerSelected(
        winner.driver_id,
        programmePeriodId,
        0
      );
    }

    await DriverQualificationModel.updateRank(programmePeriodId);

    return {
      userType: 'driver',
      programmePeriodId,
      totalActiveUsers: activeCount,
      winnerCapacity: capacity,
      totalQualified: qualifiedCount,
      oversubscribed: qualifiedCount > capacity,
      winners: winnerRecords,
      status,
    };
  }

  // ============================================
  // TIE-BREAKER
  // ============================================

  static applyTieBreaker<
    T extends { userId: string; eligibleValue: number; registrationDate?: Date }
  >(users: T[]): T[] {
    return users.sort((a, b) => {
      if (a.eligibleValue !== b.eligibleValue) {
        return b.eligibleValue - a.eligibleValue;
      }

      if (a.registrationDate && b.registrationDate) {
        const dateComparison = a.registrationDate.getTime() - b.registrationDate.getTime();
        if (dateComparison !== 0) {
          return dateComparison;
        }
      }

      return a.userId.localeCompare(b.userId);
    });
  }

  // ============================================
  // WINNER MANAGEMENT
  // ============================================

  static async getWinners(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver',
    page: number = 1,
    limit: number = 100
  ): Promise<{ winners: IWinner[]; total: number }> {
    return WinnerModel.getByProgrammePeriod(programmePeriodId, userType, page, limit);
  }

  static async getActiveWinners(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver'
  ): Promise<IWinner[]> {
    return WinnerModel.getActiveWinners(programmePeriodId, userType);
  }

  static async getWinnerById(id: string): Promise<IWinner | null> {
    return WinnerModel.getById(id);
  }

  static async getWinnerByUserAndPeriod(
    userId: string,
    programmePeriodId: string
  ): Promise<IWinner | null> {
    return WinnerModel.getByUserAndPeriod(userId, programmePeriodId);
  }

  static async disqualifyWinner(
    winnerId: string,
    reason: string
  ): Promise<IWinner | null> {
    const winner = await WinnerModel.disqualify(winnerId, reason);
    if (winner) {
      logger.warn(`Winner disqualified: ${winnerId}, reason: ${reason}`);
    }
    return winner;
  }

  /**
   * Replace a disqualified winner with the next qualified user.
   *
   * The passenger and driver branches are kept completely separate so
   * that TypeScript can narrow each qualification record to its own type.
   * A single `nextQualified` variable of union type cannot be narrowed by
   * the enclosing `user_type` check, so each branch declares its own
   * strongly-typed local instead.
   */
  static async replaceWinner(
    disqualifiedWinnerId: string
  ): Promise<IWinner | null> {
    const disqualifiedWinner = await WinnerModel.getById(disqualifiedWinnerId);
    if (!disqualifiedWinner) {
      throw new Error('Disqualified winner not found');
    }

    // ============================================
    // PASSENGER REPLACEMENT
    // ============================================
    if (disqualifiedWinner.user_type === 'passenger') {
      const qualified = await PassengerQualificationModel.getQualifiedPassengers(
        disqualifiedWinner.programme_period_id
      );

      const existingWinners = await WinnerModel.getActiveWinners(
        disqualifiedWinner.programme_period_id,
        'passenger'
      );
      const existingWinnerIds = existingWinners.map((w) => w.user_id);

      let nextQualified: IPassengerQualification | null = null;
      let nextQualifiedDetails: any = null;

      for (const q of qualified) {
        const details = await PassengerQualificationModel.getWithPassengerDetails(
          q.passenger_id,
          disqualifiedWinner.programme_period_id
        );
        if (details && !existingWinnerIds.includes(details.users_id)) {
          nextQualified = q;
          nextQualifiedDetails = details;
          break;
        }
      }

      if (!nextQualified || !nextQualifiedDetails) {
        logger.warn(
          `No replacement found for disqualified passenger winner: ${disqualifiedWinnerId}`
        );
        return null;
      }

      const replacement = await WinnerModel.replaceWinner(
        disqualifiedWinnerId,
        nextQualifiedDetails.users_id,
        nextQualified.id,
        nextQualified.eligible_annual_spend,
        disqualifiedWinner.rank_position
      );

      await PassengerQualificationModel.markWinnerSelected(
        nextQualified.passenger_id,
        disqualifiedWinner.programme_period_id,
        0
      );

      logger.info(
        `Replaced passenger winner: ${disqualifiedWinnerId} -> ${nextQualifiedDetails.users_id}`
      );
      return replacement;
    }

    // ============================================
    // DRIVER REPLACEMENT
    // ============================================
    const qualified = await DriverQualificationModel.getQualifiedDrivers(
      disqualifiedWinner.programme_period_id
    );

    const existingWinners = await WinnerModel.getActiveWinners(
      disqualifiedWinner.programme_period_id,
      'driver'
    );
    const existingWinnerIds = existingWinners.map((w) => w.user_id);

    let nextQualified: IDriverQualification | null = null;
    let nextQualifiedDetails: any = null;

    for (const q of qualified) {
      const details = await DriverQualificationModel.getWithDriverDetails(
        q.driver_id,
        disqualifiedWinner.programme_period_id
      );
      if (details && !existingWinnerIds.includes(details.users_id)) {
        nextQualified = q;
        nextQualifiedDetails = details;
        break;
      }
    }

    if (!nextQualified || !nextQualifiedDetails) {
      logger.warn(
        `No replacement found for disqualified driver winner: ${disqualifiedWinnerId}`
      );
      return null;
    }

    const replacement = await WinnerModel.replaceWinner(
      disqualifiedWinnerId,
      nextQualifiedDetails.users_id,
      nextQualified.id,
      nextQualified.qualifying_contribution,
      disqualifiedWinner.rank_position
    );

    await DriverQualificationModel.markWinnerSelected(
      nextQualified.driver_id,
      disqualifiedWinner.programme_period_id,
      0
    );

    logger.info(
      `Replaced driver winner: ${disqualifiedWinnerId} -> ${nextQualifiedDetails.users_id}`
    );
    return replacement;
  }

  static async markWinnerPaid(winnerId: string): Promise<IWinner | null> {
    return WinnerModel.markPaid(winnerId);
  }

  static async getWinnerCount(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver',
    status?: 'active' | 'disqualified' | 'paid'
  ): Promise<number> {
    return WinnerModel.getCount(programmePeriodId, userType, status);
  }

  static async getDisqualifiedWinners(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver'
  ): Promise<IWinner[]> {
    return WinnerModel.getDisqualifiedWinners(programmePeriodId, userType);
  }

  static async getPaidWinners(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver'
  ): Promise<IWinner[]> {
    return WinnerModel.getPaidWinners(programmePeriodId, userType);
  }

  static async isWinner(userId: string, programmePeriodId: string): Promise<boolean> {
    return WinnerModel.isWinner(userId, programmePeriodId);
  }

  static async getWinnerSummary(programmePeriodId: string): Promise<{
    total: number;
    active: number;
    disqualified: number;
    paid: number;
    passengerCount: number;
    driverCount: number;
  }> {
    return WinnerModel.getSummary(programmePeriodId);
  }

  // ============================================
  // BATCH SELECTION
  // ============================================

  static async selectAllWinners(
    programmePeriodId: string
  ): Promise<{
    passenger: IWinnerSelectionResult;
    driver: IWinnerSelectionResult;
  }> {
    const passengerResult = await this.selectPassengerWinners(programmePeriodId);
    const driverResult = await this.selectDriverWinners(programmePeriodId);

    return {
      passenger: passengerResult,
      driver: driverResult,
    };
  }

  static async completeWinnerSelection(
    programmePeriodId: string
  ): Promise<{
    passengerWinners: IWinnerSelectionResult;
    driverWinners: IWinnerSelectionResult;
    summary: {
      totalPassengerWinners: number;
      totalDriverWinners: number;
      totalWinners: number;
      passengerQualified: number;
      driverQualified: number;
      passengerCapacity: number;
      driverCapacity: number;
    };
  }> {
    const passengerResult = await this.selectPassengerWinners(programmePeriodId);
    const driverResult = await this.selectDriverWinners(programmePeriodId);

    await ProgrammePeriodModel.updateActiveCounts(programmePeriodId);

    const summary = {
      totalPassengerWinners: passengerResult.winners.length,
      totalDriverWinners: driverResult.winners.length,
      totalWinners: passengerResult.winners.length + driverResult.winners.length,
      passengerQualified: passengerResult.totalQualified,
      driverQualified: driverResult.totalQualified,
      passengerCapacity: passengerResult.winnerCapacity,
      driverCapacity: driverResult.winnerCapacity,
    };

    logger.info(
      `Winner selection completed for period ${programmePeriodId}: ${summary.totalWinners} total winners`
    );

    return {
      passengerWinners: passengerResult,
      driverWinners: driverResult,
      summary,
    };
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  static async getWinnersWithDetails(
    programmePeriodId: string,
    userType?: 'passenger' | 'driver'
  ): Promise<any[]> {
    const result = await WinnerModel.getByProgrammePeriod(programmePeriodId, userType);
    const winners = result.winners;

    const details = await Promise.all(
      winners.map((winner) => WinnerModel.getWithUserDetails(winner.id))
    );

    return details.filter((d): d is any => d !== null);
  }

  static async getWinnerStats(programmePeriodId: string): Promise<{
    passenger: {
      qualified: number;
      capacity: number;
      selected: number;
      oversubscribed: boolean;
      topSpend: number;
      avgSpend: number;
      minSpend: number;
    };
    driver: {
      qualified: number;
      capacity: number;
      selected: number;
      oversubscribed: boolean;
      topContribution: number;
      avgContribution: number;
      minContribution: number;
    };
  }> {
    const period = await ProgrammePeriodModel.getById(programmePeriodId);
    if (!period) {
      throw new Error('Programme period not found');
    }

    const [passengerQualified, passengerActive, passengerWinners, passengerQualifiedData] =
      await Promise.all([
        PassengerQualificationModel.getQualifiedCount(programmePeriodId),
        ProgrammePeriodModel.getActivePassengerCount(programmePeriodId),
        WinnerModel.getActiveWinners(programmePeriodId, 'passenger'),
        PassengerQualificationModel.getQualifiedPassengers(programmePeriodId),
      ]);

    const passengerCapacity = Math.max(
      1,
      Math.floor(passengerActive * (period.winner_cap_percentage / 100))
    );
    const passengerSpends = passengerQualifiedData.map((q) => q.eligible_annual_spend);

    const [driverQualified, driverActive, driverWinners, driverQualifiedData] =
      await Promise.all([
        DriverQualificationModel.getQualifiedCount(programmePeriodId),
        ProgrammePeriodModel.getActiveDriverCount(programmePeriodId),
        WinnerModel.getActiveWinners(programmePeriodId, 'driver'),
        DriverQualificationModel.getQualifiedDrivers(programmePeriodId),
      ]);

    const driverCapacity = Math.max(
      1,
      Math.floor(driverActive * (period.winner_cap_percentage / 100))
    );
    const driverContributions = driverQualifiedData.map((q) => q.qualifying_contribution);

    return {
      passenger: {
        qualified: passengerQualified,
        capacity: passengerCapacity,
        selected: passengerWinners.length,
        oversubscribed: passengerQualified > passengerCapacity,
        topSpend: passengerSpends.length > 0 ? Math.max(...passengerSpends) : 0,
        avgSpend:
          passengerSpends.length > 0
            ? passengerSpends.reduce((a, b) => a + b, 0) / passengerSpends.length
            : 0,
        minSpend: passengerSpends.length > 0 ? Math.min(...passengerSpends) : 0,
      },
      driver: {
        qualified: driverQualified,
        capacity: driverCapacity,
        selected: driverWinners.length,
        oversubscribed: driverQualified > driverCapacity,
        topContribution:
          driverContributions.length > 0 ? Math.max(...driverContributions) : 0,
        avgContribution:
          driverContributions.length > 0
            ? driverContributions.reduce((a, b) => a + b, 0) /
              driverContributions.length
            : 0,
        minContribution:
          driverContributions.length > 0 ? Math.min(...driverContributions) : 0,
      },
    };
  }

  static async deleteWinners(programmePeriodId: string): Promise<number> {
    const count = await WinnerModel.deleteByProgrammePeriod(programmePeriodId);
    if (count > 0) {
      logger.warn(`Deleted ${count} winners for period ${programmePeriodId}`);
    }
    return count;
  }
}

export default WinnerSelectionService;