/**
 * Audit Logging Service
 * HIPAA/GDPR Compliant Audit Trail
 *
 * Tracks:
 * - Authentication events (login, logout, failed attempts)
 * - Session events (creation, destruction, timeout)
 * - Security events (account lockout, password changes)
 * - Access events (who accessed what and when)
 */

const { v4: uuidv4 } = require('uuid');
const dbService = require('./db.service');

/**
 * Log an audit event
 * @param {Object} eventData - {userId, eventType, eventCategory, details, ipAddress, userAgent}
 * @returns {Promise<Object>} - Audit log record
 */
async function logEvent(eventData) {
  const {
    userId = null,
    eventType,
    eventCategory,
    details = {},
    ipAddress = null,
    userAgent = null,
    severity = 'info'
  } = eventData;

  try {
    const auditLog = await dbService.createAuditLog({
      id: uuidv4(),
      userId,
      eventType,
      eventCategory,
      details: JSON.stringify(details),
      ipAddress,
      userAgent,
      severity
    });

    // Log to console for monitoring
    const logPrefix = {
      'info': '→',
      'warning': '⚠',
      'error': '✗',
      'critical': '🚨'
    }[severity] || '→';

    console.log(`${logPrefix} AUDIT [${eventCategory}/${eventType}] User: ${userId || 'anonymous'} | ${JSON.stringify(details)}`);

    return auditLog;
  } catch (error) {
    // Audit logging should never fail the main operation
    console.error('Failed to create audit log:', error);
    return null;
  }
}

/**
 * Log authentication success
 */
async function logAuthSuccess(userId, ipAddress, userAgent, method = 'password') {
  return logEvent({
    userId,
    eventType: 'login_success',
    eventCategory: 'authentication',
    details: { method },
    ipAddress,
    userAgent,
    severity: 'info'
  });
}

/**
 * Log authentication failure
 */
async function logAuthFailure(emailOrUsername, reason, ipAddress, userAgent) {
  return logEvent({
    userId: null, // Don't reveal if user exists
    eventType: 'login_failure',
    eventCategory: 'authentication',
    details: {
      identifier: emailOrUsername,
      reason
    },
    ipAddress,
    userAgent,
    severity: 'warning'
  });
}

/**
 * Log logout
 */
async function logLogout(userId, ipAddress, userAgent, reason = 'user_initiated') {
  return logEvent({
    userId,
    eventType: 'logout',
    eventCategory: 'authentication',
    details: { reason },
    ipAddress,
    userAgent,
    severity: 'info'
  });
}

/**
 * Log session creation
 */
async function logSessionCreated(userId, sessionId, ipAddress, userAgent) {
  return logEvent({
    userId,
    eventType: 'session_created',
    eventCategory: 'session',
    details: { sessionId },
    ipAddress,
    userAgent,
    severity: 'info'
  });
}

/**
 * Log session destroyed
 */
async function logSessionDestroyed(userId, sessionId, reason, ipAddress = null, userAgent = null) {
  return logEvent({
    userId,
    eventType: 'session_destroyed',
    eventCategory: 'session',
    details: { sessionId, reason },
    ipAddress,
    userAgent,
    severity: 'info'
  });
}

/**
 * Log session timeout
 */
async function logSessionTimeout(userId, sessionId) {
  return logEvent({
    userId,
    eventType: 'session_timeout',
    eventCategory: 'session',
    details: { sessionId },
    severity: 'info'
  });
}

/**
 * Log account creation
 */
async function logAccountCreated(userId, email, ipAddress, userAgent) {
  return logEvent({
    userId,
    eventType: 'account_created',
    eventCategory: 'account',
    details: { email },
    ipAddress,
    userAgent,
    severity: 'info'
  });
}

/**
 * Log password change
 */
async function logPasswordChange(userId, ipAddress, userAgent, reason = 'user_requested') {
  return logEvent({
    userId,
    eventType: 'password_changed',
    eventCategory: 'security',
    details: { reason },
    ipAddress,
    userAgent,
    severity: 'info'
  });
}

/**
 * Log account lockout
 */
async function logAccountLockout(userId, reason, ipAddress, userAgent) {
  return logEvent({
    userId,
    eventType: 'account_locked',
    eventCategory: 'security',
    details: { reason },
    ipAddress,
    userAgent,
    severity: 'warning'
  });
}

/**
 * Log suspicious activity
 */
async function logSuspiciousActivity(userId, activityType, details, ipAddress, userAgent) {
  return logEvent({
    userId,
    eventType: 'suspicious_activity',
    eventCategory: 'security',
    details: {
      activityType,
      ...details
    },
    ipAddress,
    userAgent,
    severity: 'critical'
  });
}

/**
 * Log file access
 */
async function logFileAccess(userId, fileId, action, ipAddress, userAgent) {
  return logEvent({
    userId,
    eventType: 'file_access',
    eventCategory: 'data_access',
    details: {
      fileId,
      action
    },
    ipAddress,
    userAgent,
    severity: 'info'
  });
}

/**
 * Get audit logs for a user
 * @param {string} userId - User ID
 * @param {Object} options - {limit, offset, eventCategory, eventType}
 * @returns {Promise<Array>} - Audit log records
 */
async function getUserAuditLogs(userId, options = {}) {
  try {
    return await dbService.getUserAuditLogs(userId, options);
  } catch (error) {
    console.error('Error getting audit logs:', error);
    return [];
  }
}

/**
 * Get recent audit logs
 * @param {Object} options - {limit, offset, severity}
 * @returns {Promise<Array>} - Audit log records
 */
async function getRecentAuditLogs(options = {}) {
  try {
    return await dbService.getRecentAuditLogs(options);
  } catch (error) {
    console.error('Error getting recent audit logs:', error);
    return [];
  }
}

module.exports = {
  logEvent,
  logAuthSuccess,
  logAuthFailure,
  logLogout,
  logSessionCreated,
  logSessionDestroyed,
  logSessionTimeout,
  logAccountCreated,
  logPasswordChange,
  logAccountLockout,
  logSuspiciousActivity,
  logFileAccess,
  getUserAuditLogs,
  getRecentAuditLogs
};
