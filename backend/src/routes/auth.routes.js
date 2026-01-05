/**
 * Authentication Routes
 * Handles user registration, login, and logout
 */

const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const authService = require('../services/auth.service');
const googleAuthService = require('../services/google-auth.service');
const sessionService = require('../services/session.service');
const auditService = require('../services/audit.service');
const passwordResetService = require('../services/password-reset.service');
const emailService = require('../services/email.service');
const { rateLimiters } = require('../middleware/rate-limit.middleware');

/**
 * POST /api/auth/signup
 * Register a new user
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, username, password, firstName, lastName, phoneNumber } = req.body;

    // Debug: Log received data
    console.log('📝 Signup request received:', {
      email,
      username,
      firstName,
      lastName,
      phoneNumber,
      hasPassword: !!password
    });

    // Validate required fields
    if (!email || !username || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: 'Email, username, password, first name, and last name are required'
      });
    }

    // Register user
    const user = await authService.registerUser({
      email,
      username,
      password,
      firstName,
      lastName,
      phoneNumber
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
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
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
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
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

/**
 * GET /api/auth/profile
 * Get current user's profile information
 */
router.get('/profile', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const user = await authService.getUserProfile(req.session.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          phoneNumber: user.phone_number,
          role: user.role,
          createdAt: user.created_at,
          lastLogin: user.last_login
        }
      }
    });
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve profile'
    });
  }
});

/**
 * GET /api/auth/google
 * Initiate Google OAuth flow
 */
router.get('/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false
  })
);

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback
 */
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: 'http://localhost:3000/auth.html?error=google_auth_failed' }),
  async (req, res) => {
    try {
      const googleProfile = req.user;
      const ipAddress = sessionService.getClientIP(req);
      const userAgent = sessionService.getUserAgent(req);

      // Process Google auth (handles signup, login, and conflict detection)
      const result = await googleAuthService.processGoogleAuth(googleProfile);

      if (result.needsLinking) {
        // Email exists with local auth - redirect to linking page
        console.log('⚠ Account linking required:', result.email);

        // Store pending Google data in session temporarily
        req.session.pendingGoogleLink = {
          googleId: googleProfile.id,
          email: result.email,
          firstName: googleProfile.given_name,
          lastName: googleProfile.family_name
        };

        await auditService.logEvent({
          event_type: 'google_email_conflict',
          user_id: null,
          metadata: { email: result.email },
          ip_address: ipAddress,
          user_agent: userAgent
        });

        // Redirect to frontend linking page
        return res.redirect(`http://localhost:3000/link-account.html?email=${encodeURIComponent(result.email)}&provider=google`);
      }

      // Successful login/signup
      const user = result.user;

      // Create session
      req.session.userId = user.id;
      req.session.user = {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role
      };

      // Track session in database
      await sessionService.createSession({
        userId: user.id,
        sessionToken: req.sessionID,
        ipAddress,
        userAgent,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      });

      // Audit logging
      if (result.isNewUser) {
        await auditService.logAccountCreated(user.id, user.email, ipAddress, userAgent);
        await auditService.logEvent({
          event_type: 'google_signup_success',
          user_id: user.id,
          metadata: { email: user.email },
          ip_address: ipAddress,
          user_agent: userAgent
        });
        console.log(`✓ New Google user signed up: ${user.email}`);
      } else {
        await auditService.logAuthSuccess(user.id, ipAddress, userAgent);
        await auditService.logEvent({
          event_type: 'google_login_success',
          user_id: user.id,
          metadata: { email: user.email },
          ip_address: ipAddress,
          user_agent: userAgent
        });
        console.log(`✓ Google user logged in: ${user.email}`);
      }

      await auditService.logSessionCreated(user.id, req.sessionID, ipAddress, userAgent);

      // Redirect to frontend dashboard
      res.redirect('http://localhost:3000/index.html?login=success');

    } catch (error) {
      console.error('Google OAuth callback error:', error);

      const ipAddress = sessionService.getClientIP(req);
      const userAgent = sessionService.getUserAgent(req);

      await auditService.logEvent({
        event_type: 'google_auth_failed',
        user_id: null,
        metadata: { error: error.message },
        ip_address: ipAddress,
        user_agent: userAgent
      });

      // Redirect to login with error
      res.redirect(`http://localhost:3000/auth.html?error=${encodeURIComponent(error.message)}`);
    }
  }
);

/**
 * POST /api/auth/google/link
 * Link Google account to existing local account
 * Requires password verification
 */
router.post('/google/link', async (req, res) => {
  try {
    const { password } = req.body;
    const pendingGoogleLink = req.session.pendingGoogleLink;

    if (!pendingGoogleLink) {
      return res.status(400).json({
        success: false,
        error: 'No pending Google account to link. Please try signing in with Google again.'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required to link accounts'
      });
    }

    const { googleId, email } = pendingGoogleLink;
    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);

    // Find user by email
    const existingUser = await authService.authenticateUser(email, password);

    // Link Google account
    const linkedUser = await googleAuthService.linkGoogleAccount(
      existingUser.id,
      password,
      googleId,
      email
    );

    // Clear pending link data
    delete req.session.pendingGoogleLink;

    // Create session
    req.session.userId = linkedUser.id;
    req.session.user = {
      id: linkedUser.id,
      email: linkedUser.email,
      username: linkedUser.username,
      role: linkedUser.role
    };

    // Track session
    await sessionService.createSession({
      userId: linkedUser.id,
      sessionToken: req.sessionID,
      ipAddress,
      userAgent,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    });

    // Audit log
    await auditService.logEvent({
      event_type: 'account_link_success',
      user_id: linkedUser.id,
      metadata: { provider: 'google', email: linkedUser.email },
      ip_address: ipAddress,
      user_agent: userAgent
    });

    await auditService.logSessionCreated(linkedUser.id, req.sessionID, ipAddress, userAgent);

    res.json({
      success: true,
      message: 'Google account linked successfully',
      data: {
        user: {
          id: linkedUser.id,
          email: linkedUser.email,
          username: linkedUser.username,
          role: linkedUser.role
        }
      }
    });

  } catch (error) {
    console.error('Google link error:', error);

    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);

    await auditService.logEvent({
      event_type: 'account_link_failed',
      user_id: null,
      metadata: { error: error.message },
      ip_address: ipAddress,
      user_agent: userAgent
    });

    let statusCode = 400;
    if (error.message.includes('Invalid credentials') || error.message.includes('Invalid password')) {
      statusCode = 401;
    }

    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to link Google account'
    });
  }
});

/**
 * GET /api/auth/check-email
 * Check if email exists and what auth provider it uses
 * Used by frontend to show appropriate error messages
 */
router.get('/check-email', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email parameter is required'
      });
    }

    const result = await googleAuthService.checkEmailExists(email);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Check email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check email'
    });
  }
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 * Rate limited: 3 requests per 15 minutes per IP
 */
router.post('/forgot-password', rateLimiters.passwordReset, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);

    // Get user (only local auth users can reset password)
    const user = await passwordResetService.getUserForPasswordReset(email);

    // Check if user exists
    if (!user) {
      // User doesn't exist
      await auditService.logEvent({
        eventType: 'PASSWORD_RESET_ATTEMPTED',
        eventCategory: 'auth',
        userId: null,
        ipAddress,
        userAgent,
        severity: 'warning',
        details: {
          email,
          reason: 'nonexistent_email'
        }
      });

      return res.status(404).json({
        success: false,
        error: 'No account found with that email address. Please check your email or sign up.'
      });
    }

    // User exists with local auth, proceed with password reset
    // Create reset token
    const { token, expiresAt } = await passwordResetService.createResetToken(
      user.userId,
      ipAddress,
      userAgent
    );

    // Send reset email
    try {
      await emailService.sendPasswordResetEmail(email, token);

      // Audit log
      await auditService.logEvent({
        eventType: 'PASSWORD_RESET_REQUESTED',
        eventCategory: 'security',
        userId: user.userId,
        ipAddress,
        userAgent,
        severity: 'info',
        details: {
          email,
          expiresAt
        }
      });

      // Return success message
      res.json({
        success: true,
        message: 'Account found! Check your email for a password reset link. It will expire in 15 minutes.'
      });
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);

      // Log email failure
      await auditService.logEvent({
        eventType: 'PASSWORD_RESET_EMAIL_FAILED',
        eventCategory: 'security',
        userId: user.userId,
        ipAddress,
        userAgent,
        severity: 'error',
        details: {
          email,
          error: emailError.message
        }
      });

      // Return error to user
      return res.status(500).json({
        success: false,
        error: 'Failed to send reset email. Please try again later.'
      });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred. Please try again later.'
    });
  }
});

/**
 * GET /api/auth/reset-password/:token
 * Validate a password reset token
 */
router.get('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required'
      });
    }

    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);

    // Validate token
    const validation = await passwordResetService.validateResetToken(token);

    if (!validation.valid) {
      // Audit log - invalid token attempt
      await auditService.logEvent({
        eventType: 'PASSWORD_RESET_TOKEN_INVALID',
        eventCategory: 'security',
        userId: null,
        ipAddress,
        userAgent,
        severity: 'warning',
        details: {
          reason: validation.reason
        }
      });

      return res.status(400).json({
        success: false,
        error: validation.reason
      });
    }

    // Audit log - valid token
    await auditService.logEvent({
      eventType: 'PASSWORD_RESET_TOKEN_VALIDATED',
      eventCategory: 'security',
      userId: validation.userId,
      ipAddress,
      userAgent,
      severity: 'info'
    });

    res.json({
      success: true,
      data: {
        email: validation.email
      }
    });
  } catch (error) {
    console.error('Validate reset token error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate token'
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using a valid token
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Token and new password are required'
      });
    }

    const ipAddress = sessionService.getClientIP(req);
    const userAgent = sessionService.getUserAgent(req);

    // Validate token
    const validation = await passwordResetService.validateResetToken(token);

    if (!validation.valid) {
      // Audit log - invalid token
      await auditService.logEvent({
        eventType: 'PASSWORD_RESET_FAILED',
        eventCategory: 'security',
        userId: null,
        ipAddress,
        userAgent,
        severity: 'warning',
        details: {
          reason: validation.reason
        }
      });

      return res.status(400).json({
        success: false,
        error: validation.reason
      });
    }

    // Validate password strength
    console.log('🔍 Validating password strength...');
    const passwordValidation = authService.validatePassword(newPassword);
    console.log('🔍 Password validation result:', passwordValidation);

    if (!passwordValidation.valid) {
      console.log('❌ Password validation failed:', passwordValidation.errors);
      return res.status(400).json({
        success: false,
        error: passwordValidation.errors.join(', ')
      });
    }

    // Update password
    console.log('🔍 Updating password for user:', validation.userId);
    await authService.updatePassword(validation.userId, newPassword);
    console.log('✅ Password updated successfully');

    // Mark token as used
    console.log('🔍 Marking token as used:', validation.tokenId);
    await passwordResetService.markTokenAsUsed(validation.tokenId);
    console.log('✅ Token marked as used');

    // Invalidate all user sessions (force re-login)
    console.log('🔍 Destroying all user sessions...');
    await sessionService.destroyAllUserSessions(validation.userId, 'password_reset');
    console.log('✅ All sessions destroyed');

    // Send confirmation email
    try {
      await emailService.sendPasswordChangedConfirmation(validation.email);
    } catch (emailError) {
      console.error('Failed to send password changed confirmation:', emailError);
      // Don't fail the request if confirmation email fails
    }

    // Audit log - password changed
    await auditService.logEvent({
      eventType: 'PASSWORD_RESET_COMPLETED',
      eventCategory: 'security',
      userId: validation.userId,
      ipAddress,
      userAgent,
      severity: 'info'
    });

    res.json({
      success: true,
      message: 'Password reset successfully. Please log in with your new password.'
    });
  } catch (error) {
    console.error('❌ Reset password error:', error);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password. Please try again.'
    });
  }
});

module.exports = router;
