import pool from '../config/database';
import { IRide } from '../types';
import logger from '../utils/logger';

export class RideModel {
  /**
   * Create a ride from selected bid
   */
  static async createFromBid(
    _rideRequestId: string,  // Prefixed with _ to indicate intentionally unused
    passengerId: string,
    driverId: string,
    bidId: string,
    bidAmount: number,
    pickupLatitude: number,
    pickupLongitude: number,
    pickupAddress: string,
    destinationLatitude: number,
    destinationLongitude: number,
    destinationAddress: string
  ): Promise<IRide> {
    const query = `
      INSERT INTO rides (
        passenger_id, driver_id, bid_id, bid_amount,
        pickup_latitude, pickup_longitude, pickup_address,
        destination_latitude, destination_longitude, destination_address,
        timezone_id, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
      RETURNING *
    `;
    
    const timezoneId = 'Africa/Lagos'; // Default, can be made dynamic from ride request
    
    const values = [
      passengerId,
      driverId,
      bidId,
      bidAmount,
      pickupLatitude,
      pickupLongitude,
      pickupAddress,
      destinationLatitude,
      destinationLongitude,
      destinationAddress,
      timezoneId,
      'confirmed',
    ];
    const result = await pool.query(query, values);
    logger.info(`Ride created: ${result.rows[0].id}`);
    return this.convertDates(result.rows[0]);
  }

  /**
   * Get ride by ID
   */
  static async getById(id: string): Promise<IRide | null> {
    const query = 'SELECT * FROM rides WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] ? this.convertDates(result.rows[0]) : null;
  }

  /**
   * Get ride with details (passenger, driver, vehicle)
   */
  static async getWithDetails(id: string): Promise<any> {
    const query = `
      SELECT 
        r.*,
        p.first_name as passenger_first_name,
        p.last_name as passenger_last_name,
        u.phone_number as passenger_phone,
        d.first_name as driver_first_name,
        d.last_name as driver_last_name,
        d.rating_average as driver_rating,
        d.phone_number as driver_phone,
        v.make as vehicle_make,
        v.model as vehicle_model,
        v.colour as vehicle_colour,
        v.registration_number as vehicle_registration
      FROM rides r
      JOIN passenger_profiles p ON r.passenger_id = p.id
      JOIN users u ON p.user_id = u.id
      JOIN driver_profiles d ON r.driver_id = d.id
      LEFT JOIN vehicles v ON d.id = v.driver_id AND v.is_primary = true
      WHERE r.id = $1
    `;
    const result = await pool.query(query, [id]);
    return result.rows[0] ? this.convertDates(result.rows[0]) : null;
  }

  /**
   * Update ride status - FIXED to match database CHECK constraint
   */
  static async updateStatus(
    id: string,
    status: string,
    data?: {
      latitude?: number;
      longitude?: number;
      notes?: string;
    }
  ): Promise<IRide | null> {
    const updates = [`status = $1`, `updated_at = NOW() AT TIME ZONE 'UTC'`];
    const values: any[] = [status];
    let paramCount = 2;

    // Add timestamp for specific status transitions - FIXED to match database statuses
    if (status === 'driver_en_route') {
      // No specific timestamp for en_route
    } else if (status === 'driver_arrived') {
      updates.push(`driver_arrived_at = NOW() AT TIME ZONE 'UTC'`);
    } else if (status === 'ride_started') {
      updates.push(`started_at = NOW() AT TIME ZONE 'UTC'`);
    } else if (status === 'ride_completed') {
      updates.push(`completed_at = NOW() AT TIME ZONE 'UTC'`);
    } else if (status === 'cancelled') {
      updates.push(`cancelled_at = NOW() AT TIME ZONE 'UTC'`);
    }

    if (data?.latitude !== undefined && data?.longitude !== undefined) {
      // We could store location in ride_locations table
      // For now, just track in the ride status history
    }

    values.push(id);
    const query = `
      UPDATE rides 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] ? this.convertDates(result.rows[0]) : null;
  }

  /**
   * Get active rides for driver
   */
  static async getActiveByDriver(driverId: string): Promise<IRide[]> {
    const query = `
      SELECT * FROM rides 
      WHERE driver_id = $1 
        AND status NOT IN ('ride_completed', 'cancelled', 'disputed', 'failed', 'expired')
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [driverId]);
    return result.rows.map(row => this.convertDates(row));
  }

  /**
   * Get active rides for passenger
   */
  static async getActiveByPassenger(passengerId: string): Promise<IRide[]> {
    const query = `
      SELECT * FROM rides 
      WHERE passenger_id = $1 
        AND status NOT IN ('ride_completed', 'cancelled', 'disputed', 'failed', 'expired')
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [passengerId]);
    return result.rows.map(row => this.convertDates(row));
  }

  /**
   * Get ride history for passenger
   */
  static async getHistoryByPassenger(
    passengerId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ rides: IRide[]; total: number }> {
    const countQuery = 'SELECT COUNT(*) as total FROM rides WHERE passenger_id = $1';
    const countResult = await pool.query(countQuery, [passengerId]);

    const query = `
      SELECT 
        r.*,
        d.first_name as driver_first_name,
        d.last_name as driver_last_name,
        v.make as vehicle_make,
        v.model as vehicle_model
      FROM rides r
      JOIN driver_profiles d ON r.driver_id = d.id
      LEFT JOIN vehicles v ON d.id = v.driver_id AND v.is_primary = true
      WHERE r.passenger_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [passengerId, limit, offset]);
    return {
      rides: result.rows.map(row => this.convertDates(row)),
      total: parseInt(countResult.rows[0].total, 10),
    };
  }

  /**
   * Complete ride with final details
   */
  static async complete(
    id: string,
    finalDistanceKm: number,
    durationMinutes: number
  ): Promise<IRide | null> {
    const query = `
      UPDATE rides 
      SET status = 'ride_completed',
          final_distance_km = $1,
          duration_minutes = $2,
          completed_at = NOW() AT TIME ZONE 'UTC',
          updated_at = NOW() AT TIME ZONE 'UTC'
      WHERE id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [finalDistanceKm, durationMinutes, id]);
    return result.rows[0] ? this.convertDates(result.rows[0]) : null;
  }

  /**
   * Convert date fields from database to Date objects
   * All timestamps are now stored as TIMESTAMPTZ (UTC)
   */
  private static convertDates(row: any): IRide {
    if (!row) return row;
    
    const dateFields = [
      'created_at',
      'updated_at',
      'started_at',
      'completed_at',
      'cancelled_at',
      'driver_arrived_at',
      'accepted_at',
      'requested_at'
    ];
    
    const converted = { ...row };
    for (const field of dateFields) {
      if (converted[field] !== undefined && converted[field] !== null) {
        if (typeof converted[field] === 'string' || converted[field] instanceof Date) {
          converted[field] = new Date(converted[field]);
        }
      }
    }
    
    return converted as IRide;
  }
}

export default RideModel;