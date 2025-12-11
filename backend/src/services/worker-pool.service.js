/**
 * Worker Pool Service
 * Manages the Python worker pool as a subprocess
 * Workers start when backend starts and stay alive until backend shutdown
 */

const { spawn } = require('child_process');
const path = require('path');
const config = require('../config');
const redisService = require('./redis.service');

class WorkerPoolService {
  constructor() {
    this.workerProcess = null;
    this.isRunning = false;
    this.startupPromise = null;
  }

  /**
   * Start the persistent worker pool
   * Called during backend initialization
   */
  async start() {
    // Prevent multiple simultaneous starts
    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = this._startInternal();
    return this.startupPromise;
  }

  async _startInternal() {
    try {
      console.log('Starting worker pool...');

      // Path to Python worker pool manager
      const workerScript = path.join(__dirname, '../../../worker/worker_pool_manager.py');
      const pythonPath = path.join(__dirname, '../../../venv/bin/python3');

      // Check if worker script exists
      const fs = require('fs');
      if (!fs.existsSync(workerScript)) {
        throw new Error(`Worker script not found: ${workerScript}`);
      }

      if (!fs.existsSync(pythonPath)) {
        throw new Error(`Python venv not found: ${pythonPath}. Please run: python3 -m venv venv && source venv/bin/activate && pip install -r worker/requirements.txt`);
      }

      // Environment variables
      const env = {
        ...process.env,
        WORKER_POOL_SIZE: config.nodeEnv === 'production' ? 'auto' : '2',
        MODEL_PATH: process.env.MODEL_PATH || path.join(__dirname, '../../../models/qwen3_vl_8b_model'),
        NODE_ENV: config.nodeEnv,
        PYTHONUNBUFFERED: '1',  // Disable Python output buffering
      };

      // Spawn Python worker pool manager
      this.workerProcess = spawn(pythonPath, [workerScript], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
        detached: false, // Keep attached to parent process
      });

      // Log worker output
      this.workerProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        console.log(`[WORKER POOL] ${output}`);
      });

      this.workerProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        // Don't log as error if it's just info/warnings
        if (output.includes('ERROR') || output.includes('CRITICAL')) {
          console.error(`[WORKER POOL ERROR] ${output}`);
        } else {
          console.log(`[WORKER POOL] ${output}`);
        }
      });

      // Handle worker process exit
      this.workerProcess.on('exit', (code, signal) => {
        console.error(`[WORKER POOL] Process exited with code ${code}, signal ${signal}`);
        this.isRunning = false;
        this.startupPromise = null;

        // Auto-restart on crash (optional, configurable)
        if (config.workerPool?.autoRestart && code !== 0 && code !== null) {
          console.log('[WORKER POOL] Restarting worker pool in 5 seconds...');
          setTimeout(() => this.start(), 5000);
        }
      });

      this.isRunning = true;
      console.log('✓ Worker pool process started (PID: ' + this.workerProcess.pid + ')');

      // Wait for workers to be ready (check Redis for worker heartbeat)
      await this.waitForWorkers();

      console.log('✓ Worker pool fully initialized and ready');

    } catch (error) {
      console.error('Failed to start worker pool:', error);
      this.startupPromise = null;
      throw error;
    }
  }

  /**
   * Wait for workers to signal they're ready
   */
  async waitForWorkers(timeout = 120000) {
    const startTime = Date.now();

    console.log('Waiting for workers to be ready...');
    console.log('(This may take 30-60 seconds while models load)');

    while (Date.now() - startTime < timeout) {
      try {
        // Check if workers have registered in Redis
        const workerCount = await redisService.client.get('ocr:workers:count');
        if (workerCount && parseInt(workerCount) > 0) {
          console.log(`✓ ${workerCount} worker(s) ready`);
          return;
        }
      } catch (error) {
        // Ignore check errors, keep trying
      }

      // Wait 2 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Workers failed to start within timeout (120s). Check worker logs for errors.');
  }

  /**
   * Stop the worker pool
   * Called during backend shutdown
   */
  async stop() {
    if (!this.workerProcess || !this.isRunning) {
      console.log('Worker pool not running, nothing to stop');
      return;
    }

    console.log('Stopping worker pool...');

    return new Promise((resolve) => {
      // Send SIGTERM for graceful shutdown
      this.workerProcess.kill('SIGTERM');

      // Wait for graceful shutdown
      const timeout = setTimeout(() => {
        console.warn('Worker pool did not stop gracefully, forcing kill...');
        if (this.workerProcess) {
          this.workerProcess.kill('SIGKILL');
        }
        resolve();
      }, 15000);  // Give 15 seconds for workers to finish current tasks

      this.workerProcess.on('exit', () => {
        clearTimeout(timeout);
        this.isRunning = false;
        this.startupPromise = null;
        console.log('✓ Worker pool stopped');
        resolve();
      });
    });
  }

  /**
   * Get worker pool status
   */
  getStatus() {
    return {
      running: this.isRunning,
      pid: this.workerProcess?.pid || null,
    };
  }

  /**
   * Get worker count from Redis
   */
  async getWorkerCount() {
    try {
      const count = await redisService.client.get('ocr:workers:count');
      return parseInt(count) || 0;
    } catch (error) {
      console.error('Failed to get worker count from Redis:', error);
      return 0;
    }
  }
}

module.exports = new WorkerPoolService();
