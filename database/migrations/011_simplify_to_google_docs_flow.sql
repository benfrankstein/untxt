-- Migration: Simplify to Google Docs flow (auto-save = auto-publish)
-- Created: 2025-10-21
-- Purpose: Remove draft concept, every save creates a version

-- =====================================================
-- STEP 1: Remove draft-related fields
-- =====================================================

-- Remove draft-specific columns (we'll keep them as nullable for backward compatibility)
-- In production, you'd drop these, but for safety we'll just stop using them
ALTER TABLE document_versions
  ALTER COLUMN is_draft SET DEFAULT FALSE,
  ALTER COLUMN draft_session_id DROP NOT NULL,
  ALTER COLUMN last_autosaved_at DROP NOT NULL,
  ALTER COLUMN draft_expires_at DROP DEFAULT;

COMMENT ON COLUMN document_versions.is_draft IS
'DEPRECATED: All versions are now published immediately (Google Docs flow)';

COMMENT ON COLUMN document_versions.draft_session_id IS
'DEPRECATED: Session tracking moved to document_edit_sessions table';

-- =====================================================
-- STEP 2: Update document_edit_sessions for new flow
-- =====================================================

-- Add versions_created counter
ALTER TABLE document_edit_sessions
ADD COLUMN IF NOT EXISTS versions_created INTEGER DEFAULT 0;

-- Remove draft_id reference (no longer needed)
ALTER TABLE document_edit_sessions
ALTER COLUMN draft_id DROP NOT NULL;

COMMENT ON COLUMN document_edit_sessions.versions_created IS
'Number of versions created during this editing session';

-- =====================================================
-- STEP 3: Update publish_draft_version to just create version
-- =====================================================

-- This function is no longer needed, but we'll keep it for backward compatibility
-- It now just creates a new version directly
DROP FUNCTION IF EXISTS publish_draft_version(UUID, TEXT);

CREATE OR REPLACE FUNCTION create_new_version(
  p_task_id UUID,
  p_file_id UUID,
  p_user_id UUID,
  p_s3_key TEXT,
  p_character_count INTEGER,
  p_word_count INTEGER,
  p_edit_reason TEXT DEFAULT 'Auto-save',
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL
)
RETURNS document_versions AS $$
DECLARE
  v_next_version INTEGER;
  v_new_version document_versions;
BEGIN
  -- Get next version number
  SELECT COALESCE(MAX(version_number), -1) + 1 INTO v_next_version
  FROM document_versions
  WHERE task_id = p_task_id;

  -- Create new version
  INSERT INTO document_versions (
    task_id,
    file_id,
    version_number,
    s3_key,
    character_count,
    word_count,
    edited_by,
    edited_at,
    edit_reason,
    ip_address,
    user_agent,
    is_draft,
    is_latest,
    is_original,
    draft_session_id
  ) VALUES (
    p_task_id,
    p_file_id,
    v_next_version,
    p_s3_key,
    p_character_count,
    p_word_count,
    p_user_id,
    CURRENT_TIMESTAMP,
    p_edit_reason,
    p_ip_address,
    p_user_agent,
    FALSE,  -- No more drafts, everything is published
    TRUE,   -- This is now the latest
    FALSE,
    p_session_id
  )
  RETURNING * INTO v_new_version;

  -- Mark previous versions as not latest
  UPDATE document_versions
  SET is_latest = FALSE
  WHERE task_id = p_task_id
    AND id != v_new_version.id
    AND is_latest = TRUE;

  RETURN v_new_version;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_new_version IS
'Creates a new version immediately (Google Docs flow - no drafts)';

-- =====================================================
-- STEP 4: Update session tracking functions
-- =====================================================

-- Function to increment versions_created in session
CREATE OR REPLACE FUNCTION increment_session_versions(
  p_session_id TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE document_edit_sessions
  SET
    versions_created = versions_created + 1,
    last_activity_at = CURRENT_TIMESTAMP
  WHERE session_id = p_session_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_session_versions IS
'Increments version counter when user saves during a session';

-- =====================================================
-- STEP 5: Cleanup old draft-related functions
-- =====================================================

-- Keep cleanup_expired_drafts but it won't do anything anymore
-- (all "drafts" are now versions)

-- =====================================================
-- GRANTS
-- =====================================================

GRANT EXECUTE ON FUNCTION create_new_version TO ocr_platform_user;
GRANT EXECUTE ON FUNCTION increment_session_versions TO ocr_platform_user;

-- =====================================================
-- MIGRATION NOTES
-- =====================================================

COMMENT ON TABLE document_versions IS
'Stores all document versions. Every auto-save creates a new version (Google Docs flow).
Version 0 = original OCR output
Version 1+ = user edits (auto-saved every 3 seconds)';

COMMENT ON TABLE document_edit_sessions IS
'Tracks editing sessions. Sessions start when user opens document, end when user closes it.
Tracks how many versions were created during the session for audit purposes.';
