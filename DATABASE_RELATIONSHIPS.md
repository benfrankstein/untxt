# Database Relationships & Query Guide

**Generated:** 2025-10-19

## Table Relationships

### Entity Relationship Diagram

```
┌─────────────────┐
│     users       │
│─────────────────│
│ id (PK)         │◄────────┐
│ username        │         │
│ email           │         │
│ password_hash   │         │
│ role            │         │
│ is_active       │         │
│ email_verified  │         │
│ created_at      │         │
│ updated_at      │         │
│ last_login      │         │
└─────────────────┘         │
                            │
                            │ user_id (FK)
                            │
┌─────────────────┐         │
│     files       │         │
│─────────────────│         │
│ id (PK)         │◄────┬───┘
│ user_id (FK)    │─────┘
│ filename        │
│ file_type       │
│ file_size       │
│ s3_key          │
│ uploaded_at     │
└─────────────────┘
        │
        │ file_id (FK)
        │
        ▼
┌─────────────────┐
│     tasks       │
│─────────────────│
│ id (PK)         │◄───────────┐
│ user_id (FK)    │────────────┼─── Links to users table
│ file_id (FK)    │────────────┘
│ status          │
│ priority        │
│ created_at      │
│ started_at      │
│ completed_at    │
│ error_message   │
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
│ confidence      │
│ page_count      │
│ word_count      │
│ created_at      │
└─────────────────┘
```

## Foreign Key Relationships

### users → files
- **Relationship**: One user has many files
- **Foreign Key**: `files.user_id` → `users.id`
- **On Delete**: CASCADE (delete all user's files when user is deleted)

### users → tasks
- **Relationship**: One user has many tasks
- **Foreign Key**: `tasks.user_id` → `users.id`
- **On Delete**: CASCADE (delete all user's tasks when user is deleted)

### files → tasks
- **Relationship**: One file has many tasks (can be reprocessed)
- **Foreign Key**: `tasks.file_id` → `files.id`
- **On Delete**: CASCADE (delete all tasks when file is deleted)

### tasks → results
- **Relationship**: One task has one result
- **Foreign Key**: `results.task_id` → `tasks.id`
- **On Delete**: CASCADE (delete result when task is deleted)

## Query Examples by User ID

### Get All Files for a User

```sql
SELECT
    id,
    original_filename,
    file_type,
    file_size,
    s3_key,
    uploaded_at
FROM files
WHERE user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'
ORDER BY uploaded_at DESC;
```

### Get All Tasks for a User

```sql
SELECT
    t.id,
    t.status,
    t.priority,
    t.created_at,
    t.started_at,
    t.completed_at,
    f.original_filename,
    f.file_type
FROM tasks t
JOIN files f ON t.file_id = f.id
WHERE t.user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'
ORDER BY t.created_at DESC;
```

### Get Tasks with Their Files and Results

```sql
SELECT
    t.id as task_id,
    t.status,
    t.created_at,
    t.completed_at,
    f.original_filename,
    f.file_size,
    f.s3_key as upload_s3_key,
    r.s3_result_key,
    r.confidence_score,
    r.page_count,
    r.word_count
FROM tasks t
JOIN files f ON t.file_id = f.id
LEFT JOIN results r ON r.task_id = t.id
WHERE t.user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'
ORDER BY t.created_at DESC;
```

### Get Task Statistics for a User

```sql
SELECT
    COUNT(*) as total_tasks,
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'processing') as processing,
    COUNT(*) FILTER (WHERE status = 'completed') as completed,
    COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM tasks
WHERE user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1';
```

### Get User's Storage Usage

```sql
SELECT
    u.username,
    u.email,
    COUNT(f.id) as total_files,
    SUM(f.file_size) as total_bytes,
    pg_size_pretty(SUM(f.file_size)) as total_size_human
FROM users u
LEFT JOIN files f ON f.user_id = u.id
WHERE u.id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'
GROUP BY u.id, u.username, u.email;
```

### Get Recent Activity for a User

```sql
SELECT
    'task_created' as event_type,
    t.id as record_id,
    f.original_filename as description,
    t.created_at as event_time
FROM tasks t
JOIN files f ON t.file_id = f.id
WHERE t.user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'

UNION ALL

SELECT
    'file_uploaded' as event_type,
    f.id as record_id,
    f.original_filename as description,
    f.uploaded_at as event_time
FROM files f
WHERE f.user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'

ORDER BY event_time DESC
LIMIT 20;
```

## How the Backend Uses User ID

### File Upload Flow

```javascript
// 1. User uploads file
POST /api/tasks
Body: { file: <file>, userId: '3c8bf409-1992-4156-add2-3d5bb3df6ec1' }

// 2. Backend creates file record
INSERT INTO files (user_id, original_filename, ...)
VALUES ('3c8bf409-1992-4156-add2-3d5bb3df6ec1', 'document.pdf', ...);

// 3. Backend creates task record
INSERT INTO tasks (user_id, file_id, ...)
VALUES ('3c8bf409-1992-4156-add2-3d5bb3df6ec1', '<file_id>', ...);
```

### Fetching User's Tasks

```javascript
// Frontend requests
GET /api/tasks?userId=3c8bf409-1992-4156-add2-3d5bb3df6ec1

// Backend queries
SELECT t.*, f.*, r.*
FROM tasks t
JOIN files f ON t.file_id = f.id
LEFT JOIN results r ON r.task_id = t.id
WHERE t.user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1';
```

## Database Indexes for User Queries

All user-related queries are optimized with these indexes:

```sql
-- Files by user
CREATE INDEX idx_files_user_id ON files(user_id);

-- Tasks by user
CREATE INDEX idx_tasks_user_id ON tasks(user_id);

-- Combined status + priority for user's pending tasks
CREATE INDEX idx_tasks_status_priority ON tasks(status, priority DESC)
WHERE status = 'pending';
```

## Cascade Delete Behavior

When a user is deleted, the cascade happens in this order:

```
DELETE FROM users WHERE id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1';

↓ CASCADE

1. DELETE FROM user_sessions WHERE user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1';
2. DELETE FROM tasks WHERE user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1';
   ↓ CASCADE
   - DELETE FROM results WHERE task_id IN (user's tasks);
   - DELETE FROM task_history WHERE task_id IN (user's tasks);

3. DELETE FROM files WHERE user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1';
   ↓ CASCADE
   - DELETE FROM tasks WHERE file_id IN (user's files); (already deleted)
```

**Plus S3 Cleanup:**
- Database triggers fire → NOTIFY with S3 keys
- db-listener publishes to Redis
- Backend receives and deletes files from S3

## Your Current User

```sql
-- Your admin user ID
user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'

-- Query all your data
SELECT * FROM files WHERE user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1';
SELECT * FROM tasks WHERE user_id = '3c8bf409-1992-4156-add2-3d5bb3df6ec1';
```

## Frontend Configuration

The frontend uses your user ID automatically:

```javascript
// frontend/app.js
const USER_ID = '3c8bf409-1992-4156-add2-3d5bb3df6ec1'; // benfrankstein (admin)

// All API calls include this user ID
fetch(`${API_URL}/api/tasks?userId=${USER_ID}`);
```

## Summary

✅ **Yes, files and tasks tables use the user ID from the users table**

- `files.user_id` → `users.id` (who uploaded the file)
- `tasks.user_id` → `users.id` (who owns the task)

✅ **You can query by user ID to get all related data**

- All files: `WHERE files.user_id = '<your-id>'`
- All tasks: `WHERE tasks.user_id = '<your-id>'`
- Everything is linked through foreign keys with CASCADE delete
