import pool from '../config/database';
import { IRideRequest, ICreateRideRequest } from '../types';
import logger from '../utils/logger';

export class RideRequestModel {
  static async create(
    passengerProfileId: string,
    data: ICreateRideRequest,
    biddingDurationSeconds: number = 30
  ): Promise<IRideRequest> {
    const query = `
      INSERT INTO ride_requests (
        passenger_id, pickup_latitude, pickup_longitude, pickup_address,
        destination_latitude, destination_longitude, destination_address,
        vehicle_type, status, bidding_duration_seconds,
        estimated_distance_km, estimated_duration_min,
        timezone_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
      RETURNING *
    `;

    const estimatedDistance = 5.0;
    const estimatedDuration = 15;
    const timezoneId = 'Africa/Lagos'; // Default, can be made dynamic later

    const values = [
      passengerProfileId,
      data.pickup_latitude,
      data.pickup_longitude,
      data.pickup_address,
      data.destination_latitude,
      data.destination_longitude,
      data.destination_address,
      data.vehicle_type || 'standard',
      'bidding',
      biddingDurationSeconds,
      estimatedDistance,
      estimatedDuration,
      timezoneId,
    ];
    const result = await pool.query(query, values);
    logger.info(`Ride request created: ${result.rows[0].id}`);
    
    const row = result.rows[0];
    return this.convertDatesToIRideRequest(row);
  }

  static async getById(id: string): Promise<IRideRequest | null> {
    const query = 'SELECT * FROM ride_requests WHERE id = $1';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.convertDatesToIRideRequest(result.rows[0]);
  }

  static async getWithPassenger(id: string): Promise<any> {
    const query = `
      SELECT 
        r.*,
        p.first_name as passenger_first_name,
        p.last_name as passenger_last_name,
        u.phone_number as passenger_phone
      FROM ride_requests r
      JOIN passenger_profiles p ON r.passenger_id = p.id
      JOIN users u ON p.user_id = u.id
      WHERE r.id = $1
    `;
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.convertDatesToIRideRequest(result.rows[0]);
  }

  static async updateStatus(
    id: string,
    status: string,
    data?: {
      selected_driver_id?: string;
      selected_bid_id?: string;
      cancelled_by?: string;
      cancellation_reason?: string;
    }
  ): Promise<IRideRequest | null> {
    const updates = [`status = $1`, `updated_at = NOW() AT TIME ZONE 'UTC'`];
    const values: any[] = [status];
    let paramCount = 2;

    if (data?.selected_driver_id) {
      updates.push(`selected_driver_id = $${paramCount}`);
      values.push(data.selected_driver_id);
      paramCount++;
    }
    if (data?.selected_bid_id) {
      updates.push(`selected_bid_id = $${paramCount}`);
      values.push(data.selected_bid_id);
      paramCount++;
    }
    if (data?.cancelled_by) {
      updates.push(`cancelled_by = $${paramCount}`);
      updates.push(`cancelled_at = NOW() AT TIME ZONE 'UTC'`);
      values.push(data.cancelled_by);
      paramCount++;
    }
    if (data?.cancellation_reason) {
      updates.push(`cancellation_reason = $${paramCount}`);
      values.push(data.cancellation_reason);
      paramCount++;
    }

    values.push(id);
    const query = `
      UPDATE ride_requests 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.convertDatesToIRideRequest(result.rows[0]);
  }

  /**
   * Start the bidding window for a ride request
   * Uses UTC consistently for all timestamps
   */
  static async startBidding(
    id: string,
    durationSeconds: number = 30
  ): Promise<IRideRequest | null> {
    const query = `
      UPDATE ride_requests 
      SET status = 'bidding',
          bidding_started_at = NOW() AT TIME ZONE 'UTC',
          bidding_ends_at = (NOW() AT TIME ZONE 'UTC') + INTERVAL '${durationSeconds} seconds',
          updated_at = NOW() AT TIME ZONE 'UTC'
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.convertDatesToIRideRequest(result.rows[0]);
  }

  static async hasActiveRide(userId: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM ride_requests r
      JOIN passenger_profiles p ON r.passenger_id = p.id
      WHERE p.user_id = $1 
        AND r.status IN ('pending', 'bidding', 'assigned')
      LIMIT 1
    `;
    const result = await pool.query(query, [userId]);
    return (result.rowCount ?? 0) > 0;
  }

  static async getActiveByPassenger(userId: string): Promise<IRideRequest[]> {
    const query = `
      SELECT r.* FROM ride_requests r
      JOIN passenger_profiles p ON r.passenger_id = p.id
      WHERE p.user_id = $1 
        AND r.status IN ('pending', 'bidding', 'assigned')
      ORDER BY r.created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows.map(row => this.convertDatesToIRideRequest(row));
  }

  static async expireExpiredRequests(): Promise<number> {
    const query = `
      UPDATE ride_requests 
      SET status = 'expired', 
          updated_at = NOW() AT TIME ZONE 'UTC'
      WHERE status = 'bidding' 
        AND bidding_ends_at < (NOW() AT TIME ZONE 'UTC')
      RETURNING id
    `;
    const result = await pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Convert date fields from database to Date objects
   * All timestamps are now stored as TIMESTAMPTZ (UTC)
   */
  private static convertDatesToIRideRequest(row: any): IRideRequest {
    if (!row) return row;
    
    const dateFields = [
      'created_at',
      'updated_at',
      'bidding_started_at',
      'bidding_ends_at',
      'cancelled_at'
    ];
    
    const converted = { ...row };
    for (const field of dateFields) {
      if (converted[field] !== undefined && converted[field] !== null) {
        if (typeof converted[field] === 'string' || converted[field] instanceof Date) {
          converted[field] = new Date(converted[field]);
        }
      }
    }
    
    return converted as IRideRequest;
  }
}

export default RideRequestModel;