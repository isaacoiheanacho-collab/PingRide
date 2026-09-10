// ============================================
// PAYMENT SERVICE - UPDATED SPLIT PERCENTAGES
// Driver: 84%, PingRide: 15%, Rebate: 1%
// ============================================

import { PaymentModel } from '../models/payment.model';
import { WalletModel } from '../models/wallet.model';
import { DriverLedgerModel } from '../models/driver-ledger.model';
import { PassengerModel } from '../models/passenger.model';
import { DriverModel } from '../models/driver.model';
import { PaystackService } from './paystack.service';
import { WalletService } from './wallet.service';
import { 
  IPayment, 
  IInitializePaymentRequest,
  IInitializePaymentResponse,
  IVerifyPaymentRequest,
  IProcessPaymentRequest,
  IRefundRequest,
  IRefund,
  IWalletTransaction,
  PaymentStatus,
  ISplitPaymentRequest,
  ISplitPaymentResponse,
  ISplitConfig,
  IPaystackWebhookEvent
} from '../types/payment.types';
import { env } from '../config/env';
import logger from '../utils/logger';
import pool from '../config/database';

export class PaymentService {
  private static readonly COMMISSION_RATE = env.commissionRate || 0.15; // 15%

  // ============================================
  // PAYMENT PROCESSING
  // ============================================

  /**
   * Initialize a payment
   * ONLY supports wallet payments - NO CARD
   * Card is NOT used anywhere in PingRide
   */
  static async initializePayment(
    data: IInitializePaymentRequest
  ): Promise<IInitializePaymentResponse> {
    // Validate payment method - ONLY wallet allowed
    if (data.payment_method !== 'wallet') {
      throw new Error('Only wallet payments are supported. Please fund your wallet via bank transfer to your virtual account.');
    }

    // Get the ride details
    const payment = await PaymentModel.create({
      ride_id: data.ride_id,
      passenger_id: data.passenger_id,
      amount: data.amount,
      payment_method: data.payment_method,
      payment_type: 'ride'
    });

    // Generate reference
    const reference = PaystackService.generateReference();

    // For wallet payment, process immediately
    if (data.payment_method === 'wallet') {
      const result = await this.processWalletPayment(payment.id);
      return {
        authorization_url: '',
        reference: result.payment.gateway_reference || reference,
        access_code: '',
      };
    }

    throw new Error('Invalid payment method');
  }

  /**
   * Verify a payment
   */
  static async verifyPayment(
    data: IVerifyPaymentRequest
  ): Promise<IPayment> {
    // Verify with Paystack
    const paystackResponse = await PaystackService.verifyTransaction(data.reference);

    if (!paystackResponse.status) {
      throw new Error('Payment verification failed');
    }

    // Get payment by reference
    const payment = await PaymentModel.getByGatewayReference(data.reference);
    if (!payment) {
      throw new Error('Payment not found');
    }

    const status = this.mapPaystackStatus(paystackResponse.data.status) as PaymentStatus;
    
    const updatedPayment = await PaymentModel.update(payment.id, {
      status,
      gateway_response: paystackResponse.data,
      paid_at: paystackResponse.data.paid_at ? new Date(paystackResponse.data.paid_at) : undefined,
    });

    // If payment is successful, process the payment
    if (status === 'paid') {
      await this.processSuccessfulPayment(updatedPayment!);
    }

    logger.info(`Payment verified: ${payment.id} with status ${status}`);
    return updatedPayment!;
  }

  /**
   * Process a payment
   */
  static async processPayment(
    data: IProcessPaymentRequest
  ): Promise<IPayment> {
    const payment = await PaymentModel.getById(data.payment_id);
    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== 'pending' && payment.status !== 'authorised') {
      throw new Error('Payment is not in processable state');
    }

    // Capture payment
    const updatedPayment = await PaymentModel.update(payment.id, {
      status: 'paid',
      captured_at: new Date(),
      paid_at: new Date(),
    });

    // Process successful payment
    await this.processSuccessfulPayment(updatedPayment!);

    logger.info(`Payment processed: ${payment.id}`);
    return updatedPayment!;
  }

  /**
   * Process a successful payment
   * Handles commission, driver earnings, wallet updates
   */
  private static async processSuccessfulPayment(payment: IPayment): Promise<void> {
    const commissionRate = payment.commission_rate || this.COMMISSION_RATE;
    const commissionAmount = payment.amount * commissionRate;
    const driverEarnings = payment.amount - commissionAmount;

    // Update payment with commission details
    await PaymentModel.update(payment.id, {
      commission_amount: commissionAmount,
      commission_rate: commissionRate,
      driver_earnings: driverEarnings,
      processed_at: new Date(),
    });

    // Credit driver's ledger
    if (payment.driver_id) {
      const ledger = await DriverLedgerModel.createIfNotExists(payment.driver_id);
      
      // Add digital earnings
      await DriverLedgerModel.addDigitalEarnings(payment.driver_id, driverEarnings);
      
      // Deduct commission
      await DriverLedgerModel.deductCommission(payment.driver_id, commissionAmount);

      // Create ledger transaction
      await DriverLedgerModel.createTransaction({
        driver_ledger_id: ledger.id,
        transaction_type: 'earning',
        amount: driverEarnings,
        balance_before: ledger.net_balance,
        balance_after: ledger.net_balance + driverEarnings,
        reference_type: 'payment',
        reference_id: payment.id,
        description: `Ride payment: ${payment.ride_id || 'N/A'}`,
      });

      logger.info(`Driver earnings credited: ${payment.driver_id}, amount: ${driverEarnings}`);
    }

    // Debit passenger's wallet if wallet payment
    if (payment.payment_method === 'wallet' && payment.passenger_id) {
      // Get passenger user ID
      const passenger = await this.getPassengerUserId(payment.passenger_id);
      if (passenger) {
        await WalletService.processPayment(
          passenger,
          payment.amount,
          payment.id,
          { payment_id: payment.id }
        );
      }
    }
  }

  /**
   * Process a wallet payment
   */
  private static async processWalletPayment(
    paymentId: string
  ): Promise<{ payment: IPayment; transaction: IWalletTransaction }> {
    const payment = await PaymentModel.getById(paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    // Get passenger user ID
    const passengerUserId = await this.getPassengerUserId(payment.passenger_id);
    if (!passengerUserId) {
      throw new Error('Passenger user not found');
    }

    // Check wallet balance
    const wallet = await WalletModel.getByUserId(passengerUserId);
    if (!wallet || wallet.balance < payment.amount) {
      throw new Error('Insufficient wallet balance. Please fund your wallet via bank transfer to your virtual account.');
    }

    // Debit wallet
    const debitResult = await WalletService.debit(
      passengerUserId,
      payment.amount,
      'Ride payment',
      'payment',
      paymentId,
      { ride_id: payment.ride_id }
    );

    // Mark payment as paid
    const updatedPayment = await PaymentModel.update(paymentId, {
      status: 'paid',
      paid_at: new Date(),
      processed_at: new Date(),
    });

    // Process successful payment
    await this.processSuccessfulPayment(updatedPayment!);

    logger.info(`Wallet payment processed: ${paymentId}`);
    return {
      payment: updatedPayment!,
      transaction: debitResult.transaction,
    };
  }

  // ============================================
  // SPLIT PAYMENT METHODS
  // ============================================

  /**
   * Initialize a split payment for a ride
   * 
   * SPLIT BREAKDOWN:
   * - Driver: 84% (paid directly to driver subaccount)
   * - PingRide: 15% (commission)
   * - Rebate: 1% (rebate fund)
   * - Total: 100%
   */
  static async initializeSplitPayment(
    data: ISplitPaymentRequest
  ): Promise<ISplitPaymentResponse> {
    // 1. Get driver details
    const driver = await DriverModel.getById(data.driver_id);
    if (!driver) {
      throw new Error('Driver not found');
    }
    
    // 2. Validate driver has subaccount
    if (!driver.subaccount_code || driver.subaccount_status !== 'active') {
      throw new Error('Driver does not have an active subaccount');
    }
    
    // 3. Get subaccount codes from environment
    const pingrideSubaccount = process.env.PINGRIDE_SUBACCOUNT_CODE;
    const rebateSubaccount = process.env.REBATE_SUBACCOUNT_CODE;
    
    if (!pingrideSubaccount || !rebateSubaccount) {
      throw new Error('Subaccount configuration missing. Please set PINGRIDE_SUBACCOUNT_CODE and REBATE_SUBACCOUNT_CODE in environment.');
    }
    
    // 4. ✅ UPDATED: Get split percentages with new defaults
    // Driver: 84%, PingRide: 15%, Rebate: 1%
    const driverSplit = parseFloat(process.env.DRIVER_SPLIT_PERCENTAGE || '84.0');
    const pingrideSplit = parseFloat(process.env.PINGRIDE_SPLIT_PERCENTAGE || '15.0');
    const rebateSplit = parseFloat(process.env.REBATE_SPLIT_PERCENTAGE || '1.0');
    
    // Validate percentages sum to 100
    const totalSplit = driverSplit + pingrideSplit + rebateSplit;
    if (Math.abs(totalSplit - 100) > 0.01) {
      logger.warn(`Split percentages do not sum to 100%. Current total: ${totalSplit}%`);
    }
    
    // 5. Create split configuration
    const splitConfig: ISplitConfig = {
      type: 'percentage',
      currency: 'NGN',
      subaccounts: [
        {
          subaccount: driver.subaccount_code,
          share: driverSplit
        },
        {
          subaccount: pingrideSubaccount,
          share: pingrideSplit
        },
        {
          subaccount: rebateSubaccount,
          share: rebateSplit
        }
      ]
    };
    
    logger.info(`Creating split payment for ride ${data.ride_id}`, {
      driver: data.driver_id,
      driverSubaccount: driver.subaccount_code,
      driverShare: driverSplit,
      pingrideShare: pingrideSplit,
      rebateShare: rebateSplit,
      amount: data.amount,
    });
    
    // 6. Create payment record
    const payment = await PaymentModel.create({
      ride_id: data.ride_id,
      passenger_id: data.passenger_id,
      driver_id: data.driver_id,
      amount: data.amount,
      payment_method: 'wallet',
      payment_type: 'ride',
    });
    
    // 7. Initialize Paystack transaction with split
    const reference = PaystackService.generateReference();
    const response = await PaystackService.initializeTransaction({
      email: data.passenger_email,
      amount: PaystackService.toKobo(data.amount),
      reference: reference,
      split: splitConfig,
      metadata: {
        ride_id: data.ride_id,
        passenger_id: data.passenger_id,
        driver_id: data.driver_id,
        payment_id: payment.id,
        payment_type: 'split',
        split: {
          driver_share: data.amount * (driverSplit / 100),
          pingride_share: data.amount * (pingrideSplit / 100),
          rebate_share: data.amount * (rebateSplit / 100),
          driver_subaccount: driver.subaccount_code,
          pingride_subaccount: pingrideSubaccount,
          rebate_subaccount: rebateSubaccount,
          split_config: splitConfig,
        }
      }
    });
    
    // 8. Update payment with gateway reference
    await PaymentModel.update(payment.id, {
      gateway_reference: reference,
      gateway_response: response.data,
    });
    
    logger.info(`Split payment initialized: ${reference} for ride ${data.ride_id}`);
    
    return {
      authorization_url: response.data.authorization_url,
      reference: reference,
      access_code: response.data.access_code,
      payment_id: payment.id,
    };
  }

  /**
   * Handle split payment webhook
   */
  static async handleSplitPaymentWebhook(
    reference: string,
    event: IPaystackWebhookEvent
  ): Promise<void> {
    // Get payment
    const payment = await PaymentModel.getByGatewayReference(reference);
    if (!payment) {
      logger.error(`Payment not found for split webhook: ${reference}`);
      throw new Error('Payment not found');
    }
    
    // Update payment status
    await PaymentModel.update(payment.id, {
      status: 'paid',
      paid_at: new Date(),
      gateway_response: event.data,
    });
    
    // Calculate commission and driver earnings
    const commissionRate = env.commissionRate || 0.15; // 15%
    const commissionAmount = payment.amount * commissionRate;
    const driverEarnings = payment.amount - commissionAmount;
    
    await PaymentModel.update(payment.id, {
      commission_amount: commissionAmount,
      commission_rate: commissionRate,
      driver_earnings: driverEarnings,
      processed_at: new Date(),
    });
    
    // Credit driver's ledger
    if (payment.driver_id) {
      await DriverLedgerModel.addDigitalEarnings(
        payment.driver_id,
        driverEarnings
      );
      
      // Create ledger transaction
      const ledger = await DriverLedgerModel.createIfNotExists(payment.driver_id);
      await DriverLedgerModel.createTransaction({
        driver_ledger_id: ledger.id,
        transaction_type: 'earning',
        amount: driverEarnings,
        balance_before: ledger.net_balance,
        balance_after: ledger.net_balance + driverEarnings,
        reference_type: 'payment',
        reference_id: payment.id,
        description: `Split ride payment: ${payment.ride_id || 'N/A'}`,
      });
      
      logger.info(`Driver earnings credited via split webhook: ${payment.driver_id}, amount: ${driverEarnings}`);
    }
    
    // Track qualification if ride_id exists
    if (payment.ride_id) {
      await this.trackRideForQualification(
        payment.ride_id,
        payment.passenger_id,
        payment.driver_id,
        payment.amount
      );
    } else {
      logger.warn(`No ride_id found for payment ${payment.id}, skipping qualification tracking`);
    }
    
    logger.info(`Split payment webhook processed: ${reference}`, {
      paymentId: payment.id,
      amount: payment.amount,
      commission: commissionAmount,
      driverEarnings: driverEarnings,
    });
  }

  /**
   * Get split configuration for a ride payment
   * 
   * SPLIT BREAKDOWN:
   * - Driver: 84% (paid directly to driver subaccount)
   * - PingRide: 15% (commission)
   * - Rebate: 1% (rebate fund)
   * - Total: 100%
   */
  static async getSplitConfigForRide(driverId: string): Promise<{
    driverSplit: number;
    pingrideSplit: number;
    rebateSplit: number;
    driverSubaccount: string;
    pingrideSubaccount: string;
    rebateSubaccount: string;
  }> {
    // Get driver details
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      throw new Error('Driver not found');
    }
    
    if (!driver.subaccount_code || driver.subaccount_status !== 'active') {
      throw new Error('Driver does not have an active subaccount');
    }
    
    // Get subaccount codes from environment
    const pingrideSubaccount = process.env.PINGRIDE_SUBACCOUNT_CODE;
    const rebateSubaccount = process.env.REBATE_SUBACCOUNT_CODE;
    
    if (!pingrideSubaccount || !rebateSubaccount) {
      throw new Error('Subaccount configuration missing');
    }
    
    // ✅ UPDATED: Get split percentages with new defaults
    // Driver: 84%, PingRide: 15%, Rebate: 1%
    const driverSplit = parseFloat(process.env.DRIVER_SPLIT_PERCENTAGE || '84.0');
    const pingrideSplit = parseFloat(process.env.PINGRIDE_SPLIT_PERCENTAGE || '15.0');
    const rebateSplit = parseFloat(process.env.REBATE_SPLIT_PERCENTAGE || '1.0');
    
    return {
      driverSplit,
      pingrideSplit,
      rebateSplit,
      driverSubaccount: driver.subaccount_code,
      pingrideSubaccount: pingrideSubaccount,
      rebateSubaccount: rebateSubaccount,
    };
  }

  // ============================================
  // REFUNDS
  // ============================================

  /**
   * Create a refund
   */
  static async createRefund(
    data: IRefundRequest
  ): Promise<IRefund> {
    const payment = await PaymentModel.getById(data.payment_id);
    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== 'paid') {
      throw new Error('Only paid payments can be refunded');
    }

    // Create refund record
    const refund = await PaymentModel.createRefund({
      transaction_id: payment.id,
      ride_id: payment.ride_id || '',
      passenger_id: payment.passenger_id,
      refund_amount: data.amount,
      reason: data.reason,
      initiated_by: payment.passenger_id,
    });

    // Process refund based on payment method
    if (payment.gateway_reference) {
      // Paystack refund
      const paystackRefund = await PaystackService.createRefund(
        payment.gateway_reference,
        PaystackService.toKobo(data.amount)
      );

      await PaymentModel.updateRefundStatus(refund.id, 'processed', paystackRefund.data.reference);
    } else {
      // Wallet refund
      const passengerUserId = await this.getPassengerUserId(payment.passenger_id);
      if (passengerUserId) {
        await WalletService.refund(
          passengerUserId,
          data.amount,
          payment.id,
          { refund_id: refund.id }
        );
      }

      await PaymentModel.updateRefundStatus(refund.id, 'processed');
    }

    // Update payment status
    await PaymentModel.update(payment.id, {
      status: 'refunded'
    });

    logger.info(`Refund created: ${refund.id} for payment ${payment.id}`);
    return refund;
  }

  // ============================================
  // PAYMENT LOOKUP
  // ============================================

  /**
   * Get payment by ID
   */
  static async getPaymentById(id: string): Promise<IPayment | null> {
    return PaymentModel.getById(id);
  }

  /**
   * Get payment with details
   */
  static async getPaymentWithDetails(id: string): Promise<any> {
    return PaymentModel.getWithDetails(id);
  }

  /**
   * Get payments by passenger
   */
  static async getPaymentsByPassenger(
    passengerId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ payments: IPayment[]; total: number }> {
    return PaymentModel.getByPassengerId(passengerId, page, limit);
  }

  /**
   * Get payments by driver
   */
  static async getPaymentsByDriver(
    driverId: string,
    page: number = 1,
    limit: number = 100
  ): Promise<{ payments: IPayment[]; total: number }> {
    return PaymentModel.getByDriverId(driverId, page, limit);
  }

  /**
   * Get all payments
   */
  static async getAllPayments(
    page: number = 1,
    limit: number = 100,
    filters?: {
      status?: string;
      payment_method?: string;
      payment_type?: string;
      start_date?: Date;
      end_date?: Date;
    }
  ): Promise<{ payments: IPayment[]; total: number }> {
    return PaymentModel.getAll(page, limit, filters);
  }

  // ============================================
  // PAYMENT SUMMARY
  // ============================================

  /**
   * Get payment summary
   */
  static async getPaymentSummary(): Promise<{
    totalRevenue: number;
    totalCommission: number;
    totalRefunded: number;
    countByStatus: Record<string, number>;
  }> {
    const [totalRevenue, totalCommission, totalRefunded, countByStatus] = await Promise.all([
      PaymentModel.getTotalRevenue(),
      PaymentModel.getTotalCommission(),
      PaymentModel.getTotalRefunded(),
      PaymentModel.getCountByStatus()
    ]);

    return {
      totalRevenue,
      totalCommission,
      totalRefunded,
      countByStatus,
    };
  }

  // ============================================
  // RIDE PAYMENT WITH WALLET
  // ============================================

  /**
   * Process ride payment using wallet (with priority)
   */
  static async processRidePaymentWithWallet(
    passengerUserId: string,
    rideId: string,
    amount: number,
    rideDetails?: any
  ): Promise<{
    success: boolean;
    payment: IPayment;
    transactions: IWalletTransaction[];
    usedCredits: { type: string; amount: number }[];
  }> {
    // Step 1: Pay using wallet (credits first, then deposits)
    const result = await WalletService.payForRide(
      passengerUserId,
      rideId,
      amount,
      { ride_id: rideId, source: 'ride_payment' }
    );

    // Step 2: Create payment record
    const payment = await PaymentModel.create({
      ride_id: rideId,
      passenger_id: rideDetails?.passengerId || passengerUserId,
      driver_id: rideDetails?.driverId,
      amount: amount,
      payment_method: 'wallet',
      payment_type: 'ride'
    });

    // Step 3: Update payment with paid status
    await PaymentModel.update(payment.id, {
      status: 'paid',
      paid_at: new Date(),
      processed_at: new Date(),
    });

    // Step 4: Calculate and record allocation
    const commissionRate = env.commissionRate || 0.15; // 15%
    const commissionAmount = amount * commissionRate;
    const driverEarnings = amount - commissionAmount;

    await PaymentModel.update(payment.id, {
      commission_amount: commissionAmount,
      commission_rate: commissionRate,
      driver_earnings: driverEarnings,
    });

    // Step 5: Credit driver's ledger using DriverLedgerModel directly
    if (rideDetails?.driverId) {
      try {
        // Create ledger if not exists
        const ledger = await DriverLedgerModel.createIfNotExists(rideDetails.driverId);
        
        // Add digital earnings
        await DriverLedgerModel.addDigitalEarnings(rideDetails.driverId, driverEarnings);
        
        // Deduct commission
        await DriverLedgerModel.deductCommission(rideDetails.driverId, commissionAmount);

        // Create ledger transaction
        await DriverLedgerModel.createTransaction({
          driver_ledger_id: ledger.id,
          transaction_type: 'earning',
          amount: driverEarnings,
          balance_before: ledger.net_balance,
          balance_after: ledger.net_balance + driverEarnings,
          reference_type: 'payment',
          reference_id: payment.id,
          description: `Ride payment - ${rideId}`,
        });

        logger.info(`Driver earnings credited: ${rideDetails.driverId}, amount: ${driverEarnings}`);
      } catch (error) {
        logger.error(`Failed to credit driver earnings for ${rideDetails.driverId}:`, error);
        // Don't fail the payment if ledger update fails
      }
    }

    // Step 6: Trigger qualification tracking
    await this.trackRideForQualification(rideId, passengerUserId, rideDetails?.driverId, amount);

    // Get the updated payment
    const updatedPayment = await PaymentModel.getById(payment.id);

    return {
      success: true,
      payment: updatedPayment!,
      transactions: result.transactions,
      usedCredits: result.usedCredits,
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Map Paystack status to internal status
   */
  private static mapPaystackStatus(paystackStatus: string): string {
    switch (paystackStatus) {
      case 'success':
        return 'paid';
      case 'failed':
        return 'failed';
      case 'abandoned':
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  /**
   * Get passenger user ID from passenger profile ID
   */
  private static async getPassengerUserId(
    passengerId: string
  ): Promise<string | null> {
    const result = await pool.query(
      'SELECT user_id FROM passenger_profiles WHERE id = $1',
      [passengerId]
    );
    return result.rows[0]?.user_id || null;
  }

  /**
   * Get payment stats for a passenger
   */
  static async getPassengerPaymentStats(
    passengerId: string
  ): Promise<{
    totalPayments: number;
    totalSpent: number;
    totalRefunded: number;
    lastPaymentDate: Date | null;
  }> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_payments,
        COALESCE(SUM(amount), 0) as total_spent,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END) as total_refunded,
        MAX(created_at) as last_payment_date
       FROM payments
       WHERE passenger_id = $1 AND status = 'paid'`,
      [passengerId]
    );

    const row = result.rows[0];
    return {
      totalPayments: parseInt(row?.total_payments || '0', 10),
      totalSpent: parseFloat(row?.total_spent || '0'),
      totalRefunded: parseInt(row?.total_refunded || '0', 10),
      lastPaymentDate: row?.last_payment_date ? new Date(row.last_payment_date) : null,
    };
  }

  /**
   * Get payment stats for a driver
   */
  static async getDriverPaymentStats(
    driverId: string
  ): Promise<{
    totalPayments: number;
    totalEarnings: number;
    totalCommission: number;
    lastPaymentDate: Date | null;
  }> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_payments,
        COALESCE(SUM(driver_earnings), 0) as total_earnings,
        COALESCE(SUM(commission_amount), 0) as total_commission,
        MAX(created_at) as last_payment_date
       FROM payments
       WHERE driver_id = $1 AND status = 'paid'`,
      [driverId]
    );

    const row = result.rows[0];
    return {
      totalPayments: parseInt(row?.total_payments || '0', 10),
      totalEarnings: parseFloat(row?.total_earnings || '0'),
      totalCommission: parseFloat(row?.total_commission || '0'),
      lastPaymentDate: row?.last_payment_date ? new Date(row.last_payment_date) : null,
    };
  }

  /**
   * Track ride for qualification (V2.0)
   */
  private static async trackRideForQualification(
    rideId: string,
    passengerUserId: string,
    driverId: string | null | undefined,
    amount: number
  ): Promise<void> {
    try {
      // Get passenger profile ID
      const passenger = await PassengerModel.getProfile(passengerUserId);
      if (!passenger) {
        logger.warn(`Passenger profile not found for user ${passengerUserId}, skipping qualification tracking`);
        return;
      }

      // Get current programme period
      const { ProgrammePeriodModel } = await import('../models/programme-period.model');
      const period = await ProgrammePeriodModel.getCurrent();
      if (!period) {
        logger.warn('No active programme period found, skipping qualification tracking');
        return;
      }

      // Track passenger spend
      const { QualificationService } = await import('./qualification.service');
      await QualificationService.trackPassengerSpend(
        passenger.id,
        rideId,
        amount
      );

      // Track driver contribution - only if driverId exists
      if (driverId) {
        const commissionRate = env.commissionRate || 0.15;
        const driverEarnings = amount * (1 - commissionRate);
        await QualificationService.trackDriverContribution(
          driverId,
          rideId,
          driverEarnings
        );
      }

      // Record rebate contribution
      const { RebateFundService } = await import('./rebate-fund.service');
      await RebateFundService.recordContribution(
        rideId,
        passenger.id,
        amount
      );
      
      logger.debug(`Qualification tracked for ride ${rideId}`);
    } catch (error) {
      logger.error('Error tracking ride qualification:', error);
      // Don't fail the payment
    }
  }
}

export default PaymentService;