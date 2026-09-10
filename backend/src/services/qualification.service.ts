import { ProgrammePeriodModel } from '../models/programme-period.model';
import { PassengerQualificationModel } from '../models/passenger-qualification.model';
import { DriverQualificationModel } from '../models/driver-qualification.model';
import { PINGRIDEProgressModel } from '../models/pingride-progress.model';
import {
    IPassengerQualification,
    IDriverQualification,
    IPassengerQualificationResponse,
    IDriverQualificationResponse,
    IPINGRIDEProgress,
    IProgrammePeriod,
} from '../types';
import logger from '../utils/logger';

export class QualificationService {
    // ============================================
    // PASSENGER QUALIFICATION
    // ============================================

    /**
     * Track passenger spend for qualification
     * Called when a ride is completed
     */
    static async trackPassengerSpend(
        passengerId: string,
        _rideId: string,
        fareAmount: number
    ): Promise<{
        tracked: boolean;
        qualification?: IPassengerQualification;
        isQualified?: boolean;
        progress?: IPINGRIDEProgress;
        reason?: string;
    }> {
        // Get the current active programme period
        const period = await ProgrammePeriodModel.getCurrent();
        if (!period) {
            logger.warn('No active programme period found for passenger spend tracking');
            return { tracked: false, reason: 'No active programme period' };
        }

        try {
            // Create or update qualification record
            const qualification = await PassengerQualificationModel.createOrUpdate(
                passengerId,
                period.id,
                fareAmount
            );

            // Update PINGRIDE progress
            await PINGRIDEProgressModel.upsertPassengerProgress(
                passengerId,
                period.id,
                qualification.eligible_annual_spend
            );

            // Get the updated progress
            const progress = await PINGRIDEProgressModel.getPassengerProgress(
                passengerId,
                period.id
            );

            // Log qualification achievement if newly qualified
            if (qualification.qualification_status === 'qualified' && qualification.qualification_date) {
                logger.info(`🎉 Passenger qualified: ${passengerId} with spend ${qualification.eligible_annual_spend}`);
            }

            return {
                tracked: true,
                qualification,
                isQualified: qualification.qualification_status === 'qualified',
                progress: progress || undefined,
            };
        } catch (error) {
            logger.error('Error tracking passenger spend:', error);
            return { tracked: false, reason: 'Error tracking qualification' };
        }
    }

    /**
     * Get passenger qualification status
     */
    static async getPassengerQualification(
        passengerId: string
    ): Promise<IPassengerQualificationResponse> {
        const period = await ProgrammePeriodModel.getCurrent();
        if (!period) {
            return {
                period: null,
                qualification: null,
                progress: null,
                threshold: 500000,
                isQualified: false,
                eligibleSpend: 0,
                remaining: 500000,
            };
        }

        const qualification = await PassengerQualificationModel.getByPassenger(
            passengerId,
            period.id
        );

        const progress = await PINGRIDEProgressModel.getPassengerProgress(
            passengerId,
            period.id
        );

        const eligibleSpend = qualification?.eligible_annual_spend || 0;
        const threshold = period.passenger_threshold || 500000;
        const isQualified = qualification?.qualification_status === 'qualified' || false;

        return {
            period,
            qualification,
            progress,
            threshold,
            isQualified,
            eligibleSpend,
            remaining: Math.max(0, threshold - eligibleSpend),
        };
    }

    /**
     * Get passenger qualification for a specific programme period
     */
    static async getPassengerQualificationForPeriod(
        passengerId: string,
        programmePeriodId: string
    ): Promise<IPassengerQualificationResponse> {
        const period = await ProgrammePeriodModel.getById(programmePeriodId);
        if (!period) {
            return {
                period: null,
                qualification: null,
                progress: null,
                threshold: 500000,
                isQualified: false,
                eligibleSpend: 0,
                remaining: 500000,
            };
        }

        const qualification = await PassengerQualificationModel.getByPassenger(
            passengerId,
            programmePeriodId
        );

        const progress = await PINGRIDEProgressModel.getPassengerProgress(
            passengerId,
            programmePeriodId
        );

        const eligibleSpend = qualification?.eligible_annual_spend || 0;
        const threshold = period.passenger_threshold || 500000;
        const isQualified = qualification?.qualification_status === 'qualified' || false;

        return {
            period,
            qualification,
            progress,
            threshold,
            isQualified,
            eligibleSpend,
            remaining: Math.max(0, threshold - eligibleSpend),
        };
    }

    /**
     * Get all passenger qualifications for a programme period (admin)
     */
    static async getAllPassengerQualifications(
        programmePeriodId: string
    ): Promise<IPassengerQualification[]> {
        const result = await PassengerQualificationModel.getByProgrammePeriod(programmePeriodId);
        return result.qualifications;
    }

    /**
     * Get qualified passengers for a programme period (admin)
     */
    static async getQualifiedPassengers(
        programmePeriodId: string
    ): Promise<IPassengerQualification[]> {
        return PassengerQualificationModel.getQualifiedPassengers(programmePeriodId);
    }

    /**
     * Get passenger qualification with full details
     */
    static async getPassengerQualificationWithDetails(
        passengerId: string,
        programmePeriodId: string
    ): Promise<any> {
        return PassengerQualificationModel.getWithPassengerDetails(
            passengerId,
            programmePeriodId
        );
    }

    /**
     * Manually mark passenger as qualified (admin)
     */
    static async markPassengerQualified(
        passengerId: string,
        programmePeriodId: string,
        spendAmount?: number
    ): Promise<IPassengerQualification | null> {
        const qualification = await PassengerQualificationModel.markQualified(
            passengerId,
            programmePeriodId,
            spendAmount
        );

        if (qualification) {
            await PINGRIDEProgressModel.upsertPassengerProgress(
                passengerId,
                programmePeriodId,
                qualification.eligible_annual_spend
            );
            logger.info(`Passenger manually marked as qualified: ${passengerId}`);
        }

        return qualification;
    }

    /**
     * Exclude passenger from qualification (admin)
     */
    static async excludePassenger(
        passengerId: string,
        programmePeriodId: string,
        reason: string
    ): Promise<void> {
        await PassengerQualificationModel.exclude(passengerId, programmePeriodId, reason);
        await PINGRIDEProgressModel.resetPassengerProgress(passengerId, programmePeriodId);
        logger.warn(`Passenger excluded from qualification: ${passengerId}, reason: ${reason}`);
    }

    /**
     * Reverse passenger qualification (admin)
     */
    static async reversePassengerQualification(
        passengerId: string,
        programmePeriodId: string,
        reason: string
    ): Promise<void> {
        await PassengerQualificationModel.reverseQualification(
            passengerId,
            programmePeriodId,
            reason
        );
        await PINGRIDEProgressModel.resetPassengerProgress(passengerId, programmePeriodId);
        logger.warn(`Passenger qualification reversed: ${passengerId}, reason: ${reason}`);
    }

    // ============================================
    // DRIVER QUALIFICATION
    // ============================================

    /**
     * Track driver contribution for qualification
     * Called when a ride is completed
     */
    static async trackDriverContribution(
        driverId: string,
        _rideId: string,
        contributionAmount: number
    ): Promise<{
        tracked: boolean;
        qualification?: IDriverQualification;
        isQualified?: boolean;
        progress?: IPINGRIDEProgress;
        reason?: string;
    }> {
        // Get the current active programme period
        const period = await ProgrammePeriodModel.getCurrent();
        if (!period) {
            logger.warn('No active programme period found for driver contribution tracking');
            return { tracked: false, reason: 'No active programme period' };
        }

        try {
            // Create or update qualification record
            const qualification = await DriverQualificationModel.createOrUpdate(
                driverId,
                period.id,
                contributionAmount
            );

            // Update PINGRIDE progress
            await PINGRIDEProgressModel.upsertDriverProgress(
                driverId,
                period.id,
                qualification.qualifying_contribution
            );

            // Get the updated progress
            const progress = await PINGRIDEProgressModel.getDriverProgress(
                driverId,
                period.id
            );

            // Log qualification achievement if newly qualified
            if (qualification.qualification_status === 'qualified' && qualification.qualification_date) {
                logger.info(`🎉 Driver qualified: ${driverId} with contribution ${qualification.qualifying_contribution}`);
            }

            return {
                tracked: true,
                qualification,
                isQualified: qualification.qualification_status === 'qualified',
                progress: progress || undefined,
            };
        } catch (error) {
            logger.error('Error tracking driver contribution:', error);
            return { tracked: false, reason: 'Error tracking qualification' };
        }
    }

    /**
     * Get driver qualification status
     */
    static async getDriverQualification(
        driverId: string
    ): Promise<IDriverQualificationResponse> {
        const period = await ProgrammePeriodModel.getCurrent();
        if (!period) {
            return {
                period: null,
                qualification: null,
                progress: null,
                threshold: 15000000,
                isQualified: false,
                qualifyingContribution: 0,
                remaining: 15000000,
            };
        }

        const qualification = await DriverQualificationModel.getByDriver(
            driverId,
            period.id
        );

        const progress = await PINGRIDEProgressModel.getDriverProgress(
            driverId,
            period.id
        );

        const qualifyingContribution = qualification?.qualifying_contribution || 0;
        const threshold = period.driver_threshold || 15000000;
        const isQualified = qualification?.qualification_status === 'qualified' || false;

        return {
            period,
            qualification,
            progress,
            threshold,
            isQualified,
            qualifyingContribution,
            remaining: Math.max(0, threshold - qualifyingContribution),
        };
    }

    /**
     * Get driver qualification for a specific programme period
     */
    static async getDriverQualificationForPeriod(
        driverId: string,
        programmePeriodId: string
    ): Promise<IDriverQualificationResponse> {
        const period = await ProgrammePeriodModel.getById(programmePeriodId);
        if (!period) {
            return {
                period: null,
                qualification: null,
                progress: null,
                threshold: 15000000,
                isQualified: false,
                qualifyingContribution: 0,
                remaining: 15000000,
            };
        }

        const qualification = await DriverQualificationModel.getByDriver(
            driverId,
            programmePeriodId
        );

        const progress = await PINGRIDEProgressModel.getDriverProgress(
            driverId,
            programmePeriodId
        );

        const qualifyingContribution = qualification?.qualifying_contribution || 0;
        const threshold = period.driver_threshold || 15000000;
        const isQualified = qualification?.qualification_status === 'qualified' || false;

        return {
            period,
            qualification,
            progress,
            threshold,
            isQualified,
            qualifyingContribution,
            remaining: Math.max(0, threshold - qualifyingContribution),
        };
    }

    /**
     * Get all driver qualifications for a programme period (admin)
     */
    static async getAllDriverQualifications(
        programmePeriodId: string
    ): Promise<IDriverQualification[]> {
        const result = await DriverQualificationModel.getByProgrammePeriod(programmePeriodId);
        return result.qualifications;
    }

    /**
     * Get qualified drivers for a programme period (admin)
     */
    static async getQualifiedDrivers(
        programmePeriodId: string
    ): Promise<IDriverQualification[]> {
        return DriverQualificationModel.getQualifiedDrivers(programmePeriodId);
    }

    /**
     * Get driver qualification with full details
     */
    static async getDriverQualificationWithDetails(
        driverId: string,
        programmePeriodId: string
    ): Promise<any> {
        return DriverQualificationModel.getWithDriverDetails(
            driverId,
            programmePeriodId
        );
    }

    /**
     * Manually mark driver as qualified (admin)
     */
    static async markDriverQualified(
        driverId: string,
        programmePeriodId: string,
        contributionAmount?: number
    ): Promise<IDriverQualification | null> {
        const qualification = await DriverQualificationModel.markQualified(
            driverId,
            programmePeriodId,
            contributionAmount
        );

        if (qualification) {
            await PINGRIDEProgressModel.upsertDriverProgress(
                driverId,
                programmePeriodId,
                qualification.qualifying_contribution
            );
            logger.info(`Driver manually marked as qualified: ${driverId}`);
        }

        return qualification;
    }

    /**
     * Exclude driver from qualification (admin)
     */
    static async excludeDriver(
        driverId: string,
        programmePeriodId: string,
        reason: string
    ): Promise<void> {
        await DriverQualificationModel.exclude(driverId, programmePeriodId, reason);
        await PINGRIDEProgressModel.resetDriverProgress(driverId, programmePeriodId);
        logger.warn(`Driver excluded from qualification: ${driverId}, reason: ${reason}`);
    }

    /**
     * Reverse driver qualification (admin)
     */
    static async reverseDriverQualification(
        driverId: string,
        programmePeriodId: string,
        reason: string
    ): Promise<void> {
        await DriverQualificationModel.reverseQualification(
            driverId,
            programmePeriodId,
            reason
        );
        await PINGRIDEProgressModel.resetDriverProgress(driverId, programmePeriodId);
        logger.warn(`Driver qualification reversed: ${driverId}, reason: ${reason}`);
    }

    // ============================================
    // UTILITY METHODS
    // ============================================

    /**
     * Get qualification summary for a programme period (admin)
     */
    static async getQualificationSummary(programmePeriodId: string): Promise<{
        passengers: {
            total: number;
            qualified: number;
            inProgress: number;
            excluded: number;
        };
        drivers: {
            total: number;
            qualified: number;
            inProgress: number;
            excluded: number;
        };
    }> {
        const [passengerResult, driverResult] = await Promise.all([
            PassengerQualificationModel.getByProgrammePeriod(programmePeriodId),
            DriverQualificationModel.getByProgrammePeriod(programmePeriodId)
        ]);

        const passengerQualifications = passengerResult.qualifications;
        const driverQualifications = driverResult.qualifications;

        const passengerStats = {
            total: passengerQualifications.length,
            qualified: passengerQualifications.filter((q) => q.qualification_status === 'qualified').length,
            inProgress: passengerQualifications.filter((q) => q.qualification_status === 'in_progress').length,
            excluded: passengerQualifications.filter((q) => q.qualification_status === 'excluded').length,
        };

        const driverStats = {
            total: driverQualifications.length,
            qualified: driverQualifications.filter((q) => q.qualification_status === 'qualified').length,
            inProgress: driverQualifications.filter((q) => q.qualification_status === 'in_progress').length,
            excluded: driverQualifications.filter((q) => q.qualification_status === 'excluded').length,
        };

        return {
            passengers: passengerStats,
            drivers: driverStats,
        };
    }

    /**
     * Get qualification progress for multiple passengers (admin)
     */
    static async getPassengerQualificationBatch(
        passengerIds: string[],
        programmePeriodId: string
    ): Promise<IPassengerQualification[]> {
        const results: IPassengerQualification[] = [];

        // Use Promise.all for parallel queries
        const qualifications = await Promise.all(
            passengerIds.map(id => PassengerQualificationModel.getByPassenger(id, programmePeriodId))
        );

        for (const qualification of qualifications) {
            if (qualification) {
                results.push(qualification);
            }
        }

        return results;
    }

    /**
     * Get qualification progress for multiple drivers (admin)
     */
    static async getDriverQualificationBatch(
        driverIds: string[],
        programmePeriodId: string
    ): Promise<IDriverQualification[]> {
        const results: IDriverQualification[] = [];

        // Use Promise.all for parallel queries
        const qualifications = await Promise.all(
            driverIds.map(id => DriverQualificationModel.getByDriver(id, programmePeriodId))
        );

        for (const qualification of qualifications) {
            if (qualification) {
                results.push(qualification);
            }
        }

        return results;
    }

    /**
     * Update qualification ranks for winner selection
     */
    static async updateQualificationRanks(programmePeriodId: string): Promise<void> {
        await Promise.all([
            PassengerQualificationModel.updateRank(programmePeriodId),
            DriverQualificationModel.updateRank(programmePeriodId)
        ]);
        logger.info(`Updated qualification ranks for period ${programmePeriodId}`);
    }

    /**
     * Check if qualification is active (programme period is active)
     */
    static async isQualificationActive(): Promise<boolean> {
        const period = await ProgrammePeriodModel.getCurrent();
        return period !== null && period.status === 'active';
    }

    /**
     * Get the current qualification period
     */
    static async getCurrentQualificationPeriod(): Promise<IProgrammePeriod | null> {
        return ProgrammePeriodModel.getCurrent();
    }

    /**
     * Get qualification status for a passenger with formatted response for UI
     */
    static async getPassengerQualificationForUI(
        passengerId: string
    ): Promise<{
        status: 'not_started' | 'in_progress' | 'qualified' | 'excluded';
        progress: number;
        letters: Array<{ char: string; isCompleted: boolean; color: string }>;
        spend: number;
        threshold: number;
        remaining: number;
        isWinner: boolean;
        message: string;
    }> {
        const result = await this.getPassengerQualification(passengerId);

        if (!result.period) {
            return {
                status: 'not_started',
                progress: 0,
                letters: [],
                spend: 0,
                threshold: 500000,
                remaining: 500000,
                isWinner: false,
                message: 'No active programme period',
            };
        }

        const progress = result.progress;
        const formattedProgress = progress
            ? PINGRIDEProgressModel.formatForDisplay(progress)
            : { letters: [], progressPercentage: 0, isComplete: false };

        const message = progress
            ? PINGRIDEProgressModel.getProgressMessage(progress)
            : 'Start your journey. Complete your first ride to begin.';

        const isWinner = result.qualification?.winner_selected || false;

        return {
            status: result.qualification?.qualification_status || 'not_started',
            progress: formattedProgress.progressPercentage,
            letters: formattedProgress.letters,
            spend: result.eligibleSpend,
            threshold: result.threshold,
            remaining: result.remaining,
            isWinner,
            message,
        };
    }

    /**
     * Get qualification status for a driver with formatted response for UI
     */
    static async getDriverQualificationForUI(
        driverId: string
    ): Promise<{
        status: 'not_started' | 'in_progress' | 'qualified' | 'excluded';
        progress: number;
        letters: Array<{ char: string; isCompleted: boolean; color: string }>;
        contribution: number;
        threshold: number;
        remaining: number;
        isWinner: boolean;
        message: string;
    }> {
        const result = await this.getDriverQualification(driverId);

        if (!result.period) {
            return {
                status: 'not_started',
                progress: 0,
                letters: [],
                contribution: 0,
                threshold: 15000000,
                remaining: 15000000,
                isWinner: false,
                message: 'No active programme period',
            };
        }

        const progress = result.progress;
        const formattedProgress = progress
            ? PINGRIDEProgressModel.formatForDisplay(progress)
            : { letters: [], progressPercentage: 0, isComplete: false };

        const message = progress
            ? PINGRIDEProgressModel.getProgressMessage(progress)
            : 'Start your journey. Complete your first ride to begin.';

        const isWinner = result.qualification?.winner_selected || false;

        return {
            status: result.qualification?.qualification_status || 'not_started',
            progress: formattedProgress.progressPercentage,
            letters: formattedProgress.letters,
            contribution: result.qualifyingContribution,
            threshold: result.threshold,
            remaining: result.remaining,
            isWinner,
            message,
        };
    }
}

export default QualificationService;