# Expected Output: start_services.sh

This document shows exactly what you should see when running `./start_services.sh`.

## Prerequisites

Before running the script, ensure:
- PostgreSQL is installed and database `ocr_platform_dev` exists (Phase 1 setup complete)
- Redis is installed
- Python virtual environment exists at `venv/`
- You're in the project root: `/Users/benfrankstein/Projects/untxt`

## Running the Script

```bash
cd /Users/benfrankstein/Projects/untxt
./start_services.sh
```

## Expected Output (Step by Step)

### Initial Header

```
═══════════════════════════════════════════════════════════════
  OCR Platform - Starting All Services
═══════════════════════════════════════════════════════════════

Project root: /Users/benfrankstein/Projects/untxt

```

### Phase 1.1: PostgreSQL

**If PostgreSQL is already running:**
```
═══════════════════════════════════════════════════════════════
  Phase 1.1: Starting PostgreSQL
═══════════════════════════════════════════════════════════════
✓ PostgreSQL is already running
✓ Database 'ocr_platform_dev' is accessible
```

**If PostgreSQL needs to be started:**
```
═══════════════════════════════════════════════════════════════
  Phase 1.1: Starting PostgreSQL
═══════════════════════════════════════════════════════════════
→ Starting PostgreSQL...
→ Waiting for PostgreSQL to be ready...
✓ PostgreSQL is ready
✓ Database 'ocr_platform_dev' is accessible
```

### Phase 1.2: Redis

**If Redis is already running:**
```
═══════════════════════════════════════════════════════════════
  Phase 1.2: Starting Redis
═══════════════════════════════════════════════════════════════
✓ Redis is already running
```

**If Redis needs to be started:**
```
═══════════════════════════════════════════════════════════════
  Phase 1.2: Starting Redis
═══════════════════════════════════════════════════════════════
→ Starting Redis server...
→ Waiting for Redis to be ready...
✓ Redis is ready
✓ Redis server started (PID: 12345)
```

### Phase 2.1: OCR Worker

**First time (installing dependencies):**
```
═══════════════════════════════════════════════════════════════
  Phase 2.1: Starting OCR Worker
═══════════════════════════════════════════════════════════════
→ Installing worker dependencies...
→ Testing connections...
→ Starting worker process...
✓ Worker started (PID: 12346)
→ Logs: /Users/benfrankstein/Projects/untxt/logs/worker.log
```

**Subsequent runs:**
```
═══════════════════════════════════════════════════════════════
  Phase 2.1: Starting OCR Worker
═══════════════════════════════════════════════════════════════
→ Testing connections...
→ Starting worker process...
✓ Worker started (PID: 12347)
→ Logs: /Users/benfrankstein/Projects/untxt/logs/worker.log
```

### Phase 2.2: Flask Server

```
═══════════════════════════════════════════════════════════════
  Phase 2.2: Starting Flask Health Check Server
═══════════════════════════════════════════════════════════════
→ Starting Flask server on port 5000...
✓ Flask server started (PID: 12348)
→ Health check: http://localhost:5000/health
→ Logs: /Users/benfrankstein/Projects/untxt/logs/flask.log
```

### Service Status Summary

```
═══════════════════════════════════════════════════════════════
  Service Status
═══════════════════════════════════════════════════════════════
✓ PostgreSQL: Running
✓ Redis: Running (Queue length: 0)
✓ Worker: Running (PID: 12347)
✓ Flask: Running (PID: 12348)

→ Logs directory: /Users/benfrankstein/Projects/untxt/logs
→ PID directory: /Users/benfrankstein/Projects/untxt/pids
```

### Final Summary

```
═══════════════════════════════════════════════════════════════
  All Services Started Successfully!
═══════════════════════════════════════════════════════════════

→ Service URLs:
  • Flask Health Check: http://localhost:5000/health
  • Flask Status:       http://localhost:5000/status

→ Useful Commands:
  • View worker logs:   tail -f /Users/benfrankstein/Projects/untxt/logs/worker.log
  • View flask logs:    tail -f /Users/benfrankstein/Projects/untxt/logs/flask.log
  • Check queue:        redis-cli LLEN ocr:task:queue
  • Stop all services:  ./stop_services.sh

→ To test the worker, run:
  ./test_worker.sh

```

## What's Running in the Background

After the script completes, you'll have **4 background processes**:

### 1. PostgreSQL (if started by script)
- **Process:** `postgres`
- **Port:** 5432 (localhost only)
- **Status:** Check with `pg_isready`
- **Managed by:** brew services (macOS) or systemd (Linux)

### 2. Redis
- **Process:** `redis-server`
- **Port:** 6379 (localhost only)
- **PID File:** `pids/redis.pid`
- **Log File:** `logs/redis.log`
- **Status:** Check with `redis-cli ping`

### 3. OCR Worker
- **Process:** `python run_worker.py`
- **Port:** None (consumer only)
- **PID File:** `pids/worker.pid`
- **Log File:** `logs/worker.log`
- **Status:** Check with `kill -0 $(cat pids/worker.pid)`

### 4. Flask Health Check Server
- **Process:** `python app.py`
- **Port:** 5000 (localhost only)
- **PID File:** `pids/flask.pid`
- **Log File:** `logs/flask.log`
- **Status:** Check with `curl http://localhost:5000/health`

## How to Verify Services

### Check All Services at Once
```bash
./status.sh
```

### Check Individual Services

**PostgreSQL:**
```bash
pg_isready
# Expected: /tmp:5432 - accepting connections
```

**Redis:**
```bash
redis-cli ping
# Expected: PONG
```

**Worker:**
```bash
tail -n 20 logs/worker.log
# Expected: Should see "Worker worker-001 starting main loop"
```

**Flask:**
```bash
curl http://localhost:5000/health
# Expected: {"status":"healthy","worker_id":"worker-001",...}
```

## Directory Structure After Running

```
untxt/
├── logs/                       ← Created automatically
│   ├── redis.log              ← Redis server logs
│   ├── worker.log             ← Worker process logs
│   └── flask.log              ← Flask server logs
├── pids/                       ← Created automatically
│   ├── redis.pid              ← Redis process ID
│   ├── worker.pid             ← Worker process ID
│   └── flask.pid              ← Flask process ID
├── output/                     ← Created automatically
│   └── (empty until tasks are processed)
└── worker/
    └── worker.log             ← Additional worker log (if any)
```

## Worker Log Output

When you check `logs/worker.log`, you should see:

```
2024-10-16 14:30:22,123 - __main__ - INFO - ============================================================
2024-10-16 14:30:22,123 - __main__ - INFO - OCR Worker Starting
2024-10-16 14:30:22,123 - __main__ - INFO - ============================================================
2024-10-16 14:30:22,145 - task_processor - INFO - Worker worker-001 initialized
2024-10-16 14:30:22,145 - task_processor - INFO - Model info: {'name': 'Qwen3-VL-3B', 'version': 'v1.0-simulated', 'mode': 'simulation', 'description': 'Simulated Qwen3 output for local development'}
2024-10-16 14:30:22,156 - redis_client - INFO - Redis client connected to localhost:6379
2024-10-16 14:30:22,178 - db_client - INFO - Database connected: localhost:5432/ocr_platform_dev
2024-10-16 14:30:22,189 - task_processor - INFO - Worker worker-001 starting main loop
```

The worker is now **blocking on the Redis queue**, waiting for tasks. It's idle but ready.

## Flask Log Output

When you check `logs/flask.log`, you should see:

```
2024-10-16 14:30:25,234 - __main__ - INFO - Worker worker-001 initialized
2024-10-16 14:30:25,234 - __main__ - INFO - Redis: localhost:6379
2024-10-16 14:30:25,234 - __main__ - INFO - Database: localhost:5432/ocr_platform_dev
2024-10-16 14:30:25,234 - __main__ - INFO - Output directory: /Users/benfrankstein/Projects/untxt/output
2024-10-16 14:30:25,345 - __main__ - INFO - Starting Flask worker on port 5000
 * Serving Flask app 'app'
 * Debug mode: on
WARNING: This is a development server. Do not use it in production.
 * Running on http://127.0.0.1:5000
 * Press CTRL+C to quit
```

## Testing the Setup

### 1. Quick Health Check
```bash
curl http://localhost:5000/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "worker_id": "worker-001",
  "timestamp": "2024-10-16T14:30:25.123456",
  "service": "OCR Worker",
  "version": "1.0.0"
}
```

### 2. Check Queue Status
```bash
redis-cli LLEN ocr:task:queue
```

**Expected Response:**
```
(integer) 0
```

### 3. Run End-to-End Test
```bash
./test_worker.sh
```

This will create a test task and process it end-to-end. See separate section below.

## Common Issues and Solutions

### Issue: "PostgreSQL not found"

**Output:**
```
✗ PostgreSQL not found. Please install it first.
```

**Solution:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

### Issue: "Redis not found"

**Output:**
```
✗ Redis not found. Please install it first.
```

**Solution:**
```bash
brew install redis
```

### Issue: "Database 'ocr_platform_dev' not found"

**Output:**
```
✗ Database 'ocr_platform_dev' not found. Run database setup first.
```

**Solution:**
```bash
cd database/scripts
./setup_database.sh
cd ../..
./start_services.sh
```

### Issue: "Connection test failed"

**Output:**
```
✗ Connection test failed. Check Redis and PostgreSQL.
```

**Solution:**
```bash
# Check PostgreSQL
pg_isready

# Check Redis
redis-cli ping

# If either fails, restart:
./stop_services.sh
./start_services.sh
```

### Issue: "Worker failed to start"

**Output:**
```
✗ Worker failed to start. Check logs: /path/to/logs/worker.log
```

**Solution:**
```bash
# Check the log file
cat logs/worker.log

# Common fixes:
cd worker
source ../venv/bin/activate
pip install -r requirements.txt
```

### Issue: Port 5000 already in use

**Output:**
```
✗ Flask server failed to start. Check logs: /path/to/logs/flask.log
```

**Log shows:**
```
OSError: [Errno 48] Address already in use
```

**Solution:**
```bash
# Find what's using port 5000
lsof -i :5000

# Kill it
kill -9 <PID>

# Restart
./start_services.sh
```

## What Happens Next?

After all services are running:

1. **Worker is idle** - Waiting for tasks on Redis queue (`ocr:task:queue`)
2. **Flask is listening** - Health check endpoint available at `http://localhost:5000/health`
3. **Redis is ready** - Queue is empty, ready to receive tasks
4. **PostgreSQL is ready** - Database is accessible and ready for reads/writes

### To Process a Task

Option 1: **Use the test script**
```bash
./test_worker.sh
```

Option 2: **Manual test**
```bash
# 1. Create task in database (using psql)
# 2. Add task ID to Redis queue
redis-cli LPUSH ocr:task:queue "your-task-uuid"

# 3. Watch worker process it
tail -f logs/worker.log
```

## Performance Expectations

- **Startup time:** 5-10 seconds
- **Memory usage:**
  - PostgreSQL: ~50-100 MB
  - Redis: ~10-20 MB
  - Worker: ~50-100 MB (without model)
  - Flask: ~30-50 MB
  - **Total:** ~150-300 MB

- **CPU usage:** Near 0% when idle
- **Network:** All services on localhost only (no external exposure)

## Stopping Services

When you're done:

```bash
./stop_services.sh
```

**Expected output:**
```
═══════════════════════════════════════════════════════════════
  OCR Platform - Stopping All Services
═══════════════════════════════════════════════════════════════

→ Stopping Flask Health Check Server (PID: 12348)...
✓ Flask Health Check Server stopped

→ Stopping OCR Worker (PID: 12347)...
✓ OCR Worker stopped

→ Stopping Redis...
✓ Redis stopped

→ PostgreSQL management:
  • PostgreSQL is typically left running for development
  • To stop: brew services stop postgresql@16

═══════════════════════════════════════════════════════════════
  All Services Stopped
═══════════════════════════════════════════════════════════════

→ To restart services, run: ./start_services.sh
```

## Summary

After running `./start_services.sh`:

✅ **4 background processes running**
✅ **3 directories created** (logs/, pids/, output/)
✅ **Worker waiting for tasks** (idle, blocking on queue)
✅ **Flask responding to health checks**
✅ **Redis queue ready** (length: 0)
✅ **PostgreSQL accessible**
✅ **System ready for testing** (`./test_worker.sh`)

The entire Phase 1 + Phase 2 infrastructure is now operational and ready to process OCR tasks!
