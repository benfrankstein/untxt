const express = require('express');
const cors = require('cors');
const session = require('express-session');
const config = require('./config');

// Services
const redisService = require('./services/redis.service');
const dbService = require('./services/db.service');
const websocketService = require('./services/websocket.service');
const s3Service = require('./services/s3.service');

// Routes
const tasksRoutes = require('./routes/tasks.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const versionsRoutes = require('./routes/versions.routes');
const sessionsRoutes = require('./routes/sessions.routes');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true, // Allow cookies
  exposedHeaders: ['Content-Disposition', 'Content-Type', 'X-PDF-Conversion', 'X-Task-Id', 'X-Version-Number', 'X-Version-Id', 'X-Content-Source', 'X-Saved-To-S3'] // Allow frontend to read these headers
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware with rolling sessions (activity-based timeout)
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiration on every request (activity-based)
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS
    maxAge: 30 * 60 * 1000, // 30 minutes of INACTIVITY
    sameSite: 'lax' // CSRF protection
  }
}));

// Request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database
    const dbHealth = await dbService.healthCheck();

    // Check Redis
    const redisHealth = await redisService.healthCheck();

    const healthy = dbHealth.healthy && redisHealth.healthy;

    res.status(healthy ? 200 : 503).json({
      success: healthy,
      service: 'OCR Platform Backend API',
      timestamp: new Date().toISOString(),
      components: {
        database: dbHealth,
        redis: redisHealth,
      },
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      service: 'OCR Platform Backend API',
      error: 'Health check failed',
      message: error.message,
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/admin', adminRoutes); // Access control & revocation endpoints
app.use('/api/versions', versionsRoutes); // Document versioning & editing
app.use('/api/sessions', sessionsRoutes); // Google Docs flow - edit sessions

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      error: 'File too large',
      maxSize: `${config.upload.maxFileSize / 1024 / 1024}MB`,
    });
  }

  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// Initialize services on startup
async function initializeServices() {
  try {
    console.log('Initializing services...');

    // Connect to Redis
    await redisService.connect();
    console.log('✓ Redis connected');

    // Test database connection
    const dbHealth = await dbService.healthCheck();
    if (!dbHealth.healthy) {
      console.error('Database health check details:', dbHealth);
      throw new Error(`Database connection failed: ${dbHealth.error || 'Unknown error'}`);
    }
    console.log('✓ Database connected');

    // Subscribe to Redis Pub/Sub for task updates (from worker)
    await redisService.subscribe(redisService.TASK_UPDATES_CHANNEL, (message) => {
      console.log(`Received task update from Redis: ${message.taskId} - ${message.status}`);

      // Forward to WebSocket clients
      if (message.userId && message.taskId) {
        websocketService.sendTaskUpdate(message.userId, {
          taskId: message.taskId,
          status: message.status,
          message: message.message,
          progress: message.progress,
          error: message.error,
        });
      }
    });
    console.log('✓ Subscribed to Redis task updates channel');

    // Subscribe to Redis Pub/Sub for database changes (direct modifications)
    await redisService.subscribe('ocr:db:changes', async (message) => {
      console.log(`[DB CHANGE] ${message.data.operation} on ${message.data.table} - User: ${message.data.user_id}`);

      // Handle DELETE operations - clean up S3 files
      if (message.data.operation === 'DELETE') {
        const s3Keys = [];

        // Collect S3 keys to delete
        if (message.data.s3_key) {
          s3Keys.push(message.data.s3_key);
        }
        if (message.data.s3_result_key) {
          s3Keys.push(message.data.s3_result_key);
        }

        // Permanently delete from S3 (immediate removal)
        if (s3Keys.length > 0) {
          console.log(`[S3 CLEANUP] Permanently deleting ${s3Keys.length} file(s) from S3:`, s3Keys);

          for (const key of s3Keys) {
            try {
              await s3Service.permanentlyDeleteFile(key);
              console.log(`[S3 CLEANUP] ✓ Permanently deleted: ${key}`);
            } catch (error) {
              console.error(`[S3 CLEANUP] ✗ Failed to delete ${key}:`, error.message);
            }
          }
        }
      }

      // Forward to WebSocket clients for the affected user
      if (message.data.user_id) {
        websocketService.sendDatabaseChange(message.data.user_id, {
          type: 'db_change',
          table: message.data.table,
          operation: message.data.operation,
          recordId: message.data.record_id,
          status: message.data.status,
          message: `Database ${message.data.operation.toLowerCase()} on ${message.data.table}`,
        });
      }
    });
    console.log('✓ Subscribed to Redis database changes channel');

    console.log('All services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('\nShutting down gracefully...');

  try {
    websocketService.close();
    console.log('✓ WebSocket server closed');

    await redisService.close();
    console.log('✓ Redis connection closed');

    await dbService.close();
    console.log('✓ Database connection closed');

    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { app, initializeServices };
