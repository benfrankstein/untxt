const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const s3Service = require('../services/s3.service');
const dbService = require('../services/db.service');
const pdfService = require('../services/pdf.service');

// IMPORTANT: Specific routes must come BEFORE parameterized routes
// Otherwise /:taskId/:versionNumber will match /:taskId/permissions, etc.

/**
 * GET /api/versions/:taskId/permissions
 * Get edit permissions for a task
 */
router.get('/:taskId/permissions', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'];

    // Check if user can edit
    const editCheck = await dbService.canUserEditDocument(taskId, userId);

    res.json({
      success: true,
      data: {
        canEdit: editCheck.canEdit,
        reason: editCheck.reason,
      },
    });
  } catch (error) {
    console.error('Error checking permissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check permissions',
      message: error.message,
    });
  }
});

// =====================================================
// GOOGLE DOCS FLOW: New Auto-Save Endpoints
// =====================================================

/**
 * POST /api/versions/:taskId/save
 * Auto-save endpoint (replaces draft endpoint)
 * - Creates new version if > 5 minutes since last snapshot
 * - Updates existing version if < 5 minutes (no new row)
 * - Stores HTML in database only (no S3 upload during editing)
 */
router.post('/:taskId/save', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { htmlContent, sessionId, editReason } = req.body;
    const userId = req.headers['x-user-id'];

    // Validate
    if (!htmlContent || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'htmlContent and sessionId are required'
      });
    }

    // Get task info
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Check edit permission
    const editCheck = await dbService.canUserEditDocument(taskId, userId);
    if (!editCheck.canEdit) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to edit this document',
        reason: editCheck.reason
      });
    }

    // Calculate metrics
    const characterCount = htmlContent.length;
    const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

    // Check if we should create new version or update existing
    const recentVersion = await dbService.getLatestVersionForSession(sessionId);
    const now = Date.now();
    const timeSinceLastSave = recentVersion
      ? now - new Date(recentVersion.created_at).getTime()
      : Infinity;

    // Snapshot logic: Create new version if > 5 minutes OR no recent version
    const shouldCreateNewVersion = !recentVersion || timeSinceLastSave > 5 * 60 * 1000;

    if (shouldCreateNewVersion) {
      // CREATE NEW VERSION (snapshot)
      const version = await dbService.createVersion({
        taskId,
        fileId: task.file_id,
        userId,
        htmlContent,       // Store in database
        s3Key: null,       // No S3 upload during editing
        characterCount,
        wordCount,
        editReason: editReason || 'Auto-save snapshot',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId
      });

      // Increment session counter
      await dbService.incrementSessionVersions(sessionId);

      res.json({
        success: true,
        version: {
          id: version.id,
          version_number: version.version_number,
          created_at: version.created_at,
          snapshot: true
        }
      });

      console.log(`💾 Created snapshot v${version.version_number} for session ${sessionId}`);
    } else {
      // UPDATE EXISTING VERSION (< 5 minutes)
      const updated = await dbService.updateVersion(recentVersion.id, {
        htmlContent,
        characterCount,
        wordCount
      });

      res.json({
        success: true,
        version: {
          id: updated.id,
          version_number: updated.version_number,
          updated_at: updated.edited_at,
          snapshot: false
        }
      });

      console.log(`💾 Updated v${recentVersion.version_number} for session ${sessionId}`);
    }
  } catch (error) {
    console.error('Error saving version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save version',
      message: error.message
    });
  }
});

/**
 * GET /api/versions/:taskId/latest
 * Get latest version for a task
 * - Checks html_content first (database, fast)
 * - Falls back to S3 if not in database
 */
router.get('/:taskId/latest', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.headers['x-user-id'];

    // Verify task ownership
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    if (task.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task'
      });
    }

    // Get latest version
    const version = await dbService.getLatestVersion(taskId);
    if (!version) {
      return res.status(404).json({
        success: false,
        error: 'No version found'
      });
    }

    let htmlContent;
    let source;

    // Try database first (fast!)
    if (version.html_content) {
      htmlContent = version.html_content;
      source = 'database';
      console.log(`📖 Loaded v${version.version_number} from database (3ms)`);
    } else if (version.s3_key) {
      // Fall back to S3
      const fileData = await s3Service.streamFileDownload(version.s3_key);
      const chunks = [];
      for await (const chunk of fileData.stream) {
        chunks.push(chunk);
      }
      htmlContent = Buffer.concat(chunks).toString('utf-8');
      source = 's3';
      console.log(`📖 Loaded v${version.version_number} from S3 (80ms)`);
    } else {
      return res.status(404).json({
        success: false,
        error: 'Version content not found'
      });
    }

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Version-Number': version.version_number,
      'X-Version-Id': version.id,
      'X-Content-Source': source,
      'Cache-Control': 'no-cache'
    });
    res.send(htmlContent);
  } catch (error) {
    console.error('Error fetching latest version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch latest version',
      message: error.message
    });
  }
});

/**
 * GET /api/versions/:taskId/logs
 * Get edit logs for a task
 */
router.get('/:taskId/logs', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'];
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Verify task ownership or admin
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    if (task.user_id !== userId) {
      // Check if user is admin
      const user = await dbService.getUserById(userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized to access logs',
        });
      }
    }

    // Get logs
    const logs = await dbService.getDocumentEditLogs(taskId, limit, offset);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          limit,
          offset,
          total: logs.length,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching edit logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch edit logs',
      message: error.message,
    });
  }
});

/**
 * GET /api/versions/:taskId/draft
 * Get user's active draft for a task
 */
router.get('/:taskId/draft', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'];

    // Verify task ownership
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    if (task.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task',
      });
    }

    // Get draft
    const draft = await dbService.getUserDraft(taskId, userId);

    if (!draft) {
      return res.status(404).json({
        success: false,
        error: 'No draft found',
      });
    }

    // Download HTML from S3
    const fileData = await s3Service.streamFileDownload(draft.s3_key);
    const chunks = [];
    for await (const chunk of fileData.stream) {
      chunks.push(chunk);
    }
    const htmlContent = Buffer.concat(chunks).toString('utf-8');

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Draft-Id': draft.id,
      'X-Last-Autosaved': draft.last_autosaved_at,
      'Cache-Control': 'no-cache',
    });
    res.send(htmlContent);
  } catch (error) {
    console.error('Error fetching draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch draft',
      message: error.message,
    });
  }
});

/**
 * POST /api/versions/:taskId/draft
 * Create or update draft (auto-save)
 */
router.post('/:taskId/draft', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { htmlContent, editReason, sessionId } = req.body;
    const userId = req.body.userId || req.headers['x-user-id'];

    if (!htmlContent) {
      return res.status(400).json({
        success: false,
        error: 'HTML content is required',
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required',
      });
    }

    // Verify task exists
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    // Check edit permission
    const editCheck = await dbService.canUserEditDocument(taskId, userId);
    if (!editCheck.canEdit) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to edit this document',
        reason: editCheck.reason,
      });
    }

    // Calculate content metrics
    const characterCount = htmlContent.length;
    const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

    // Calculate checksum
    const contentChecksum = crypto
      .createHash('sha256')
      .update(htmlContent)
      .digest('hex');

    // Generate S3 key for draft
    const s3Key = `results/${task.user_id}/${task.file_id}/draft_${sessionId}.html`;

    // Upload to S3
    await s3Service.uploadFile(
      Buffer.from(htmlContent, 'utf-8'),
      s3Key,
      'text/html',
      {
        'user-id': userId,
        'file-id': task.file_id,
        'task-id': taskId,
        'is-draft': 'true',
        'session-id': sessionId,
        'autosaved-at': new Date().toISOString(),
      }
    );

    // Create or update draft record
    const draft = await dbService.createOrUpdateDraft({
      taskId,
      fileId: task.file_id,
      userId,
      s3Key,
      characterCount,
      wordCount,
      editReason: editReason || 'Auto-save draft',
      contentChecksum,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId,
    });

    // SESSION-BASED LOGGING: Create or update edit session (NOT per auto-save)
    const isFirstSave = !draft.last_autosaved_at;

    if (isFirstSave) {
      // First save - create new session
      await dbService.createOrGetEditSession({
        taskId,
        userId,
        username: task.username,
        sessionId,
        draftId: draft.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        accessReason: editCheck.reason,
      });

      console.log(`📝 Edit session started: ${sessionId}`);
    } else {
      // Auto-save - just update session metrics (no new log row!)
      await dbService.updateEditSessionAutoSave({
        sessionId,
        characterCount,
        wordCount,
      });

      console.log(`💾 Auto-save #${draft.autosave_count || 0} in session: ${sessionId}`);
    }

    res.status(200).json({
      success: true,
      data: {
        draft,
        message: 'Draft saved successfully',
      },
    });
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save draft',
      message: error.message,
    });
  }
});

/**
 * POST /api/versions/:taskId/publish
 * Publish draft as final version
 */
router.post('/:taskId/publish', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { editReason } = req.body;
    const userId = req.body.userId || req.headers['x-user-id'];

    // Get user's draft
    const draft = await dbService.getUserDraft(taskId, userId);
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: 'No draft found to publish',
      });
    }

    // Check edit permission
    const editCheck = await dbService.canUserEditDocument(taskId, userId);
    if (!editCheck.canEdit) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to publish this draft',
        reason: editCheck.reason,
      });
    }

    // Get task info
    const task = await dbService.getTaskById(taskId);

    // Publish the draft
    const publishedVersion = await dbService.publishDraft(draft.id, editReason);

    // Copy draft S3 file to versioned file
    const newS3Key = `results/${task.user_id}/${task.file_id}/v${publishedVersion.version_number}_edited.html`;

    // Download draft content
    const fileData = await s3Service.streamFileDownload(draft.s3_key);
    const chunks = [];
    for await (const chunk of fileData.stream) {
      chunks.push(chunk);
    }
    const htmlContent = Buffer.concat(chunks);

    // Upload as published version
    await s3Service.uploadFile(
      htmlContent,
      newS3Key,
      'text/html',
      {
        'user-id': userId,
        'file-id': task.file_id,
        'task-id': taskId,
        'version': publishedVersion.version_number.toString(),
        'edited-by': userId,
        'published-at': new Date().toISOString(),
      }
    );

    // Update S3 key in database
    await dbService.pool.query(
      'UPDATE document_versions SET s3_key = $1 WHERE id = $2',
      [newS3Key, publishedVersion.id]
    );

    // Also upload as latest.html
    const latestS3Key = `results/${task.user_id}/${task.file_id}/latest.html`;
    await s3Service.uploadFile(htmlContent, latestS3Key, 'text/html', {
      'user-id': userId,
      'file-id': task.file_id,
      'task-id': taskId,
      'version': 'latest',
    });

    // Delete draft S3 file
    await s3Service.permanentlyDeleteFile(draft.s3_key);

    // SESSION-BASED LOGGING: Close edit session with 'published' outcome
    if (draft.draft_session_id) {
      await dbService.closeEditSession({
        sessionId: draft.draft_session_id,
        outcome: 'published',
        publishedVersionId: publishedVersion.id
      });
      console.log(`✅ Edit session closed: ${draft.draft_session_id} (published as v${publishedVersion.version_number})`);
    }

    res.status(201).json({
      success: true,
      data: {
        version: publishedVersion,
        message: `Version ${publishedVersion.version_number} published successfully`,
      },
    });
  } catch (error) {
    console.error('Error publishing draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to publish draft',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/versions/:taskId/draft
 * Delete user's draft (cancel edit)
 */
router.delete('/:taskId/draft', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'];

    // Get user's draft
    const draft = await dbService.getUserDraft(taskId, userId);
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: 'No draft found',
      });
    }

    // Delete from S3
    await s3Service.permanentlyDeleteFile(draft.s3_key);

    // SESSION-BASED LOGGING: Close edit session with 'cancelled' outcome
    if (draft.draft_session_id) {
      await dbService.closeEditSession({
        sessionId: draft.draft_session_id,
        outcome: 'cancelled',
        publishedVersionId: null
      });
      console.log(`🚫 Edit session cancelled: ${draft.draft_session_id}`);
    }

    // Delete from database
    await dbService.deleteUserDraft(taskId, userId);

    res.json({
      success: true,
      message: 'Draft deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete draft',
      message: error.message,
    });
  }
});

/**
 * GET /api/versions/:taskId
 * Get all versions for a task
 */
router.get('/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'];

    // Verify task ownership
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    if (task.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task',
      });
    }

    // Get all versions
    const versions = await dbService.getDocumentVersions(taskId);

    res.json({
      success: true,
      data: {
        versions,
        total: versions.length,
      },
    });
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch versions',
      message: error.message,
    });
  }
});

/**
 * POST /api/versions/:taskId
 * Create new version (save edited HTML) - DEPRECATED: Use draft + publish flow instead
 */
router.post('/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'];

    // Verify task ownership
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    if (task.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task',
      });
    }

    // Get all versions
    const versions = await dbService.getDocumentVersions(taskId);

    res.json({
      success: true,
      data: {
        versions,
        total: versions.length,
      },
    });
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch versions',
      message: error.message,
    });
  }
});

/**
 * GET /api/versions/:taskId/:versionNumber
 * Get specific version content
 */
router.get('/:taskId/:versionNumber', async (req, res) => {
  try {
    const { taskId, versionNumber } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'];

    // Verify task ownership
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    if (task.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task',
      });
    }

    // Get version
    const version = await dbService.getDocumentVersion(taskId, parseInt(versionNumber));
    if (!version) {
      return res.status(404).json({
        success: false,
        error: 'Version not found',
      });
    }

    // Download HTML from S3
    const fileData = await s3Service.streamFileDownload(version.s3_key);
    const chunks = [];
    for await (const chunk of fileData.stream) {
      chunks.push(chunk);
    }
    const htmlContent = Buffer.concat(chunks).toString('utf-8');

    // Log access
    await dbService.logDocumentEdit({
      versionId: version.id,
      taskId,
      userId,
      username: req.user?.username || task.username,
      action: 'view_version',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      accessReason: task.user_id === userId ? 'owner' : 'admin',
    });

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Version-Number': version.version_number,
      'X-Version-Id': version.id,
      'Cache-Control': 'no-cache',
    });
    res.send(htmlContent);
  } catch (error) {
    console.error('Error fetching version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch version',
      message: error.message,
    });
  }
});

/**
 * POST /api/versions/:taskId
 * Create new version (save edited HTML)
 */
router.post('/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { htmlContent, editReason, editSummary } = req.body;
    const userId = req.body.userId || req.headers['x-user-id'];

    if (!htmlContent) {
      return res.status(400).json({
        success: false,
        error: 'HTML content is required',
      });
    }

    // Verify task exists
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    // Check edit permission
    const editCheck = await dbService.canUserEditDocument(taskId, userId);
    if (!editCheck.canEdit) {
      await dbService.logDocumentEdit({
        versionId: null,
        taskId,
        userId,
        username: req.user?.username || 'unknown',
        action: 'create_version',
        changesDescription: 'Permission denied',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        accessGranted: false,
        accessReason: editCheck.reason,
      });

      return res.status(403).json({
        success: false,
        error: 'You do not have permission to edit this document',
        reason: editCheck.reason,
      });
    }

    // Get next version number
    const versionNumber = await dbService.getNextVersionNumber(taskId);

    // Calculate content metrics
    const characterCount = htmlContent.length;
    const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

    // Calculate checksum
    const contentChecksum = crypto
      .createHash('sha256')
      .update(htmlContent)
      .digest('hex');

    // Generate S3 key
    const s3Key = `results/${task.user_id}/${task.file_id}/v${versionNumber}_edited.html`;

    // Upload to S3
    await s3Service.uploadFile(
      Buffer.from(htmlContent, 'utf-8'),
      s3Key,
      'text/html',
      {
        'user-id': userId,
        'file-id': task.file_id,
        'task-id': taskId,
        'version': versionNumber.toString(),
        'edited-by': userId,
        'edit-timestamp': new Date().toISOString(),
      }
    );

    // Create version record
    const version = await dbService.createDocumentVersion({
      taskId,
      fileId: task.file_id,
      versionNumber,
      s3Key,
      characterCount,
      wordCount,
      editedBy: userId,
      editReason: editReason || 'Manual edit',
      editSummary: editSummary || null,
      contentChecksum,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Also upload as latest.html
    const latestS3Key = `results/${task.user_id}/${task.file_id}/latest.html`;
    await s3Service.uploadFile(
      Buffer.from(htmlContent, 'utf-8'),
      latestS3Key,
      'text/html',
      {
        'user-id': userId,
        'file-id': task.file_id,
        'task-id': taskId,
        'version': 'latest',
      }
    );

    // Log the edit action
    await dbService.logDocumentEdit({
      versionId: version.id,
      taskId,
      userId,
      username: req.user?.username || task.username,
      action: 'create_version',
      changesDescription: editReason || 'Manual edit',
      diffSummary: {
        version_number: versionNumber,
        character_count: characterCount,
        word_count: wordCount,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      accessGranted: true,
      accessReason: editCheck.reason,
    });

    res.status(201).json({
      success: true,
      data: {
        version,
        message: `Version ${versionNumber} created successfully`,
      },
    });
  } catch (error) {
    console.error('Error creating version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create version',
      message: error.message,
    });
  }
});

module.exports = router;
