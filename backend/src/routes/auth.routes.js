/**
 * Authentication Routes
 * Handles user registration, login, and logout
 */

const express = require('express');
const router = express.Router();
const authService = require('../services/auth.service');
const sessionService = require('../services/session.service');
const auditService = require('../services/audit.service');

/**
 * POST /api/auth/signup
 * Register a new user
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Validate required fields
    if (!email || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email, username, and password are required'
      });
    }

    // Register user
    const user = await authService.registerUser({
      email,
      username,
      password
    });

    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);

    // Create session
    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role
    };

    // Track session in database for HIPAA/GDPR compliance
    await sessionService.createSession({
      userId: user.id,
      sessionToken: req.sessionID,
      ipAddress,
      userAgent,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    });

    // Audit log - account created
    await auditService.logAccountCreated(user.id, user.email, ipAddress, userAgent);

    // Audit log - session created
    await auditService.logSessionCreated(user.id, req.sessionID, ipAddress, userAgent);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          created_at: user.created_at
        }
      }
    });
  } catch (error) {
    console.error('Signup error:', error);

    // Determine status code based on error message
    let statusCode = 500;
    if (error.message.includes('already') ||
        error.message.includes('taken') ||
        error.message.includes('Invalid') ||
        error.message.includes('must')) {
      statusCode = 400;
    }

    res.status(statusCode).json({
      success: false,
      error: error.message || 'Registration failed'
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user
 */
router.post('/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    // Validate required fields
    if (!emailOrUsername || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email/username and password are required'
      });
    }

    // Authenticate user
    const user = await authService.authenticateUser(emailOrUsername, password);

    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);

    // Create session
    req.session.userId = user.id;
    req.session.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role
    };

    // Track session in database for HIPAA/GDPR compliance
    await sessionService.createSession({
      userId: user.id,
      sessionToken: req.sessionID,
      ipAddress,
      userAgent,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    });

    // Audit log - login success
    await auditService.logAuthSuccess(user.id, ipAddress, userAgent);

    // Audit log - session created
    await auditService.logSessionCreated(user.id, req.sessionID, ipAddress, userAgent);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          last_login: user.last_login
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);

    // Audit log - login failure
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);
    await auditService.logAuthFailure(
      req.body.emailOrUsername,
      error.message,
      ipAddress,
      userAgent
    );

    // Always return 401 for invalid credentials (don't reveal which field was wrong)
    let statusCode = 401;
    if (error.message.includes('required')) {
      statusCode = 400;
    }

    res.status(statusCode).json({
      success: false,
      error: error.message.includes('credentials') || error.message.includes('disabled')
        ? error.message
        : 'Authentication failed'
    });
  }
});

/**
 * POST /api/auth/logout
 * Destroy user session
 */
router.post('/logout', async (req, res) => {
  if (req.session) {
    const sessionToken = req.sessionID;
    const userId = req.session.userId;
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);

    req.session.destroy(async (err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({
          success: false,
          error: 'Logout failed'
        });
      }

      // Remove session from database for HIPAA/GDPR compliance
      await sessionService.destroySession(sessionToken, 'logout');

      // Audit log - logout
      await auditService.logLogout(userId, ipAddress, userAgent, 'user_initiated');

      // Audit log - session destroyed
      await auditService.logSessionDestroyed(userId, sessionToken, 'logout', ipAddress, userAgent);

      res.clearCookie('connect.sid'); // Clear session cookie
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    });
  } else {
    res.json({
      success: true,
      message: 'No active session'
    });
  }
});

/**
 * GET /api/auth/session
 * Get current user session
 */
router.get('/session', async (req, res) => {
  if (req.session && req.session.user) {
    // Update session activity timestamp
    await sessionService.updateSessionActivity(req.sessionID);

    res.json({
      success: true,
      data: {
        authenticated: true,
        user: req.session.user
      }
    });
  } else {
    res.json({
      success: true,
      data: {
        authenticated: false,
        user: null
      }
    });
  }
});

/**
 * GET /api/auth/sessions
 * Get all active sessions for the current user
 */
router.get('/sessions', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const sessionStats = await sessionService.getUserSessionStats(req.session.userId);

    res.json({
      success: true,
      data: sessionStats
    });
  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve sessions'
    });
  }
});

/**
 * POST /api/auth/sessions/logout-all
 * Destroy all sessions for the current user
 */
router.post('/sessions/logout-all', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userId = req.session.userId;
    const count = await sessionService.destroyAllUserSessions(userId, 'logout_all');

    res.json({
      success: true,
      message: `Logged out of ${count} sessions`,
      data: { sessionsDestroyed: count }
    });
  } catch (error) {
    console.error('Error logging out all sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to logout all sessions'
    });
  }
});

/**
 * GET /api/auth/password-requirements
 * Get password requirements for frontend validation
 */
router.get('/password-requirements', (req, res) => {
  res.json({
    success: true,
    data: authService.getPasswordRequirements()
  });
});

module.exports = router;
