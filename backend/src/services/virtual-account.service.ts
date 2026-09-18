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
import pool from '../config/database';

export class VirtualAccountService {

    /**
     * Provision a virtual account for a passenger.
     *
     * Phase 2A flow:
     *   1. POST /customer                     → customer_code
     *   2. POST /customer/{code}/identification (BVN + bank) → 202 Accepted
     *   3. POST /dedicated_account            → DVA number (Wema Bank)
     *
     * If `bvn`, `bank_account_number`, and `bank_code` are provided, the
     * identification step runs and Paystack validates against NIBSS. The
     * DVA is issued regardless (Paystack returns 202 Accepted on the
     * identification call and continues processing in the background).
     */
    static async provisionVirtualAccount(
        userId: string,
        options?: {
            split_code?: string;
            subaccount?: string;
            preferred_bank?: string;
            bvn?: string;
            bank_account_number?: string;
            bank_code?: string;
            bank_name?: string;
            email?: string;
            firstName?: string;
            lastName?: string;
        }
    ): Promise<IVirtualAccount> {
        // Idempotency — if user already has an active DVA, return it
        const existing = await VirtualAccountModel.getByUserId(userId);
        if (existing && existing.status === 'active') {
            logger.debug(`User ${userId} already has an active virtual account: ${existing.account_number}`);
            return existing;
        }

        // Load user + passenger profile
        const user = await UserModel.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const passenger = await PassengerModel.getProfile(userId);
        if (!passenger) {
            throw new Error('Passenger profile not found');
        }

        const firstName = options?.firstName || passenger.first_name;
        const lastName = options?.lastName || passenger.last_name;
        const email = options?.email || user.email || '';

        // Build metadata — everything Paystack needs to build the customer
        // and submit NIBSS identification.
        const metadata: Record<string, any> = {
            userId,
            userType: 'passenger',
            phoneNumber: user.phone_number,
            email,
            passengerId: passenger.id,
            firstName,
            lastName,
        };

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

        // Phase 2A — BVN + bank details for NIBSS identification
        if (options?.bvn) {
            metadata.bvn = options.bvn;
        }
        if (options?.bank_account_number) {
            metadata.bank_account_number = options.bank_account_number;
        }
        if (options?.bank_code) {
            metadata.bank_code = options.bank_code;
        }
        if (options?.bank_name) {
            metadata.bank_name = options.bank_name;
        }

        // Create customer + submit identification + issue DVA via licensed partner
        const partnerResponse = await LicensedPartnerService.createVirtualAccount({
            accountName: `PingRide - ${firstName} ${lastName}`,
            accountReference: `PR-${userId.substring(0, 8)}-${Date.now()}`,
            metadata,
        });

        // Persist virtual account row
        const virtualAccount = await VirtualAccountModel.create({
            userId,
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

        // Link to passenger profile
        await PassengerModel.linkVirtualAccount(userId, virtualAccount.id);

        // Persist BVN on passenger profile. kyc_status stays 'pending' —
        // Paystack validates NIBSS identification asynchronously and the
        // DVA itself is the completion signal for Phase 2A.
        if (options?.bvn) {
            await pool.query(
                `UPDATE passenger_profiles
                 SET bvn = $1, kyc_status = 'pending', updated_at = NOW()
                 WHERE user_id = $2`,
                [options.bvn, userId]
            );
        }

        logger.info(`Virtual account provisioned for user ${userId}: ${virtualAccount.account_number}`, {
            bank: virtualAccount.bank_name,
            has_split: !!options?.split_code || !!options?.subaccount,
            has_bvn: !!options?.bvn,
        });

        return virtualAccount;
    }

    /**
     * Get a passenger's virtual account details
     * Automatically provisions if no account exists
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

    static async getVirtualAccountByNumber(accountNumber: string): Promise<IVirtualAccount | null> {
        return VirtualAccountModel.getByAccountNumber(accountNumber);
    }

    static async getUserAccounts(userId: string): Promise<IVirtualAccount[]> {
        return VirtualAccountModel.getAllByUserId(userId);
    }

    static async handleBankTransferWebhook(
        provider: string,
        payload: Record<string, any>,
        headers: Record<string, any>
    ): Promise<{ processed: boolean; message: string; eventId?: string }> {
        const isValid = await LicensedPartnerService.verifyWebhookSignature(
            provider,
            payload,
            headers
        );

        if (!isValid) {
            logger.warn(`Invalid webhook signature from ${provider}`);
            return { processed: false, message: 'Invalid signature' };
        }

        const transactionId = payload.transaction_id || payload.reference || payload.id;
        const accountNumber = payload.account_number || payload.account || payload.accountNumber;
        const amount = payload.amount || 0;
        const senderName = payload.sender_name || payload.senderName || 'Unknown';
        const senderAccount = payload.sender_account_number || payload.senderAccountNumber;
        const senderBank = payload.sender_bank || payload.senderBank;
        const narration = payload.narration || payload.description || '';
        const idempotencyKey = payload.idempotency_key || payload.idempotencyKey || transactionId;

        if (!transactionId || !accountNumber || amount <= 0) {
            logger.warn('Invalid webhook payload - missing required fields', {
                transactionId,
                accountNumber,
                amount
            });
            return { processed: false, message: 'Invalid payload - missing required fields' };
        }

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

        const virtualAccount = await VirtualAccountModel.getByAccountNumber(accountNumber);
        if (!virtualAccount) {
            logger.warn(`Virtual account not found: ${accountNumber}`);

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

        let splitData: any = null;
        const payloadMetadata = payload.metadata || {};

        if (payloadMetadata.split) {
            splitData = payloadMetadata.split;
            logger.info('Split transaction detected in webhook', {
                split_code: splitData.split_code,
                subaccounts: splitData.subaccounts?.length || 0,
                transaction_id: transactionId,
            });
        }

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
                    split: splitData,
                    webhook_payload: {
                        transaction_id: transactionId,
                        account_number: accountNumber,
                        provider: provider,
                    }
                }
            );

            await BankTransferEventModel.markCredited(event.id, result.transaction.id);

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

    private static async recordSplitTransaction(
        eventId: string,
        splitData: any,
        totalAmount: number
    ): Promise<void> {
        try {
            const event = await BankTransferEventModel.getById(eventId);
            if (!event) {
                logger.warn(`Event ${eventId} not found for split recording`);
                return;
            }

            const existingMetadata = event.metadata || {};

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

            await pool.query(
                `UPDATE bank_transfer_events 
                 SET metadata = $1, updated_at = NOW() 
                 WHERE id = $2`,
                [updatedMetadata, eventId]
            );

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
            logger.error('Error recording split transaction:', error);
        }
    }

    static async updateAccountStatus(
        accountId: string,
        status: 'pending' | 'active' | 'suspended' | 'closed'
    ): Promise<IVirtualAccount | null> {
        return VirtualAccountModel.updateStatus(accountId, status);
    }

    static async updateKycStatus(accountId: string, verified: boolean): Promise<IVirtualAccount | null> {
        return VirtualAccountModel.updateKycStatus(accountId, verified);
    }

    static async getPendingTransfers(userId: string): Promise<IBankTransferEvent[]> {
        const result = await BankTransferEventModel.getByUserId(userId);
        return result.events.filter((event: IBankTransferEvent) => event.status === 'pending');
    }

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

    static async hasSplitConfigured(userId: string): Promise<boolean> {
        const account = await VirtualAccountModel.getByUserId(userId);
        if (!account) {
            return false;
        }

        const metadata = account.metadata || {};
        return !!(metadata.split_code || metadata.subaccount);
    }

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