-- Migration: Add draft version support for auto-save
-- Created: 2025-10-21
-- Purpose: Enable auto-save drafts for HIPAA compliance (audit all edits)

-- =====================================================
-- ALTER TABLE: document_versions
-- Add draft support columns
-- =====================================================

-- Add draft status column
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT FALSE;

-- Add draft session tracking
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS draft_session_id TEXT;

-- Add last auto-save timestamp
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS last_autosaved_at TIMESTAMP WITH TIME ZONE;

-- Add published timestamp (when draft becomes final)
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;

-- Add draft expiration (clean up old drafts)
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS draft_expires_at TIMESTAMP WITH TIME ZONE;

-- =====================================================
-- INDEXES
-- =====================================================

-- Index for finding user's active drafts
CREATE INDEX IF NOT EXISTS idx_document_versions_drafts
ON document_versions(task_id, edited_by, is_draft)
WHERE is_draft = TRUE;

-- Index for draft cleanup (expired drafts)
CREATE INDEX IF NOT EXISTS idx_document_versions_draft_expiry
ON document_versions(draft_expires_at)
WHERE is_draft = TRUE AND draft_expires_at IS NOT NULL;

-- =====================================================
-- UPDATE CONSTRAINTS
-- =====================================================

-- Modify unique constraint to allow multiple drafts per task/version
-- (Each user can have their own draft for a version)
ALTER TABLE document_versions
DROP CONSTRAINT IF EXISTS unique_task_version;

-- New constraint: Only one published version per task/version_number
ALTER TABLE document_versions
ADD CONSTRAINT unique_task_version_published
UNIQUE(task_id, version_number)
DEFERRABLE INITIALLY DEFERRED;

-- Constraint: Draft versions must have draft_session_id
ALTER TABLE document_versions
ADD CONSTRAINT draft_requires_session
CHECK (
  (is_draft = FALSE) OR
  (is_draft = TRUE AND draft_session_id IS NOT NULL)
);

-- =====================================================
-- TRIGGER: Auto-update last_autosaved_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_draft_autosave_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update for drafts
  IF NEW.is_draft = TRUE THEN
    NEW.last_autosaved_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_draft_autosave ON document_versions;
CREATE TRIGGER trigger_update_draft_autosave
  BEFORE UPDATE ON document_versions
  FOR EACH ROW
  WHEN (NEW.is_draft = TRUE)
  EXECUTE FUNCTION update_draft_autosave_timestamp();

-- =====================================================
-- TRIGGER: Prevent multiple drafts per user per task
-- =====================================================

CREATE OR REPLACE FUNCTION enforce_single_draft_per_user()
RETURNS TRIGGER AS $$
BEGIN
  -- If inserting a draft, delete any existing drafts for this user/task
  IF NEW.is_draft = TRUE THEN
    DELETE FROM document_versions
    WHERE task_id = NEW.task_id
      AND edited_by = NEW.edited_by
      AND is_draft = TRUE
      AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enforce_single_draft ON document_versions;
CREATE TRIGGER trigger_enforce_single_draft
  BEFORE INSERT ON document_versions
  FOR EACH ROW
  WHEN (NEW.is_draft = TRUE)
  EXECUTE FUNCTION enforce_single_draft_per_user();

-- =====================================================
-- FUNCTION: Publish a draft (convert to final version)
-- =====================================================

CREATE OR REPLACE FUNCTION publish_draft_version(
  p_draft_id UUID,
  p_edit_reason TEXT DEFAULT NULL
)
RETURNS document_versions AS $$
DECLARE
  v_draft document_versions;
  v_next_version INTEGER;
BEGIN
  -- Get the draft
  SELECT * INTO v_draft
  FROM document_versions
  WHERE id = p_draft_id AND is_draft = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft version not found';
  END IF;

  -- Get next version number
  SELECT COALESCE(MAX(version_number), -1) + 1 INTO v_next_version
  FROM document_versions
  WHERE task_id = v_draft.task_id AND is_draft = FALSE;

  -- Update the draft to be a published version
  UPDATE document_versions
  SET
    is_draft = FALSE,
    version_number = v_next_version,
    published_at = CURRENT_TIMESTAMP,
    edit_reason = COALESCE(p_edit_reason, edit_reason),
    draft_expires_at = NULL
  WHERE id = p_draft_id;

  -- Return the published version
  SELECT * INTO v_draft
  FROM document_versions
  WHERE id = p_draft_id;

  RETURN v_draft;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION: Clean up expired drafts (for scheduled job)
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_expired_drafts()
RETURNS INTEGER AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete drafts that have expired
  WITH deleted AS (
    DELETE FROM document_versions
    WHERE is_draft = TRUE
      AND draft_expires_at IS NOT NULL
      AND draft_expires_at < CURRENT_TIMESTAMP
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENT: How draft versions work
-- =====================================================

COMMENT ON COLUMN document_versions.is_draft IS
'TRUE if this is an auto-saved draft, FALSE if published version';

COMMENT ON COLUMN document_versions.draft_session_id IS
'Unique session ID for tracking draft edits (prevents conflicts)';

COMMENT ON COLUMN document_versions.last_autosaved_at IS
'Last time this draft was auto-saved (updated on every save)';

COMMENT ON COLUMN document_versions.published_at IS
'When this draft was published as a final version (NULL for drafts)';

COMMENT ON COLUMN document_versions.draft_expires_at IS
'When this draft should be deleted (typically 24-48 hours after last edit)';

-- =====================================================
-- NOTES
-- =====================================================

-- Draft Version Lifecycle:
-- 1. User enters edit mode → creates draft (is_draft=TRUE, version_number=-1 or NULL)
-- 2. User makes changes → auto-saves to same draft record (updates content)
-- 3. User clicks "Save Version" → publishes draft (is_draft=FALSE, gets real version_number)
-- 4. Or user cancels → draft deleted
-- 5. Or draft expires after 24h → deleted by cleanup job

-- HIPAA Compliance:
-- - All drafts are logged in document_edits_log (audit trail)
-- - Every auto-save updates the draft record (full history via last_autosaved_at)
-- - Draft session ID prevents conflicts between multiple users
-- - Expired drafts are cleaned up automatically

-- Example Usage:
-- 1. Create draft: INSERT INTO document_versions (..., is_draft=TRUE, version_number=-1)
-- 2. Auto-save: UPDATE document_versions SET content_checksum=... WHERE id=draft_id
-- 3. Publish: SELECT publish_draft_version(draft_id, 'Fixed typos')
-- 4. Cleanup: SELECT cleanup_expired_drafts() (run as cron job)
