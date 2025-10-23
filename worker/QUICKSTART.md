# Quick Start Guide - OCR Worker

Get the Phase 2 worker up and running in 5 minutes.

## Step 1: Install Dependencies

```bash
cd /Users/benfrankstein/Projects/untxt/worker
source ../venv/bin/activate
pip install -r requirements.txt
```

## Step 2: Configure Environment

```bash
cp .env.example .env
# The defaults should work for local development
```

## Step 3: Verify Prerequisites

### Check PostgreSQL
```bash
psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT COUNT(*) FROM tasks;"
```

### Check Redis
```bash
redis-cli ping
# Should return: PONG
```

## Step 4: Start Flask Health Check Server (Optional)

In one terminal:

```bash
cd /Users/benfrankstein/Projects/untxt/worker
source ../venv/bin/activate
python app.py
```

Visit http://localhost:5000/health to verify.

## Step 5: Start Worker

In another terminal:

```bash
cd /Users/benfrankstein/Projects/untxt/worker
source ../venv/bin/activate
python run_worker.py
```

You should see:
```
============================================================
OCR Worker Starting
============================================================
Worker worker-001 initialized
Redis: localhost:6379
Database: localhost:5432/ocr_platform_dev
Worker worker-001 starting main loop
```

## Step 6: Test with Sample Task

### Create Test Task

In `psql`:

```sql
-- Get admin user ID
\x
SELECT id FROM users WHERE username = 'admin';

-- Insert test file (replace USER_ID)
INSERT INTO files (user_id, original_filename, stored_filename, file_path, file_type, file_size)
VALUES (
    'YOUR_ADMIN_USER_ID_HERE',
    'test_receipt.png',
    'test_receipt_stored.png',
    '/path/to/test_receipt.png',
    'image',
    102400
)
RETURNING id;

-- Insert test task (replace USER_ID and FILE_ID)
INSERT INTO tasks (user_id, file_id, status, priority)
VALUES (
    'YOUR_ADMIN_USER_ID_HERE',
    'YOUR_FILE_ID_HERE',
    'pending',
    5
)
RETURNING id;
```

### Add Task to Queue

Copy the task ID and add to Redis:

```bash
redis-cli LPUSH ocr:task:queue "YOUR_TASK_ID_HERE"
```

### Watch the Worker Process!

The worker terminal should show:
```
Retrieved task from queue: {task_id}
[{task_id}] Starting task processing
[{task_id}] Task details: file=test_receipt.png
[SIMULATION] Processing image: /path/to/test_receipt.png
[SIMULATION] Processing complete. Time: 2145ms, Confidence: 0.9234
[{task_id}] Saved output to /Users/benfrankstein/Projects/untxt/output/{task_id}_20241016_143022.html
[{task_id}] Result stored in database
[{task_id}] Status updated to completed
[{task_id}] Published completion notification
[{task_id}] Task completed successfully
```

### View Results

```sql
-- Check task status
SELECT * FROM tasks WHERE id = 'YOUR_TASK_ID_HERE';

-- Check result
SELECT confidence_score, word_count, processing_time_ms, model_version
FROM results WHERE task_id = 'YOUR_TASK_ID_HERE';
```

```bash
# Open HTML output in browser
open /Users/benfrankstein/Projects/untxt/output/*YOUR_TASK_ID*.html
```

## Troubleshooting

### "Connection refused" for Redis
```bash
redis-server
```

### "Connection refused" for PostgreSQL
```bash
brew services start postgresql@16
```

### ImportError
```bash
source ../venv/bin/activate
pip install -r requirements.txt
```

### Output directory doesn't exist
```bash
mkdir -p /Users/benfrankstein/Projects/untxt/output
```

## What's Next?

The worker is now running and ready to process tasks!

Next steps:
- Phase 3: Build Node.js backend API
- Create endpoints to submit tasks
- Subscribe to Redis notifications
- Build WebSocket server for real-time updates
- Phase 4: Build Next.js frontend

The simulated processing will be replaced with real Qwen3 model inference in production.
