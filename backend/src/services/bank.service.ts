import { PaystackService } from './paystack.service';
import logger from '../utils/logger';

export interface IBank {
  code: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  type: string;
}

export interface IBankValidationResult {
  valid: boolean;
  account_name?: string;
  message?: string;
  bank_name?: string;
  bank_code?: string;
}

export class BankService {
  private static bankCache: IBank[] | null = null;
  private static cacheExpiry: Date | null = null;
  private static readonly CACHE_TTL = 3600000;

  static async getBanks(forceRefresh: boolean = false): Promise<IBank[]> {
    if (!forceRefresh && this.bankCache && this.cacheExpiry && new Date() < this.cacheExpiry) {
      logger.debug('Returning cached bank list');
      return this.bankCache;
    }

    try {
      const response = await PaystackService.getBanks();

      if (!response.status) {
        logger.error('Failed to fetch banks from Paystack: ' + response.message);
        if (this.bankCache) {
          logger.warn('Returning stale bank cache due to API failure');
          return this.bankCache;
        }
        throw new Error(response.message || 'Failed to fetch banks');
      }

      const banks = response.data.map((bank: any) => ({
        code: bank.code,
        name: bank.name,
        slug: bank.slug || bank.code,
        country: bank.country || 'NG',
        currency: bank.currency || 'NGN',
        type: bank.type || 'bank',
      }));

      this.bankCache = banks;
      this.cacheExpiry = new Date(Date.now() + this.CACHE_TTL);

      logger.info('Fetched ' + banks.length + ' banks from Paystack');
      return banks;
    } catch (error) {
      logger.error('Error fetching banks: ' + error);
      if (this.bankCache) {
        logger.warn('Returning stale bank cache due to error');
        return this.bankCache;
      }
      throw error;
    }
  }

  static async getBankByCode(bankCode: string): Promise<IBank | null> {
    const banks = await this.getBanks();
    return banks.find((bank) => bank.code === bankCode) || null;
  }

  static async getBankByName(bankName: string): Promise<IBank | null> {
    const banks = await this.getBanks();
    return banks.find((bank) =>
      bank.name.toLowerCase().includes(bankName.toLowerCase())
    ) || null;
  }

  static async validateBankAccount(
    bankCode: string,
    accountNumber: string
  ): Promise<IBankValidationResult> {
    if (!bankCode || !accountNumber) {
      return {
        valid: false,
        message: 'Bank code and account number are required',
      };
    }

    if (!/^[0-9]{10}$/.test(accountNumber)) {
      return {
        valid: false,
        message: 'Account number must be 10 digits',
      };
    }

    try {
      if (!PaystackService.isConfigured()) {
        logger.warn('Paystack not configured, using mock validation');
        return this.mockValidateBankAccount(bankCode, accountNumber);
      }

      const response = await PaystackService.resolveBankAccount(accountNumber, bankCode);

      if (!response.status) {
        logger.warn('Bank account resolution failed: ' + response.message);
        return {
          valid: false,
          message: response.message || 'Failed to validate bank account',
        };
      }

      const data = response.data;
      const bank = await this.getBankByCode(bankCode);

      return {
        valid: true,
        account_name: data.account_name,
        bank_name: (bank ? bank.name : null) || data.bank_name || 'Unknown Bank',
        bank_code: bankCode,
        message: 'Account validated successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error validating bank account: ' + errorMessage);
      return {
        valid: false,
        message: 'Failed to validate account: ' + errorMessage,
      };
    }
  }

  private static mockValidateBankAccount(
    bankCode: string,
    accountNumber: string
  ): IBankValidationResult {
    const mockAccountNames: Record<string, string> = {
      '0123456789': 'John Doe',
      '9876543210': 'Jane Smith',
      '1234567890': 'Michael Johnson',
    };

    const accountName = mockAccountNames[accountNumber] || 'Driver Account ' + accountNumber.slice(-4);

    return {
      valid: true,
      account_name: accountName,
      bank_name: 'Mock Bank (Development)',
      bank_code: bankCode,
      message: 'Account validated successfully (mock)',
    };
  }

  static formatBankCode(bankCode: string): string {
    return bankCode.padStart(3, '0');
  }

  static formatAccountNumber(accountNumber: string): string {
    if (accountNumber.length === 10) {
      return accountNumber.slice(0, 3) + '-' + accountNumber.slice(3, 6) + '-' + accountNumber.slice(6);
    }
    return accountNumber;
  }

  static maskAccountNumber(accountNumber: string): string {
    if (accountNumber.length >= 6) {
      return '******' + accountNumber.slice(-4);
    }
    return '******';
  }

  static async getBankName(bankCode: string): Promise<string | null> {
    const bank = await this.getBankByCode(bankCode);
    return bank ? bank.name : null;
  }

  static async getPopularBanks(): Promise<IBank[]> {
    const allBanks = await this.getBanks();
    const popularBankCodes = ['058', '011', '014', '033', '032', '035', '001', '034'];
    const popular = allBanks.filter((bank) => popularBankCodes.includes(bank.code));
    const others = allBanks.filter((bank) => !popularBankCodes.includes(bank.code));
    return [...popular, ...others];
  }

  static async searchBanks(query: string): Promise<IBank[]> {
    const banks = await this.getBanks();
    const searchQuery = query.toLowerCase().trim();
    return banks.filter((bank) =>
      bank.name.toLowerCase().includes(searchQuery) ||
      bank.code.includes(searchQuery) ||
      bank.slug.toLowerCase().includes(searchQuery)
    );
  }

  static clearCache(): void {
    this.bankCache = null;
    this.cacheExpiry = null;
    logger.info('Bank cache cleared');
  }

  static async isValidBankCode(bankCode: string): Promise<boolean> {
    const bank = await this.getBankByCode(bankCode);
    return bank !== null;
  }
}

export default BankService;