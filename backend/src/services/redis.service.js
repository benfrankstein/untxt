const redis = require('redis');
const config = require('../config');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;

    // Queue names matching worker expectations
    this.TASK_QUEUE = 'ocr:task:queue';
    this.TASK_PROCESSING = 'ocr:task:processing';
    this.TASK_RESULTS = 'ocr:task:results';

    // Pub/Sub channel for real-time task updates
    this.TASK_UPDATES_CHANNEL = 'ocr:task:updates';
  }

  /**
   * Initialize Redis connection
   */
  async connect() {
    if (this.isConnected) {
      return;
    }

    const socketConfig = {
      host: config.redis.host,
      port: config.redis.port,
    };

    // Add TLS configuration if enabled
    if (config.redis.tls.enabled) {
      const fs = require('fs');
      const tlsOptions = {
        rejectUnauthorized: config.redis.tls.rejectUnauthorized,
      };

      // Load CA certificate if provided
      if (config.redis.tls.ca) {
        try {
          tlsOptions.ca = fs.readFileSync(config.redis.tls.ca);
          console.log('✓ Loaded Redis TLS CA certificate');
        } catch (error) {
          console.error('✗ Failed to load Redis CA certificate:', error.message);
          throw error;
        }
      }

      // Load client certificate if provided
      if (config.redis.tls.cert && config.redis.tls.key) {
        try {
          tlsOptions.cert = fs.readFileSync(config.redis.tls.cert);
          tlsOptions.key = fs.readFileSync(config.redis.tls.key);
          console.log('✓ Loaded Redis TLS client certificate');
        } catch (error) {
          console.error('✗ Failed to load Redis client certificate:', error.message);
          throw error;
        }
      }

      socketConfig.tls = tlsOptions;
      console.log('✓ Redis TLS enabled (HIPAA compliant)');
    } else {
      console.warn('⚠ Redis TLS disabled - NOT HIPAA compliant');
      console.warn('  Set REDIS_TLS_ENABLED=true in production');
    }

    this.client = redis.createClient({
      socket: socketConfig,
      database: config.redis.db,
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      const tlsStatus = config.redis.tls.enabled ? 'with TLS' : 'without TLS';
      console.log(`Redis connected ${tlsStatus}`);
      this.isConnected = true;
    });

    this.client.on('reconnecting', () => {
      console.log('Redis reconnecting...');
    });

    await this.client.connect();
  }

  /**
   * Enqueue a task for processing
   * Pushes to the left of the queue (LPUSH) so worker gets it with BRPOP
   */
  async enqueueTask(taskData) {
    if (!this.isConnected) {
      await this.connect();
    }

    const taskMessage = JSON.stringify(taskData);
    await this.client.lPush(this.TASK_QUEUE, taskMessage);

    console.log(`Task enqueued: ${taskData.task_id}`);
    return true;
  }

  /**
   * Get queue length
   */
  async getQueueLength() {
    if (!this.isConnected) {
      await this.connect();
    }

    return await this.client.lLen(this.TASK_QUEUE);
  }

  /**
   * Get processing queue length
   */
  async getProcessingLength() {
    if (!this.isConnected) {
      await this.connect();
    }

    return await this.client.lLen(this.TASK_PROCESSING);
  }

  /**
   * Get task result from results queue
   */
  async getTaskResult(taskId, timeout = 5) {
    if (!this.isConnected) {
      await this.connect();
    }

    // Check if result exists
    const key = `${this.TASK_RESULTS}:${taskId}`;
    const result = await this.client.get(key);

    if (result) {
      return JSON.parse(result);
    }

    return null;
  }

  /**
   * Store task result (used by worker)
   */
  async setTaskResult(taskId, result, expiresIn = 3600) {
    if (!this.isConnected) {
      await this.connect();
    }

    const key = `${this.TASK_RESULTS}:${taskId}`;
    await this.client.setEx(key, expiresIn, JSON.stringify(result));

    console.log(`Task result stored: ${taskId}`);
    return true;
  }

  /**
   * Get task status from Redis (if cached)
   */
  async getTaskStatus(taskId) {
    if (!this.isConnected) {
      await this.connect();
    }

    const statusKey = `ocr:task:status:${taskId}`;
    const status = await this.client.get(statusKey);

    if (status) {
      return JSON.parse(status);
    }

    return null;
  }

  /**
   * Set task status in Redis cache
   */
  async setTaskStatus(taskId, statusData, expiresIn = 3600) {
    if (!this.isConnected) {
      await this.connect();
    }

    const statusKey = `ocr:task:status:${taskId}`;
    await this.client.setEx(statusKey, expiresIn, JSON.stringify(statusData));

    return true;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    if (!this.isConnected) {
      await this.connect();
    }

    const [queueLength, processingLength] = await Promise.all([
      this.getQueueLength(),
      this.getProcessingLength(),
    ]);

    return {
      queued: queueLength,
      processing: processingLength,
      total: queueLength + processingLength,
    };
  }

  /**
   * Publish real-time update to channel
   */
  async publishUpdate(channel, message) {
    if (!this.isConnected) {
      await this.connect();
    }

    await this.client.publish(channel, JSON.stringify(message));
    return true;
  }

  /**
   * Subscribe to channel for real-time updates
   */
  async subscribe(channel, callback) {
    if (!this.isConnected) {
      await this.connect();
    }

    // Create a separate client for subscriptions
    const subscriber = this.client.duplicate();
    await subscriber.connect();

    await subscriber.subscribe(channel, (message) => {
      try {
        const data = JSON.parse(message);
        callback(data);
      } catch (error) {
        console.error('Error parsing Redis message:', error);
      }
    });

    return subscriber;
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      await this.client.ping();
      const queueLength = await this.getQueueLength();

      return {
        healthy: true,
        connected: this.isConnected,
        queueLength,
      };
    } catch (error) {
      return {
        healthy: false,
        connected: false,
        error: error.message,
      };
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
}

module.exports = new RedisService();
