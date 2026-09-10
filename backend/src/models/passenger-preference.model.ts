import pool from '../config/database';
import { IPassengerPreference } from '../types';
import logger from '../utils/logger';

export class PassengerPreferenceModel {
  /**
   * Get preferences by passenger ID
   */
  static async getByPassengerId(passengerId: string): Promise<IPassengerPreference | null> {
    const query = 'SELECT * FROM passenger_preferences WHERE passenger_id = $1';
    const result = await pool.query(query, [passengerId]);
    return result.rows[0] || null;
  }

  /**
   * Create passenger preferences
   */
  static async create(
    passengerId: string,
    data: {
      preferred_vehicle_type?: string;
      music_preference?: string;
      conversation_preference?: string;
      max_wait_time?: number;
      notify_promotions?: boolean;
      notify_ride_updates?: boolean;
    }
  ): Promise<IPassengerPreference> {
    const query = `
      INSERT INTO passenger_preferences (
        passenger_id, preferred_vehicle_type, music_preference, 
        conversation_preference, max_wait_time, 
        notify_promotions, notify_ride_updates
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [
      passengerId,
      data.preferred_vehicle_type || 'standard',
      data.music_preference || 'any',
      data.conversation_preference || 'any',
      data.max_wait_time || 10,
      data.notify_promotions !== undefined ? data.notify_promotions : true,
      data.notify_ride_updates !== undefined ? data.notify_ride_updates : true,
    ];
    const result = await pool.query(query, values);
    logger.info(`Passenger preferences created for passenger: ${passengerId}`);
    return result.rows[0];
  }

  /**
   * Update passenger preferences
   */
  static async update(
    passengerId: string,
    data: {
      preferred_vehicle_type?: string;
      music_preference?: string;
      conversation_preference?: string;
      max_wait_time?: number;
      notify_promotions?: boolean;
      notify_ride_updates?: boolean;
    }
  ): Promise<IPassengerPreference | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.preferred_vehicle_type !== undefined) {
      updates.push(`preferred_vehicle_type = $${paramCount}`);
      values.push(data.preferred_vehicle_type);
      paramCount++;
    }
    if (data.music_preference !== undefined) {
      updates.push(`music_preference = $${paramCount}`);
      values.push(data.music_preference);
      paramCount++;
    }
    if (data.conversation_preference !== undefined) {
      updates.push(`conversation_preference = $${paramCount}`);
      values.push(data.conversation_preference);
      paramCount++;
    }
    if (data.max_wait_time !== undefined) {
      updates.push(`max_wait_time = $${paramCount}`);
      values.push(data.max_wait_time);
      paramCount++;
    }
    if (data.notify_promotions !== undefined) {
      updates.push(`notify_promotions = $${paramCount}`);
      values.push(data.notify_promotions);
      paramCount++;
    }
    if (data.notify_ride_updates !== undefined) {
      updates.push(`notify_ride_updates = $${paramCount}`);
      values.push(data.notify_ride_updates);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(passengerId);

    const query = `
      UPDATE passenger_preferences 
      SET ${updates.join(', ')} 
      WHERE passenger_id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Create or update passenger preferences (upsert)
   */
  static async upsert(
    passengerId: string,
    data: {
      preferred_vehicle_type?: string;
      music_preference?: string;
      conversation_preference?: string;
      max_wait_time?: number;
      notify_promotions?: boolean;
      notify_ride_updates?: boolean;
    }
  ): Promise<IPassengerPreference> {
    const existing = await this.getByPassengerId(passengerId);
    
    if (existing) {
      const updated = await this.update(passengerId, data);
      return updated || existing;
    }
    
    return this.create(passengerId, data);
  }

  /**
   * Delete passenger preferences
   */
  static async delete(passengerId: string): Promise<void> {
    const query = 'DELETE FROM passenger_preferences WHERE passenger_id = $1';
    await pool.query(query, [passengerId]);
    logger.info(`Passenger preferences deleted for passenger: ${passengerId}`);
  }

  /**
   * Check if preferences exist
   */
  static async exists(passengerId: string): Promise<boolean> {
    const query = 'SELECT 1 FROM passenger_preferences WHERE passenger_id = $1';
    const result = await pool.query(query, [passengerId]);
    return (result.rowCount ?? 0) > 0;
  }
}

export default PassengerPreferenceModel;