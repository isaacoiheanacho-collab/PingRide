import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { ApiResponseHandler } from '../utils/response';
import PassengerService from '../services/passenger.service';
import { UserModel } from '../models/user.model';

export class PassengerController {
  /**
   * Get passenger profile
   */
  async getProfile(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const profile = await PassengerService.getProfile(userId);
    const user = await UserModel.findById(userId);
    
    return ApiResponseHandler.success(res, {
      ...profile,
      user: {
        id: user?.id,
        phone_number: user?.phone_number,
        email: user?.email,
        status: user?.status,
      }
    });
  }

  /**
   * Create or update passenger profile
   */
  async updateProfile(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { first_name, last_name, profile_photo_url, date_of_birth, gender } = req.body;
    
    const profile = await PassengerService.upsertProfile(userId, {
      first_name,
      last_name,
      profile_photo_url,
      date_of_birth,
      gender,
    });

    return ApiResponseHandler.success(res, profile, {
      message: 'Profile updated successfully'
    });
  }

  /**
   * Get passenger preferences
   */
  async getPreferences(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const preferences = await PassengerService.getPreferences(userId);
    return ApiResponseHandler.success(res, preferences);
  }

  /**
   * Update passenger preferences
   */
  async updatePreferences(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { preferred_vehicle_type, music_preference, conversation_preference, max_wait_time, notify_promotions, notify_ride_updates } = req.body;
    
    const preferences = await PassengerService.updatePreferences(userId, {
      preferred_vehicle_type,
      music_preference,
      conversation_preference,
      max_wait_time,
      notify_promotions,
      notify_ride_updates,
    });

    return ApiResponseHandler.success(res, preferences, {
      message: 'Preferences updated successfully'
    });
  }

  /**
   * Get passenger statistics
   */
  async getStats(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const stats = await PassengerService.getStats(userId);
    return ApiResponseHandler.success(res, stats);
  }

  /**
   * Get saved locations
   */
  async getSavedLocations(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const locations = await PassengerService.getSavedLocations(userId);
    return ApiResponseHandler.success(res, locations);
  }

  /**
   * Create saved location
   */
  async createSavedLocation(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { label, address, latitude, longitude, is_default } = req.body;
    
    const location = await PassengerService.createSavedLocation(userId, {
      label,
      address,
      latitude,
      longitude,
      is_default,
    });

    return ApiResponseHandler.success(res, location, {
      message: 'Saved location created successfully'
    });
  }

  /**
   * Update saved location
   */
  async updateSavedLocation(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    const { label, address, latitude, longitude, is_default } = req.body;
    
    const location = await PassengerService.updateSavedLocation(userId, idStr, {
      label,
      address,
      latitude,
      longitude,
      is_default,
    });

    return ApiResponseHandler.success(res, location, {
      message: 'Saved location updated successfully'
    });
  }

  /**
   * Delete saved location
   */
  async deleteSavedLocation(req: AuthRequest, res: Response): Promise<Response> {
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponseHandler.unauthorized(res, 'Not authenticated');
    }

    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;

    await PassengerService.deleteSavedLocation(userId, idStr);

    return ApiResponseHandler.success(res, null, {
      message: 'Saved location deleted successfully'
    });
  }
}

export default PassengerController;