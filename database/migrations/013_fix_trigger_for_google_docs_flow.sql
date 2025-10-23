-- Migration: Fix trigger for Google Docs flow
-- Created: 2025-10-22
-- Purpose: Change trigger from BEFORE to AFTER to avoid foreign key constraint violation

-- =====================================================
-- DROP OLD TRIGGER
-- =====================================================

DROP TRIGGER IF EXISTS trigger_update_latest_version ON document_versions;

-- =====================================================
-- UPDATE FUNCTION: Change logic to work AFTER insert
-- =====================================================

CREATE OR REPLACE FUNCTION update_latest_version()
RETURNS TRIGGER AS $$
BEGIN
    -- Mark all other versions as not latest
    UPDATE document_versions
    SET is_latest = FALSE
    WHERE task_id = NEW.task_id AND id != NEW.id;

    -- Update task metadata (NOW row exists, so FK constraint works!)
    UPDATE tasks
    SET
        current_version_id = NEW.id,
        total_versions = (SELECT COUNT(*) FROM document_versions WHERE task_id = NEW.task_id AND is_draft = FALSE),
        last_edited_at = NEW.edited_at,
        last_edited_by = NEW.edited_by
    WHERE id = NEW.task_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- CREATE NEW TRIGGER: AFTER INSERT instead of BEFORE
-- =====================================================

CREATE TRIGGER trigger_update_latest_version
    AFTER INSERT ON document_versions  -- ← Changed from BEFORE to AFTER
    FOR EACH ROW
    WHEN (NEW.is_original = FALSE)
    EXECUTE FUNCTION update_latest_version();

COMMENT ON TRIGGER trigger_update_latest_version ON document_versions IS
'Updates is_latest flag and task metadata AFTER version insert (avoids FK constraint violation)';

-- =====================================================
-- NOTES
-- =====================================================

-- Why AFTER INSERT?
-- The trigger updates tasks.current_version_id = NEW.id
-- But if trigger runs BEFORE INSERT, NEW.id doesn't exist in document_versions yet
-- So the foreign key constraint "tasks_current_version_id_fkey" fails
--
-- Solution: Run trigger AFTER INSERT so the row exists first!
