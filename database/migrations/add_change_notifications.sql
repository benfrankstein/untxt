-- PostgreSQL trigger function to notify on table changes
-- This sends notifications via Redis when tasks or files are modified

-- Create notification function
CREATE OR REPLACE FUNCTION notify_table_change()
RETURNS trigger AS $$
DECLARE
  channel text;
  payload json;
BEGIN
  -- Determine the operation type
  channel := 'ocr:db:changes';

  -- Build notification payload
  IF (TG_OP = 'DELETE') THEN
    payload = json_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'old_data', row_to_json(OLD)
    );
  ELSE
    payload = json_build_object(
      'table', TG_TABLE_NAME,
      'operation', TG_OP,
      'new_data', row_to_json(NEW)
    );
  END IF;

  -- Send notification (requires pg_notify or external tool)
  PERFORM pg_notify(channel, payload::text);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for tasks table
DROP TRIGGER IF EXISTS tasks_change_trigger ON tasks;
CREATE TRIGGER tasks_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON tasks
FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Create triggers for files table
DROP TRIGGER IF EXISTS files_change_trigger ON files;
CREATE TRIGGER files_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON files
FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Create triggers for results table
DROP TRIGGER IF EXISTS results_change_trigger ON results;
CREATE TRIGGER results_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON results
FOR EACH ROW EXECUTE FUNCTION notify_table_change();

-- Note: PostgreSQL's NOTIFY only works within the same database connection
-- For cross-process notifications, you'll need to:
-- 1. Use a background process listening to PostgreSQL NOTIFY
-- 2. Forward notifications to Redis
-- 3. Backend subscribes to Redis channel

COMMENT ON FUNCTION notify_table_change() IS 'Sends notifications when tasks, files, or results tables change';
