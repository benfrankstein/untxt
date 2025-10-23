-- Migration: Preserve task_history when tasks are deleted
-- This changes the foreign key constraint from CASCADE to SET NULL
-- so that task history is preserved for audit purposes even after task deletion

-- Step 1: Drop the existing foreign key constraint
ALTER TABLE task_history
DROP CONSTRAINT task_history_task_id_fkey;

-- Step 2: Make task_id nullable (it will be set to NULL when task is deleted)
ALTER TABLE task_history
ALTER COLUMN task_id DROP NOT NULL;

-- Step 3: Add new foreign key constraint with ON DELETE SET NULL
ALTER TABLE task_history
ADD CONSTRAINT task_history_task_id_fkey
FOREIGN KEY (task_id)
REFERENCES tasks(id)
ON DELETE SET NULL;

-- Add comment explaining the behavior
COMMENT ON COLUMN task_history.task_id IS 'Task ID - set to NULL when task is deleted to preserve audit history';
