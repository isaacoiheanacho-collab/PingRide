import pool from '../config/database';
import { IVehicle, ICreateVehicle } from '../types';
import logger from '../utils/logger';

export class VehicleModel {
  /**
   * Get vehicles by driver ID
   */
  static async getByDriverId(driverId: string): Promise<IVehicle[]> {
    const query = 'SELECT * FROM vehicles WHERE driver_id = $1 ORDER BY is_primary DESC, created_at DESC';
    const result = await pool.query(query, [driverId]);
    return result.rows;
  }

  /**
   * Get vehicle by ID
   */
  static async getById(id: string): Promise<IVehicle | null> {
    const query = 'SELECT * FROM vehicles WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Create vehicle
   */
  static async create(
    driverId: string,
    data: ICreateVehicle
  ): Promise<IVehicle> {
    // If this is set as primary, unset other primary
    if (data.is_primary) {
      await this.unsetPrimary(driverId);
    }

    const query = `
      INSERT INTO vehicles (
        driver_id, registration_number, make, model, year, colour,
        vehicle_type, is_primary, seat_count,
        registration_document_url, insurance_document_url,
        roadworthiness_document_url, registration_expiry,
        insurance_expiry, roadworthiness_expiry,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;
    const values = [
      driverId,
      data.registration_number,
      data.make,
      data.model,
      data.year || null,
      data.colour || null,
      data.vehicle_type,
      data.is_primary || false,
      data.seat_count || 4,
      data.registration_document_url || null,
      data.insurance_document_url || null,
      data.roadworthiness_document_url || null,
      data.registration_expiry || null,
      data.insurance_expiry || null,
      data.roadworthiness_expiry || null,
      'pending_approval'
    ];
    const result = await pool.query(query, values);
    logger.info(`Vehicle created for driver: ${driverId}`);
    return result.rows[0];
  }

  /**
   * Update vehicle
   */
  static async update(
    id: string,
    data: Partial<ICreateVehicle>
  ): Promise<IVehicle | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    const fields: Record<string, any> = {
      registration_number: data.registration_number,
      make: data.make,
      model: data.model,
      year: data.year,
      colour: data.colour,
      vehicle_type: data.vehicle_type,
      is_primary: data.is_primary,
      seat_count: data.seat_count,
      registration_document_url: data.registration_document_url,
      insurance_document_url: data.insurance_document_url,
      roadworthiness_document_url: data.roadworthiness_document_url,
      registration_expiry: data.registration_expiry,
      insurance_expiry: data.insurance_expiry,
      roadworthiness_expiry: data.roadworthiness_expiry,
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

    // If setting as primary, unset other primary
    if (data.is_primary) {
      const vehicle = await this.getById(id);
      if (vehicle) {
        await this.unsetPrimary(vehicle.driver_id);
      }
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE vehicles 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update vehicle status
   */
  static async updateStatus(id: string, status: string): Promise<IVehicle | null> {
    const query = `
      UPDATE vehicles 
      SET status = $1, updated_at = NOW() 
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [status, id]);
    return result.rows[0] || null;
  }

  /**
   * Delete vehicle
   */
  static async delete(id: string): Promise<void> {
    const query = 'DELETE FROM vehicles WHERE id = $1';
    await pool.query(query, [id]);
    logger.info(`Vehicle deleted: ${id}`);
  }

  /**
   * Unset primary for all vehicles of a driver
   */
  static async unsetPrimary(driverId: string): Promise<void> {
    const query = 'UPDATE vehicles SET is_primary = false WHERE driver_id = $1';
    await pool.query(query, [driverId]);
  }

  /**
   * Get primary vehicle for driver
   */
  static async getPrimary(driverId: string): Promise<IVehicle | null> {
    const query = 'SELECT * FROM vehicles WHERE driver_id = $1 AND is_primary = true LIMIT 1';
    const result = await pool.query(query, [driverId]);
    return result.rows[0] || null;
  }
}

export default VehicleModel;