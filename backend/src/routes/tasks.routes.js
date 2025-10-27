const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const s3Service = require('../services/s3.service');
const dbService = require('../services/db.service');
const redisService = require('../services/redis.service');
const websocketService = require('../services/websocket.service');
const pdfService = require('../services/pdf.service');
const config = require('../config');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize,
  },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${config.upload.allowedTypes.join(', ')}`));
    }
  },
});

/**
 * POST /api/tasks
 * Upload file and create OCR task
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    // Validate file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    // Get userId from request (from auth middleware in production)
    const userId = req.body.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required',
      });
    }

    // Generate IDs
    const fileId = uuidv4();
    const taskId = uuidv4();

    console.log(`Processing upload - File: ${fileId}, Task: ${taskId}, User: ${userId}`);

    // Generate S3 key
    const s3Key = s3Service.generateUploadKey(userId, fileId, req.file.originalname);

    // Calculate file hash
    const fileHash = s3Service.calculateFileHash(req.file.buffer);

    // Upload to S3
    console.log(`Uploading to S3: ${s3Key}`);
    await s3Service.uploadFile(
      req.file.buffer,
      s3Key,
      req.file.mimetype,
      {
        'user-id': userId,
        'file-id': fileId,
        'task-id': taskId,
      }
    );

    // Create file record in database
    console.log(`Creating file record in database: ${fileId}`);
    const fileRecord = await dbService.createFile({
      fileId,
      userId,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      s3Key,
      fileHash,
    });

    // Create task record in database
    console.log(`Creating task record in database: ${taskId}`);
    const taskRecord = await dbService.createTask({
      taskId,
      fileId,
      userId,
      priority: parseInt(req.body.priority) || 5,
    });

    // Enqueue task to Redis
    console.log(`Enqueuing task to Redis: ${taskId}`);
    await redisService.enqueueTask({
      task_id: taskId,
      file_id: fileId,
      user_id: userId,
      s3_key: s3Key,
      filename: req.file.originalname,
      mime_type: req.file.mimetype,
      priority: taskRecord.priority,
    });

    // Get queue stats
    const queueStats = await redisService.getQueueStats();

    // Send WebSocket update - task pending
    websocketService.sendTaskUpdate(userId, {
      taskId,
      fileId,
      filename: req.file.originalname,
      status: 'pending',
      queuePosition: queueStats.queued,
      message: 'Task pending - queued for processing',
    });

    // Return response
    res.status(201).json({
      success: true,
      data: {
        taskId,
        fileId,
        filename: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        s3Key,
        fileHash,
        status: taskRecord.status,
        queuePosition: queueStats.queued,
        createdAt: taskRecord.created_at,
      },
    });

    console.log(`Task created successfully: ${taskId}`);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create task',
      message: error.message,
    });
  }
});

/**
 * GET /api/tasks
 * Get all tasks for a user
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required',
      });
    }

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const tasks = await dbService.getTasksByUserId(userId, limit, offset);
    const stats = await dbService.getTaskStats(userId);

    res.json({
      success: true,
      data: {
        tasks,
        stats,
        pagination: {
          limit,
          offset,
          total: parseInt(stats.total),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tasks',
      message: error.message,
    });
  }
});

/**
 * GET /api/tasks/:taskId
 * Get task details and result
 */
router.get('/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'];

    const task = await dbService.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    // Verify ownership
    if (task.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task',
      });
    }

    res.json({
      success: true,
      data: {
        task,
        // No pre-signed URL - use dedicated download endpoints instead
        downloadEndpoint: task.s3_key ? `/api/tasks/${taskId}/download` : null,
        resultEndpoint: task.s3_result_key ? `/api/tasks/${taskId}/result` : null,
      },
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch task',
      message: error.message,
    });
  }
});

/**
 * GET /api/tasks/:taskId/preview
 * Get HTML preview for text extraction (no PDF conversion)
 */
router.get('/:taskId/preview', async (req, res) => {
  const startTime = Date.now();
  const userId = req.body.userId || req.headers['x-user-id'];
  const { taskId } = req.params;

  try {
    // 1. Get task details
    const task = await dbService.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    // 2. Verify ownership
    if (task.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task',
      });
    }

    // 3. Check access control
    const accessCheck = await dbService.checkUserFileAccess(userId, taskId);

    if (!accessCheck.hasAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access to this file has been revoked',
        reason: accessCheck.denialReason,
      });
    }

    // 4. Verify task is completed
    if (task.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Task is not completed yet',
        status: task.status,
      });
    }

    if (!task.s3_result_key) {
      return res.status(404).json({
        success: false,
        error: 'Task result not found',
      });
    }

    // 5. Download HTML from S3
    const fileData = await s3Service.streamFileDownload(task.s3_result_key);

    // Read the HTML content from stream
    const chunks = [];
    for await (const chunk of fileData.stream) {
      chunks.push(chunk);
    }
    const htmlContent = Buffer.concat(chunks).toString('utf-8');

    // 6. Return HTML directly (no PDF conversion for preview)
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Task-Id': taskId,
      'X-File-Access-Controlled': 'true',
      'Cache-Control': 'no-cache'
    });
    res.send(htmlContent);

    // Log access
    await dbService.logFileAccess({
      userId,
      username: req.user?.username || task.username,
      taskId,
      fileId: task.file_id,
      s3Key: task.s3_result_key,
      filename: task.filename,
      accessResult: 'allowed',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      downloadDurationMs: Date.now() - startTime,
      metadata: { accessType: 'preview' }
    });

  } catch (error) {
    console.error('Error fetching task preview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch task preview',
    });
  }
});

/**
 * GET /api/tasks/:taskId/result
 * Stream task result content as PDF (HIPAA-compliant proxied download)
 */
router.get('/:taskId/result', async (req, res) => {
  const startTime = Date.now();
  const userId = req.body.userId || req.headers['x-user-id'];
  const { taskId } = req.params;

  try {
    // 1. Get task details
    const task = await dbService.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    // 2. Verify ownership
    if (task.user_id !== userId) {
      await dbService.logFileAccess({
        userId,
        username: req.user?.username || 'unknown',
        taskId,
        fileId: task.file_id,
        s3Key: task.s3_result_key,
        filename: task.filename,
        accessResult: 'denied',
        accessDeniedReason: 'User does not own this task',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task',
      });
    }

    // 3. Check access control (global and file-specific revocations)
    const accessCheck = await dbService.checkUserFileAccess(userId, taskId);

    if (!accessCheck.hasAccess) {
      await dbService.logFileAccess({
        userId,
        username: req.user?.username || task.username,
        taskId,
        fileId: task.file_id,
        s3Key: task.s3_result_key,
        filename: task.filename,
        accessResult: 'denied',
        accessDeniedReason: accessCheck.denialReason,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(403).json({
        success: false,
        error: 'Access to this file has been revoked',
        reason: accessCheck.denialReason,
      });
    }

    // 4. Verify task is completed
    if (task.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Task is not completed yet',
        status: task.status,
      });
    }

    if (!task.s3_result_key) {
      return res.status(404).json({
        success: false,
        error: 'Task result not found',
      });
    }

    // 5. Download HTML from S3
    const fileData = await s3Service.streamFileDownload(task.s3_result_key);

    // Read the HTML content from stream
    const chunks = [];
    for await (const chunk of fileData.stream) {
      chunks.push(chunk);
    }
    const htmlContent = Buffer.concat(chunks).toString('utf-8');

    // 6. Convert HTML to PDF
    let pdfBuffer;
    try {
      pdfBuffer = await pdfService.htmlToPdf(htmlContent, {
        format: 'A4',
        printBackground: true
      });
    } catch (pdfError) {
      // If PDF conversion fails, fall back to HTML
      console.warn('PDF conversion failed, returning HTML:', pdfError.message);

      // Strip extension from original filename (e.g., "document.pdf" -> "document")
      const baseFilename = task.filename.replace(/\.[^/.]+$/, '');

      res.set({
        'Content-Type': 'text/html',
        'Content-Disposition': `attachment; filename="${baseFilename}_result.html"`,
        'X-Task-Id': taskId,
        'X-File-Access-Controlled': 'true',
        'X-PDF-Conversion': 'failed'
      });
      res.send(htmlContent);

      await dbService.logFileAccess({
        userId,
        username: req.user?.username || task.username,
        taskId,
        fileId: task.file_id,
        s3Key: task.s3_result_key,
        filename: task.filename,
        accessResult: 'allowed',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        downloadDurationMs: Date.now() - startTime,
        metadata: { pdfConversionFailed: true }
      });
      return;
    }

    // Strip extension from original filename (e.g., "document.pdf" -> "document")
    const baseFilename = task.filename.replace(/\.[^/.]+$/, '');

    // Set response headers for PDF
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': `attachment; filename="${baseFilename}_result.pdf"`,
      'X-Task-Id': taskId,
      'X-File-Access-Controlled': 'true',
      'X-PDF-Conversion': 'success'
    });

    // Send PDF buffer (use res.end() for binary data, not res.send())
    res.end(pdfBuffer, 'binary');

    // Log successful access
    const downloadDuration = Date.now() - startTime;
    await dbService.logFileAccess({
      userId,
      username: req.user?.username || task.username,
      taskId,
      fileId: task.file_id,
      s3Key: task.s3_result_key,
      filename: task.filename,
      accessResult: 'allowed',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      downloadDurationMs: downloadDuration,
      metadata: { format: 'pdf', convertedFromHtml: true }
    });

  } catch (error) {
    console.error('Error streaming task result:', error);

    // Log error access attempt
    try {
      await dbService.logFileAccess({
        userId,
        username: req.user?.username || 'unknown',
        taskId,
        s3Key: 'unknown',
        filename: 'unknown',
        accessResult: 'error',
        accessDeniedReason: error.message,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (logError) {
      console.error('Failed to log error access:', logError);
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to stream task result',
        message: error.message,
      });
    }
  }
});

/**
 * GET /api/tasks/:taskId/download
 * Stream original uploaded file (HIPAA-compliant proxied download)
 */
router.get('/:taskId/download', async (req, res) => {
  const startTime = Date.now();
  const userId = req.body.userId || req.headers['x-user-id']; // Use x-user-id header like other endpoints
  const { taskId } = req.params;

  // Debug logging
  console.log('📥 Download request:', {
    taskId,
    userId,
    header: req.headers['x-user-id'],
    body: req.body.userId
  });

  // Check authentication
  if (!userId) {
    console.error('❌ No userId provided');
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
  }

  try {
    // 1. Get task details
    const task = await dbService.getTaskById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    // 2. Verify ownership
    if (task.user_id !== userId) {
      await dbService.logFileAccess({
        userId,
        username: req.user?.username || 'unknown',
        taskId,
        fileId: task.file_id,
        s3Key: task.s3_key,
        filename: task.filename,
        accessResult: 'denied',
        accessDeniedReason: 'User does not own this task',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(403).json({
        success: false,
        error: 'Unauthorized to access this task',
      });
    }

    // 3. Check access control (global and file-specific revocations)
    const accessCheck = await dbService.checkUserFileAccess(userId, taskId);

    if (!accessCheck.hasAccess) {
      await dbService.logFileAccess({
        userId,
        username: req.user?.username || task.username,
        taskId,
        fileId: task.file_id,
        s3Key: task.s3_key,
        filename: task.filename,
        accessResult: 'denied',
        accessDeniedReason: accessCheck.denialReason,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(403).json({
        success: false,
        error: 'Access to this file has been revoked',
        reason: accessCheck.denialReason,
      });
    }

    // 4. Verify file exists
    if (!task.s3_key) {
      return res.status(404).json({
        success: false,
        error: 'Original file not found',
      });
    }

    // 5. Stream file from S3 through backend
    const fileData = await s3Service.streamFileDownload(task.s3_key);

    // Set response headers
    res.set({
      'Content-Type': fileData.contentType || task.mime_type || 'application/octet-stream',
      'Content-Length': fileData.contentLength,
      'Content-Disposition': `attachment; filename="${task.filename}"`,
      'X-Task-Id': taskId,
      'X-File-Access-Controlled': 'true',
    });

    // Stream to user
    fileData.stream.pipe(res);

    // Log successful access after stream completes
    fileData.stream.on('end', async () => {
      const downloadDuration = Date.now() - startTime;
      await dbService.logFileAccess({
        userId,
        username: req.user?.username || task.username,
        taskId,
        fileId: task.file_id,
        s3Key: task.s3_key,
        filename: task.filename,
        accessResult: 'allowed',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        downloadDurationMs: downloadDuration,
      });
    });

    // Handle stream errors
    fileData.stream.on('error', async (streamError) => {
      console.error('Stream error:', streamError);
      await dbService.logFileAccess({
        userId,
        username: req.user?.username || task.username,
        taskId,
        fileId: task.file_id,
        s3Key: task.s3_key,
        filename: task.filename,
        accessResult: 'error',
        accessDeniedReason: `Stream error: ${streamError.message}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    });

  } catch (error) {
    console.error('Error streaming original file:', error);

    // Log error access attempt
    try {
      await dbService.logFileAccess({
        userId,
        username: req.user?.username || 'unknown',
        taskId,
        s3Key: 'unknown',
        filename: 'unknown',
        accessResult: 'error',
        accessDeniedReason: error.message,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (logError) {
      console.error('Failed to log error access:', logError);
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to stream original file',
        message: error.message,
      });
    }
  }
});

/**
 * GET /api/tasks/:taskId/status
 * Get task status (checks Redis first, then database)
 */
router.get('/:taskId/status', async (req, res) => {
  try {
    const { taskId } = req.params;

    // Check Redis cache first for real-time status
    let status = await redisService.getTaskStatus(taskId);

    // If not in Redis, get from database
    if (!status) {
      const task = await dbService.getTaskById(taskId);
      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
        });
      }
      status = {
        taskId: task.id,
        status: task.status,
        createdAt: task.created_at,
        startedAt: task.started_at,
        completedAt: task.completed_at,
      };
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Error fetching task status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch task status',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/tasks/:taskId
 * Delete task and associated files from S3 and database
 */
router.delete('/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;

    // Delete from database (returns task data with S3 keys)
    const task = await dbService.deleteTask(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    // Permanently delete files from S3
    const s3Deletions = [];

    // Delete uploaded file
    if (task.s3_key) {
      s3Deletions.push(
        s3Service.permanentlyDeleteFile(task.s3_key).catch(err => {
          console.error(`Failed to permanently delete upload from S3: ${task.s3_key}`, err);
        })
      );
    }

    // Delete result file
    if (task.s3_result_key) {
      s3Deletions.push(
        s3Service.permanentlyDeleteFile(task.s3_result_key).catch(err => {
          console.error(`Failed to permanently delete result from S3: ${task.s3_result_key}`, err);
        })
      );
    }

    // Wait for all S3 deletions (best effort)
    await Promise.all(s3Deletions);

    console.log(`Task deleted successfully: ${taskId}`);

    res.json({
      success: true,
      message: 'Task and associated files deleted successfully',
      data: {
        taskId,
        deletedFiles: {
          upload: task.s3_key,
          result: task.s3_result_key,
        },
      },
    });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete task',
      message: error.message,
    });
  }
});

module.exports = router;
