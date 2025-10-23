-- Migration: Add user_id to results and task_history tables
-- This ensures we can always identify which user a record belongs to,
-- even after the task is deleted (important for audit compliance)

-- =============================================
-- Step 1: Add user_id to results table
-- =============================================

-- Add the column (nullable first, then populate, then make NOT NULL)
ALTER TABLE results
ADD COLUMN user_id UUID;

-- Populate user_id from tasks table for existing records
UPDATE results r
SET user_id = t.user_id
FROM tasks t
WHERE r.task_id = t.id;

-- Make it NOT NULL (all records should now have a user_id)
ALTER TABLE results
ALTER COLUMN user_id SET NOT NULL;

-- Add foreign key constraint with SET NULL (preserve on user deletion)
ALTER TABLE results
ADD CONSTRAINT results_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES users(id)
ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX idx_results_user_id ON results(user_id);

-- Add comment
COMMENT ON COLUMN results.user_id IS 'User who owns this result - denormalized for preservation after task deletion';

-- =============================================
-- Step 2: Add user_id to task_history table
-- =============================================

-- Add the column (nullable)
ALTER TABLE task_history
ADD COLUMN user_id UUID;

-- Populate user_id from tasks table for existing records
UPDATE task_history th
SET user_id = t.user_id
FROM tasks t
WHERE th.task_id = t.id;

-- Note: We keep this nullable because when task is deleted, task_id becomes NULL
-- and we won't be able to look up user_id anymore. But for future records,
-- we'll populate it from the trigger.

-- Add foreign key constraint with SET NULL (preserve on user deletion)
ALTER TABLE task_history
ADD CONSTRAINT task_history_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES users(id)
ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX idx_task_history_user_id ON task_history(user_id);

-- Add comment
COMMENT ON COLUMN task_history.user_id IS 'User who owns this task history - preserved even after task deletion for audit purposes';

-- =============================================
-- Step 3: Update trigger to populate user_id in task_history
-- =============================================

-- Drop the old trigger function
DROP FUNCTION IF EXISTS log_task_status_change() CASCADE;

-- Recreate with user_id population
CREATE OR REPLACE FUNCTION log_task_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status != OLD.status THEN
        INSERT INTO task_history (task_id, user_id, status, message)
        VALUES (
            NEW.id,
            NEW.user_id,  -- ← Now includes user_id
            NEW.status,
            'Status changed from ' || OLD.status || ' to ' || NEW.status
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER task_status_change_trigger
    AFTER UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION log_task_status_change();

COMMENT ON FUNCTION log_task_status_change() IS 'Automatically logs task status changes with user_id to task_history table';
