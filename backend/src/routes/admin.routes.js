const express = require('express');
const router = express.Router();
const dbService = require('../services/db.service');

/**
 * Admin Routes for Access Control Management
 *
 * These endpoints provide instant revocation capabilities for the admin panel.
 * All actions are logged for HIPAA compliance audit trails.
 *
 * NOTE: Add authentication middleware to verify admin role before deploying!
 * Example: router.use(requireAuth, requireAdmin);
 */

// =============================================
// User Access Control
// =============================================

/**
 * POST /api/admin/users/:userId/revoke
 * Revoke all file access for a user (instant global revocation)
 */
router.post('/users/:userId/revoke', async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminUserId = req.body.adminUserId || req.headers['x-admin-user-id'];
    const adminUsername = req.body.adminUsername || req.user?.username || 'admin';

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Revocation reason is required',
      });
    }

    // Revoke user access
    await dbService.revokeUserAccess(userId, adminUserId, reason);

    // Log admin action
    await dbService.logAdminAction({
      adminUserId,
      adminUsername,
      action: 'revoke_user_access',
      actionDescription: 'Globally revoked all file access for user',
      targetUserId: userId,
      reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    console.log(`✓ Admin ${adminUsername} revoked access for user ${userId}: ${reason}`);

    res.json({
      success: true,
      message: 'User access revoked successfully',
      data: {
        userId,
        revokedAt: new Date(),
        reason,
        effect: 'immediate',
      },
    });
  } catch (error) {
    console.error('Error revoking user access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke user access',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/users/:userId/restore
 * Restore all file access for a user
 */
router.post('/users/:userId/restore', async (req, res) => {
  try {
    const { userId } = req.params;
    const adminUserId = req.body.adminUserId || req.headers['x-admin-user-id'];
    const adminUsername = req.body.adminUsername || req.user?.username || 'admin';

    // Restore user access
    await dbService.restoreUserAccess(userId, adminUserId);

    // Log admin action
    await dbService.logAdminAction({
      adminUserId,
      adminUsername,
      action: 'restore_user_access',
      actionDescription: 'Restored global file access for user',
      targetUserId: userId,
      reason: 'Access restored by admin',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    console.log(`✓ Admin ${adminUsername} restored access for user ${userId}`);

    res.json({
      success: true,
      message: 'User access restored successfully',
      data: {
        userId,
        restoredAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error restoring user access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restore user access',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/users/:userId/access-status
 * Get user's access status and revocation details
 */
router.get('/users/:userId/access-status', async (req, res) => {
  try {
    const { userId } = req.params;

    const accessStatus = await dbService.getUserAccessStatus(userId);

    if (!accessStatus) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    res.json({
      success: true,
      data: accessStatus,
    });
  } catch (error) {
    console.error('Error fetching user access status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user access status',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/users/revoked
 * Get all users with revoked access
 */
router.get('/users/revoked', async (req, res) => {
  try {
    const revokedUsers = await dbService.getRevokedUsers();

    res.json({
      success: true,
      data: {
        users: revokedUsers,
        count: revokedUsers.length,
      },
    });
  } catch (error) {
    console.error('Error fetching revoked users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch revoked users',
      message: error.message,
    });
  }
});

// =============================================
// File-Specific Access Control
// =============================================

/**
 * POST /api/admin/files/revoke
 * Revoke access to a specific file/task
 */
router.post('/files/revoke', async (req, res) => {
  try {
    const { userId, taskId, reason, temporary, expiresAt } = req.body;
    const adminUserId = req.body.adminUserId || req.headers['x-admin-user-id'];
    const adminUsername = req.body.adminUsername || req.user?.username || 'admin';

    if (!userId || !taskId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'userId, taskId, and reason are required',
      });
    }

    // Revoke file access
    await dbService.revokeFileAccess(
      userId,
      taskId,
      adminUserId,
      reason,
      temporary || false,
      expiresAt || null
    );

    // Log admin action
    await dbService.logAdminAction({
      adminUserId,
      adminUsername,
      action: 'revoke_file_access',
      actionDescription: `Revoked access to specific file (${temporary ? 'temporary' : 'permanent'})`,
      targetUserId: userId,
      targetTaskId: taskId,
      reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { temporary, expiresAt },
    });

    console.log(`✓ Admin ${adminUsername} revoked file access for user ${userId}, task ${taskId}: ${reason}`);

    res.json({
      success: true,
      message: 'File access revoked successfully',
      data: {
        userId,
        taskId,
        revokedAt: new Date(),
        reason,
        temporary: temporary || false,
        expiresAt: expiresAt || null,
        effect: 'immediate',
      },
    });
  } catch (error) {
    console.error('Error revoking file access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to revoke file access',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/files/restore
 * Restore access to a specific file/task
 */
router.post('/files/restore', async (req, res) => {
  try {
    const { userId, taskId } = req.body;
    const adminUserId = req.body.adminUserId || req.headers['x-admin-user-id'];
    const adminUsername = req.body.adminUsername || req.user?.username || 'admin';

    if (!userId || !taskId) {
      return res.status(400).json({
        success: false,
        error: 'userId and taskId are required',
      });
    }

    // Restore file access
    await dbService.restoreFileAccess(userId, taskId, adminUserId);

    // Log admin action
    await dbService.logAdminAction({
      adminUserId,
      adminUsername,
      action: 'restore_file_access',
      actionDescription: 'Restored access to specific file',
      targetUserId: userId,
      targetTaskId: taskId,
      reason: 'Access restored by admin',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    console.log(`✓ Admin ${adminUsername} restored file access for user ${userId}, task ${taskId}`);

    res.json({
      success: true,
      message: 'File access restored successfully',
      data: {
        userId,
        taskId,
        restoredAt: new Date(),
      },
    });
  } catch (error) {
    console.error('Error restoring file access:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restore file access',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/users/:userId/file-access-controls
 * Get all file-specific access controls for a user
 */
router.get('/users/:userId/file-access-controls', async (req, res) => {
  try {
    const { userId } = req.params;

    const accessControls = await dbService.getUserFileAccessControls(userId);

    res.json({
      success: true,
      data: {
        userId,
        controls: accessControls,
        count: accessControls.length,
      },
    });
  } catch (error) {
    console.error('Error fetching file access controls:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch file access controls',
      message: error.message,
    });
  }
});

// =============================================
// Audit Logs & Monitoring
// =============================================

/**
 * GET /api/admin/audit/file-access
 * Get file access audit logs
 */
router.get('/audit/file-access', async (req, res) => {
  try {
    const userId = req.query.userId;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    let logs;
    if (userId) {
      logs = await dbService.getUserFileAccessLogs(userId, limit, offset);
    } else {
      // Get all access logs (admin view)
      const query = `
        SELECT * FROM file_access_log
        ORDER BY accessed_at DESC
        LIMIT $1 OFFSET $2;
      `;
      const result = await dbService.pool.query(query, [limit, offset]);
      logs = result.rows;
    }

    res.json({
      success: true,
      data: {
        logs,
        count: logs.length,
        pagination: {
          limit,
          offset,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching file access logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch file access logs',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/audit/access-denials
 * Get recent access denial attempts (security monitoring)
 */
router.get('/audit/access-denials', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    const denials = await dbService.getRecentAccessDenials(limit);

    res.json({
      success: true,
      data: {
        denials,
        count: denials.length,
      },
    });
  } catch (error) {
    console.error('Error fetching access denials:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch access denials',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/audit/admin-actions
 * Get admin action audit logs
 */
router.get('/audit/admin-actions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const logs = await dbService.getAdminActionLogs(limit, offset);

    res.json({
      success: true,
      data: {
        logs,
        count: logs.length,
        pagination: {
          limit,
          offset,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching admin action logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin action logs',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/audit/admin-actions/summary
 * Get summary of admin actions
 */
router.get('/audit/admin-actions/summary', async (req, res) => {
  try {
    const summary = await dbService.getAdminActionsSummary();

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Error fetching admin actions summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch admin actions summary',
      message: error.message,
    });
  }
});

/**
 * GET /api/admin/stats/user-access/:userId
 * Get file access statistics for a user
 */
router.get('/stats/user-access/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const stats = await dbService.getUserFileAccessStats(userId);

    if (!stats) {
      return res.status(404).json({
        success: false,
        error: 'User not found or no access data',
      });
    }

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching user access stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user access stats',
      message: error.message,
    });
  }
});

// =============================================
// Bulk Operations (for admin efficiency)
// =============================================

/**
 * POST /api/admin/bulk/revoke-users
 * Revoke access for multiple users at once
 */
router.post('/bulk/revoke-users', async (req, res) => {
  try {
    const { userIds, reason } = req.body;
    const adminUserId = req.body.adminUserId || req.headers['x-admin-user-id'];
    const adminUsername = req.body.adminUsername || req.user?.username || 'admin';

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'userIds array is required',
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Revocation reason is required',
      });
    }

    const results = [];
    const errors = [];

    for (const userId of userIds) {
      try {
        await dbService.revokeUserAccess(userId, adminUserId, reason);
        results.push({ userId, success: true });
      } catch (error) {
        errors.push({ userId, error: error.message });
      }
    }

    // Log bulk action
    await dbService.logAdminAction({
      adminUserId,
      adminUsername,
      action: 'revoke_user_access',
      actionDescription: `Bulk revoked access for ${results.length} users`,
      reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { userIds, successCount: results.length, errorCount: errors.length },
    });

    console.log(`✓ Admin ${adminUsername} bulk revoked access for ${results.length} users`);

    res.json({
      success: true,
      message: `Revoked access for ${results.length} users`,
      data: {
        successful: results,
        failed: errors,
        totalProcessed: userIds.length,
      },
    });
  } catch (error) {
    console.error('Error in bulk revoke:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk revoke user access',
      message: error.message,
    });
  }
});

module.exports = router;
