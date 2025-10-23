#!/usr/bin/env node

/**
 * Database Change Listener
 *
 * This service:
 * 1. Connects to PostgreSQL and listens for NOTIFY events
 * 2. When database changes occur (INSERT/UPDATE/DELETE), triggers fire
 * 3. Forwards notifications to Redis for WebSocket broadcasting
 * 4. Enables real-time UI updates for direct database modifications
 */

const { Client } = require('pg');
const redis = require('redis');
const config = require('../config');

class DatabaseListener {
  constructor() {
    this.pgClient = null;
    this.redisClient = null;
    this.isConnected = false;
  }

  async start() {
    try {
      console.log('');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('  Database Change Listener Starting');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');

      // Connect to PostgreSQL
      await this.connectPostgreSQL();

      // Connect to Redis
      await this.connectRedis();

      // Start listening for database changes
      await this.listen();

      this.isConnected = true;

      console.log('');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('  Database Change Listener Ready');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('  Listening for direct database modifications...');
      console.log('  Any changes to tasks, files, or results will be broadcast');
      console.log('  to connected WebSocket clients automatically.');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');

    } catch (error) {
      console.error('Failed to start database listener:', error);
      process.exit(1);
    }
  }

  async connectPostgreSQL() {
    console.log('→ Connecting to PostgreSQL...');

    this.pgClient = new Client({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
    });

    await this.pgClient.connect();

    // Handle connection errors
    this.pgClient.on('error', (err) => {
      console.error('PostgreSQL connection error:', err);
      this.reconnectPostgreSQL();
    });

    // Handle notifications
    this.pgClient.on('notification', (msg) => {
      this.handleNotification(msg);
    });

    console.log('✓ Connected to PostgreSQL');
  }

  async connectRedis() {
    console.log('→ Connecting to Redis...');

    this.redisClient = redis.createClient({
      socket: {
        host: config.redis?.host || 'localhost',
        port: config.redis?.port || 6379,
      }
    });

    this.redisClient.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    await this.redisClient.connect();

    console.log('✓ Connected to Redis');
  }

  async listen() {
    console.log('→ Setting up database change listener...');

    // Listen to the 'db_changes' channel
    // This channel receives notifications from PostgreSQL triggers
    await this.pgClient.query('LISTEN db_changes');

    console.log('✓ Listening to database changes on channel: db_changes');
  }

  handleNotification(msg) {
    try {
      // Parse the notification payload
      const payload = JSON.parse(msg.payload);

      console.log(`[DB CHANGE] ${payload.operation} on ${payload.table} - ID: ${payload.record_id}`);

      // Forward to Redis for WebSocket broadcasting
      this.publishToRedis(payload);

    } catch (error) {
      console.error('Error handling notification:', error);
    }
  }

  async publishToRedis(payload) {
    try {
      // Determine the appropriate Redis channel
      const channel = 'ocr:db:changes';

      // Publish to Redis
      // The backend will subscribe to this and broadcast via WebSocket
      await this.redisClient.publish(channel, JSON.stringify({
        type: 'db_change',
        data: payload
      }));

      console.log(`  ↳ Published to Redis channel: ${channel}`);

    } catch (error) {
      console.error('Error publishing to Redis:', error);
    }
  }

  async reconnectPostgreSQL() {
    console.log('Attempting to reconnect to PostgreSQL...');

    try {
      if (this.pgClient) {
        await this.pgClient.end();
      }

      await this.connectPostgreSQL();
      await this.listen();

      console.log('✓ Reconnected to PostgreSQL');

    } catch (error) {
      console.error('Reconnection failed, retrying in 5 seconds...');
      setTimeout(() => this.reconnectPostgreSQL(), 5000);
    }
  }

  async shutdown() {
    console.log('');
    console.log('Shutting down database listener...');

    this.isConnected = false;

    if (this.pgClient) {
      await this.pgClient.query('UNLISTEN db_changes');
      await this.pgClient.end();
      console.log('✓ PostgreSQL connection closed');
    }

    if (this.redisClient) {
      await this.redisClient.quit();
      console.log('✓ Redis connection closed');
    }

    console.log('Database listener stopped');
  }
}

// Start the listener
const listener = new DatabaseListener();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await listener.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await listener.shutdown();
  process.exit(0);
});

// Start listening
listener.start().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

module.exports = DatabaseListener;
