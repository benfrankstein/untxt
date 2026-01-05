const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const s3Service = require('./services/s3.service');
const versionsRoutes = require('./routes/versions.routes');
const sessionsRoutes = require('./routes/sessions.routes');
const creditsRoutes = require('./routes/credits.routes');
const kvpRoutes = require('./routes/kvp.routes');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev')); // Logs all requests

// Configure multer for memory storage (no local files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${config.upload.allowedTypes.join(', ')}`));
    }
  },
});

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'untxt-backend',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Test S3 upload route
app.post('/api/test/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // For testing, use a dummy user ID
    const userId = req.body.userId || '11111111-1111-1111-1111-111111111111'; // admin user
    const fileId = uuidv4();
    const originalFilename = req.file.originalname;

    console.log(`\n📤 Upload Request:`);
    console.log(`  - File: ${originalFilename}`);
    console.log(`  - Size: ${req.file.size} bytes`);
    console.log(`  - Type: ${req.file.mimetype}`);
    console.log(`  - User: ${userId}`);

    // Generate S3 key
    const s3Key = s3Service.generateUploadKey(userId, fileId, originalFilename);
    console.log(`  - S3 Key: ${s3Key}`);

    // Calculate file hash
    const fileHash = s3Service.calculateFileHash(req.file.buffer);
    console.log(`  - Hash: ${fileHash}`);

    // Upload to S3
    await s3Service.uploadFile(
      req.file.buffer,
      s3Key,
      req.file.mimetype,
      {
        'user-id': userId,
        'file-id': fileId,
        'original-filename': originalFilename,
      }
    );

    console.log(`✅ Upload successful!\n`);

    // Return success response
    res.json({
      success: true,
      message: 'File uploaded successfully to S3',
      data: {
        fileId,
        userId,
        originalFilename,
        s3Key,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        fileHash,
        bucket: config.aws.s3BucketName,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test S3 download route (pre-signed URL)
app.get('/api/test/download/:s3Key(*)', async (req, res) => {
  try {
    const s3Key = req.params.s3Key;

    console.log(`\n📥 Download Request:`);
    console.log(`  - S3 Key: ${s3Key}`);

    // Generate pre-signed URL
    const url = await s3Service.getPresignedDownloadUrl(s3Key, 3600); // 1 hour

    console.log(`✅ Pre-signed URL generated!\n`);

    res.json({
      success: true,
      message: 'Pre-signed URL generated',
      data: {
        s3Key,
        downloadUrl: url,
        expiresIn: 3600,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    });
  } catch (error) {
    console.error('❌ Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Register API routes
app.use('/api/versions', versionsRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/kvp', kvpRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Untxt Backend Server Started');
  console.log('='.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log(`☁️  S3 Bucket: ${config.aws.s3BucketName}`);
  console.log(`📦 Region: ${config.aws.region}`);
  console.log('='.repeat(60));
  console.log('\n📋 Available Routes:');
  console.log('  GET  /health                    - Health check');
  console.log('  POST /api/test/upload           - Test S3 file upload');
  console.log('  GET  /api/test/download/:s3Key  - Test S3 pre-signed URL');
  console.log('  GET  /api/credits/balance       - Get credit balance');
  console.log('  GET  /api/credits/packages      - Get credit packages');
  console.log('  POST /api/credits/purchase      - Purchase credits');
  console.log('  POST /api/credits/simulate-payment - TEST: Simulate payment');
  console.log('='.repeat(60) + '\n');
});

module.exports = app;
