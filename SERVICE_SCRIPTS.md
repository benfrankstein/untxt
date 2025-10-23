# Service Management Scripts

Easy-to-use bash scripts to manage all OCR Platform services (Phase 1 & Phase 2).

## Quick Start

```bash
# Start all services
./start_services.sh

# Check status
./status.sh

# Test the worker
./test_worker.sh

# Stop all services
./stop_services.sh
```

## Scripts Overview

### 🚀 start_services.sh

Starts all Phase 1 and Phase 2 services in the correct order:

1. **PostgreSQL** - Checks if running, starts if needed
2. **Redis** - Starts Redis server in daemon mode
3. **OCR Worker** - Starts the Python worker process
4. **Flask Server** - Starts health check server on port 5000

**Features:**
- ✅ Automatic dependency checking
- ✅ Connection testing before worker start
- ✅ Background process management with PID files
- ✅ Detailed logging for each service
- ✅ Waits for services to be ready before proceeding
- ✅ Creates required directories (`logs/`, `pids/`, `output/`)

**Output:**
```
═══════════════════════════════════════════════════════════════
  Phase 1.1: Starting PostgreSQL
═══════════════════════════════════════════════════════════════
✓ PostgreSQL is already running
✓ Database 'ocr_platform_dev' is accessible

═══════════════════════════════════════════════════════════════
  Phase 1.2: Starting Redis
═══════════════════════════════════════════════════════════════
→ Starting Redis server...
✓ Redis is ready
✓ Redis server started (PID: 12345)

... and so on
```

### 📊 status.sh

Shows real-time status of all services with detailed metrics:

- **PostgreSQL**: Database size, task count, result count
- **Redis**: Queue length, statistics (completed/failed tasks)
- **OCR Worker**: Running status, PID, last log entry
- **Flask Server**: Health check response, URL
- **Output Files**: Count and list of recent HTML files

**Example Output:**
```
═══════════════════════════════════════════════════════════════
  OCR Platform - Service Status
═══════════════════════════════════════════════════════════════

● PostgreSQL: RUNNING
  → Database size: 8456 kB
  → Total tasks: 15
  → Total results: 12

● Redis: RUNNING
  → Queue length: 3 tasks
  → Statistics: 12 completed, 0 failed (total: 15)
  → PID: 12345

... and so on
```

### 🧪 test_worker.sh

Performs an end-to-end test of the worker:

1. Creates a test file and task in database
2. Adds task to Redis queue
3. Watches worker logs in real-time (15 seconds)
4. Verifies task completion and results
5. Shows output file location

**Perfect for:**
- Verifying the worker is functioning correctly
- Debugging processing issues
- Demonstrating the complete flow

**Example Output:**
```
═══════════════════════════════════════════════════════════════
  Step 1: Creating Test Task in Database
═══════════════════════════════════════════════════════════════
✓ Found admin user: abc-123-def
✓ Created test file: xyz-456-abc
✓ Created test task: task-789-ghi

═══════════════════════════════════════════════════════════════
  Step 3: Watching Worker Process Task
═══════════════════════════════════════════════════════════════
[task-789-ghi] Starting task processing
[task-789-ghi] Task completed successfully

... result details
```

### 🛑 stop_services.sh

Gracefully stops all services in reverse order:

1. Flask Server (most dependent)
2. OCR Worker
3. Redis
4. PostgreSQL (note: typically left running)

**Features:**
- Graceful shutdown (SIGTERM) with 10-second timeout
- Force kill (SIGKILL) if process doesn't respond
- Cleans up PID files
- Shows status for each service

## Directory Structure

The scripts create and use these directories:

```
untxt/
├── logs/                    # Service logs
│   ├── postgresql.log
│   ├── redis.log
│   ├── worker.log
│   └── flask.log
├── pids/                    # Process ID files
│   ├── redis.pid
│   ├── worker.pid
│   └── flask.pid
└── output/                  # Generated HTML files
    └── {task_id}_{timestamp}.html
```

## Common Workflows

### First Time Setup

```bash
# 1. Setup database (if not done)
cd database/scripts
./setup_database.sh

# 2. Install worker dependencies
cd ../../worker
source ../venv/bin/activate
pip install -r requirements.txt

# 3. Start all services
cd ..
./start_services.sh

# 4. Test the system
./test_worker.sh
```

### Daily Development

```bash
# Start services in the morning
./start_services.sh

# Check status anytime
./status.sh

# Work on code...

# Stop when done
./stop_services.sh
```

### Debugging Issues

```bash
# Check service status
./status.sh

# View worker logs in real-time
tail -f logs/worker.log

# View Flask logs
tail -f logs/flask.log

# Check Redis queue
redis-cli LLEN ocr:task:queue

# Manual test
./test_worker.sh
```

### Restart Individual Services

```bash
# Restart worker only
kill $(cat pids/worker.pid)
cd worker
source ../venv/bin/activate
nohup python run_worker.py > ../logs/worker.log 2>&1 &
echo $! > ../pids/worker.pid

# Restart Flask only
kill $(cat pids/flask.pid)
cd worker
nohup python app.py > ../logs/flask.log 2>&1 &
echo $! > ../pids/flask.pid
```

## Troubleshooting

### Services won't start

```bash
# Check what's running
./status.sh

# Stop everything and restart
./stop_services.sh
sleep 2
./start_services.sh
```

### Worker fails to start

```bash
# Check connection test
cd worker
source ../venv/bin/activate
python test_connection.py

# Check logs
tail -n 50 ../logs/worker.log
```

### PostgreSQL issues

```bash
# Check if running
pg_isready

# Start manually
brew services start postgresql@16

# Check database
psql -U ocr_platform_user -d ocr_platform_dev -c "\dt"
```

### Redis issues

```bash
# Check if running
redis-cli ping

# Start manually
redis-server --daemonize yes

# Check queue
redis-cli LLEN ocr:task:queue
```

### Stuck tasks

```bash
# Check pending tasks
psql -U ocr_platform_user -d ocr_platform_dev -c \
  "SELECT id, status, created_at FROM tasks WHERE status = 'pending' ORDER BY created_at DESC;"

# Add to queue manually
redis-cli LPUSH ocr:task:queue "task-id-here"
```

## Script Customization

All scripts use environment variables where possible. To customize:

### Change Worker ID

```bash
# In worker/.env
WORKER_ID=worker-002
```

### Change Ports

Edit `worker/config.py`:
```python
REDIS_PORT = 6380  # Different Redis port
```

### Change Log Locations

Edit scripts directly:
```bash
LOG_DIR="$PROJECT_ROOT/custom_logs"
```

## Health Checks

### Manual Health Checks

```bash
# PostgreSQL
pg_isready && echo "OK" || echo "FAIL"

# Redis
redis-cli ping

# Flask
curl http://localhost:5000/health

# Worker (check if process is running)
kill -0 $(cat pids/worker.pid) 2>/dev/null && echo "RUNNING" || echo "STOPPED"
```

### Monitoring

```bash
# Watch all logs
tail -f logs/*.log

# Watch worker only
tail -f logs/worker.log | grep -E "(✓|✗|ERROR|completed|failed)"

# Watch Redis commands
redis-cli MONITOR

# Watch queue length
watch -n 1 'redis-cli LLEN ocr:task:queue'
```

## Integration with Phase 3

When Phase 3 (Node.js backend) is ready, add to `start_services.sh`:

```bash
start_backend() {
    print_header "Phase 3.1: Starting Node.js Backend"
    cd "$PROJECT_ROOT/backend"
    nohup npm start > "$LOG_DIR/backend.log" 2>&1 &
    echo $! > "$BACKEND_PID"
    print_success "Backend started on port 8080"
}
```

## Performance Tips

### Multiple Workers

Run multiple workers for parallel processing:

```bash
# Terminal 1
WORKER_ID=worker-001 python worker/run_worker.py

# Terminal 2
WORKER_ID=worker-002 python worker/run_worker.py

# Terminal 3
WORKER_ID=worker-003 python worker/run_worker.py
```

### Clean Old Logs

```bash
# Delete logs older than 7 days
find logs/ -name "*.log" -mtime +7 -delete
```

### Clean Old Output Files

```bash
# Delete output files older than 30 days
find output/ -name "*.html" -mtime +30 -delete
```

## Systemd Integration (Production)

For production, convert to systemd services:

```bash
# Example systemd service file
# /etc/systemd/system/ocr-worker.service
[Unit]
Description=OCR Worker
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=ocr
WorkingDirectory=/path/to/untxt/worker
ExecStart=/path/to/venv/bin/python run_worker.py
Restart=always

[Install]
WantedBy=multi-user.target
```

## Support

For issues with the scripts:

1. Check `./status.sh` for service status
2. Review logs in `logs/` directory
3. Test connections with `worker/test_connection.py`
4. Run `./test_worker.sh` for end-to-end verification

---

**Scripts Version**: 1.0.0
**Compatible with**: Phase 1 (Database + Redis) + Phase 2 (OCR Worker)
**Ready for**: Phase 3 (Node.js Backend API)
