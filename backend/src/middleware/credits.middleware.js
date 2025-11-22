const creditsService = require('../services/credits.service');

/**
 * Credits Middleware
 *
 * Middleware functions for validating and managing credits
 * in the request pipeline.
 */

/**
 * Validate that user has sufficient credits before proceeding
 * Usage: router.post('/upload', validateCredits(1), uploadHandler)
 */
function validateCredits(requiredCredits = 1) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      // Check if user has sufficient credits
      const hasSufficient = await creditsService.hasSufficientCredits(
        userId,
        requiredCredits
      );

      if (!hasSufficient) {
        const balance = await creditsService.getUserCreditsBalance(userId);

        return res.status(402).json({
          success: false,
          error: 'Insufficient credits',
          message: `You need ${requiredCredits} credit(s) but only have ${balance}. Please purchase more credits to continue.`,
          data: {
            currentBalance: balance,
            requiredCredits,
            shortfall: requiredCredits - balance
          }
        });
      }

      // Store required credits in request for later use
      req.creditsRequired = requiredCredits;

      next();
    } catch (error) {
      console.error('Error validating credits:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to validate credits',
        message: error.message
      });
    }
  };
}

/**
 * Deduct credits after successful operation
 * Should be called AFTER the operation completes successfully
 */
async function deductCreditsAfterSuccess(userId, amount, taskId, description, metadata = {}) {
  try {
    const result = await creditsService.deductCredits(
      userId,
      amount,
      taskId,
      description,
      metadata
    );

    return result;
  } catch (error) {
    console.error('Error deducting credits after success:', error);
    // Don't throw - log error and continue
    // Credits may need manual reconciliation in this case
    return null;
  }
}

/**
 * Middleware to attach credit balance to response
 * Useful for including balance in API responses
 */
async function attachCreditBalance(req, res, next) {
  try {
    const userId = req.user?.id || req.headers['x-user-id'];

    if (userId) {
      const balance = await creditsService.getUserCreditsBalance(userId);
      req.creditBalance = balance;

      // Optionally add to response locals for access in controllers
      res.locals.creditBalance = balance;
    }

    next();
  } catch (error) {
    // Don't fail the request, just log and continue
    console.error('Error attaching credit balance:', error);
    next();
  }
}

/**
 * Check if user has low credit balance and add warning to response
 */
function checkLowBalance(threshold = 5) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];

      if (userId) {
        const balance = await creditsService.getUserCreditsBalance(userId);

        if (balance <= threshold) {
          // Add warning to response (override res.json to inject warning)
          const originalJson = res.json.bind(res);

          res.json = function (data) {
            if (data && typeof data === 'object') {
              data.creditWarning = {
                message: `Your credit balance is low (${balance} credits remaining). Consider purchasing more credits.`,
                currentBalance: balance,
                threshold
              };
            }
            return originalJson(data);
          };
        }
      }

      next();
    } catch (error) {
      console.error('Error checking low balance:', error);
      next();
    }
  };
}

/**
 * Rate limiting based on credits
 * Prevent users with zero credits from making repeated requests
 */
function requireMinimumBalance(minBalance = 1) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.headers['x-user-id'];

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized - User ID required'
        });
      }

      const balance = await creditsService.getUserCreditsBalance(userId);

      if (balance < minBalance) {
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits',
          message: `You must have at least ${minBalance} credit(s) to access this feature. Please purchase more credits.`,
          data: {
            currentBalance: balance,
            minimumRequired: minBalance
          }
        });
      }

      next();
    } catch (error) {
      console.error('Error checking minimum balance:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check credit balance',
        message: error.message
      });
    }
  };
}

module.exports = {
  validateCredits,
  deductCreditsAfterSuccess,
  attachCreditBalance,
  checkLowBalance,
  requireMinimumBalance
};
