import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env';
import { 
  IPaystackInitTransaction, 
  IPaystackInitResponse,
  IPaystackVerifyResponse,
  IPaystackWebhookEvent
} from '../types/payment.types';
import logger from '../utils/logger';

export class PaystackService {
  private static readonly BASE_URL = 'https://api.paystack.co';
  private static readonly SECRET_KEY = env.paystackSecretKey;
  private static readonly CALLBACK_URL = env.paystackCallbackUrl;

  // ============================================
  // TRANSACTION OPERATIONS
  // ============================================

  /**
   * Initialize a transaction
   * Supports both standard and split payments
   * 
   * @param data - Transaction initialization data
   * @param data.split - Optional split configuration for multi-recipient payments
   * @returns Paystack initialization response
   */
  static async initializeTransaction(
    data: IPaystackInitTransaction
  ): Promise<IPaystackInitResponse> {
    try {
      const payload: any = {
        email: data.email,
        amount: Math.round(data.amount),
        currency: data.currency || 'NGN',
        reference: data.reference,
        callback_url: data.callback_url || this.CALLBACK_URL,
        metadata: data.metadata,
      };
      
      // ✅ SUPPORT SPLIT PARAMETER
      if (data.split) {
        payload.split = data.split;
        logger.info(`Split payment initialized with ${data.split.subaccounts.length} subaccounts`, {
          reference: data.reference,
          type: data.split.type,
          currency: data.split.currency,
        });
      }
      
      const response = await axios.post(
        `${this.BASE_URL}/transaction/initialize`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack transaction initialized: ${response.data.data.reference}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to initialize transaction');
      }
    } catch (error) {
      logger.error('Paystack initialize error:', error);
      throw error;
    }
  }

  /**
   * Verify a transaction
   */
  static async verifyTransaction(
    reference: string
  ): Promise<IPaystackVerifyResponse> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      if (response.data.status) {
        logger.info(`Paystack transaction verified: ${reference}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to verify transaction');
      }
    } catch (error) {
      logger.error('Paystack verify error:', error);
      throw error;
    }
  }

  // ============================================
  // CUSTOMER OPERATIONS
  // ============================================

  /**
   * Create a customer on Paystack
   * Required before creating a Dedicated Virtual Account (DVA)
   */
  static async createCustomer(data: {
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const response = await axios.post(
        `${this.BASE_URL}/customer`,
        {
          email: data.email,
          first_name: data.first_name,
          last_name: data.last_name,
          phone: data.phone || '08000000000',
          metadata: data.metadata || {},
        },
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack customer created: ${response.data.data.customer_code}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to create customer');
      }
    } catch (error) {
      logger.error('Paystack create customer error:', error);
      throw error;
    }
  }

  /**
   * Get customer by code or email
   */
  static async getCustomer(identifier: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/customer/${identifier}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack get customer error:', error);
      throw error;
    }
  }

  /**
   * Update customer details
   */
  static async updateCustomer(
    customerCode: string,
    data: {
      first_name?: string;
      last_name?: string;
      phone?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<any> {
    try {
      const payload: any = {};
      if (data.first_name) payload.first_name = data.first_name;
      if (data.last_name) payload.last_name = data.last_name;
      if (data.phone) payload.phone = data.phone;
      if (data.metadata) payload.metadata = data.metadata;

      const response = await axios.put(
        `${this.BASE_URL}/customer/${customerCode}`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack customer updated: ${customerCode}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to update customer');
      }
    } catch (error) {
      logger.error('Paystack update customer error:', error);
      throw error;
    }
  }

  /**
   * Submit KYC identification (BVN/NIN)
   * Required for DVA creation in production
   */
  static async submitIdentification(
    customerCode: string,
    data: {
      country: string;
      type: 'bvn' | 'nin' | 'identity_number';
      value: string;
      first_name?: string;
      last_name?: string;
    }
  ): Promise<any> {
    try {
      const payload: any = {
        country: data.country || 'NG',
        type: data.type,
        value: data.value,
      };

      if (data.first_name) payload.first_name = data.first_name;
      if (data.last_name) payload.last_name = data.last_name;

      const response = await axios.post(
        `${this.BASE_URL}/customer/${customerCode}/identification`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`KYC identification submitted for customer: ${customerCode}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to submit identification');
      }
    } catch (error) {
      logger.error('Paystack identification error:', error);
      throw error;
    }
  }

  // ============================================
  // DEDICATED VIRTUAL ACCOUNT (DVA) OPERATIONS
  // ============================================

  /**
   * Create a Dedicated Virtual Account (DVA) for an existing customer
   * This generates a static NUBAN account number for the customer
   * 
   * Endpoint: POST /dedicated_account
   */
  static async createDedicatedAccount(data: {
    customer: string; // customer_code
    preferred_bank?: string; // 'wema-bank', 'titan-paystack', or 'test-bank'
    subaccount?: string; // For transaction splits
    split_code?: string; // For transaction splits
    first_name?: string; // Customer's first name
    last_name?: string; // Customer's last name
    phone?: string; // Customer's phone number
  }): Promise<any> {
    try {
      const payload: any = {
        customer: data.customer,
        preferred_bank: data.preferred_bank || 'wema-bank',
      };

      if (data.subaccount) {
        payload.subaccount = data.subaccount;
      }
      if (data.split_code) {
        payload.split_code = data.split_code;
      }
      if (data.first_name) {
        payload.first_name = data.first_name;
      }
      if (data.last_name) {
        payload.last_name = data.last_name;
      }
      if (data.phone) {
        payload.phone = data.phone;
      }

      const response = await axios.post(
        `${this.BASE_URL}/dedicated_account`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Dedicated account created for customer: ${data.customer}`, {
          account_number: response.data.data.account_number,
          bank: response.data.data.bank.name,
        });
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to create dedicated account');
      }
    } catch (error) {
      logger.error('Paystack create dedicated account error:', error);
      throw error;
    }
  }

  /**
   * Create a Dedicated Virtual Account (DVA) and Customer in one call
   * This is the RECOMMENDED approach as it creates both customer and DVA atomically
   * 
   * Endpoint: POST /dedicated_account/assign
   * 
   * This endpoint:
   * 1. Creates a customer if they don't exist
   * 2. Validates the customer
   * 3. Assigns a DVA to the customer
   * 
   * Note: Returns 202 Accepted (async processing)
   * Use getActiveDedicatedAccount to fetch the DVA after provisioning
   * 
   * @param data - Customer and DVA configuration
   * @returns The DVA assignment response
   */
  static async createDedicatedAccountAssign(data: {
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
    preferred_bank?: string;  // 'wema-bank' | 'titan-paystack'
    country?: string;         // 'NG' or 'GH'
    bvn?: string;            // Optional BVN (Nigeria only)
    account_number?: string; // Optional bank account
    bank_code?: string;      // Optional bank code
    subaccount?: string;     // For transaction splits
    split_code?: string;     // For transaction splits
  }): Promise<any> {
    try {
      const payload: any = {
        email: data.email,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        preferred_bank: data.preferred_bank || 'wema-bank',
        country: data.country || 'NG',
      };

      // Optional fields
      if (data.bvn) {
        payload.bvn = data.bvn;
      }
      if (data.account_number) {
        payload.account_number = data.account_number;
      }
      if (data.bank_code) {
        payload.bank_code = data.bank_code;
      }
      if (data.subaccount) {
        payload.subaccount = data.subaccount;
      }
      if (data.split_code) {
        payload.split_code = data.split_code;
      }

      const response = await axios.post(
        `${this.BASE_URL}/dedicated_account/assign`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      // Note: /assign endpoint returns 202 Accepted (async processing)
      // The actual DVA details can be fetched later using getActiveDedicatedAccount
      if (response.data.status) {
        logger.info(`Dedicated account assignment initiated for: ${data.email}`, {
          message: response.data.message,
          customer: data.email,
        });
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to assign dedicated account');
      }
    } catch (error) {
      logger.error('Paystack create dedicated account assign error:', error);
      throw error;
    }
  }

  /**
   * Get a customer's dedicated virtual accounts
   * 
   * @param customerCode - The Paystack customer code (e.g., CUS_xxxxxx)
   * @param activeOnly - If true, only return active accounts
   * @returns List of dedicated accounts
   */
  static async getDedicatedAccounts(
    customerCode: string,
    activeOnly: boolean = false
  ): Promise<any> {
    try {
      let url = `${this.BASE_URL}/dedicated_account?customer=${customerCode}`;
      if (activeOnly) {
        url += '&active=true';
      }

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.SECRET_KEY}`,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Paystack get dedicated accounts error:', error);
      throw error;
    }
  }

  /**
   * Get the active dedicated virtual account for a customer
   * 
   * @param customerCode - The Paystack customer code
   * @returns The first active DVA or null
   */
  static async getActiveDedicatedAccount(customerCode: string): Promise<any> {
    try {
      const response = await this.getDedicatedAccounts(customerCode, true);
      const accounts = response?.data?.data || [];
      
      // Return the first active account
      const activeAccount = accounts.find((account: any) => account.active === true);
      
      if (activeAccount) {
        logger.debug(`Active DVA found for customer: ${customerCode}`, {
          account_number: activeAccount.account_number,
          bank: activeAccount.bank?.name,
        });
      } else {
        logger.debug(`No active DVA found for customer: ${customerCode}`);
      }
      
      return activeAccount || null;
    } catch (error) {
      logger.error('Paystack get active dedicated account error:', error);
      throw error;
    }
  }

  /**
   * Get a dedicated virtual account by ID
   * 
   * @param dedicatedAccountId - The DVA ID from Paystack
   * @returns The dedicated account details
   */
  static async getDedicatedAccountById(dedicatedAccountId: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/dedicated_account/${dedicatedAccountId}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      if (response.data.status) {
        logger.debug(`Dedicated account retrieved: ${dedicatedAccountId}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to retrieve dedicated account');
      }
    } catch (error) {
      logger.error('Paystack get dedicated account by id error:', error);
      throw error;
    }
  }

  /**
   * Requery a dedicated virtual account for new transactions
   * Use this to manually check for transfers that may not have been received via webhook
   * 
   * @param accountNumber - The virtual account number
   * @param providerSlug - The bank slug (e.g., 'wema-bank')
   * @param date - Optional date in YYYY-MM-DD format
   * @returns Requery status
   */
  static async requeryDedicatedAccount(
    accountNumber: string,
    providerSlug: string,
    date?: string
  ): Promise<any> {
    try {
      let url = `${this.BASE_URL}/dedicated_account/requery?account_number=${accountNumber}&provider_slug=${providerSlug}`;
      if (date) {
        url += `&date=${date}`;
      }

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.SECRET_KEY}`,
        },
      });

      if (response.data.status) {
        logger.info(`Dedicated account requery initiated for: ${accountNumber}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to requery dedicated account');
      }
    } catch (error) {
      logger.error('Paystack requery dedicated account error:', error);
      throw error;
    }
  }

  /**
   * Deactivate a dedicated virtual account
   * 
   * @param accountId - The DVA ID from Paystack
   * @returns Deactivation result
   */
  static async deactivateDedicatedAccount(accountId: string): Promise<any> {
    try {
      const response = await axios.delete(
        `${this.BASE_URL}/dedicated_account/${accountId}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      if (response.data.status) {
        logger.info(`Dedicated account deactivated: ${accountId}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to deactivate dedicated account');
      }
    } catch (error) {
      logger.error('Paystack deactivate dedicated account error:', error);
      throw error;
    }
  }

  /**
   * Get available bank providers for dedicated virtual accounts
   * 
   * @returns List of available banks
   */
  static async getAvailableDVAProviders(): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/dedicated_account/available_providers`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      if (response.data.status) {
        logger.info('Available DVA providers retrieved');
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to retrieve DVA providers');
      }
    } catch (error) {
      logger.error('Paystack get available DVA providers error:', error);
      throw error;
    }
  }

  // ============================================
  // SUBACCOUNT OPERATIONS
  // ============================================

  /**
   * Create a subaccount on Paystack
   * Subaccounts allow you to split payments to multiple bank accounts
   * 
   * Endpoint: POST /subaccount
   * 
   * @param data - Subaccount configuration
   * @returns Created subaccount details
   */
  static async createSubaccount(data: {
    business_name: string;
    settlement_bank: string;
    account_number: string;
    percentage_charge?: number;  // Commission rate (e.g., 15 for 15%)
    description?: string;
    primary_contact_email?: string;
    primary_contact_name?: string;
    primary_contact_phone?: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    try {
      const payload: any = {
        business_name: data.business_name,
        settlement_bank: data.settlement_bank,
        account_number: data.account_number,
        percentage_charge: data.percentage_charge || 0,
      };

      if (data.description) {
        payload.description = data.description;
      }
      if (data.primary_contact_email) {
        payload.primary_contact_email = data.primary_contact_email;
      }
      if (data.primary_contact_name) {
        payload.primary_contact_name = data.primary_contact_name;
      }
      if (data.primary_contact_phone) {
        payload.primary_contact_phone = data.primary_contact_phone;
      }
      if (data.metadata) {
        payload.metadata = data.metadata;
      }

      const response = await axios.post(
        `${this.BASE_URL}/subaccount`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack subaccount created: ${response.data.data.subaccount_code}`, {
          business_name: data.business_name,
          account_number: data.account_number,
        });
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to create subaccount');
      }
    } catch (error) {
      logger.error('Paystack create subaccount error:', error);
      throw error;
    }
  }

  /**
   * List all subaccounts
   * 
   * @param perPage - Number of records per page
   * @param page - Page number
   * @returns List of subaccounts
   */
  static async listSubaccounts(
    perPage: number = 50,
    page: number = 1
  ): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/subaccount?perPage=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack list subaccounts error:', error);
      throw error;
    }
  }

  /**
   * Get a subaccount by ID or code
   * 
   * @param identifier - Subaccount ID or code
   * @returns Subaccount details
   */
  static async getSubaccount(identifier: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/subaccount/${identifier}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack get subaccount error:', error);
      throw error;
    }
  }

  /**
   * Update a subaccount
   * 
   * @param identifier - Subaccount ID or code
   * @param data - Updated subaccount data
   * @returns Updated subaccount details
   */
  static async updateSubaccount(
    identifier: string,
    data: {
      business_name?: string;
      settlement_bank?: string;
      account_number?: string;
      percentage_charge?: number;
      description?: string;
      primary_contact_email?: string;
      primary_contact_name?: string;
      primary_contact_phone?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<any> {
    try {
      const payload: any = {};

      if (data.business_name) payload.business_name = data.business_name;
      if (data.settlement_bank) payload.settlement_bank = data.settlement_bank;
      if (data.account_number) payload.account_number = data.account_number;
      if (data.percentage_charge !== undefined) payload.percentage_charge = data.percentage_charge;
      if (data.description) payload.description = data.description;
      if (data.primary_contact_email) payload.primary_contact_email = data.primary_contact_email;
      if (data.primary_contact_name) payload.primary_contact_name = data.primary_contact_name;
      if (data.primary_contact_phone) payload.primary_contact_phone = data.primary_contact_phone;
      if (data.metadata) payload.metadata = data.metadata;

      const response = await axios.put(
        `${this.BASE_URL}/subaccount/${identifier}`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack subaccount updated: ${identifier}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to update subaccount');
      }
    } catch (error) {
      logger.error('Paystack update subaccount error:', error);
      throw error;
    }
  }

  // ============================================
  // SPLIT CODE OPERATIONS
  // ============================================

  /**
   * Create a split code for multiple recipients
   * Split codes allow you to distribute payments across multiple subaccounts
   * 
   * Endpoint: POST /split
   * 
   * @param data - Split code configuration
   * @returns Created split code details
   */
  static async createSplitCode(data: {
    name: string;
    type: 'percentage' | 'flat';
    currency: string;
    subaccounts: Array<{
      subaccount: string;
      share: number;  // percentage or flat amount
    }>;
    bearer_type?: 'all' | 'subaccount';  // Who bears the transaction fee
    bearer_subaccount?: string;  // Subaccount that bears the fee
  }): Promise<any> {
    try {
      const payload: any = {
        name: data.name,
        type: data.type,
        currency: data.currency || 'NGN',
        subaccounts: data.subaccounts,
      };

      if (data.bearer_type) {
        payload.bearer_type = data.bearer_type;
      }
      if (data.bearer_subaccount) {
        payload.bearer_subaccount = data.bearer_subaccount;
      }

      const response = await axios.post(
        `${this.BASE_URL}/split`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack split code created: ${response.data.data.split_code}`, {
          name: data.name,
          subaccount_count: data.subaccounts.length,
        });
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to create split code');
      }
    } catch (error) {
      logger.error('Paystack create split code error:', error);
      throw error;
    }
  }

  /**
   * List all split codes
   * 
   * @param perPage - Number of records per page
   * @param page - Page number
   * @returns List of split codes
   */
  static async listSplitCodes(
    perPage: number = 50,
    page: number = 1
  ): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/split?perPage=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack list split codes error:', error);
      throw error;
    }
  }

  /**
   * Get a split code by ID or code
   * 
   * @param identifier - Split ID or code
   * @returns Split code details
   */
  static async getSplitCode(identifier: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/split/${identifier}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack get split code error:', error);
      throw error;
    }
  }

  /**
   * Update a split code
   * 
   * @param identifier - Split ID or code
   * @param data - Updated split code data
   * @returns Updated split code details
   */
  static async updateSplitCode(
    identifier: string,
    data: {
      name?: string;
      type?: 'percentage' | 'flat';
      currency?: string;
      subaccounts?: Array<{
        subaccount: string;
        share: number;
      }>;
      bearer_type?: 'all' | 'subaccount';
      bearer_subaccount?: string;
      active?: boolean;
    }
  ): Promise<any> {
    try {
      const payload: any = {};

      if (data.name) payload.name = data.name;
      if (data.type) payload.type = data.type;
      if (data.currency) payload.currency = data.currency;
      if (data.subaccounts) payload.subaccounts = data.subaccounts;
      if (data.bearer_type) payload.bearer_type = data.bearer_type;
      if (data.bearer_subaccount) payload.bearer_subaccount = data.bearer_subaccount;
      if (data.active !== undefined) payload.active = data.active;

      const response = await axios.put(
        `${this.BASE_URL}/split/${identifier}`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack split code updated: ${identifier}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to update split code');
      }
    } catch (error) {
      logger.error('Paystack update split code error:', error);
      throw error;
    }
  }

  /**
   * Add a subaccount to an existing split code
   * 
   * @param splitCode - Split code identifier
   * @param subaccount - Subaccount code
   * @param share - Share percentage or amount
   * @returns Updated split code
   */
  static async addSubaccountToSplit(
    splitCode: string,
    subaccount: string,
    share: number
  ): Promise<any> {
    try {
      // First get the current split
      const currentSplit = await this.getSplitCode(splitCode);
      
      if (!currentSplit.status || !currentSplit.data) {
        throw new Error('Split code not found');
      }

      const existingSubaccounts = currentSplit.data.subaccounts || [];
      
      // Check if subaccount already exists
      const existingIndex = existingSubaccounts.findIndex(
        (s: any) => s.subaccount === subaccount
      );

      if (existingIndex >= 0) {
        // Update existing share
        existingSubaccounts[existingIndex].share = share;
      } else {
        // Add new subaccount
        existingSubaccounts.push({ subaccount, share });
      }

      // Update the split
      return this.updateSplitCode(splitCode, {
        subaccounts: existingSubaccounts,
      });
    } catch (error) {
      logger.error('Paystack add subaccount to split error:', error);
      throw error;
    }
  }

  /**
   * Remove a subaccount from a split code
   * 
   * @param splitCode - Split code identifier
   * @param subaccount - Subaccount code to remove
   * @returns Updated split code
   */
  static async removeSubaccountFromSplit(
    splitCode: string,
    subaccount: string
  ): Promise<any> {
    try {
      // First get the current split
      const currentSplit = await this.getSplitCode(splitCode);
      
      if (!currentSplit.status || !currentSplit.data) {
        throw new Error('Split code not found');
      }

      const existingSubaccounts = currentSplit.data.subaccounts || [];
      
      // Filter out the subaccount
      const filteredSubaccounts = existingSubaccounts.filter(
        (s: any) => s.subaccount !== subaccount
      );

      if (filteredSubaccounts.length === existingSubaccounts.length) {
        throw new Error('Subaccount not found in split');
      }

      // Update the split
      return this.updateSplitCode(splitCode, {
        subaccounts: filteredSubaccounts,
      });
    } catch (error) {
      logger.error('Paystack remove subaccount from split error:', error);
      throw error;
    }
  }

  // ============================================
  // DVA SPLIT OPERATIONS
  // ============================================

  /**
   * Apply a split configuration to a dedicated virtual account
   * This enables automatic splitting of incoming transfers
   * 
   * Endpoint: POST /dedicated_account/split
   * 
   * @param data - Split configuration
   * @returns Split assignment result
   */
  static async applySplitToDVA(data: {
    customer: string;           // Customer ID or code
    subaccount?: string;       // Subaccount code for split
    split_code?: string;       // Split code for multi-recipient
    preferred_bank?: string;   // Preferred bank slug
  }): Promise<any> {
    try {
      const payload: any = {
        customer: data.customer,
      };

      if (data.subaccount) {
        payload.subaccount = data.subaccount;
      }
      if (data.split_code) {
        payload.split_code = data.split_code;
      }
      if (data.preferred_bank) {
        payload.preferred_bank = data.preferred_bank;
      }

      const response = await axios.post(
        `${this.BASE_URL}/dedicated_account/split`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Split applied to DVA for customer: ${data.customer}`, {
          split_code: data.split_code,
          subaccount: data.subaccount,
        });
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to apply split to DVA');
      }
    } catch (error) {
      logger.error('Paystack apply split to DVA error:', error);
      throw error;
    }
  }

  /**
   * Remove split configuration from a dedicated virtual account
   * 
   * Endpoint: DELETE /dedicated_account/split
   * 
   * @param accountNumber - The virtual account number
   * @returns Removal result
   */
  static async removeSplitFromDVA(accountNumber: string): Promise<any> {
    try {
      const response = await axios.delete(
        `${this.BASE_URL}/dedicated_account/split`,
        {
          data: {
            account_number: accountNumber,
          },
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Split removed from DVA: ${accountNumber}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to remove split from DVA');
      }
    } catch (error) {
      logger.error('Paystack remove split from DVA error:', error);
      throw error;
    }
  }

  // ============================================
  // DVA WEBHOOK HANDLING
  // ============================================

  /**
   * Handle DVA webhook event (charge.success)
   * This is called when a customer transfers money to their DVA
   */
  static handleDVAWebhook(event: IPaystackWebhookEvent): {
    eventType: string;
    reference: string;
    status: string;
    amount: number;
    customerCode: string;
    customerEmail: string;
    metadata: any;
  } {
    const eventType = event.event;
    const reference = event.data.reference;
    const status = event.data.status;
    const amount = event.data.amount;
    
    // Safely access customer data
    const customerData = event.data.customer;
    const customerCode = customerData?.customer_code || event.data.metadata?.customer_code || '';
    const customerEmail = customerData?.email || event.data.metadata?.email || '';
    const metadata = event.data.metadata || {};

    logger.info(`Paystack DVA webhook received: ${eventType} for ${reference}`, {
      customer: customerCode,
      amount: amount / 100,
      status,
    });

    return {
      eventType,
      reference,
      status,
      amount: amount / 100,
      customerCode,
      customerEmail,
      metadata,
    };
  }

  /**
   * Verify DVA webhook signature
   * Uses HMAC-SHA512 with the secret key
   */
  static verifyDVAWebhookSignature(
    payload: any,
    signature: string
  ): boolean {
    if (!signature) {
      logger.warn('Missing Paystack signature header');
      return false;
    }

    try {
      const hash = crypto
        .createHmac('sha512', this.SECRET_KEY)
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
  // REFUND OPERATIONS
  // ============================================

  /**
   * Create a refund
   */
  static async createRefund(
    transactionReference: string,
    amount: number
  ): Promise<any> {
    try {
      const response = await axios.post(
        `${this.BASE_URL}/refund`,
        {
          transaction: transactionReference,
          amount: Math.round(amount),
        },
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack refund created: ${response.data.data.reference}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to create refund');
      }
    } catch (error) {
      logger.error('Paystack refund error:', error);
      throw error;
    }
  }

  // ============================================
  // BANK OPERATIONS
  // ============================================

  /**
   * List banks
   */
  static async getBanks(): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/bank?currency=NGN`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack get banks error:', error);
      throw error;
    }
  }

  /**
   * Resolve bank account number
   */
  static async resolveBankAccount(
    accountNumber: string,
    bankCode: string
  ): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/bank/resolve`,
        {
          params: {
            account_number: accountNumber,
            bank_code: bankCode,
          },
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack resolve account error:', error);
      throw error;
    }
  }

  // ============================================
  // TRANSFER OPERATIONS (Payouts)
  // ============================================

  /**
   * Create a transfer recipient
   */
  static async createTransferRecipient(
    data: {
      type: string;
      name: string;
      account_number: string;
      bank_code: string;
      currency?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<any> {
    try {
      const payload: any = {
        type: data.type || 'nuban',
        name: data.name,
        account_number: data.account_number,
        bank_code: data.bank_code,
        currency: data.currency || 'NGN',
      };

      if (data.metadata) {
        payload.metadata = data.metadata;
      }

      const response = await axios.post(
        `${this.BASE_URL}/transferrecipient`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack transfer recipient created: ${response.data.data.recipient_code}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to create transfer recipient');
      }
    } catch (error) {
      logger.error('Paystack create transfer recipient error:', error);
      throw error;
    }
  }

  /**
   * List transfer recipients
   */
  static async listTransferRecipients(
    perPage: number = 50,
    page: number = 1
  ): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/transferrecipient?perPage=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack list transfer recipients error:', error);
      throw error;
    }
  }

  /**
   * Initialize a transfer
   */
  static async initializeTransfer(
    data: {
      recipient_code: string;
      amount: number;
      reason?: string;
      reference?: string;
      source?: 'balance' | 'dedicated_account';
    }
  ): Promise<any> {
    try {
      const payload: any = {
        source: data.source || 'balance',
        recipient: data.recipient_code,
        amount: Math.round(data.amount),
        reason: data.reason || 'PingRide payout',
        reference: data.reference || this.generateReference(),
      };

      const response = await axios.post(
        `${this.BASE_URL}/transfer`,
        payload,
        {
          headers: this.getHeaders(),
        }
      );

      if (response.data.status) {
        logger.info(`Paystack transfer initialized: ${response.data.data.reference}`);
        return response.data;
      } else {
        throw new Error(response.data.message || 'Failed to initialize transfer');
      }
    } catch (error) {
      logger.error('Paystack initialize transfer error:', error);
      throw error;
    }
  }

  /**
   * Verify a transfer
   */
  static async verifyTransfer(reference: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/transfer/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack verify transfer error:', error);
      throw error;
    }
  }

  /**
   * Finalize a transfer (for OTP verification)
   */
  static async finalizeTransfer(
    transferCode: string,
    otp: string
  ): Promise<any> {
    try {
      const response = await axios.post(
        `${this.BASE_URL}/transfer/finalize`,
        {
          transfer_code: transferCode,
          otp: otp,
        },
        {
          headers: this.getHeaders(),
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack finalize transfer error:', error);
      throw error;
    }
  }

  // ============================================
  // TRANSACTION LOOKUP
  // ============================================

  /**
   * Get transaction by reference
   */
  static async getTransaction(reference: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/transaction/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack get transaction error:', error);
      throw error;
    }
  }

  /**
   * List transactions
   */
  static async listTransactions(
    perPage: number = 50,
    page: number = 1,
    filters?: {
      from?: string;
      to?: string;
      customer?: string;
      status?: string;
    }
  ): Promise<any> {
    try {
      let url = `${this.BASE_URL}/transaction?perPage=${perPage}&page=${page}`;
      
      if (filters?.from) url += `&from=${filters.from}`;
      if (filters?.to) url += `&to=${filters.to}`;
      if (filters?.customer) url += `&customer=${filters.customer}`;
      if (filters?.status) url += `&status=${filters.status}`;

      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${this.SECRET_KEY}`,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Paystack list transactions error:', error);
      throw error;
    }
  }

  // ============================================
  // BALANCE OPERATIONS
  // ============================================

  /**
   * Get balance
   */
  static async getBalance(): Promise<any> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/balance`,
        {
          headers: {
            Authorization: `Bearer ${this.SECRET_KEY}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('Paystack get balance error:', error);
      throw error;
    }
  }

  // ============================================
  // WEBHOOK EVENT HANDLER
  // ============================================

  /**
   * Handle webhook event
   * Supports both standard transactions and DVA transfers
   */
  static handleWebhookEvent(event: IPaystackWebhookEvent): {
    eventType: string;
    reference: string;
    status: string;
    amount: number;
    metadata: any;
    isDVA: boolean;
    customerCode?: string;
  } {
    const eventType = event.event;
    const reference = event.data.reference;
    const status = event.data.status;
    const amount = event.data.amount;
    const metadata = event.data.metadata || {};

    // Safely access customer data
    const customerData = event.data.customer;
    const customerCode = customerData?.customer_code || metadata.customer_code;

    // Check if this is a DVA transfer
    const isDVA = !!(customerData?.customer_code || metadata.customer_code);

    // Check if this is a split transaction
    const isSplit = !!(metadata.split || metadata.subaccount);

    logger.info(`Paystack webhook received: ${eventType} for ${reference}`, {
      status,
      amount: amount / 100,
      isDVA,
      isSplit,
      customer: customerCode,
    });

    return {
      eventType,
      reference,
      status,
      amount: amount / 100,
      metadata,
      isDVA,
      customerCode,
    };
  }

  // ============================================
  // CONVENIENCE / UTILITY METHODS
  // ============================================

  /**
   * Generate a unique reference
   */
  static generateReference(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `PR-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Format amount to kobo (Paystack expects kobo)
   */
  static toKobo(amount: number): number {
    return Math.round(amount * 100);
  }

  /**
   * Format amount from kobo to naira
   */
  static fromKobo(amount: number): number {
    return amount / 100;
  }

  /**
   * Check if Paystack is configured
   */
  static isConfigured(): boolean {
    return Boolean(this.SECRET_KEY) && this.SECRET_KEY !== 'your-secret-key';
  }

  /**
   * Get headers for Paystack API requests
   */
  private static getHeaders(): { Authorization: string; 'Content-Type': string } {
    return {
      Authorization: `Bearer ${this.SECRET_KEY}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Check if a customer has an active dedicated virtual account
   */
  static async hasActiveDedicatedAccount(customerCode: string): Promise<boolean> {
    try {
      const account = await this.getActiveDedicatedAccount(customerCode);
      return account !== null;
    } catch (error) {
      logger.error('Error checking active DVA:', error);
      return false;
    }
  }

  /**
   * Get or create a dedicated virtual account for a customer
   * This is a convenience method that checks for existing DVA and creates one if needed
   * 
   * @param customerCode - The Paystack customer code
   * @param customerData - Customer data for creating DVA if needed
   * @returns The active DVA
   */
  static async getOrCreateDedicatedAccount(
    customerCode: string,
    customerData: {
      email: string;
      first_name: string;
      last_name: string;
      phone: string;
      preferred_bank?: string;
      bvn?: string;
      subaccount?: string;
      split_code?: string;
    }
  ): Promise<any> {
    try {
      // First, check if there's an active DVA
      const existingAccount = await this.getActiveDedicatedAccount(customerCode);
      
      if (existingAccount) {
        logger.debug(`Using existing DVA for customer: ${customerCode}`);
        return existingAccount;
      }

      // No active DVA found, create one using the assign endpoint
      logger.info(`Creating new DVA for customer: ${customerCode}`);
      
      const assignResult = await this.createDedicatedAccountAssign({
        email: customerData.email,
        first_name: customerData.first_name,
        last_name: customerData.last_name,
        phone: customerData.phone,
        preferred_bank: customerData.preferred_bank || 'wema-bank',
        bvn: customerData.bvn,
        subaccount: customerData.subaccount,
        split_code: customerData.split_code,
      });

      if (!assignResult.status) {
        throw new Error(assignResult.message || 'Failed to create DVA');
      }

      // Wait a moment for the DVA to be provisioned
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Fetch the newly created DVA
      const newAccount = await this.getActiveDedicatedAccount(customerCode);
      
      if (!newAccount) {
        throw new Error('DVA created but not found after provisioning');
      }

      logger.info(`New DVA created and retrieved for customer: ${customerCode}`, {
        account_number: newAccount.account_number,
        bank: newAccount.bank?.name,
      });

      return newAccount;
    } catch (error) {
      logger.error('Error getting or creating DVA:', error);
      throw error;
    }
  }
}

export default PaystackService;