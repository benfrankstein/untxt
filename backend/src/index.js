const http = require('http');
const https = require('https');
const fs = require('fs');
const { app, initializeServices } = require('./app');
const websocketService = require('./services/websocket.service');
const sessionCleanupJob = require('./jobs/session-cleanup.job');
const config = require('./config');

async function startServer() {
  try {
    // Initialize services first
    await initializeServices();

    let server;
    let protocol;
    let wsProtocol;

    // Create HTTPS or HTTP server based on configuration
    if (config.ssl.enabled) {
      // HTTPS/WSS Mode (HIPAA Compliant)
      try {
        const sslOptions = {
          key: fs.readFileSync(config.ssl.keyPath),
          cert: fs.readFileSync(config.ssl.certPath),
        };

        // Add CA certificate if provided
        if (config.ssl.caPath) {
          sslOptions.ca = fs.readFileSync(config.ssl.caPath);
        }

        server = https.createServer(sslOptions, app);
        protocol = 'https';
        wsProtocol = 'wss';
        console.log('✓ SSL/TLS enabled - Running in secure mode (HIPAA compliant)');
      } catch (error) {
        console.error('✗ Failed to load SSL certificates:', error.message);
        console.error('  Please ensure SSL certificates are properly configured.');
        console.error('  Key:  ', config.ssl.keyPath);
        console.error('  Cert: ', config.ssl.certPath);
        process.exit(1);
      }
    } else {
      // HTTP/WS Mode (Development only - NOT HIPAA compliant)
      server = http.createServer(app);
      protocol = 'http';
      wsProtocol = 'ws';
      console.warn('⚠ WARNING: Running in insecure mode (HTTP/WS)');
      console.warn('  This is NOT HIPAA compliant and should ONLY be used for development');
      console.warn('  Set SSL_ENABLED=true in production');
    }

    // Initialize WebSocket server (will use WSS if HTTPS is enabled)
    websocketService.initialize(server);

    // Start session cleanup job
    sessionCleanupJob.start();

    // Start server
    server.listen(config.port, () => {
      console.log('');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`  OCR Platform Backend API Server`);
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`  Port:        ${config.port}`);
      console.log(`  Protocol:    ${protocol.toUpperCase()}/${wsProtocol.toUpperCase()}`);
      console.log(`  Environment: ${config.nodeEnv}`);
      console.log(`  HIPAA Mode:  ${config.ssl.enabled ? 'YES ✓' : 'NO ✗'}`);
      console.log(`  Health:      ${protocol}://localhost:${config.port}/health`);
      console.log(`  API:         ${protocol}://localhost:${config.port}/api/tasks`);
      console.log(`  WebSocket:   ${wsProtocol}://localhost:${config.port}?userId=<USER_ID>`);
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');
      console.log('Server is ready to accept requests');
      console.log('');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully...');
      sessionCleanupJob.stop();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully...');
      sessionCleanupJob.stop();
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
