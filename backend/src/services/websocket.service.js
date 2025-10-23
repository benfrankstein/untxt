const WebSocket = require('ws');
const url = require('url');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // Map of userId -> Set of WebSocket connections
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.wss = new WebSocket.Server({ server });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    console.log('✓ WebSocket server initialized');
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws, req) {
    const params = url.parse(req.url, true).query;
    const userId = params.userId;

    if (!userId) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'userId query parameter is required',
      }));
      ws.close();
      return;
    }

    // Register client
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId).add(ws);

    console.log(`WebSocket client connected: ${userId} (Total: ${this.clients.get(userId).size})`);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'WebSocket connection established',
      userId,
      timestamp: new Date().toISOString(),
    }));

    // Handle messages from client
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        this.handleMessage(ws, userId, data);
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON message',
        }));
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      this.handleDisconnect(userId, ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
      this.handleDisconnect(userId, ws);
    });
  }

  /**
   * Handle message from client
   */
  handleMessage(ws, userId, data) {
    const { type, payload } = data;

    switch (type) {
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString(),
        }));
        break;

      case 'subscribe':
        // Subscribe to specific task updates
        if (payload && payload.taskId) {
          ws.taskId = payload.taskId;
          ws.send(JSON.stringify({
            type: 'subscribed',
            taskId: payload.taskId,
          }));
        }
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${type}`,
        }));
    }
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(userId, ws) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      userClients.delete(ws);
      if (userClients.size === 0) {
        this.clients.delete(userId);
      }
      console.log(`WebSocket client disconnected: ${userId} (Remaining: ${userClients.size})`);
    }
  }

  /**
   * Send task update to user
   */
  sendTaskUpdate(userId, taskUpdate) {
    const userClients = this.clients.get(userId);
    if (!userClients || userClients.size === 0) {
      return;
    }

    const message = JSON.stringify({
      type: 'task_update',
      data: taskUpdate,
      timestamp: new Date().toISOString(),
    });

    userClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });

    console.log(`Task update sent to ${userClients.size} client(s) for user ${userId}`);
  }

  /**
   * Send database change notification to user
   * This is triggered by direct database modifications
   */
  sendDatabaseChange(userId, changeData) {
    const userClients = this.clients.get(userId);
    if (!userClients || userClients.size === 0) {
      return;
    }

    const message = JSON.stringify({
      type: 'db_change',
      data: changeData,
      timestamp: new Date().toISOString(),
    });

    userClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });

    console.log(`[DB CHANGE] Update sent to ${userClients.size} client(s) for user ${userId}`);
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message) {
    const data = JSON.stringify({
      type: 'broadcast',
      data: message,
      timestamp: new Date().toISOString(),
    });

    this.clients.forEach((userClients) => {
      userClients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });
    });
  }

  /**
   * Get connection statistics
   */
  getStats() {
    let totalConnections = 0;
    this.clients.forEach((userClients) => {
      totalConnections += userClients.size;
    });

    return {
      totalUsers: this.clients.size,
      totalConnections,
      users: Array.from(this.clients.keys()),
    };
  }

  /**
   * Close all connections
   */
  close() {
    if (this.wss) {
      this.clients.forEach((userClients) => {
        userClients.forEach((ws) => {
          ws.close();
        });
      });
      this.clients.clear();
      this.wss.close();
      console.log('✓ WebSocket server closed');
    }
  }
}

module.exports = new WebSocketService();
