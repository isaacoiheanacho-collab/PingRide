import { ProgrammePeriodModel } from '../models/programme-period.model';
import { FraudCaseModel } from '../models/fraud-case.model';
import { WinnerModel } from '../models/winner.model';
import { WinnerSelectionService } from './winner-selection.service';
import { QualificationService } from './qualification.service';
import {
  IFraudCase,
  IFraudDetectionResult,
  IFraudSignal,
  FraudCaseType,
  FraudSeverity,
  FraudCaseStatus,
  IQualificationExclusion,
} from '../types';
import logger from '../utils/logger';
import pool from '../config/database';

export class FraudDetectionService {
  // ============================================
  // FRAUD DETECTION SIGNALS
  // ============================================

  /**
   * Detect collusion between passenger and driver
   * Signal: Repeated passenger-driver pairings > 5 times in 30 days
   */
  static async detectCollusion(
    passengerId: string,
    driverId: string,
    rideHistory: any[]
  ): Promise<IFraudSignal | null> {
    const pairings = rideHistory.filter(
      (r) => r.passenger_id === passengerId && r.driver_id === driverId && r.status === 'ride_completed'
    ).length;

    if (pairings > 5) {
      return {
        type: 'collusion',
        description: `Repeated passenger-driver pairing: ${pairings} times in 30 days`,
        confidence: Math.min(pairings / 10, 0.9),
        evidence: { pairings, passengerId, driverId },
        timestamp: new Date(),
      };
    }

    return null;
  }

  /**
   * Detect ghost rides
   * Signal: Short duration (< 5 minutes) and/or short distance (< 0.5 km)
   */
  static async detectGhostRide(ride: any): Promise<IFraudSignal | null> {
    const signals: string[] = [];
    let confidence = 0;

    if (ride.duration_minutes && ride.duration_minutes < 5) {
      signals.push(`Short duration: ${ride.duration_minutes} minutes`);
      confidence = Math.max(confidence, 0.4);
    }

    if (ride.final_distance_km && ride.final_distance_km < 0.5) {
      signals.push(`Short distance: ${ride.final_distance_km} km`);
      confidence = Math.max(confidence, 0.4);
    }

    if (signals.length === 0) {
      return null;
    }

    return {
      type: 'ghost_ride',
      description: signals.join('; '),
      confidence,
      evidence: {
        rideId: ride.id,
        duration_minutes: ride.duration_minutes,
        distance_km: ride.final_distance_km,
      },
      timestamp: new Date(),
    };
  }

  /**
   * Detect GPS spoofing
   * Signal: GPS jumps > 10 km in 1 minute
   */
  static async detectGPSSpoofing(ride: any): Promise<IFraudSignal | null> {
    if (!ride.gps_track || ride.gps_track.length < 2) {
      return null;
    }

    const anomalies: string[] = [];
    let confidence = 0;

    for (let i = 1; i < ride.gps_track.length; i++) {
      const prev = ride.gps_track[i - 1];
      const curr = ride.gps_track[i];

      // Skip if timestamps are missing
      if (!prev.created_at || !curr.created_at) continue;

      const timeDiff = (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) / 1000;
      if (timeDiff === 0) continue;

      // Calculate approximate distance (simplified - for production use proper geospatial)
      const latDiff = curr.latitude - prev.latitude;
      const lngDiff = curr.longitude - prev.longitude;
      const distanceKm = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111; // Approximate km per degree

      if (distanceKm > 10) {
        anomalies.push(`GPS jump: ${distanceKm.toFixed(2)} km in ${timeDiff.toFixed(0)} seconds`);
        confidence = Math.max(confidence, Math.min(distanceKm / 20, 0.8));
      }
    }

    if (anomalies.length === 0) {
      return null;
    }

    return {
      type: 'gps_spoofing',
      description: anomalies.join('; '),
      confidence,
      evidence: { rideId: ride.id, anomalies },
      timestamp: new Date(),
    };
  }

  /**
   * Detect repeated pairings (overall pattern)
   */
  static async detectRepeatedPairings(
    userId: string,
    rideHistory: any[]
  ): Promise<IFraudSignal | null> {
    // Count pairings with each driver
    const pairings: Record<string, number> = {};

    for (const ride of rideHistory) {
      if (ride.driver_id) {
        pairings[ride.driver_id] = (pairings[ride.driver_id] || 0) + 1;
      }
    }

    // Find the most frequent pairing
    let maxPairs = 0;
    let topDriver = '';

    for (const [driverId, count] of Object.entries(pairings)) {
      if (count > maxPairs) {
        maxPairs = count;
        topDriver = driverId;
      }
    }

    if (maxPairs > 10) {
      return {
        type: 'collusion',
        description: `Repeated pairings: ${maxPairs} rides with driver ${topDriver} (user ${userId})`,
        confidence: Math.min(maxPairs / 20, 0.8),
        evidence: { driverId: topDriver, count: maxPairs, userId },
        timestamp: new Date(),
      };
    }

    return null;
  }

  /**
   * Detect qualification velocity (rapid qualification)
   * Signal: Qualifies in < 30 days with high spend
   */
  static async detectQualificationVelocity(
    userId: string,
    userType: 'passenger' | 'driver',
    rideHistory: any[]
  ): Promise<IFraudSignal | null> {
    if (rideHistory.length < 10) {
      return null;
    }

    // Get first and last ride dates
    const sortedRides = [...rideHistory].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const firstRide = sortedRides[0];
    const lastRide = sortedRides[sortedRides.length - 1];

    if (!firstRide || !lastRide) {
      return null;
    }

    const daysActive = (new Date(lastRide.created_at).getTime() - new Date(firstRide.created_at).getTime()) / (1000 * 60 * 60 * 24);

    if (daysActive < 30) {
      // Calculate total spend/contribution
      let totalValue = 0;
      for (const ride of rideHistory) {
        if (userType === 'passenger') {
          totalValue += ride.bid_amount || 0;
        } else {
          totalValue += ride.driver_earnings || 0;
        }
      }

      const threshold = userType === 'passenger' ? 500000 : 15000000;

      if (totalValue >= threshold) {
        return {
          type: 'qualification_velocity',
          description: `Rapid qualification: ${daysActive.toFixed(0)} days to reach ${totalValue.toFixed(0)}`,
          confidence: Math.min(1 - (daysActive / 30), 0.8),
          evidence: { daysActive, totalValue, threshold, userId },
          timestamp: new Date(),
        };
      }
    }

    return null;
  }

  // ============================================
  // FRAUD DETECTION ENGINE
  // ============================================

  /**
   * Run full fraud detection on a ride
   */
  static async detectRideFraud(ride: any): Promise<IFraudDetectionResult> {
    const signals: IFraudSignal[] = [];

    // 1. Ghost ride detection
    const ghostSignal = await this.detectGhostRide(ride);
    if (ghostSignal) {
      signals.push(ghostSignal);
    }

    // 2. GPS spoofing detection
    const gpsSignal = await this.detectGPSSpoofing(ride);
    if (gpsSignal) {
      signals.push(gpsSignal);
    }

    // Calculate overall score
    let suspicionScore = 0;
    let severity: FraudSeverity = 'low';

    for (const signal of signals) {
      suspicionScore += signal.confidence * 100;
    }

    // Cap at 100
    suspicionScore = Math.min(suspicionScore, 100);

    // Determine severity
    if (suspicionScore >= 70) {
      severity = 'critical';
    } else if (suspicionScore >= 50) {
      severity = 'high';
    } else if (suspicionScore >= 30) {
      severity = 'medium';
    }

    let recommendedAction: 'monitor' | 'investigate' | 'exclude' | 'immediate_action' = 'monitor';
    if (suspicionScore >= 70) {
      recommendedAction = 'exclude';
    } else if (suspicionScore >= 50) {
      recommendedAction = 'investigate';
    } else if (suspicionScore >= 30) {
      recommendedAction = 'monitor';
    }

    return {
      userId: ride.driver_id || ride.passenger_id || '',
      userType: ride.driver_id ? 'driver' : 'passenger',
      rideId: ride.id,
      signals,
      suspicionScore,
      severity,
      recommendedAction,
      isFraudulent: suspicionScore >= 30,
    };
  }

  /**
   * Run full fraud detection on a user (passenger or driver)
   */
  static async detectUserFraud(
    userId: string,
    userType: 'passenger' | 'driver',
    rideHistory: any[]
  ): Promise<IFraudDetectionResult> {
    const signals: IFraudSignal[] = [];

    // 1. Repeated pairings (collusion)
    const collusionSignal = await this.detectRepeatedPairings(userId, rideHistory);
    if (collusionSignal) {
      signals.push(collusionSignal);
    }

    // 2. Qualification velocity
    const velocitySignal = await this.detectQualificationVelocity(userId, userType, rideHistory);
    if (velocitySignal) {
      signals.push(velocitySignal);
    }

    // Calculate overall score
    let suspicionScore = 0;

    for (const signal of signals) {
      suspicionScore += signal.confidence * 100;
    }

    // Cap at 100
    suspicionScore = Math.min(suspicionScore, 100);

    // Determine severity
    let severity: FraudSeverity = 'low';
    if (suspicionScore >= 70) {
      severity = 'critical';
    } else if (suspicionScore >= 50) {
      severity = 'high';
    } else if (suspicionScore >= 30) {
      severity = 'medium';
    }

    let recommendedAction: 'monitor' | 'investigate' | 'exclude' | 'immediate_action' = 'monitor';
    if (suspicionScore >= 70) {
      recommendedAction = 'exclude';
    } else if (suspicionScore >= 50) {
      recommendedAction = 'investigate';
    } else if (suspicionScore >= 30) {
      recommendedAction = 'monitor';
    }

    return {
      userId,
      userType,
      signals,
      suspicionScore,
      severity,
      recommendedAction,
      isFraudulent: suspicionScore >= 30,
    };
  }

  // ============================================
  // FRAUD CASE MANAGEMENT
  // ============================================

  /**
   * Create a fraud case from detection results
   */
  static async createFraudCase(
    programmePeriodId: string,
    userId: string,
    userType: 'passenger' | 'driver',
    detectionResult: IFraudDetectionResult,
    rideIds?: string[]
  ): Promise<IFraudCase> {
    // Determine case type from signals
    let caseType: FraudCaseType = 'other';
    if (detectionResult.signals.length > 0) {
      // Use the first signal's type
      caseType = detectionResult.signals[0].type;
    }

    const fraudCase = await FraudCaseModel.create({
      programmePeriodId,
      caseType,
      passengerId: userType === 'passenger' ? userId : undefined,
      driverId: userType === 'driver' ? userId : undefined,
      rideIds: rideIds || [],
      suspicionScore: detectionResult.suspicionScore,
      description: detectionResult.signals.map((s) => s.description).join('; '),
      evidence: detectionResult.signals,
      severity: detectionResult.severity,
    });

    logger.warn(`Fraud case created: ${fraudCase.id} for user ${userId} (${userType})`);

    return fraudCase;
  }

  /**
   * Get fraud case by ID
   */
  static async getFraudCase(caseId: string): Promise<IFraudCase | null> {
    return FraudCaseModel.getById(caseId);
  }

  /**
   * Get fraud cases for a programme period
   */
  static async getFraudCasesByPeriod(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    return FraudCaseModel.getByProgrammePeriod(programmePeriodId, page, limit);
  }

  /**
   * Get fraud cases by status
   */
  static async getFraudCasesByStatus(
    status: FraudCaseStatus,
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    return FraudCaseModel.getByStatus(status, page, limit);
  }

  /**
   * Get pending fraud cases
   */
  static async getPendingFraudCases(
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    return FraudCaseModel.getPendingCases(page, limit);
  }

  /**
   * Get fraud cases by user
   */
  static async getFraudCasesByUser(
    userId: string,
    userType: 'passenger' | 'driver',
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    return FraudCaseModel.getByUser(userId, userType, page, limit);
  }

  /**
   * Update fraud case status
   */
  static async updateFraudCaseStatus(
    caseId: string,
    status: FraudCaseStatus,
    notes?: string,
    resolvedBy?: string
  ): Promise<IFraudCase | null> {
    return FraudCaseModel.updateStatus(caseId, status, notes, resolvedBy);
  }

  /**
   * Assign investigator to fraud case
   */
  static async assignInvestigator(
    caseId: string,
    investigatorId: string
  ): Promise<IFraudCase | null> {
    return FraudCaseModel.assignInvestigator(caseId, investigatorId);
  }

  /**
   * Resolve a fraud case with action
   */
  static async resolveFraudCase(
    caseId: string,
    decision: 'confirmed' | 'dismissed' | 'resolved',
    action: 'exclude' | 'reverse_qualification' | 'disqualify_winner' | 'none',
    notes?: string,
    resolvedBy?: string
  ): Promise<{
    fraudCase: IFraudCase | null;
    actionTaken: string;
    details?: any;
  }> {
    // Update case status
    const fraudCase = await FraudCaseModel.updateStatus(caseId, decision, notes, resolvedBy);

    if (!fraudCase) {
      throw new Error('Fraud case not found');
    }

    let actionTaken = 'none';
    let details: any = null;

    // Apply action if confirmed
    if (decision === 'confirmed') {
      // Get the programme period
      const period = await ProgrammePeriodModel.getById(fraudCase.programme_period_id);
      if (!period) {
        throw new Error('Programme period not found');
      }

      switch (action) {
        case 'exclude': {
          // Exclude the user from qualification
          if (fraudCase.passenger_id) {
            await QualificationService.excludePassenger(
              fraudCase.passenger_id,
              fraudCase.programme_period_id,
              `Fraud confirmed: ${notes || 'Programme violation'}`
            );
            actionTaken = 'passenger_excluded';
            details = { passengerId: fraudCase.passenger_id };
          } else if (fraudCase.driver_id) {
            await QualificationService.excludeDriver(
              fraudCase.driver_id,
              fraudCase.programme_period_id,
              `Fraud confirmed: ${notes || 'Programme violation'}`
            );
            actionTaken = 'driver_excluded';
            details = { driverId: fraudCase.driver_id };
          }
          break;
        }

        case 'reverse_qualification': {
          // Reverse qualification
          if (fraudCase.passenger_id) {
            await QualificationService.reversePassengerQualification(
              fraudCase.passenger_id,
              fraudCase.programme_period_id,
              `Fraud confirmed: ${notes || 'Qualification reversed'}`
            );
            actionTaken = 'passenger_qualification_reversed';
            details = { passengerId: fraudCase.passenger_id };
          } else if (fraudCase.driver_id) {
            await QualificationService.reverseDriverQualification(
              fraudCase.driver_id,
              fraudCase.programme_period_id,
              `Fraud confirmed: ${notes || 'Qualification reversed'}`
            );
            actionTaken = 'driver_qualification_reversed';
            details = { driverId: fraudCase.driver_id };
          }
          break;
        }

        case 'disqualify_winner': {
          if (fraudCase.passenger_id) {
            const winner = await WinnerModel.getByUserAndPeriod(
              fraudCase.passenger_id,
              fraudCase.programme_period_id
            );
            if (winner) {
              await WinnerSelectionService.disqualifyWinner(
                winner.id,
                notes || 'Fraud confirmed'
              );
              actionTaken = 'passenger_winner_disqualified';

              // Find replacement
              const replacement = await WinnerSelectionService.replaceWinner(winner.id);
              details = {
                disqualifiedWinnerId: winner.id,
                replacementWinnerId: replacement?.id || null,
              };
            }
          } else if (fraudCase.driver_id) {
            const winner = await WinnerModel.getByUserAndPeriod(
              fraudCase.driver_id,
              fraudCase.programme_period_id
            );
            if (winner) {
              await WinnerSelectionService.disqualifyWinner(
                winner.id,
                notes || 'Fraud confirmed'
              );
              actionTaken = 'driver_winner_disqualified';

              const replacement = await WinnerSelectionService.replaceWinner(winner.id);
              details = {
                disqualifiedWinnerId: winner.id,
                replacementWinnerId: replacement?.id || null,
              };
            }
          }
          break;
        }

        case 'none':
        default:
          actionTaken = 'none';
          break;
      }

      // Create exclusion record
      if (action !== 'none' && (fraudCase.passenger_id || fraudCase.driver_id)) {
        const userType = fraudCase.passenger_id ? 'passenger' : 'driver';
        const userId = fraudCase.passenger_id || fraudCase.driver_id;

        if (userId) {
          await FraudCaseModel.createExclusion({
            programmePeriodId: fraudCase.programme_period_id,
            userType: userType as 'passenger' | 'driver',
            userId,
            fraudCaseId: caseId,
            exclusionType: action === 'disqualify_winner' ? 'winner_disqualification' :
                            action === 'reverse_qualification' ? 'qualification_reversal' :
                            action === 'exclude' ? 'programme_ban' : 'temporary_suspension',
            exclusionReason: notes || 'Fraud confirmed',
            affectedAmount: 0,
          });
        }
      }
    }

    logger.info(`Fraud case ${caseId} resolved with action: ${actionTaken}`);

    return {
      fraudCase,
      actionTaken,
      details,
    };
  }

  // ============================================
  // QUALIFICATION EXCLUSIONS
  // ============================================

  /**
   * Get exclusion by ID
   */
  static async getExclusionById(id: string): Promise<IQualificationExclusion | null> {
    return FraudCaseModel.getExclusionById(id);
  }

  /**
   * Get exclusions by user
   */
  static async getExclusionsByUser(
    userId: string,
    userType: 'passenger' | 'driver'
  ): Promise<IQualificationExclusion[]> {
    return FraudCaseModel.getExclusionsByUser(userId, userType);
  }

  /**
   * Get exclusions by programme period
   */
  static async getExclusionsByPeriod(
    programmePeriodId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ exclusions: IQualificationExclusion[]; total: number }> {
    return FraudCaseModel.getExclusionsByPeriod(programmePeriodId, page, limit);
  }

  /**
   * Get active exclusions for a programme period
   */
  static async getActiveExclusions(programmePeriodId: string): Promise<IQualificationExclusion[]> {
    return FraudCaseModel.getActiveExclusions(programmePeriodId);
  }

  /**
   * Check if a user is excluded
   */
  static async isExcluded(
    userId: string,
    userType: 'passenger' | 'driver',
    programmePeriodId: string
  ): Promise<boolean> {
    return FraudCaseModel.isExcluded(userId, userType, programmePeriodId);
  }

  /**
   * Reverse an exclusion
   */
  static async reverseExclusion(
    exclusionId: string,
    reversedBy: string,
    reason?: string
  ): Promise<IQualificationExclusion | null> {
    return FraudCaseModel.reverseExclusion(exclusionId, reversedBy, reason);
  }

  /**
   * Get exclusion summary for a programme period
   */
  static async getExclusionSummary(programmePeriodId: string): Promise<{
    total: number;
    active: number;
    reversed: number;
    passengerCount: number;
    driverCount: number;
    byType: Record<string, number>;
  }> {
    return FraudCaseModel.getExclusionSummary(programmePeriodId);
  }

  // ============================================
  // FRAUD SUMMARY & MONITORING
  // ============================================

  /**
   * Get fraud summary for a programme period
   */
  static async getFraudSummary(programmePeriodId: string): Promise<{
    totalCases: number;
    byStatus: Record<FraudCaseStatus, number>;
    bySeverity: Record<FraudSeverity, number>;
    byType: Record<FraudCaseType, number>;
    pendingCount: number;
    highSuspicionCount: number;
  }> {
    const result = await FraudCaseModel.getByProgrammePeriod(programmePeriodId);
    const cases = result.cases;

    const byStatus: Record<FraudCaseStatus, number> = {
      detected: 0,
      investigating: 0,
      confirmed: 0,
      dismissed: 0,
      resolved: 0,
    };

    const bySeverity: Record<FraudSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    const byType: Record<FraudCaseType, number> = {
      collusion: 0,
      ghost_ride: 0,
      gps_spoofing: 0,
      payment_fraud: 0,
      account_abuse: 0,
      qualification_velocity: 0,
      other: 0,
    };

    let pendingCount = 0;
    let highSuspicionCount = 0;

    for (const fraudCase of cases) {
      byStatus[fraudCase.status] = (byStatus[fraudCase.status] || 0) + 1;
      bySeverity[fraudCase.severity] = (bySeverity[fraudCase.severity] || 0) + 1;
      byType[fraudCase.case_type] = (byType[fraudCase.case_type] || 0) + 1;

      if (fraudCase.status === 'detected' || fraudCase.status === 'investigating') {
        pendingCount++;
      }

      if (fraudCase.suspicion_score >= 70) {
        highSuspicionCount++;
      }
    }

    return {
      totalCases: cases.length,
      byStatus,
      bySeverity,
      byType,
      pendingCount,
      highSuspicionCount,
    };
  }

  /**
   * Get fraud cases with high suspicion score
   */
  static async getHighSuspicionCases(
    threshold: number = 70,
    page: number = 1,
    limit: number = 100
  ): Promise<{ cases: IFraudCase[]; total: number }> {
    return FraudCaseModel.getHighSuspicionCases(threshold, page, limit);
  }

  /**
   * Delete fraud case (for cleanup/testing)
   */
  static async deleteFraudCase(caseId: string): Promise<void> {
    await FraudCaseModel.delete(caseId);
    logger.warn(`Fraud case deleted: ${caseId}`);
  }

  // ============================================
  // BATCH PROCESSING
  // ============================================

  /**
   * Run fraud detection on all rides for a programme period
   * This is a batch job that should be run periodically
   */
  static async batchDetectFraud(programmePeriodId: string): Promise<{
    ridesChecked: number;
    fraudCasesCreated: number;
    highRiskRides: number;
  }> {
    // Get all rides for the programme period
    const rides = await pool.query(
      `SELECT * FROM rides 
       WHERE programme_period_id = $1 
         AND status = 'ride_completed'
         AND fraud_review_status = 'clean'
       ORDER BY created_at DESC`,
      [programmePeriodId]
    );

    let fraudCasesCreated = 0;
    let highRiskRides = 0;

    for (const ride of rides.rows) {
      const result = await this.detectRideFraud(ride);

      if (result.isFraudulent) {
        // Create fraud case
        const userType = ride.driver_id ? 'driver' : 'passenger';
        const userId = ride.driver_id || ride.passenger_id;

        // Check if a case already exists for this ride
        const existing = await pool.query(
          `SELECT id FROM incentive_fraud_cases 
           WHERE ride_ids @> ARRAY[$1] AND status != 'dismissed'`,
          [ride.id]
        );

        if (existing.rows.length === 0) {
          await this.createFraudCase(
            programmePeriodId,
            userId,
            userType,
            result,
            [ride.id]
          );
          fraudCasesCreated++;
        }

        if (result.suspicionScore >= 70) {
          highRiskRides++;
        }
      }
    }

    logger.info(`Batch fraud detection complete: ${rides.rows.length} rides checked, ${fraudCasesCreated} cases created`);

    return {
      ridesChecked: rides.rows.length,
      fraudCasesCreated,
      highRiskRides,
    };
  }
}

export default FraudDetectionService;