# Redis Setup for OCR Platform

Complete Redis configuration for task queuing, real-time notifications, and session management.

## Overview

Redis provides three critical services for the OCR platform:

1. **Task Queue** - FIFO queue for OCR jobs
2. **Pub/Sub** - Real-time notifications via WebSocket
3. **Session Storage** - User session management with expiry

## Prerequisites

- Redis 6.0+ (you have 8.2.2 installed)
- Basic understanding of Redis commands
- Node.js or Python Redis client

## Quick Start

### 1. Setup Redis

```bash
cd redis/scripts
./setup_redis.sh
```

This will:
- Check Redis installation
- Start Redis service
- Configure for OCR platform
- Generate `.env.redis` configuration

### 2. Test Redis

```bash
./test_redis.sh
```

Runs comprehensive tests on all operations.

### 3. Connect Manually

```bash
redis-cli
> PING
PONG
```

## Directory Structure

```
redis/
├── README.md                      # This file
├── config/
│   └── redis.conf                # Redis configuration
├── scripts/
│   ├── setup_redis.sh            # Setup script
│   └── start_redis.sh            # Manual start script
├── tests/
│   └── test_redis.sh             # Test suite
└── docs/
    └── data_structures.md        # Complete data structure guide
```

## Configuration

### Default Settings

| Setting | Value | Purpose |
|---------|-------|---------|
| Host | `127.0.0.1` | Localhost only (security) |
| Port | `6379` | Standard Redis port |
| Max Memory | `256mb` | Memory limit |
| Eviction Policy | `allkeys-lru` | Auto-evict old keys |
| Persistence | RDB snapshots | Periodic saves |

### Environment Variables

After running setup, these are in `.env.redis`:

```bash
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_URL=redis://127.0.0.1:6379

# Key prefixes
REDIS_TASK_QUEUE_PREFIX=ocr:task:queue
REDIS_TASK_DATA_PREFIX=ocr:task:data
REDIS_SESSION_PREFIX=ocr:session
REDIS_PUBSUB_CHANNEL=ocr:notifications
```

## Data Structures

### 1. Task Queue (LIST)

**Key**: `ocr:task:queue`

```javascript
// Add task to queue
await redis.lPush('ocr:task:queue', taskId);

// Get task (worker)
const taskId = await redis.rPop('ocr:task:queue');

// Block until task available
const result = await redis.brPop('ocr:task:queue', 5); // 5 sec timeout
```

**Characteristics**:
- FIFO (First In, First Out)
- Atomic operations
- Blocking pop for efficient workers

### 2. Task Metadata (HASH)

**Key**: `ocr:task:data:{task_id}`

```javascript
// Create task metadata
await redis.hSet(`ocr:task:data:${taskId}`, {
    user_id: userId,
    file_id: fileId,
    status: 'pending',
    priority: 5,
    created_at: Date.now()
});

// Get status
const status = await redis.hGet(`ocr:task:data:${taskId}`, 'status');

// Update status
await redis.hSet(`ocr:task:data:${taskId}`, 'status', 'processing');

// Increment attempts
await redis.hIncrBy(`ocr:task:data:${taskId}`, 'attempts', 1);
```

**Auto-cleanup**: Set expiry after completion
```javascript
await redis.expire(`ocr:task:data:${taskId}`, 86400); // 24 hours
```

### 3. Priority Queue (SORTED SET)

**Key**: `ocr:task:priority`

```javascript
// Add task with priority (0-10)
await redis.zAdd('ocr:task:priority', { score: 8, value: taskId });

// Get highest priority task
const result = await redis.zPopMax('ocr:task:priority');
// result = { value: 'task-id', score: 8 }

// Get all high-priority tasks (>= 7)
const tasks = await redis.zRangeByScore('ocr:task:priority', 7, '+inf');
```

### 4. Session Storage (STRING)

**Key**: `ocr:session:{session_token}`

```javascript
// Create session (7-day expiry)
const sessionData = {
    user_id: userId,
    email: user.email,
    role: user.role,
    created_at: Date.now(),
    last_activity: Date.now()
};

await redis.setEx(
    `ocr:session:${sessionToken}`,
    7 * 24 * 60 * 60, // 7 days
    JSON.stringify(sessionData)
);

// Get session
const sessionJson = await redis.get(`ocr:session:${sessionToken}`);
const session = JSON.parse(sessionJson);

// Delete session (logout)
await redis.del(`ocr:session:${sessionToken}`);

// Check idle timeout
const idleMinutes = (Date.now() - session.last_activity) / 60000;
if (idleMinutes > 30) {
    await redis.del(`ocr:session:${sessionToken}`);
}
```

### 5. Pub/Sub (PUBLISH/SUBSCRIBE)

**Channels**:
- `ocr:notifications` - General notifications
- `ocr:notifications:user:{user_id}` - User-specific
- `ocr:notifications:task:{task_id}` - Task-specific

```javascript
// Publisher (Worker)
await redis.publish('ocr:notifications', JSON.stringify({
    type: 'task_completed',
    task_id: taskId,
    user_id: userId,
    status: 'completed',
    timestamp: Date.now()
}));

// Subscriber (Backend WebSocket Server)
const subscriber = redis.createClient();
await subscriber.connect();

await subscriber.subscribe('ocr:notifications', (message) => {
    const notification = JSON.parse(message);
    // Broadcast to WebSocket clients
    io.to(notification.user_id).emit('task_update', notification);
});
```

### 6. System Statistics (COUNTERS)

```javascript
// Increment counters
await redis.incr('ocr:stats:tasks:total');
await redis.incr('ocr:stats:tasks:completed');

// Store daily stats
const today = new Date().toISOString().split('T')[0];
await redis.hSet(`ocr:stats:daily:${today}`, {
    tasks_completed: 45,
    tasks_failed: 2,
    avg_processing_time: 3500
});
```

## Common Operations

### Task Lifecycle

```javascript
// 1. User uploads file (Backend)
const taskId = uuid();
const multi = redis.multi();

multi.lPush('ocr:task:queue', taskId);
multi.hSet(`ocr:task:data:${taskId}`, {
    user_id: userId,
    file_id: fileId,
    status: 'pending',
    priority: 5,
    created_at: Date.now()
});
multi.incr('ocr:stats:tasks:total');

await multi.exec();

// 2. Worker picks up task
const taskId = await redis.brPop('ocr:task:queue', 5);

// Update to processing
await redis.hSet(`ocr:task:data:${taskId}`, {
    status: 'processing',
    worker_id: 'worker-001',
    started_at: Date.now()
});

// 3. Worker completes
await redis.hSet(`ocr:task:data:${taskId}`, {
    status: 'completed',
    completed_at: Date.now()
});

// Notify users
await redis.publish('ocr:notifications', JSON.stringify({
    type: 'task_completed',
    task_id: taskId,
    user_id: userId
}));

// Increment stats
await redis.incr('ocr:stats:tasks:completed');

// Auto-cleanup after 24 hours
await redis.expire(`ocr:task:data:${taskId}`, 86400);
```

### Session Management

```javascript
// Login
const sessionToken = crypto.randomBytes(32).toString('hex');
await redis.setEx(`ocr:session:${sessionToken}`, 604800, JSON.stringify({
    user_id: userId,
    email: user.email,
    last_activity: Date.now()
}));

// Authenticate request (middleware)
const sessionJson = await redis.get(`ocr:session:${token}`);
if (!sessionJson) throw new Error('Invalid session');

const session = JSON.parse(sessionJson);

// Check idle timeout (30 min)
const idleMinutes = (Date.now() - session.last_activity) / 60000;
if (idleMinutes > 30) {
    await redis.del(`ocr:session:${token}`);
    throw new Error('Session expired due to inactivity');
}

// Update last activity
session.last_activity = Date.now();
await redis.setEx(`ocr:session:${token}`, 604800, JSON.stringify(session));

// Logout
await redis.del(`ocr:session:${token}`);

// Logout from all devices
const cursor = '0';
for await (const key of redis.scanIterator({ MATCH: 'ocr:session:*' })) {
    const sessionData = await redis.get(key);
    const session = JSON.parse(sessionData);
    if (session.user_id === userId) {
        await redis.del(key);
    }
}
```

## Integration Examples

### Node.js (with node-redis)

```javascript
const redis = require('redis');

const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

await client.connect();

// Use Redis
await client.lPush('ocr:task:queue', taskId);

// Cleanup
await client.quit();
```

### Python (with redis-py)

```python
import redis
import json

r = redis.Redis(host='127.0.0.1', port=6379, decode_responses=True)

# Add task to queue
r.lpush('ocr:task:queue', task_id)

# Get task
task_id = r.rpop('ocr:task:queue')

# Publish notification
notification = {
    'type': 'task_completed',
    'task_id': task_id,
    'user_id': user_id
}
r.publish('ocr:notifications', json.dumps(notification))
```

## Management

### Start/Stop Redis

**macOS (Homebrew)**:
```bash
brew services start redis
brew services stop redis
brew services restart redis
```

**Linux (systemd)**:
```bash
sudo systemctl start redis
sudo systemctl stop redis
sudo systemctl restart redis
```

### Monitor Redis

```bash
# Real-time stats
redis-cli --stat

# Monitor commands
redis-cli MONITOR

# Check memory
redis-cli INFO memory

# View slow queries
redis-cli SLOWLOG get 10

# Check clients
redis-cli CLIENT LIST
```

### Cleanup

```bash
# Delete all keys (DANGER!)
redis-cli FLUSHALL

# Delete specific pattern
redis-cli --scan --pattern 'ocr:task:data:*' | xargs redis-cli DEL

# Delete expired sessions
redis-cli --scan --pattern 'ocr:session:*' | while read key; do
    if [ $(redis-cli TTL "$key") -lt 0 ]; then
        redis-cli DEL "$key"
    fi
done
```

### Backup

```bash
# Save snapshot
redis-cli SAVE

# Background save
redis-cli BGSAVE

# Get dump file location
redis-cli CONFIG GET dir

# Copy dump.rdb to backup
cp /path/to/dump.rdb /backups/redis_$(date +%Y%m%d).rdb
```

## Performance Tips

1. **Use pipelining** for multiple commands:
```javascript
const pipeline = client.pipeline();
pipeline.get('key1');
pipeline.get('key2');
const results = await pipeline.exec();
```

2. **Use SCAN instead of KEYS** (production):
```javascript
// Bad - blocks Redis
const keys = await client.keys('ocr:session:*');

// Good - cursor-based
for await (const key of client.scanIterator({ MATCH: 'ocr:session:*' })) {
    console.log(key);
}
```

3. **Use BRPOP** instead of polling:
```javascript
// Bad - wastes CPU
while (true) {
    const task = await redis.rPop('queue');
    if (!task) await sleep(1000);
}

// Good - blocks efficiently
while (true) {
    const result = await redis.brPop('queue', 5);
    if (result) await processTask(result.element);
}
```

4. **Use transactions** for atomic operations:
```javascript
const multi = redis.multi();
multi.lPush('queue', taskId);
multi.hSet(`task:${taskId}`, { status: 'pending' });
multi.incr('stats:total');
await multi.exec();
```

5. **Set expiry** on temporary data:
```javascript
await redis.setEx('cache:user:123', 300, JSON.stringify(user)); // 5 min
```

## Troubleshooting

### Redis not starting

```bash
# Check if already running
ps aux | grep redis

# Check logs (macOS)
tail -f /opt/homebrew/var/log/redis.log

# Check logs (Linux)
sudo journalctl -u redis -f

# Check port availability
lsof -i :6379
```

### Connection refused

```bash
# Check Redis is running
redis-cli ping

# Check configuration
redis-cli CONFIG GET bind

# Restart Redis
brew services restart redis  # macOS
sudo systemctl restart redis # Linux
```

### Out of memory

```bash
# Check memory usage
redis-cli INFO memory

# Check maxmemory setting
redis-cli CONFIG GET maxmemory

# Increase maxmemory
redis-cli CONFIG SET maxmemory 512mb

# Clear database (DANGER!)
redis-cli FLUSHDB
```

### Slow queries

```bash
# View slow log
redis-cli SLOWLOG get 10

# Set slow log threshold (microseconds)
redis-cli CONFIG SET slowlog-log-slower-than 10000

# Common causes:
# - KEYS command (use SCAN)
# - Large lists/sets
# - No expiry on temporary data
```

## Security (Production)

### 1. Set password

```bash
redis-cli CONFIG SET requirepass "your_secure_password"
```

Update `.env.redis`:
```bash
REDIS_URL=redis://:your_secure_password@127.0.0.1:6379
```

### 2. Bind to localhost only

In `redis.conf`:
```
bind 127.0.0.1
protected-mode yes
```

### 3. Disable dangerous commands

In `redis.conf`:
```
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

### 4. Enable persistence

In `redis.conf`:
```
appendonly yes
appendfsync everysec
```

### 5. Use TLS (for remote connections)

Not needed for localhost, but for production:
```
tls-port 6380
tls-cert-file /path/to/redis.crt
tls-key-file /path/to/redis.key
```

## Documentation

- **Full data structure guide**: `redis/docs/data_structures.md`
- **Test suite**: `redis/tests/test_redis.sh`
- **Configuration**: `redis/config/redis.conf`

## Resources

- [Redis Documentation](https://redis.io/documentation)
- [Redis Commands](https://redis.io/commands)
- [node-redis](https://github.com/redis/node-redis)
- [redis-py](https://github.com/redis/redis-py)

## Next Steps

1. ✅ Redis setup complete
2. ✅ Data structures documented
3. ⏭️ Integrate with backend API
4. ⏭️ Implement task queue workers
5. ⏭️ Set up WebSocket pub/sub

---

**Redis Version**: 8.2.2
**Platform**: macOS/Linux
**Last Updated**: October 14, 2024
