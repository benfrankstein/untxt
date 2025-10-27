-- =============================================
-- Migration 015: Add Project Folders
-- HIPAA-Compliant folder organization for tasks
-- =============================================

-- =============================================
-- 1. FOLDERS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#c7ff00', -- Hex color for UI
    parent_folder_id UUID REFERENCES folders(id) ON DELETE CASCADE, -- For nested folders (future)
    is_archived BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Ensure unique folder names per user (case-insensitive)
    CONSTRAINT unique_folder_name_per_user UNIQUE(user_id, name, parent_folder_id),
    CONSTRAINT folder_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 255),
    CONSTRAINT valid_hex_color CHECK (color ~* '^#[0-9A-Fa-f]{6}$')
);

-- Indexes for performance
CREATE INDEX idx_folders_user_id ON folders(user_id);
CREATE INDEX idx_folders_parent ON folders(parent_folder_id);
CREATE INDEX idx_folders_created_at ON folders(created_at DESC);
CREATE INDEX idx_folders_archived ON folders(is_archived);

-- =============================================
-- 2. ADD FOLDER_ID TO TASKS TABLE
-- =============================================

-- Add folder_id column to tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

-- Index for filtering tasks by folder
CREATE INDEX IF NOT EXISTS idx_tasks_folder_id ON tasks(folder_id);

-- =============================================
-- 3. FOLDER AUDIT LOG TABLE (HIPAA Compliance)
-- =============================================

CREATE TABLE IF NOT EXISTS folder_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- created, renamed, deleted, archived, unarchived, moved_task_in, moved_task_out
    details JSONB, -- Old/new values, task IDs affected
    ip_address INET,
    user_agent TEXT,
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit queries
CREATE INDEX idx_folder_audit_folder_id ON folder_audit_log(folder_id);
CREATE INDEX idx_folder_audit_user_id ON folder_audit_log(user_id);
CREATE INDEX idx_folder_audit_performed_at ON folder_audit_log(performed_at DESC);
CREATE INDEX idx_folder_audit_action ON folder_audit_log(action);

-- =============================================
-- 4. DATABASE FUNCTIONS
-- =============================================

-- Function: Check if user has permission to access folder
CREATE OR REPLACE FUNCTION check_folder_permission(
    p_user_id UUID,
    p_folder_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    -- User must be folder owner
    RETURN EXISTS (
        SELECT 1 FROM folders
        WHERE id = p_folder_id AND user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Log folder action (HIPAA audit trail)
CREATE OR REPLACE FUNCTION log_folder_action(
    p_folder_id UUID,
    p_user_id UUID,
    p_action VARCHAR(50),
    p_details JSONB DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO folder_audit_log (
        folder_id, user_id, action, details, ip_address, user_agent
    ) VALUES (
        p_folder_id, p_user_id, p_action, p_details, p_ip_address, p_user_agent
    ) RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 5. TRIGGERS
-- =============================================

-- Trigger: Audit folder deletion and log affected tasks
CREATE OR REPLACE FUNCTION folder_cascade_delete_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_task_ids JSONB;
BEGIN
    -- Get all task IDs that were in the deleted folder
    SELECT jsonb_agg(id) INTO v_task_ids
    FROM tasks
    WHERE folder_id = OLD.id;

    -- Log the deletion with affected tasks
    PERFORM log_folder_action(
        OLD.id,
        OLD.user_id,
        'folder_deleted_cascade',
        jsonb_build_object(
            'folder_name', OLD.name,
            'folder_description', OLD.description,
            'task_count', (SELECT COUNT(*) FROM tasks WHERE folder_id = OLD.id),
            'tasks_affected', v_task_ids
        ),
        NULL,
        NULL
    );

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER folder_delete_audit
BEFORE DELETE ON folders
FOR EACH ROW EXECUTE FUNCTION folder_cascade_delete_audit();

-- Trigger: Update folder updated_at timestamp
CREATE OR REPLACE FUNCTION update_folder_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER folder_update_timestamp
BEFORE UPDATE ON folders
FOR EACH ROW EXECUTE FUNCTION update_folder_timestamp();

-- =============================================
-- 6. VIEWS FOR REPORTING (Optional)
-- =============================================

-- View: Folder summary with task counts
CREATE OR REPLACE VIEW folder_summary AS
SELECT
    f.id,
    f.user_id,
    f.name,
    f.description,
    f.color,
    f.is_archived,
    f.created_at,
    f.updated_at,
    COUNT(t.id) as task_count,
    COUNT(t.id) FILTER (WHERE t.status = 'completed') as completed_count,
    COUNT(t.id) FILTER (WHERE t.status = 'processing') as processing_count,
    COUNT(t.id) FILTER (WHERE t.status = 'failed') as failed_count
FROM folders f
LEFT JOIN tasks t ON f.id = t.folder_id
GROUP BY f.id;

-- View: Recent folder activity (audit summary)
CREATE OR REPLACE VIEW recent_folder_activity AS
SELECT
    fal.*,
    f.name as folder_name,
    u.username,
    u.email
FROM folder_audit_log fal
LEFT JOIN folders f ON fal.folder_id = f.id
LEFT JOIN users u ON fal.user_id = u.id
ORDER BY fal.performed_at DESC
LIMIT 100;

-- =============================================
-- 7. GRANT PERMISSIONS (if using restricted DB user)
-- =============================================

-- Grant necessary permissions to application user
-- GRANT SELECT, INSERT, UPDATE, DELETE ON folders TO ocr_platform_user;
-- GRANT SELECT, INSERT ON folder_audit_log TO ocr_platform_user;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ocr_platform_user;

-- =============================================
-- 8. SAMPLE DATA (Optional - for testing)
-- =============================================

-- Uncomment to create sample folders for testing
-- INSERT INTO folders (user_id, name, description, color)
-- SELECT id, 'Invoices', 'Customer invoices and receipts', '#4CAF50'
-- FROM users LIMIT 1;

-- INSERT INTO folders (user_id, name, description, color)
-- SELECT id, 'Contracts', 'Legal contracts and agreements', '#2196F3'
-- FROM users LIMIT 1;

-- =============================================
-- MIGRATION COMPLETE
-- =============================================

-- Log migration completion
DO $$
BEGIN
    RAISE NOTICE '✓ Migration 015 completed: Project folders added';
    RAISE NOTICE '  - folders table created';
    RAISE NOTICE '  - folder_id added to tasks table';
    RAISE NOTICE '  - folder_audit_log table created';
    RAISE NOTICE '  - Permission and audit functions created';
    RAISE NOTICE '  - Triggers configured';
    RAISE NOTICE '  - Views created';
END $$;
