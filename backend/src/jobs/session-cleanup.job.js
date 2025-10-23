/**
 * Session Cleanup Job
 * Periodically removes expired sessions from the database
 * Runs every 5 minutes
 */

const sessionService = require('../services/session.service');

class SessionCleanupJob {
  constructor() {
    this.intervalMs = 5 * 60 * 1000; // 5 minutes
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Start the cleanup job
   */
  start() {
    if (this.isRunning) {
      console.log('⚠ Session cleanup job is already running');
      return;
    }

    console.log('→ Starting session cleanup job (runs every 5 minutes)');

    // Run immediately on start
    this.runCleanup();

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, this.intervalMs);

    this.isRunning = true;
  }

  /**
   * Stop the cleanup job
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;
      console.log('✓ Session cleanup job stopped');
    }
  }

  /**
   * Run the cleanup process
   */
  async runCleanup() {
    try {
      const count = await sessionService.cleanupExpiredSessions();

      if (count > 0) {
        console.log(`✓ Session cleanup: Removed ${count} expired session(s)`);
      }
    } catch (error) {
      console.error('✗ Session cleanup error:', error);
    }
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      running: this.isRunning,
      intervalMs: this.intervalMs,
      nextRunIn: this.isRunning ? this.intervalMs : null
    };
  }
}

// Export singleton instance
module.exports = new SessionCleanupJob();
