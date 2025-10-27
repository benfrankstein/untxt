/**
 * Session Tracking Service
 * HIPAA/GDPR Compliant Session Management
 *
 * Tracks:
 * - Session creation/destruction
 * - IP addresses (for security monitoring)
 * - User agents (device/browser info)
 * - Last activity timestamps
 * - Session expiration
 */

const { v4: uuidv4 } = require('uuid');
const dbService = require('./db.service');
const auditService = require('./audit.service');

/**
 * Create a new session record
 * @param {Object} sessionData - {userId, sessionToken, ipAddress, userAgent, expiresAt}
 * @returns {Promise<Object>} - Session record
 */
async function createSession(sessionData) {
  const {
    userId,
    sessionToken,
    ipAddress,
    userAgent,
    expiresAt
  } = sessionData;

  try {
    const session = await dbService.createSession({
      id: uuidv4(),
      userId,
      sessionToken,
      ipAddress,
      userAgent,
      expiresAt
    });

    console.log(`✓ Session created for user ${userId} from ${ipAddress}`);
    return session;
  } catch (error) {
    console.error('Error creating session:', error);
    throw error;
  }
}

/**
 * Update session last activity timestamp
 * @param {string} sessionToken - Session token
 * @returns {Promise<void>}
 */
async function updateSessionActivity(sessionToken) {
  try {
    await dbService.updateSessionActivity(sessionToken);
  } catch (error) {
    console.error('Error updating session activity:', error);
  }
}

/**
 * Get session by token
 * @param {string} sessionToken - Session token
 * @returns {Promise<Object|null>} - Session record
 */
async function getSessionByToken(sessionToken) {
  try {
    return await dbService.getSessionByToken(sessionToken);
  } catch (error) {
    console.error('Error getting session:', error);
    return null;
  }
}

/**
 * Get all active sessions for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} - Array of session records
 */
async function getUserSessions(userId) {
  try {
    return await dbService.getUserSessions(userId);
  } catch (error) {
    console.error('Error getting user sessions:', error);
    return [];
  }
}

/**
 * Destroy a session
 * @param {string} sessionToken - Session token
 * @param {string} reason - Reason for destruction (logout, timeout, etc.)
 * @returns {Promise<void>}
 */
async function destroySession(sessionToken, reason = 'logout') {
  try {
    const session = await dbService.getSessionByToken(sessionToken);

    if (session) {
      await dbService.deleteSession(sessionToken);
      console.log(`✓ Session destroyed for user ${session.user_id}: ${reason}`);
    }
  } catch (error) {
    console.error('Error destroying session:', error);
  }
}

/**
 * Destroy all sessions for a user
 * @param {string} userId - User ID
 * @param {string} reason - Reason for destruction
 * @returns {Promise<number>} - Number of sessions destroyed
 */
async function destroyAllUserSessions(userId, reason = 'logout_all') {
  try {
    const count = await dbService.deleteAllUserSessions(userId);
    console.log(`✓ Destroyed ${count} sessions for user ${userId}: ${reason}`);
    return count;
  } catch (error) {
    console.error('Error destroying user sessions:', error);
    return 0;
  }
}

/**
 * Clean up expired sessions (run periodically)
 * Logs each expired session to audit_logs for HIPAA compliance
 * @returns {Promise<number>} - Number of sessions cleaned up
 */
async function cleanupExpiredSessions() {
  try {
    const expiredSessions = await dbService.deleteExpiredSessions();

    if (expiredSessions.length > 0) {
      // Log each expired session to audit_logs for HIPAA compliance
      for (const session of expiredSessions) {
        await auditService.logSessionTimeout(
          session.user_id,
          session.session_token
        );
      }

      console.log(`✓ Cleaned up ${expiredSessions.length} expired sessions (logged to audit_logs)`);
    }

    return expiredSessions.length;
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error);
    return 0;
  }
}

/**
 * Get session statistics for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - Session statistics
 */
async function getUserSessionStats(userId) {
  try {
    const sessions = await getUserSessions(userId);

    return {
      totalActiveSessions: sessions.length,
      sessions: sessions.map(s => ({
        id: s.id,
        ipAddress: s.ip_address,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        lastActivity: s.last_activity,
        expiresAt: s.expires_at
      }))
    };
  } catch (error) {
    console.error('Error getting session stats:', error);
    return {
      totalActiveSessions: 0,
      sessions: []
    };
  }
}

/**
 * Extract client IP address from request
 * Handles proxies (X-Forwarded-For) and direct connections
 * @param {Object} req - Express request object
 * @returns {string} - IP address
 */
function getClientIP(req) {
  // Check X-Forwarded-For header (if behind proxy/load balancer)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs, first one is client
    return forwardedFor.split(',')[0].trim();
  }

  // Check X-Real-IP header (nginx)
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }

  // Fallback to connection remote address
  return req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.ip ||
         'unknown';
}

/**
 * Extract user agent from request
 * @param {Object} req - Express request object
 * @returns {string} - User agent string
 */
function getUserAgent(req) {
  return req.headers['user-agent'] || 'unknown';
}

/**
 * Parse user agent to extract device/browser info
 * @param {string} userAgent - User agent string
 * @returns {Object} - Parsed user agent info
 */
function parseUserAgent(userAgent) {
  // Simple parsing (can use library like 'ua-parser-js' for more detail)
  const info = {
    browser: 'Unknown',
    os: 'Unknown',
    device: 'Unknown'
  };

  if (!userAgent || userAgent === 'unknown') {
    return info;
  }

  // Detect browser
  if (userAgent.includes('Chrome')) info.browser = 'Chrome';
  else if (userAgent.includes('Firefox')) info.browser = 'Firefox';
  else if (userAgent.includes('Safari')) info.browser = 'Safari';
  else if (userAgent.includes('Edge')) info.browser = 'Edge';

  // Detect OS
  if (userAgent.includes('Windows')) info.os = 'Windows';
  else if (userAgent.includes('Mac OS X')) info.os = 'macOS';
  else if (userAgent.includes('Linux')) info.os = 'Linux';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) info.os = 'iOS';
  else if (userAgent.includes('Android')) info.os = 'Android';

  // Detect device type
  if (userAgent.includes('Mobile') || userAgent.includes('iPhone') || userAgent.includes('Android')) {
    info.device = 'Mobile';
  } else if (userAgent.includes('iPad') || userAgent.includes('Tablet')) {
    info.device = 'Tablet';
  } else {
    info.device = 'Desktop';
  }

  return info;
}

module.exports = {
  createSession,
  updateSessionActivity,
  getSessionByToken,
  getUserSessions,
  destroySession,
  destroyAllUserSessions,
  cleanupExpiredSessions,
  getUserSessionStats,
  getClientIP,
  getUserAgent,
  parseUserAgent
};
