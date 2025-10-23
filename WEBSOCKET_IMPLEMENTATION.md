# WebSocket Real-Time Updates - Implementation Complete

## Overview

The WebSocket infrastructure is now fully wired up to provide real-time task status updates from the worker to connected clients via the backend API.

## Architecture Flow

```
Worker Process → Redis Pub/Sub → Backend API → WebSocket → Client
```

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT (Future Frontend or test_websocket.js)                  │
│  Connected via: ws://localhost:8080?userId=<uuid>                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ WebSocket Connection
                             │ (Receives real-time updates)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND API (Node.js - Port 8080)                              │
│                                                                  │
│  1. Client uploads file → POST /api/tasks                       │
│     └─> Sends initial WebSocket update: "queued"                │
│                                                                  │
│  2. Subscribes to Redis channel: ocr:task:updates               │
│     └─> Forwards updates to connected WebSocket clients         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Redis Pub/Sub
                             │ Channel: ocr:task:updates
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  REDIS (Port 6379)                                              │
│                                                                  │
│  Pub/Sub Channel: ocr:task:updates                              │
│  - Receives status updates from worker                          │
│  - Broadcasts to all backend subscribers                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Worker publishes updates
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  WORKER (Python)                                                │
│                                                                  │
│  1. Dequeues task from Redis queue                              │
│  2. Updates status to "processing" → publishes to channel       │
│  3. Downloads file from S3                                      │
│  4. Runs OCR                                                    │
│  5. Uploads result to S3                                        │
│  6. Updates status to "completed" → publishes to channel        │
│     OR status to "failed" → publishes error                     │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. Backend Changes

#### `/backend/src/routes/tasks.routes.js`
**Added**: WebSocket update after enqueuing task

```javascript
// Import websocketService
const websocketService = require('../services/websocket.service');

// After enqueuing task to Redis
websocketService.sendTaskUpdate(userId, {
  taskId,
  fileId,
  filename: req.file.originalname,
  status: 'queued',
  queuePosition: queueStats.queued,
  message: 'Task queued for processing',
});
```

#### `/backend/src/services/redis.service.js`
**Added**: Pub/Sub channel constant

```javascript
// Pub/Sub channel for real-time task updates
this.TASK_UPDATES_CHANNEL = 'ocr:task:updates';
```

**Note**: `publishUpdate()` and `subscribe()` methods already existed.

#### `/backend/src/app.js`
**Added**: Subscribe to Redis Pub/Sub channel on startup

```javascript
// Subscribe to Redis Pub/Sub for task updates
await redisService.subscribe(redisService.TASK_UPDATES_CHANNEL, (message) => {
  console.log(`Received task update from Redis: ${message.taskId} - ${message.status}`);

  // Forward to WebSocket clients
  if (message.userId && message.taskId) {
    websocketService.sendTaskUpdate(message.userId, {
      taskId: message.taskId,
      status: message.status,
      message: message.message,
      progress: message.progress,
      error: message.error,
    });
  }
});
console.log('✓ Subscribed to Redis task updates channel');
```

#### `/backend/src/services/db.service.js`
**Fixed**: Database queries to use correct table structure

- Updated `getTaskById()` to join with `results` table for `s3_result_key`
- Updated `getTasksByUserId()` to use `original_filename`
- Updated `createFile()` to match database schema (original_filename, stored_filename, file_type)

### 2. Worker Changes

#### `/worker/config.py`
**Added**: Pub/Sub channel constant

```python
TASK_UPDATES_CHANNEL = 'ocr:task:updates'  # Real-time task status updates for WebSocket
```

#### `/worker/redis_client.py`
**Added**: New method `publish_task_update()`

```python
def publish_task_update(self, task_id: str, user_id: str, status: str,
                        message: str = None, progress: int = None, error: str = None) -> bool:
    """
    Publish real-time task status update to WebSocket channel.
    """
    update = {
        'taskId': task_id,
        'userId': user_id,
        'status': status,
    }

    if message:
        update['message'] = message
    if progress is not None:
        update['progress'] = progress
    if error:
        update['error'] = error

    message_json = json.dumps(update)
    subscribers = self.client.publish(Config.TASK_UPDATES_CHANNEL, message_json)
    logger.info(f"Published task update for {task_id} ({status}) to {subscribers} subscribers")

    return True
```

#### `/worker/task_processor.py`
**Modified**: `_update_status()` to publish WebSocket updates

```python
def _update_status(self, task_id: str, status: str, user_id: str = None, message: str = None):
    """
    Update task status in both database and Redis, and publish to WebSocket channel.
    """
    # ... database and Redis updates ...

    # Get user_id if not provided
    if not user_id:
        task = self.db_client.get_task(task_id)
        user_id = task.get('user_id') if task else None

    # Publish real-time update to WebSocket channel
    if user_id:
        status_messages = {
            'processing': 'OCR processing started',
            'completed': 'OCR processing completed successfully',
            'failed': 'OCR processing failed'
        }
        update_message = message or status_messages.get(status, f'Task status: {status}')
        self.redis_client.publish_task_update(
            task_id=task_id,
            user_id=user_id,
            status=status,
            message=update_message
        )
```

**Modified**: `process_single_task()` to pass user_id to status updates

```python
# Get task details from database (need user_id for status updates)
task = self.db_client.get_task(task_id)
user_id = task['user_id']

# Update status to processing
self._update_status(task_id, 'processing', user_id=user_id)

# ... processing ...

# Update status to completed
self._update_status(task_id, 'completed', user_id=user_id)
```

**Modified**: `_handle_task_failure()` to publish error updates

```python
# Get user_id for WebSocket update
task = self.db_client.get_task(task_id)
user_id = task.get('user_id') if task else None

# ... database updates ...

# Publish real-time update to WebSocket channel
if user_id:
    self.redis_client.publish_task_update(
        task_id=task_id,
        user_id=user_id,
        status='failed',
        message='OCR processing failed',
        error=error_message
    )
```

## Message Format

### WebSocket Message Structure

```json
{
  "type": "task_update",
  "data": {
    "taskId": "abc-123-def-456",
    "status": "processing",
    "message": "OCR processing started",
    "progress": 50,
    "error": null
  },
  "timestamp": "2025-10-17T14:30:00.000Z"
}
```

### Status Values

- `queued` - Task added to Redis queue
- `processing` - Worker started processing
- `completed` - OCR completed successfully
- `failed` - Processing failed with error

## Testing

### Test WebSocket Connection

```bash
# Terminal 1: Start all services
./start_services.sh

# Terminal 2: Connect WebSocket client
cd backend
node test_websocket.js

# Terminal 3: Upload a file to trigger task
cd backend
./test_task_creation.sh
```

### Expected Output in WebSocket Terminal

```
═══════════════════════════════════════════════════════════════
  WebSocket Connection Test
═══════════════════════════════════════════════════════════════

Connecting to: ws://localhost:8080?userId=11111111-1111-1111-1111-111111111111

✓ WebSocket connection established

Listening for task updates...
(Press Ctrl+C to exit)

[2025-10-17T14:30:00.000Z] CONNECTED
  User ID: 11111111-1111-1111-1111-111111111111

[2025-10-17T14:30:05.123Z] TASK_UPDATE
  Task ID: abc-123-def-456
  Status:  queued
  Message: Task queued for processing

[2025-10-17T14:30:06.456Z] TASK_UPDATE
  Task ID: abc-123-def-456
  Status:  processing
  Message: OCR processing started

[2025-10-17T14:30:15.789Z] TASK_UPDATE
  Task ID: abc-123-def-456
  Status:  completed
  Message: OCR processing completed successfully
```

## Database Schema Fixes

### Files Table
Uses correct columns matching schema:
- `original_filename` - User's original filename
- `stored_filename` - Stored filename (S3 key basename)
- `file_type` - Enum: pdf, image, document
- `s3_key` - Input file S3 path

### Results Table
Stores OCR results separately:
- `s3_result_key` - Result HTML S3 path
- `extracted_text` - OCR extracted text
- `confidence_score` - OCR confidence
- `word_count`, `page_count` - Statistics

### Query Updates
- `getTaskById()` joins with `results` table for complete information
- `getTasksByUserId()` uses `original_filename` alias
- `createFile()` inserts into correct columns with file type detection

## How It Works

### Step-by-Step Flow

1. **Client Uploads File**
   ```
   POST /api/tasks (file, userId)
   ```

2. **Backend Processes Upload**
   - Uploads to S3
   - Creates database records (files + tasks)
   - Enqueues to Redis
   - **Sends WebSocket update: "queued"**

3. **Worker Picks Up Task**
   - Dequeues from Redis (BRPOP)
   - **Publishes to Redis Pub/Sub: "processing"**
   - Backend receives and forwards to WebSocket clients

4. **Worker Processes**
   - Downloads from S3
   - Runs OCR
   - Uploads result to S3
   - **Publishes to Redis Pub/Sub: "completed"**
   - Backend receives and forwards to WebSocket clients

5. **Client Receives Updates**
   - Client WebSocket connection receives all status changes
   - UI can update in real-time without polling

### Redis Pub/Sub vs Queue

**Queue (ocr:task:queue)**:
- Used for task distribution (LPUSH/BRPOP)
- Worker-only, not for real-time updates
- Persistent until consumed

**Pub/Sub (ocr:task:updates)**:
- Used for broadcasting status updates
- Multiple subscribers (all backend instances)
- Fire-and-forget (not persistent)
- Backend forwards to WebSocket clients

## Benefits

✅ **No Polling** - Client gets instant updates via WebSocket
✅ **Scalable** - Multiple backend instances can subscribe to Redis
✅ **Decoupled** - Worker doesn't need to know about backend/WebSocket
✅ **Real-time** - Sub-second latency for status updates
✅ **Reliable** - Redis Pub/Sub is battle-tested and fast

## Future Enhancements

### Progress Updates
Add progress percentage during OCR:
```python
# In worker during OCR
self.redis_client.publish_task_update(
    task_id=task_id,
    user_id=user_id,
    status='processing',
    message='Processing page 3 of 10',
    progress=30
)
```

### User-Specific Channels
For high-volume systems, use per-user channels:
```javascript
// Backend subscribes to user-specific pattern
redisService.subscribe(`task:updates:${userId}`, callback);
```

### Reconnection Logic
Frontend should handle WebSocket reconnection:
```javascript
ws.onclose = () => {
  console.log('WebSocket closed, reconnecting...');
  setTimeout(connectWebSocket, 5000);
};
```

## Troubleshooting

### WebSocket Not Receiving Updates

**Check 1: Is Redis running?**
```bash
redis-cli ping
# Should return: PONG
```

**Check 2: Is backend subscribed?**
Look for in backend logs:
```
✓ Subscribed to Redis task updates channel
```

**Check 3: Is worker publishing?**
Look for in worker logs:
```
Published task update for <task_id> (processing) to 1 subscribers
```

**Check 4: Are clients connected?**
In backend logs:
```
WebSocket client connected: <user_id> (Total: 1)
```

### No Subscribers (0 subscribers)

If worker logs show "0 subscribers", it means:
- Backend hasn't started yet, or
- Backend crashed after startup, or
- Redis Pub/Sub subscription failed

**Solution**: Restart backend to re-establish subscription.

### Database Errors

If you see column errors like "column files.filename does not exist":
- Make sure you updated `db.service.js` with the schema fixes
- Restart backend to load new code

## Summary

The WebSocket infrastructure is now **fully functional**:

✅ Backend sends initial "queued" update
✅ Worker publishes status changes to Redis Pub/Sub
✅ Backend subscribes and forwards to WebSocket clients
✅ Database queries fixed to use correct schema
✅ Test script available (`test_websocket.js`)

Clients can now connect via WebSocket and receive real-time task updates throughout the entire OCR processing lifecycle!
