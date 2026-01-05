const logger = require('../utils/logger');

/**
 * In-memory rate limiter for password reset and other sensitive endpoints
 * For production with multiple servers, consider using Redis for distributed rate limiting
 */
class RateLimiter {
  constructor() {
    // Store attempts: { ip: { count: number, resetTime: timestamp } }
    this.attempts = new Map();

    // Cleanup old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if an IP has exceeded the rate limit
   * @param {string} ip - IP address
   * @param {number} maxAttempts - Maximum attempts allowed
   * @param {number} windowMs - Time window in milliseconds
   * @returns {{allowed: boolean, remainingAttempts: number, resetTime: number}}
   */
  checkLimit(ip, maxAttempts, windowMs) {
    const now = Date.now();
    const record = this.attempts.get(ip);

    // No previous attempts or window expired
    if (!record || now > record.resetTime) {
      this.attempts.set(ip, {
        count: 1,
        resetTime: now + windowMs
      });

      return {
        allowed: true,
        remainingAttempts: maxAttempts - 1,
        resetTime: now + windowMs
      };
    }

    // Within the window
    if (record.count >= maxAttempts) {
      logger.warn(`Rate limit exceeded for IP: ${ip}`);
      return {
        allowed: false,
        remainingAttempts: 0,
        resetTime: record.resetTime
      };
    }

    // Increment count
    record.count++;
    this.attempts.set(ip, record);

    return {
      allowed: true,
      remainingAttempts: maxAttempts - record.count,
      resetTime: record.resetTime
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [ip, record] of this.attempts.entries()) {
      if (now > record.resetTime) {
        this.attempts.delete(ip);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Rate limiter cleanup: removed ${cleaned} expired entries`);
    }
  }

  /**
   * Reset rate limit for a specific IP
   * @param {string} ip - IP address to reset
   */
  reset(ip) {
    this.attempts.delete(ip);
    logger.info(`Rate limit reset for IP: ${ip}`);
  }
}

// Singleton instance
const rateLimiter = new RateLimiter();

/**
 * Rate limiting middleware factory
 * @param {Object} options - Rate limit options
 * @param {number} options.maxAttempts - Maximum attempts allowed
 * @param {number} options.windowMinutes - Time window in minutes
 * @param {string} options.message - Error message to send
 * @returns {Function} Express middleware
 */
function createRateLimitMiddleware(options = {}) {
  const {
    maxAttempts = 3,
    windowMinutes = 15,
    message = 'Too many requests. Please try again later.'
  } = options;

  const windowMs = windowMinutes * 60 * 1000;

  return (req, res, next) => {
    // Get IP address (handle proxy)
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.connection.remoteAddress;

    const result = rateLimiter.checkLimit(ip, maxAttempts, windowMs);

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxAttempts);
    res.setHeader('X-RateLimit-Remaining', result.remainingAttempts);
    res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);

      logger.warn(`Rate limit blocked request from ${ip}`, {
        ip,
        path: req.path,
        method: req.method,
        retryAfter
      });

      return res.status(429).json({
        error: message,
        retryAfter: retryAfter,
        resetTime: new Date(result.resetTime).toISOString()
      });
    }

    next();
  };
}

/**
 * Preset rate limiters for common use cases
 */
const rateLimiters = {
  // Password reset: 3 attempts per 15 minutes
  passwordReset: createRateLimitMiddleware({
    maxAttempts: 3,
    windowMinutes: 15,
    message: 'Too many password reset requests. Please try again in 15 minutes.'
  }),

  // Login: 5 attempts per 15 minutes
  login: createRateLimitMiddleware({
    maxAttempts: 5,
    windowMinutes: 15,
    message: 'Too many login attempts. Please try again in 15 minutes.'
  }),

  // Signup: 3 attempts per hour
  signup: createRateLimitMiddleware({
    maxAttempts: 3,
    windowMinutes: 60,
    message: 'Too many signup attempts. Please try again later.'
  }),

  // General API: 100 requests per 15 minutes
  general: createRateLimitMiddleware({
    maxAttempts: 100,
    windowMinutes: 15,
    message: 'Too many requests. Please slow down.'
  })
};

module.exports = {
  createRateLimitMiddleware,
  rateLimiters,
  rateLimiter // Export singleton for manual control if needed
};
