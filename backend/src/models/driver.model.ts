import pool from '../config/database';
import { IDriverProfile, ICreateDriverProfile, IUpdateDriverProfile } from '../types';
import logger from '../utils/logger';

export class DriverModel {
  /**
   * Get driver profile by user ID
   */
  static async getByUserId(userId: string): Promise<IDriverProfile | null> {
    const query = 'SELECT * FROM driver_profiles WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Get driver profile by ID
   */
  static async getById(id: string): Promise<IDriverProfile | null> {
    const query = 'SELECT * FROM driver_profiles WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Create driver profile
   * Updated to include bank details for subaccount creation
   */
  static async create(
    userId: string,
    data: ICreateDriverProfile
  ): Promise<IDriverProfile> {
    const query = `
      INSERT INTO driver_profiles (
        user_id, first_name, last_name, profile_photo_url, date_of_birth,
        driver_license_number, driver_license_expiry, driver_status,
        availability_status, kyc_status, address, state_of_origin,
        emergency_contact_name, emergency_contact_phone,
        has_air_conditioning, has_working_stereo, interior_air_freshener,
        bank_code, account_number, subaccount_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `;
    const values = [
      userId,
      data.first_name,
      data.last_name,
      data.profile_photo_url || null,
      data.date_of_birth || null,
      data.driver_license_number,
      data.driver_license_expiry,
      'pending',
      'offline',
      'pending',
      data.address || null,
      data.state_of_origin || null,
      data.emergency_contact_name || null,
      data.emergency_contact_phone || null,
      data.has_air_conditioning !== undefined ? data.has_air_conditioning : true,
      data.has_working_stereo !== undefined ? data.has_working_stereo : true,
      data.interior_air_freshener !== undefined ? data.interior_air_freshener : false,
      data.bank_code || null,
      data.account_number || null,
      data.bank_code && data.account_number ? 'pending' : null,
    ];
    const result = await pool.query(query, values);
    logger.info(`Driver profile created for user: ${userId}`);
    return result.rows[0];
  }

  /**
   * Update driver profile
   * Updated to include bank details
   */
  static async update(
    userId: string,
    data: IUpdateDriverProfile
  ): Promise<IDriverProfile | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    const fields: Record<string, any> = {
      first_name: data.first_name,
      last_name: data.last_name,
      profile_photo_url: data.profile_photo_url,
      date_of_birth: data.date_of_birth,
      driver_license_number: data.driver_license_number,
      driver_license_expiry: data.driver_license_expiry,
      address: data.address,
      state_of_origin: data.state_of_origin,
      emergency_contact_name: data.emergency_contact_name,
      emergency_contact_phone: data.emergency_contact_phone,
      has_air_conditioning: data.has_air_conditioning,
      has_working_stereo: data.has_working_stereo,
      interior_air_freshener: data.interior_air_freshener,
      bank_code: data.bank_code,
      account_number: data.account_number,
      account_name: data.account_name,
    };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const query = `
      UPDATE driver_profiles 
      SET ${updates.join(', ')} 
      WHERE user_id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update driver status
   */
  static async updateStatus(driverId: string, status: string): Promise<IDriverProfile | null> {
    const query = `
      UPDATE driver_profiles 
      SET driver_status = $1, updated_at = NOW() 
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [status, driverId]);
    return result.rows[0] || null;
  }

  /**
   * Update KYC status
   */
  static async updateKycStatus(driverId: string, status: string, reason?: string): Promise<IDriverProfile | null> {
    const query = `
      UPDATE driver_profiles 
      SET kyc_status = $1, 
          ${reason ? `kyc_rejected_reason = $2,` : ''}
          ${status === 'approved' ? `kyc_approved_at = NOW(),` : ''}
          updated_at = NOW() 
      WHERE id = ${reason ? `$${3}` : `$${2}`}
      RETURNING *
    `;
    const values = reason ? [status, reason, driverId] : [status, driverId];
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update availability
   */
  static async updateAvailability(
    driverId: string,
    isOnline: boolean,
    latitude?: number,
    longitude?: number
  ): Promise<IDriverProfile | null> {
    const updates = [
      `is_online = $1`,
      `availability_status = $2`,
      `last_online_at = ${isOnline ? 'NOW()' : 'NULL'}`,
      `updated_at = NOW()`
    ];
    const values: any[] = [isOnline, isOnline ? 'online' : 'offline'];

    if (latitude !== undefined && longitude !== undefined) {
      updates.push(`last_location_latitude = $${values.length + 1}`);
      updates.push(`last_location_longitude = $${values.length + 2}`);
      updates.push(`last_location_update = NOW()`);
      values.push(latitude, longitude);
    }

    values.push(driverId);

    const query = `
      UPDATE driver_profiles 
      SET ${updates.join(', ')} 
      WHERE id = $${values.length}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update driver location
   */
  static async updateLocation(
    driverId: string,
    latitude: number,
    longitude: number
  ): Promise<void> {
    const query = `
      UPDATE driver_profiles 
      SET last_location_latitude = $1,
          last_location_longitude = $2,
          last_location_update = NOW(),
          updated_at = NOW() 
      WHERE id = $3
    `;
    await pool.query(query, [latitude, longitude, driverId]);
  }

  /**
   * Increment ride count and update earnings
   */
  static async incrementRideStats(
    driverId: string,
    earnings: number
  ): Promise<void> {
    const query = `
      UPDATE driver_profiles 
      SET total_rides = total_rides + 1,
          total_earnings = total_earnings + $1,
          updated_at = NOW() 
      WHERE id = $2
    `;
    await pool.query(query, [earnings, driverId]);
  }

  /**
   * Update driver rating
   */
  static async updateRating(driverId: string, newRating: number): Promise<void> {
    const query = `
      UPDATE driver_profiles 
      SET rating_average = $1,
          updated_at = NOW() 
      WHERE id = $2
    `;
    await pool.query(query, [newRating, driverId]);
  }

  /**
   * Get active drivers (online and available)
   */
  static async getActiveDrivers(limit?: number): Promise<IDriverProfile[]> {
    const query = `
      SELECT * FROM driver_profiles 
      WHERE is_online = true 
        AND driver_status = 'active' 
        AND kyc_status = 'approved'
      ORDER BY rating_average DESC
      ${limit ? `LIMIT ${limit}` : ''}
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  // ============================================
  // SUBACCOUNT MANAGEMENT METHODS (NEW)
  // ============================================

  /**
   * Update driver's subaccount details
   * Called after successful subaccount creation in Paystack
   */
  static async updateSubaccount(
    driverId: string,
    subaccountCode: string,
    status: string
  ): Promise<IDriverProfile | null> {
    const query = `
      UPDATE driver_profiles 
      SET subaccount_code = $1,
          subaccount_status = $2,
          subaccount_created_at = NOW(),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [subaccountCode, status, driverId]);
    
    if (result.rows[0]) {
      logger.info(`Subaccount updated for driver ${driverId}: ${subaccountCode} (${status})`);
    }
    
    return result.rows[0] || null;
  }

  /**
   * Update driver's bank details
   * Called when driver updates their bank information
   */
  static async updateBankDetails(
    driverId: string,
    data: {
      bank_code: string;
      account_number: string;
      account_name: string;
    }
  ): Promise<IDriverProfile | null> {
    const query = `
      UPDATE driver_profiles 
      SET bank_code = $1,
          account_number = $2,
          account_name = $3,
          subaccount_status = 'pending',
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    const result = await pool.query(query, [
      data.bank_code,
      data.account_number,
      data.account_name,
      driverId
    ]);
    
    if (result.rows[0]) {
      logger.info(`Bank details updated for driver ${driverId}`);
    }
    
    return result.rows[0] || null;
  }

  /**
   * Get driver's subaccount code
   * Returns null if no subaccount exists
   */
  static async getSubaccountCode(driverId: string): Promise<string | null> {
    const query = `
      SELECT subaccount_code FROM driver_profiles 
      WHERE id = $1 AND subaccount_status = 'active'
    `;
    const result = await pool.query(query, [driverId]);
    return result.rows[0]?.subaccount_code || null;
  }

  /**
   * Get driver's bank details
   * Returns bank_code, account_number, and account_name
   */
  static async getBankDetails(driverId: string): Promise<{
    bank_code: string | null;
    account_number: string | null;
    account_name: string | null;
  } | null> {
    const query = `
      SELECT bank_code, account_number, account_name 
      FROM driver_profiles 
      WHERE id = $1
    `;
    const result = await pool.query(query, [driverId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return {
      bank_code: result.rows[0].bank_code || null,
      account_number: result.rows[0].account_number || null,
      account_name: result.rows[0].account_name || null,
    };
  }

  /**
   * Check if driver has a valid subaccount
   */
  static async hasActiveSubaccount(driverId: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM driver_profiles 
      WHERE id = $1 
        AND subaccount_code IS NOT NULL 
        AND subaccount_status = 'active'
      LIMIT 1
    `;
    const result = await pool.query(query, [driverId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Check if driver has bank details
   */
  static async hasBankDetails(driverId: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM driver_profiles 
      WHERE id = $1 
        AND bank_code IS NOT NULL 
        AND account_number IS NOT NULL
      LIMIT 1
    `;
    const result = await pool.query(query, [driverId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Update subaccount status
   */
  static async updateSubaccountStatus(
    driverId: string,
    status: 'pending' | 'active' | 'failed'
  ): Promise<IDriverProfile | null> {
    const query = `
      UPDATE driver_profiles 
      SET subaccount_status = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [status, driverId]);
    return result.rows[0] || null;
  }

  /**
   * Get drivers without active subaccounts
   * Used for admin batch subaccount creation
   */
  static async getDriversWithoutSubaccount(
    limit: number = 100
  ): Promise<IDriverProfile[]> {
    const query = `
      SELECT * FROM driver_profiles 
      WHERE (subaccount_code IS NULL OR subaccount_status != 'active')
        AND bank_code IS NOT NULL 
        AND account_number IS NOT NULL
        AND driver_status = 'active'
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Get driver with full subaccount details including user info
   */
  static async getDriverWithSubaccountDetails(driverId: string): Promise<any> {
    const query = `
      SELECT 
        d.*,
        u.phone_number,
        u.email,
        u.status as account_status
      FROM driver_profiles d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = $1
    `;
    const result = await pool.query(query, [driverId]);
    return result.rows[0] || null;
  }

  // ============================================
  // POSTGIS GEOGRAPHIC QUERIES (UPDATED)
  // ============================================

  /**
   * Get drivers near a location using PostGIS
   * Returns drivers sorted by proximity with distance_km
   */
  static async getDriversNear(
    latitude: number,
    longitude: number,
    radiusKm: number = 5
  ): Promise<IDriverProfile[]> {
    const query = `
      SELECT 
        *,
        ST_Distance(
          location_geo,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) / 1000 as distance_km
      FROM driver_profiles 
      WHERE is_online = true 
        AND driver_status = 'active' 
        AND kyc_status = 'approved'
        AND location_geo IS NOT NULL
        AND ST_DWithin(
          location_geo,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3 * 1000  -- Convert km to meters
        )
      ORDER BY distance_km ASC
      LIMIT 50
    `;
    const result = await pool.query(query, [longitude, latitude, radiusKm]);
    return result.rows;
  }

  /**
   * Get drivers within radius sorted by proximity (alias for getDriversNear)
   */
  static async getDriversSortedByProximity(
    latitude: number,
    longitude: number,
    radiusKm: number = 5
  ): Promise<IDriverProfile[]> {
    return this.getDriversNear(latitude, longitude, radiusKm);
  }

  /**
   * Get nearest driver to a location with minimum rating
   */
  static async getNearestDriver(
    latitude: number,
    longitude: number,
    minRating: number = 4.0,
    radiusKm: number = 10
  ): Promise<IDriverProfile | null> {
    const query = `
      SELECT 
        *,
        ST_Distance(
          location_geo,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) / 1000 as distance_km
      FROM driver_profiles 
      WHERE is_online = true 
        AND driver_status = 'active' 
        AND kyc_status = 'approved'
        AND rating_average >= $3
        AND location_geo IS NOT NULL
        AND ST_DWithin(
          location_geo,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $4 * 1000
        )
      ORDER BY distance_km ASC
      LIMIT 1
    `;
    const result = await pool.query(query, [longitude, latitude, minRating, radiusKm]);
    return result.rows[0] || null;
  }

  /**
   * Get drivers within a bounding box
   */
  static async getDriversInBoundingBox(
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number
  ): Promise<IDriverProfile[]> {
    const query = `
      SELECT 
        *,
        ST_Distance(
          location_geo,
          ST_SetSRID(
            ST_MakePoint(
              (SELECT AVG(longitude) FROM (VALUES ($1), ($2)) AS lng(longitude)),
              (SELECT AVG(latitude) FROM (VALUES ($3), ($4)) AS lat(latitude))
            ),
            4326
          )::geography
        ) / 1000 as distance_km
      FROM driver_profiles 
      WHERE is_online = true 
        AND driver_status = 'active' 
        AND kyc_status = 'approved'
        AND location_geo IS NOT NULL
        AND ST_Within(
          location_geo,
          ST_SetSRID(
            ST_MakeEnvelope($1, $3, $2, $4, 4326),
            4326
          )
        )
      ORDER BY distance_km ASC
    `;
    const result = await pool.query(query, [minLng, maxLng, minLat, maxLat]);
    return result.rows;
  }

  /**
   * Count drivers within a radius
   */
  static async countDriversWithinRadius(
    latitude: number,
    longitude: number,
    radiusKm: number = 5
  ): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM driver_profiles 
      WHERE is_online = true 
        AND driver_status = 'active' 
        AND kyc_status = 'approved'
        AND location_geo IS NOT NULL
        AND ST_DWithin(
          location_geo,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3 * 1000
        )
    `;
    const result = await pool.query(query, [longitude, latitude, radiusKm]);
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Check if driver exists
   */
  static async exists(userId: string): Promise<boolean> {
    const query = 'SELECT 1 FROM driver_profiles WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get driver with user info
   */
  static async getDriverWithUser(driverId: string): Promise<any> {
    const query = `
      SELECT 
        d.*,
        u.phone_number,
        u.email,
        u.status as account_status
      FROM driver_profiles d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = $1
    `;
    const result = await pool.query(query, [driverId]);
    return result.rows[0] || null;
  }

  /**
   * Get driver with full details including subaccount
   */
  static async getDriverWithFullDetails(driverId: string): Promise<any> {
    const query = `
      SELECT 
        d.*,
        u.phone_number,
        u.email,
        u.status as account_status,
        v.make as vehicle_make,
        v.model as vehicle_model,
        v.registration_number as vehicle_registration
      FROM driver_profiles d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN vehicles v ON d.id = v.driver_id AND v.is_primary = true
      WHERE d.id = $1
    `;
    const result = await pool.query(query, [driverId]);
    return result.rows[0] || null;
  }
}

export default DriverModel;