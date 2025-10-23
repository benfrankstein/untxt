-- Reset Database with Admin User
-- This script wipes all data and creates a single admin user

-- Disable triggers temporarily to allow deletion
SET session_replication_role = replica;

-- Delete all data (in correct order)
DELETE FROM results;
DELETE FROM tasks;
DELETE FROM files;
DELETE FROM user_sessions;
DELETE FROM users;

-- Re-enable triggers
SET session_replication_role = DEFAULT;

-- Create admin user with bcrypt hash for password "Banker2b"
-- Hash generated with PostgreSQL crypt(): $2a$10$iNqSjo1PHbeT07RW.xwZ4eLITR39CEK4H1YL3JNKEI5fHcVpr0lWe
INSERT INTO users (
    username,
    email,
    password_hash,
    role,
    is_active,
    email_verified,
    created_at,
    updated_at
) VALUES (
    'benfrankstein',
    'benjamin.frankstein@gmail.com',
    '$2a$10$iNqSjo1PHbeT07RW.xwZ4eLITR39CEK4H1YL3JNKEI5fHcVpr0lWe',
    'admin',
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Display the created user
SELECT
    id,
    username,
    email,
    role,
    is_active,
    email_verified,
    created_at
FROM users;

-- Show table counts
SELECT
    'Users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'Tasks', COUNT(*) FROM tasks
UNION ALL
SELECT 'Files', COUNT(*) FROM files
UNION ALL
SELECT 'Results', COUNT(*) FROM results
UNION ALL
SELECT 'Sessions', COUNT(*) FROM user_sessions;
