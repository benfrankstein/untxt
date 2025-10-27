const express = require('express');
const router = express.Router();
const db = require('../services/db.service');
const { requireAuth } = require('../middleware/auth.middleware');

// =============================================
// FOLDER CRUD OPERATIONS
// =============================================

/**
 * GET /api/folders
 * Get all folders for current user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const includeArchived = req.query.includeArchived === 'true';

    const folders = await db.getUserFolders(userId, includeArchived);

    res.json({ success: true, folders });
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch folders' });
  }
});

/**
 * POST /api/folders
 * Create new folder
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { name, description, color } = req.body;

    // Validation
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Folder name is required' });
    }

    if (name.trim().length > 255) {
      return res.status(400).json({ success: false, error: 'Folder name too long (max 255 characters)' });
    }

    // Create folder
    const folder = await db.createFolder({
      userId,
      name: name.trim(),
      description: description?.trim() || null,
      color: color || '#c7ff00'
    });

    // HIPAA audit log
    await db.logFolderAction({
      folderId: folder.id,
      userId,
      action: 'folder_created',
      details: {
        name: folder.name,
        description: folder.description,
        color: folder.color
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    console.log(`✓ Folder created: "${folder.name}" by user ${userId}`);

    res.json({ success: true, folder });
  } catch (error) {
    console.error('Error creating folder:', error);

    // Handle unique constraint violation
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A folder with this name already exists'
      });
    }

    res.status(500).json({ success: false, error: 'Failed to create folder' });
  }
});

/**
 * PUT /api/folders/:folderId
 * Update folder
 */
router.put('/:folderId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { folderId } = req.params;
    const { name, description, color, isArchived } = req.body;

    // Check permission (user must own folder)
    const folder = await db.getFolderById(folderId);
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }

    if (folder.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Validate name if provided
    if (name !== undefined && name.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Folder name cannot be empty' });
    }

    if (name !== undefined && name.trim().length > 255) {
      return res.status(400).json({ success: false, error: 'Folder name too long (max 255 characters)' });
    }

    // Store old values for audit
    const oldValues = {
      name: folder.name,
      description: folder.description,
      color: folder.color,
      is_archived: folder.is_archived
    };

    // Update folder
    const updatedFolder = await db.updateFolder(folderId, {
      name: name?.trim(),
      description: description?.trim(),
      color,
      isArchived
    });

    // HIPAA audit log
    await db.logFolderAction({
      folderId,
      userId,
      action: 'folder_updated',
      details: {
        oldValues,
        newValues: { name, description, color, isArchived }
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    console.log(`✓ Folder updated: "${updatedFolder.name}" (${folderId})`);

    res.json({ success: true, folder: updatedFolder });
  } catch (error) {
    console.error('Error updating folder:', error);

    // Handle unique constraint violation
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A folder with this name already exists'
      });
    }

    res.status(500).json({ success: false, error: 'Failed to update folder' });
  }
});

/**
 * DELETE /api/folders/:folderId
 * Delete folder (tasks will be moved to "All Documents")
 */
router.delete('/:folderId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { folderId } = req.params;

    // Check permission
    const folder = await db.getFolderById(folderId);
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }

    if (folder.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Delete folder (trigger will log to audit)
    await db.deleteFolder(folderId);

    // Additional manual audit log
    await db.logFolderAction({
      folderId,
      userId,
      action: 'folder_deleted',
      details: {
        name: folder.name,
        task_count: parseInt(folder.task_count) || 0
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    console.log(`✓ Folder deleted: "${folder.name}" (${folderId}) with ${folder.task_count} tasks`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting folder:', error);
    res.status(500).json({ success: false, error: 'Failed to delete folder' });
  }
});

// =============================================
// FOLDER TASK MANAGEMENT
// =============================================

/**
 * GET /api/folders/:folderId/tasks
 * Get all tasks in a folder
 */
router.get('/:folderId/tasks', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { folderId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Verify ownership
    const folder = await db.getFolderById(folderId);
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }

    if (folder.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const tasks = await db.getFolderTasks(folderId, userId, limit, offset);

    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Error fetching folder tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks' });
  }
});

/**
 * POST /api/folders/:folderId/tasks/:taskId
 * Move task to folder
 */
router.post('/:folderId/tasks/:taskId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { folderId, taskId } = req.params;

    // Verify folder ownership
    const folder = await db.getFolderById(folderId);
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }

    if (folder.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied to folder' });
    }

    // Verify task ownership
    const task = await db.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    if (task.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied to task' });
    }

    const oldFolderId = task.folder_id;

    // Move task
    const updatedTask = await db.moveTaskToFolder(taskId, folderId, userId);

    // HIPAA audit log - task moved IN
    await db.logFolderAction({
      folderId,
      userId,
      action: 'task_moved_in',
      details: {
        taskId,
        filename: task.filename,
        oldFolderId
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    // HIPAA audit log - task moved OUT (if it was in another folder)
    if (oldFolderId) {
      await db.logFolderAction({
        folderId: oldFolderId,
        userId,
        action: 'task_moved_out',
        details: {
          taskId,
          filename: task.filename,
          newFolderId: folderId
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
    }

    console.log(`✓ Task "${task.filename}" moved to folder "${folder.name}"`);

    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error('Error moving task to folder:', error);
    res.status(500).json({ success: false, error: 'Failed to move task' });
  }
});

/**
 * DELETE /api/folders/:folderId/tasks/:taskId
 * Remove task from folder (set folder_id to NULL)
 */
router.delete('/:folderId/tasks/:taskId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { folderId, taskId } = req.params;

    // Verify task ownership
    const task = await db.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    if (task.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Remove from folder (set to NULL)
    const updatedTask = await db.moveTaskToFolder(taskId, null, userId);

    // HIPAA audit log
    await db.logFolderAction({
      folderId,
      userId,
      action: 'task_removed',
      details: {
        taskId,
        filename: task.filename
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    console.log(`✓ Task "${task.filename}" removed from folder`);

    res.json({ success: true, task: updatedTask });
  } catch (error) {
    console.error('Error removing task from folder:', error);
    res.status(500).json({ success: false, error: 'Failed to remove task' });
  }
});

// =============================================
// AUDIT LOGS
// =============================================

/**
 * GET /api/folders/:folderId/audit
 * Get folder audit logs (HIPAA compliance)
 */
router.get('/:folderId/audit', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { folderId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    // Verify ownership
    const folder = await db.getFolderById(folderId);
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Folder not found' });
    }

    if (folder.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const logs = await db.getFolderAuditLogs(folderId, limit, offset);

    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching folder audit logs:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
