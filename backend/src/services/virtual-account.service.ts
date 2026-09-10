import { VirtualAccountModel } from '../models/virtual-account.model';
import { BankTransferEventModel } from '../models/bank-transfer-event.model';
import { LicensedPartnerService } from './licensed-partner.service';
import { WalletService } from './wallet.service';
import { UserModel } from '../models/user.model';
import { PassengerModel } from '../models/passenger.model';
import {
    IVirtualAccount,
    IBankTransferEvent
} from '../types/payment.types';
import logger from '../utils/logger';

export class VirtualAccountService {

    /**
     * Provision a virtual account for a passenger
     * Enhanced with split support for commission sharing
     * 
     * @param userId - The user ID to provision the account for
     * @param options - Optional configuration including split_code and subaccount
     * @returns The created virtual account
     */
    static async provisionVirtualAccount(
        userId: string,
        options?: { 
            split_code?: string; 
            subaccount?: string;
            preferred_bank?: string;
        }
    ): Promise<IVirtualAccount> {
        // Check if user already has an active virtual account
        const existing = await VirtualAccountModel.getByUserId(userId);
        if (existing && existing.status === 'active') {
            logger.debug(`User ${userId} already has an active virtual account: ${existing.account_number}`);
            return existing;
        }

        // Get user details
        const user = await UserModel.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Get passenger profile
        const passenger = await PassengerModel.getProfile(userId);
        if (!passenger) {
            throw new Error('Passenger profile not found');
        }

        // Prepare metadata with split information
        const metadata: Record<string, any> = {
            userId: userId,
            userType: 'passenger',
            phoneNumber: user.phone_number,
            email: user.email || '',
            passengerId: passenger.id,
        };

        // Add split configuration if provided
        if (options?.split_code) {
            metadata.split_code = options.split_code;
            logger.info(`Provisioning DVA with split_code: ${options.split_code} for user ${userId}`);
        }

        if (options?.subaccount) {
            metadata.subaccount = options.subaccount;
            logger.info(`Provisioning DVA with subaccount: ${options.subaccount} for user ${userId}`);
        }

        if (options?.preferred_bank) {
            metadata.preferred_bank = options.preferred_bank;
        }

        // Create virtual account via licensed partner (Paystack)
        const partnerResponse = await LicensedPartnerService.createVirtualAccount({
            accountName: `PingRide - ${passenger.first_name} ${passenger.last_name}`,
            accountReference: `PR-${userId.substring(0, 8)}-${Date.now()}`,
            metadata: metadata,
        });

        // Store virtual account in database
        const virtualAccount = await VirtualAccountModel.create({
            userId: userId,
            provider: partnerResponse.provider,
            providerAccountId: partnerResponse.accountId,
            accountNumber: partnerResponse.accountNumber,
            bankName: partnerResponse.bankName,
            accountName: partnerResponse.accountName,
            status: 'active',
            metadata: {
                ...partnerResponse.metadata,
                ...metadata,
                provisioned_at: new Date().toISOString(),
            },
        });

        // Link virtual account to passenger profile
        await PassengerModel.linkVirtualAccount(userId, virtualAccount.id);

        logger.info(`Virtual account provisioned for user ${userId}: ${virtualAccount.account_number}`, {
            bank: virtualAccount.bank_name,
            has_split: !!options?.split_code || !!options?.subaccount,
        });

        return virtualAccount;
    }

    /**
     * Get a passenger's virtual account details
     * Automatically provisions if no account exists
     * 
     * @param userId - The user ID
     * @param options - Optional configuration for provisioning
     * @returns The virtual account or null
     */
    static async getVirtualAccount(
        userId: string,
        options?: { 
            split_code?: string; 
            subaccount?: string;
            preferred_bank?: string;
        }
    ): Promise<IVirtualAccount | null> {
        let account = await VirtualAccountModel.getByUserId(userId);

        if (!account) {
            logger.info(`No virtual account found for user ${userId}, provisioning new account`);
            account = await this.provisionVirtualAccount(userId, options);
        }

        return account;
    }

    /**
     * Get virtual account by account number
     * 
     * @param accountNumber - The virtual account number
     * @returns The virtual account or null
     */
    static async getVirtualAccountByNumber(accountNumber: string): Promise<IVirtualAccount | null> {
        return VirtualAccountModel.getByAccountNumber(accountNumber);
    }

    /**
     * Get all accounts for a user
     * 
     * @param userId - The user ID
     * @returns Array of virtual accounts
     */
    static async getUserAccounts(userId: string): Promise<IVirtualAccount[]> {
        return VirtualAccountModel.getAllByUserId(userId);
    }

    /**
     * Handle a bank transfer webhook
     * Enhanced with split awareness for commission tracking
     * 
     * @param provider - The payment provider (e.g., 'paystack')
     * @param payload - The webhook payload
     * @param headers - The request headers
     * @returns Processing result
     */
    static async handleBankTransferWebhook(
        provider: string,
        payload: Record<string, any>,
        headers: Record<string, any>
    ): Promise<{ processed: boolean; message: string; eventId?: string }> {

        // Verify webhook signature
        const isValid = await LicensedPartnerService.verifyWebhookSignature(
            provider,
            payload,
            headers
        );

        if (!isValid) {
            logger.warn(`Invalid webhook signature from ${provider}`);
            return { processed: false, message: 'Invalid signature' };
        }

        // Extract payload data with fallbacks
        const transactionId = payload.transaction_id || payload.reference || payload.id;
        const accountNumber = payload.account_number || payload.account || payload.accountNumber;
        const amount = payload.amount || 0;
        const senderName = payload.sender_name || payload.senderName || 'Unknown';
        const senderAccount = payload.sender_account_number || payload.senderAccountNumber;
        const senderBank = payload.sender_bank || payload.senderBank;
        const narration = payload.narration || payload.description || '';
        const idempotencyKey = payload.idempotency_key || payload.idempotencyKey || transactionId;

        // Validate required fields
        if (!transactionId || !accountNumber || amount <= 0) {
            logger.warn('Invalid webhook payload - missing required fields', { 
                transactionId, 
                accountNumber, 
                amount 
            });
            return { processed: false, message: 'Invalid payload - missing required fields' };
        }

        // Check idempotency (prevent duplicate processing)
        const existingEvent = await BankTransferEventModel.getByIdempotencyKey(idempotencyKey);
        if (existingEvent) {
            logger.info(`Duplicate webhook ignored: ${idempotencyKey}`, {
                eventId: existingEvent.id,
                status: existingEvent.status,
            });
            return { 
                processed: true, 
                message: 'Duplicate webhook - already processed', 
                eventId: existingEvent.id 
            };
        }

        // Find virtual account
        const virtualAccount = await VirtualAccountModel.getByAccountNumber(accountNumber);
        if (!virtualAccount) {
            logger.warn(`Virtual account not found: ${accountNumber}`);
            
            // Log unmatched transfer for manual reconciliation
            await BankTransferEventModel.createUnmatched({
                provider: provider,
                providerTransactionId: transactionId,
                amount: amount,
                accountNumber: accountNumber,
                payload: payload,
                reason: 'account_not_found',
            });
            return { processed: false, message: 'Account not found' };
        }

        // ============================================
        // CHECK FOR SPLIT TRANSACTION
        // ============================================
        let splitData: any = null;
        const payloadMetadata = payload.metadata || {};
        
        // Check if this is a split transaction (Paystack DVA split)
        if (payloadMetadata.split) {
            splitData = payloadMetadata.split;
            logger.info('Split transaction detected in webhook', {
                split_code: splitData.split_code,
                subaccounts: splitData.subaccounts?.length || 0,
                transaction_id: transactionId,
            });
        }

        // Check for subaccount split
        if (payload.subaccount) {
            splitData = {
                ...splitData,
                subaccount: payload.subaccount,
            };
            logger.info('Subaccount split detected in webhook', {
                subaccount: payload.subaccount,
                transaction_id: transactionId,
            });
        }

        // Check if split is configured on the virtual account
        const vaMetadata = virtualAccount.metadata || {};
        if (vaMetadata.split_code || vaMetadata.subaccount) {
            splitData = {
                ...splitData,
                virtual_account_split_code: vaMetadata.split_code,
                virtual_account_subaccount: vaMetadata.subaccount,
            };
            logger.info('Virtual account has split configuration', {
                split_code: vaMetadata.split_code,
                subaccount: vaMetadata.subaccount,
                account_number: virtualAccount.account_number,
            });
        }

        // Create bank transfer event
        const event = await BankTransferEventModel.create({
            virtualAccountId: virtualAccount.id,
            userId: virtualAccount.user_id,
            providerTransactionId: transactionId,
            amount: amount,
            senderName: senderName,
            senderAccountNumber: senderAccount,
            senderBank: senderBank,
            narration: narration,
            idempotencyKey: idempotencyKey,
            status: 'pending',
        });

        try {
            // Credit the user's wallet
            const result = await WalletService.creditDepositedFunds(
                virtualAccount.user_id,
                event.amount,
                `Bank transfer from ${event.sender_name || 'Unknown'} (${event.provider_transaction_id})`,
                'bank_transfer',
                event.id,
                {
                    event_id: event.id,
                    sender_name: event.sender_name,
                    sender_account: event.sender_account_number,
                    // Include split information in transaction metadata
                    split: splitData,
                    webhook_payload: {
                        transaction_id: transactionId,
                        account_number: accountNumber,
                        provider: provider,
                    }
                }
            );

            // Mark the bank transfer event as credited
            await BankTransferEventModel.markCredited(event.id, result.transaction.id);

            // ============================================
            // RECORD SPLIT INFORMATION FOR RECONCILIATION
            // ============================================
            if (splitData) {
                await this.recordSplitTransaction(event.id, splitData, amount);
            }

            logger.info(`Bank transfer credited: ${event.amount} to user ${virtualAccount.user_id}`, {
                eventId: event.id,
                transactionId: transactionId,
                amount: event.amount,
                isSplit: !!splitData,
            });

            return {
                processed: true,
                message: 'Transfer processed successfully',
                eventId: event.id
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Failed to credit bank transfer: ${errorMessage}`, {
                eventId: event.id,
                transactionId: transactionId,
                userId: virtualAccount.user_id,
            });
            
            await BankTransferEventModel.markFailed(event.id, errorMessage);
            return { 
                processed: false, 
                message: `Failed to credit: ${errorMessage}`, 
                eventId: event.id 
            };
        }
    }

    /**
     * Record split transaction details for reconciliation
     * 
     * @param eventId - The bank transfer event ID
     * @param splitData - The split configuration data
     * @param totalAmount - The total transaction amount
     */
    private static async recordSplitTransaction(
        eventId: string,
        splitData: any,
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
                    split_code: splitData.split_code || null,
                    subaccount: splitData.subaccount || null,
                    subaccounts: splitData.subaccounts || [],
                    total_amount: totalAmount,
                },
            };

            // Direct update using pool query to avoid circular dependency
            const pool = (await import('../config/database')).default;
            await pool.query(
                `UPDATE bank_transfer_events 
                 SET metadata = $1, updated_at = NOW() 
                 WHERE id = $2`,
                [updatedMetadata, eventId]
            );

            // Log split subaccount details
            if (splitData.subaccounts && splitData.subaccounts.length > 0) {
                for (const subaccount of splitData.subaccounts) {
                    logger.info('Split subaccount details', {
                        eventId,
                        subaccount: subaccount.subaccount,
                        share: subaccount.share,
                        share_type: splitData.type || 'percentage',
                    });
                }
            }

            logger.info(`Split transaction recorded for event ${eventId}`, {
                split_code: splitData.split_code,
                subaccounts_count: splitData.subaccounts?.length || 0,
            });
        } catch (error) {
            // Don't fail the main flow if split recording fails
            logger.error('Error recording split transaction:', error);
        }
    }

    /**
     * Update virtual account status
     * 
     * @param accountId - The virtual account ID
     * @param status - The new status
     * @returns The updated virtual account
     */
    static async updateAccountStatus(
        accountId: string,
        status: 'pending' | 'active' | 'suspended' | 'closed'
    ): Promise<IVirtualAccount | null> {
        return VirtualAccountModel.updateStatus(accountId, status);
    }

    /**
     * Update KYC status
     * 
     * @param accountId - The virtual account ID
     * @param verified - Whether KYC is verified
     * @returns The updated virtual account
     */
    static async updateKycStatus(accountId: string, verified: boolean): Promise<IVirtualAccount | null> {
        return VirtualAccountModel.updateKycStatus(accountId, verified);
    }

    /**
     * Get pending bank transfer events for a user
     * 
     * @param userId - The user ID
     * @returns Array of pending bank transfer events
     */
    static async getPendingTransfers(userId: string): Promise<IBankTransferEvent[]> {
        const result = await BankTransferEventModel.getByUserId(userId);
        return result.events.filter((event: IBankTransferEvent) => event.status === 'pending');
    }

    /**
     * Reconcile a pending transfer manually
     * 
     * @param eventId - The bank transfer event ID
     * @returns The reconciled event or null
     */
    static async reconcileTransfer(eventId: string): Promise<IBankTransferEvent | null> {
        const event = await BankTransferEventModel.getById(eventId);
        if (!event) {
            return null;
        }

        if (event.status !== 'pending') {
            return event;
        }

        try {
            const result = await WalletService.creditDepositedFunds(
                event.user_id,
                event.amount,
                `Manual reconciliation - ${event.provider_transaction_id}`,
                'bank_transfer_reconciliation',
                event.id,
                {
                    reconciled_at: new Date().toISOString(),
                    reconciled_by: 'system',
                }
            );
            await BankTransferEventModel.markCredited(event.id, result.transaction.id);
            
            logger.info(`Transfer reconciled manually: ${eventId}`, {
                userId: event.user_id,
                amount: event.amount,
            });
            
            // Return updated event with metadata
            const updatedEvent = await BankTransferEventModel.getById(eventId);
            return updatedEvent;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Failed to reconcile transfer: ${eventId}`, { error: errorMessage });
            await BankTransferEventModel.markFailed(event.id, errorMessage);
            
            const updatedEvent = await BankTransferEventModel.getById(eventId);
            return updatedEvent;
        }
    }

    /**
     * Get virtual account with split configuration details
     * 
     * @param userId - The user ID
     * @returns Virtual account with split details
     */
    static async getVirtualAccountWithSplitDetails(userId: string): Promise<any> {
        const account = await VirtualAccountModel.getByUserId(userId);
        if (!account) {
            return null;
        }

        const metadata = account.metadata || {};
        return {
            ...account,
            split_configuration: {
                split_code: metadata.split_code || null,
                subaccount: metadata.subaccount || null,
                preferred_bank: metadata.preferred_bank || null,
            },
        };
    }

    /**
     * Update split configuration on an existing virtual account
     * 
     * @param userId - The user ID
     * @param splitConfig - The split configuration
     * @returns The updated virtual account
     */
    static async updateSplitConfiguration(
        userId: string,
        splitConfig: {
            split_code?: string;
            subaccount?: string;
            preferred_bank?: string;
        }
    ): Promise<IVirtualAccount | null> {
        const account = await VirtualAccountModel.getByUserId(userId);
        if (!account) {
            throw new Error('Virtual account not found');
        }

        const updatedMetadata = {
            ...(account.metadata || {}),
            split_code: splitConfig.split_code || account.metadata?.split_code,
            subaccount: splitConfig.subaccount || account.metadata?.subaccount,
            preferred_bank: splitConfig.preferred_bank || account.metadata?.preferred_bank,
            split_updated_at: new Date().toISOString(),
        };

        // Update the metadata directly
        const pool = (await import('../config/database')).default;
        const result = await pool.query(
            `UPDATE virtual_accounts 
             SET metadata = $1, updated_at = NOW() 
             WHERE id = $2
             RETURNING *`,
            [updatedMetadata, account.id]
        );

        if (result.rows.length === 0) {
            return null;
        }

        logger.info(`Split configuration updated for user ${userId}`, {
            split_code: splitConfig.split_code,
            subaccount: splitConfig.subaccount,
        });

        return result.rows[0];
    }

    /**
     * Check if a user has split configured on their virtual account
     * 
     * @param userId - The user ID
     * @returns True if split is configured
     */
    static async hasSplitConfigured(userId: string): Promise<boolean> {
        const account = await VirtualAccountModel.getByUserId(userId);
        if (!account) {
            return false;
        }

        const metadata = account.metadata || {};
        return !!(metadata.split_code || metadata.subaccount);
    }

    /**
     * Get split configuration for a user
     * 
     * @param userId - The user ID
     * @returns The split configuration or null
     */
    static async getSplitConfiguration(userId: string): Promise<{
        split_code: string | null;
        subaccount: string | null;
        preferred_bank: string | null;
    } | null> {
        const account = await VirtualAccountModel.getByUserId(userId);
        if (!account) {
            return null;
        }

        const metadata = account.metadata || {};
        return {
            split_code: metadata.split_code || null,
            subaccount: metadata.subaccount || null,
            preferred_bank: metadata.preferred_bank || null,
        };
    }
}

export default VirtualAccountService;