# Quick Start Guide - Testing Your OCR System

## Prerequisites Check

Before starting, make sure you have:
- ✅ PostgreSQL installed and running
- ✅ Redis installed
- ✅ Python virtual environment set up
- ✅ AWS credentials in `worker/.env`
- ✅ Database initialized with `database/scripts/setup_database.sh`

---

## Step 1: Start All Services

```bash
# Navigate to project root
cd /Users/benfrankstein/Projects/untxt

# Start everything (PostgreSQL, Redis, Worker, Flask)
./start_services.sh
```

**Expected Output:**
```
═══════════════════════════════════════════════════════════════
  OCR Platform - Starting All Services
═══════════════════════════════════════════════════════════════

✓ PostgreSQL is already running
✓ Redis is already running
✓ Worker started (PID: 12345)
✓ Flask server started (PID: 12346)

  All Services Started Successfully!
```

---

## Step 2: Verify Services Are Running

```bash
# Check service status
./status.sh
```

**Expected Output:**
```
Service Status:
✓ PostgreSQL: Running
✓ Redis: Running (Queue length: 0)
✓ Worker: Running (PID: 12345)
✓ Flask: Running (PID: 12346)
```

---

## Step 3: Run the S3 Integration Test

This will test the complete flow: upload → process → store → verify

```bash
# Run automated test
./test_s3_integration.sh
```

**What This Test Does:**
1. Creates a test PDF file
2. Uploads it to S3 (`s3://untxt/uploads/...`)
3. Creates database records (files + tasks tables)
4. Adds task to Redis queue
5. Worker picks up task automatically
6. Worker downloads file from S3
7. Worker runs OCR (simulated Qwen3 - takes 1-3 seconds)
8. Worker uploads HTML result to S3 (`s3://untxt/results/...`)
9. Worker stores result in database
10. Verifies everything worked

**Expected Output:**
```
=====================================
S3 Integration Test
=====================================

[1/7] Creating test PDF file...
✓ Created test file: /tmp/test_receipt_1760650966.pdf

[2/7] Generating file metadata...
✓ File ID: 06cedd69-db7b-4291-940a-6d2d5083a7cf
✓ S3 Key: uploads/11111111.../2025-10/06cedd69.../test_receipt.pdf

[3/7] Uploading file to S3...
✓ Uploaded to s3://untxt/uploads/...

[4/7] Creating file record in database...
✓ File record created

[5/7] Creating OCR task...
✓ Task created: 6d6daecf-8cbb-4b1c-8f9b-717e71a0b50d

[6/7] Adding task to Redis queue...
✓ Task added to queue

[7/7] Waiting for task processing...
Checking task status (max 30 seconds)...
.....
✓ Task completed!

Verifying results...

Result Details:
  Confidence Score: 0.9190
  Word Count: 37
  Page Count: 2
  Processing Time: 2730ms
  S3 Result Key: results/11111111.../2025-10/6d6daecf.../result.html

Verifying result in S3...
✓ Result file exists in S3
  Size: 8464 bytes
  Content-Type: text/html
  Encryption: aws:kms

=====================================
✅ S3 INTEGRATION TEST PASSED! ✅
=====================================
```

---

## Step 4: View Real-Time Logs (Optional)

Open a new terminal window to watch the worker processing tasks:

```bash
# Terminal 1: Watch worker logs
tail -f logs/worker.log

# Terminal 2: Watch Flask logs (optional)
tail -f logs/flask.log
```

**What You'll See in Worker Logs:**
```
2025-10-16 16:42:47,511 - task_processor - INFO - [task-id] Starting task processing
2025-10-16 16:42:47,524 - task_processor - INFO - [task-id] Downloading file from S3: uploads/...
2025-10-16 16:42:47,808 - task_processor - INFO - [task-id] File downloaded to /output/temp/...
2025-10-16 16:42:47,809 - task_processor - INFO - [task-id] Running OCR on /output/temp/...
2025-10-16 16:42:50,540 - task_processor - INFO - [task-id] OCR completed: confidence=0.919, words=37
2025-10-16 16:42:50,656 - task_processor - INFO - [task-id] Uploaded result to S3: results/...
2025-10-16 16:42:50,661 - task_processor - INFO - [task-id] Result stored in database
2025-10-16 16:42:50,662 - task_processor - INFO - [task-id] Status updated to completed
2025-10-16 16:42:50,663 - task_processor - INFO - [task-id] Task completed successfully
```

---

## Step 5: Verify Data in Database (Optional)

Check that everything was stored correctly:

```bash
# Connect to database
psql -U ocr_platform_user -d ocr_platform_dev

# View recent tasks
SELECT id, user_id, status, created_at, completed_at
FROM tasks
ORDER BY created_at DESC
LIMIT 5;

# View recent results (with S3 paths)
SELECT
    r.id,
    r.task_id,
    r.confidence_score,
    r.word_count,
    r.s3_result_key,
    r.created_at
FROM results r
ORDER BY r.created_at DESC
LIMIT 5;

# Exit database
\q
```

---

## Step 6: Check S3 Files (Optional)

View your files in S3:

```bash
# List uploaded files
aws s3 ls s3://untxt/uploads/ --recursive

# List result files
aws s3 ls s3://untxt/results/ --recursive

# Download a result file to view it
aws s3 cp s3://untxt/results/{path-from-database}/result.html ./result.html

# Open in browser
open result.html
```

---

## Step 7: Stop All Services

When you're done testing:

```bash
./stop_services.sh
```

**Expected Output:**
```
═══════════════════════════════════════════════════════════════
  OCR Platform - Stopping All Services
═══════════════════════════════════════════════════════════════

✓ Flask Health Check Server stopped
✓ OCR Worker stopped
✗ Redis failed to stop (may need manual stop)

  All Services Stopped
```

Note: Redis might need to be stopped manually:
```bash
redis-cli shutdown
```

---

## Manual Testing (Advanced)

If you want to test manually without the automated script:

### 1. Create a test file record
```bash
psql -U ocr_platform_user -d ocr_platform_dev << EOF
-- Get admin user ID first
SELECT id FROM users WHERE role = 'admin' LIMIT 1;
-- Returns: 11111111-1111-1111-1111-111111111111

-- Create file record
INSERT INTO files (
    id, user_id, original_filename, stored_filename,
    file_path, s3_key, file_type, mime_type, file_size
) VALUES (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    'my_test.pdf',
    'stored_my_test.pdf',
    NULL,
    'uploads/11111111-1111-1111-1111-111111111111/2025-10/test-file-id/my_test.pdf',
    'pdf',
    'application/pdf',
    1024
) RETURNING id;
EOF
```

### 2. Upload file to S3
```python
# Create a simple Python script
python3 << EOF
import boto3
import os
from dotenv import load_dotenv

load_dotenv('worker/.env')

s3 = boto3.client('s3',
    region_name=os.getenv('AWS_REGION'),
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
)

# Upload a test file
with open('/tmp/test.pdf', 'wb') as f:
    f.write(b'Test PDF content')

s3.upload_file(
    '/tmp/test.pdf',
    os.getenv('S3_BUCKET_NAME'),
    'uploads/11111111-1111-1111-1111-111111111111/2025-10/test-file-id/my_test.pdf',
    ExtraArgs={
        'ServerSideEncryption': 'aws:kms',
        'SSEKMSKeyId': os.getenv('KMS_KEY_ID')
    }
)
print("File uploaded!")
EOF
```

### 3. Create task
```bash
psql -U ocr_platform_user -d ocr_platform_dev << EOF
INSERT INTO tasks (user_id, file_id, status, priority)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    '<file-id-from-step-1>',
    'pending',
    5
) RETURNING id;
EOF
```

### 4. Add to Redis queue
```bash
# Copy task ID from previous step
TASK_ID="<task-id-from-step-3>"

# Add to queue
redis-cli LPUSH "ocr:task:queue" "$TASK_ID"

# Check queue length
redis-cli LLEN "ocr:task:queue"
```

### 5. Watch it process
```bash
# Worker will automatically pick it up within 5 seconds
tail -f logs/worker.log

# Check task status
redis-cli GET "ocr:task:data:$TASK_ID"

# Or check database
psql -U ocr_platform_user -d ocr_platform_dev -c \
  "SELECT status, completed_at FROM tasks WHERE id = '$TASK_ID';"
```

---

## Troubleshooting

### Services won't start
```bash
# Check if ports are already in use
lsof -i :5000  # Flask
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis

# Check logs
cat logs/worker.log
cat logs/flask.log
```

### Database connection error
```bash
# Test database connection
psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT 1;"

# If it fails, check database is running
brew services list | grep postgresql

# Restart if needed
brew services restart postgresql@16
```

### Redis connection error
```bash
# Test Redis connection
redis-cli PING
# Should return: PONG

# If it fails, start Redis
redis-server --daemonize yes
```

### S3 connection error
```bash
# Test S3 access
aws s3 ls s3://untxt/ --region us-east-1

# If it fails, check credentials
cat worker/.env | grep AWS

# Test credentials
python3 << EOF
import boto3
import os
from dotenv import load_dotenv
load_dotenv('worker/.env')

s3 = boto3.client('s3',
    region_name=os.getenv('AWS_REGION'),
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
)

response = s3.list_buckets()
print("Buckets:", [b['Name'] for b in response['Buckets']])
EOF
```

### Worker crashes immediately
```bash
# Check worker.log for errors
cat logs/worker.log

# Common issues:
# 1. Missing .env file: cp worker/.env.example worker/.env
# 2. Missing dependencies: cd worker && pip install -r requirements.txt
# 3. Wrong Python version: python3 --version (need 3.9+)
```

---

## Health Checks

Check if everything is working:

```bash
# Flask health endpoint
curl http://localhost:5000/health

# Should return:
# {
#   "status": "healthy",
#   "worker_id": "worker-001",
#   "timestamp": "2025-10-16T21:42:50.123456",
#   "service": "OCR Worker",
#   "version": "1.0.0"
# }

# Flask status endpoint
curl http://localhost:5000/status

# Should return:
# {
#   "worker_id": "worker-001",
#   "status": "active",
#   "queue_length": 0,
#   "timestamp": "2025-10-16T21:42:50.123456"
# }
```

---

## Summary

**Simple 3-Step Test:**
```bash
# 1. Start
./start_services.sh

# 2. Test
./test_s3_integration.sh

# 3. Stop
./stop_services.sh
```

That's it! If the test passes, your OCR processing system is working perfectly. 🎉

---

## Next Steps

Once you've verified everything works:

1. **View the results**: Check your S3 bucket in AWS console
2. **Read the docs**:
   - `CURRENT_STATUS.md` - System overview
   - `docs/PRODUCTION_SECURITY.md` - Production deployment guide
3. **Start Phase 3**: Build the Backend API to accept file uploads from users

Need help? Check the logs in `logs/` directory.
