import { PaymentModel } from '../models/payment.model';
import { PaystackService } from './paystack.service';
import { PaymentService } from './payment.service';
import { VirtualAccountService } from './virtual-account.service';
import { LicensedPartnerService } from './licensed-partner.service';
import { WalletService } from './wallet.service';
import { IPaystackWebhookEvent } from '../types/payment.types';
import logger from '../utils/logger';
import pool from '../config/database';
import { DriverLedgerModel } from '../models/driver-ledger.model';
import { BankTransferEventModel } from '../models/bank-transfer-event.model';

export class WebhookService {
  // ============================================
  // PAYSTACK WEBHOOK HANDLER
  // ============================================

  /**
   * Handle Paystack webhook event
   * Supports both standard transactions and DVA transfers
   */
  static async handlePaystackWebhook(
    payload: any,
    headers: any
  ): Promise<{
    received: boolean;
    message: string;
    event?: string;
    reference?: string;
  }> {
    // Verify webhook signature
    const isValid = this.verifyPaystackSignature(payload, headers);
    if (!isValid) {
      logger.warn('Invalid Paystack webhook signature');
      return { received: false, message: 'Invalid signature' };
    }

    const event = payload as IPaystackWebhookEvent;
    const { eventType, reference, status, amount, isDVA, customerCode } = PaystackService.handleWebhookEvent(event);

    logger.info(`Processing Paystack webhook: ${eventType} for ${reference}`, {
      isDVA,
      customer: customerCode,
      amount,
    });

    // Handle different event types
    switch (eventType) {
      case 'charge.success':
        // Check if this is a DVA transfer (bank transfer to virtual account)
        if (isDVA && customerCode) {
          await this.handleDVATransfer(reference, status, amount, customerCode, event);
        } else {
          // Handle standard card payment (deprecated - card not used)
          // ✅ Enhanced: Pass event for split detection
          await this.handleChargeSuccess(reference, status, amount, event);
        }
        break;
      case 'charge.failed':
        await this.handleChargeFailed(reference);
        break;
      case 'transfer.success':
        await this.handleTransferSuccess(reference);
        break;
      case 'transfer.failed':
        await this.handleTransferFailed(reference);
        break;
      case 'transfer.reversed':
        await this.handleTransferReversed(reference);
        break;
      case 'refund.processed':
        await this.handleRefundProcessed(reference);
        break;
      case 'refund.failed':
        await this.handleRefundFailed(reference);
        break;
      default:
        logger.info(`Unhandled webhook event: ${eventType}`);
        break;
    }

    return {
      received: true,
      message: 'Webhook processed successfully',
      event: eventType,
      reference,
    };
  }

  /**
   * Verify Paystack webhook signature
   */
  private static verifyPaystackSignature(
    payload: any,
    headers: any
  ): boolean {
    const signature = headers['x-paystack-signature'];
    if (!signature) {
      logger.warn('Missing Paystack signature header');
      return false;
    }

    // Use PaystackService for proper signature verification
    return PaystackService.verifyDVAWebhookSignature(payload, signature);
  }

  // ============================================
  // PAYSTACK EVENT HANDLERS
  // ============================================

  /**
   * Handle DVA transfer (bank transfer to static virtual account)
   * This is the PRIMARY funding method for passengers
   * 
   * Enhanced with:
   * - Split transaction detection and recording
   * - Comprehensive metadata tracking
   * - Improved error handling and logging
   */
  private static async handleDVATransfer(
    reference: string,
    status: string,
    amount: number,
    customerCode: string,
    event?: IPaystackWebhookEvent
  ): Promise<void> {
    logger.info(`Processing DVA transfer: ${reference}`, {
      customerCode,
      amount,
      status,
    });

    if (status !== 'success') {
      logger.warn(`DVA transfer failed: ${reference} - ${status}`);
      return;
    }

    try {
      // Step 1: Check if transaction already processed (idempotency)
      const existingEvent = await BankTransferEventModel.getByIdempotencyKey(reference);
      if (existingEvent) {
        logger.info(`DVA transfer already processed: ${reference}`, {
          eventId: existingEvent.id,
          status: existingEvent.status,
        });
        return;
      }

      // Step 2: Get customer details from Paystack to find user
      const customerResponse = await PaystackService.getCustomer(customerCode);
      if (!customerResponse?.status) {
        logger.warn(`Customer not found: ${customerCode}`);
        
        // Log unmatched transfer for manual reconciliation
        await BankTransferEventModel.createUnmatched({
          provider: 'paystack',
          providerTransactionId: reference,
          amount: amount,
          accountNumber: 'unknown',
          payload: { customerCode, reference },
          reason: 'customer_not_found',
        });
        return;
      }

      const customer = customerResponse.data;
      const userId = customer.metadata?.pingride_user_id || customer.metadata?.user_id;

      if (!userId) {
        logger.warn(`User ID not found in customer metadata: ${customerCode}`, {
          customerCode,
          metadata: customer.metadata,
        });
        return;
      }

      // Step 3: Get virtual account details
      const virtualAccount = await VirtualAccountService.getVirtualAccount(userId);
      if (!virtualAccount) {
        logger.warn(`Virtual account not found for user: ${userId}`);
        return;
      }

      // ============================================
      // CHECK FOR SPLIT TRANSACTION
      // ============================================
      let splitInfo: any = null;
      
      // ✅ FIXED: Safely access event data and metadata
      const eventData = event?.data || {};
      const eventMetadata = (eventData as any)?.metadata || {};

      // Check if this is a split transaction
      if (eventMetadata.split) {
        splitInfo = eventMetadata.split;
        logger.info('Split transaction detected in DVA transfer', {
          reference,
          split_code: splitInfo.split_code,
          subaccounts_count: splitInfo.subaccounts?.length || 0,
        });
      }

      // Check for subaccount split
      if (eventMetadata.subaccount) {
        splitInfo = {
          ...splitInfo,
          subaccount: eventMetadata.subaccount,
        };
        logger.info('Subaccount split detected in DVA transfer', {
          reference,
          subaccount: eventMetadata.subaccount,
        });
      }

      // Check if split is configured on the virtual account
      const vaMetadata = virtualAccount.metadata || {};
      if (vaMetadata.split_code || vaMetadata.subaccount) {
        splitInfo = {
          ...splitInfo,
          virtual_account_split_code: vaMetadata.split_code,
          virtual_account_subaccount: vaMetadata.subaccount,
        };
      }

      // Step 4: Create bank transfer event with metadata
      const eventRecord = await BankTransferEventModel.create({
        virtualAccountId: virtualAccount.id,
        userId: userId,
        providerTransactionId: reference,
        amount: amount,
        senderName: (customer.first_name || '') + ' ' + (customer.last_name || '') || 'Paystack DVA Transfer',
        senderAccountNumber: virtualAccount.account_number,
        senderBank: 'Paystack DVA',
        narration: `DVA transfer via Paystack - ${reference}`,
        idempotencyKey: reference,
        status: 'pending',
        metadata: {
          customer_code: customerCode,
          customer_email: customer.email,
          customer_id: customer.id,
          split: splitInfo,
          webhook_received_at: new Date().toISOString(),
          source: 'paystack_dva',
        },
      });

      // Step 5: Credit the passenger's wallet
      const result = await WalletService.creditDepositedFunds(
        userId,
        amount,
        `Bank transfer to virtual account (${reference})`,
        'dva_transfer',
        eventRecord.id,
        {
          customer_code: customerCode,
          transaction_reference: reference,
          source: 'paystack_dva',
          split: splitInfo,
          event_id: eventRecord.id,
        }
      );

      // Step 6: Mark event as credited
      await BankTransferEventModel.markCredited(eventRecord.id, result.transaction.id);

      // ============================================
      // RECORD SPLIT INFORMATION IF APPLICABLE
      // ============================================
      if (splitInfo) {
        await this.recordSplitTransaction(eventRecord.id, splitInfo, amount);
      }

      logger.info(`DVA transfer credited: ${amount} to user ${userId} (${reference})`, {
        eventId: eventRecord.id,
        isSplit: !!splitInfo,
        splitCode: splitInfo?.split_code,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to process DVA transfer: ${reference}`, { 
        error: errorMessage,
        customerCode,
        amount,
      });
      
      // Try to update any existing event with failure status
      try {
        const existingEvent = await BankTransferEventModel.getByIdempotencyKey(reference);
        if (existingEvent) {
          await BankTransferEventModel.markFailed(existingEvent.id, errorMessage);
        }
      } catch (updateError) {
        logger.error('Failed to update event with failure status:', updateError);
      }
      
      // Don't throw - webhook should return 200 even if processing fails
      // The transaction will be reconciled manually
    }
  }

  /**
   * Record split transaction details for reconciliation
   * Each subaccount receives their share automatically via Paystack
   * We just need to log and track the split information
   * 
   * @param eventId - The bank transfer event ID
   * @param splitInfo - The split configuration data
   * @param totalAmount - The total transaction amount
   */
  private static async recordSplitTransaction(
    eventId: string,
    splitInfo: any,
    totalAmount: number
  ): Promise<void> {
    try {
      // Get the event to update with split information
      const event = await BankTransferEventModel.getById(eventId);
      if (!event) {
        logger.warn(`Event ${eventId} not found for split recording`);
        return;
      }

      // Build metadata with existing metadata or empty object
      const existingMetadata = event.metadata || {};

      // Update the event's metadata with split information
      const updatedMetadata = {
        ...existingMetadata,
        split: {
          detected_at: new Date().toISOString(),
          split_code: splitInfo.split_code || null,
          subaccount: splitInfo.subaccount || null,
          subaccounts: splitInfo.subaccounts || [],
          total_amount: totalAmount,
          type: splitInfo.type || 'percentage',
          recorded_at: new Date().toISOString(),
        },
      };

      // Direct update using pool query
      await pool.query(
        `UPDATE bank_transfer_events 
         SET metadata = $1, updated_at = NOW() 
         WHERE id = $2`,
        [updatedMetadata, eventId]
      );

      // Log split subaccount details
      if (splitInfo.subaccounts && splitInfo.subaccounts.length > 0) {
        for (const subaccount of splitInfo.subaccounts) {
          const shareAmount = splitInfo.type === 'percentage' 
            ? (totalAmount * (subaccount.share / 100))
            : subaccount.share;
          
          logger.info('Split subaccount details', {
            eventId,
            subaccount: subaccount.subaccount,
            share: subaccount.share,
            share_type: splitInfo.type || 'percentage',
            share_amount: shareAmount,
          });
        }
      }

      logger.info(`Split transaction recorded for event ${eventId}`, {
        split_code: splitInfo.split_code,
        subaccounts_count: splitInfo.subaccounts?.length || 0,
        total_amount: totalAmount,
      });
    } catch (error) {
      // Don't fail the main flow if split recording fails
      logger.error('Error recording split transaction:', error);
    }
  }

  /**
   * Handle charge.success event
   * Enhanced with split payment detection and handling
   * 
   * @param reference - Paystack transaction reference
   * @param status - Transaction status
   * @param amount - Transaction amount
   * @param event - Full webhook event data (optional)
   */
  private static async handleChargeSuccess(
    reference: string,
    status: string,
    amount: number,
    event?: IPaystackWebhookEvent
  ): Promise<void> {
    // Get payment by reference
    const payment = await PaymentModel.getByGatewayReference(reference);
    if (!payment) {
      logger.warn(`Payment not found for reference: ${reference}`);
      return;
    }
    
    // ============================================
    // CHECK FOR SPLIT TRANSACTION
    // ============================================
    const splitData = event?.data?.metadata?.split;
    
    if (splitData) {
      // ✅ This is a split payment - handle with PaymentService
      try {
        await PaymentService.handleSplitPaymentWebhook(reference, event!);
        logger.info(`Split payment processed successfully: ${reference}`, {
          paymentId: payment.id,
          amount: payment.amount,
          splitData,
        });
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Failed to process split payment webhook: ${reference}`, {
          error: errorMessage,
          paymentId: payment.id,
        });
        // Don't throw - webhook should return 200 even if processing fails
        // The transaction will be reconciled manually
        return;
      }
    }
    
    // ============================================
    // STANDARD PAYMENT (FALLBACK)
    // ============================================
    // Update payment status
    await PaymentModel.update(payment.id, {
      status: 'paid',
      gateway_response: { status, amount },
      paid_at: new Date(),
    });
    
    // Process successful payment
    await PaymentService.verifyPayment({ reference });
    logger.info(`Standard payment processed: ${reference}`);
  }

  /**
   * Handle charge.failed event
   */
  private static async handleChargeFailed(reference: string): Promise<void> {
    const payment = await PaymentModel.getByGatewayReference(reference);
    if (!payment) {
      logger.warn(`Payment not found for reference: ${reference}`);
      return;
    }

    // Update payment status
    await PaymentModel.update(payment.id, {
      status: 'failed',
      gateway_response: { status: 'failed' },
    });

    logger.warn(`Charge failed: ${reference}`);
  }

  /**
   * Handle transfer.success event
   */
  private static async handleTransferSuccess(reference: string): Promise<void> {
    // Find withdrawal by reference
    const result = await pool.query(
      'SELECT * FROM withdrawals WHERE reference = $1 OR provider_reference = $1',
      [reference]
    );

    if (result.rows.length === 0) {
      logger.warn(`Withdrawal not found for reference: ${reference}`);
      return;
    }

    const withdrawal = result.rows[0];

    // Update withdrawal status
    await pool.query(
      `UPDATE withdrawals 
       SET status = 'completed', 
           completed_at = NOW(), 
           updated_at = NOW()
       WHERE id = $1`,
      [withdrawal.id]
    );

    logger.info(`Transfer success: ${reference} completed`);
  }

  /**
   * Handle transfer.failed event
   */
  private static async handleTransferFailed(reference: string): Promise<void> {
    const result = await pool.query(
      'SELECT * FROM withdrawals WHERE reference = $1 OR provider_reference = $1',
      [reference]
    );

    if (result.rows.length === 0) {
      logger.warn(`Withdrawal not found for reference: ${reference}`);
      return;
    }

    const withdrawal = result.rows[0];

    // Update withdrawal status
    await pool.query(
      `UPDATE withdrawals 
       SET status = 'failed', 
           failure_reason = 'Transfer failed', 
           updated_at = NOW()
       WHERE id = $1`,
      [withdrawal.id]
    );

    // Release reserved funds back to driver
    await DriverLedgerModel.addDigitalEarnings(
      withdrawal.driver_id,
      withdrawal.amount
    );

    logger.warn(`Transfer failed: ${reference}`);
  }

  /**
   * Handle transfer.reversed event
   */
  private static async handleTransferReversed(reference: string): Promise<void> {
    const result = await pool.query(
      'SELECT * FROM withdrawals WHERE reference = $1 OR provider_reference = $1',
      [reference]
    );

    if (result.rows.length === 0) {
      logger.warn(`Withdrawal not found for reference: ${reference}`);
      return;
    }

    const withdrawal = result.rows[0];

    // Update withdrawal status
    await pool.query(
      `UPDATE withdrawals 
       SET status = 'cancelled', 
           failure_reason = 'Transfer reversed', 
           updated_at = NOW()
       WHERE id = $1`,
      [withdrawal.id]
    );

    // Credit back to driver wallet
    await this.creditBackWithdrawal(withdrawal);

    logger.warn(`Transfer reversed: ${reference}`);
  }

  /**
   * Handle refund.processed event
   */
  private static async handleRefundProcessed(reference: string): Promise<void> {
    const result = await pool.query(
      'SELECT * FROM refunds WHERE gateway_reference = $1',
      [reference]
    );

    if (result.rows.length === 0) {
      logger.warn(`Refund not found for reference: ${reference}`);
      return;
    }

    const refund = result.rows[0];

    // Update refund status
    await PaymentModel.updateRefundStatus(refund.id, 'processed', reference);

    logger.info(`Refund processed: ${reference}`);
  }

  /**
   * Handle refund.failed event
   */
  private static async handleRefundFailed(reference: string): Promise<void> {
    const result = await pool.query(
      'SELECT * FROM refunds WHERE gateway_reference = $1',
      [reference]
    );

    if (result.rows.length === 0) {
      logger.warn(`Refund not found for reference: ${reference}`);
      return;
    }

    const refund = result.rows[0];

    // Update refund status
    await PaymentModel.updateRefundStatus(refund.id, 'failed');

    logger.warn(`Refund failed: ${reference}`);
  }

  // ============================================
  // BANK TRANSFER WEBHOOK HANDLERS
  // ============================================

  /**
   * Handle a bank transfer webhook from licensed partner (generic)
   * This is used for non-Paystack providers
   */
  static async handleBankTransferWebhook(
    payload: any,
    headers: any
  ): Promise<{ received: boolean; message: string }> {
    try {
      const provider = LicensedPartnerService.getProvider();
      const result = await VirtualAccountService.handleBankTransferWebhook(
        provider,
        payload,
        headers
      );

      if (result.processed) {
        return { received: true, message: result.message || 'Bank transfer processed' };
      } else {
        return { received: false, message: result.message || 'Bank transfer processing failed' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error handling bank transfer webhook:', error);
      return { received: false, message: `Webhook processing failed: ${errorMessage}` };
    }
  }

  /**
   * Handle a card top-up webhook (deprecated - card not used)
   */
  static async handleCardTopUpWebhook(
    payload: any,
    headers: any
  ): Promise<{ received: boolean; message: string }> {
    try {
      // Verify signature
      const isValid = this.verifyPaystackSignature(payload, headers);
      if (!isValid) {
        logger.warn('Invalid Paystack webhook signature');
        return { received: false, message: 'Invalid signature' };
      }

      const event = payload as IPaystackWebhookEvent;
      const { eventType, reference, status, amount } = PaystackService.handleWebhookEvent(event);

      if (eventType === 'charge.success') {
        await this.handleChargeSuccess(reference, status, amount, event);
        return { received: true, message: 'Card top-up processed successfully' };
      } else if (eventType === 'charge.failed') {
        await this.handleChargeFailed(reference);
        return { received: true, message: 'Card top-up failed' };
      }

      return { received: true, message: `Unhandled Paystack event: ${eventType}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error handling card top-up webhook:', error);
      return { received: false, message: `Webhook processing failed: ${errorMessage}` };
    }
  }

  /**
   * Handle payout webhook
   */
  static async handlePayoutWebhook(
    payload: any,
    _headers: any
  ): Promise<{ received: boolean; message: string }> {
    try {
      const reference = payload.reference || payload.data?.reference;
      const status = payload.status || payload.data?.status;

      logger.info(`Payout webhook received: ${reference} - ${status}`);

      if (status === 'success' || status === 'completed') {
        const result = await pool.query(
          'SELECT * FROM withdrawals WHERE reference = $1 OR provider_reference = $1',
          [reference]
        );

        if (result.rows.length > 0) {
          const withdrawal = result.rows[0];
          await pool.query(
            `UPDATE withdrawals 
             SET status = 'completed', 
                 completed_at = NOW(), 
                 updated_at = NOW()
             WHERE id = $1`,
            [withdrawal.id]
          );
          logger.info(`Payout completed: ${reference}`);
        }
      } else if (status === 'failed') {
        const result = await pool.query(
          'SELECT * FROM withdrawals WHERE reference = $1 OR provider_reference = $1',
          [reference]
        );

        if (result.rows.length > 0) {
          const withdrawal = result.rows[0];
          await pool.query(
            `UPDATE withdrawals 
             SET status = 'failed', 
                 failure_reason = 'Payout failed', 
                 updated_at = NOW()
             WHERE id = $1`,
            [withdrawal.id]
          );
          logger.warn(`Payout failed: ${reference}`);
        }
      }

      return { received: true, message: 'Payout webhook handled' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error handling payout webhook:', error);
      return { received: false, message: `Webhook processing failed: ${errorMessage}` };
    }
  }

  /**
   * Handle refund webhook
   */
  static async handleRefundWebhook(
    payload: any,
    _headers: any
  ): Promise<{ received: boolean; message: string }> {
    try {
      const reference = payload.reference || payload.data?.reference;
      const status = payload.status || payload.data?.status;

      logger.info(`Refund webhook received: ${reference} - ${status}`);

      if (status === 'success' || status === 'processed') {
        const result = await pool.query(
          'SELECT * FROM refunds WHERE gateway_reference = $1',
          [reference]
        );

        if (result.rows.length > 0) {
          const refund = result.rows[0];
          await PaymentModel.updateRefundStatus(refund.id, 'processed', reference);
          logger.info(`Refund processed: ${reference}`);
        }
      } else if (status === 'failed') {
        const result = await pool.query(
          'SELECT * FROM refunds WHERE gateway_reference = $1',
          [reference]
        );

        if (result.rows.length > 0) {
          const refund = result.rows[0];
          await PaymentModel.updateRefundStatus(refund.id, 'failed');
          logger.warn(`Refund failed: ${reference}`);
        }
      }

      return { received: true, message: 'Refund webhook handled' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error handling refund webhook:', error);
      return { received: false, message: `Webhook processing failed: ${errorMessage}` };
    }
  }

  /**
   * Unified webhook dispatcher
   */
  static async handleWebhook(
    provider: string,
    eventType: string,
    payload: any,
    headers: any
  ): Promise<{ received: boolean; message: string }> {
    logger.info(`Webhook received: ${provider} - ${eventType}`);

    switch (eventType) {
      case 'bank_transfer.received':
      case 'virtual_account.credited':
      case 'transfer.received':
        // For Paystack DVA, this will be handled by charge.success with isDVA=true
        // For other providers, use the generic handler
        return await this.handleBankTransferWebhook(payload, headers);

      case 'charge.success':
      case 'charge.failed':
        // Paystack webhooks - includes DVA transfers
        return await this.handlePaystackWebhook(payload, headers);

      case 'payout.success':
      case 'payout.failed':
      case 'payout.completed':
        return await this.handlePayoutWebhook(payload, headers);

      case 'refund.processed':
      case 'refund.failed':
      case 'refund.success':
        return await this.handleRefundWebhook(payload, headers);

      default:
        logger.warn(`Unhandled webhook event: ${eventType}`);
        return { received: true, message: `Unhandled event type: ${eventType}` };
    }
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Credit back withdrawal amount to driver
   */
  private static async creditBackWithdrawal(withdrawal: any): Promise<void> {
    // Get driver ledger
    const ledger = await DriverLedgerModel.getByDriverId(withdrawal.driver_id);
    if (ledger) {
      // Add back to withdrawable balance
      await DriverLedgerModel.addDigitalEarnings(
        withdrawal.driver_id,
        withdrawal.amount
      );
    }

    // Credit wallet if exists
    const wallet = await pool.query(
      'SELECT * FROM wallets WHERE id = $1',
      [withdrawal.wallet_id]
    );

    if (wallet.rows.length > 0) {
      await pool.query(
        'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
        [withdrawal.amount, withdrawal.wallet_id]
      );
    }

    logger.info(`Withdrawal amount credited back: ${withdrawal.amount}`);
  }
}

export default WebhookService;