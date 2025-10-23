# OCR Worker - Phase 2

OCR Processing Worker that consumes tasks from Redis queue, processes images with Qwen3 model (simulated), and stores results in PostgreSQL.

## Overview

This worker implements Phase 2 of the OCR Platform as described in `development_order.md`:

- **Flask Application**: Health check and status endpoints on `localhost:5000`
- **Redis Queue Consumer**: Continuously polls for OCR tasks
- **Simulated Qwen3 Processing**: Returns predefined HTML output for local development
- **Database Integration**: Stores results in PostgreSQL
- **Redis Pub/Sub**: Publishes completion notifications for Phase 3 backend

## Features

- Blocking queue consumption (efficient BRPOP)
- Task status tracking in both Redis and PostgreSQL
- Automatic retry logic with attempt counter
- Error handling and logging
- HTML output saved to disk
- Structured data extraction
- Real-time notifications via Redis pub/sub

## Project Structure

```
worker/
├── app.py                  # Flask application (health check endpoints)
├── config.py               # Configuration from environment variables
├── redis_client.py         # Redis queue and pub/sub operations
├── db_client.py            # PostgreSQL database operations
├── simulated_qwen3.py      # Simulated Qwen3 model output
├── task_processor.py       # Main task processing pipeline
├── run_worker.py           # Worker runner script
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variables template
└── README.md               # This file
```

## Prerequisites

- Python 3.9+
- PostgreSQL 14+ (Phase 1 completed)
- Redis (Phase 1 completed)
- Virtual environment (recommended)

## Installation

### 1. Create Virtual Environment

```bash
cd /Users/benfrankstein/Projects/untxt
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

```bash
cd worker
pip install -r requirements.txt
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Verify Database and Redis

Ensure PostgreSQL and Redis are running:

```bash
# Check PostgreSQL
psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT 1"

# Check Redis
redis-cli ping
```

## Usage

### Start Flask Health Check Server

```bash
cd worker
python app.py
```

The Flask server will start on `http://localhost:5000` with the following endpoints:

- `GET /health` - Health check
- `GET /status` - Worker status and queue length

Test the health endpoint:

```bash
curl http://localhost:5000/health
```

### Start Worker Process

In a separate terminal:

```bash
cd worker
source ../venv/bin/activate
python run_worker.py
```

The worker will:
1. Connect to Redis and PostgreSQL
2. Start polling for tasks from `ocr:task:queue`
3. Process tasks with simulated Qwen3 output
4. Store results in database
5. Publish completion notifications

### Stop Worker

Press `Ctrl+C` to gracefully shutdown the worker.

## Task Processing Flow

1. **Fetch Task**: Worker blocks on Redis queue (`BRPOP ocr:task:queue`)
2. **Update Status**: Set task status to `processing` in DB and Redis
3. **Retrieve Task Data**: Get task details from PostgreSQL
4. **Run OCR**: Simulate Qwen3 processing (1-3 seconds)
5. **Save Output**: Write HTML to `output/` directory
6. **Store Result**: Insert result record in PostgreSQL
7. **Update Status**: Set task status to `completed`
8. **Notify**: Publish completion message to Redis pub/sub
9. **Cleanup**: Set Redis metadata expiry (24 hours)

## Simulated Processing

For local development, the worker uses `simulated_qwen3.py` which:

- Returns predefined HTML output (German bakery receipts)
- Simulates 1-3 second processing time
- Generates realistic confidence scores (0.85-0.98)
- Extracts structured data (receipt numbers, dates, totals)
- Does NOT require loading the actual Qwen3 model

This allows you to develop and test the full pipeline without running the heavy ML model locally.

## Output Files

HTML output files are saved to the `OUTPUT_DIR` (default: `/Users/benfrankstein/Projects/untxt/output`):

```
output/
├── {task_id}_20241016_143022.html
├── {task_id}_20241016_143105.html
└── ...
```

Each file contains the simulated Qwen3 HTML output and can be opened in a browser.

## Database Schema

### Tasks Table

The worker interacts with these task statuses:

- `pending` → Worker picks up from queue
- `processing` → Worker actively processing
- `completed` → Processing successful
- `failed` → Processing error occurred

### Results Table

Worker inserts one result record per completed task:

```sql
CREATE TABLE results (
    id UUID PRIMARY KEY,
    task_id UUID UNIQUE NOT NULL,
    extracted_text TEXT,
    confidence_score DECIMAL(5,4),
    structured_data JSONB,
    page_count INTEGER,
    word_count INTEGER,
    processing_time_ms INTEGER,
    model_version VARCHAR(50),
    result_file_path TEXT,
    created_at TIMESTAMP
);
```

## Redis Data Structures

### Task Queue (List)

```
ocr:task:queue
[task_id_1, task_id_2, task_id_3, ...]
```

Worker uses `BRPOP` to efficiently wait for tasks.

### Task Metadata (Hash)

```
ocr:task:data:{task_id}
{
    "user_id": "...",
    "file_id": "...",
    "status": "processing",
    "worker_id": "worker-001",
    "started_at": "1697040000"
}
```

### Notifications (Pub/Sub)

```
ocr:notifications             # General channel
ocr:notifications:user:{id}   # User-specific channel
```

Published message format:

```json
{
    "type": "task_completed",
    "task_id": "...",
    "user_id": "...",
    "status": "completed",
    "result": {
        "confidence": 0.95,
        "word_count": 245,
        "page_count": 2
    },
    "timestamp": 1697040240
}
```

## Testing

### Manual Testing

#### 1. Create Test Task

Insert a test task into the database:

```sql
-- Insert test file
INSERT INTO files (user_id, original_filename, stored_filename, file_path, file_type, file_size)
VALUES (
    (SELECT id FROM users WHERE username = 'admin'),
    'test_receipt.png',
    'test_receipt_stored.png',
    '/path/to/test_receipt.png',
    'image',
    102400
)
RETURNING id;

-- Insert test task
INSERT INTO tasks (user_id, file_id, status, priority)
VALUES (
    (SELECT id FROM users WHERE username = 'admin'),
    '{file_id_from_above}',
    'pending',
    5
)
RETURNING id;
```

#### 2. Add Task to Queue

```bash
redis-cli LPUSH ocr:task:queue "{task_id_from_above}"
```

#### 3. Watch Worker Process

The worker will:
- Pick up the task
- Update status to processing
- Simulate OCR processing
- Save HTML output
- Store result in database
- Publish notification

#### 4. Verify Results

```sql
-- Check task status
SELECT * FROM tasks WHERE id = '{task_id}';

-- Check result
SELECT * FROM results WHERE task_id = '{task_id}';

-- Check task history
SELECT * FROM task_history WHERE task_id = '{task_id}';
```

#### 5. View Output File

```bash
ls -l /Users/benfrankstein/Projects/untxt/output/
open /Users/benfrankstein/Projects/untxt/output/{task_id}_*.html
```

## Monitoring

### Worker Logs

Logs are written to both console and `worker.log`:

```bash
tail -f worker.log
```

### Queue Status

```bash
# Check queue length
redis-cli LLEN ocr:task:queue

# View tasks in queue
redis-cli LRANGE ocr:task:queue 0 -1
```

### Database Queries

```sql
-- Active tasks
SELECT * FROM active_tasks_view;

-- Completed tasks
SELECT * FROM completed_tasks_view;

-- Failed tasks
SELECT * FROM tasks WHERE status = 'failed';

-- Processing time stats
SELECT
    AVG(processing_time_ms) as avg_time,
    MAX(processing_time_ms) as max_time,
    MIN(processing_time_ms) as min_time
FROM results;
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_ID` | `worker-001` | Unique worker identifier |
| `MAX_ATTEMPTS` | `3` | Max retry attempts per task |
| `PROCESSING_TIMEOUT` | `300` | Processing timeout (seconds) |
| `POLL_INTERVAL` | `5` | Queue poll interval (seconds) |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_DB` | `0` | Redis database number |
| `DB_HOST` | `localhost` | PostgreSQL hostname |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `ocr_platform_dev` | Database name |
| `DB_USER` | `ocr_platform_user` | Database user |
| `DB_PASSWORD` | `ocr_platform_pass_dev` | Database password |
| `OUTPUT_DIR` | `../output` | Output directory for HTML files |

## Troubleshooting

### Worker Can't Connect to Redis

```bash
# Check if Redis is running
redis-cli ping

# Start Redis
redis-server
```

### Worker Can't Connect to Database

```bash
# Check PostgreSQL status
brew services list | grep postgresql

# Start PostgreSQL
brew services start postgresql@16

# Test connection
psql -U ocr_platform_user -d ocr_platform_dev
```

### No Tasks Being Processed

```bash
# Check if tasks are in queue
redis-cli LLEN ocr:task:queue

# Check task status in database
psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT * FROM tasks WHERE status = 'pending';"
```

### Output Directory Doesn't Exist

```bash
mkdir -p /Users/benfrankstein/Projects/untxt/output
```

### Import Errors

```bash
# Ensure virtual environment is activated
source ../venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

## Next Steps (Phase 3)

Once the worker is tested and operational:

1. Develop Node.js backend API (REST endpoints)
2. Implement WebSocket server for real-time updates
3. Subscribe to Redis pub/sub notifications
4. Build task creation endpoints
5. Create result retrieval endpoints

The backend will:
- Receive file uploads from frontend
- Create tasks and push to Redis queue
- Subscribe to completion notifications
- Broadcast updates to WebSocket clients

## Production Considerations

When moving to production with the real Qwen3 model:

1. Replace `simulated_qwen3.py` with actual model loading
2. Add GPU support and model optimization
3. Implement batch processing
4. Add rate limiting per user
5. Set up horizontal scaling (multiple workers)
6. Monitor memory usage and model performance
7. Implement task timeout handling
8. Add dead letter queue for failed tasks

## Resources

- [Redis Python Client](https://redis-py.readthedocs.io/)
- [Psycopg2 Documentation](https://www.psycopg.org/docs/)
- [Flask Documentation](https://flask.palletsprojects.com/)
- [Qwen3-VL Model](https://huggingface.co/Qwen/Qwen3-VL)

---

**Phase 2 Complete**: OCR Worker operational with simulated processing, database integration, and Redis notifications ready for Phase 3 backend integration.
