import pool from '../config/database';
import { ISavedLocation, ICreateSavedLocation } from '../types';
import logger from '../utils/logger';

export class SavedLocationModel {
  /**
   * Get all saved locations for a passenger
   */
  static async getByPassengerId(passengerId: string): Promise<ISavedLocation[]> {
    const query = `
      SELECT * FROM saved_locations 
      WHERE passenger_id = $1 
      ORDER BY is_default DESC, label ASC
    `;
    const result = await pool.query(query, [passengerId]);
    return result.rows;
  }

  /**
   * Get saved location by ID
   */
  static async getById(id: string): Promise<ISavedLocation | null> {
    const query = 'SELECT * FROM saved_locations WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Create saved location
   */
  static async create(
    passengerId: string,
    data: ICreateSavedLocation
  ): Promise<ISavedLocation> {
    // If this is set as default, unset other defaults
    if (data.is_default) {
      await this.unsetDefault(passengerId);
    }

    const query = `
      INSERT INTO saved_locations (
        passenger_id, label, address, latitude, longitude, is_default
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      passengerId,
      data.label,
      data.address,
      data.latitude,
      data.longitude,
      data.is_default || false
    ];
    const result = await pool.query(query, values);
    logger.info(`Saved location created for passenger: ${passengerId}`);
    return result.rows[0];
  }

  /**
   * Update saved location
   */
  static async update(
    id: string,
    data: Partial<ICreateSavedLocation>
  ): Promise<ISavedLocation | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.label !== undefined) {
      updates.push(`label = $${paramCount}`);
      values.push(data.label);
      paramCount++;
    }
    if (data.address !== undefined) {
      updates.push(`address = $${paramCount}`);
      values.push(data.address);
      paramCount++;
    }
    if (data.latitude !== undefined) {
      updates.push(`latitude = $${paramCount}`);
      values.push(data.latitude);
      paramCount++;
    }
    if (data.longitude !== undefined) {
      updates.push(`longitude = $${paramCount}`);
      values.push(data.longitude);
      paramCount++;
    }
    if (data.is_default !== undefined) {
      updates.push(`is_default = $${paramCount}`);
      values.push(data.is_default);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    // If setting as default, unset other defaults
    if (data.is_default) {
      // Get passenger_id from the location
      const location = await this.getById(id);
      if (location) {
        await this.unsetDefault(location.passenger_id);
      }
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE saved_locations 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Delete saved location
   */
  static async delete(id: string): Promise<void> {
    const query = 'DELETE FROM saved_locations WHERE id = $1';
    await pool.query(query, [id]);
    logger.info(`Saved location deleted: ${id}`);
  }

  /**
   * Unset default for all locations of a passenger
   */
  static async unsetDefault(passengerId: string): Promise<void> {
    const query = `
      UPDATE saved_locations 
      SET is_default = false 
      WHERE passenger_id = $1
    `;
    await pool.query(query, [passengerId]);
  }

  /**
   * Get default location for a passenger
   */
  static async getDefault(passengerId: string): Promise<ISavedLocation | null> {
    const query = `
      SELECT * FROM saved_locations 
      WHERE passenger_id = $1 AND is_default = true 
      LIMIT 1
    `;
    const result = await pool.query(query, [passengerId]);
    return result.rows[0] || null;
  }
}

export default SavedLocationModel;