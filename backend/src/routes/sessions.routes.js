const express = require('express');
const router = express.Router();

const s3Service = require('../services/s3.service');
const dbService = require('../services/db.service');
const pdfService = require('../services/pdf.service');

/**
 * POST /api/sessions/:taskId/start
 * Start edit session when user opens document
 */
router.post('/:taskId/start', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { sessionId, viewType } = req.body;
    const userId = req.headers['x-user-id'];

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId is required'
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

    // Determine access reason based on viewType (if provided) or edit check
    let accessReason;
    if (viewType) {
      // View-only sessions (original_view, view_only, etc.)
      accessReason = viewType;
    } else {
      // Edit sessions - use owner/granted_permission
      accessReason = editCheck.reason;
    }

    // Create or get edit session
    const session = await dbService.createOrGetEditSession({
      taskId,
      userId,
      username: task.username,
      sessionId,
      draftId: null,  // No draft ID in Google Docs flow
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      accessReason: accessReason
    });

    res.json({
      success: true,
      session: {
        id: session.id,
        session_id: session.session_id,
        started_at: session.started_at
      }
    });

    console.log(`📝 Edit session started: ${sessionId}`);
  } catch (error) {
    console.error('Error starting session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start session',
      message: error.message
    });
  }
});

/**
 * POST /api/sessions/:taskId/end
 * End edit session when user closes document
 * - Uploads latest version to S3
 * - Marks session as ended
 */
router.post('/:taskId/end', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { sessionId, htmlContent, outcome, userId: bodyUserId } = req.body;
    const userId = bodyUserId || req.headers['x-user-id'];

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'sessionId is required'
      });
    }

    // Get task info first
    const task = await dbService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Get latest version for this session
    let finalVersion = await dbService.getLatestVersionForSession(sessionId);

    // If HTML content provided, create/update final version
    if (htmlContent && htmlContent.trim().length > 0) {
      const characterCount = htmlContent.length;
      const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

      if (finalVersion) {
        // Update existing version with final content
        finalVersion = await dbService.updateVersion(finalVersion.id, {
          htmlContent,
          characterCount,
          wordCount
        });
      } else {
        // Create new version (session had no edits yet)
        finalVersion = await dbService.createVersion({
          taskId,
          fileId: task.file_id,
          userId,
          htmlContent,
          s3Key: null,
          characterCount,
          wordCount,
          editReason: 'Session end',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          sessionId
        });

        await dbService.incrementSessionVersions(sessionId);
      }
    }

    // Upload to S3 if version has content but no S3 key
    if (finalVersion && finalVersion.html_content && !finalVersion.s3_key) {
      const s3Key = `results/${userId}/${task.file_id}/v${finalVersion.version_number}.html`;

      await s3Service.uploadFile(
        Buffer.from(finalVersion.html_content, 'utf-8'),
        s3Key,
        'text/html',
        {
          'user-id': userId,
          'task-id': taskId,
          'version': finalVersion.version_number.toString(),
          'session-end': 'true',
          'archived-at': new Date().toISOString()
        }
      );

      // Update version with S3 key
      await dbService.updateVersionS3Key(finalVersion.id, s3Key);

      console.log(`☁️ Session end: Uploaded v${finalVersion.version_number} to S3`);
    }

    // Close session
    await dbService.closeEditSession({
      sessionId,
      outcome: outcome || 'completed'
    });

    res.json({
      success: true,
      message: 'Session ended successfully'
    });

    console.log(`✅ Edit session ended: ${sessionId}`);
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to end session',
      message: error.message
    });
  }
});

/**
 * POST /api/sessions/:taskId/download-result
 * Download result as PDF and save version to S3
 * - Converts HTML to PDF
 * - Streams PDF to user
 * - Saves HTML to database + S3
 */
router.post('/:taskId/download-result', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { htmlContent, sessionId } = req.body;
    const userId = req.headers['x-user-id'];

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

    // Ensure session exists for audit trail (HIPAA compliance)
    // If sessionId is a temporary download ID, create a session record
    if (sessionId.startsWith('download-')) {
      try {
        await dbService.createOrGetEditSession({
          taskId,
          userId,
          username: task.username || 'unknown',
          sessionId,
          draftId: null,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          accessReason: 'download_only'
        });
        console.log(`📝 Created download-only session: ${sessionId}`);
      } catch (err) {
        console.warn('Session may already exist:', err.message);
      }
    }

    // Convert HTML to PDF
    let pdfBuffer;
    try {
      pdfBuffer = await pdfService.htmlToPdf(htmlContent, {
        format: 'A4',
        printBackground: true
      });
    } catch (pdfError) {
      console.warn('PDF conversion failed, returning HTML:', pdfError.message);

      const baseFilename = task.filename.replace(/\.[^/.]+$/, '');
      res.set({
        'Content-Type': 'text/html',
        'Content-Disposition': `attachment; filename="${baseFilename}_result.html"`,
        'X-PDF-Conversion': 'failed'
      });
      res.send(htmlContent);
      return;
    }

    // Get next version number
    const nextVersion = await dbService.getNextVersionNumber(taskId);
    console.log(`📊 Next version number for download: ${nextVersion}`);

    // Upload HTML to S3
    const s3Key = `results/${userId}/${task.file_id}/v${nextVersion}.html`;
    await s3Service.uploadFile(
      Buffer.from(htmlContent, 'utf-8'),
      s3Key,
      'text/html',
      {
        'user-id': userId,
        'task-id': taskId,
        'version': nextVersion.toString(),
        'download-triggered': 'true',
        'saved-at': new Date().toISOString()
      }
    );

    // Create version with BOTH html_content AND s3_key
    const characterCount = htmlContent.length;
    const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

    const version = await dbService.createVersion({
      taskId,
      fileId: task.file_id,
      userId,
      htmlContent,
      s3Key,  // Both in database AND S3
      characterCount,
      wordCount,
      editReason: 'Downloaded by user',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId
    });

    await dbService.incrementSessionVersions(sessionId);

    // Stream PDF to user
    const baseFilename = task.filename.replace(/\.[^/.]+$/, '');
    console.log(`✅ Created version: ${version.version_number} (ID: ${version.id})`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': `attachment; filename="${baseFilename}_result.pdf"`,
      'X-Version-Number': version.version_number,  // Use version from DB, not nextVersion
      'X-Version-Id': version.id,
      'X-Saved-To-S3': 'true',
      'X-PDF-Conversion': 'success'
    });
    res.end(pdfBuffer, 'binary');

    console.log(`📥 Download v${version.version_number} → Database + S3`);
  } catch (error) {
    console.error('Error downloading result:', error);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to download result',
        message: error.message
      });
    }
  }
});

module.exports = router;
