import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import { env } from '../config/env';
import {
    IVirtualAccountResponse,
    IPayoutRequest,
    IPayoutResponse
} from '../types/payment.types';
import logger from '../utils/logger';

/**
 * Licensed Partner Integration Service
 *
 * Supports Paystack Dedicated Virtual Accounts (DVAs) as the primary provider.
 * Paystack partners with Wema Bank and Titan Trust to provide static NUBAN accounts.
 *
 * Flow (issuance, NOT activation):
 * 1. POST /customer                          — create customer profile
 * 2. POST /customer/{code}/identification    — submit KYC (async, 202 Accepted)
 * 3. POST /dedicated_account                 — issue DVA number (sync)
 *
 * The DVA number is returned immediately. KYC validation runs in the
 * background and transitions the customer to `identified: true` when
 * NIBSS confirms the identity.
 */
export class LicensedPartnerService {
    private static apiClient: AxiosInstance | null = null;
    private static readonly PROVIDER = 'paystack';

    private static get API_KEY(): string {
        return env.paystackSecretKey || '';
    }

    private static get BASE_URL(): string {
        return 'https://api.paystack.co';
    }

    private static readonly WEBHOOK_SECRET = env.paystackSecretKey || '';
    private static readonly REQUEST_TIMEOUT = 30000;

    private static getClient(): AxiosInstance {
        if (!this.apiClient) {
            const apiKey = this.API_KEY;
            if (!apiKey) {
                logger.warn('Paystack API key not configured. Please set PAYSTACK_SECRET_KEY in .env');
            }

            this.apiClient = axios.create({
                baseURL: this.BASE_URL,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'PingRide/2.0',
                },
                timeout: this.REQUEST_TIMEOUT,
                validateStatus: (status) => status < 500,
            });

            this.apiClient.interceptors.response.use(
                (response) => {
                    logger.debug('Paystack API response', {
                        status: response.status,
                        url: response.config.url,
                    });
                    return response;
                },
                (error: AxiosError) => {
                    logger.error('Paystack API error:', {
                        message: error.message,
                        url: error.config?.url,
                        status: error.response?.status,
                        data: error.response?.data,
                    });
                    return Promise.reject(error);
                }
            );
        }
        return this.apiClient;
    }

    static isConfigured(): boolean {
        const apiKey = this.API_KEY;
        return Boolean(apiKey) && apiKey !== '' && apiKey.startsWith('sk_');
    }

    static getProvider(): string {
        return this.PROVIDER;
    }

    static getBaseUrl(): string {
        return this.BASE_URL;
    }

    /**
     * Mock mode is used ONLY when Paystack is not configured at all
     * (missing or invalid secret key). NODE_ENV is NOT a factor — we
     * always hit Paystack with whatever key is configured, including
     * `sk_test_...` keys. Paystack's test mode is a Paystack concern,
     * not an application-environment concern.
     */
    private static shouldUseMock(): boolean {
        return !this.isConfigured();
    }

    private static generateMockAccountNumber(reference: string): string {
        const clean = reference.replace(/[^a-zA-Z0-9]/g, '');
        const padded = clean.padStart(10, '0').slice(-10);
        return `012${padded}`;
    }

    private static generateMockVirtualAccountResponse(data: {
        accountName: string;
        accountReference: string;
        metadata?: Record<string, any>;
    }): IVirtualAccountResponse {
        return {
            provider: 'mock',
            accountId: `mock-${data.accountReference}-${Date.now()}`,
            accountNumber: this.generateMockAccountNumber(data.accountReference),
            bankName: 'Mock Bank (Development)',
            accountName: data.accountName,
            metadata: {
                ...data.metadata,
                _mock: true,
                _note: 'Paystack not configured — mock account returned',
                _created_at: new Date().toISOString(),
            },
        };
    }

    // ============================================
    // VIRTUAL ACCOUNT CREATION (Paystack DVA)
    // ============================================

    /**
     * Create a Paystack Dedicated Virtual Account (DVA) for a passenger
     *
     * Flow:
     * 1. Create customer on Paystack                    → customer_code
     * 2. Submit KYC identification (BVN + bank account) → 202 Accepted (async)
     * 3. Issue dedicated virtual account                → DVA number (sync)
     *
     * @param data - Account creation data including customer details
     * @returns Virtual account response with account number and bank details
     */
    static async createVirtualAccount(data: {
        accountName: string;
        accountReference: string;
        metadata?: Record<string, any>;
    }): Promise<IVirtualAccountResponse> {
        // Mock only when Paystack isn't configured
        if (this.shouldUseMock()) {
            logger.warn('Paystack not configured — returning mock DVA', {
                accountName: data.accountName,
                reference: data.accountReference,
            });
            return this.generateMockVirtualAccountResponse(data);
        }

        const client = this.getClient();
        const metadata = data.metadata || {};
        const preferredBank = metadata.preferred_bank || 'wema-bank';

        try {
            // ============================================
            // STEP 1: Create Customer on Paystack
            // ============================================
            logger.info('Creating Paystack customer profile...', {
                email: metadata.email,
                name: data.accountName,
            });

            const customerResponse = await client.post('/customer', {
                email: metadata.email,
                first_name: metadata.firstName || data.accountName.split(' ')[0] || 'PingRide',
                last_name: metadata.lastName || data.accountName.split(' ').slice(1).join(' ') || 'User',
                phone: metadata.phoneNumber,
                metadata: {
                    pingride_user_id: metadata.userId,
                    pingride_user_type: metadata.userType || 'passenger',
                    ...metadata,
                },
            });

            if (customerResponse.data.status !== true) {
                throw new Error(customerResponse.data.message || 'Failed to create customer');
            }

            const customerCode = customerResponse.data.data.customer_code;
            const customerId = customerResponse.data.data.id;
            logger.info(`Paystack customer created: ${customerCode}`);

            // ============================================
            // STEP 2: Submit KYC Identification (async)
            // ============================================
            // Paystack returns 202 Accepted. Validation happens in background.
            // The DVA is issued regardless of this step's completion — KYC
            // gating happens on Paystack's side, not ours.
            if (metadata.bvn && metadata.bank_account_number && metadata.bank_code) {
                try {
                    logger.info('Submitting bank account identification...');

                    const identificationPayload = {
                        country: 'NG',
                        type: 'bank_account',
                        bvn: metadata.bvn,
                        bank_code: metadata.bank_code,
                        account_number: metadata.bank_account_number,
                        first_name: metadata.firstName,
                        last_name: metadata.lastName,
                    };

                    const identResponse = await client.post(
                        `/customer/${customerCode}/identification`,
                        identificationPayload
                    );

                    // 202 Accepted is success here
                    if (identResponse.status === 202 || identResponse.data.status === true) {
                        logger.info('KYC identification submitted (async processing started)', {
                            customerCode,
                            message: identResponse.data.message,
                        });
                    } else {
                        logger.warn('KYC identification returned unexpected response', {
                            customerCode,
                            status: identResponse.status,
                            body: identResponse.data,
                        });
                    }
                } catch (kycError) {
                    // Don't fail DVA issuance if KYC submission fails — the
                    // customer is created and DVA is issued; KYC can be retried.
                    logger.warn('KYC identification submission failed (DVA will still be issued)', {
                        customerCode,
                        error: kycError instanceof Error ? kycError.message : 'Unknown error',
                    });
                }
            } else {
                logger.warn('BVN / bank details not provided — DVA issued without KYC submission', {
                    customerCode,
                    has_bvn: !!metadata.bvn,
                    has_bank_account: !!metadata.bank_account_number,
                    has_bank_code: !!metadata.bank_code,
                });
            }

            // ============================================
            // STEP 3: Issue Dedicated Virtual Account
            // ============================================
            logger.info('Issuing Dedicated Virtual Account...', {
                customerCode,
                preferred_bank: preferredBank,
            });

            const dvaResponse = await client.post('/dedicated_account', {
                customer: customerCode,
                preferred_bank: preferredBank,
            });

            if (dvaResponse.data.status !== true) {
                throw new Error(dvaResponse.data.message || 'Failed to create dedicated account');
            }

            const dvaData = dvaResponse.data.data;

            logger.info('DVA issued successfully', {
                accountNumber: dvaData.account_number,
                bankName: dvaData.bank?.name,
                accountName: dvaData.account_name,
                assigned: dvaData.assigned,
                active: dvaData.active,
            });

            return {
                provider: 'paystack',
                accountId: String(dvaData.id),
                accountNumber: dvaData.account_number,
                bankName: dvaData.bank?.name || 'Wema Bank',
                accountName: dvaData.account_name || data.accountName,
                metadata: {
                    customer_code: customerCode,
                    customer_id: customerId,
                    bank_id: dvaData.bank?.id,
                    bank_slug: dvaData.bank?.slug,
                    assigned: dvaData.assigned,
                    active: dvaData.active,
                    currency: dvaData.currency,
                    assigned_at: dvaData.assignment?.assigned_at,
                    raw: dvaData,
                },
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            logger.error('Failed to create Paystack virtual account:', {
                error: msg,
                accountName: data.accountName,
                accountReference: data.accountReference,
            });
            throw error;
        }
    }

    // ============================================
    // WEBHOOK VERIFICATION (Paystack)
    // ============================================

    /**
     * Verify Paystack webhook signature
     * Paystack uses HMAC-SHA512 with the secret key
     */
    static async verifyWebhookSignature(
        provider: string,
        payload: Record<string, any>,
        headers: Record<string, any>
    ): Promise<boolean> {
        if (provider !== 'paystack') {
            logger.warn(`Unsupported provider for webhook verification: ${provider}`);
            return false;
        }

        return this.verifyPaystackSignature(payload, headers);
    }

    /**
     * Verify Paystack webhook signature using HMAC-SHA512
     */
    private static verifyPaystackSignature(
        payload: Record<string, any>,
        headers: Record<string, any>
    ): boolean {
        const signature = headers['x-paystack-signature'];

        if (!signature) {
            logger.warn('Missing Paystack signature header');
            return false;
        }

        try {
            const secret = this.WEBHOOK_SECRET;
            if (!secret) {
                logger.warn('Paystack webhook secret not configured');
                return false;
            }

            const hash = crypto
                .createHmac('sha512', secret)
                .update(JSON.stringify(payload))
                .digest('hex');

            return crypto.timingSafeEqual(
                Buffer.from(hash, 'utf8'),
                Buffer.from(signature, 'utf8')
            );
        } catch (error) {
            logger.error('Paystack signature verification error:', error);
            return false;
        }
    }

    // ============================================
    // PAYOUT OPERATIONS
    // ============================================

    /**
     * Initiate a payout to a driver
     * Uses Paystack Transfer API
     */
    static async initiatePayout(data: IPayoutRequest): Promise<IPayoutResponse> {
        if (data.amount <= 0) {
            throw new Error('Payout amount must be greater than zero');
        }
        if (!data.accountNumber || !data.bankCode) {
            throw new Error('Bank account number and bank code are required');
        }

        if (this.shouldUseMock()) {
            logger.info('Mock payout initiated', {
                driverId: data.driverId,
                amount: data.amount,
                reference: data.reference,
            });
            return {
                success: true,
                reference: `mock-${data.reference}`,
                status: 'processing',
                message: 'Mock payout initiated successfully',
            };
        }

        try {
            const client = this.getClient();

            logger.info('Creating transfer recipient...', {
                accountNumber: data.accountNumber,
                bankCode: data.bankCode,
            });

            const recipientResponse = await client.post('/transferrecipient', {
                type: 'nuban',
                name: data.accountName,
                account_number: data.accountNumber,
                bank_code: data.bankCode,
                currency: 'NGN',
                metadata: {
                    driver_id: data.driverId,
                },
            });

            if (recipientResponse.data.status !== true) {
                throw new Error(recipientResponse.data.message || 'Failed to create transfer recipient');
            }

            const recipientCode = recipientResponse.data.data.recipient_code;

            logger.info('Initiating transfer...', {
                recipient: recipientCode,
                amount: data.amount,
                reference: data.reference,
            });

            const transferResponse = await client.post('/transfer', {
                source: 'balance',
                amount: Math.round(data.amount * 100),
                recipient: recipientCode,
                reason: data.narration || `PingRide driver payout - ${data.driverId}`,
                reference: data.reference,
            });

            if (transferResponse.data.status !== true) {
                throw new Error(transferResponse.data.message || 'Failed to initiate transfer');
            }

            const transferData = transferResponse.data.data;

            return {
                success: true,
                reference: transferData.reference || data.reference,
                status: transferData.status || 'pending',
                message: transferResponse.data.message || 'Payout initiated successfully',
            };
        } catch (error) {
            logger.error('Failed to initiate payout:', {
                driverId: data.driverId,
                amount: data.amount,
                reference: data.reference,
                error: error instanceof Error ? error.message : 'Unknown error',
            });

            return {
                success: false,
                reference: data.reference,
                status: 'failed',
                message: error instanceof Error ? error.message : 'Payout initiation failed',
            };
        }
    }

    /**
     * Get transaction status from Paystack
     */
    static async getTransactionStatus(
        _provider: string,
        transactionId: string
    ): Promise<{
        status: string;
        amount: number;
        reference: string;
        completedAt?: string;
        error?: string;
    }> {
        if (!transactionId) {
            throw new Error('Transaction ID is required');
        }

        if (this.shouldUseMock()) {
            return {
                status: 'completed',
                amount: 0,
                reference: transactionId,
                completedAt: new Date().toISOString(),
            };
        }

        try {
            const client = this.getClient();
            const response = await client.get(`/transfer/verify/${transactionId}`);

            if (response.data.status !== true) {
                throw new Error(response.data.message || 'Failed to verify transfer');
            }

            const data = response.data.data;

            return {
                status: data.status || 'unknown',
                amount: data.amount ? data.amount / 100 : 0,
                reference: data.reference || transactionId,
                completedAt: data.updated_at || data.created_at,
                error: data.failure_reason,
            };
        } catch (error) {
            logger.error('Failed to get transaction status:', {
                transactionId,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        }
    }

    /**
     * Get account balance from Paystack
     */
    static async getAccountBalance(): Promise<{ balance: number; currency: string }> {
        if (this.shouldUseMock()) {
            return { balance: 1000000, currency: 'NGN' };
        }

        try {
            const client = this.getClient();
            const response = await client.get('/balance');

            if (response.data.status !== true) {
                throw new Error(response.data.message || 'Failed to get balance');
            }

            const balances = response.data.data || [];
            const ngnBalance = balances.find((b: any) => b.currency === 'NGN');

            return {
                balance: ngnBalance ? ngnBalance.balance / 100 : 0,
                currency: 'NGN',
            };
        } catch (error) {
            logger.error('Failed to get account balance:', error);
            throw error;
        }
    }

    /**
     * Retry a failed operation with exponential backoff
     */
    static async retryWithBackoff<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        initialDelay: number = 1000
    ): Promise<T> {
        let lastError: Error | null = null;
        let delay = initialDelay;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn(`Operation failed (attempt ${attempt}/${maxRetries}):`, {
                    error: lastError.message,
                    delay,
                });

                if (attempt === maxRetries) {
                    break;
                }

                const jitter = Math.random() * 100;
                await new Promise((resolve) => setTimeout(resolve, delay + jitter));
                delay *= 2;
            }
        }

        throw lastError || new Error('Operation failed after retries');
    }
}

export default LicensedPartnerService;