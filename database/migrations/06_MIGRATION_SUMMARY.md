# Migration 06: Task History Preservation

## Summary
Changed the `task_history` table to preserve audit records even after tasks are deleted from the system.

## Problem
Previously, the `task_history` table had a foreign key constraint with `ON DELETE CASCADE`:
```sql
task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
```

This meant when a user deleted a task from the UI, **all associated history records were also deleted**, which is problematic for:
- **Audit compliance** (HIPAA, GDPR, SOC 2 require audit trails)
- **Debugging** (cannot investigate past issues)
- **Analytics** (historical data is lost)

## Solution
Changed the foreign key constraint to `ON DELETE SET NULL`:
```sql
task_id UUID REFERENCES tasks(id) ON DELETE SET NULL
```

### Changes Made
1. **Made `task_id` nullable** - allows it to be set to NULL when task is deleted
2. **Changed constraint** - from `CASCADE` to `SET NULL`
3. **Added documentation** - comments and docs explaining the behavior

### Behavior After Migration

| Scenario | Before (CASCADE) | After (SET NULL) |
|----------|-----------------|------------------|
| Task exists | `task_id` = UUID | `task_id` = UUID |
| Task deleted | History deleted ❌ | `task_id` = NULL ✅ |
| Other columns | N/A | Preserved ✅ |

## Migration Files

### Applied Migration
- **File**: `database/migrations/06_preserve_task_history.sql`
- **Applied**: October 19, 2025
- **Status**: ✅ Successfully applied

### Schema Updated
- **File**: `database/schema.sql` (lines 172-179)
- **Status**: ✅ Updated to reflect new behavior

### Documentation Created
- **File**: `docs/TASK_HISTORY_PRESERVATION.md`
- **Content**: Complete guide on preservation behavior, querying, and best practices

### Test Created
- **File**: `database/tests/test_task_history_preservation.sql`
- **Status**: ✅ Test passed successfully

## Test Results

```
Test 1: History before deletion
✓ 3 history records with task_id SET

Test 2: Deleting task
✓ Task deleted successfully

Test 3: History after deletion
✓ 3 history records still exist with task_id = NULL (PRESERVED!)

Test 4: Verify task is gone
✓ Task no longer exists in tasks table
```

## Impact Analysis

### ✅ Benefits
- **Compliance**: Meets audit trail requirements for HIPAA/GDPR/SOC 2
- **Debugging**: Historical records available for troubleshooting
- **Analytics**: Can analyze historical trends and patterns
- **No data loss**: Audit trail is never lost

### ⚠️ Considerations
- **Nullable foreign key**: Queries must handle `task_id IS NULL` case
- **Orphaned records**: History records without corresponding tasks
- **Storage**: History accumulates over time (implement retention policy if needed)

### 📝 Breaking Changes
**None** - This is backwards compatible:
- Existing queries continue to work
- New queries can optionally handle NULL task_id
- No application code changes required

## Recommended Follow-up Actions

### 1. Update Application Queries (Optional)
If you want to display deleted task history, update queries to handle NULL:
```sql
SELECT
    th.*,
    CASE
        WHEN th.task_id IS NULL THEN 'DELETED'
        ELSE t.status
    END as current_status
FROM task_history th
LEFT JOIN tasks t ON th.task_id = t.id;
```

### 2. Implement Retention Policy (Future)
Consider implementing a retention policy for very old history:
```sql
-- Example: Delete history older than 7 years for deleted tasks
DELETE FROM task_history
WHERE task_id IS NULL
AND created_at < NOW() - INTERVAL '7 years';
```

### 3. Add Monitoring (Optional)
Track orphaned history records:
```sql
SELECT COUNT(*) as orphaned_history_count
FROM task_history
WHERE task_id IS NULL;
```

## Verification Commands

### Check current constraint
```bash
psql -c "\d task_history"
# Look for: FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
```

### Check orphaned records
```sql
SELECT COUNT(*) FROM task_history WHERE task_id IS NULL;
```

### Run test suite
```bash
psql -f database/tests/test_task_history_preservation.sql
```

## Rollback (If Needed)

**⚠️ WARNING**: Rollback will cause history to be deleted when tasks are deleted.

```sql
-- Rollback to CASCADE behavior (NOT RECOMMENDED)
ALTER TABLE task_history DROP CONSTRAINT task_history_task_id_fkey;
ALTER TABLE task_history ALTER COLUMN task_id SET NOT NULL;
ALTER TABLE task_history
ADD CONSTRAINT task_history_task_id_fkey
FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
```

## Related Documentation
- [Task History Preservation Guide](../docs/TASK_HISTORY_PRESERVATION.md)
- [Database Schema](../database/schema.sql)
- [Test: Task History Preservation](../database/tests/test_task_history_preservation.sql)

## Sign-off
- [x] Migration tested successfully
- [x] No breaking changes
- [x] Documentation updated
- [x] Test suite created
- [x] Backwards compatible
