const crypto = require('crypto');
const bcrypt = require('bcrypt');
const dbService = require('./db.service');
const logger = require('../utils/logger');

// Get the pool from dbService
const pool = dbService.pool;

class PasswordResetService {
  constructor() {
    this.tokenExpirationMinutes = 15; // HIPAA-compliant short expiration
    this.tokenLength = 32; // 32 bytes = 64 hex characters
  }

  /**
   * Generate a cryptographically secure random token
   * @returns {string} Hex-encoded random token
   */
  generateToken() {
    return crypto.randomBytes(this.tokenLength).toString('hex');
  }

  /**
   * Hash a token using bcrypt
   * @param {string} token - Plain token to hash
   * @returns {Promise<string>} Hashed token
   */
  async hashToken(token) {
    const saltRounds = 12;
    return await bcrypt.hash(token, saltRounds);
  }

  /**
   * Compare a plain token with a hashed token
   * @param {string} token - Plain token
   * @param {string} hash - Hashed token
   * @returns {Promise<boolean>} True if they match
   */
  async compareToken(token, hash) {
    return await bcrypt.compare(token, hash);
  }

  /**
   * Create a password reset token for a user
   * @param {string} userId - User UUID
   * @param {string} ipAddress - Request IP address
   * @param {string} userAgent - Request user agent
   * @returns {Promise<{token: string, expiresAt: Date}>} Plain token and expiration
   */
  async createResetToken(userId, ipAddress, userAgent) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Invalidate any existing unused tokens for this user
      const invalidateResult = await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
        [userId]
      );

      logger.info(`🔨 Invalidated ${invalidateResult.rowCount} old tokens for user ${userId}`);

      // Generate new token
      const plainToken = this.generateToken();
      logger.info(`🔨 Generated plain token: ${plainToken}`);
      logger.info(`🔨 Plain token length: ${plainToken.length}`);

      const tokenHash = await this.hashToken(plainToken);
      logger.info(`🔨 Generated token hash: ${tokenHash.substring(0, 20)}...`);

      const expiresAt = new Date(Date.now() + this.tokenExpirationMinutes * 60 * 1000);

      // Store hashed token in database
      const insertResult = await client.query(
        `INSERT INTO password_reset_tokens
         (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [userId, tokenHash, expiresAt, ipAddress, userAgent]
      );

      await client.query('COMMIT');

      const tokenId = insertResult.rows[0].id;
      logger.info(`✅ Password reset token created for user ${userId}, token ID: ${tokenId}`);

      // Return the plain token (only time it's available)
      return {
        token: plainToken,
        expiresAt
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create password reset token:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Validate a password reset token
   * @param {string} token - Plain token to validate
   * @returns {Promise<{valid: boolean, userId?: string, email?: string, reason?: string}>}
   */
  async validateResetToken(token) {
    try {
      // DEBUG: Log incoming token
      logger.info(`🔍 Validating token: ${token}`);
      logger.info(`🔍 Token length: ${token.length}`);

      // Get all non-expired, unused tokens (we'll check hash for each)
      const result = await pool.query(
        `SELECT prt.id, prt.user_id, prt.token_hash, prt.expires_at, prt.used_at, u.email,
                prt.created_at
         FROM password_reset_tokens prt
         JOIN users u ON u.id = prt.user_id
         WHERE prt.expires_at > CURRENT_TIMESTAMP
         AND prt.used_at IS NULL
         ORDER BY prt.created_at DESC`
      );

      logger.info(`🔍 Found ${result.rows.length} valid tokens in database`);

      // DEBUG: Log all valid tokens
      result.rows.forEach((row, idx) => {
        logger.info(`🔍 Token ${idx + 1}: ID=${row.id}, Created=${row.created_at}, UserID=${row.user_id}`);
      });

      // Try to find matching token by comparing hashes
      for (const row of result.rows) {
        logger.info(`🔍 Comparing with token ID ${row.id}...`);
        const isMatch = await this.compareToken(token, row.token_hash);
        logger.info(`🔍 Token ID ${row.id} match result: ${isMatch}`);

        if (isMatch) {
          // Check if expired (double check)
          if (new Date(row.expires_at) < new Date()) {
            logger.warn(`❌ Expired token attempted: ${row.id}`);
            return {
              valid: false,
              reason: 'Token has expired. Please request a new password reset.'
            };
          }

          // Check if already used (double check)
          if (row.used_at) {
            logger.warn(`❌ Used token attempted: ${row.id}`);
            return {
              valid: false,
              reason: 'This token has already been used. Please request a new password reset.'
            };
          }

          logger.info(`✅ Valid password reset token for user ${row.user_id}`);
          return {
            valid: true,
            userId: row.user_id,
            email: row.email,
            tokenId: row.id
          };
        }
      }

      // No matching token found
      logger.warn('❌ No matching token found in database');
      return {
        valid: false,
        reason: 'Invalid or expired token. Please request a new password reset.'
      };
    } catch (error) {
      logger.error('Failed to validate password reset token:', error);
      throw error;
    }
  }

  /**
   * Mark a token as used
   * @param {number} tokenId - Database ID of the token
   * @returns {Promise<void>}
   */
  async markTokenAsUsed(tokenId) {
    try {
      await pool.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [tokenId]
      );

      logger.info(`Password reset token ${tokenId} marked as used`);
    } catch (error) {
      logger.error('Failed to mark token as used:', error);
      throw error;
    }
  }

  /**
   * Invalidate all password reset tokens for a user
   * @param {string} userId - User UUID
   * @returns {Promise<void>}
   */
  async invalidateUserTokens(userId) {
    try {
      await pool.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
      );

      logger.info(`All password reset tokens invalidated for user ${userId}`);
    } catch (error) {
      logger.error('Failed to invalidate user tokens:', error);
      throw error;
    }
  }

  /**
   * Cleanup expired and used tokens older than 24 hours
   * @returns {Promise<number>} Number of tokens deleted
   */
  async cleanupOldTokens() {
    try {
      const result = await pool.query(
        `DELETE FROM password_reset_tokens
         WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
            OR used_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'`
      );

      const deletedCount = result.rowCount;
      logger.info(`Cleaned up ${deletedCount} old password reset tokens`);

      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old tokens:', error);
      throw error;
    }
  }

  /**
   * Get user by email for password reset (only for local auth users)
   * @param {string} email - User email
   * @returns {Promise<{userId: string, authProvider: string} | null>}
   */
  async getUserForPasswordReset(email) {
    try {
      const result = await pool.query(
        `SELECT id, auth_provider
         FROM users
         WHERE LOWER(email) = LOWER($1)
         AND is_active = true
         AND access_revoked = false`,
        [email]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const user = result.rows[0];

      // Only allow password reset for local auth users
      if (user.auth_provider !== 'local') {
        logger.warn(`Password reset attempted for ${user.auth_provider} user: ${email}`);
        return null;
      }

      return {
        userId: user.id,
        authProvider: user.auth_provider
      };
    } catch (error) {
      logger.error('Failed to get user for password reset:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new PasswordResetService();
