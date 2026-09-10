import pool from '../config/database';
import { IDriverDocument } from '../types';
import logger from '../utils/logger';

export class DriverDocumentModel {
  /**
   * Get documents by driver ID
   */
  static async getByDriverId(driverId: string): Promise<IDriverDocument[]> {
    const query = 'SELECT * FROM driver_documents WHERE driver_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [driverId]);
    return result.rows;
  }

  /**
   * Get document by ID
   */
  static async getById(id: string): Promise<IDriverDocument | null> {
    const query = 'SELECT * FROM driver_documents WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Create document
   */
  static async create(
    driverId: string,
    data: {
      document_type: string;
      document_number?: string;
      document_url: string;
      expiry_date?: string;
    }
  ): Promise<IDriverDocument> {
    const query = `
      INSERT INTO driver_documents (
        driver_id, document_type, document_number, document_url,
        expiry_date, verification_status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      driverId,
      data.document_type,
      data.document_number || null,
      data.document_url,
      data.expiry_date || null,
      'pending'
    ];
    const result = await pool.query(query, values);
    logger.info(`Document created for driver: ${driverId}`);
    return result.rows[0];
  }

  /**
   * Update document verification status
   */
  static async updateVerificationStatus(
    id: string,
    status: string,
    notes?: string,
    verifiedBy?: string
  ): Promise<IDriverDocument | null> {
    const query = `
      UPDATE driver_documents 
      SET verification_status = $1,
          verification_notes = $2,
          verified_at = ${status === 'verified' ? 'NOW()' : 'NULL'},
          verified_by = $3,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    const result = await pool.query(query, [status, notes || null, verifiedBy || null, id]);
    return result.rows[0] || null;
  }

  /**
   * Delete document
   */
  static async delete(id: string): Promise<void> {
    const query = 'DELETE FROM driver_documents WHERE id = $1';
    await pool.query(query, [id]);
    logger.info(`Document deleted: ${id}`);
  }
}

export default DriverDocumentModel;