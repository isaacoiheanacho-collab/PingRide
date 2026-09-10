import { UserModel } from '../models/user.model';
import PassengerModel from '../models/passenger.model';
import SavedLocationModel from '../models/saved-location.model';
import PassengerPreferenceModel from '../models/passenger-preference.model';
import { IPassengerProfile, ICreateSavedLocation, IUpdatePassengerProfile, IUpdatePassengerPreference } from '../types';
import { NotFoundError, ValidationError } from '../middleware/error.middleware';

export class PassengerService {
  /**
   * Get passenger profile by user ID
   */
  static async getProfile(userId: string): Promise<IPassengerProfile> {
    // Check if user exists
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const profile = await PassengerModel.getProfile(userId);
    if (!profile) {
      throw new NotFoundError('Passenger profile not found');
    }

    return profile;
  }

  /**
   * Create or update passenger profile
   */
  static async upsertProfile(
    userId: string,
    data: IUpdatePassengerProfile
  ): Promise<IPassengerProfile> {
    // Check if user exists
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check if profile exists
    let profile = await PassengerModel.getProfile(userId);

    if (!profile) {
      // Create new profile
      if (!data.first_name || !data.last_name) {
        throw new ValidationError('First name and last name are required to create a profile');
      }
      profile = await PassengerModel.createProfile(userId, {
        first_name: data.first_name,
        last_name: data.last_name,
        profile_photo_url: data.profile_photo_url,
        date_of_birth: data.date_of_birth,
        gender: data.gender,
      });
    } else {
      // Update existing profile
      const updated = await PassengerModel.updateProfile(userId, data);
      if (updated) {
        profile = updated;
      }
    }

    return profile;
  }

  /**
   * Get passenger preferences
   */
  static async getPreferences(userId: string): Promise<any> {
    const profile = await this.getProfile(userId);
    const preferences = await PassengerPreferenceModel.getByPassengerId(profile.id);
    
    if (!preferences) {
      // Return default preferences
      return {
        preferred_vehicle_type: 'standard',
        music_preference: 'any',
        conversation_preference: 'any',
        max_wait_time: 10,
        notify_promotions: true,
        notify_ride_updates: true,
      };
    }
    
    return preferences;
  }

  /**
   * Update passenger preferences
   */
  static async updatePreferences(
    userId: string,
    data: IUpdatePassengerPreference
  ): Promise<any> {
    const profile = await this.getProfile(userId);
    const preferences = await PassengerPreferenceModel.upsert(profile.id, data);
    return preferences;
  }

  /**
   * Get saved locations for a passenger
   */
  static async getSavedLocations(userId: string): Promise<any[]> {
    const profile = await this.getProfile(userId);
    return SavedLocationModel.getByPassengerId(profile.id);
  }

  /**
   * Create saved location
   */
  static async createSavedLocation(
    userId: string,
    data: ICreateSavedLocation
  ): Promise<any> {
    const profile = await this.getProfile(userId);
    
    if (!data.label || !data.address || data.latitude === undefined || data.longitude === undefined) {
      throw new ValidationError('Label, address, latitude, and longitude are required');
    }

    return SavedLocationModel.create(profile.id, data);
  }

  /**
   * Update saved location
   */
  static async updateSavedLocation(
    userId: string,
    locationId: string,
    data: Partial<ICreateSavedLocation>
  ): Promise<any> {
    // Verify location belongs to user
    const profile = await this.getProfile(userId);
    const location = await SavedLocationModel.getById(locationId);
    
    if (!location) {
      throw new NotFoundError('Saved location not found');
    }
    
    if (location.passenger_id !== profile.id) {
      throw new ValidationError('Location does not belong to this passenger');
    }

    const updated = await SavedLocationModel.update(locationId, data);
    if (!updated) {
      throw new NotFoundError('Saved location not found');
    }
    
    return updated;
  }

  /**
   * Delete saved location
   */
  static async deleteSavedLocation(
    userId: string,
    locationId: string
  ): Promise<void> {
    // Verify location belongs to user
    const profile = await this.getProfile(userId);
    const location = await SavedLocationModel.getById(locationId);
    
    if (!location) {
      throw new NotFoundError('Saved location not found');
    }
    
    if (location.passenger_id !== profile.id) {
      throw new ValidationError('Location does not belong to this passenger');
    }

    await SavedLocationModel.delete(locationId);
  }

  /**
   * Get passenger statistics
   */
  static async getStats(userId: string): Promise<any> {
    const profile = await this.getProfile(userId);
    const savedLocations = await SavedLocationModel.getByPassengerId(profile.id);
    const preferences = await PassengerPreferenceModel.getByPassengerId(profile.id);

    return {
      total_rides: profile.total_rides,
      lifetime_spend: profile.lifetime_spend,
      trust_score: profile.trust_score,
      rating_as_passenger: profile.rating_as_passenger,
      saved_locations_count: savedLocations.length,
      has_preferences: !!preferences,
      member_since: profile.created_at,
    };
  }
}

export default PassengerService;