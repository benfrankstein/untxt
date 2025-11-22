const creditsService = require('../services/credits.service');
const stripeService = require('../services/stripe.service');

/**
 * Credits Controller
 *
 * Handles HTTP requests for credit-related endpoints.
 * All responses follow standard format: { success, data, message }
 */
class CreditsController {
  /**
   * GET /api/credits/balance
   * Get user's current credit balance
   */
  async getBalance(req, res) {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      const balance = await creditsService.getUserCreditsBalance(userId);

      res.json({
        success: true,
        data: {
          userId,
          balance,
          timestamp: new Date()
        }
      });
    } catch (error) {
      console.error('Error getting credit balance:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve credit balance',
        message: error.message
      });
    }
  }

  /**
   * GET /api/credits/stats
   * Get detailed credit statistics for user
   */
  async getStats(req, res) {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      const stats = await creditsService.getUserCreditStats(userId);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting credit stats:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve credit statistics',
        message: error.message
      });
    }
  }

  /**
   * GET /api/credits/packages
   * Get available credit packages for purchase
   */
  async getPackages(req, res) {
    try {
      const packages = await creditsService.getCreditPackages();

      res.json({
        success: true,
        data: {
          packages,
          count: packages.length
        }
      });
    } catch (error) {
      console.error('Error getting credit packages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve credit packages',
        message: error.message
      });
    }
  }

  /**
   * POST /api/credits/purchase
   * Initiate credit purchase (create Stripe checkout session)
   */
  async initiatePurchase(req, res) {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { packageId } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      if (!packageId) {
        return res.status(400).json({
          success: false,
          error: 'Package ID is required'
        });
      }

      const metadata = {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      };

      const checkoutSession = await stripeService.createCheckoutSession(
        userId,
        packageId,
        metadata
      );

      res.json({
        success: true,
        data: checkoutSession,
        message: 'Checkout session created successfully'
      });
    } catch (error) {
      console.error('Error initiating purchase:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to initiate purchase',
        message: error.message
      });
    }
  }

  /**
   * GET /api/credits/history
   * Get credit transaction history
   */
  async getHistory(req, res) {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      const history = await creditsService.getCreditTransactionHistory(
        userId,
        limit,
        offset
      );

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      console.error('Error getting credit history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve credit history',
        message: error.message
      });
    }
  }

  /**
   * POST /api/credits/webhook
   * Handle Stripe webhook events (NO AUTH REQUIRED - verified by signature)
   */
  async handleWebhook(req, res) {
    try {
      const signature = req.headers['stripe-signature'];
      const payload = req.body;

      if (!signature) {
        return res.status(400).json({
          success: false,
          error: 'Missing Stripe signature'
        });
      }

      const result = await stripeService.handleWebhook(signature, payload);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error handling webhook:', error);
      res.status(400).json({
        success: false,
        error: 'Webhook processing failed',
        message: error.message
      });
    }
  }

  /**
   * POST /api/credits/simulate-payment
   * TEST MODE ONLY: Simulate a successful payment
   * This bypasses Stripe and directly adds credits
   */
  async simulatePayment(req, res) {
    try {
      // Only allow in test mode
      if (process.env.STRIPE_TEST_MODE !== 'true') {
        return res.status(403).json({
          success: false,
          error: 'Payment simulation is only available in test mode'
        });
      }

      const userId = req.user?.id || req.headers['x-user-id'];
      const { packageId } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      if (!packageId) {
        return res.status(400).json({
          success: false,
          error: 'Package ID is required'
        });
      }

      const metadata = {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        simulation: true
      };

      const result = await stripeService.simulatePayment(userId, packageId, metadata);

      res.json({
        success: true,
        data: result,
        message: `TEST MODE: Successfully added ${result.creditsAdded} credits`
      });
    } catch (error) {
      console.error('Error simulating payment:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to simulate payment',
        message: error.message
      });
    }
  }

  /**
   * GET /api/credits/payments
   * Get payment history
   */
  async getPaymentHistory(req, res) {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      const payments = await stripeService.getPaymentHistory(userId, limit, offset);

      res.json({
        success: true,
        data: {
          payments,
          count: payments.length
        }
      });
    } catch (error) {
      console.error('Error getting payment history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve payment history',
        message: error.message
      });
    }
  }

  /**
   * POST /api/credits/verify-payment
   * Verify Stripe checkout session and apply credits
   * Called by frontend success page after payment
   */
  async verifyPayment(req, res) {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { sessionId } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: 'Session ID is required'
        });
      }

      // Verify the session with Stripe and apply credits
      const result = await stripeService.verifyAndApplyPayment(userId, sessionId);

      res.json({
        success: true,
        data: result,
        message: 'Payment verified and credits applied successfully'
      });
    } catch (error) {
      console.error('Error verifying payment:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to verify payment',
        message: error.message
      });
    }
  }

  /**
   * POST /api/credits/validate
   * Check if user has sufficient credits for an operation
   */
  async validateCredits(req, res) {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];
      const { requiredCredits } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      if (!requiredCredits || requiredCredits < 1) {
        return res.status(400).json({
          success: false,
          error: 'Required credits must be at least 1'
        });
      }

      const hasSufficient = await creditsService.hasSufficientCredits(
        userId,
        requiredCredits
      );

      const balance = await creditsService.getUserCreditsBalance(userId);

      res.json({
        success: true,
        data: {
          hasSufficientCredits: hasSufficient,
          currentBalance: balance,
          requiredCredits,
          shortfall: hasSufficient ? 0 : requiredCredits - balance
        }
      });
    } catch (error) {
      console.error('Error validating credits:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to validate credits',
        message: error.message
      });
    }
  }
}

module.exports = new CreditsController();
