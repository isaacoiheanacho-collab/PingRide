import pool from '../config/database';
import { IRideBid, ICreateBid } from '../types';
import logger from '../utils/logger';

export class RideBidModel {
  static async create(data: ICreateBid): Promise<IRideBid> {
    const existing = await this.getByDriverAndRide(data.ride_request_id, data.driver_id);
    if (existing) {
      throw new Error('Driver already submitted a bid for this ride');
    }

    const query = `
      INSERT INTO ride_bids (
        ride_id, driver_id, bid_amount, eta_minutes, driver_notes, status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      data.ride_request_id,
      data.driver_id,
      data.bid_amount,
      data.eta_minutes,
      data.driver_notes || null,
      'pending',
    ];
    const result = await pool.query(query, values);
    logger.info(`Bid created: ${result.rows[0].id}`);
    return result.rows[0];
  }

  static async getById(id: string): Promise<IRideBid | null> {
    const query = 'SELECT * FROM ride_bids WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  static async getByRideRequest(rideRequestId: string): Promise<IRideBid[]> {
    const query = `
      SELECT 
        b.*,
        d.first_name as driver_first_name,
        d.last_name as driver_last_name,
        d.rating_average as driver_rating,
        v.make as vehicle_make,
        v.model as vehicle_model,
        v.colour as vehicle_colour,
        v.registration_number as vehicle_registration
      FROM ride_bids b
      JOIN driver_profiles d ON b.driver_id = d.id
      LEFT JOIN vehicles v ON d.id = v.driver_id AND v.is_primary = true
      WHERE b.ride_id = $1
      ORDER BY b.bid_amount ASC, b.eta_minutes ASC
    `;
    const result = await pool.query(query, [rideRequestId]);
    return result.rows;
  }

  static async getActiveByRideRequest(rideRequestId: string): Promise<IRideBid[]> {
    const query = `
      SELECT 
        b.*,
        d.first_name as driver_first_name,
        d.last_name as driver_last_name,
        d.rating_average as driver_rating,
        v.make as vehicle_make,
        v.model as vehicle_model,
        v.colour as vehicle_colour,
        v.registration_number as vehicle_registration
      FROM ride_bids b
      JOIN driver_profiles d ON b.driver_id = d.id
      LEFT JOIN vehicles v ON d.id = v.driver_id AND v.is_primary = true
      WHERE b.ride_id = $1 AND b.status = 'pending'
      ORDER BY b.bid_amount ASC, b.eta_minutes ASC
    `;
    const result = await pool.query(query, [rideRequestId]);
    return result.rows;
  }

  static async getByDriverAndRide(
    rideRequestId: string,
    driverId: string
  ): Promise<IRideBid | null> {
    const query = 'SELECT * FROM ride_bids WHERE ride_id = $1 AND driver_id = $2';
    const result = await pool.query(query, [rideRequestId, driverId]);
    return result.rows[0] || null;
  }

  static async updateStatus(
    id: string,
    status: string,
    data?: {
      rank?: number;
      selected_at?: Date;
      expired_at?: Date;
    }
  ): Promise<IRideBid | null> {
    const updates = [`status = $1`, `updated_at = NOW()`];
    const values: any[] = [status];
    let paramCount = 2;

    if (data?.rank !== undefined) {
      updates.push(`rank = $${paramCount}`);
      values.push(data.rank);
      paramCount++;
    }
    if (data?.selected_at) {
      updates.push(`selected_at = $${paramCount}`);
      values.push(data.selected_at);
      paramCount++;
    }
    if (data?.expired_at) {
      updates.push(`expired_at = $${paramCount}`);
      values.push(data.expired_at);
      paramCount++;
    }

    values.push(id);
    const query = `
      UPDATE ride_bids 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  static async expireAll(rideRequestId: string): Promise<number> {
    const query = `
      UPDATE ride_bids 
      SET status = 'expired', expired_at = NOW(), updated_at = NOW()
      WHERE ride_id = $1 AND status = 'pending'
      RETURNING id
    `;
    const result = await pool.query(query, [rideRequestId]);
    return result.rowCount || 0;
  }

  static async selectBid(
    rideRequestId: string,
    bidId: string
  ): Promise<{ selected: IRideBid; rejected: IRideBid[] }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const selectedResult = await client.query(
        'SELECT * FROM ride_bids WHERE id = $1 AND ride_id = $2 AND status = $3',
        [bidId, rideRequestId, 'pending']
      );
      if (selectedResult.rows.length === 0) {
        throw new Error('Bid not found or already processed');
      }

      const acceptResult = await client.query(
        `UPDATE ride_bids 
         SET status = 'accepted', selected_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [bidId]
      );

      const rejectResult = await client.query(
        `UPDATE ride_bids 
         SET status = 'rejected', updated_at = NOW()
         WHERE ride_id = $1 AND id != $2 AND status = 'pending'
         RETURNING *`,
        [rideRequestId, bidId]
      );

      await client.query('COMMIT');
      return {
        selected: acceptResult.rows[0],
        rejected: rejectResult.rows,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export default RideBidModel;