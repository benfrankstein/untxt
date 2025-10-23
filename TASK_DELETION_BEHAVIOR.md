# Task Deletion Behavior

## Overview
When users delete tasks from the UI, the system preserves the audit history while removing the task and associated files.

## What Gets Deleted

### ✅ Deleted from Database
- **Task record** (`tasks` table)
- **Result record** (`results` table) - via `ON DELETE CASCADE`
- **File record** (`files` table) - via `ON DELETE CASCADE`

### ✅ Deleted from S3
- **Original uploaded file** (`uploads/...`)
- **Result file** (`results/...`)

### ✅ Preserved (NOT Deleted)
- **Task history** (`task_history` table)
  - All status change records
  - Timestamps
  - Messages and metadata
  - `task_id` is set to `NULL` (task deleted)
  - `user_id` remains intact (user linkage preserved)

## UI Flow

1. **User clicks "Delete" button** in frontend
2. **Confirmation dialog** appears
3. **User confirms deletion**
4. **Frontend calls** `DELETE /api/tasks/:taskId`
5. **Backend deletes** from database (task, result, file records)
6. **Backend deletes** files from S3 (upload + result)
7. **Task history remains** with `task_id = NULL`

## Code References

### Frontend: frontend/app.js:343-368
```javascript
async function deleteTask(taskId) {
  if (!confirm('Are you sure you want to delete this task? This will remove all associated files from storage.')) {
    return;
  }

  const response = await fetch(`${API_URL}/api/tasks/${taskId}`, {
    method: 'DELETE',
  });
  // ...
}
```

### Backend: backend/src/routes/tasks.routes.js:378-437
```javascript
router.delete('/:taskId', async (req, res) => {
  // Delete from database (returns task data with S3 keys)
  const task = await dbService.deleteTask(taskId);

  // Permanently delete files from S3
  await s3Service.permanentlyDeleteFile(task.s3_key);
  await s3Service.permanentlyDeleteFile(task.s3_result_key);
  // ...
});
```

### Database: database/schema.sql:174-182
```sql
CREATE TABLE task_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,  -- ← Set to NULL on deletion
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- ← Preserved for audit!
    status task_status NOT NULL,
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## Cascade Relationships

```
users (ON DELETE SET NULL)
  ↓
  ├─→ tasks (ON DELETE CASCADE)
  │     ├→ results (ON DELETE CASCADE)      ← Deleted (but user_id preserved)
  │     ├→ files (ON DELETE CASCADE)        ← Deleted
  │     └→ task_history (task_id = NULL)    ← Preserved
  │
  ├─→ results (user_id preserved)           ← User linkage maintained
  └─→ task_history (user_id preserved)      ← User linkage maintained
```

## Why Preserve Task History?

### 1. Compliance Requirements
- **HIPAA**: Requires audit trails of all PHI access
- **GDPR**: Requires records of data processing activities
- **SOC 2**: Requires system activity logs

### 2. Debugging and Support
- Investigate why a task failed
- Understand processing patterns
- Troubleshoot customer issues

### 3. Analytics and Reporting
- Calculate historical metrics
- Analyze system performance trends
- Generate compliance reports

## Example Queries

### View history for deleted tasks (with user info)
```sql
SELECT
    th.status,
    th.message,
    th.created_at,
    u.username,
    'TASK DELETED' as task_state
FROM task_history th
LEFT JOIN users u ON th.user_id = u.id
WHERE th.task_id IS NULL
ORDER BY th.created_at DESC;
```

### Count orphaned history records
```sql
SELECT COUNT(*) as orphaned_history_count
FROM task_history
WHERE task_id IS NULL;
```

### Join with active tasks (handles deleted tasks)
```sql
SELECT
    th.*,
    CASE
        WHEN th.task_id IS NULL THEN 'DELETED'
        ELSE t.status
    END as current_task_status
FROM task_history th
LEFT JOIN tasks t ON th.task_id = t.id
ORDER BY th.created_at DESC;
```

## Migrations Applied
- **Migration 06**: `database/migrations/06_preserve_task_history.sql`
  - Preserves task_history when tasks are deleted (task_id → NULL)
  - **Status**: ✅ Applied and tested

- **Migration 07**: `database/migrations/07_add_user_id_to_results_and_history.sql`
  - Adds user_id to results and task_history for user linkage preservation
  - **Status**: ✅ Applied and tested

## Related Documentation
- [Task History Preservation Guide](docs/TASK_HISTORY_PRESERVATION.md)
- [Migration Summary](database/migrations/06_MIGRATION_SUMMARY.md)
- [Database Schema](database/schema.sql)

## Testing
Run the test suite to verify behavior:
```bash
psql -f database/tests/test_task_history_preservation.sql
```

Expected result: ✅ All tests pass, history preserved after deletion
