import pool from '../config/database';
import {
  ConsentType,
  IUserConsent,
} from '../types';
import {
  ValidationError,
  NotFoundError,
} from '../middleware/error.middleware';
import logger from '../utils/logger';

/**
 * Consent Service (NDPA 2023 compliance)
 *
 * Records user consent events for the Nigeria Data Protection Act 2023.
 * Every time a user grants or revokes a consent type (terms of service,
 * privacy policy, KYC data sharing, liveness capture), we write a row to
 * `user_consents` with:
 *   - consent_type       (enum)
 *   - consent_version    (semantic version of the T&C that was accepted)
 *   - granted            (true = granted, false = revoked)
 *   - ip_address         (best-effort, from request)
 *   - user_agent         (best-effort, from request)
 *   - metadata           (arbitrary JSON: e.g. UI locale, app version)
 *
 * Multiple rows per (user, consent_type) are expected over time. Callers
 * that want to know "is this user currently consented?" should use
 * `hasConsent()` which inspects the most recent row.
 */
export class ConsentService {
  // ============================================
  // RECORD CONSENT
  // ============================================

  /**
   * Record a consent event (grant or revoke).
   *
   * This is append-only — we never UPDATE existing rows. To revoke,
   * call this method with `granted = false`. To upgrade to a new T&C
   * version, call with the new version and `granted = true`.
   *
   * @returns the freshly-created consent row
   */
  static async record(
    userId: string,
    consentType: ConsentType,
    version: string,
    ip?: string,
    userAgent?: string,
    metadata?: Record<string, unknown>
  ): Promise<IUserConsent> {
    // 1. Validate inputs
    if (!userId) {
      throw new ValidationError('userId is required');
    }
    if (!consentType) {
      throw new ValidationError('consentType is required');
    }
    if (!version || version.trim().length === 0) {
      throw new ValidationError('version is required');
    }

    const validTypes: ConsentType[] = [
      'terms_of_service',
      'privacy_policy',
      'kyc_data_sharing',
      'liveness_capture',
    ];
    if (!validTypes.includes(consentType)) {
      throw new ValidationError(
        `Invalid consentType. Must be one of: ${validTypes.join(', ')}`
      );
    }

    // 2. Insert
    try {
      const result = await pool.query(
        `INSERT INTO user_consents (
           user_id,
           consent_type,
           consent_version,
           granted,
           ip_address,
           user_agent,
           metadata
         ) VALUES ($1, $2, $3, TRUE, $4, $5, $6)
         RETURNING *`,
        [
          userId,
          consentType,
          version,
          ip || null,
          userAgent || null,
          metadata || null,
        ]
      );

      const row: IUserConsent = result.rows[0];
      logger.info(
        `Consent recorded: user=${userId} type=${consentType} version=${version}`
      );
      return row;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(
        `Failed to record consent for user ${userId} (${consentType}): ${msg}`
      );
      throw new Error('Failed to record consent. Please try again.');
    }
  }

  // ============================================
  // CHECK CONSENT
  // ============================================

  /**
   * Check whether a user currently has valid consent for a given type.
   *
   * Logic:
   *   1. Fetch the most recent consent row for (user, type)
   *   2. If none exists → FALSE
   *   3. If the latest row has `revoked_at IS NOT NULL` → FALSE
   *   4. If the latest row has `granted = TRUE` → TRUE
   *   5. Otherwise → FALSE
   *
   * @returns true if user has valid consent, false otherwise
   */
  static async hasConsent(
    userId: string,
    consentType: ConsentType
  ): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }
    if (!consentType) {
      throw new ValidationError('consentType is required');
    }

    try {
      const result = await pool.query(
        `SELECT granted, revoked_at
         FROM user_consents
         WHERE user_id = $1 AND consent_type = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, consentType]
      );

      if (result.rows.length === 0) {
        return false;
      }

      const latest = result.rows[0];

      // Explicit revocation
      if (latest.revoked_at !== null) {
        return false;
      }

      // Most recent row's grant state
      return latest.granted === true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(
        `Failed to check consent for user ${userId} (${consentType}): ${msg}`
      );
      // Fail safe — if we can't determine consent, deny
      return false;
    }
  }

  // ============================================
  // CONVENIENCE HELPERS
  // ============================================

  /**
   * Assert that a user has consented to a specific type.
   * Throws `ValidationError` if not. Useful as a guard before
   * processing KYC submissions.
   */
  static async assertConsent(
    userId: string,
    consentType: ConsentType
  ): Promise<void> {
    const has = await this.hasConsent(userId, consentType);
    if (!has) {
      throw new ValidationError(
        `Consent required: ${consentType}. Please accept the relevant terms before continuing.`
      );
    }
  }

  /**
   * Bulk-fetch a user's current consent state for all types.
   * Useful for building a "consent status" dashboard payload.
   */
  static async getConsentSummary(userId: string): Promise<{
    terms_of_service: boolean;
    privacy_policy: boolean;
    kyc_data_sharing: boolean;
    liveness_capture: boolean;
  }> {
    const [tos, privacy, kyc, liveness] = await Promise.all([
      this.hasConsent(userId, 'terms_of_service'),
      this.hasConsent(userId, 'privacy_policy'),
      this.hasConsent(userId, 'kyc_data_sharing'),
      this.hasConsent(userId, 'liveness_capture'),
    ]);

    return {
      terms_of_service: tos,
      privacy_policy: privacy,
      kyc_data_sharing: kyc,
      liveness_capture: liveness,
    };
  }

  /**
   * Fetch the full consent history for a user (most recent first).
   * Admin-only — useful for audit purposes.
   */
  static async getHistory(
    userId: string,
    limit: number = 100
  ): Promise<IUserConsent[]> {
    const result = await pool.query(
      `SELECT *
       FROM user_consents
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /**
   * Revoke a specific consent type for a user.
   * Writes a new row with `granted = FALSE` and `revoked_at = NOW()`.
   */
  static async revoke(
    userId: string,
    consentType: ConsentType,
    reason?: string
  ): Promise<IUserConsent> {
    // Confirm user exists (defense in depth)
    const userResult = await pool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    try {
      const result = await pool.query(
        `INSERT INTO user_consents (
           user_id,
           consent_type,
           consent_version,
           granted,
           revoked_at,
           metadata
         ) VALUES ($1, $2, $3, FALSE, NOW(), $4)
         RETURNING *`,
        [
          userId,
          consentType,
          'revoked',
          reason ? { reason } : null,
        ]
      );

      logger.info(
        `Consent revoked: user=${userId} type=${consentType}` +
          (reason ? ` reason=${reason}` : '')
      );
      return result.rows[0];
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(
        `Failed to revoke consent for user ${userId} (${consentType}): ${msg}`
      );
      throw new Error('Failed to revoke consent. Please try again.');
    }
  }
}

export default ConsentService;