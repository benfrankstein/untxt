-- Migration: Fix update_latest_version trigger to handle drafts
-- Created: 2025-10-22
-- Purpose: Prevent trigger from updating tasks table for draft versions

-- =====================================================
-- UPDATE TRIGGER FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION update_latest_version()
RETURNS TRIGGER AS $$
BEGIN
    -- Skip updating for drafts
    IF NEW.is_draft = TRUE THEN
        -- Drafts should NOT be marked as latest
        NEW.is_latest := FALSE;
        RETURN NEW;
    END IF;

    -- For published versions only:

    -- Mark all other versions as not latest
    UPDATE document_versions
    SET is_latest = FALSE
    WHERE task_id = NEW.task_id AND id != NEW.id AND is_draft = FALSE;

    -- Ensure new version is marked as latest
    NEW.is_latest := TRUE;

    -- Update task metadata
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

-- Trigger remains the same (already exists, just updating function)
-- CREATE TRIGGER trigger_update_latest_version
--     BEFORE INSERT ON document_versions
--     FOR EACH ROW
--     WHEN (NEW.is_original = FALSE)
--     EXECUTE FUNCTION update_latest_version();

-- =====================================================
-- NOTES
-- =====================================================

-- This fix ensures that:
-- 1. Draft versions do NOT update tasks.current_version_id
-- 2. Draft versions do NOT get is_latest = TRUE
-- 3. Only published versions update task metadata
-- 4. total_versions only counts published versions (not drafts)
