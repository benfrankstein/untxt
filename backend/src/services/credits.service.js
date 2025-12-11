const dbService = require('./db.service');
const auditService = require('./audit.service');

/**
 * Credits Service
 *
 * Handles all credit-related business logic for the HIPAA-compliant
 * credits system. All transactions are logged with full audit trail.
 *
 * Credit Model:
 * - 1 credit = 1 page processed
 * - New users start with 10 free credits
 * - Credits are deducted BEFORE processing
 * - Failed tasks automatically refund credits
 */
class CreditsService {
  /**
   * Get user's current credit balance
   */
  async getUserCreditsBalance(userId) {
    const query = `
      SELECT credits_balance
      FROM users
      WHERE id = $1;
    `;

    const result = await dbService.pool.query(query, [userId]);

    if (!result.rows[0]) {
      throw new Error('User not found');
    }

    return result.rows[0].credits_balance;
  }

  /**
   * Get detailed credit statistics for a user
   */
  async getUserCreditStats(userId) {
    const query = `
      SELECT *
      FROM user_credit_stats
      WHERE user_id = $1;
    `;

    const result = await dbService.pool.query(query, [userId]);

    if (!result.rows[0]) {
      throw new Error('User not found');
    }

    return result.rows[0];
  }

  /**
   * Validate that user has sufficient credits
   * @throws Error if insufficient credits
   */
  async validateSufficientCredits(userId, requiredCredits) {
    const balance = await this.getUserCreditsBalance(userId);

    if (balance < requiredCredits) {
      throw new Error(
        `Insufficient credits. You have ${balance} credits but need ${requiredCredits}. Please purchase more credits to continue.`
      );
    }

    return true;
  }

  /**
   * Check if user has sufficient credits (returns boolean)
   */
  async hasSufficientCredits(userId, requiredCredits) {
    try {
      const balance = await this.getUserCreditsBalance(userId);
      return balance >= requiredCredits;
    } catch (error) {
      return false;
    }
  }

  /**
   * Deduct credits from user account
   * Uses database function with row-level locking to prevent race conditions
   */
  async deductCredits(userId, amount, taskId, description, metadata = {}) {
    try {
      // Use database function for atomic deduction with row-level locking
      const query = `
        SELECT deduct_credits($1, $2, $3, $4, $5, $6) AS transaction_id;
      `;

      const values = [
        userId,
        amount,
        taskId,
        description || `Deducted ${amount} credit(s) for task processing`,
        metadata.ipAddress || null,
        metadata.userAgent || null
      ];

      const result = await dbService.pool.query(query, values);
      const transactionId = result.rows[0].transaction_id;

      // Get updated balance
      const newBalance = await this.getUserCreditsBalance(userId);

      console.log(`✓ Deducted ${amount} credits from user ${userId}. New balance: ${newBalance}`);

      // Log to audit service
      await auditService.logEvent({
        userId,
        eventType: 'credit_deduction',
        eventCategory: 'credits',
        details: {
          transactionId,
          taskId,
          amount,
          newBalance,
          ...metadata
        }
      });

      return {
        transactionId,
        newBalance,
        amountDeducted: amount
      };
    } catch (error) {
      console.error('Error deducting credits:', error);

      // If insufficient credits, provide user-friendly error
      if (error.message.includes('Insufficient credits')) {
        throw new Error(error.message);
      }

      throw new Error('Failed to deduct credits. Please try again.');
    }
  }

  /**
   * Add credits to user account
   */
  async addCredits(userId, amount, type, description, metadata = {}) {
    const client = await dbService.pool.connect();

    try {
      await client.query('BEGIN');

      // Get current balance with row lock
      const balanceQuery = `
        SELECT credits_balance
        FROM users
        WHERE id = $1
        FOR UPDATE;
      `;

      const balanceResult = await client.query(balanceQuery, [userId]);

      if (!balanceResult.rows[0]) {
        throw new Error('User not found');
      }

      const balanceBefore = balanceResult.rows[0].credits_balance;
      const balanceAfter = balanceBefore + amount;

      // Update user balance
      const updateQuery = `
        UPDATE users
        SET credits_balance = $1
        WHERE id = $2;
      `;

      await client.query(updateQuery, [balanceAfter, userId]);

      // Create transaction record
      const transactionQuery = `
        INSERT INTO credit_transactions (
          user_id, type, status, amount, balance_before, balance_after,
          description, metadata, ip_address, user_agent, payment_intent_id
        )
        VALUES ($1, $2, 'completed', $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id;
      `;

      const transactionValues = [
        userId,
        type,
        amount,
        balanceBefore,
        balanceAfter,
        description,
        JSON.stringify(metadata),
        metadata.ipAddress || null,
        metadata.userAgent || null,
        metadata.paymentIntentId || null
      ];

      const transactionResult = await client.query(transactionQuery, transactionValues);
      const transactionId = transactionResult.rows[0].id;

      await client.query('COMMIT');

      console.log(`✓ Added ${amount} credits to user ${userId}. New balance: ${balanceAfter}`);

      // Log to audit service
      await auditService.logEvent({
        userId,
        action: 'credit_addition',
        description: `Added ${amount} credits (${type})`,
        metadata: JSON.stringify({
          transactionId,
          type,
          amount,
          newBalance: balanceAfter,
          ...metadata
        })
      });

      return {
        transactionId,
        newBalance: balanceAfter,
        amountAdded: amount
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error adding credits:', error);
      throw new Error('Failed to add credits. Please contact support.');
    } finally {
      client.release();
    }
  }

  /**
   * Refund credits to user (e.g., when task fails)
   */
  async refundCredits(userId, taskId, amount, reason, metadata = {}) {
    try {
      // Use database function for atomic refund
      const query = `
        SELECT refund_credits($1, $2, $3, $4, $5) AS transaction_id;
      `;

      const values = [
        userId,
        amount,
        taskId,
        reason || `Refunded ${amount} credit(s) due to task failure`,
        metadata.ipAddress || null
      ];

      const result = await dbService.pool.query(query, values);
      const transactionId = result.rows[0].transaction_id;

      // Get updated balance
      const newBalance = await this.getUserCreditsBalance(userId);

      console.log(`✓ Refunded ${amount} credits to user ${userId}. New balance: ${newBalance}`);

      // Log to audit service
      await auditService.logEvent({
        userId,
        action: 'credit_refund',
        description: `Refunded ${amount} credits`,
        metadata: JSON.stringify({
          transactionId,
          taskId,
          amount,
          reason,
          newBalance,
          ...metadata
        })
      });

      return {
        transactionId,
        newBalance,
        amountRefunded: amount
      };
    } catch (error) {
      console.error('Error refunding credits:', error);
      throw new Error('Failed to refund credits. Please contact support.');
    }
  }

  /**
   * Get credit transaction history for a user
   */
  async getCreditTransactionHistory(userId, limit = 50, offset = 0) {
    const query = `
      SELECT
        id,
        type,
        status,
        amount,
        balance_before,
        balance_after,
        task_id,
        payment_intent_id,
        description,
        metadata,
        created_at
      FROM credit_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const result = await dbService.pool.query(query, [userId, limit, offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM credit_transactions
      WHERE user_id = $1;
    `;

    const countResult = await dbService.pool.query(countQuery, [userId]);
    const total = parseInt(countResult.rows[0].total);

    return {
      transactions: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    };
  }

  /**
   * Get all available credit packages
   */
  async getCreditPackages() {
    const query = `
      SELECT
        id,
        name,
        credits,
        price_usd,
        savings_percentage,
        description
      FROM credit_packages
      WHERE is_active = true
      ORDER BY sort_order;
    `;

    const result = await dbService.pool.query(query);

    return result.rows;
  }

  /**
   * Get a specific credit package by ID
   */
  async getCreditPackageById(packageId) {
    const query = `
      SELECT
        id,
        name,
        credits,
        price_usd,
        savings_percentage,
        description
      FROM credit_packages
      WHERE id = $1 AND is_active = true;
    `;

    const result = await dbService.pool.query(query, [packageId]);

    if (!result.rows[0]) {
      throw new Error('Credit package not found');
    }

    return result.rows[0];
  }

  /**
   * Calculate credits needed for a task based on page count
   */
  calculateCreditsForPages(pageCount) {
    // 1 credit = 1 page
    return Math.max(1, pageCount || 1);
  }

  /**
   * Admin: Adjust user credits manually
   * (for customer support, refunds, promotions, etc.)
   */
  async adminAdjustCredits(userId, amount, adminUserId, reason, metadata = {}) {
    const type = amount > 0 ? 'admin_adjustment' : 'admin_adjustment';
    const description = `Admin adjustment: ${reason}`;

    try {
      let result;

      if (amount > 0) {
        // Adding credits
        result = await this.addCredits(userId, amount, type, description, {
          ...metadata,
          adminUserId,
          reason
        });
      } else {
        // Deducting credits (amount is negative, so convert to positive)
        result = await this.deductCredits(
          userId,
          Math.abs(amount),
          null,
          description,
          {
            ...metadata,
            adminUserId,
            reason
          }
        );
      }

      // Log admin action
      await auditService.logAdminAction({
        adminUserId,
        action: 'admin_credit_adjustment',
        targetUserId: userId,
        description: `Adjusted credits by ${amount}`,
        reason,
        metadata: {
          amount,
          transactionId: result.transactionId,
          newBalance: result.newBalance
        }
      });

      return result;
    } catch (error) {
      console.error('Error in admin credit adjustment:', error);
      throw error;
    }
  }

  /**
   * Get low balance users (for marketing/notifications)
   */
  async getLowBalanceUsers(threshold = 5) {
    const query = `
      SELECT
        id,
        username,
        email,
        credits_balance
      FROM users
      WHERE credits_balance <= $1
        AND is_active = true
      ORDER BY credits_balance ASC;
    `;

    const result = await dbService.pool.query(query, [threshold]);

    return result.rows;
  }
}

module.exports = new CreditsService();
