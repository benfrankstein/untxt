# Task History Preservation

## Overview

The `task_history` table maintains a complete audit log of all task status changes, even after tasks are deleted. This ensures compliance requirements and provides a historical record for debugging and analytics.

## How It Works

### Database Design

The `task_history` table has a foreign key to `tasks` with `ON DELETE SET NULL`:

```sql
CREATE TABLE task_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    status task_status NOT NULL,
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Behavior

**When a task is active:**
- `task_id` contains the UUID of the task
- All status changes are logged automatically via trigger
- You can join with the `tasks` table to get full task details

**When a task is deleted:**
- `task_id` is set to `NULL` (not deleted)
- All other data (status, message, metadata, created_at) is preserved
- History remains queryable for audit purposes

## Use Cases

### 1. Compliance and Audit
Task history is preserved indefinitely for:
- HIPAA compliance (audit trail requirements)
- GDPR compliance (processing records)
- SOC 2 compliance (system activity logs)
- Internal auditing and debugging

### 2. Analytics
Even after tasks are deleted, you can analyze:
- Processing times
- Failure rates
- Status change patterns
- System usage over time

### 3. Debugging
Historical records help troubleshoot:
- Why a task failed
- Processing time trends
- Worker performance
- System bottlenecks

## Querying Task History

### Get history for active task
```sql
SELECT th.*, t.user_id, f.original_filename
FROM task_history th
JOIN tasks t ON th.task_id = t.id
JOIN files f ON t.file_id = f.id
WHERE th.task_id = 'your-task-id'
ORDER BY th.created_at DESC;
```

### Get history for deleted tasks
```sql
SELECT *
FROM task_history
WHERE task_id IS NULL
ORDER BY created_at DESC;
```

### Get all history (active + deleted tasks)
```sql
SELECT
    th.*,
    CASE
        WHEN th.task_id IS NULL THEN 'DELETED'
        ELSE 'ACTIVE'
    END as task_state
FROM task_history th
ORDER BY th.created_at DESC;
```

### Analytics: Processing time trends
```sql
SELECT
    DATE_TRUNC('day', created_at) as date,
    status,
    COUNT(*) as count
FROM task_history
WHERE status IN ('completed', 'failed')
GROUP BY DATE_TRUNC('day', created_at), status
ORDER BY date DESC;
```

## Data Retention

### Current Policy
- Task history is **never automatically deleted**
- History is preserved even after task deletion
- No expiration or cleanup policy

### Future Considerations
You may want to implement retention policies such as:

1. **Time-based cleanup** (e.g., delete history older than 7 years)
   ```sql
   DELETE FROM task_history
   WHERE created_at < NOW() - INTERVAL '7 years';
   ```

2. **Orphaned record cleanup** (delete history for deleted tasks after X time)
   ```sql
   DELETE FROM task_history
   WHERE task_id IS NULL
   AND created_at < NOW() - INTERVAL '2 years';
   ```

3. **Archival** (move old history to cold storage)
   - Export to S3/Glacier
   - Keep only recent history in hot database

## Migration Applied

The preservation behavior was implemented via migration:
- **File**: `database/migrations/06_preserve_task_history.sql`
- **Applied**: 2025-10-19
- **Changes**:
  - Changed `task_id` from `NOT NULL` to nullable
  - Changed foreign key from `ON DELETE CASCADE` to `ON DELETE SET NULL`
  - Added comment explaining the behavior

## Best Practices

### 1. Always Log Context
When logging status changes, include relevant context:
```sql
INSERT INTO task_history (task_id, status, message, metadata)
VALUES (
    '...',
    'failed',
    'OCR processing failed: timeout',
    jsonb_build_object(
        'worker_id', 'worker-1',
        'attempts', 3,
        'error_code', 'TIMEOUT'
    )
);
```

### 2. Query with Awareness
Always handle the case where `task_id` might be NULL:
```sql
SELECT
    th.*,
    COALESCE(t.user_id::text, 'DELETED') as user_id,
    COALESCE(f.original_filename, 'DELETED') as filename
FROM task_history th
LEFT JOIN tasks t ON th.task_id = t.id
LEFT JOIN files f ON t.file_id = f.id;
```

### 3. Index Appropriately
The following indexes support efficient queries:
- `idx_task_history_task_id` - for task-specific history
- `idx_task_history_created_at` - for time-based queries

Consider adding:
- Partial index for deleted tasks: `CREATE INDEX idx_task_history_deleted ON task_history(created_at) WHERE task_id IS NULL;`

## Related Files

- Schema: `database/schema.sql`
- Migration: `database/migrations/06_preserve_task_history.sql`
- Trigger: `log_task_status_change()` function in schema.sql

## Testing

To verify preservation behavior:

1. Upload a file and let it process
2. Check history was created:
   ```sql
   SELECT * FROM task_history WHERE task_id = 'your-task-id';
   ```
3. Delete the task via UI or API
4. Verify history still exists with NULL task_id:
   ```sql
   SELECT * FROM task_history WHERE id = 'history-record-id';
   -- task_id should be NULL, but all other data preserved
   ```
