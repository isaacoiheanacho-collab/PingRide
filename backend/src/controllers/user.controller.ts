import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import UserService from '../services/user.service';
import { UserModel } from '../models/user.model';

export class UserController {
  /**
   * Get current user profile
   */
  async getProfile(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    
    const user = await UserService.getUserById(userId);
    const profile = await UserModel.getPassengerProfile(userId);
    
    return ApiResponseHandler.success(res, {
      ...user,
      profile,
    });
  }

  /**
   * Update current user profile
   */
  async updateProfile(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }
    
    const { 
      first_name, 
      last_name, 
      email, 
      preferred_language, 
      profile_photo_url, 
      date_of_birth, 
      gender 
    } = req.body;
    
    // Update users table fields
    const userUpdate: any = {};
    if (email !== undefined) userUpdate.email = email;
    if (preferred_language !== undefined) userUpdate.preferred_language = preferred_language;
    
    if (Object.keys(userUpdate).length > 0) {
      await UserService.updateUserProfile(userId, userUpdate);
    }
    
    // Update passenger profile fields
    const passengerUpdate: any = {};
    if (first_name !== undefined) passengerUpdate.first_name = first_name;
    if (last_name !== undefined) passengerUpdate.last_name = last_name;
    if (profile_photo_url !== undefined) passengerUpdate.profile_photo_url = profile_photo_url;
    if (date_of_birth !== undefined) passengerUpdate.date_of_birth = date_of_birth;
    if (gender !== undefined) passengerUpdate.gender = gender;
    
    if (Object.keys(passengerUpdate).length > 0) {
      await UserService.updatePassengerProfile(userId, passengerUpdate);
    }
    
    // Get the updated user
    const user = await UserService.getUserById(userId);
    const profile = await UserModel.getPassengerProfile(userId);
    
    return ApiResponseHandler.success(res, {
      user,
      profile,
    }, {
      message: 'Profile updated successfully'
    });
  }

  /**
   * Get user by ID (admin only)
   */
  async getUserById(req: AuthRequest, res: Response): Promise<Response> {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    const user = await UserService.getUserById(idStr);
    const profile = await UserModel.getPassengerProfile(idStr);
    
    return ApiResponseHandler.success(res, {
      ...user,
      profile,
    });
  }

  /**
   * Get all users with pagination (admin only)
   */
  async getUsers(req: AuthRequest, res: Response): Promise<Response> {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const status = req.query.status as string;
    const role = req.query.role as string;
    const search = req.query.search as string;
    
    const result = await UserService.getUsers(page, limit, { status, role, search });
    return ApiResponseHandler.success(res, result, {
      meta: {
        timestamp: new Date().toISOString(),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          pages: Math.ceil(result.total / result.limit),
        }
      }
    });
  }

  /**
   * Search users (admin only)
   */
  async searchUsers(req: AuthRequest, res: Response): Promise<Response> {
    const query = req.query.q as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    
    if (!query || query.length < 2) {
      return ApiResponseHandler.validationError(res, 'Search query must be at least 2 characters');
    }
    
    const result = await UserService.searchUsers(query, page, limit);
    return ApiResponseHandler.success(res, result, {
      meta: {
        timestamp: new Date().toISOString(),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          pages: Math.ceil(result.total / result.limit),
        }
      }
    });
  }

  /**
   * Update user status (admin only)
   */
  async updateStatus(req: AuthRequest, res: Response): Promise<Response> {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    const { status, reason } = req.body;
    
    const user = await UserService.updateStatus(idStr, status, reason);
    return ApiResponseHandler.success(res, user, {
      message: `User status updated to ${status}`
    });
  }

  /**
   * Delete user (admin only)
   */
  async deleteUser(req: AuthRequest, res: Response): Promise<Response> {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    await UserService.deleteUser(idStr);
    return ApiResponseHandler.success(res, null, {
      message: 'User deleted successfully'
    });
  }
}

export default UserController;