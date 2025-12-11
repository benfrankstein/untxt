const creditsService = require('./credits.service');
const auditService = require('./audit.service');
const dbService = require('./db.service');

/**
 * Stripe Payment Service
 *
 * Handles Stripe payment integration for credit purchases.
 * Supports both LIVE and TEST modes.
 *
 * Test Mode Features:
 * - Simulated payments without real charges
 * - Test card: 4242 4242 4242 4242
 * - Instant credit application
 *
 * Security:
 * - NO credit card data stored (PCI compliant)
 * - Webhook signature verification
 * - Full audit trail of all transactions
 */
class StripeService {
  constructor() {
    // Initialize Stripe only if API key is provided
    this.stripeEnabled = !!process.env.STRIPE_SECRET_KEY;
    this.testMode = process.env.STRIPE_TEST_MODE === 'true';

    if (this.stripeEnabled) {
      this.stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      console.log(`✓ Stripe initialized in ${this.testMode ? 'TEST' : 'LIVE'} mode`);
    } else {
      console.warn('⚠ Stripe not configured. Using simulation mode only.');
    }
  }

  /**
   * Create Stripe Checkout Session for credit purchase
   */
  async createCheckoutSession(userId, packageId, metadata = {}) {
    try {
      // Get user info
      const user = await dbService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get package details
      const creditPackage = await creditsService.getCreditPackageById(packageId);

      // If Stripe is not configured, return simulation URL
      if (!this.stripeEnabled) {
        return {
          sessionId: `sim_${Date.now()}`,
          url: `/credits/simulate-payment?package=${packageId}`,
          mode: 'simulation',
          package: creditPackage
        };
      }

      // Create Stripe checkout session
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: user.email,
        client_reference_id: userId,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: creditPackage.name,
                description: `${creditPackage.credits} credits for OCR processing`,
                images: [], // Add product images if available
              },
              unit_amount: Math.round(creditPackage.price_usd * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
        metadata: {
          userId,
          packageId,
          credits: creditPackage.credits,
          ...metadata
        },
        success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings.html?session_id={CHECKOUT_SESSION_ID}#credits`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings.html#credits`,
      });

      // Log checkout session creation
      await auditService.logEvent({
        userId,
        eventType: 'stripe_checkout_created',
        eventCategory: 'payment',
        details: {
          sessionId: session.id,
          packageId,
          credits: creditPackage.credits,
          amount: creditPackage.price_usd,
          description: `Created Stripe checkout session for ${creditPackage.name}`
        },
        severity: 'info'
      });

      return {
        sessionId: session.id,
        url: session.url,
        mode: this.testMode ? 'test' : 'live',
        package: creditPackage
      };
    } catch (error) {
      console.error('Error creating Stripe checkout session:', error);
      throw new Error('Failed to create payment session. Please try again.');
    }
  }

  /**
   * Handle Stripe webhook events
   * Called when Stripe sends payment status updates
   */
  async handleWebhook(signature, payload) {
    if (!this.stripeEnabled) {
      throw new Error('Stripe not configured');
    }

    try {
      // Verify webhook signature
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret
      );

      console.log(`📨 Stripe webhook received: ${event.type}`);

      // Handle different event types
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object);
          break;

        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object);
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true, eventType: event.type };
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      throw new Error('Invalid webhook signature');
    }
  }

  /**
   * Handle successful checkout session completion
   */
  async handleCheckoutSessionCompleted(session) {
    const userId = session.metadata.userId || session.client_reference_id;
    const packageId = session.metadata.packageId;
    const creditsAmount = parseInt(session.metadata.credits);

    console.log(`✓ Checkout session completed for user ${userId}`);

    try {
      // Get package details
      const creditPackage = await creditsService.getCreditPackageById(packageId);

      // Add credits to user account
      const result = await creditsService.addCredits(
        userId,
        creditsAmount,
        'purchase',
        `Purchased ${creditPackage.name}`,
        {
          paymentIntentId: session.payment_intent,
          packageId,
          packageName: creditPackage.name,
          amountPaid: creditPackage.price_usd
        }
      );

      // Create payment record
      await this.createPaymentRecord({
        userId,
        transactionId: result.transactionId,
        stripePaymentIntentId: session.payment_intent,
        stripeCustomerId: session.customer,
        stripeSessionId: session.id,
        amountUsd: creditPackage.price_usd,
        creditsPurchased: creditsAmount,
        paymentStatus: 'succeeded',
        metadata: session.metadata
      });

      console.log(`✓ Credits applied: ${creditsAmount} credits added to user ${userId}`);

      return result;
    } catch (error) {
      console.error('Error handling checkout session completion:', error);
      throw error;
    }
  }

  /**
   * Handle successful payment intent
   */
  async handlePaymentIntentSucceeded(paymentIntent) {
    console.log(`✓ Payment intent succeeded: ${paymentIntent.id}`);

    // Additional handling if needed
    await auditService.logEvent({
      userId: paymentIntent.metadata?.userId || null,
      eventType: 'stripe_payment_succeeded',
      eventCategory: 'payment',
      details: {
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount / 100,
        description: `Payment intent ${paymentIntent.id} succeeded`
      },
      severity: 'info'
    });
  }

  /**
   * Handle failed payment intent
   */
  async handlePaymentIntentFailed(paymentIntent) {
    console.error(`✗ Payment intent failed: ${paymentIntent.id}`);

    // Log failure
    await auditService.logEvent({
      userId: paymentIntent.metadata?.userId || null,
      eventType: 'stripe_payment_failed',
      eventCategory: 'payment',
      details: {
        paymentIntentId: paymentIntent.id,
        failureReason: paymentIntent.last_payment_error?.message,
        description: `Payment intent ${paymentIntent.id} failed`
      },
      severity: 'error'
    });
  }

  /**
   * Create payment record in database
   */
  async createPaymentRecord(data) {
    const query = `
      INSERT INTO payment_records (
        user_id,
        transaction_id,
        stripe_payment_intent_id,
        stripe_customer_id,
        stripe_session_id,
        amount_usd,
        credits_purchased,
        payment_status,
        paid_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
      RETURNING id;
    `;

    const values = [
      data.userId,
      data.transactionId,
      data.stripePaymentIntentId,
      data.stripeCustomerId || null,
      data.stripeSessionId || null,
      data.amountUsd,
      data.creditsPurchased,
      data.paymentStatus,
      JSON.stringify(data.metadata || {})
    ];

    const result = await dbService.pool.query(query, values);

    return result.rows[0].id;
  }

  /**
   * Verify payment intent status
   */
  async verifyPaymentIntent(paymentIntentId) {
    if (!this.stripeEnabled) {
      throw new Error('Stripe not configured');
    }

    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);

      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        metadata: paymentIntent.metadata
      };
    } catch (error) {
      console.error('Error verifying payment intent:', error);
      throw new Error('Failed to verify payment');
    }
  }

  /**
   * Verify Stripe checkout session and apply credits
   * Called by frontend success page after payment
   */
  async verifyAndApplyPayment(userId, sessionId) {
    if (!this.stripeEnabled) {
      throw new Error('Stripe not configured');
    }

    try {
      // Retrieve the checkout session from Stripe
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);

      console.log(`Verifying payment session: ${sessionId} for user ${userId}`);

      // Verify the session belongs to this user
      if (session.client_reference_id !== userId && session.metadata?.userId !== userId) {
        throw new Error('Session does not belong to this user');
      }

      // Check if payment was successful
      if (session.payment_status !== 'paid') {
        throw new Error(`Payment not completed. Status: ${session.payment_status}`);
      }

      // Check if credits were already applied for this session
      const existingPayment = await this.getPaymentBySessionId(sessionId);
      if (existingPayment) {
        console.log(`Credits already applied for session ${sessionId}`);
        return {
          alreadyProcessed: true,
          creditsAdded: existingPayment.credits_purchased,
          newBalance: existingPayment.balance_after,
          message: 'Credits were already applied for this payment'
        };
      }

      // Apply credits - same logic as webhook handler
      const packageId = session.metadata.packageId;
      const creditsAmount = parseInt(session.metadata.credits);

      const creditPackage = await creditsService.getCreditPackageById(packageId);

      const result = await creditsService.addCredits(
        userId,
        creditsAmount,
        'purchase',
        `Purchased ${creditPackage.name}`,
        {
          paymentIntentId: session.payment_intent,
          packageId,
          packageName: creditPackage.name,
          amountPaid: creditPackage.price_usd,
          sessionId
        }
      );

      // Create payment record
      await this.createPaymentRecord({
        userId,
        transactionId: result.transactionId,
        stripePaymentIntentId: session.payment_intent,
        stripeCustomerId: session.customer,
        stripeSessionId: session.id,
        amountUsd: creditPackage.price_usd,
        creditsPurchased: creditsAmount,
        paymentStatus: 'succeeded',
        metadata: session.metadata
      });

      console.log(`✓ Credits applied via success page: ${creditsAmount} credits to user ${userId}`);

      return {
        success: true,
        creditsAdded: creditsAmount,
        newBalance: result.newBalance,
        package: creditPackage,
        transactionId: result.transactionId
      };
    } catch (error) {
      console.error('Error verifying and applying payment:', error);
      throw error;
    }
  }

  /**
   * Check if payment already exists for a session
   */
  async getPaymentBySessionId(sessionId) {
    const query = `
      SELECT pr.*, ct.balance_after
      FROM payment_records pr
      JOIN credit_transactions ct ON pr.transaction_id = ct.id
      WHERE pr.stripe_session_id = $1
      LIMIT 1;
    `;

    const result = await dbService.pool.query(query, [sessionId]);
    return result.rows[0] || null;
  }

  /**
   * TEST MODE: Simulate successful payment
   * This is for development/testing only
   */
  async simulatePayment(userId, packageId, metadata = {}) {
    console.log(`🧪 TEST MODE: Simulating payment for user ${userId}`);

    try {
      // Get package details
      const creditPackage = await creditsService.getCreditPackageById(packageId);

      // Generate fake payment intent ID
      const fakePaymentIntentId = `pi_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Add credits to user account
      const result = await creditsService.addCredits(
        userId,
        creditPackage.credits,
        'purchase',
        `TEST PURCHASE: ${creditPackage.name}`,
        {
          paymentIntentId: fakePaymentIntentId,
          packageId,
          packageName: creditPackage.name,
          amountPaid: creditPackage.price_usd,
          testMode: true,
          ...metadata
        }
      );

      // Create payment record
      await this.createPaymentRecord({
        userId,
        transactionId: result.transactionId,
        stripePaymentIntentId: fakePaymentIntentId,
        stripeCustomerId: `cus_test_${userId}`,
        stripeSessionId: `cs_test_${Date.now()}`,
        amountUsd: creditPackage.price_usd,
        creditsPurchased: creditPackage.credits,
        paymentStatus: 'succeeded',
        metadata: {
          testMode: true,
          ...metadata
        }
      });

      console.log(`✓ TEST PAYMENT: Added ${creditPackage.credits} credits to user ${userId}`);

      return {
        success: true,
        transactionId: result.transactionId,
        newBalance: result.newBalance,
        creditsAdded: creditPackage.credits,
        package: creditPackage,
        testMode: true,
        paymentIntentId: fakePaymentIntentId
      };
    } catch (error) {
      console.error('Error simulating payment:', error);
      throw error;
    }
  }

  /**
   * Get payment history for a user
   */
  async getPaymentHistory(userId, limit = 50, offset = 0) {
    const query = `
      SELECT
        pr.id,
        pr.stripe_payment_intent_id,
        pr.amount_usd,
        pr.credits_purchased,
        pr.payment_status,
        pr.paid_at,
        pr.created_at,
        ct.balance_after
      FROM payment_records pr
      JOIN credit_transactions ct ON pr.transaction_id = ct.id
      WHERE pr.user_id = $1
      ORDER BY pr.created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const result = await dbService.pool.query(query, [userId, limit, offset]);

    return result.rows;
  }
}

module.exports = new StripeService();
