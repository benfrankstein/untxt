# Redis Data Structures and Key Naming Conventions

Complete guide to Redis data structures used in the OCR Platform.

## Key Naming Conventions

All keys follow a hierarchical namespace pattern: `ocr:<entity>:<type>:<id>`

### Prefix Structure

```
ocr:           - Application namespace
  task:        - Task-related data
    queue      - Task queue (list)
    data:*     - Task metadata (hash)
    priority   - Priority queue (sorted set)
  session:*    - User sessions (string with expiry)
  stats:*      - System statistics (string/hash)
  pubsub:*     - Pub/Sub channels
  cache:*      - Cached data
```

---

## 1. Task Queue (List)

**Purpose**: FIFO queue for pending OCR tasks

### Key Pattern
```
ocr:task:queue
```

### Data Structure: LIST
```
[ task_id_1, task_id_2, task_id_3, ... ]
```

### Operations

**Add task to queue** (backend):
```redis
LPUSH ocr:task:queue "task-uuid-123"
```

**Get task for processing** (worker):
```redis
RPOP ocr:task:queue
# Returns: "task-uuid-123"
```

**Check queue length**:
```redis
LLEN ocr:task:queue
# Returns: 5
```

**View queue without removing**:
```redis
LRANGE ocr:task:queue 0 -1
# Returns all task IDs
```

**Block until task available** (efficient worker):
```redis
BRPOP ocr:task:queue 5
# Blocks for 5 seconds, returns task or null
```

### Node.js Example
```javascript
const redis = require('redis');
const client = redis.createClient();

// Enqueue task
await client.lPush('ocr:task:queue', taskId);

// Dequeue task (worker)
const taskId = await client.rPop('ocr:task:queue');

// Blocking dequeue (more efficient)
const result = await client.brPop('ocr:task:queue', 5); // 5 sec timeout
if (result) {
    const taskId = result.element;
    // Process task
}
```

---

## 2. Task Metadata (Hash)

**Purpose**: Store task details and progress

### Key Pattern
```
ocr:task:data:{task_id}
```

### Data Structure: HASH
```redis
{
    "user_id": "user-uuid-abc",
    "file_id": "file-uuid-xyz",
    "status": "processing",
    "priority": "5",
    "attempts": "1",
    "worker_id": "worker-001",
    "created_at": "1697040000",
    "started_at": "1697040120"
}
```

### Operations

**Create task metadata**:
```redis
HSET ocr:task:data:123 user_id "user-abc" file_id "file-xyz" status "pending" priority 5
```

**Get single field**:
```redis
HGET ocr:task:data:123 status
# Returns: "pending"
```

**Get all fields**:
```redis
HGETALL ocr:task:data:123
# Returns all key-value pairs
```

**Update status**:
```redis
HSET ocr:task:data:123 status "processing" started_at "1697040120"
```

**Increment attempts**:
```redis
HINCRBY ocr:task:data:123 attempts 1
# Returns: 2
```

**Delete task metadata**:
```redis
DEL ocr:task:data:123
```

**Set expiry** (auto-cleanup after completion):
```redis
EXPIRE ocr:task:data:123 86400
# Expires in 24 hours
```

### Node.js Example
```javascript
// Create task metadata
await client.hSet(`ocr:task:data:${taskId}`, {
    user_id: userId,
    file_id: fileId,
    status: 'pending',
    priority: 5,
    created_at: Date.now()
});

// Update status
await client.hSet(`ocr:task:data:${taskId}`, 'status', 'processing');

// Get all metadata
const taskData = await client.hGetAll(`ocr:task:data:${taskId}`);

// Increment attempts
await client.hIncrBy(`ocr:task:data:${taskId}`, 'attempts', 1);
```

---

## 3. Priority Queue (Sorted Set)

**Purpose**: Tasks ordered by priority (higher = more urgent)

### Key Pattern
```
ocr:task:priority
```

### Data Structure: SORTED SET
```redis
{
    "task-uuid-1": 3,   # Priority 3 (low)
    "task-uuid-2": 5,   # Priority 5 (medium)
    "task-uuid-3": 8,   # Priority 8 (high)
    "task-uuid-4": 10   # Priority 10 (urgent)
}
```

### Operations

**Add task with priority**:
```redis
ZADD ocr:task:priority 8 "task-uuid-123"
# Priority 8
```

**Get highest priority task**:
```redis
ZPOPMAX ocr:task:priority
# Returns: ["task-uuid-4", 10]
```

**Get lowest priority task**:
```redis
ZPOPMIN ocr:task:priority
# Returns: ["task-uuid-1", 3]
```

**View all tasks by priority (ascending)**:
```redis
ZRANGE ocr:task:priority 0 -1 WITHSCORES
```

**View all tasks by priority (descending)**:
```redis
ZREVRANGE ocr:task:priority 0 -1 WITHSCORES
```

**Get tasks with priority >= 7**:
```redis
ZRANGEBYSCORE ocr:task:priority 7 +inf
```

**Count tasks in queue**:
```redis
ZCARD ocr:task:priority
# Returns: 15
```

**Update task priority**:
```redis
ZADD ocr:task:priority 9 "task-uuid-123"
# Updates priority to 9
```

### Node.js Example
```javascript
// Add task with priority
await client.zAdd('ocr:task:priority', { score: 8, value: taskId });

// Get highest priority task
const result = await client.zPopMax('ocr:task:priority');
const taskId = result.value;
const priority = result.score;

// Get all high-priority tasks (>= 7)
const highPriorityTasks = await client.zRangeByScore('ocr:task:priority', 7, '+inf');
```

---

## 4. Session Storage (String with Expiry)

**Purpose**: Store user session tokens with automatic expiry

### Key Pattern
```
ocr:session:{session_token}
```

### Data Structure: STRING (JSON)
```json
{
    "user_id": "user-uuid-abc",
    "email": "user@example.com",
    "role": "user",
    "ip_address": "192.168.1.10",
    "created_at": 1697040000,
    "last_activity": 1697040120
}
```

### Operations

**Create session** (with 7-day expiry):
```redis
SETEX ocr:session:abc123def456 604800 '{"user_id":"user-abc","role":"user"}'
# 604800 seconds = 7 days
```

**Get session**:
```redis
GET ocr:session:abc123def456
# Returns JSON string
```

**Update last activity** (refresh expiry):
```redis
SET ocr:session:abc123def456 '{"user_id":"user-abc","last_activity":1697040200}' EX 604800
```

**Delete session (logout)**:
```redis
DEL ocr:session:abc123def456
```

**Check if session exists**:
```redis
EXISTS ocr:session:abc123def456
# Returns: 1 (exists) or 0 (doesn't exist)
```

**Get remaining TTL**:
```redis
TTL ocr:session:abc123def456
# Returns: seconds until expiry
```

**Delete all user sessions** (logout from all devices):
```redis
SCAN 0 MATCH ocr:session:* COUNT 100
# Then filter by user_id and delete
```

### Node.js Example
```javascript
// Create session with 7-day expiry
const sessionData = {
    user_id: userId,
    email: user.email,
    role: user.role,
    created_at: Date.now()
};

await client.setEx(
    `ocr:session:${sessionToken}`,
    7 * 24 * 60 * 60, // 7 days
    JSON.stringify(sessionData)
);

// Get and parse session
const sessionJson = await client.get(`ocr:session:${sessionToken}`);
const session = JSON.parse(sessionJson);

// Delete session
await client.del(`ocr:session:${sessionToken}`);

// Check session validity with idle timeout
const sessionJson = await client.get(`ocr:session:${token}`);
if (sessionJson) {
    const session = JSON.parse(sessionJson);
    const idleMinutes = (Date.now() - session.last_activity) / 60000;

    if (idleMinutes > 30) {
        // Idle timeout exceeded
        await client.del(`ocr:session:${token}`);
        throw new Error('Session expired due to inactivity');
    }

    // Update last activity
    session.last_activity = Date.now();
    await client.setEx(`ocr:session:${token}`, 604800, JSON.stringify(session));
}
```

---

## 5. Pub/Sub Channels

**Purpose**: Real-time notifications for task completion

### Channel Patterns
```
ocr:notifications           - General notifications
ocr:notifications:user:{id} - User-specific notifications
ocr:notifications:task:{id} - Task-specific updates
```

### Message Format (JSON)
```json
{
    "type": "task_completed",
    "task_id": "task-uuid-123",
    "user_id": "user-uuid-abc",
    "status": "completed",
    "result": {
        "confidence": 0.95,
        "word_count": 245
    },
    "timestamp": 1697040240
}
```

### Operations

**Publish notification**:
```redis
PUBLISH ocr:notifications '{"type":"task_completed","task_id":"123"}'
# Returns: number of subscribers
```

**Subscribe to channel**:
```redis
SUBSCRIBE ocr:notifications
```

**Subscribe to user-specific channel**:
```redis
SUBSCRIBE ocr:notifications:user:abc123
```

**Pattern subscribe** (wildcard):
```redis
PSUBSCRIBE ocr:notifications:*
# Subscribes to all notification channels
```

### Node.js Example
```javascript
// Publisher (Worker)
const notification = {
    type: 'task_completed',
    task_id: taskId,
    user_id: userId,
    status: 'completed',
    timestamp: Date.now()
};

await client.publish('ocr:notifications', JSON.stringify(notification));
await client.publish(`ocr:notifications:user:${userId}`, JSON.stringify(notification));

// Subscriber (Backend WebSocket Server)
const subscriber = redis.createClient();

subscriber.subscribe('ocr:notifications', (message) => {
    const notification = JSON.parse(message);

    // Broadcast to connected WebSocket clients
    io.to(notification.user_id).emit('task_update', notification);
});
```

---

## 6. System Statistics (Counters & Hashes)

**Purpose**: Track system metrics and statistics

### Key Patterns
```
ocr:stats:tasks:total          - Counter
ocr:stats:tasks:completed      - Counter
ocr:stats:tasks:failed         - Counter
ocr:stats:users:active         - Counter
ocr:stats:daily:{date}         - Hash (daily stats)
```

### Operations

**Increment counter**:
```redis
INCR ocr:stats:tasks:total
# Returns: 1, 2, 3...
```

**Increment by N**:
```redis
INCRBY ocr:stats:tasks:completed 5
# Adds 5 to counter
```

**Decrement**:
```redis
DECR ocr:stats:tasks:pending
```

**Get counter value**:
```redis
GET ocr:stats:tasks:total
# Returns: "150"
```

**Store daily stats** (hash):
```redis
HSET ocr:stats:daily:2024-10-14 tasks_completed 45 tasks_failed 2 avg_processing_time 3500
```

**Get daily stats**:
```redis
HGETALL ocr:stats:daily:2024-10-14
```

**Set expiry on old stats**:
```redis
EXPIRE ocr:stats:daily:2024-09-14 2592000
# Expire after 30 days
```

### Node.js Example
```javascript
// Increment task counters
await client.incr('ocr:stats:tasks:total');
await client.incr('ocr:stats:tasks:completed');

// Store daily stats
const today = new Date().toISOString().split('T')[0];
await client.hSet(`ocr:stats:daily:${today}`, {
    tasks_completed: 45,
    tasks_failed: 2,
    avg_processing_time: 3500
});

// Get all stats
const stats = {
    total: await client.get('ocr:stats:tasks:total'),
    completed: await client.get('ocr:stats:tasks:completed'),
    today: await client.hGetAll(`ocr:stats:daily:${today}`)
};
```

---

## 7. Caching (String with Expiry)

**Purpose**: Cache frequently accessed data

### Key Patterns
```
ocr:cache:user:{user_id}           - User data (5 min)
ocr:cache:file:{file_id}           - File metadata (10 min)
ocr:cache:result:{task_id}         - OCR results (1 hour)
```

### Operations

**Cache user data**:
```redis
SETEX ocr:cache:user:abc123 300 '{"username":"john","role":"user"}'
# Expires in 5 minutes
```

**Get cached data**:
```redis
GET ocr:cache:user:abc123
```

**Invalidate cache**:
```redis
DEL ocr:cache:user:abc123
```

**Invalidate all user caches**:
```redis
KEYS ocr:cache:user:*
# Then DEL each key (or use SCAN in production)
```

### Node.js Example
```javascript
// Cache with read-through pattern
async function getUser(userId) {
    // Try cache first
    const cached = await client.get(`ocr:cache:user:${userId}`);
    if (cached) return JSON.parse(cached);

    // Cache miss - fetch from database
    const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

    // Store in cache for 5 minutes
    await client.setEx(`ocr:cache:user:${userId}`, 300, JSON.stringify(user));

    return user;
}

// Invalidate on update
async function updateUser(userId, data) {
    await db.query('UPDATE users SET ... WHERE id = $1', [userId]);
    await client.del(`ocr:cache:user:${userId}`);
}
```

---

## 8. Transactions (MULTI/EXEC)

**Purpose**: Atomic operations (all-or-nothing)

### Example: Task Creation
```redis
MULTI
LPUSH ocr:task:queue "task-123"
HSET ocr:task:data:123 status "pending" created_at "1697040000"
INCR ocr:stats:tasks:total
EXEC
```

### Node.js Example
```javascript
// Create task atomically
const multi = client.multi();

multi.lPush('ocr:task:queue', taskId);
multi.hSet(`ocr:task:data:${taskId}`, { status: 'pending', user_id: userId });
multi.incr('ocr:stats:tasks:total');

const results = await multi.exec();
// All commands executed atomically
```

---

## Key Expiry Strategy

| Key Type | TTL | Reason |
|----------|-----|--------|
| `ocr:task:queue` | No expiry | Active queue |
| `ocr:task:data:{id}` | 24 hours after completion | Cleanup old tasks |
| `ocr:session:{token}` | 7 days | Session timeout |
| `ocr:cache:*` | 5-60 minutes | Fresh data |
| `ocr:stats:daily:{date}` | 30 days | Historical data |

---

## Memory Management

**Eviction Policy**: `allkeys-lru` (Least Recently Used)

When Redis reaches max memory, it evicts least recently used keys automatically.

**Monitor memory**:
```redis
INFO memory
```

**Get key size**:
```redis
MEMORY USAGE ocr:task:data:123
```

---

## Performance Tips

1. **Use pipelining** for multiple commands:
```javascript
const pipeline = client.pipeline();
pipeline.get('key1');
pipeline.get('key2');
const results = await pipeline.exec();
```

2. **Use SCAN instead of KEYS** in production:
```javascript
// Bad (blocks Redis)
const keys = await client.keys('ocr:session:*');

// Good (cursor-based)
for await (const key of client.scanIterator({ MATCH: 'ocr:session:*' })) {
    console.log(key);
}
```

3. **Use BRPOP instead of polling**:
```javascript
// Bad (wastes CPU)
while (true) {
    const task = await client.rPop('ocr:task:queue');
    if (!task) await sleep(1000);
}

// Good (blocks efficiently)
while (true) {
    const result = await client.brPop('ocr:task:queue', 5);
    if (result) processTask(result.element);
}
```

---

## Complete Example: Task Lifecycle

```javascript
// 1. User uploads file (Backend)
const taskId = uuid();
const multi = client.multi();

// Add to queue and create metadata
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
const taskId = await client.brPop('ocr:task:queue', 5);

// Update status to processing
await client.hSet(`ocr:task:data:${taskId}`, {
    status: 'processing',
    worker_id: 'worker-001',
    started_at: Date.now()
});

// 3. Worker completes processing
await client.hSet(`ocr:task:data:${taskId}`, {
    status: 'completed',
    completed_at: Date.now()
});

// Publish notification
await client.publish('ocr:notifications', JSON.stringify({
    type: 'task_completed',
    task_id: taskId,
    user_id: userId
}));

// Increment stats
await client.incr('ocr:stats:tasks:completed');

// Set expiry (cleanup after 24 hours)
await client.expire(`ocr:task:data:${taskId}`, 86400);
```

---

This covers all Redis data structures and patterns used in the OCR Platform!
