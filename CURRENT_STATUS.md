# Current System Status & Flow

**Last Updated**: 2025-10-16

---

## ✅ Completed Phases

### **Phase 1: Data Layer** ✅ COMPLETE
- **PostgreSQL Database** (localhost:5432)
  - Users, files, tasks, results tables
  - 2 migrations applied (S3 fields added)
  - Admin user seeded
- **Redis** (localhost:6379)
  - Task queue: `ocr:task:queue`
  - Pub/Sub: `ocr:notifications` channel
  - Task metadata storage
- **AWS S3 Storage** (HIPAA-compliant)
  - Bucket: `untxt`
  - KMS encryption enabled
  - Hierarchical folder structure

### **Phase 2: Processing Layer** ✅ COMPLETE
- **Flask Worker** (localhost:5000)
  - Health check endpoint: `/health`
  - Status endpoint: `/status`
- **Simulated Qwen3 Model**
  - Returns German bakery receipt HTML
  - 1-3 second processing time
  - Realistic confidence scores
- **S3 Integration** ✅ NEW!
  - Downloads input files from S3
  - Uploads HTML results to S3
  - Stores S3 paths in database
  - No local file persistence
- **Task Processing Pipeline**
  - Redis queue consumer
  - Full OCR workflow
  - Error handling & retry logic
  - Real-time notifications

---

## 🚧 Remaining Phases

### **Phase 3: Backend API** ⏳ NOT STARTED
- Node.js Express server (will run on localhost:8080)
- REST API endpoints for task management
- WebSocket server for real-time updates
- User authentication

### **Phase 4: Frontend** ⏳ NOT STARTED
- Next.js web interface (will run on localhost:3000)
- File upload UI
- Task dashboard
- Real-time status updates

### **Phase 5: Admin UI** ⏳ NOT STARTED
- Electron desktop app
- System monitoring
- User management

### **Phase 6: Reverse Proxy** ⏳ NOT STARTED
- Nginx configuration
- SSL/TLS termination
- Rate limiting

### **Phase 7-10**: Integration Testing, Production Deployment, Monitoring, Scaling

---

## 🔄 Current System Flow

### **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────────┐
│                        AWS S3 (untxt)                           │
│  ┌──────────────────────────┐  ┌─────────────────────────┐     │
│  │   uploads/               │  │   results/              │     │
│  │   {user}/{date}/{file}   │  │   {user}/{date}/{task}  │     │
│  │   [KMS Encrypted]        │  │   [KMS Encrypted]       │     │
│  └──────────┬───────────────┘  └───────────┬─────────────┘     │
└─────────────┼──────────────────────────────┼───────────────────┘
              │ ↑ download/upload             │ ↑ upload result
              │ │                             │ │
┌─────────────┼─┼─────────────────────────────┼─┼─────────────────┐
│ PHASE 2     │ │                             │ │   PROCESSING    │
│             ↓ │                             │ ↓                 │
│  ┌──────────────────────────────────────────────────┐          │
│  │       OCR Worker (Flask + Python)                │          │
│  │       Port: 5000                                 │          │
│  │       PID: 66564                                 │          │
│  │                                                   │          │
│  │  1. Polls Redis queue                            │          │
│  │  2. Downloads file from S3                       │          │
│  │  3. Runs simulated Qwen3 (German receipt HTML)   │          │
│  │  4. Uploads result HTML to S3                    │          │
│  │  5. Stores S3 paths in PostgreSQL                │          │
│  │  6. Publishes completion to Redis Pub/Sub        │          │
│  │  7. Cleans up temp files                         │          │
│  └───────────┬───────────────────────┬──────────────┘          │
│              │ read/write            │ BRPOP/PUBLISH           │
└──────────────┼───────────────────────┼─────────────────────────┘
               │                       │
┌──────────────┼───────────────────────┼─────────────────────────┐
│ PHASE 1      ↓                       ↓          DATA LAYER     │
│  ┌────────────────────────┐  ┌─────────────────────────┐      │
│  │   PostgreSQL           │  │   Redis                 │      │
│  │   Port: 5432           │  │   Port: 6379            │      │
│  │                        │  │                         │      │
│  │  Tables:               │  │  Queues:                │      │
│  │  • users               │  │  • ocr:task:queue       │      │
│  │  • files (+ s3_key)    │  │                         │      │
│  │  • tasks               │  │  Pub/Sub:               │      │
│  │  • results             │  │  • ocr:notifications    │      │
│  │    (+ s3_result_key)   │  │                         │      │
│  │  • sessions, history   │  │  Metadata:              │      │
│  └────────────────────────┘  │  • ocr:task:data:{id}   │      │
│                              └─────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📊 Detailed Processing Flow

### **1. Task Creation** (Currently manual, will be via API in Phase 3)

```sql
-- Manual test creates:
INSERT INTO files (id, user_id, original_filename, s3_key, ...)
VALUES ('file-uuid', 'user-uuid', 'document.pdf', 'uploads/user/2025-10/file/document.pdf', ...);

INSERT INTO tasks (id, user_id, file_id, status)
VALUES ('task-uuid', 'user-uuid', 'file-uuid', 'pending');

-- Add to Redis queue
LPUSH ocr:task:queue "task-uuid"
```

### **2. Worker Processing** (Automated, running now)

```
Worker Loop (continuous):
├─ 1. BRPOP ocr:task:queue (blocking wait, 5 sec timeout)
│  └─ Gets: task-uuid
│
├─ 2. Update status to 'processing'
│  ├─ PostgreSQL: UPDATE tasks SET status='processing'
│  └─ Redis: SET ocr:task:data:{task-uuid} {status, worker_id, started_at}
│
├─ 3. Fetch task details
│  └─ PostgreSQL: SELECT tasks JOIN files (gets s3_key)
│
├─ 4. Download file from S3
│  ├─ S3: GET s3://untxt/uploads/user/2025-10/file/document.pdf
│  └─ Save to: /output/temp/{task-uuid}_document.pdf
│
├─ 5. Run OCR (simulated Qwen3)
│  ├─ Loads file (simulated)
│  ├─ Sleep 1-3 seconds (simulates processing)
│  └─ Returns: {html_output, confidence, word_count, page_count}
│
├─ 6. Upload result to S3
│  ├─ S3: PUT s3://untxt/results/user/2025-10/task/{task-uuid}.html
│  └─ KMS encryption applied automatically
│
├─ 7. Store result in database
│  └─ PostgreSQL: INSERT INTO results (task_id, extracted_text, s3_result_key, ...)
│
├─ 8. Update status to 'completed'
│  ├─ PostgreSQL: UPDATE tasks SET status='completed', completed_at=now()
│  └─ Redis: UPDATE ocr:task:data:{task-uuid}
│
├─ 9. Publish notification
│  ├─ Redis: PUBLISH ocr:notifications {task completed event}
│  └─ Redis: PUBLISH ocr:notifications:user:{user-uuid} {user-specific event}
│
├─ 10. Cleanup
│  ├─ Delete temp file: /output/temp/{task-uuid}_document.pdf
│  └─ Set Redis key expiry: 86400 seconds (24 hours)
│
└─ 11. Loop back to step 1
```

---

## 🗂️ File Organization

### **S3 Bucket Structure**

```
s3://untxt/
├── uploads/                          # Input files
│   └── {user_id}/                    # User partition
│       └── {YYYY-MM}/                # Date partition
│           └── {file_id}/            # File partition
│               └── {filename}        # Original filename
│                   Example: test_receipt.pdf
│
└── results/                          # Output files
    └── {user_id}/                    # User partition
        └── {YYYY-MM}/                # Date partition
            └── {task_id}/            # Task partition
                └── {task_id}_{timestamp}.html
                    Example: 6d6daecf-8cbb-4b1c-8f9b-717e71a0b50d_20251016_214250.html
```

### **Database Storage**

```sql
-- Files table stores S3 path for input
files:
  - id: UUID
  - user_id: UUID
  - original_filename: "document.pdf"
  - file_path: NULL (no local storage)
  - s3_key: "uploads/user-id/2025-10/file-id/document.pdf"
  - file_type: "pdf"
  - uploaded_at: timestamp

-- Results table stores S3 path for output
results:
  - id: UUID
  - task_id: UUID
  - extracted_text: "full text extraction"
  - confidence_score: 0.92
  - result_file_path: NULL (no local storage)
  - s3_result_key: "results/user-id/2025-10/task-id/result.html"
  - created_at: timestamp
```

---

## 🔐 Security & Encryption

### **Data Encryption Flow**

```
User File Upload (future Phase 3)
    ↓
Backend API receives file
    ↓
Upload to S3 with KMS encryption
    ↓
S3 → KMS: "Encrypt this file"
    ↓
KMS generates unique Data Encryption Key (DEK)
    ↓
S3 encrypts file with DEK
    ↓
KMS encrypts DEK with Master Key
    ↓
S3 stores:
  - Encrypted file
  - Encrypted DEK
  - KMS Master Key ARN
    ↓
File at rest: ✅ Encrypted
```

### **Current Credentials** (Development)

```bash
# worker/.env (NEVER commit to git!)
AWS_ACCESS_KEY_ID=AKIAX45MOZ3HGNYUTJUS                    # ⚠️ ROTATE BEFORE PRODUCTION
AWS_SECRET_ACCESS_KEY=stusVT4eFa...                       # ⚠️ ROTATE BEFORE PRODUCTION
AWS_REGION=us-east-1
S3_BUCKET_NAME=untxt
KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/e608ce2c-...
```

**Production**: See `docs/PRODUCTION_SECURITY.md` for IAM Roles or Secrets Manager setup.

---

## 📝 Testing

### **Test Scripts Available**

1. **`test_worker.sh`** - Basic worker test (without S3)
   ```bash
   ./test_worker.sh
   ```

2. **`test_s3_integration.sh`** ✅ NEW!
   ```bash
   ./test_s3_integration.sh
   ```
   - Creates test file
   - Uploads to S3
   - Creates database records
   - Enqueues task
   - Waits for completion
   - Verifies result in S3
   - Validates encryption

### **Service Management**

```bash
# Start all services (PostgreSQL, Redis, Worker, Flask)
./start_services.sh

# Check status
./status.sh

# Stop all services
./stop_services.sh

# View logs
tail -f logs/worker.log
tail -f logs/flask.log
```

---

## 🎯 Next Steps (Phase 3)

To continue development, you'll need to build the **Backend API**:

### **What to Build Next**

1. **Node.js Express Server**
   - REST API for file uploads
   - Task management endpoints
   - User authentication
   - WebSocket server for real-time updates

2. **Key Endpoints Needed**
   ```
   POST   /api/auth/register          # User registration
   POST   /api/auth/login             # User login
   POST   /api/tasks                  # Upload file, create task
   GET    /api/tasks                  # List user's tasks
   GET    /api/tasks/:id              # Get task details
   GET    /api/tasks/:id/result       # Download result HTML
   WS     /ws                         # WebSocket for real-time updates
   ```

3. **Backend Will Need To**
   - Accept file uploads from frontend
   - Upload files to S3 (using your S3 client pattern)
   - Create database records (files, tasks tables)
   - Push task IDs to Redis queue: `LPUSH ocr:task:queue {task-uuid}`
   - Subscribe to Redis Pub/Sub for completion notifications
   - Broadcast status updates via WebSocket to frontend

### **Dependencies Between Phases**

```
Phase 1 (Data) ─┬─→ Phase 2 (Worker) ✅ COMPLETE
                │
                └─→ Phase 3 (Backend API) ⏳ NEXT
                    │
                    └─→ Phase 4 (Frontend) ⏳ AFTER PHASE 3
```

---

## 📈 System Metrics (Current Test Run)

From latest S3 integration test:

```
Task ID: 6d6daecf-8cbb-4b1c-8f9b-717e71a0b50d
├─ File uploaded to S3: ✅ (283 ms)
├─ Database records created: ✅
├─ Task queued: ✅
├─ Worker picked up task: ✅ (0.5 sec)
├─ File downloaded from S3: ✅ (283 ms)
├─ OCR processing: ✅ (2.73 sec)
├─ Result uploaded to S3: ✅ (116 ms)
├─ Database updated: ✅
├─ Notification published: ✅
└─ Total time: ~5 seconds

Result Details:
├─ Confidence Score: 0.9190
├─ Word Count: 37
├─ Page Count: 2
├─ Processing Time: 2730ms
├─ Result Size: 8464 bytes
├─ Encryption: aws:kms ✅
└─ Storage: S3 only (no local files)
```

---

## 🚀 Quick Start (Current System)

```bash
# 1. Start services
./start_services.sh

# 2. Run S3 integration test
./test_s3_integration.sh

# 3. Check logs
tail -f logs/worker.log

# 4. View results
# - Check S3 bucket in AWS console
# - Query PostgreSQL: SELECT * FROM results ORDER BY created_at DESC LIMIT 1;
# - Download HTML from S3 using s3_result_key
```

---

## 📚 Documentation

- **Development Plan**: `development_order.md`
- **Phase 2 Complete**: `PHASE2_COMPLETE.md`
- **Service Scripts**: `SERVICE_SCRIPTS.md`
- **AWS S3 Setup**: `docs/AWS_S3_HIPAA_SETUP.md`
- **Production Security**: `docs/PRODUCTION_SECURITY.md` ✅ NEW!
- **Expected Output**: `EXPECTED_OUTPUT.md`

---

## 🎉 Summary

**You have a fully functional OCR processing backend!**

✅ Data layer with PostgreSQL + Redis
✅ OCR worker with simulated Qwen3 model
✅ AWS S3 integration with KMS encryption
✅ HIPAA-compliant file storage
✅ Complete task processing pipeline
✅ End-to-end testing

**Next**: Build the Backend API (Phase 3) to accept file uploads from a frontend.
