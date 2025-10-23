-- Migration: Add document versioning support
-- Created: 2025-10-21
-- Purpose: Enable editable HTML results with full audit trail

-- =====================================================
-- TABLE: document_versions
-- Stores metadata for each edited version of a document
-- =====================================================
CREATE TABLE IF NOT EXISTS document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    s3_key TEXT NOT NULL,

    -- Version metadata
    is_original BOOLEAN DEFAULT FALSE,
    is_latest BOOLEAN DEFAULT FALSE,

    -- Content metrics (recalculated on edit)
    character_count INTEGER,
    word_count INTEGER,

    -- Edit information
    edited_by UUID NOT NULL REFERENCES users(id),
    edited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    edit_reason TEXT,
    edit_summary TEXT,

    -- Integrity
    content_checksum TEXT NOT NULL, -- SHA-256 of HTML content

    -- Audit metadata
    ip_address INET,
    user_agent TEXT,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT unique_task_version UNIQUE(task_id, version_number),
    CONSTRAINT version_number_positive CHECK (version_number >= 0)
);

-- Index for fast lookups
CREATE INDEX idx_document_versions_task_id ON document_versions(task_id);
CREATE INDEX idx_document_versions_file_id ON document_versions(file_id);
CREATE INDEX idx_document_versions_edited_by ON document_versions(edited_by);
CREATE INDEX idx_document_versions_edited_at ON document_versions(edited_at DESC);
CREATE INDEX idx_document_versions_latest ON document_versions(task_id, is_latest) WHERE is_latest = TRUE;

-- =====================================================
-- TABLE: document_edits_log
-- Detailed audit log of every edit action
-- =====================================================
CREATE TABLE IF NOT EXISTS document_edits_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

    -- Who and when
    user_id UUID NOT NULL REFERENCES users(id),
    username TEXT NOT NULL,
    action TEXT NOT NULL, -- 'create_version', 'view_version', 'compare_versions', 'download_version'

    -- Change details (for create_version)
    changes_description TEXT,
    diff_summary JSONB, -- Optional: store diff stats {added_chars: X, removed_chars: Y, ...}

    -- Audit metadata
    ip_address INET NOT NULL,
    user_agent TEXT,
    session_id TEXT,

    -- Compliance
    access_granted BOOLEAN DEFAULT TRUE,
    access_reason TEXT, -- 'owner', 'admin', 'break_glass', 'shared_access'

    -- Timestamps
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for audit queries
CREATE INDEX idx_document_edits_log_version_id ON document_edits_log(version_id);
CREATE INDEX idx_document_edits_log_task_id ON document_edits_log(task_id);
CREATE INDEX idx_document_edits_log_user_id ON document_edits_log(user_id);
CREATE INDEX idx_document_edits_log_logged_at ON document_edits_log(logged_at DESC);
CREATE INDEX idx_document_edits_log_action ON document_edits_log(action);

-- =====================================================
-- TABLE: document_edit_permissions
-- Control who can edit specific documents
-- =====================================================
CREATE TABLE IF NOT EXISTS document_edit_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Permission details
    can_edit BOOLEAN DEFAULT TRUE,
    granted_by UUID NOT NULL REFERENCES users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,

    -- Revocation
    revoked BOOLEAN DEFAULT FALSE,
    revoked_by UUID REFERENCES users(id),
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoke_reason TEXT,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT unique_task_user_permission UNIQUE(task_id, user_id)
);

-- Index for permission checks
CREATE INDEX idx_document_edit_permissions_task_id ON document_edit_permissions(task_id);
CREATE INDEX idx_document_edit_permissions_user_id ON document_edit_permissions(user_id);
CREATE INDEX idx_document_edit_permissions_active ON document_edit_permissions(task_id, user_id)
    WHERE can_edit = TRUE AND revoked = FALSE;

-- =====================================================
-- Add column to tasks table for version tracking
-- =====================================================
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS current_version_id UUID REFERENCES document_versions(id),
ADD COLUMN IF NOT EXISTS total_versions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES users(id);

CREATE INDEX idx_tasks_current_version ON tasks(current_version_id);

-- =====================================================
-- FUNCTION: Create original version record when task completes
-- =====================================================
CREATE OR REPLACE FUNCTION create_original_version()
RETURNS TRIGGER AS $$
BEGIN
    -- When task status changes to 'completed', create original version
    IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.s3_result_key IS NOT NULL THEN
        INSERT INTO document_versions (
            task_id,
            file_id,
            version_number,
            s3_key,
            is_original,
            is_latest,
            character_count,
            word_count,
            edited_by,
            edited_at,
            edit_reason,
            content_checksum,
            ip_address
        ) VALUES (
            NEW.id,
            NEW.file_id,
            0, -- version 0 is original
            NEW.s3_result_key,
            TRUE,
            TRUE,
            NEW.character_count,
            NEW.word_count,
            NEW.user_id,
            NEW.completed_at,
            'Original OCR output',
            '', -- Will be calculated by backend
            NULL
        )
        ON CONFLICT (task_id, version_number) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_create_original_version ON tasks;
CREATE TRIGGER trigger_create_original_version
    AFTER UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION create_original_version();

-- =====================================================
-- FUNCTION: Update is_latest flag when new version created
-- =====================================================
CREATE OR REPLACE FUNCTION update_latest_version()
RETURNS TRIGGER AS $$
BEGIN
    -- Mark all other versions as not latest
    UPDATE document_versions
    SET is_latest = FALSE
    WHERE task_id = NEW.task_id AND id != NEW.id;

    -- Ensure new version is marked as latest
    NEW.is_latest := TRUE;

    -- Update task metadata
    UPDATE tasks
    SET
        current_version_id = NEW.id,
        total_versions = (SELECT COUNT(*) FROM document_versions WHERE task_id = NEW.task_id),
        last_edited_at = NEW.edited_at,
        last_edited_by = NEW.edited_by
    WHERE id = NEW.task_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_latest_version ON document_versions;
CREATE TRIGGER trigger_update_latest_version
    BEFORE INSERT ON document_versions
    FOR EACH ROW
    WHEN (NEW.is_original = FALSE)
    EXECUTE FUNCTION update_latest_version();

-- =====================================================
-- Grant permissions
-- =====================================================
GRANT SELECT, INSERT, UPDATE ON document_versions TO ocr_platform_user;
GRANT SELECT, INSERT ON document_edits_log TO ocr_platform_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_edit_permissions TO ocr_platform_user;

-- =====================================================
-- Comments
-- =====================================================
COMMENT ON TABLE document_versions IS 'Stores all versions of edited OCR results with full audit trail';
COMMENT ON TABLE document_edits_log IS 'Detailed audit log of all edit actions for HIPAA compliance';
COMMENT ON TABLE document_edit_permissions IS 'Access control for who can edit specific documents';
COMMENT ON COLUMN document_versions.version_number IS 'Version 0 is original OCR output, 1+ are edits';
COMMENT ON COLUMN document_versions.is_latest IS 'TRUE for the current active version';
COMMENT ON COLUMN document_versions.content_checksum IS 'SHA-256 hash for tamper detection';
