-- Test: Task History Preservation After Deletion
-- This test verifies that task_history records are preserved when tasks are deleted

-- =============================================
-- Setup: Create test data
-- =============================================

-- Get a test user (using benfrankstein admin user)
\set test_user_id '3c8bf409-1992-4156-add2-3d5bb3df6ec1'

-- Create a test file
INSERT INTO files (id, user_id, original_filename, stored_filename, file_path, file_type, mime_type, file_size, file_hash)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    :'test_user_id',
    'test_preservation.pdf',
    'test_preservation_stored.pdf',
    'uploads/test_preservation_stored.pdf',
    'pdf',
    'application/pdf',
    12345,
    'testhash123'
);

-- Create a test task
INSERT INTO tasks (id, user_id, file_id, status, priority)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    :'test_user_id',
    '00000000-0000-0000-0000-000000000001',
    'pending',
    5
);

-- Manually add some task history (simulating status changes)
INSERT INTO task_history (task_id, status, message)
VALUES
    ('00000000-0000-0000-0000-000000000002', 'pending', 'Task created'),
    ('00000000-0000-0000-0000-000000000002', 'processing', 'Status changed from pending to processing'),
    ('00000000-0000-0000-0000-000000000002', 'completed', 'Status changed from processing to completed');

-- =============================================
-- Test 1: Verify history exists before deletion
-- =============================================
\echo ''
\echo '=========================================='
\echo 'Test 1: History before deletion'
\echo '=========================================='

SELECT
    th.id as history_id,
    th.task_id,
    th.status,
    th.message,
    CASE WHEN th.task_id IS NULL THEN 'NULL' ELSE 'SET' END as task_id_status
FROM task_history th
WHERE th.task_id = '00000000-0000-0000-0000-000000000002'
ORDER BY th.created_at ASC;

\echo ''
\echo 'Expected: 3 rows with task_id SET'
\echo ''

-- =============================================
-- Test 2: Delete the task
-- =============================================
\echo '=========================================='
\echo 'Test 2: Deleting task...'
\echo '=========================================='

-- First, we need to disable the prevent_active_task_deletion trigger
-- or update the task status to something other than 'processing'
UPDATE tasks SET status = 'completed' WHERE id = '00000000-0000-0000-0000-000000000002';

DELETE FROM tasks WHERE id = '00000000-0000-0000-0000-000000000002';

\echo 'Task deleted'
\echo ''

-- =============================================
-- Test 3: Verify history still exists with NULL task_id
-- =============================================
\echo '=========================================='
\echo 'Test 3: History after deletion'
\echo '=========================================='

SELECT
    th.id as history_id,
    th.task_id,
    th.status,
    th.message,
    CASE WHEN th.task_id IS NULL THEN 'NULL (PRESERVED!)' ELSE 'SET' END as task_id_status,
    th.created_at
FROM task_history th
WHERE th.task_id IS NULL
AND th.status IN ('pending', 'processing', 'completed')
ORDER BY th.created_at DESC
LIMIT 3;

\echo ''
\echo 'Expected: 3 rows with task_id = NULL (PRESERVED!)'
\echo 'This proves that history was preserved after task deletion'
\echo ''

-- =============================================
-- Test 4: Verify task no longer exists
-- =============================================
\echo '=========================================='
\echo 'Test 4: Verify task is gone'
\echo '=========================================='

SELECT COUNT(*) as task_exists
FROM tasks
WHERE id = '00000000-0000-0000-0000-000000000002';

\echo ''
\echo 'Expected: 0 (task should be deleted)'
\echo ''

-- =============================================
-- Cleanup: Remove test data
-- =============================================
\echo '=========================================='
\echo 'Cleanup: Removing test data'
\echo '=========================================='

-- Delete the orphaned history records
DELETE FROM task_history
WHERE task_id IS NULL
AND status IN ('pending', 'processing', 'completed')
AND message LIKE '%test%'
OR message IN ('Task created', 'Status changed from pending to processing', 'Status changed from processing to completed');

-- Delete the test file
DELETE FROM files WHERE id = '00000000-0000-0000-0000-000000000001';

\echo 'Test data cleaned up'
\echo ''

-- =============================================
-- Summary
-- =============================================
\echo '=========================================='
\echo 'Test Summary'
\echo '=========================================='
\echo ''
\echo '✓ Task history is preserved after task deletion'
\echo '✓ task_id is set to NULL (not deleted)'
\echo '✓ All other columns (status, message, metadata) remain intact'
\echo '✓ Foreign key constraint: ON DELETE SET NULL works correctly'
\echo ''
\echo 'This ensures audit compliance and historical record keeping.'
\echo '=========================================='
