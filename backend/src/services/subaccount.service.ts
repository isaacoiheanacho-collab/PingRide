import { DriverModel } from '../models/driver.model';
import { PaystackService } from './paystack.service';
import { BankService } from './bank.service';
import logger from '../utils/logger';

export interface ISubaccountCreationResult {
  success: boolean;
  subaccount_code?: string;
  subaccount_id?: string;
  message: string;
  metadata?: any;
}

export class SubaccountService {
  static async createDriverSubaccount(data: {
    driverId: string;
    userId: string;
    firstName: string;
    lastName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
    phoneNumber?: string;
    email?: string;
  }): Promise<ISubaccountCreationResult> {
    try {
      const { driverId, firstName, lastName, bankCode, accountNumber, accountName } = data;

      if (!bankCode || !accountNumber) {
        return {
          success: false,
          message: 'Bank code and account number are required',
        };
      }

      const existingSubaccount = await DriverModel.getSubaccountCode(driverId);
      if (existingSubaccount) {
        logger.info('Driver ' + driverId + ' already has subaccount: ' + existingSubaccount);
        return {
          success: true,
          subaccount_code: existingSubaccount,
          message: 'Driver already has an active subaccount',
          metadata: {
            driver_id: driverId,
            subaccount_code: existingSubaccount,
            exists: true,
          },
        };
      }

      const validation = await BankService.validateBankAccount(bankCode, accountNumber);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.message || 'Invalid bank account details',
        };
      }

      const businessName = (firstName + ' ' + lastName).trim() || 'PingRide Driver';

      const response = await PaystackService.createSubaccount({
        business_name: businessName,
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: 0,
        description: 'PingRide driver subaccount - ' + driverId,
        primary_contact_email: data.email || 'driver@pingride.com',
        primary_contact_name: businessName,
        primary_contact_phone: data.phoneNumber || '08000000000',
        metadata: {
          driver_id: driverId,
          user_id: data.userId,
          created_by: 'system',
          created_at: new Date().toISOString(),
        },
      });

      if (!response.status) {
        logger.error('Failed to create subaccount for driver ' + driverId + ': ' + response.message);
        return {
          success: false,
          message: response.message || 'Failed to create subaccount',
        };
      }

      const subaccountData = response.data;
      const subaccountCode = subaccountData.subaccount_code;

      const updatedDriver = await DriverModel.updateSubaccount(
        driverId,
        subaccountCode,
        'active'
      );

      if (!updatedDriver) {
        return {
          success: true,
          subaccount_code: subaccountCode,
          subaccount_id: subaccountData.id,
          message: 'Subaccount created but failed to update driver profile',
          metadata: {
            driver_id: driverId,
            subaccount_code: subaccountCode,
            requires_manual_update: true,
          },
        };
      }

      logger.info('Subaccount created for driver ' + driverId + ': ' + subaccountCode);

      return {
        success: true,
        subaccount_code: subaccountCode,
        subaccount_id: subaccountData.id,
        message: 'Subaccount created successfully',
        metadata: {
          driver_id: driverId,
          bank_code: bankCode,
          account_number: accountNumber.slice(-4),
          account_name: accountName,
          created_at: new Date().toISOString(),
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating subaccount for driver ' + data.driverId + ': ' + errorMessage);
      await DriverModel.updateSubaccountStatus(data.driverId, 'failed');
      return {
        success: false,
        message: 'Failed to create subaccount: ' + errorMessage,
      };
    }
  }

  static async ensureDriverSubaccount(
    driverId: string,
    bankCode: string,
    accountNumber: string,
    accountName?: string
  ): Promise<ISubaccountCreationResult> {
    try {
      const existingSubaccount = await DriverModel.getSubaccountCode(driverId);

      if (existingSubaccount) {
        logger.info('Driver ' + driverId + ' already has subaccount: ' + existingSubaccount);
        try {
          const subaccount = await PaystackService.getSubaccount(existingSubaccount);
          if (subaccount.status && subaccount.data) {
            return {
              success: true,
              subaccount_code: existingSubaccount,
              message: 'Driver already has an active subaccount',
              metadata: {
                driver_id: driverId,
                subaccount_code: existingSubaccount,
                exists: true,
              },
            };
          }
        } catch (error) {
          logger.warn('Existing subaccount ' + existingSubaccount + ' not found in Paystack for driver ' + driverId);
        }
      }

      const driver = await DriverModel.getById(driverId);
      if (!driver) {
        return {
          success: false,
          message: 'Driver not found',
        };
      }

      const driverWithUser = await DriverModel.getDriverWithUser(driverId);
      if (!driverWithUser) {
        return {
          success: false,
          message: 'Driver user details not found',
        };
      }

      return this.createDriverSubaccount({
        driverId: driverId,
        userId: driver.user_id,
        firstName: driver.first_name,
        lastName: driver.last_name,
        bankCode: bankCode,
        accountNumber: accountNumber,
        accountName: accountName || (driver.first_name + ' ' + driver.last_name),
        phoneNumber: driverWithUser.phone_number,
        email: driverWithUser.email,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error ensuring subaccount for driver ' + driverId + ': ' + errorMessage);
      return {
        success: false,
        message: 'Failed to ensure subaccount: ' + errorMessage,
      };
    }
  }

  static async getDriverSubaccountDetails(driverId: string): Promise<any> {
    try {
      const driver = await DriverModel.getById(driverId);
      if (!driver) {
        logger.warn('Driver ' + driverId + ' not found');
        return null;
      }

      if (!driver.subaccount_code) {
        logger.info('Driver ' + driverId + ' has no subaccount');
        return null;
      }

      const response = await PaystackService.getSubaccount(driver.subaccount_code);

      if (!response.status) {
        logger.warn('Subaccount ' + driver.subaccount_code + ' not found in Paystack');
        return {
          driver_id: driverId,
          subaccount_code: driver.subaccount_code,
          status: 'not_found_in_paystack',
          bank_code: driver.bank_code,
          account_number: driver.account_number,
          account_name: driver.account_name,
        };
      }

      const subaccountData = response.data;

      return {
        driver_id: driverId,
        subaccount_code: driver.subaccount_code,
        subaccount_id: subaccountData.id,
        business_name: subaccountData.business_name,
        bank_name: subaccountData.bank?.name || 'Unknown Bank',
        bank_code: driver.bank_code,
        account_number: driver.account_number,
        account_name: driver.account_name,
        percentage_charge: subaccountData.percentage_charge,
        status: subaccountData.status || driver.subaccount_status,
        created_at: driver.subaccount_created_at,
        paystack_data: subaccountData,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting subaccount details for driver ' + driverId + ': ' + errorMessage);
      return null;
    }
  }

  static async updateDriverSubaccount(
    driverId: string,
    bankCode?: string,
    accountNumber?: string,
    accountName?: string
  ): Promise<ISubaccountCreationResult> {
    try {
      const driver = await DriverModel.getById(driverId);
      if (!driver) {
        return {
          success: false,
          message: 'Driver not found',
        };
      }

      if (bankCode && accountNumber) {
        const validation = await BankService.validateBankAccount(bankCode, accountNumber);
        if (!validation.valid) {
          return {
            success: false,
            message: validation.message || 'Invalid bank account details',
          };
        }
        accountName = accountName || validation.account_name;
      }

      const updatedDriver = await DriverModel.updateBankDetails(driverId, {
        bank_code: bankCode || driver.bank_code || '',
        account_number: accountNumber || driver.account_number || '',
        account_name: accountName || driver.account_name || '',
      });

      if (!updatedDriver) {
        return {
          success: false,
          message: 'Failed to update bank details',
        };
      }

      if (driver.subaccount_code && bankCode && accountNumber) {
        try {
          const updateResponse = await PaystackService.updateSubaccount(
            driver.subaccount_code,
            {
              settlement_bank: bankCode,
              account_number: accountNumber,
            }
          );

          if (!updateResponse.status) {
            logger.warn('Failed to update subaccount in Paystack for driver ' + driverId + ': ' + updateResponse.message);
            return {
              success: true,
              subaccount_code: driver.subaccount_code,
              message: 'Bank details updated but failed to update Paystack subaccount',
              metadata: {
                driver_id: driverId,
                requires_manual_action: true,
                paystack_error: updateResponse.message,
              },
            };
          }
        } catch (error) {
          logger.error('Error updating subaccount in Paystack for driver ' + driverId, error);
          return {
            success: true,
            subaccount_code: driver.subaccount_code,
            message: 'Bank details updated but Paystack update failed - manual review needed',
            metadata: {
              driver_id: driverId,
              requires_manual_action: true,
            },
          };
        }
      }

      if (!driver.subaccount_code && bankCode && accountNumber) {
        return this.createDriverSubaccount({
          driverId: driverId,
          userId: driver.user_id,
          firstName: driver.first_name,
          lastName: driver.last_name,
          bankCode: bankCode,
          accountNumber: accountNumber,
          accountName: accountName || (driver.first_name + ' ' + driver.last_name),
        });
      }

      return {
        success: true,
        subaccount_code: driver.subaccount_code || undefined,
        message: 'Subaccount updated successfully',
        metadata: {
          driver_id: driverId,
          bank_code: bankCode || driver.bank_code,
          account_number: (accountNumber || driver.account_number)?.slice(-4),
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error updating subaccount for driver ' + driverId + ': ' + errorMessage);
      return {
        success: false,
        message: 'Failed to update subaccount: ' + errorMessage,
      };
    }
  }

  static async batchCreateSubaccounts(
    driverIds: string[]
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: Array<{ driverId: string; result: ISubaccountCreationResult }>;
  }> {
    const results: Array<{ driverId: string; result: ISubaccountCreationResult }> = [];
    let successful = 0;
    let failed = 0;

    for (const driverId of driverIds) {
      try {
        const driver = await DriverModel.getById(driverId);
        if (!driver) {
          results.push({
            driverId,
            result: {
              success: false,
              message: 'Driver not found',
            },
          });
          failed++;
          continue;
        }

        if (!driver.bank_code || !driver.account_number) {
          results.push({
            driverId,
            result: {
              success: false,
              message: 'Driver has no bank details',
            },
          });
          failed++;
          continue;
        }

        const result = await this.ensureDriverSubaccount(
          driverId,
          driver.bank_code,
          driver.account_number,
          driver.account_name
        );

        results.push({ driverId, result });

        if (result.success) {
          successful++;
        } else {
          failed++;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          driverId,
          result: {
            success: false,
            message: 'Error: ' + errorMessage,
          },
        });
        failed++;
      }
    }

    logger.info('Batch subaccount creation completed: ' + successful + ' successful, ' + failed + ' failed');

    return {
      total: driverIds.length,
      successful,
      failed,
      results,
    };
  }

  static async getSubaccountStats(): Promise<{
    totalDrivers: number;
    withSubaccount: number;
    withBankDetails: number;
    pendingSubaccount: number;
    failedSubaccount: number;
    activeSubaccount: number;
  }> {
    const pool = (await import('../config/database')).default;

    const result = await pool.query(`
      SELECT
        COUNT(*) as total_drivers,
        COUNT(CASE WHEN subaccount_code IS NOT NULL THEN 1 END) as with_subaccount,
        COUNT(CASE WHEN bank_code IS NOT NULL AND account_number IS NOT NULL THEN 1 END) as with_bank_details,
        COUNT(CASE WHEN subaccount_status = 'pending' THEN 1 END) as pending_subaccount,
        COUNT(CASE WHEN subaccount_status = 'failed' THEN 1 END) as failed_subaccount,
        COUNT(CASE WHEN subaccount_status = 'active' THEN 1 END) as active_subaccount
      FROM driver_profiles
      WHERE driver_status = 'active'
    `);

    const row = result.rows[0];

    return {
      totalDrivers: parseInt(row.total_drivers || '0', 10),
      withSubaccount: parseInt(row.with_subaccount || '0', 10),
      withBankDetails: parseInt(row.with_bank_details || '0', 10),
      pendingSubaccount: parseInt(row.pending_subaccount || '0', 10),
      failedSubaccount: parseInt(row.failed_subaccount || '0', 10),
      activeSubaccount: parseInt(row.active_subaccount || '0', 10),
    };
  }

  static async retryFailedSubaccount(driverId: string): Promise<ISubaccountCreationResult> {
    const driver = await DriverModel.getById(driverId);
    if (!driver) {
      return {
        success: false,
        message: 'Driver not found',
      };
    }

    if (!driver.bank_code || !driver.account_number) {
      return {
        success: false,
        message: 'Driver has no bank details',
      };
    }

    await DriverModel.updateSubaccountStatus(driverId, 'pending');

    return this.createDriverSubaccount({
      driverId: driverId,
      userId: driver.user_id,
      firstName: driver.first_name,
      lastName: driver.last_name,
      bankCode: driver.bank_code,
      accountNumber: driver.account_number,
      accountName: driver.account_name || (driver.first_name + ' ' + driver.last_name),
    });
  }
}

export default SubaccountService;