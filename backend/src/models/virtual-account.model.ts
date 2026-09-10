import pool from '../config/database';
import { IVirtualAccount, ICreateVirtualAccount } from '../types/payment.types';
import logger from '../utils/logger';

export class VirtualAccountModel {
    static async create(data: ICreateVirtualAccount): Promise<IVirtualAccount> {
        const result = await pool.query(
            `INSERT INTO virtual_accounts (
                user_id, provider, provider_account_id, account_number,
                bank_name, account_name, status, kyc_verified, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`,
            [
                data.userId,
                data.provider,
                data.providerAccountId,
                data.accountNumber,
                data.bankName,
                data.accountName,
                data.status || 'active',
                data.kycVerified || false,
                data.metadata || null,
            ]
        );
        logger.info(`Virtual account created: ${result.rows[0].account_number}`);
        return result.rows[0];
    }

    static async getByUserId(userId: string): Promise<IVirtualAccount | null> {
        const result = await pool.query(
            'SELECT * FROM virtual_accounts WHERE user_id = $1 AND status != $2 ORDER BY created_at DESC LIMIT 1',
            [userId, 'closed']
        );
        return result.rows[0] || null;
    }

    static async getByAccountNumber(accountNumber: string): Promise<IVirtualAccount | null> {
        const result = await pool.query(
            'SELECT * FROM virtual_accounts WHERE account_number = $1 AND status = $2',
            [accountNumber, 'active']
        );
        return result.rows[0] || null;
    }

    static async getById(id: string): Promise<IVirtualAccount | null> {
        const result = await pool.query(
            'SELECT * FROM virtual_accounts WHERE id = $1',
            [id]
        );
        return result.rows[0] || null;
    }

    static async updateStatus(
        id: string,
        status: 'pending' | 'active' | 'suspended' | 'closed'
    ): Promise<IVirtualAccount | null> {
        const result = await pool.query(
            `UPDATE virtual_accounts 
             SET status = $1, updated_at = NOW() 
             WHERE id = $2
             RETURNING *`,
            [status, id]
        );
        return result.rows[0] || null;
    }

    static async updateKycStatus(id: string, verified: boolean): Promise<IVirtualAccount | null> {
        const result = await pool.query(
            `UPDATE virtual_accounts 
             SET kyc_verified = $1, updated_at = NOW() 
             WHERE id = $2
             RETURNING *`,
            [verified, id]
        );
        return result.rows[0] || null;
    }

    static async getAllByUserId(userId: string): Promise<IVirtualAccount[]> {
        const result = await pool.query(
            'SELECT * FROM virtual_accounts WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        return result.rows;
    }

    static async hasActiveAccount(userId: string): Promise<boolean> {
        const result = await pool.query(
            'SELECT 1 FROM virtual_accounts WHERE user_id = $1 AND status = $2 LIMIT 1',
            [userId, 'active']
        );
        return (result.rowCount ?? 0) > 0;
    }
}

export default VirtualAccountModel;