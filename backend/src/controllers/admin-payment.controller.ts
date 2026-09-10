import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import { PaystackService } from '../services/paystack.service';
import { VirtualAccountService } from '../services/virtual-account.service';
import logger from '../utils/logger';
import pool from '../config/database';

export class AdminPaymentController {
  async createSubaccount(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const {
      business_name,
      settlement_bank,
      account_number,
      percentage_charge,
      description,
      primary_contact_email,
      primary_contact_name,
      primary_contact_phone,
    } = req.body;

    if (!business_name || !settlement_bank || !account_number) {
      return ApiResponseHandler.validationError(
        res,
        'business_name, settlement_bank, and account_number are required'
      );
    }

    if (!PaystackService.isConfigured()) {
      return ApiResponseHandler.error(
        res,
        'PAYSTACK_NOT_CONFIGURED',
        'Paystack is not configured. Please set PAYSTACK_SECRET_KEY in environment variables.',
        503
      );
    }

    try {
      const result = await PaystackService.createSubaccount({
        business_name,
        settlement_bank,
        account_number,
        percentage_charge: percentage_charge || 0,
        description,
        primary_contact_email,
        primary_contact_name,
        primary_contact_phone,
        metadata: {
          created_by_admin: adminId,
          created_at: new Date().toISOString(),
        },
      });

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SUBACCOUNT_CREATION_FAILED',
          result.message || 'Failed to create subaccount',
          400
        );
      }

      await this.storeSubaccountInDatabase(result.data, adminId);

      logger.info('Subaccount created: ' + result.data.subaccount_code + ' by admin ' + adminId);

      return ApiResponseHandler.success(res, result.data, {
        message: 'Subaccount created successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating subaccount: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SUBACCOUNT_CREATION_ERROR',
        'Failed to create subaccount: ' + errorMessage,
        500
      );
    }
  }

  async listSubaccounts(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = parseInt(req.query.perPage as string, 10) || 50;

    try {
      const result = await PaystackService.listSubaccounts(perPage, page);

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SUBACCOUNT_LIST_FAILED',
          result.message || 'Failed to list subaccounts',
          400
        );
      }

      return ApiResponseHandler.success(res, result.data, {
        meta: {
          timestamp: new Date().toISOString(),
          pagination: result.meta,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error listing subaccounts: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SUBACCOUNT_LIST_ERROR',
        'Failed to list subaccounts: ' + errorMessage,
        500
      );
    }
  }

  async getSubaccount(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { identifier } = req.params;
    const identifierStr = Array.isArray(identifier) ? identifier[0] : identifier;

    if (!identifierStr) {
      return ApiResponseHandler.validationError(res, 'Subaccount identifier is required');
    }

    try {
      const result = await PaystackService.getSubaccount(identifierStr);

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SUBACCOUNT_NOT_FOUND',
          result.message || 'Subaccount not found',
          404
        );
      }

      return ApiResponseHandler.success(res, result.data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting subaccount: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SUBACCOUNT_GET_ERROR',
        'Failed to get subaccount: ' + errorMessage,
        500
      );
    }
  }

  async updateSubaccount(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { identifier } = req.params;
    const identifierStr = Array.isArray(identifier) ? identifier[0] : identifier;

    const {
      business_name,
      settlement_bank,
      account_number,
      percentage_charge,
      description,
      primary_contact_email,
      primary_contact_name,
      primary_contact_phone,
    } = req.body;

    try {
      const result = await PaystackService.updateSubaccount(identifierStr, {
        business_name,
        settlement_bank,
        account_number,
        percentage_charge,
        description,
        primary_contact_email,
        primary_contact_name,
        primary_contact_phone,
        metadata: {
          updated_by_admin: adminId,
          updated_at: new Date().toISOString(),
        },
      });

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SUBACCOUNT_UPDATE_FAILED',
          result.message || 'Failed to update subaccount',
          400
        );
      }

      logger.info('Subaccount updated: ' + identifierStr + ' by admin ' + adminId);

      return ApiResponseHandler.success(res, result.data, {
        message: 'Subaccount updated successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error updating subaccount: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SUBACCOUNT_UPDATE_ERROR',
        'Failed to update subaccount: ' + errorMessage,
        500
      );
    }
  }

  async createSplitCode(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const {
      name,
      type,
      currency,
      subaccounts,
      bearer_type,
      bearer_subaccount,
    } = req.body;

    if (!name || !type || !subaccounts || !Array.isArray(subaccounts) || subaccounts.length === 0) {
      return ApiResponseHandler.validationError(
        res,
        'name, type, and subaccounts array are required'
      );
    }

    let totalShares = 0;
    for (const subaccount of subaccounts) {
      if (!subaccount.subaccount || subaccount.share === undefined) {
        return ApiResponseHandler.validationError(
          res,
          'Each subaccount must have subaccount and share'
        );
      }
      if (type === 'percentage') {
        totalShares += subaccount.share;
      }
    }

    if (type === 'percentage' && Math.abs(totalShares - 100) > 0.01) {
      return ApiResponseHandler.validationError(
        res,
        'Percentage shares must sum to 100%. Current total: ' + totalShares + '%'
      );
    }

    try {
      const result = await PaystackService.createSplitCode({
        name,
        type,
        currency: currency || 'NGN',
        subaccounts,
        bearer_type,
        bearer_subaccount,
      });

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SPLIT_CODE_CREATION_FAILED',
          result.message || 'Failed to create split code',
          400
        );
      }

      logger.info('Split code created: ' + result.data.split_code + ' by admin ' + adminId);

      return ApiResponseHandler.success(res, result.data, {
        message: 'Split code created successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating split code: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SPLIT_CODE_CREATION_ERROR',
        'Failed to create split code: ' + errorMessage,
        500
      );
    }
  }

  async listSplitCodes(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = parseInt(req.query.perPage as string, 10) || 50;

    try {
      const result = await PaystackService.listSplitCodes(perPage, page);

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SPLIT_CODE_LIST_FAILED',
          result.message || 'Failed to list split codes',
          400
        );
      }

      return ApiResponseHandler.success(res, result.data, {
        meta: {
          timestamp: new Date().toISOString(),
          pagination: result.meta,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error listing split codes: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SPLIT_CODE_LIST_ERROR',
        'Failed to list split codes: ' + errorMessage,
        500
      );
    }
  }

  async getSplitCode(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { identifier } = req.params;
    const identifierStr = Array.isArray(identifier) ? identifier[0] : identifier;

    if (!identifierStr) {
      return ApiResponseHandler.validationError(res, 'Split code identifier is required');
    }

    try {
      const result = await PaystackService.getSplitCode(identifierStr);

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SPLIT_CODE_NOT_FOUND',
          result.message || 'Split code not found',
          404
        );
      }

      return ApiResponseHandler.success(res, result.data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting split code: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SPLIT_CODE_GET_ERROR',
        'Failed to get split code: ' + errorMessage,
        500
      );
    }
  }

  async updateSplitCode(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { identifier } = req.params;
    const identifierStr = Array.isArray(identifier) ? identifier[0] : identifier;

    const {
      name,
      type,
      currency,
      subaccounts,
      bearer_type,
      bearer_subaccount,
      active,
    } = req.body;

    try {
      const result = await PaystackService.updateSplitCode(identifierStr, {
        name,
        type,
        currency,
        subaccounts,
        bearer_type,
        bearer_subaccount,
        active,
      });

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SPLIT_CODE_UPDATE_FAILED',
          result.message || 'Failed to update split code',
          400
        );
      }

      logger.info('Split code updated: ' + identifierStr + ' by admin ' + adminId);

      return ApiResponseHandler.success(res, result.data, {
        message: 'Split code updated successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error updating split code: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SPLIT_CODE_UPDATE_ERROR',
        'Failed to update split code: ' + errorMessage,
        500
      );
    }
  }

  async applySplitToDVA(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const {
      user_id,
      split_code,
      subaccount,
      preferred_bank,
    } = req.body;

    if (!user_id) {
      return ApiResponseHandler.validationError(res, 'user_id is required');
    }

    if (!split_code && !subaccount) {
      return ApiResponseHandler.validationError(
        res,
        'Either split_code or subaccount is required'
      );
    }

    try {
      const virtualAccount = await VirtualAccountService.getVirtualAccount(user_id);
      if (!virtualAccount) {
        return ApiResponseHandler.notFound(res, 'Virtual account not found for this user');
      }

      const metadata = virtualAccount.metadata || {};
      const customerCode = metadata.customer_code || metadata.customerCode;

      if (!customerCode) {
        return ApiResponseHandler.error(
          res,
          'CUSTOMER_CODE_NOT_FOUND',
          'Paystack customer code not found for this user. Please ensure the user has a DVA provisioned.',
          400
        );
      }

      const result = await PaystackService.applySplitToDVA({
        customer: customerCode,
        split_code,
        subaccount,
        preferred_bank,
      });

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SPLIT_APPLY_FAILED',
          result.message || 'Failed to apply split to DVA',
          400
        );
      }

      await VirtualAccountService.updateSplitConfiguration(user_id, {
        split_code,
        subaccount,
        preferred_bank,
      });

      logger.info('Split applied to DVA for user ' + user_id + ' by admin ' + adminId);

      return ApiResponseHandler.success(res, result.data, {
        message: 'Split applied to DVA successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error applying split to DVA: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SPLIT_APPLY_ERROR',
        'Failed to apply split to DVA: ' + errorMessage,
        500
      );
    }
  }

  async removeSplitFromDVA(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { user_id } = req.body;

    if (!user_id) {
      return ApiResponseHandler.validationError(res, 'user_id is required');
    }

    try {
      const virtualAccount = await VirtualAccountService.getVirtualAccount(user_id);
      if (!virtualAccount) {
        return ApiResponseHandler.notFound(res, 'Virtual account not found for this user');
      }

      const result = await PaystackService.removeSplitFromDVA(virtualAccount.account_number);

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'SPLIT_REMOVE_FAILED',
          result.message || 'Failed to remove split from DVA',
          400
        );
      }

      await VirtualAccountService.updateSplitConfiguration(user_id, {
        split_code: undefined,
        subaccount: undefined,
        preferred_bank: undefined,
      });

      logger.info('Split removed from DVA for user ' + user_id + ' by admin ' + adminId);

      return ApiResponseHandler.success(res, result.data, {
        message: 'Split removed from DVA successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error removing split from DVA: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SPLIT_REMOVE_ERROR',
        'Failed to remove split from DVA: ' + errorMessage,
        500
      );
    }
  }

  async getSplitConfigStatus(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const user_id = req.query.userId as string;

    try {
      if (user_id) {
        const config = await VirtualAccountService.getSplitConfiguration(user_id);
        const hasSplit = await VirtualAccountService.hasSplitConfigured(user_id);

        return ApiResponseHandler.success(res, {
          user_id,
          has_split: hasSplit,
          configuration: config,
        });
      } else {
        const isPaystackConfigured = PaystackService.isConfigured();
        const availableBanks = isPaystackConfigured
          ? await PaystackService.getAvailableDVAProviders()
          : null;

        const splitUsersCount = await this.getSplitUsersCount();

        return ApiResponseHandler.success(res, {
          paystack_configured: isPaystackConfigured,
          available_banks: availableBanks?.data || [],
          split_users_count: splitUsersCount,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting split config status: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SPLIT_STATUS_ERROR',
        'Failed to get split status: ' + errorMessage,
        500
      );
    }
  }

  async getSplitUsers(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    try {
      const offset = (page - 1) * limit;
      const result = await pool.query(
        'SELECT va.user_id, va.account_number, va.bank_name, va.account_name, va.metadata, u.phone_number, u.email, p.first_name, p.last_name FROM virtual_accounts va JOIN users u ON va.user_id = u.id LEFT JOIN passenger_profiles p ON u.id = p.user_id WHERE va.status = $1 AND (va.metadata->>$2 IS NOT NULL OR va.metadata->>$3 IS NOT NULL) ORDER BY va.created_at DESC LIMIT $4 OFFSET $5',
        ['active', 'split_code', 'subaccount', limit, offset]
      );

      const countResult = await pool.query(
        'SELECT COUNT(*) as total FROM virtual_accounts va WHERE va.status = $1 AND (va.metadata->>$2 IS NOT NULL OR va.metadata->>$3 IS NOT NULL)',
        ['active', 'split_code', 'subaccount']
      );

      const users = result.rows.map((row) => ({
        user_id: row.user_id,
        account_number: row.account_number,
        bank_name: row.bank_name,
        account_name: row.account_name,
        phone_number: row.phone_number,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        split_configuration: {
          split_code: row.metadata?.split_code || null,
          subaccount: row.metadata?.subaccount || null,
          preferred_bank: row.metadata?.preferred_bank || null,
        },
      }));

      return ApiResponseHandler.success(res, users, {
        meta: {
          timestamp: new Date().toISOString(),
          pagination: {
            page,
            limit,
            total: parseInt(countResult.rows[0]?.total || '0', 10),
            pages: Math.ceil(parseInt(countResult.rows[0]?.total || '0', 10) / limit),
          },
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting split users: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'SPLIT_USERS_ERROR',
        'Failed to get split users: ' + errorMessage,
        500
      );
    }
  }

  async getAvailableBanks(req: AuthRequest, res: Response): Promise<Response> {
    const adminId = req.user?.id;
    if (!adminId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    try {
      const result = await PaystackService.getAvailableDVAProviders();

      if (!result.status) {
        return ApiResponseHandler.error(
          res,
          'BANKS_FETCH_FAILED',
          result.message || 'Failed to fetch available banks',
          400
        );
      }

      return ApiResponseHandler.success(res, result.data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error fetching available banks: ' + errorMessage);
      return ApiResponseHandler.error(
        res,
        'BANKS_FETCH_ERROR',
        'Failed to fetch available banks: ' + errorMessage,
        500
      );
    }
  }

  private async storeSubaccountInDatabase(subaccountData: any, adminId: string): Promise<void> {
    try {
      await pool.query(
        'INSERT INTO platform_configuration (key, value, category, description) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [
          'subaccount_' + subaccountData.subaccount_code,
          JSON.stringify({
            ...subaccountData,
            created_by_admin: adminId,
            created_at: new Date().toISOString(),
          }),
          'payment',
          'Paystack subaccount for commission splitting',
        ]
      );
    } catch (error) {
      logger.warn('Failed to store subaccount in database: ' + error);
    }
  }

  private async getSplitUsersCount(): Promise<number> {
    try {
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM virtual_accounts va WHERE va.status = $1 AND (va.metadata->>$2 IS NOT NULL OR va.metadata->>$3 IS NOT NULL)',
        ['active', 'split_code', 'subaccount']
      );
      return parseInt(result.rows[0]?.count || '0', 10);
    } catch (error) {
      logger.warn('Failed to get split users count: ' + error);
      return 0;
    }
  }
}

export default AdminPaymentController;