const express = require('express');
const router = express.Router();
const creditsController = require('../controllers/credits.controller');

/**
 * Credits API Routes
 *
 * All credit-related endpoints for the HIPAA-compliant payment system.
 *
 * Authentication: Most routes require authentication (add middleware in production)
 * Exception: /webhook endpoint (verified by Stripe signature)
 */

// =============================================
// Credit Balance & Stats
// =============================================

/**
 * GET /api/credits/balance
 * Get current credit balance
 */
router.get('/balance', creditsController.getBalance);

/**
 * GET /api/credits/stats
 * Get detailed credit statistics
 */
router.get('/stats', creditsController.getStats);

/**
 * POST /api/credits/validate
 * Validate sufficient credits before operation
 */
router.post('/validate', creditsController.validateCredits);

// =============================================
// Credit Packages
// =============================================

/**
 * GET /api/credits/packages
 * Get available credit packages for purchase
 */
router.get('/packages', creditsController.getPackages);

// =============================================
// Purchase & Payment
// =============================================

/**
 * POST /api/credits/purchase
 * Initiate credit purchase (creates Stripe checkout session)
 */
router.post('/purchase', creditsController.initiatePurchase);

/**
 * POST /api/credits/verify-payment
 * Verify Stripe checkout session and apply credits
 * Called by frontend after successful payment
 */
router.post('/verify-payment', creditsController.verifyPayment);

/**
 * POST /api/credits/webhook
 * Stripe webhook handler (NO AUTH - verified by signature)
 * Use raw body parser for this endpoint
 */
router.post('/webhook',
  express.raw({ type: 'application/json' }),
  creditsController.handleWebhook
);

/**
 * POST /api/credits/simulate-payment
 * TEST MODE ONLY: Simulate successful payment
 * Bypasses Stripe and directly adds credits
 */
router.post('/simulate-payment', creditsController.simulatePayment);

// =============================================
// Transaction History
// =============================================

/**
 * GET /api/credits/history
 * Get credit transaction history
 */
router.get('/history', creditsController.getHistory);

/**
 * GET /api/credits/payments
 * Get payment history (Stripe payments only)
 */
router.get('/payments', creditsController.getPaymentHistory);

module.exports = router;
