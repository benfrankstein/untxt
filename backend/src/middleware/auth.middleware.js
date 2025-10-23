/**
 * Authentication Middleware
 * Protects routes that require authentication
 */

const sessionService = require('../services/session.service');

/**
 * Require authentication
 * Use this middleware on routes that require a logged-in user
 * Also updates session activity timestamp for rolling sessions
 */
async function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    // User is authenticated
    // Update session activity for rolling timeout
    await sessionService.updateSessionActivity(req.sessionID);
    return next();
  }

  // User is not authenticated
  res.status(401).json({
    success: false,
    error: 'Authentication required',
    message: 'Please log in to access this resource'
  });
}

/**
 * Require admin role
 * Use this middleware on routes that require admin privileges
 * Also updates session activity timestamp for rolling sessions
 */
async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  if (req.session.user && req.session.user.role === 'admin') {
    // Update session activity for rolling timeout
    await sessionService.updateSessionActivity(req.sessionID);
    return next();
  }

  res.status(403).json({
    success: false,
    error: 'Forbidden',
    message: 'Admin privileges required'
  });
}

/**
 * Optional authentication
 * Attaches user to request if authenticated, but doesn't block unauthenticated requests
 */
function optionalAuth(req, res, next) {
  // User info already attached via session
  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  optionalAuth
};
