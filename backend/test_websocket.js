#!/usr/bin/env node

/**
 * WebSocket Connection Test
 * Tests real-time task updates via WebSocket
 *
 * Usage:
 *   node backend/test_websocket.js                           # Uses benfrankstein (admin)
 *   node backend/test_websocket.js <USER_ID>                 # Uses specified user ID
 *   node backend/test_websocket.js 11111111-1111-1111-1111-111111111111  # Test user
 */

const WebSocket = require('ws');

// Use command-line argument or default to benfrankstein admin user
const USER_ID = process.argv[2] || '3c8bf409-1992-4156-add2-3d5bb3df6ec1'; // benfrankstein (admin)
const WS_URL = `ws://localhost:8080?userId=${USER_ID}`;

console.log('═══════════════════════════════════════════════════════════════');
console.log('  WebSocket Connection Test');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log(`Connecting to: ${WS_URL}`);
console.log('');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✓ WebSocket connection established');
  console.log('');
  console.log('Listening for task updates...');
  console.log('(Press Ctrl+C to exit)');
  console.log('');

  // Send ping every 30 seconds
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);

  ws.on('close', () => {
    clearInterval(pingInterval);
  });
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data);
    const timestamp = new Date().toISOString();

    console.log(`[${timestamp}] ${message.type.toUpperCase()}`);

    switch (message.type) {
      case 'connected':
        console.log(`  User ID: ${message.userId}`);
        break;

      case 'task_update':
        console.log(`  Task ID: ${message.data.taskId}`);
        console.log(`  Status:  ${message.data.status}`);
        if (message.data.progress) {
          console.log(`  Progress: ${message.data.progress}%`);
        }
        if (message.data.message) {
          console.log(`  Message: ${message.data.message}`);
        }
        break;

      case 'db_change':
        console.log(`  Table:     ${message.data.table}`);
        console.log(`  Operation: ${message.data.operation}`);
        console.log(`  Record ID: ${message.data.recordId}`);
        if (message.data.message) {
          console.log(`  Message:   ${message.data.message}`);
        }
        break;

      case 'pong':
        console.log('  Keepalive acknowledged');
        break;

      case 'error':
        console.log(`  Error: ${message.message}`);
        break;

      default:
        console.log('  Data:', JSON.stringify(message.data, null, 2));
    }

    console.log('');
  } catch (error) {
    console.error('Error parsing message:', error);
  }
});

ws.on('error', (error) => {
  console.error('✗ WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('');
  console.log('✓ WebSocket connection closed');
  process.exit(0);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('');
  console.log('Closing connection...');
  ws.close();
});
