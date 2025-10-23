-- PostgreSQL trigger update to include S3 keys for automatic cleanup
-- This ensures that when files/tasks are deleted directly from the database,
-- the system can clean up associated S3 files

-- Drop and recreate the notification function with S3 key support
CREATE OR REPLACE FUNCTION notify_table_change()
RETURNS trigger AS $$
DECLARE
  notification json;
  user_id_value uuid;
  s3_key_value text;
  s3_result_key_value text;
  status_value text;
BEGIN
  -- Extract values based on operation and table
  IF (TG_OP = 'DELETE') THEN
    -- For results table, get user_id from tasks
    IF (TG_TABLE_NAME = 'results') THEN
      SELECT t.user_id INTO user_id_value
      FROM tasks t
      WHERE t.id = OLD.task_id;
      s3_result_key_value := OLD.s3_result_key;
    ELSE
      user_id_value := OLD.user_id;
    END IF;

    -- For files table, get s3_key
    IF (TG_TABLE_NAME = 'files') THEN
      s3_key_value := OLD.s3_key;
    -- For tasks table, get both s3_key from files and s3_result_key from results
    ELSIF (TG_TABLE_NAME = 'tasks') THEN
      SELECT f.s3_key INTO s3_key_value
      FROM files f
      WHERE f.id = OLD.file_id;

      SELECT r.s3_result_key INTO s3_result_key_value
      FROM results r
      WHERE r.task_id = OLD.id;
    END IF;

    -- Build notification with S3 keys for cleanup
    notification = json_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'record_id', OLD.id,
      'user_id', user_id_value,
      's3_key', s3_key_value,
      's3_result_key', s3_result_key_value,
      'timestamp', extract(epoch from now())
    );
  ELSE
    -- For INSERT/UPDATE operations
    -- For results table, get user_id from tasks
    IF (TG_TABLE_NAME = 'results') THEN
      SELECT t.user_id INTO user_id_value
      FROM tasks t
      WHERE t.id = NEW.task_id;
    ELSE
      user_id_value := NEW.user_id;
    END IF;

    -- Only get status for tasks table
    IF (TG_TABLE_NAME = 'tasks') THEN
      status_value := NEW.status::text;
    END IF;

    notification = json_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'record_id', NEW.id,
      'user_id', user_id_value,
      'status', status_value,
      'timestamp', extract(epoch from now())
    );
  END IF;

  -- Send notification via PostgreSQL NOTIFY
  PERFORM pg_notify('db_changes', notification::text);

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to handle user deletion and cleanup all associated files
CREATE OR REPLACE FUNCTION notify_user_delete()
RETURNS trigger AS $$
DECLARE
  file_record RECORD;
  task_record RECORD;
BEGIN
  -- When a user is deleted, notify about all their files for S3 cleanup
  -- This happens BEFORE cascade delete removes the records

  -- Get all files for this user
  FOR file_record IN
    SELECT f.id, f.s3_key, f.user_id
    FROM files f
    WHERE f.user_id = OLD.id
  LOOP
    PERFORM pg_notify('db_changes', json_build_object(
      'table', 'files',
      'operation', 'DELETE',
      'record_id', file_record.id,
      'user_id', file_record.user_id,
      's3_key', file_record.s3_key,
      'timestamp', extract(epoch from now())
    )::text);
  END LOOP;

  -- Get all results for this user's tasks
  FOR task_record IN
    SELECT r.id, r.s3_result_key, t.user_id
    FROM results r
    JOIN tasks t ON t.id = r.task_id
    WHERE t.user_id = OLD.id
  LOOP
    PERFORM pg_notify('db_changes', json_build_object(
      'table', 'results',
      'operation', 'DELETE',
      'record_id', task_record.id,
      'user_id', task_record.user_id,
      's3_result_key', task_record.s3_result_key,
      'timestamp', extract(epoch from now())
    )::text);
  END LOOP;

  -- Finally, notify about the user deletion itself
  PERFORM pg_notify('db_changes', json_build_object(
    'table', 'users',
    'operation', 'DELETE',
    'record_id', OLD.id,
    'user_id', OLD.id,
    'timestamp', extract(epoch from now())
  )::text);

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for users table to handle cascade deletes
DROP TRIGGER IF EXISTS users_change_trigger ON users;

CREATE TRIGGER users_change_trigger
AFTER DELETE ON users
FOR EACH ROW EXECUTE FUNCTION notify_user_delete();

-- Comments
COMMENT ON FUNCTION notify_table_change() IS 'Sends PostgreSQL NOTIFY with S3 keys for automatic cleanup on delete';
COMMENT ON FUNCTION notify_user_delete() IS 'Handles user deletion and notifies about all associated files for S3 cleanup';
COMMENT ON TRIGGER users_change_trigger ON users IS 'Notify on user deletion with cascade S3 cleanup';
