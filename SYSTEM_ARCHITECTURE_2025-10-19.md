# OCR Platform - System Architecture
**Generated:** 2025-10-19
**Status:** Phase 1-3 Complete + Real-time Database Change Notifications

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Component List](#component-list)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Database Schema](#database-schema)
6. [File Structure](#file-structure)
7. [Functionality Matrix](#functionality-matrix)
8. [Service Dependencies](#service-dependencies)
9. [API Endpoints](#api-endpoints)
10. [Environment Variables](#environment-variables)

---

## System Overview

**Platform Type:** Document OCR Processing Pipeline
**Architecture:** Microservices with Real-time Updates
**Tech Stack:** PostgreSQL, Redis, Python, Node.js, AWS S3
**Deployment:** Local Development (Production-Ready Architecture)

### Core Capabilities
- Upload PDF/Image documents for OCR processing
- Asynchronous task processing with worker queue
- Real-time status updates via WebSocket
- S3 storage with KMS encryption
- Direct database change detection and UI updates
- Health monitoring and logging
- Soft delete with lifecycle management

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            USER BROWSER                                  │
│                         http://localhost:3000                            │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Frontend UI (HTML/CSS/JavaScript)                                │  │
│  │  • Upload drag-and-drop                                           │  │
│  │  • Task list with status                                          │  │
│  │  • Download original/result                                       │  │
│  │  • Delete tasks                                                   │  │
│  │  • Statistics dashboard                                           │  │
│  │  • WebSocket status indicator                                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│         │                                           ▲                    │
│         │ HTTP POST /api/tasks                      │ WebSocket          │
│         │ HTTP GET /api/tasks                       │ Real-time          │
│         │ HTTP DELETE /api/tasks/:id                │ Updates            │
│         ▼                                           │                    │
└─────────────────────────────────────────────────────────────────────────┘
         │                                           │
         │                                           │
┌────────┴───────────────────────────────────────────┴─────────────────────┐
│                    BACKEND API SERVER (Node.js)                          │
│                        http://localhost:8080                             │
│                         ws://localhost:8080                              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Express.js API                                                   │  │
│  │  • File upload handling (Multer)                                 │  │
│  │  • Task CRUD operations                                          │  │
│  │  • S3 pre-signed URL generation                                  │  │
│  │  • WebSocket server management                                   │  │
│  │  • Redis pub/sub subscriber                                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│         │                              ▲               ▲                 │
│         │ Write to DB                  │               │                 │
│         │ Enqueue task                 │ Redis         │ Redis           │
│         ▼                              │ Pub/Sub       │ Pub/Sub         │
└─────────────────────────────────────────────────────────────────────────┘
         │                              │               │
         │                              │               │
         │                              │               │
┌────────┴──────────────┐  ┌────────────┴───────┐  ┌──┴─────────────────┐
│   PostgreSQL DB       │  │   Redis Server     │  │  Database Listener │
│   localhost:5432      │  │   localhost:6379   │  │  (Node.js)         │
│                       │  │                    │  │                    │
│  ┌─────────────────┐ │  │  ┌──────────────┐  │  │  Listens to:       │
│  │ Tables:         │ │  │  │ Channels:    │  │  │  PostgreSQL NOTIFY │
│  │ • tasks         │ │  │  │ • task:queue │  │  │  'db_changes'      │
│  │ • files         │ │  │  │ • updates    │  │  │                    │
│  │ • results       │ │  │  │ • db:changes │  │  │  Publishes to:     │
│  │ • users         │ │  │  │              │  │  │  Redis channel     │
│  └─────────────────┘ │  │  └──────────────┘  │  │  'ocr:db:changes'  │
│                       │  │                    │  │                    │
│  PostgreSQL Triggers: │  │  Queue:            │  └────────────────────┘
│  • INSERT/UPDATE/     │  │  ocr:task:queue    │           │
│  • DELETE on tables   │  │                    │           │
│  • NOTIFY db_changes  │  │  Pub/Sub:          │           │
│  │                    │  │  • ocr:task:updates│           │
│  └───┬────────────────┘  │  • ocr:db:changes  │           │
│      │ NOTIFY            │                    │           │
│      └───────────────────┼────────────────────┘           │
│                          │                                │
│                          │ BRPOP                          │
│                          │ (blocking pop)                 │
│                          │                                │
└──────────────────────────┴────────────────────────────────┘
                          ▲                ▲
                          │                │
                          │ Publish        │
                          │ Updates        │
                          │                │
┌─────────────────────────┴────────────────┴─────────────────────────────┐
│                    WORKER SERVICE (Python)                              │
│                        Background Process                               │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  OCR Worker                                                       │ │
│  │  • Poll Redis queue (BRPOP)                                      │ │
│  │  • Download file from S3                                         │ │
│  │  • Process OCR (AWS Textract)                                    │ │
│  │  • Upload result to S3                                           │ │
│  │  • Update database (status, results)                             │ │
│  │  • Publish status updates to Redis                               │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│         │                                                  │            │
│         │ Download                                         │ Upload     │
│         ▼                                                  ▼            │
└─────────────────────────────────────────────────────────────────────────┘
         │                                                  │
         │                                                  │
┌────────┴──────────────────────────────────────────────────┴─────────────┐
│                        AWS S3 (Simple Storage Service)                  │
│                                                                          │
│  Bucket: ocr-platform-storage-dev                                       │
│  Encryption: AWS KMS (Server-Side)                                      │
│                                                                          │
│  Structure:                                                              │
│  • uploads/<user_id>/<file_id>_<filename>.pdf    (Original files)      │
│  • results/<user_id>/<file_id>_result.json       (OCR results)         │
│                                                                          │
│  Lifecycle Rules:                                                        │
│  • Files tagged 'deleted=true' → Glacier (Day 7) → Delete (Day 30)     │
│                                                                          │
│  Pre-signed URLs:                                                        │
│  • 1-hour expiration for downloads                                      │
│  • 15-minute expiration for uploads                                     │
└─────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                    AUXILIARY SERVICES                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Flask Health Check Server (Python)                                     │
│  http://localhost:5000                                                  │
│  • GET /health      - System health                                     │
│  • GET /status      - Queue and database stats                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component List

### 1. Frontend (HTML/CSS/JavaScript)
**Location:** `/frontend`
**Port:** 3000
**Purpose:** User interface for document upload and management

**Files:**
- `server.js` - Static file server
- `index.html` - Main UI structure
- `style.css` - Styling and animations
- `app.js` - Client-side logic and WebSocket handling

**Features:**
- Drag-and-drop file upload
- Real-time task status updates
- WebSocket connection management
- Polling fallback (5s interval)
- Download original/result files
- Delete tasks with confirmation
- Statistics dashboard (total, processing, completed, failed)
- Connection status indicator (Live/Polling)

---

### 2. Backend API (Node.js + Express)
**Location:** `/backend/src`
**Port:** 8080 (HTTP + WebSocket)
**Purpose:** RESTful API and WebSocket server

**Core Files:**
- `index.js` - Server initialization
- `app.js` - Express app setup and middleware
- `config.js` - Configuration management

**Services:**
- `services/db.service.js` - PostgreSQL operations
- `services/redis.service.js` - Redis client and pub/sub
- `services/s3.service.js` - AWS S3 operations
- `services/websocket.service.js` - WebSocket management
- `services/db-listener.js` - PostgreSQL NOTIFY listener

**Routes:**
- `routes/tasks.routes.js` - Task CRUD endpoints

**Middleware:**
- `middleware/upload.middleware.js` - Multer file upload

**Features:**
- File upload with validation (PDF, PNG, JPG, TIFF, WEBP)
- Max file size: 50MB
- Task creation and queueing
- Pre-signed URL generation (1-hour expiration)
- Soft delete (S3 tagging)
- WebSocket broadcasting
- Redis pub/sub integration
- Health check endpoints
- Request logging
- Error handling

---

### 3. OCR Worker (Python)
**Location:** `/worker`
**Port:** N/A (background process)
**Purpose:** Asynchronous OCR processing

**Core Files:**
- `run_worker.py` - Main worker loop
- `worker.py` - Worker class implementation
- `ocr_service.py` - AWS Textract integration
- `app.py` - Flask health check server

**Dependencies:**
- `redis_client.py` - Redis operations
- `db_client.py` - PostgreSQL operations
- `s3_client.py` - S3 operations
- `config.py` - Configuration
- `test_connection.py` - Connection testing

**Processing Flow:**
1. Poll Redis queue (BRPOP, 5s timeout)
2. Update task status to 'processing'
3. Download file from S3
4. Process OCR with AWS Textract
5. Save result to local JSON
6. Upload result to S3
7. Update database with results
8. Publish status update to Redis
9. Repeat

**Features:**
- Blocking queue pop (no polling overhead)
- Automatic retry on failure
- Graceful error handling
- Status updates at each stage
- Confidence score calculation
- Word/page count extraction
- Result JSON storage

---

### 4. Database Listener (Node.js)
**Location:** `/backend/src/services/db-listener.js`
**Port:** N/A (background process)
**Purpose:** Bridge PostgreSQL NOTIFY to Redis pub/sub

**Features:**
- Listens to PostgreSQL 'db_changes' channel
- Receives trigger notifications
- Publishes to Redis 'ocr:db:changes'
- Auto-reconnection on disconnect
- Handles INSERT, UPDATE, DELETE events

**Flow:**
```
PostgreSQL Trigger
    ↓
NOTIFY 'db_changes'
    ↓
db-listener.js receives
    ↓
Publishes to Redis 'ocr:db:changes'
    ↓
Backend subscribes to Redis
    ↓
Broadcasts to WebSocket clients
    ↓
Frontend updates UI
```

---

### 5. PostgreSQL Database
**Location:** Local installation
**Port:** 5432
**Database:** ocr_platform_dev
**User:** ocr_platform_user

**Tables:**

**tasks**
- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `file_id` (UUID, FK)
- `status` (ENUM: pending, processing, completed, failed)
- `error_message` (TEXT, nullable)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

**files**
- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `filename` (VARCHAR(255))
- `stored_filename` (VARCHAR(255), UNIQUE)
- `mime_type` (VARCHAR(100))
- `file_size` (BIGINT)
- `s3_bucket` (VARCHAR(255))
- `s3_key` (VARCHAR(512))
- `s3_version_id` (VARCHAR(255), nullable)
- `created_at` (TIMESTAMP)

**results**
- `id` (UUID, PK)
- `task_id` (UUID, FK, UNIQUE)
- `s3_result_key` (VARCHAR(512))
- `confidence_score` (DECIMAL(5,4))
- `page_count` (INTEGER)
- `word_count` (INTEGER)
- `processing_time_ms` (INTEGER)
- `created_at` (TIMESTAMP)

**users**
- `id` (UUID, PK)
- `email` (VARCHAR(255), UNIQUE, nullable)
- `created_at` (TIMESTAMP)
- `last_login` (TIMESTAMP, nullable)

**Triggers:**
- `tasks_change_trigger` - Fires on INSERT/UPDATE/DELETE
- `files_change_trigger` - Fires on INSERT/UPDATE/DELETE
- `results_change_trigger` - Fires on INSERT/UPDATE/DELETE

**Functions:**
- `notify_table_change()` - Sends NOTIFY with change details

---

### 6. Redis Server
**Location:** Local installation
**Port:** 6379
**Purpose:** Queue and pub/sub message broker

**Queues:**
- `ocr:task:queue` - Pending OCR tasks (LIST)

**Pub/Sub Channels:**
- `ocr:task:updates` - Worker status updates
- `ocr:db:changes` - Database change notifications

**Data Structure:**
```json
// Queue item
{
  "taskId": "uuid",
  "userId": "uuid",
  "fileId": "uuid"
}

// Pub/sub message (task updates)
{
  "taskId": "uuid",
  "userId": "uuid",
  "status": "processing",
  "message": "Processing document...",
  "progress": 50
}

// Pub/sub message (db changes)
{
  "type": "db_change",
  "data": {
    "table": "tasks",
    "operation": "UPDATE",
    "record_id": "uuid",
    "user_id": "uuid",
    "status": "completed"
  }
}
```

---

### 7. AWS S3 Storage
**Bucket:** ocr-platform-storage-dev
**Region:** us-east-1
**Encryption:** AWS KMS (Server-Side)

**Directory Structure:**
```
ocr-platform-storage-dev/
├── uploads/
│   └── <user_id>/
│       └── <file_id>_<filename>.pdf
└── results/
    └── <user_id>/
        └── <file_id>_result.json
```

**Lifecycle Policy:**
```
Files tagged 'deleted=true':
Day 0-7:   S3 Standard Storage
Day 7-30:  Glacier Storage
Day 30+:   Permanent Deletion
```

**Pre-signed URLs:**
- Upload: 15-minute expiration
- Download: 1-hour expiration

---

### 8. Flask Health Server (Python)
**Location:** `/worker/app.py`
**Port:** 5000
**Purpose:** Health monitoring

**Endpoints:**
- `GET /health` - Connection status
- `GET /status` - Queue length and task stats

---

## Data Flow Diagrams

### Flow 1: File Upload and Processing

```
1. USER UPLOADS FILE
   │
   ├─→ Browser (Frontend)
   │   └─→ POST /api/tasks (FormData: file, userId)
   │
   ├─→ Backend (Node.js)
   │   ├─→ Multer validates file (type, size)
   │   ├─→ Generate UUIDs (taskId, fileId)
   │   ├─→ Upload to S3 (uploads/<userId>/<fileId>_<filename>)
   │   ├─→ Insert into database (tasks, files)
   │   ├─→ Enqueue to Redis (LPUSH ocr:task:queue)
   │   └─→ Return response {success: true, taskId}
   │
   └─→ Worker (Python)
       ├─→ BRPOP ocr:task:queue (blocking)
       ├─→ Update status: 'processing'
       ├─→ Publish to Redis: "Processing started"
       ├─→ Download from S3
       ├─→ Process OCR (AWS Textract)
       ├─→ Upload result to S3 (results/<userId>/<fileId>_result.json)
       ├─→ Update database (status: 'completed', results table)
       └─→ Publish to Redis: "Processing completed"

2. REAL-TIME UPDATES
   │
   ├─→ Worker publishes to Redis 'ocr:task:updates'
   │
   ├─→ Backend subscribes to Redis
   │   └─→ Receives update message
   │
   ├─→ Backend broadcasts via WebSocket
   │   └─→ websocketService.sendTaskUpdate(userId, data)
   │
   └─→ Frontend receives WebSocket message
       └─→ Updates UI (status, progress, results)
```

---

### Flow 2: Direct Database Change Notification

```
1. DIRECT DATABASE MODIFICATION
   │
   ├─→ Administrator uses psql or pgAdmin
   │   └─→ UPDATE tasks SET status = 'completed' WHERE id = 'xxx';
   │
   ├─→ PostgreSQL Trigger Fires
   │   └─→ notify_table_change()
   │       └─→ NOTIFY 'db_changes' (JSON payload)
   │
   ├─→ Database Listener (Node.js)
   │   ├─→ LISTEN db_changes
   │   ├─→ Receives notification
   │   ├─→ Parses payload
   │   └─→ Publishes to Redis 'ocr:db:changes'
   │
   ├─→ Backend subscribes to Redis
   │   └─→ Receives db change message
   │
   ├─→ Backend broadcasts via WebSocket
   │   └─→ websocketService.sendDatabaseChange(userId, data)
   │
   └─→ Frontend receives WebSocket message
       └─→ handleDatabaseChange()
           └─→ Reloads task list (instant UI update)

Total latency: < 1 second
```

---

### Flow 3: File Download

```
1. USER CLICKS "Download Result"
   │
   ├─→ Browser (Frontend)
   │   └─→ GET /api/tasks/:taskId/result
   │
   ├─→ Backend (Node.js)
   │   ├─→ Query database for s3_result_key
   │   ├─→ Generate pre-signed URL (1-hour expiration)
   │   └─→ Return {success: true, resultUrl: "https://..."}
   │
   └─→ Browser opens pre-signed URL
       └─→ AWS S3 serves file directly (no proxy)

2. USER CLICKS "Download Original"
   │
   ├─→ Browser (Frontend)
   │   └─→ GET /api/tasks/:taskId/download
   │
   ├─→ Backend (Node.js)
   │   ├─→ Query database for s3_key
   │   ├─→ Generate pre-signed URL (1-hour expiration)
   │   └─→ Return {success: true, downloadUrl: "https://..."}
   │
   └─→ Browser opens pre-signed URL
       └─→ AWS S3 serves file directly
```

---

### Flow 4: Task Deletion (Soft Delete)

```
1. USER CLICKS "Delete"
   │
   ├─→ Browser confirms: "Are you sure?"
   │
   ├─→ DELETE /api/tasks/:taskId
   │
   ├─→ Backend (Node.js)
   │   ├─→ Query task and file details
   │   ├─→ Tag S3 objects as deleted
   │   │   └─→ PutObjectTagging (deleted=true, deleted_at=timestamp)
   │   ├─→ DELETE FROM tasks (cascade to results)
   │   ├─→ DELETE FROM files
   │   └─→ Return {success: true}
   │
   ├─→ PostgreSQL Trigger fires (DELETE)
   │   └─→ NOTIFY 'db_changes'
   │
   ├─→ db-listener → Redis → Backend → WebSocket → Frontend
   │   └─→ UI updates automatically
   │
   └─→ S3 Lifecycle Policy (background)
       ├─→ Day 7: Move to Glacier
       └─→ Day 30: Permanent deletion
```

---

## Database Schema

### Entity Relationship Diagram

```
┌─────────────────┐
│     users       │
│─────────────────│
│ id (PK)         │◄──┐
│ email           │   │
│ created_at      │   │
│ last_login      │   │
└─────────────────┘   │
                      │
                      │ user_id (FK)
                      │
┌─────────────────┐   │
│     files       │   │
│─────────────────│   │
│ id (PK)         │◄──┼───┐
│ user_id (FK)    │───┘   │
│ filename        │       │
│ stored_filename │       │
│ mime_type       │       │
│ file_size       │       │
│ s3_bucket       │       │
│ s3_key          │       │ file_id (FK)
│ s3_version_id   │       │
│ created_at      │       │
└─────────────────┘       │
                          │
                          │
┌─────────────────┐       │
│     tasks       │       │
│─────────────────│       │
│ id (PK)         │◄──┐   │
│ user_id (FK)    │───┼───┘
│ file_id (FK)    │───┘
│ status          │
│ error_message   │
│ created_at      │
│ updated_at      │
└─────────────────┘
        │
        │ task_id (FK)
        │
        ▼
┌─────────────────┐
│    results      │
│─────────────────│
│ id (PK)         │
│ task_id (FK)    │
│ s3_result_key   │
│ confidence_score│
│ page_count      │
│ word_count      │
│ processing_time │
│ created_at      │
└─────────────────┘
```

---

## File Structure

```
/Users/benfrankstein/Projects/untxt/
│
├── backend/                          # Node.js Backend API
│   ├── src/
│   │   ├── index.js                  # Server entry point
│   │   ├── app.js                    # Express app setup
│   │   ├── config.js                 # Configuration
│   │   ├── routes/
│   │   │   └── tasks.routes.js       # Task endpoints
│   │   ├── services/
│   │   │   ├── db.service.js         # PostgreSQL client
│   │   │   ├── redis.service.js      # Redis client
│   │   │   ├── s3.service.js         # S3 client
│   │   │   ├── websocket.service.js  # WebSocket server
│   │   │   └── db-listener.js        # PostgreSQL NOTIFY listener
│   │   └── middleware/
│   │       └── upload.middleware.js  # Multer configuration
│   ├── package.json
│   └── .env                          # Backend environment vars
│
├── frontend/                         # Static Frontend
│   ├── server.js                     # Static file server
│   ├── index.html                    # UI structure
│   ├── style.css                     # Styling
│   ├── app.js                        # Client-side logic
│   └── package.json
│
├── worker/                           # Python OCR Worker
│   ├── run_worker.py                 # Worker entry point
│   ├── worker.py                     # Worker class
│   ├── ocr_service.py                # AWS Textract integration
│   ├── app.py                        # Flask health server
│   ├── redis_client.py               # Redis operations
│   ├── db_client.py                  # PostgreSQL operations
│   ├── s3_client.py                  # S3 operations
│   ├── config.py                     # Configuration
│   ├── test_connection.py            # Connection testing
│   ├── requirements.txt              # Python dependencies
│   └── .env                          # Worker environment vars
│
├── database/                         # Database Management
│   ├── migrations/
│   │   ├── 01_initial_schema.sql     # Core tables
│   │   ├── 02_add_tasks.sql          # Task table
│   │   ├── 03_add_results.sql        # Results table
│   │   └── 04_add_change_notifications.sql  # Triggers
│   └── scripts/
│       ├── setup_database.sh         # Initial DB setup
│       └── apply_change_notifications.sh    # Apply triggers
│
├── logs/                             # Service Logs
│   ├── postgresql.log
│   ├── redis.log
│   ├── worker.log
│   ├── flask.log
│   ├── backend.log
│   ├── db-listener.log
│   └── frontend.log
│
├── pids/                             # Process IDs
│   ├── redis.pid
│   ├── worker.pid
│   ├── flask.pid
│   ├── backend.pid
│   ├── db-listener.pid
│   └── frontend.pid
│
├── output/                           # Local result storage
│   └── <task_id>_result.json
│
├── docs/                             # Documentation
│   ├── DEVELOPMENT_ORDER.md          # Build sequence
│   ├── PHASE2_COMPLETE.md            # Phase 2 status
│   └── SERVICE_SCRIPTS.md            # Script documentation
│
├── start_services.sh                 # Start all services
├── stop_services.sh                  # Stop all services
├── status.sh                         # Check service status
├── test_db_changes.sh                # Test DB notifications
├── test_worker.sh                    # Test worker
│
├── .env                              # Global environment vars
├── .gitignore
└── README.md
```

---

## Functionality Matrix

### User-Facing Features

| Feature | Status | Component | Endpoint/Method |
|---------|--------|-----------|----------------|
| Upload PDF/Image | ✅ Complete | Frontend → Backend | POST /api/tasks |
| View all tasks | ✅ Complete | Frontend → Backend | GET /api/tasks?userId=X |
| View task details | ✅ Complete | Frontend (task card) | Displayed in UI |
| Download original file | ✅ Complete | Frontend → Backend | GET /api/tasks/:id/download |
| Download OCR result | ✅ Complete | Frontend → Backend | GET /api/tasks/:id/result |
| Delete task | ✅ Complete | Frontend → Backend | DELETE /api/tasks/:id |
| Real-time status updates | ✅ Complete | WebSocket | ws://localhost:8080 |
| View statistics | ✅ Complete | Frontend (dashboard) | Part of GET /api/tasks |
| Drag-and-drop upload | ✅ Complete | Frontend | HTML5 drag events |
| Manual refresh | ✅ Complete | Frontend (button) | Triggers loadTasks() |

### System Features

| Feature | Status | Component | Details |
|---------|--------|-----------|---------|
| Asynchronous processing | ✅ Complete | Worker + Redis | BRPOP queue |
| S3 encrypted storage | ✅ Complete | Worker + Backend | AWS KMS encryption |
| Pre-signed URL downloads | ✅ Complete | Backend | 1-hour expiration |
| Soft delete | ✅ Complete | Backend + S3 | Tagging strategy |
| Database triggers | ✅ Complete | PostgreSQL | INSERT/UPDATE/DELETE |
| Direct DB change detection | ✅ Complete | db-listener | PostgreSQL NOTIFY |
| Redis pub/sub | ✅ Complete | Worker + Backend | 2 channels |
| WebSocket broadcasting | ✅ Complete | Backend | Per-user connections |
| Polling fallback | ✅ Complete | Frontend | 5-second interval |
| Health monitoring | ✅ Complete | Flask server | /health, /status |
| Connection retry | ✅ Complete | All services | Auto-reconnect |
| Graceful shutdown | ✅ Complete | All services | SIGTERM/SIGINT |
| Error handling | ✅ Complete | All services | Try-catch + logging |

### Processing Features

| Feature | Status | Component | Details |
|---------|--------|-----------|---------|
| OCR extraction | ✅ Complete | Worker | AWS Textract |
| Confidence scoring | ✅ Complete | Worker | Per-page average |
| Page count | ✅ Complete | Worker | Textract metadata |
| Word count | ✅ Complete | Worker | Text analysis |
| Processing time tracking | ✅ Complete | Worker | Milliseconds |
| Result JSON storage | ✅ Complete | Worker | Local + S3 |
| Status transitions | ✅ Complete | Worker | pending → processing → completed |
| Error capture | ✅ Complete | Worker | status: failed + error_message |

### Security Features

| Feature | Status | Component | Details |
|---------|--------|-----------|---------|
| File type validation | ✅ Complete | Backend | Multer middleware |
| File size limit (50MB) | ✅ Complete | Backend | Multer config |
| S3 encryption at rest | ✅ Complete | S3 + KMS | Server-side |
| Pre-signed URL expiry | ✅ Complete | Backend | Time-limited access |
| Database triggers | ✅ Complete | PostgreSQL | Change auditing |
| Environment variables | ✅ Complete | All services | .env files |
| CORS configuration | ✅ Complete | Backend | Express middleware |

---

## Service Dependencies

### Startup Order (Critical Path)

```
1. PostgreSQL        (Database)
   ↓
2. Redis             (Message broker)
   ↓
3. Worker            (Consumes queue, publishes updates)
   ↓
4. Flask             (Health monitoring)
   ↓
5. db-listener       (Database change notifications)
   ↓
6. Backend           (Subscribes to Redis, serves API, WebSocket)
   ↓
7. Frontend          (Connects to Backend WebSocket)
```

### Service Communication Matrix

| From Service | To Service | Protocol | Purpose |
|--------------|-----------|----------|---------|
| Frontend | Backend | HTTP | API requests (upload, get, delete) |
| Frontend | Backend | WebSocket | Real-time updates |
| Backend | PostgreSQL | TCP (5432) | Database queries |
| Backend | Redis | TCP (6379) | Pub/sub subscribe |
| Backend | S3 | HTTPS | Upload files, generate URLs |
| Backend | WebSocket Clients | WS | Broadcast updates |
| Worker | PostgreSQL | TCP (5432) | Update task status |
| Worker | Redis | TCP (6379) | BRPOP queue, publish updates |
| Worker | S3 | HTTPS | Download/upload files |
| Worker | AWS Textract | HTTPS | OCR processing |
| db-listener | PostgreSQL | TCP (5432) | LISTEN notifications |
| db-listener | Redis | TCP (6379) | Publish db changes |
| PostgreSQL | db-listener | NOTIFY | Trigger events |

### Port Allocation

| Service | Port | Protocol | Access |
|---------|------|----------|--------|
| Frontend | 3000 | HTTP | Public (browser) |
| Backend | 8080 | HTTP + WS | Public (browser) |
| Flask | 5000 | HTTP | Internal (monitoring) |
| PostgreSQL | 5432 | TCP | Internal (services) |
| Redis | 6379 | TCP | Internal (services) |
| Worker | N/A | N/A | Background process |
| db-listener | N/A | N/A | Background process |

---

## API Endpoints

### Backend API (http://localhost:8080)

#### Health Check
```
GET /health
Response: {
  success: true,
  service: "OCR Platform Backend API",
  timestamp: "2025-10-19T...",
  components: {
    database: { healthy: true },
    redis: { healthy: true }
  }
}
```

#### Get Tasks
```
GET /api/tasks?userId=<uuid>
Response: {
  success: true,
  data: {
    tasks: [
      {
        id: "uuid",
        user_id: "uuid",
        filename: "document.pdf",
        status: "completed",
        created_at: "2025-10-19T...",
        s3_key: "uploads/...",
        s3_result_key: "results/...",
        confidence_score: 0.9856,
        page_count: 5,
        word_count: 1243
      }
    ],
    stats: {
      total: 10,
      pending: 2,
      processing: 1,
      completed: 6,
      failed: 1
    }
  }
}
```

#### Upload Task
```
POST /api/tasks
Content-Type: multipart/form-data
Body: {
  file: <PDF/Image file>,
  userId: "uuid"
}

Response: {
  success: true,
  data: {
    taskId: "uuid",
    message: "File uploaded and queued for processing"
  }
}
```

#### Download Original
```
GET /api/tasks/:taskId/download
Response: {
  success: true,
  data: {
    downloadUrl: "https://s3.amazonaws.com/...?X-Amz-Signature=..."
  }
}
```

#### Download Result
```
GET /api/tasks/:taskId/result
Response: {
  success: true,
  data: {
    resultUrl: "https://s3.amazonaws.com/...?X-Amz-Signature=..."
  }
}
```

#### Delete Task
```
DELETE /api/tasks/:taskId
Response: {
  success: true,
  message: "Task and associated files deleted successfully"
}
```

### Flask Health Server (http://localhost:5000)

#### Health Check
```
GET /health
Response: {
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "timestamp": "2025-10-19T..."
}
```

#### System Status
```
GET /status
Response: {
  "queue_length": 3,
  "tasks": {
    "total": 15,
    "pending": 3,
    "processing": 1,
    "completed": 10,
    "failed": 1
  },
  "uptime": 3600
}
```

### WebSocket API (ws://localhost:8080?userId=<uuid>)

#### Connection
```
// Client connects with userId
ws = new WebSocket('ws://localhost:8080?userId=11111111-1111-1111-1111-111111111111');

// Server sends welcome
{
  type: 'connected',
  message: 'WebSocket connection established',
  userId: 'uuid',
  timestamp: '2025-10-19T...'
}
```

#### Task Update (from Worker)
```
{
  type: 'task_update',
  data: {
    taskId: 'uuid',
    status: 'processing',
    message: 'Processing page 2 of 5',
    progress: 40
  },
  timestamp: '2025-10-19T...'
}
```

#### Database Change (from Triggers)
```
{
  type: 'db_change',
  data: {
    table: 'tasks',
    operation: 'UPDATE',
    recordId: 'uuid',
    status: 'completed',
    message: 'Database update on tasks'
  },
  timestamp: '2025-10-19T...'
}
```

#### Ping/Pong
```
// Client sends
{
  type: 'ping'
}

// Server responds
{
  type: 'pong',
  timestamp: '2025-10-19T...'
}
```

---

## Environment Variables

### Global (.env at project root)
```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# S3 Configuration
S3_BUCKET_NAME=ocr-platform-storage-dev
KMS_KEY_ID=your-kms-key-id

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_dev
DB_USER=ocr_platform_user
DB_PASSWORD=your-secure-password

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Node Environment
NODE_ENV=development
```

### Backend (.env in /backend)
```bash
# Server
PORT=8080

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_dev
DB_USER=ocr_platform_user
DB_PASSWORD=your-secure-password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# S3
S3_BUCKET_NAME=ocr-platform-storage-dev
KMS_KEY_ID=your-kms-key-id

# Upload Limits
MAX_FILE_SIZE=52428800  # 50MB in bytes
```

### Worker (.env in /worker)
```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_dev
DB_USER=ocr_platform_user
DB_PASSWORD=your-secure-password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# S3
S3_BUCKET_NAME=ocr-platform-storage-dev
KMS_KEY_ID=your-kms-key-id

# Worker Settings
WORKER_POLL_TIMEOUT=5  # seconds
```

---

## Performance Characteristics

### Throughput
- **Upload**: ~5 MB/s (depends on S3 connection)
- **OCR Processing**: ~30 seconds per document (AWS Textract)
- **WebSocket Latency**: < 100ms
- **Database Change Notification**: < 1 second end-to-end

### Scalability
- **Frontend**: Stateless (horizontal scaling)
- **Backend**: Stateless (horizontal scaling with load balancer)
- **Worker**: Horizontal scaling (multiple workers, shared queue)
- **Database**: Vertical scaling (connection pooling: 20 connections)
- **Redis**: Single instance (can cluster for HA)

### Resource Usage (per service)
- **Frontend**: ~50 MB RAM
- **Backend**: ~100 MB RAM
- **Worker**: ~150 MB RAM (Python + libraries)
- **db-listener**: ~50 MB RAM
- **PostgreSQL**: ~200 MB RAM (dev workload)
- **Redis**: ~50 MB RAM

---

## Testing Scripts

### Start All Services
```bash
./start_services.sh
```

### Stop All Services
```bash
./stop_services.sh
```

### Check Service Status
```bash
./status.sh
```

### Test Database Changes
```bash
./test_db_changes.sh
```

### Test Worker
```bash
./test_worker.sh
```

### Apply Database Migration
```bash
./database/scripts/apply_change_notifications.sh
```

---

## Monitoring and Debugging

### View Logs
```bash
# All logs at once
tail -f logs/*.log

# Individual services
tail -f logs/worker.log
tail -f logs/backend.log
tail -f logs/db-listener.log
tail -f logs/frontend.log
```

### Check Queue Length
```bash
redis-cli LLEN ocr:task:queue
```

### Monitor Redis Pub/Sub
```bash
redis-cli
> SUBSCRIBE ocr:task:updates
> SUBSCRIBE ocr:db:changes
```

### Database Query
```bash
psql -U ocr_platform_user -d ocr_platform_dev

# Check task status
SELECT id, filename, status, created_at FROM tasks ORDER BY created_at DESC LIMIT 10;

# Check triggers
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE '%change%';
```

### Test WebSocket Connection
```javascript
// Browser console
const ws = new WebSocket('ws://localhost:8080?userId=11111111-1111-1111-1111-111111111111');
ws.onmessage = (e) => console.log('Received:', JSON.parse(e.data));
```

---

## Known Limitations

1. **Authentication**: Hardcoded user ID (demo only)
2. **Authorization**: No role-based access control
3. **Rate Limiting**: No request throttling
4. **File Validation**: Basic MIME type checking only
5. **Concurrent Workers**: Single worker instance
6. **Database Pooling**: Fixed pool size (20)
7. **S3 Region**: Hardcoded to us-east-1
8. **Error Recovery**: Basic retry logic
9. **Monitoring**: Manual log inspection
10. **Backup**: No automated database backups

---

## Future Enhancements (Not Implemented)

1. **User Authentication**: JWT-based auth
2. **User Dashboard**: Per-user statistics
3. **Batch Upload**: Multiple files at once
4. **OCR Format Options**: PDF, DOCX, TXT output
5. **Search Results**: Full-text search in OCR results
6. **Admin Panel**: User management, system monitoring
7. **Cost Tracking**: AWS cost per task
8. **Notification Emails**: Task completion alerts
9. **API Rate Limiting**: Throttling and quotas
10. **Audit Logging**: Complete change history

---

## Production Readiness Checklist

### Completed ✅
- [x] S3 encryption at rest (KMS)
- [x] Pre-signed URLs for secure downloads
- [x] Soft delete with recovery window
- [x] Database triggers for change auditing
- [x] Real-time UI updates
- [x] WebSocket connection management
- [x] Graceful service shutdown
- [x] Error handling and logging
- [x] Health check endpoints
- [x] Connection retry logic
- [x] Environment variable configuration

### Required for Production ❌
- [ ] User authentication (JWT)
- [ ] HTTPS/TLS certificates
- [ ] Database backups (automated)
- [ ] Redis persistence (AOF/RDB)
- [ ] Horizontal scaling setup
- [ ] Load balancer configuration
- [ ] CDN for frontend assets
- [ ] Rate limiting and throttling
- [ ] Monitoring and alerting (CloudWatch, Sentry)
- [ ] CI/CD pipeline
- [ ] Infrastructure as Code (Terraform/CloudFormation)
- [ ] Security audit and penetration testing

---

**Last Updated:** 2025-10-19
**Version:** 1.0
**Status:** Phase 1-3 Complete + Real-time DB Notifications
