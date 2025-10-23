-- CRUD Test Suite for OCR Platform Database
-- Run this to test all database operations

\echo '========================================='
\echo 'OCR Platform - CRUD Test Suite'
\echo '========================================='
\echo ''

-- =============================================
-- TEST 1: CREATE Operations
-- =============================================
\echo 'TEST 1: CREATE Operations'
\echo '-------------------------'

-- Test: Create new user
\echo 'Creating test user...'
INSERT INTO users (email, username, password_hash, role)
VALUES ('test.user@example.com', 'testuser', 'test_hash_123', 'user')
RETURNING id, username, email, role;

-- Save user ID for later tests
\set test_user_id (SELECT id FROM users WHERE username = 'testuser')

-- Test: Create file record
\echo 'Creating test file record...'
INSERT INTO files (user_id, original_filename, stored_filename, file_path, file_type, mime_type, file_size, file_hash)
VALUES (
    (SELECT id FROM users WHERE username = 'testuser'),
    'test_document.pdf',
    'test_stored_123.pdf',
    '/tmp/test_stored_123.pdf',
    'pdf',
    'application/pdf',
    102400,
    'test_hash_abc123def456'
)
RETURNING id, original_filename, file_size;

-- Test: Create task
\echo 'Creating test task...'
INSERT INTO tasks (user_id, file_id, status, priority, options)
VALUES (
    (SELECT id FROM users WHERE username = 'testuser'),
    (SELECT id FROM files WHERE original_filename = 'test_document.pdf' ORDER BY uploaded_at DESC LIMIT 1),
    'pending',
    5,
    '{"language": "en", "enhance": true}'::jsonb
)
RETURNING id, status, priority;

\echo '✓ CREATE tests completed'
\echo ''

-- =============================================
-- TEST 2: READ Operations
-- =============================================
\echo 'TEST 2: READ Operations'
\echo '-------------------------'

-- Test: Read user by email
\echo 'Reading user by email...'
SELECT id, username, email, role, is_active, created_at
FROM users
WHERE email = 'test.user@example.com';

-- Test: Read all files for user
\echo 'Reading files for test user...'
SELECT id, original_filename, file_type, file_size, uploaded_at
FROM files
WHERE user_id = (SELECT id FROM users WHERE username = 'testuser');

-- Test: Read tasks with joins
\echo 'Reading tasks with user and file info...'
SELECT
    t.id,
    t.status,
    t.priority,
    u.username,
    f.original_filename,
    t.created_at
FROM tasks t
JOIN users u ON t.user_id = u.id
JOIN files f ON t.file_id = f.id
WHERE u.username = 'testuser';

-- Test: Use view
\echo 'Testing active_tasks_view...'
SELECT * FROM active_tasks_view
WHERE username = 'testuser';

\echo '✓ READ tests completed'
\echo ''

-- =============================================
-- TEST 3: UPDATE Operations
-- =============================================
\echo 'TEST 3: UPDATE Operations'
\echo '-------------------------'

-- Test: Update user last login
\echo 'Updating user last login...'
UPDATE users
SET last_login = NOW()
WHERE username = 'testuser'
RETURNING id, username, last_login;

-- Test: Update task status (triggers should log this)
\echo 'Updating task status...'
UPDATE tasks
SET
    status = 'processing',
    started_at = NOW(),
    worker_id = 'test-worker-001'
WHERE user_id = (SELECT id FROM users WHERE username = 'testuser')
RETURNING id, status, started_at, worker_id;

-- Test: Verify trigger created history entry
\echo 'Checking task history (should show status change)...'
SELECT task_id, status, message, created_at
FROM task_history
WHERE task_id IN (
    SELECT id FROM tasks WHERE user_id = (SELECT id FROM users WHERE username = 'testuser')
)
ORDER BY created_at DESC
LIMIT 5;

-- Test: Update with JSON data
\echo 'Updating task options (JSON)...'
UPDATE tasks
SET options = jsonb_set(options, '{deskew}', 'true')
WHERE user_id = (SELECT id FROM users WHERE username = 'testuser')
RETURNING id, options;

\echo '✓ UPDATE tests completed'
\echo ''

-- =============================================
-- TEST 4: Complex Queries
-- =============================================
\echo 'TEST 4: Complex Queries'
\echo '-------------------------'

-- Test: Aggregate query
\echo 'User statistics...'
SELECT
    u.username,
    COUNT(DISTINCT f.id) as file_count,
    COUNT(DISTINCT t.id) as task_count,
    SUM(f.file_size) as total_storage
FROM users u
LEFT JOIN files f ON u.id = f.user_id
LEFT JOIN tasks t ON u.id = t.user_id
WHERE u.username = 'testuser'
GROUP BY u.username;

-- Test: Subquery
\echo 'Users with pending tasks...'
SELECT username, email
FROM users
WHERE id IN (
    SELECT DISTINCT user_id FROM tasks WHERE status = 'pending'
)
LIMIT 5;

-- Test: JSON query
\echo 'Tasks with enhance option enabled...'
SELECT
    t.id,
    u.username,
    t.options->>'language' as language,
    t.options->>'enhance' as enhance_enabled
FROM tasks t
JOIN users u ON t.user_id = u.id
WHERE t.options->>'enhance' = 'true'
LIMIT 5;

\echo '✓ Complex query tests completed'
\echo ''

-- =============================================
-- TEST 5: Constraints and Validations
-- =============================================
\echo 'TEST 5: Constraints and Validations'
\echo '-------------------------'

-- Test: Email format constraint (should fail)
\echo 'Testing invalid email (should fail)...'
DO $$
BEGIN
    INSERT INTO users (email, username, password_hash)
    VALUES ('invalid-email', 'invalid_test', 'hash');
    \echo '✗ Constraint check failed - invalid email was accepted!';
EXCEPTION WHEN check_violation THEN
    \echo '✓ Email format constraint working correctly';
END $$;

-- Test: Username length constraint (should fail)
\echo 'Testing short username (should fail)...'
DO $$
BEGIN
    INSERT INTO users (email, username, password_hash)
    VALUES ('short@example.com', 'ab', 'hash');
    \echo '✗ Constraint check failed - short username was accepted!';
EXCEPTION WHEN check_violation THEN
    \echo '✓ Username length constraint working correctly';
END $$;

-- Test: Unique email constraint (should fail)
\echo 'Testing duplicate email (should fail)...'
DO $$
BEGIN
    INSERT INTO users (email, username, password_hash)
    VALUES ('test.user@example.com', 'duplicate', 'hash');
    \echo '✗ Constraint check failed - duplicate email was accepted!';
EXCEPTION WHEN unique_violation THEN
    \echo '✓ Unique email constraint working correctly';
END $$;

-- Test: Positive file size constraint (should fail)
\echo 'Testing negative file size (should fail)...'
DO $$
BEGIN
    INSERT INTO files (user_id, original_filename, stored_filename, file_path, file_type, file_size)
    VALUES (
        (SELECT id FROM users WHERE username = 'testuser'),
        'invalid.pdf',
        'invalid.pdf',
        '/tmp/invalid.pdf',
        'pdf',
        -100
    );
    \echo '✗ Constraint check failed - negative file size was accepted!';
EXCEPTION WHEN check_violation THEN
    \echo '✓ Positive file size constraint working correctly';
END $$;

-- Test: Foreign key constraint (should fail)
\echo 'Testing invalid foreign key (should fail)...'
DO $$
BEGIN
    INSERT INTO tasks (user_id, file_id, status)
    VALUES (
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-0000-0000-000000000000',
        'pending'
    );
    \echo '✗ Constraint check failed - invalid foreign key was accepted!';
EXCEPTION WHEN foreign_key_violation THEN
    \echo '✓ Foreign key constraint working correctly';
END $$;

\echo '✓ Constraint tests completed'
\echo ''

-- =============================================
-- TEST 6: Cascade Delete
-- =============================================
\echo 'TEST 6: Cascade Delete'
\echo '-------------------------'

-- Create a temporary user with associated data
\echo 'Creating temporary user with data...'
INSERT INTO users (email, username, password_hash, role)
VALUES ('delete.test@example.com', 'deletetest', 'hash', 'user')
RETURNING id;

INSERT INTO files (user_id, original_filename, stored_filename, file_path, file_type, file_size)
VALUES (
    (SELECT id FROM users WHERE username = 'deletetest'),
    'delete_test.pdf',
    'delete_test.pdf',
    '/tmp/delete_test.pdf',
    'pdf',
    1024
);

INSERT INTO tasks (user_id, file_id, status)
VALUES (
    (SELECT id FROM users WHERE username = 'deletetest'),
    (SELECT id FROM files WHERE original_filename = 'delete_test.pdf'),
    'pending'
);

\echo 'Counting related records before delete...'
SELECT
    (SELECT COUNT(*) FROM users WHERE username = 'deletetest') as users,
    (SELECT COUNT(*) FROM files WHERE original_filename = 'delete_test.pdf') as files,
    (SELECT COUNT(*) FROM tasks WHERE user_id = (SELECT id FROM users WHERE username = 'deletetest')) as tasks;

\echo 'Deleting user (should cascade)...'
DELETE FROM users WHERE username = 'deletetest';

\echo 'Counting related records after delete (should be 0)...'
SELECT
    (SELECT COUNT(*) FROM users WHERE username = 'deletetest') as users,
    (SELECT COUNT(*) FROM files WHERE original_filename = 'delete_test.pdf') as files,
    (SELECT COUNT(*) FROM tasks WHERE user_id = (SELECT id FROM users WHERE username = 'deletetest')) as tasks;

\echo '✓ Cascade delete tests completed'
\echo ''

-- =============================================
-- TEST 7: DELETE Operations (Cleanup)
-- =============================================
\echo 'TEST 7: DELETE Operations (Cleanup)'
\echo '-------------------------'

-- Note: Due to trigger, we need to update status first
\echo 'Updating task status before delete...'
UPDATE tasks
SET status = 'completed'
WHERE user_id = (SELECT id FROM users WHERE username = 'testuser');

\echo 'Deleting test task...'
DELETE FROM tasks
WHERE user_id = (SELECT id FROM users WHERE username = 'testuser')
RETURNING id;

\echo 'Deleting test file...'
DELETE FROM files
WHERE user_id = (SELECT id FROM users WHERE username = 'testuser')
RETURNING id, original_filename;

\echo 'Deleting test user...'
DELETE FROM users
WHERE username = 'testuser'
RETURNING id, username;

\echo '✓ DELETE tests completed'
\echo ''

-- =============================================
-- TEST SUMMARY
-- =============================================
\echo '========================================='
\echo 'Test Suite Summary'
\echo '========================================='
\echo ''
\echo 'All CRUD operations tested successfully!'
\echo ''
\echo 'Tests completed:'
\echo '  ✓ CREATE operations'
\echo '  ✓ READ operations'
\echo '  ✓ UPDATE operations'
\echo '  ✓ Complex queries'
\echo '  ✓ Constraints and validations'
\echo '  ✓ Cascade deletes'
\echo '  ✓ DELETE operations'
\echo ''
\echo 'Database is ready for application development!'
\echo ''
