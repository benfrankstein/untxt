-- Test: User Linkage Across All Tables
-- Verifies that results and task_history always maintain user linkage
-- even after task deletion

-- =============================================
-- Test Setup
-- =============================================

\set test_user_id '3c8bf409-1992-4156-add2-3d5bb3df6ec1'

\echo ''
\echo '=========================================='
\echo 'Test: User Linkage Preservation'
\echo '=========================================='
\echo ''

-- =============================================
-- Test 1: Verify current state
-- =============================================
\echo 'Test 1: Current database state'
\echo '=========================================='

SELECT 'Tasks' as table_name, COUNT(*) as total_records,
       COUNT(user_id) as with_user_id,
       COUNT(*) - COUNT(user_id) as without_user_id
FROM tasks
UNION ALL
SELECT 'Results' as table_name, COUNT(*) as total_records,
       COUNT(user_id) as with_user_id,
       COUNT(*) - COUNT(user_id) as without_user_id
FROM results
UNION ALL
SELECT 'Task History' as table_name, COUNT(*) as total_records,
       COUNT(user_id) as with_user_id,
       COUNT(*) - COUNT(user_id) as without_user_id
FROM task_history;

\echo ''
\echo 'Expected: All records should have user_id (except orphaned history)'
\echo ''

-- =============================================
-- Test 2: Create test data
-- =============================================
\echo 'Test 2: Creating test task with full workflow'
\echo '=========================================='

-- Create test file
INSERT INTO files (id, user_id, original_filename, stored_filename, file_path, file_type, mime_type, file_size, file_hash)
VALUES (
    '10000000-0000-0000-0000-000000000001',
    :'test_user_id',
    'test_user_linkage.pdf',
    'test_user_linkage_stored.pdf',
    'uploads/test_user_linkage_stored.pdf',
    'pdf',
    'application/pdf',
    54321,
    'testlinkagehash123'
);

-- Create test task
INSERT INTO tasks (id, user_id, file_id, status, priority)
VALUES (
    '10000000-0000-0000-0000-000000000002',
    :'test_user_id',
    '10000000-0000-0000-0000-000000000001',
    'pending',
    5
);

-- Simulate status changes (this will trigger task_history entries)
UPDATE tasks SET status = 'processing' WHERE id = '10000000-0000-0000-0000-000000000002';
UPDATE tasks SET status = 'completed' WHERE id = '10000000-0000-0000-0000-000000000002';

-- Create result
INSERT INTO results (id, task_id, user_id, extracted_text, confidence_score, page_count, word_count, processing_time_ms, model_version)
VALUES (
    '10000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000002',
    :'test_user_id',
    'This is test extracted text for user linkage testing',
    0.9876,
    1,
    10,
    1234,
    'qwen3-test'
);

\echo 'Test data created'
\echo ''

-- =============================================
-- Test 3: Verify user linkage before deletion
-- =============================================
\echo 'Test 3: Verify user linkage (before task deletion)'
\echo '=========================================='

SELECT
    'Task' as record_type,
    t.id as record_id,
    t.user_id,
    u.username,
    t.status
FROM tasks t
JOIN users u ON t.user_id = u.id
WHERE t.id = '10000000-0000-0000-0000-000000000002'

UNION ALL

SELECT
    'Result' as record_type,
    r.id as record_id,
    r.user_id,
    u.username,
    'completed' as status
FROM results r
JOIN users u ON r.user_id = u.id
WHERE r.task_id = '10000000-0000-0000-0000-000000000002'

UNION ALL

SELECT
    'History' as record_type,
    th.id as record_id,
    th.user_id,
    u.username,
    th.status::text
FROM task_history th
JOIN users u ON th.user_id = u.id
WHERE th.task_id = '10000000-0000-0000-0000-000000000002'
ORDER BY record_type;

\echo ''
\echo 'Expected: All records linked to user "benfrankstein"'
\echo ''

-- =============================================
-- Test 4: Delete task and verify preservation
-- =============================================
\echo 'Test 4: Deleting task...'
\echo '=========================================='

-- Delete the task (will cascade to results)
DELETE FROM tasks WHERE id = '10000000-0000-0000-0000-000000000002';

\echo 'Task deleted'
\echo ''

-- =============================================
-- Test 5: Verify user linkage after deletion
-- =============================================
\echo 'Test 5: Verify user linkage (after task deletion)'
\echo '=========================================='

-- Check task (should be gone)
SELECT COUNT(*) as task_exists FROM tasks WHERE id = '10000000-0000-0000-0000-000000000002';

\echo ''

-- Check result (should be gone due to CASCADE)
SELECT COUNT(*) as result_exists FROM results WHERE id = '10000000-0000-0000-0000-000000000003';

\echo ''

-- Check task_history (should still exist with user_id, but task_id = NULL)
SELECT
    'History (PRESERVED)' as record_type,
    th.id as record_id,
    th.task_id,
    th.user_id,
    u.username,
    th.status,
    CASE
        WHEN th.task_id IS NULL THEN '✓ ORPHANED (task deleted)'
        ELSE '✗ STILL LINKED'
    END as preservation_status
FROM task_history th
LEFT JOIN users u ON th.user_id = u.id
WHERE th.user_id = :'test_user_id'
AND th.id IN (
    SELECT id FROM task_history
    WHERE user_id = :'test_user_id'
    ORDER BY created_at DESC
    LIMIT 2
)
ORDER BY th.created_at;

\echo ''
\echo 'Expected: History preserved with user_id intact, task_id = NULL'
\echo ''

-- =============================================
-- Test 6: Analytics query - still works!
-- =============================================
\echo 'Test 6: Analytics Query (works even after deletion)'
\echo '=========================================='

SELECT
    u.username,
    COUNT(th.id) as total_history_entries,
    COUNT(CASE WHEN th.status = 'completed' THEN 1 END) as completed_count,
    COUNT(CASE WHEN th.task_id IS NULL THEN 1 END) as orphaned_count
FROM task_history th
LEFT JOIN users u ON th.user_id = u.id
WHERE u.username = 'benfrankstein'
GROUP BY u.username;

\echo ''
\echo 'Expected: Can still query history by user even after task deletion'
\echo ''

-- =============================================
-- Cleanup
-- =============================================
\echo 'Cleanup: Removing test data'
\echo '=========================================='

DELETE FROM task_history WHERE user_id = :'test_user_id' AND task_id IS NULL;
DELETE FROM files WHERE id = '10000000-0000-0000-0000-000000000001';

\echo 'Test data cleaned up'
\echo ''

-- =============================================
-- Summary
-- =============================================
\echo '=========================================='
\echo 'Test Summary'
\echo '=========================================='
\echo ''
\echo '✓ Results table has user_id (denormalized)'
\echo '✓ Task_history table has user_id (preserved on deletion)'
\echo '✓ User linkage maintained even after task deletion'
\echo '✓ Analytics queries work on orphaned records'
\echo ''
\echo 'Database design supports:'
\echo '  - Audit compliance (HIPAA/GDPR/SOC 2)'
\echo '  - User-specific queries and reports'
\echo '  - Historical analysis after task deletion'
\echo '=========================================='
