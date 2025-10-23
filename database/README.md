# OCR Platform Database

Complete PostgreSQL database setup for the OCR Platform, including schema, migrations, seed data, and testing tools.

## Overview

This database implementation provides:

- **Users Table**: Authentication, roles, and user management
- **Files Table**: Metadata for uploaded documents
- **Tasks Table**: OCR job tracking and queue management
- **Results Table**: Processed OCR output storage
- **Supporting Tables**: Sessions, history, and statistics
- **Views**: Pre-built queries for common operations
- **Triggers**: Automated logging and validation

## Prerequisites

- PostgreSQL 14+ (you have 16.10 installed)
- Bash shell (for setup scripts)
- Basic understanding of SQL

## Quick Start

### 1. Setup Database

Run the automated setup script:

```bash
cd database/scripts
./setup_database.sh
```

This will:
- Create database and user
- Apply the schema
- Optionally load seed data
- Generate environment configuration file

### 2. Verify Installation

Run CRUD tests:

```bash
./test_crud.sh
```

### 3. Connect to Database

```bash
psql -h localhost -U ocr_platform_user -d ocr_platform_dev
```

Or source the generated environment file:

```bash
source ../.env.database
psql $DATABASE_URL
```

## Directory Structure

```
database/
├── README.md                    # This file
├── schema.sql                   # Complete schema definition
├── migrations/                  # Database migrations
│   ├── 001_initial_schema.sql  # Initial setup
│   └── rollback_001.sql        # Rollback script
├── seeds/                       # Test data
│   └── seed_data.sql           # Sample users, files, tasks
├── scripts/                     # Automation scripts
│   ├── setup_database.sh       # Database setup
│   └── test_crud.sh            # Run tests
└── tests/                       # Test suites
    └── test_crud.sql           # CRUD operations test
```

## Database Schema

### Core Tables

#### users
User accounts with authentication and role management.

```sql
- id (UUID, PK)
- email (VARCHAR, UNIQUE)
- username (VARCHAR, UNIQUE)
- password_hash (VARCHAR)
- role (ENUM: admin, user, guest)
- is_active (BOOLEAN)
- email_verified (BOOLEAN)
- created_at, updated_at, last_login (TIMESTAMP)
```

**Constraints:**
- Email format validation
- Username minimum 3 characters
- Unique email and username

#### files
Metadata for uploaded documents.

```sql
- id (UUID, PK)
- user_id (UUID, FK -> users)
- original_filename (VARCHAR)
- stored_filename (VARCHAR, UNIQUE)
- file_path (TEXT)
- file_type (ENUM: pdf, image, document)
- mime_type (VARCHAR)
- file_size (BIGINT)
- file_hash (VARCHAR) -- SHA-256 for deduplication
- uploaded_at (TIMESTAMP)
```

**Constraints:**
- Positive file size
- Cascade delete with user

#### tasks
OCR job tracking and queue management.

```sql
- id (UUID, PK)
- user_id (UUID, FK -> users)
- file_id (UUID, FK -> files)
- status (ENUM: pending, processing, completed, failed, cancelled)
- priority (INTEGER, 0-10)
- created_at, started_at, completed_at (TIMESTAMP)
- worker_id (VARCHAR)
- attempts (INTEGER)
- max_attempts (INTEGER)
- error_message (TEXT)
- options (JSONB) -- OCR parameters
```

**Constraints:**
- Priority range 0-10
- Attempts ≤ max_attempts
- Completed after started
- Cannot delete processing tasks (trigger)

#### results
Processed OCR output.

```sql
- id (UUID, PK)
- task_id (UUID, FK -> tasks, UNIQUE)
- extracted_text (TEXT)
- confidence_score (DECIMAL, 0-1)
- structured_data (JSONB)
- page_count (INTEGER)
- word_count (INTEGER)
- processing_time_ms (INTEGER)
- model_version (VARCHAR)
- result_file_path (TEXT)
- created_at (TIMESTAMP)
```

**Constraints:**
- Confidence score 0.0-1.0
- Positive counts and processing time

### Supporting Tables

#### user_sessions
Active user sessions for authentication.

```sql
- id (UUID, PK)
- user_id (UUID, FK -> users)
- session_token (VARCHAR, UNIQUE)
- ip_address (INET)
- user_agent (TEXT)
- expires_at (TIMESTAMP)
- created_at (TIMESTAMP)
```

#### task_history
Audit log for task status changes.

```sql
- id (UUID, PK)
- task_id (UUID, FK -> tasks)
- status (task_status)
- message (TEXT)
- metadata (JSONB)
- created_at (TIMESTAMP)
```

**Auto-populated by trigger** when task status changes.

#### system_stats
System-wide metrics and statistics.

```sql
- id (SERIAL, PK)
- metric_name (VARCHAR)
- metric_value (DECIMAL)
- recorded_at (TIMESTAMP)
- metadata (JSONB)
```

### Views

Pre-built views for common queries:

#### active_tasks_view
Shows pending and processing tasks with user and file information.

```sql
SELECT * FROM active_tasks_view;
```

#### completed_tasks_view
Shows completed tasks with results and timing information.

```sql
SELECT * FROM completed_tasks_view;
```

#### user_stats_view
Aggregates user statistics (tasks, files, storage).

```sql
SELECT * FROM user_stats_view WHERE username = 'johndoe';
```

### Triggers

#### update_users_updated_at
Automatically updates `updated_at` timestamp on user modifications.

#### task_status_change_trigger
Logs status changes to `task_history` table automatically.

#### prevent_processing_task_deletion
Prevents deletion of tasks currently being processed.

## Configuration

### Default Values

| Setting | Default Value |
|---------|--------------|
| Database Name | `ocr_platform_dev` |
| Database User | `ocr_platform_user` |
| Database Password | `ocr_platform_pass_dev` |
| Host | `localhost` |
| Port | `5432` |

### Custom Configuration

Set environment variables before running setup:

```bash
export DB_NAME="my_custom_db"
export DB_USER="my_user"
export DB_PASSWORD="my_secure_password"
./setup_database.sh
```

### Environment File

After setup, connection details are in `.env.database`:

```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_dev
DB_USER=ocr_platform_user
DB_PASSWORD=ocr_platform_pass_dev

# Connection String
DATABASE_URL=postgresql://ocr_platform_user:ocr_platform_pass_dev@localhost:5432/ocr_platform_dev

# Pool Configuration
DB_POOL_MIN=2
DB_POOL_MAX=10
```

## Seed Data

The seed data includes:

- **7 users**: admin, regular users, guest, and inactive user
  - Password for all: `Password123!`
  - Usernames: `admin`, `johndoe`, `janesmith`, `bobwilson`, `alicejohnson`, `guestuser`, `inactiveuser`
- **8 files**: Various PDFs and images
- **9 tasks**: Mix of completed, processing, pending, and failed tasks
- **5 results**: OCR output samples with realistic data
- **Task history**: Audit trail entries
- **System statistics**: Sample metrics

### Sample Queries with Seed Data

```sql
-- Login as admin
SELECT * FROM users WHERE username = 'admin';

-- View all completed tasks
SELECT * FROM completed_tasks_view;

-- Check user statistics
SELECT * FROM user_stats_view;

-- Find high-priority pending tasks
SELECT * FROM tasks
WHERE status = 'pending' AND priority >= 7
ORDER BY priority DESC;

-- Search for invoice results
SELECT * FROM results
WHERE extracted_text ILIKE '%invoice%';
```

## Testing

### Run All Tests

```bash
cd database/scripts
./test_crud.sh
```

### Test Coverage

The test suite covers:

1. **CREATE Operations**
   - Insert users, files, tasks
   - Verify auto-generated UUIDs
   - Test default values

2. **READ Operations**
   - Query by various fields
   - Join multiple tables
   - Use views

3. **UPDATE Operations**
   - Modify records
   - Update JSON fields
   - Verify triggers

4. **Complex Queries**
   - Aggregations
   - Subqueries
   - JSON operations

5. **Constraints**
   - Email format validation
   - Username length
   - Unique constraints
   - Positive values
   - Foreign keys

6. **Cascade Deletes**
   - Delete parent records
   - Verify children deleted

7. **DELETE Operations**
   - Remove test data
   - Clean up

### Manual Testing

Connect to database and run queries:

```bash
psql -U ocr_platform_user -d ocr_platform_dev

-- List all tables
\dt

-- Describe users table
\d users

-- Run a query
SELECT * FROM active_tasks_view;

-- Exit
\q
```

## Common Operations

### Create a User

```sql
INSERT INTO users (email, username, password_hash, role)
VALUES ('new.user@example.com', 'newuser', 'hashed_password', 'user')
RETURNING id, username, email;
```

### Create a Task

```sql
-- First, create file record
INSERT INTO files (user_id, original_filename, stored_filename, file_path, file_type, file_size)
VALUES (
    'user-uuid-here',
    'document.pdf',
    'stored_name.pdf',
    '/path/to/file.pdf',
    'pdf',
    102400
)
RETURNING id;

-- Then create task
INSERT INTO tasks (user_id, file_id, status, priority, options)
VALUES (
    'user-uuid-here',
    'file-uuid-here',
    'pending',
    5,
    '{"language": "en", "enhance": true}'::jsonb
)
RETURNING id;
```

### Update Task Status

```sql
UPDATE tasks
SET
    status = 'processing',
    started_at = NOW(),
    worker_id = 'worker-001'
WHERE id = 'task-uuid-here'
RETURNING *;
```

### Store OCR Result

```sql
INSERT INTO results (
    task_id,
    extracted_text,
    confidence_score,
    word_count,
    processing_time_ms,
    model_version
)
VALUES (
    'task-uuid-here',
    'The extracted text content...',
    0.9534,
    245,
    3456,
    'qwen3-v1.0'
)
RETURNING id;

-- Update task to completed
UPDATE tasks
SET status = 'completed', completed_at = NOW()
WHERE id = 'task-uuid-here';
```

### Query User's Tasks

```sql
SELECT
    t.id,
    t.status,
    t.created_at,
    f.original_filename,
    r.confidence_score,
    r.word_count
FROM tasks t
JOIN files f ON t.file_id = f.id
LEFT JOIN results r ON t.id = r.task_id
WHERE t.user_id = 'user-uuid-here'
ORDER BY t.created_at DESC;
```

## Migrations

### Apply Migration

```bash
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/001_initial_schema.sql
```

### Rollback Migration

```bash
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/rollback_001.sql
```

### Create New Migration

1. Copy migration template
2. Increment version number (002, 003, etc.)
3. Write migration SQL
4. Write rollback SQL
5. Test on development database
6. Apply to production

## Maintenance

### Backup Database

```bash
pg_dump -U ocr_platform_user -d ocr_platform_dev -F c -f backup_$(date +%Y%m%d).dump
```

### Restore Database

```bash
pg_restore -U ocr_platform_user -d ocr_platform_dev backup_20241014.dump
```

### View Database Size

```sql
SELECT
    pg_size_pretty(pg_database_size('ocr_platform_dev')) AS database_size;
```

### Clean Old Sessions

```sql
DELETE FROM user_sessions WHERE expires_at < NOW();
```

### Analyze Performance

```sql
EXPLAIN ANALYZE
SELECT * FROM active_tasks_view;
```

## Troubleshooting

### Cannot Connect to Database

```bash
# Check if PostgreSQL is running
brew services list | grep postgresql

# Start PostgreSQL
brew services start postgresql@16
```

### Permission Denied

```bash
# Ensure you're using the correct user
psql -U ocr_platform_user -d ocr_platform_dev

# Reset password if needed
psql -U postgres -d postgres
ALTER USER ocr_platform_user WITH PASSWORD 'new_password';
```

### Database Already Exists

```bash
# Drop and recreate (WARNING: deletes all data)
psql -U postgres -d postgres
DROP DATABASE ocr_platform_dev;
DROP USER ocr_platform_user;

# Then run setup again
./setup_database.sh
```

### Schema Errors

```bash
# Check current schema version
psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT * FROM schema_migrations;"

# Rollback and reapply
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/rollback_001.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/001_initial_schema.sql
```

## Production Considerations

### Security

- **Never** use default passwords in production
- Use strong, randomly generated passwords
- Store credentials in environment variables or secret managers
- Enable SSL/TLS connections
- Restrict network access with firewall rules
- Use connection pooling (PgBouncer)

### Performance

- Add indexes for frequently queried columns
- Monitor query performance with `EXPLAIN ANALYZE`
- Configure PostgreSQL connection pools
- Set up read replicas for high-traffic applications
- Use prepared statements in application code

### Backup Strategy

- Daily full backups
- Transaction log archiving (WAL)
- Store backups offsite
- Test restore procedures regularly
- Retention policy (e.g., 30 days)

### Monitoring

Track these metrics:
- Connection pool usage
- Query execution times
- Table and index sizes
- Lock contention
- Replication lag (if applicable)

## Next Steps

1. ✅ Database setup complete
2. ✅ Schema applied and tested
3. ⏭️ Develop backend API (Node.js/Express)
4. ⏭️ Implement authentication layer
5. ⏭️ Build OCR worker integration
6. ⏭️ Create frontend interface

## Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [PostgreSQL Tutorial](https://www.postgresqltutorial.com/)
- [Node.js PostgreSQL Client (node-postgres)](https://node-postgres.com/)
- [Database Design Best Practices](https://www.postgresql.org/docs/current/ddl.html)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review PostgreSQL logs
3. Verify schema with `\d+ table_name`
4. Test with seed data

---

**Database Version:** 1.0.0
**PostgreSQL Version:** 16.10
**Last Updated:** October 14, 2024
