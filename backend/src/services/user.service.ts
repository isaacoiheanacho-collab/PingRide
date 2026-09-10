import { UserModel } from '../models/user.model';
import { IUser } from '../types';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/error.middleware';
import logger from '../utils/logger';

export class UserService {
  /**
   * Get user by ID
   */
  static async getUserById(id: string): Promise<IUser> {
    const user = await UserModel.findById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  /**
   * Get all users with pagination
   */
  static async getUsers(
    page: number = 1,
    limit: number = 20,
    filters?: {
      status?: string;
      role?: string;
      search?: string;
    }
  ): Promise<{ users: IUser[]; total: number; page: number; limit: number }> {
    const result = await UserModel.findAll({
      page,
      limit,
      status: filters?.status,
      role: filters?.role,
      search: filters?.search,
    });
    
    return {
      users: result.users,
      total: result.total,
      page,
      limit,
    };
  }

  /**
   * Update user profile (only users table fields)
   */
  static async updateUserProfile(
    userId: string,
    data: {
      email?: string;
      preferred_language?: string;
    }
  ): Promise<IUser> {
    const existingUser = await UserModel.findById(userId);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }
    
    if (data.email && data.email !== existingUser.email) {
      const emailExists = await UserModel.emailExists(data.email);
      if (emailExists) {
        throw new ConflictError('Email already in use');
      }
    }
    
    const updatedUser = await UserModel.updateProfile(userId, data);
    if (!updatedUser) {
      throw new ValidationError('No valid fields to update');
    }
    
    logger.info(`User profile updated: ${userId}`);
    return updatedUser;
  }

  /**
   * Update passenger profile (first_name, last_name, etc.)
   */
  static async updatePassengerProfile(
    userId: string,
    data: {
      first_name?: string;
      last_name?: string;
      profile_photo_url?: string;
      date_of_birth?: string;
      gender?: string;
    }
  ): Promise<any> {
    // Check if user exists
    const existingUser = await UserModel.findById(userId);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }
    
    // Check if passenger profile exists, if not create one
    let profile = await UserModel.getPassengerProfile(userId);
    if (!profile) {
      // Only create if we have first_name and last_name
      if (!data.first_name || !data.last_name) {
        throw new ValidationError('First name and last name are required to create a passenger profile');
      }
      profile = await UserModel.createPassengerProfile(userId, {
        first_name: data.first_name,
        last_name: data.last_name,
        profile_photo_url: data.profile_photo_url,
        date_of_birth: data.date_of_birth,
        gender: data.gender,
      });
      return profile;
    }
    
    const updatedProfile = await UserModel.updatePassengerProfile(userId, data);
    if (!updatedProfile) {
      throw new ValidationError('No valid fields to update');
    }
    
    logger.info(`Passenger profile updated for user: ${userId}`);
    return updatedProfile;
  }

  /**
   * Update user status (admin only)
   */
  static async updateStatus(
    userId: string,
    status: string,
    reason?: string
  ): Promise<IUser> {
    const validStatuses = ['active', 'suspended', 'deactivated', 'locked'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    
    const user = await UserModel.updateStatus(userId, status);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    logger.info(`User status updated: ${userId} -> ${status}${reason ? ` (${reason})` : ''}`);
    return user;
  }

  /**
   * Search users
   */
  static async searchUsers(
    query: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ users: IUser[]; total: number; page: number; limit: number }> {
    const result = await UserModel.search(query, { page, limit });
    return {
      users: result.users,
      total: result.total,
      page,
      limit,
    };
  }

  /**
   * Delete user (soft delete)
   */
  static async deleteUser(userId: string): Promise<void> {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    await UserModel.softDelete(userId);
    logger.info(`User soft deleted: ${userId}`);
  }
}

export default UserService;