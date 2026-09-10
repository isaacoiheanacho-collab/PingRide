import pool from '../config/database';
import { IBankTransferEvent, ICreateBankTransferEvent, ICreateUnmatchedTransfer } from '../types/payment.types';
import logger from '../utils/logger';

export class BankTransferEventModel {
    static async create(data: ICreateBankTransferEvent): Promise<IBankTransferEvent> {
        const result = await pool.query(
            `INSERT INTO bank_transfer_events (
                virtual_account_id, user_id, provider_transaction_id, amount,
                sender_name, sender_account_number, sender_bank, narration,
                idempotency_key, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
                data.virtualAccountId || null,
                data.userId,
                data.providerTransactionId,
                data.amount,
                data.senderName || null,
                data.senderAccountNumber || null,
                data.senderBank || null,
                data.narration || null,
                data.idempotencyKey || null,
                data.status || 'pending',
            ]
        );
        logger.debug(`Bank transfer event created: ${result.rows[0].id}`);
        return result.rows[0];
    }

    static async getByIdempotencyKey(key: string): Promise<IBankTransferEvent | null> {
        const result = await pool.query(
            'SELECT * FROM bank_transfer_events WHERE idempotency_key = $1',
            [key]
        );
        return result.rows[0] || null;
    }

    static async getByProviderTransactionId(providerTransactionId: string): Promise<IBankTransferEvent | null> {
        const result = await pool.query(
            'SELECT * FROM bank_transfer_events WHERE provider_transaction_id = $1',
            [providerTransactionId]
        );
        return result.rows[0] || null;
    }

    static async getById(id: string): Promise<IBankTransferEvent | null> {
        const result = await pool.query(
            'SELECT * FROM bank_transfer_events WHERE id = $1',
            [id]
        );
        return result.rows[0] || null;
    }

    static async markCredited(eventId: string, walletTransactionId: string): Promise<IBankTransferEvent | null> {
        const result = await pool.query(
            `UPDATE bank_transfer_events 
             SET credited_to_wallet = true,
                 wallet_transaction_id = $1,
                 status = 'credited',
                 updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [walletTransactionId, eventId]
        );
        return result.rows[0] || null;
    }

    static async markFailed(eventId: string, reason: string): Promise<IBankTransferEvent | null> {
        const result = await pool.query(
            `UPDATE bank_transfer_events 
             SET status = 'failed',
                 narration = COALESCE(narration, '') || ' Failed: ' || $1,
                 updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [reason, eventId]
        );
        return result.rows[0] || null;
    }

    static async createUnmatched(data: ICreateUnmatchedTransfer): Promise<void> {
        await pool.query(
            `INSERT INTO unmatched_transfers (
                provider, provider_transaction_id, amount,
                account_number, payload, reason
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                data.provider,
                data.providerTransactionId,
                data.amount,
                data.accountNumber,
                data.payload,
                data.reason,
            ]
        );
        logger.warn(`Unmatched transfer logged: ${data.providerTransactionId}`);
    }

    static async getByUserId(
        userId: string,
        page: number = 1,
        limit: number = 100
    ): Promise<{ events: IBankTransferEvent[]; total: number }> {
        const offset = (page - 1) * limit;
        const result = await pool.query(
            `SELECT * FROM bank_transfer_events 
             WHERE user_id = $1 
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM bank_transfer_events WHERE user_id = $1',
            [userId]
        );
        return {
            events: result.rows,
            total: parseInt(countResult.rows[0]?.total || '0', 10)
        };
    }

    static async getByDateRange(
        startDate: Date,
        endDate: Date,
        page: number = 1,
        limit: number = 100
    ): Promise<{ events: IBankTransferEvent[]; total: number }> {
        const offset = (page - 1) * limit;
        const result = await pool.query(
            `SELECT * FROM bank_transfer_events 
             WHERE created_at BETWEEN $1 AND $2
             ORDER BY created_at DESC
             LIMIT $3 OFFSET $4`,
            [startDate, endDate, limit, offset]
        );
        const countResult = await pool.query(
            'SELECT COUNT(*) as total FROM bank_transfer_events WHERE created_at BETWEEN $1 AND $2',
            [startDate, endDate]
        );
        return {
            events: result.rows,
            total: parseInt(countResult.rows[0]?.total || '0', 10)
        };
    }
}

export default BankTransferEventModel;