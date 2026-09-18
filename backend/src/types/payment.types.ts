// ============================================
// PAYMENT TYPES
// ============================================

// ============================================
// PAYMENT ENUMS
// ============================================

export type PaymentMethod = 'bank_transfer' | 'wallet' | 'cash' | 'promo_code';
export type PaymentStatus = 'pending' | 'authorised' | 'captured' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'cancelled';
export type PaymentType = 'ride' | 'top_up' | 'withdrawal' | 'refund';

export type WalletStatus = 'active' | 'frozen' | 'closed';

export type WalletTransactionType =
  | 'top_up'
  | 'topup'
  | 'deposit'
  | 'payment'
  | 'payout'
  | 'withdrawal'
  | 'refund'
  | 'bonus'
  | 'commission'
  | 'adjustment'
  | 'rebate_credit'
  | 'rebate_usage'
  | 'promotion'
  | 'driver_earnings';

export type WalletTransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export type RefundStatus = 'pending' | 'processed' | 'failed';

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type WithdrawalMethod = 'bank_transfer' | 'mobile_money' | 'cash';

export type DriverLedgerStatus = 'active' | 'suspended' | 'closed';

export type DriverLedgerTransactionType = 'earning' | 'commission' | 'bonus' | 'adjustment' | 'withdrawal' | 'refund';
export type DriverLedgerTransactionStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export type CashViolationPenaltyLevel = 'first' | 'second' | 'third' | 'permanent';

// ============================================
// PAYMENT INTERFACES
// ============================================

export interface IPayment {
    id: string;
    ride_id: string | null;
    passenger_id: string;
    driver_id: string | null;
    amount: number;
    currency: string;
    payment_method: PaymentMethod;
    status: PaymentStatus;
    gateway_reference: string | null;
    gateway_response: any;
    authorised_at: Date | null;
    captured_at: Date | null;
    paid_at: Date | null;
    created_at: Date;
    updated_at: Date;
    commission_amount: number | null;
    commission_rate: number | null;
    driver_earnings: number | null;
    processed_at: Date | null;
    settled_at: Date | null;
    payment_type: PaymentType;
}

export interface ICreatePayment {
    ride_id?: string;
    passenger_id: string;
    driver_id?: string;
    amount: number;
    currency?: string;
    payment_method: PaymentMethod;
    payment_type?: PaymentType;
}

export interface IUpdatePayment {
    status?: PaymentStatus;
    gateway_reference?: string;
    gateway_response?: any;
    authorised_at?: Date;
    captured_at?: Date;
    paid_at?: Date;
    commission_amount?: number;
    commission_rate?: number;
    driver_earnings?: number;
    processed_at?: Date;
    settled_at?: Date;
}

export interface IPaymentAuthorisation {
    id: string;
    ride_id: string;
    passenger_id: string;
    amount: number;
    payment_method: PaymentMethod;
    gateway_reference: string | null;
    status: 'pending' | 'authorised' | 'captured' | 'failed' | 'expired';
    authorised_at: Date | null;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
}

export interface ICreatePaymentAuthorisation {
    ride_id: string;
    passenger_id: string;
    amount: number;
    payment_method: PaymentMethod;
    expires_at: Date;
}

// ============================================
// REFUND INTERFACES
// ============================================

export interface IRefund {
    id: string;
    transaction_id: string;
    ride_id: string;
    passenger_id: string;
    refund_amount: number;
    reason: string;
    status: RefundStatus;
    gateway_reference: string | null;
    initiated_by: string;
    processed_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

export interface ICreateRefund {
    transaction_id: string;
    ride_id: string;
    passenger_id: string;
    refund_amount: number;
    reason: string;
    initiated_by: string;
}

// ============================================
// WALLET INTERFACES - UPDATED WITH SPLIT BALANCES
// ============================================

export interface IWallet {
    id: string;
    user_id: string;
    currency: string;
    balance: number;
    status: WalletStatus;
    created_at: Date;
    updated_at: Date;
    frozen_at: Date | null;
    frozen_reason: string | null;
    virtual_account_number: string | null;
    virtual_account_bank: string | null;
    virtual_account_name: string | null;
    // ============================================
    // SPLIT BALANCE FIELDS (V2.0)
    // ============================================
    deposited_balance: number;        // Customer-funded, withdrawable
    rebate_credit_balance: number;    // PingRide-issued, non-withdrawable
    promotional_balance: number;      // Promotional credits, non-withdrawable
}

export interface ICreateWallet {
    user_id: string;
    currency?: string;
}

export interface IUpdateWallet {
    balance?: number;
    status?: WalletStatus;
    frozen_at?: Date;
    frozen_reason?: string;
}

export interface IWalletTransaction {
    id: string;
    wallet_id: string;
    transaction_type: WalletTransactionType;
    amount: number;
    balance_before: number;
    balance_after: number;
    reference_type: string | null;
    reference_id: string | null;
    description: string;
    status: WalletTransactionStatus;
    metadata: any;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
    reversed_at: Date | null;
}

export interface ICreateWalletTransaction {
    wallet_id: string;
    transaction_type: WalletTransactionType;
    amount: number;
    balance_before: number;
    balance_after: number;
    reference_type?: string;
    reference_id?: string;
    description: string;
    metadata?: any;
}

// ============================================
// WITHDRAWAL INTERFACES
// ============================================

export interface IWithdrawal {
    id: string;
    driver_id: string;
    wallet_id: string;
    amount: number;
    method: WithdrawalMethod;
    account_name: string;
    account_number: string;
    bank_name: string | null;
    status: WithdrawalStatus;
    reference: string | null;
    processed_at: Date | null;
    completed_at: Date | null;
    failure_reason: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface ICreateWithdrawal {
    driver_id: string;
    wallet_id: string;
    amount: number;
    method: WithdrawalMethod;
    account_name: string;
    account_number: string;
    bank_name?: string;
}

export interface IUpdateWithdrawal {
    status?: WithdrawalStatus;
    reference?: string;
    processed_at?: Date;
    completed_at?: Date;
    failure_reason?: string;
}

// ============================================
// DRIVER LEDGER INTERFACES
// ============================================

export interface IDriverLedger {
    id: string;
    driver_id: string;
    digital_earnings: number;
    cash_commission_debt: number;
    bonus_earnings: number;
    adjustment_earnings: number;
    total_commission_deducted: number;
    total_withdrawals: number;
    total_refunds: number;
    net_balance: number;
    withdrawable_balance: number;
    status: DriverLedgerStatus;
    created_at: Date;
    updated_at: Date;
}

export interface IDriverLedgerTransaction {
    id: string;
    driver_ledger_id: string;
    transaction_type: DriverLedgerTransactionType;
    amount: number;
    balance_before: number;
    balance_after: number;
    reference_type: string | null;
    reference_id: string | null;
    description: string;
    metadata: any;
    status: DriverLedgerTransactionStatus;
    completed_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

// ============================================
// CASH VIOLATION INTERFACES
// ============================================

export interface ICashViolation {
    id: string;
    ride_id: string;
    passenger_id: string;
    driver_id: string;
    fare_amount: number;
    commission_amount: number;
    passenger_deducted: boolean;
    driver_suspended: boolean;
    driver_reinstated: boolean;
    driver_payment_confirmed: boolean;
    violation_count: number;
    penalty_level: CashViolationPenaltyLevel;
    resolved_at: Date | null;
    resolved_by: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface ICreateCashViolation {
    ride_id: string;
    passenger_id: string;
    driver_id: string;
    fare_amount: number;
    commission_amount: number;
    penalty_level?: CashViolationPenaltyLevel;
}

export interface IUpdateCashViolation {
    passenger_deducted?: boolean;
    driver_suspended?: boolean;
    driver_reinstated?: boolean;
    driver_payment_confirmed?: boolean;
    violation_count?: number;
    penalty_level?: CashViolationPenaltyLevel;
    resolved_at?: Date;
    resolved_by?: string;
}

// ============================================
// PAYSTACK API INTERFACES (UPDATED WITH SPLIT SUPPORT)
// ============================================

export interface IPaystackInitTransaction {
    email: string;
    amount: number; // in kobo (multiply by 100)
    currency?: string;
    reference?: string;
    callback_url?: string;
    metadata?: any;
    // ============================================
    // SPLIT SUPPORT
    // ============================================
    split?: ISplitConfig;
}

export interface IPaystackInitResponse {
    status: boolean;
    message: string;
    data: {
        authorization_url: string;
        access_code: string;
        reference: string;
    };
}

export interface IPaystackVerifyResponse {
    status: boolean;
    message: string;
    data: {
        id: number;
        reference: string;
        amount: number;
        currency: string;
        status: string;
        paid_at: string | null;
        channel: string;
        customer: {
            email: string;
        };
        metadata: any;
    };
}

export interface IPaystackWebhookEvent {
    event: string;
    data: {
        reference: string;
        amount: number;
        currency: string;
        status: string;
        paid_at: string | null;
        metadata: any;
        customer?: {
            id: number;
            customer_code: string;
            email: string;
            first_name: string;
            last_name: string;
            phone: string;
        };
    };
}

// ============================================
// RESPONSE INTERFACES
// ============================================

export interface IPaymentResponse {
    payment: IPayment;
    wallet_transaction?: IWalletTransaction;
    driver_ledger_transaction?: IDriverLedgerTransaction;
}

export interface IWalletResponse {
    wallet: IWallet;
    balance: number;
    currency: string;
}

export interface ITransactionResponse {
    transactions: IWalletTransaction[];
    total: number;
    page: number;
    limit: number;
}

export interface IWithdrawalResponse {
    withdrawal: IWithdrawal;
    remaining_balance: number;
}

// ============================================
// PAYMENT REQUEST TYPES
// ============================================

export interface IInitializePaymentRequest {
    ride_id: string;
    passenger_id: string;
    amount: number;
    payment_method: PaymentMethod;
    email?: string;
}

export interface IInitializePaymentResponse {
    authorization_url: string;
    reference: string;
    access_code: string;
}

export interface IVerifyPaymentRequest {
    reference: string;
}

export interface IProcessPaymentRequest {
    payment_id: string;
    amount: number;
}

export interface IRefundRequest {
    payment_id: string;
    amount: number;
    reason: string;
}

// ============================================
// PASSENGER PROFILE INTERFACE
// ============================================

export interface IPassengerProfile {
    id: string;
    user_id: string;
    first_name: string;
    last_name: string;
    profile_photo_url?: string;
    date_of_birth?: string;
    gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
    trust_score: number;
    total_rides: number;
    lifetime_spend: number;
    rating_as_passenger?: number;
    created_at: Date;
    updated_at: Date;
    virtual_account_id?: string;
    // ============================================
    // KYC FIELDS (V2.0)
    // ============================================
    bvn?: string;
    nin?: string;
    kyc_status: 'pending' | 'verified' | 'failed';
    kyc_verified_at?: Date;
    kyc_verified_by?: string;
    kyc_failure_reason?: string;
}

// ============================================
// VIRTUAL ACCOUNT TYPES
// ============================================

export interface IVirtualAccount {
    id: string;
    user_id: string;
    provider: 'providus' | 'wema' | 'paystack' | 'mock';
    provider_account_id: string;
    account_number: string;
    bank_name: string;
    account_name: string;
    status: 'pending' | 'active' | 'suspended' | 'closed';
    kyc_verified: boolean;
    metadata?: any;
    created_at: Date;
    updated_at: Date;
}

export interface ICreateVirtualAccount {
    userId: string;
    provider: string;
    providerAccountId: string;
    accountNumber: string;
    bankName: string;
    accountName: string;
    status?: string;
    kycVerified?: boolean;
    metadata?: any;
}

// ============================================
// BANK TRANSFER EVENT INTERFACES (WITH METADATA)
// ============================================

export interface IBankTransferEvent {
    id: string;
    virtual_account_id?: string;
    user_id: string;
    provider_transaction_id: string;
    amount: number;
    sender_name?: string;
    sender_account_number?: string;
    sender_bank?: string;
    narration?: string;
    status: 'pending' | 'credited' | 'failed' | 'reversed';
    idempotency_key?: string;
    credited_to_wallet: boolean;
    wallet_transaction_id?: string;
    metadata?: any;
    created_at: Date;
    updated_at: Date;
}

export interface ICreateBankTransferEvent {
    virtualAccountId?: string;
    userId: string;
    providerTransactionId: string;
    amount: number;
    senderName?: string;
    senderAccountNumber?: string;
    senderBank?: string;
    narration?: string;
    idempotencyKey?: string;
    status?: string;
    metadata?: any;
}

export interface IProviderTransaction {
    id: string;
    provider: string;
    provider_transaction_id: string;
    transaction_type: string;
    amount: number;
    currency: string;
    status: string;
    processed: boolean;
    idempotency_key?: string;
    webhook_received_at?: Date;
    processed_at?: Date;
    payload?: any;
    response?: any;
    error_message?: string;
    created_at: Date;
    updated_at: Date;
}

export interface IVirtualAccountResponse {
    provider: string;
    accountId: string;
    accountNumber: string;
    bankName: string;
    accountName: string;
    metadata?: any;
}

export interface IPayoutRequest {
    driverId: string;
    amount: number;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    reference: string;
    narration?: string;
}

export interface IPayoutResponse {
    success: boolean;
    reference: string;
    status: string;
    message?: string;
}

export interface IUnmatchedTransfer {
    id: string;
    provider: string;
    provider_transaction_id: string;
    amount: number;
    account_number: string;
    payload: any;
    reason: string;
    resolved: boolean;
    created_at: Date;
    updated_at: Date;
}

export interface ICreateUnmatchedTransfer {
    provider: string;
    providerTransactionId: string;
    amount: number;
    accountNumber: string;
    payload: any;
    reason: string;
}

// ============================================
// SPLIT PAYMENT INTERFACES
// ============================================

/**
 * Split payment request interface
 * Used to initialize a split payment for a ride
 */
export interface ISplitPaymentRequest {
    ride_id: string;
    passenger_id: string;
    driver_id: string;
    amount: number;
    passenger_email: string;
}

/**
 * Split payment response interface
 * Returned after initializing a split payment
 */
export interface ISplitPaymentResponse {
    authorization_url: string;
    reference: string;
    access_code: string;
    payment_id: string;
}

/**
 * Split configuration interface
 * Defines how payments should be split across subaccounts
 */
export interface ISplitConfig {
    type: 'percentage' | 'flat';
    currency: string;
    subaccounts: Array<{
        subaccount: string;
        share: number;
    }>;
    bearer_type?: 'all' | 'subaccount';
    bearer_subaccount?: string;
}

/**
 * Split payment metadata
 * Stored in payment record for reference
 */
export interface ISplitPaymentMetadata {
    driver_share: number;
    pingride_share: number;
    rebate_share: number;
    driver_subaccount: string;
    pingride_subaccount: string;
    rebate_subaccount: string;
    split_config: ISplitConfig;
}

/**
 * Split payment webhook data
 * Extracted from Paystack webhook for split transactions
 */
export interface ISplitWebhookData {
    split_code?: string;
    subaccount?: string;
    subaccounts?: Array<{
        subaccount: string;
        share: number;
    }>;
    total_amount: number;
}