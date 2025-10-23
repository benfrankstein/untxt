-- PostgreSQL trigger function to notify on table changes
-- This sends notifications when tasks, files, or results are modified directly

-- Create notification function
CREATE OR REPLACE FUNCTION notify_table_change()
RETURNS trigger AS $$
DECLARE
  notification json;
  user_id_value uuid;
BEGIN
  -- Extract user_id for routing notifications
  IF (TG_OP = 'DELETE') THEN
    user_id_value := OLD.user_id;
    notification = json_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'record_id', OLD.id,
      'user_id', OLD.user_id,
      'timestamp', extract(epoch from now())
    );
  ELSE
    user_id_value := NEW.user_id;
    notification = json_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'record_id', NEW.id,
      'user_id', NEW.user_id,
      'status', CASE WHEN TG_TABLE_NAME = 'tasks' THEN NEW.status ELSE NULL END,
      'timestamp', extract(epoch from now())
    );
  END IF;

  -- Send notification via PostgreSQL NOTIFY
  -- This will be picked up by our database listener service
  PERFORM pg_notify('db_changes', notification::text);

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS tasks_change_trigger ON tasks;
DROP TRIGGER IF EXISTS files_change_trigger ON files;
DROP TRIGGER IF EXISTS results_change_trigger ON results;

-- Create trigger for tasks table
CREATE TRIGGER tasks_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Create trigger for files table
CREATE TRIGGER files_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON files
FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Create trigger for results table
CREATE TRIGGER results_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON results
FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Add comments
COMMENT ON FUNCTION notify_table_change() IS 'Sends PostgreSQL NOTIFY on table changes for real-time UI updates';
COMMENT ON TRIGGER tasks_change_trigger ON tasks IS 'Notify on task changes';
COMMENT ON TRIGGER files_change_trigger ON files IS 'Notify on file changes';
COMMENT ON TRIGGER results_change_trigger ON results IS 'Notify on result changes';

-- Test the trigger (optional - remove after verification)
-- You can run this to verify the trigger is working:
-- LISTEN db_changes;
-- UPDATE tasks SET status = 'pending' WHERE id = (SELECT id FROM tasks LIMIT 1);
-- You should see a notification message
