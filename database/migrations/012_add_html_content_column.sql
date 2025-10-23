-- Migration: Add html_content column for Google Docs flow
-- Created: 2025-10-21
-- Purpose: Store HTML content in database during editing (faster than S3)

-- Add html_content column to document_versions
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS html_content TEXT;

COMMENT ON COLUMN document_versions.html_content IS
'HTML content stored in database for fast access during editing.
Uploaded to S3 on session end or download for durable backup.
NULL if content only exists in S3 (archived versions).';

-- Drop old create_new_version function
DROP FUNCTION IF EXISTS create_new_version(UUID, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, INET, TEXT, TEXT);

-- Update create_new_version function to accept html_content
CREATE OR REPLACE FUNCTION create_new_version(
  p_task_id UUID,
  p_file_id UUID,
  p_user_id UUID,
  p_html_content TEXT,          -- NEW: HTML content for database storage
  p_s3_key TEXT,                 -- NULL during editing, set on session end/download
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
    html_content,       -- Store HTML in database
    s3_key,             -- NULL during editing
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
    p_html_content,     -- Store in database
    p_s3_key,           -- NULL for auto-saves
    p_character_count,
    p_word_count,
    p_user_id,
    CURRENT_TIMESTAMP,
    p_edit_reason,
    p_ip_address,
    p_user_agent,
    FALSE,              -- No more drafts
    TRUE,               -- This is now the latest
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
'Creates a new version with HTML content in database (Google Docs flow).
s3_key is NULL during editing, set on session end/download.';

-- Create function to update existing version (for < 5 min auto-saves)
CREATE OR REPLACE FUNCTION update_version_content(
  p_version_id UUID,
  p_html_content TEXT,
  p_character_count INTEGER,
  p_word_count INTEGER
)
RETURNS document_versions AS $$
DECLARE
  v_updated_version document_versions;
BEGIN
  UPDATE document_versions
  SET
    html_content = p_html_content,
    character_count = p_character_count,
    word_count = p_word_count,
    edited_at = CURRENT_TIMESTAMP
  WHERE id = p_version_id
  RETURNING * INTO v_updated_version;

  RETURN v_updated_version;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_version_content IS
'Updates existing version content (when < 5 minutes since last snapshot).
Does NOT create new version, just updates html_content.';

-- Create function to update version with S3 key
CREATE OR REPLACE FUNCTION update_version_s3_key(
  p_version_id UUID,
  p_s3_key TEXT
)
RETURNS document_versions AS $$
DECLARE
  v_updated_version document_versions;
BEGIN
  UPDATE document_versions
  SET s3_key = p_s3_key
  WHERE id = p_version_id
  RETURNING * INTO v_updated_version;

  RETURN v_updated_version;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_version_s3_key IS
'Sets S3 key for a version after uploading to S3 (session end, download).';

-- Grants
GRANT EXECUTE ON FUNCTION create_new_version TO ocr_platform_user;
GRANT EXECUTE ON FUNCTION update_version_content TO ocr_platform_user;
GRANT EXECUTE ON FUNCTION update_version_s3_key TO ocr_platform_user;
