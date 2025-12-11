require('dotenv').config();

module.exports = {
  // Server
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',

  // SSL/TLS Configuration for HTTPS and WSS (HIPAA Compliance)
  ssl: {
    enabled: process.env.SSL_ENABLED === 'true',
    keyPath: process.env.SSL_KEY_PATH || './certs/server.key',
    certPath: process.env.SSL_CERT_PATH || './certs/server.cert',
    caPath: process.env.SSL_CA_PATH, // Optional: CA bundle path
  },

  // AWS S3
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3BucketName: process.env.S3_BUCKET_NAME,
    kmsKeyId: process.env.KMS_KEY_ID,
  },

  // PostgreSQL
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'ocr_platform_dev',
    user: process.env.DB_USER || 'ocr_platform_user',
    password: process.env.DB_PASSWORD || 'ocr_platform_pass_dev',
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    db: parseInt(process.env.REDIS_DB) || 0,
    tls: {
      enabled: process.env.REDIS_TLS_ENABLED === 'true',
      rejectUnauthorized: process.env.NODE_ENV === 'production',
      ca: process.env.REDIS_TLS_CA_PATH,
      cert: process.env.REDIS_TLS_CERT_PATH,
      key: process.env.REDIS_TLS_KEY_PATH,
    },
  },

  // File Upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB
    allowedTypes: process.env.ALLOWED_FILE_TYPES?.split(',') || [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ],
  },

  // Redis Keys
  redisKeys: {
    taskQueue: 'ocr:task:queue',
    taskDataPrefix: 'ocr:task:data:',
    notificationsChannel: 'ocr:notifications',
    userNotificationsPrefix: 'ocr:notifications:user:',
  },

  // Worker Pool Configuration
  workerPool: {
    enabled: process.env.WORKER_POOL_ENABLED !== 'false',
    autoRestart: process.env.WORKER_POOL_AUTO_RESTART !== 'false',
    healthCheckInterval: parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL) || 30000,
  },

  // Google OAuth
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:8080/api/auth/google/callback',
  },
};
