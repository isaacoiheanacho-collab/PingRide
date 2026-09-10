import pool from '../config/database';
import { IUser } from '../types';

export class UserModel {
  /**
   * Create a new user
   */
  static async create(
    phoneNumber: string,
    passwordHash: string,
    role: string = 'passenger',
    email?: string
  ): Promise<IUser> {
    const query = `
      INSERT INTO users (
        phone_number, email, password_hash, role, status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [phoneNumber, email || null, passwordHash, role, 'pending_verification'];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Find user by ID
   */
  static async findById(id: string): Promise<IUser | null> {
    const query = 'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Find user by phone number
   */
  static async findByPhone(phoneNumber: string): Promise<IUser | null> {
    const query = 'SELECT * FROM users WHERE phone_number = $1 AND deleted_at IS NULL';
    const result = await pool.query(query, [phoneNumber]);
    return result.rows[0] || null;
  }

  /**
   * Find user by email
   */
  static async findByEmail(email: string): Promise<IUser | null> {
    const query = 'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL';
    const result = await pool.query(query, [email]);
    return result.rows[0] || null;
  }

  /**
   * Get all users with pagination and filtering
   */
  static async findAll(
    options?: {
      page?: number;
      limit?: number;
      status?: string;
      role?: string;
      search?: string;
    }
  ): Promise<{ users: IUser[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM users WHERE deleted_at IS NULL';
    const values: any[] = [];
    let paramCount = 1;

    if (options?.status) {
      query += ` AND status = $${paramCount}`;
      values.push(options.status);
      paramCount++;
    }
    if (options?.role) {
      query += ` AND role = $${paramCount}`;
      values.push(options.role);
      paramCount++;
    }
    if (options?.search) {
      query += ` AND (phone_number ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      values.push(`%${options.search}%`);
      paramCount++;
    }

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total, 10);

    query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    const result = await pool.query(query, values);
    return { users: result.rows, total };
  }

  /**
   * Update user status
   */
  static async updateStatus(userId: string, status: string): Promise<IUser | null> {
    const query = `
      UPDATE users 
      SET status = $1, updated_at = NOW() 
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING *
    `;
    const result = await pool.query(query, [status, userId]);
    return result.rows[0] || null;
  }

  /**
   * Verify phone
   */
  static async verifyPhone(userId: string): Promise<IUser | null> {
    const query = `
      UPDATE users 
      SET phone_verified = true, status = 'active', updated_at = NOW() 
      WHERE id = $1 
      RETURNING *
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Update last login
   */
  static async updateLastLogin(userId: string): Promise<void> {
    const query = 'UPDATE users SET last_login_at = NOW() WHERE id = $1';
    await pool.query(query, [userId]);
  }

  /**
   * Increment login attempts
   */
  static async incrementLoginAttempts(userId: string): Promise<any> {
    const query = `
      UPDATE users 
      SET login_attempts = login_attempts + 1, 
          locked_until = CASE 
            WHEN login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' 
            ELSE NULL 
          END,
          updated_at = NOW() 
      WHERE id = $1 
      RETURNING login_attempts, locked_until
    `;
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  /**
   * Reset login attempts
   */
  static async resetLoginAttempts(userId: string): Promise<void> {
    const query = 'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1';
    await pool.query(query, [userId]);
  }

  /**
   * Update password
   */
  static async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const query = 'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2';
    await pool.query(query, [passwordHash, userId]);
  }

  /**
   * Soft delete user
   */
  static async softDelete(userId: string): Promise<void> {
    const query = 'UPDATE users SET deleted_at = NOW(), status = \'deactivated\' WHERE id = $1';
    await pool.query(query, [userId]);
  }

  /**
   * Check if phone exists
   */
  static async phoneExists(phoneNumber: string): Promise<boolean> {
    const query = 'SELECT 1 FROM users WHERE phone_number = $1 AND deleted_at IS NULL';
    const result = await pool.query(query, [phoneNumber]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Check if email exists
   */
  static async emailExists(email: string): Promise<boolean> {
    const query = 'SELECT 1 FROM users WHERE email = $1 AND deleted_at IS NULL';
    const result = await pool.query(query, [email]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Update user profile (only users table fields)
   */
  static async updateProfile(
    userId: string,
    data: {
      email?: string;
      preferred_language?: string;
    }
  ): Promise<IUser | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.email !== undefined) {
      updates.push(`email = $${paramCount}`);
      values.push(data.email);
      paramCount++;
    }
    if (data.preferred_language !== undefined) {
      updates.push(`preferred_language = $${paramCount}`);
      values.push(data.preferred_language);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const query = `
      UPDATE users 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount} AND deleted_at IS NULL
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Update passenger profile
   */
  static async updatePassengerProfile(
    userId: string,
    data: {
      first_name?: string;
      last_name?: string;
      profile_photo_url?: string;
      date_of_birth?: string;
      gender?: string;
    }
  ): Promise<any> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.first_name !== undefined) {
      updates.push(`first_name = $${paramCount}`);
      values.push(data.first_name);
      paramCount++;
    }
    if (data.last_name !== undefined) {
      updates.push(`last_name = $${paramCount}`);
      values.push(data.last_name);
      paramCount++;
    }
    if (data.profile_photo_url !== undefined) {
      updates.push(`profile_photo_url = $${paramCount}`);
      values.push(data.profile_photo_url);
      paramCount++;
    }
    if (data.date_of_birth !== undefined) {
      updates.push(`date_of_birth = $${paramCount}`);
      values.push(data.date_of_birth);
      paramCount++;
    }
    if (data.gender !== undefined) {
      updates.push(`gender = $${paramCount}`);
      values.push(data.gender);
      paramCount++;
    }

    if (updates.length === 0) {
      return null;
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const query = `
      UPDATE passenger_profiles 
      SET ${updates.join(', ')} 
      WHERE user_id = $${paramCount}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Create passenger profile
   */
  static async createPassengerProfile(
    userId: string,
    data: {
      first_name: string;
      last_name: string;
      profile_photo_url?: string;
      date_of_birth?: string;
      gender?: string;
    }
  ): Promise<any> {
    const query = `
      INSERT INTO passenger_profiles (
        user_id, first_name, last_name, profile_photo_url, date_of_birth, gender
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [
      userId,
      data.first_name,
      data.last_name,
      data.profile_photo_url || null,
      data.date_of_birth || null,
      data.gender || null,
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get passenger profile by user ID
   */
  static async getPassengerProfile(userId: string): Promise<any> {
    const query = 'SELECT * FROM passenger_profiles WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  /**
   * Search users
   */
  static async search(
    query: string,
    options?: {
      page?: number;
      limit?: number;
    }
  ): Promise<{ users: IUser[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const searchQuery = `
      SELECT * FROM users 
      WHERE deleted_at IS NULL 
      AND (phone_number ILIKE $1 OR email ILIKE $1)
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) as total FROM users 
      WHERE deleted_at IS NULL 
      AND (phone_number ILIKE $1 OR email ILIKE $1)
    `;

    const searchTerm = `%${query}%`;
    const [result, countResult] = await Promise.all([
      pool.query(searchQuery, [searchTerm, limit, offset]),
      pool.query(countQuery, [searchTerm]),
    ]);

    return {
      users: result.rows,
      total: parseInt(countResult.rows[0].total, 10),
    };
  }
}

export default UserModel;