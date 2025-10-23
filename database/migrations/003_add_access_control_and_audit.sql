-- =============================================
-- Migration: Access Control and Audit Logging for HIPAA Compliance
-- Purpose: Enable instant revocation and comprehensive audit trails
-- Created: 2025-10-20
-- =============================================

-- =============================================
-- 1. User Access Control (Global Revocation)
-- =============================================

-- Add access control columns to users table
ALTER TABLE users
ADD COLUMN access_revoked BOOLEAN DEFAULT FALSE,
ADD COLUMN access_revoked_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN access_revoked_by UUID REFERENCES users(id),
ADD COLUMN revocation_reason TEXT;

-- Index for fast access checks
CREATE INDEX idx_users_access_revoked ON users(access_revoked) WHERE access_revoked = TRUE;

COMMENT ON COLUMN users.access_revoked IS 'Global flag to instantly revoke all file access for this user';
COMMENT ON COLUMN users.access_revoked_at IS 'Timestamp when access was revoked';
COMMENT ON COLUMN users.access_revoked_by IS 'Admin user who revoked access';
COMMENT ON COLUMN users.revocation_reason IS 'Reason for access revocation (e.g., terminated, security breach)';

-- =============================================
-- 2. File Access Control (Granular Per-File)
-- =============================================

CREATE TABLE file_access_control (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

    -- Access control
    access_granted BOOLEAN DEFAULT TRUE,

    -- Revocation details
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by UUID REFERENCES users(id),
    revocation_reason TEXT,

    -- Temporary revocation (can be re-enabled)
    temporary_revocation BOOLEAN DEFAULT FALSE,
    revocation_expires_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(user_id, task_id),
    CONSTRAINT valid_revocation CHECK (
        (access_granted = TRUE AND revoked_at IS NULL) OR
        (access_granted = FALSE AND revoked_at IS NOT NULL)
    )
);

CREATE INDEX idx_file_access_user_id ON file_access_control(user_id);
CREATE INDEX idx_file_access_task_id ON file_access_control(task_id);
CREATE INDEX idx_file_access_granted ON file_access_control(access_granted);
CREATE INDEX idx_file_access_revoked ON file_access_control(revoked_at) WHERE access_granted = FALSE;

COMMENT ON TABLE file_access_control IS 'Granular per-file access control for instant revocation of specific documents';

-- Trigger to update updated_at
CREATE TRIGGER update_file_access_control_updated_at
    BEFORE UPDATE ON file_access_control
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 3. File Access Audit Log (HIPAA Compliance)
-- =============================================

CREATE TYPE access_result AS ENUM ('allowed', 'denied', 'error');

CREATE TABLE file_access_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Who accessed
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(100), -- Preserved even if user deleted

    -- What was accessed
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    s3_key TEXT NOT NULL,
    filename VARCHAR(255),

    -- Access details
    access_result access_result NOT NULL,
    access_denied_reason TEXT,

    -- Request metadata
    ip_address INET,
    user_agent TEXT,
    session_id UUID,

    -- Timing
    accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    download_duration_ms INTEGER, -- How long download took

    -- Additional context
    metadata JSONB,

    CONSTRAINT positive_duration CHECK (download_duration_ms IS NULL OR download_duration_ms >= 0)
);

-- Indexes for audit queries
CREATE INDEX idx_file_access_log_user_id ON file_access_log(user_id);
CREATE INDEX idx_file_access_log_task_id ON file_access_log(task_id);
CREATE INDEX idx_file_access_log_accessed_at ON file_access_log(accessed_at DESC);
CREATE INDEX idx_file_access_log_access_result ON file_access_log(access_result);
CREATE INDEX idx_file_access_log_ip ON file_access_log(ip_address);
CREATE INDEX idx_file_access_log_denied ON file_access_log(accessed_at DESC) WHERE access_result = 'denied';

COMMENT ON TABLE file_access_log IS 'HIPAA-compliant audit log for all file access attempts (successful and denied)';
COMMENT ON COLUMN file_access_log.username IS 'Preserved username for audit trail even if user is deleted';

-- =============================================
-- 4. Admin Action Audit Log
-- =============================================

CREATE TYPE admin_action AS ENUM (
    'revoke_user_access',
    'restore_user_access',
    'revoke_file_access',
    'restore_file_access',
    'delete_user',
    'modify_user_role',
    'force_logout',
    'view_audit_log',
    'export_data',
    'purge_data'
);

CREATE TABLE admin_action_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Who performed action
    admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    admin_username VARCHAR(100),

    -- Action details
    action admin_action NOT NULL,
    action_description TEXT,

    -- Target of action
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_username VARCHAR(100),
    target_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,

    -- Context
    reason TEXT,
    ip_address INET,
    user_agent TEXT,

    -- Timing
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Additional data
    metadata JSONB
);

CREATE INDEX idx_admin_action_log_admin_id ON admin_action_log(admin_user_id);
CREATE INDEX idx_admin_action_log_target_user ON admin_action_log(target_user_id);
CREATE INDEX idx_admin_action_log_action ON admin_action_log(action);
CREATE INDEX idx_admin_action_log_performed_at ON admin_action_log(performed_at DESC);

COMMENT ON TABLE admin_action_log IS 'Audit log for all administrative actions (required for HIPAA compliance)';

-- =============================================
-- 5. Helper Functions for Access Control
-- =============================================

-- Function: Check if user has access to a specific task/file
CREATE OR REPLACE FUNCTION check_user_file_access(
    p_user_id UUID,
    p_task_id UUID
)
RETURNS TABLE (
    has_access BOOLEAN,
    denial_reason TEXT
) AS $$
DECLARE
    v_user_revoked BOOLEAN;
    v_file_access RECORD;
BEGIN
    -- Check global user revocation
    SELECT access_revoked INTO v_user_revoked
    FROM users
    WHERE id = p_user_id;

    IF v_user_revoked THEN
        RETURN QUERY SELECT FALSE, 'User access has been globally revoked'::TEXT;
        RETURN;
    END IF;

    -- Check file-specific revocation
    SELECT * INTO v_file_access
    FROM file_access_control
    WHERE user_id = p_user_id AND task_id = p_task_id;

    IF FOUND THEN
        IF NOT v_file_access.access_granted THEN
            -- Check if temporary revocation has expired
            IF v_file_access.temporary_revocation AND
               v_file_access.revocation_expires_at IS NOT NULL AND
               v_file_access.revocation_expires_at < CURRENT_TIMESTAMP THEN
                -- Temporary revocation expired, restore access
                UPDATE file_access_control
                SET access_granted = TRUE,
                    revoked_at = NULL,
                    revoked_by = NULL,
                    revocation_reason = NULL,
                    temporary_revocation = FALSE,
                    revocation_expires_at = NULL
                WHERE id = v_file_access.id;

                RETURN QUERY SELECT TRUE, NULL::TEXT;
            ELSE
                RETURN QUERY SELECT FALSE, v_file_access.revocation_reason;
            END IF;
        ELSE
            RETURN QUERY SELECT TRUE, NULL::TEXT;
        END IF;
    ELSE
        -- No explicit access control entry means access is granted
        RETURN QUERY SELECT TRUE, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_user_file_access IS 'Check if user has access to file, considering both global and file-specific revocations';

-- Function: Revoke user access globally
CREATE OR REPLACE FUNCTION revoke_user_access(
    p_user_id UUID,
    p_admin_user_id UUID,
    p_reason TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Update user record
    UPDATE users
    SET access_revoked = TRUE,
        access_revoked_at = CURRENT_TIMESTAMP,
        access_revoked_by = p_admin_user_id,
        revocation_reason = p_reason
    WHERE id = p_user_id;

    -- Log admin action
    INSERT INTO admin_action_log (
        admin_user_id,
        admin_username,
        action,
        action_description,
        target_user_id,
        target_username,
        reason
    )
    SELECT
        p_admin_user_id,
        a.username,
        'revoke_user_access',
        'Globally revoked all file access for user',
        p_user_id,
        u.username,
        p_reason
    FROM users u
    CROSS JOIN users a
    WHERE u.id = p_user_id AND a.id = p_admin_user_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Restore user access globally
CREATE OR REPLACE FUNCTION restore_user_access(
    p_user_id UUID,
    p_admin_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Update user record
    UPDATE users
    SET access_revoked = FALSE,
        access_revoked_at = NULL,
        access_revoked_by = NULL,
        revocation_reason = NULL
    WHERE id = p_user_id;

    -- Log admin action
    INSERT INTO admin_action_log (
        admin_user_id,
        admin_username,
        action,
        action_description,
        target_user_id,
        target_username,
        reason
    )
    SELECT
        p_admin_user_id,
        a.username,
        'restore_user_access',
        'Restored global file access for user',
        p_user_id,
        u.username,
        'Access restored'
    FROM users u
    CROSS JOIN users a
    WHERE u.id = p_user_id AND a.id = p_admin_user_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Revoke access to specific file
CREATE OR REPLACE FUNCTION revoke_file_access(
    p_user_id UUID,
    p_task_id UUID,
    p_admin_user_id UUID,
    p_reason TEXT,
    p_temporary BOOLEAN DEFAULT FALSE,
    p_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Insert or update file access control
    INSERT INTO file_access_control (
        user_id,
        task_id,
        access_granted,
        revoked_at,
        revoked_by,
        revocation_reason,
        temporary_revocation,
        revocation_expires_at
    )
    VALUES (
        p_user_id,
        p_task_id,
        FALSE,
        CURRENT_TIMESTAMP,
        p_admin_user_id,
        p_reason,
        p_temporary,
        p_expires_at
    )
    ON CONFLICT (user_id, task_id)
    DO UPDATE SET
        access_granted = FALSE,
        revoked_at = CURRENT_TIMESTAMP,
        revoked_by = p_admin_user_id,
        revocation_reason = p_reason,
        temporary_revocation = p_temporary,
        revocation_expires_at = p_expires_at;

    -- Log admin action
    INSERT INTO admin_action_log (
        admin_user_id,
        admin_username,
        action,
        target_user_id,
        target_username,
        target_task_id,
        reason
    )
    SELECT
        p_admin_user_id,
        a.username,
        'revoke_file_access',
        p_user_id,
        u.username,
        p_task_id,
        p_reason
    FROM users u
    CROSS JOIN users a
    WHERE u.id = p_user_id AND a.id = p_admin_user_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function: Restore access to specific file
CREATE OR REPLACE FUNCTION restore_file_access(
    p_user_id UUID,
    p_task_id UUID,
    p_admin_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Update file access control
    UPDATE file_access_control
    SET access_granted = TRUE,
        revoked_at = NULL,
        revoked_by = NULL,
        revocation_reason = NULL,
        temporary_revocation = FALSE,
        revocation_expires_at = NULL
    WHERE user_id = p_user_id AND task_id = p_task_id;

    -- Log admin action
    INSERT INTO admin_action_log (
        admin_user_id,
        admin_username,
        action,
        target_user_id,
        target_username,
        target_task_id,
        reason
    )
    SELECT
        p_admin_user_id,
        a.username,
        'restore_file_access',
        p_user_id,
        u.username,
        p_task_id,
        'Access restored'
    FROM users u
    CROSS JOIN users a
    WHERE u.id = p_user_id AND a.id = p_admin_user_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 6. Views for Admin Panel
-- =============================================

-- View: Users with revoked access
CREATE VIEW revoked_users_view AS
SELECT
    u.id,
    u.username,
    u.email,
    u.access_revoked_at,
    admin.username AS revoked_by_username,
    u.revocation_reason,
    COUNT(fal.id) AS denied_access_attempts
FROM users u
LEFT JOIN users admin ON u.access_revoked_by = admin.id
LEFT JOIN file_access_log fal ON u.id = fal.user_id AND fal.access_result = 'denied'
WHERE u.access_revoked = TRUE
GROUP BY u.id, u.username, u.email, u.access_revoked_at, admin.username, u.revocation_reason;

-- View: Recent access denials (security monitoring)
CREATE VIEW recent_access_denials_view AS
SELECT
    fal.id,
    fal.username,
    fal.filename,
    fal.access_denied_reason,
    fal.ip_address,
    fal.accessed_at,
    u.access_revoked AS user_globally_revoked
FROM file_access_log fal
LEFT JOIN users u ON fal.user_id = u.id
WHERE fal.access_result = 'denied'
ORDER BY fal.accessed_at DESC
LIMIT 100;

-- View: File access statistics per user
CREATE VIEW user_file_access_stats AS
SELECT
    u.id AS user_id,
    u.username,
    COUNT(fal.id) AS total_access_attempts,
    COUNT(CASE WHEN fal.access_result = 'allowed' THEN 1 END) AS successful_downloads,
    COUNT(CASE WHEN fal.access_result = 'denied' THEN 1 END) AS denied_attempts,
    MAX(fal.accessed_at) AS last_access_attempt,
    COUNT(DISTINCT fal.task_id) AS unique_files_accessed
FROM users u
LEFT JOIN file_access_log fal ON u.id = fal.user_id
GROUP BY u.id, u.username;

-- View: Admin actions summary
CREATE VIEW admin_actions_summary AS
SELECT
    admin_username,
    action,
    COUNT(*) AS action_count,
    MAX(performed_at) AS last_performed
FROM admin_action_log
GROUP BY admin_username, action
ORDER BY last_performed DESC;

-- =============================================
-- 7. Automatic Cleanup Jobs (Optional)
-- =============================================

-- Function to clean old audit logs (keep 7 years for HIPAA)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM file_access_log
    WHERE accessed_at < CURRENT_TIMESTAMP - INTERVAL '7 years';

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_audit_logs IS 'Clean up audit logs older than 7 years (HIPAA retention requirement)';

-- =============================================
-- Grant Permissions (Adjust as needed)
-- =============================================

-- Grant read access to audit logs for admin role
-- GRANT SELECT ON file_access_log TO admin_role;
-- GRANT SELECT ON admin_action_log TO admin_role;

-- =============================================
-- Migration Complete
-- =============================================

-- Insert migration record
INSERT INTO system_stats (metric_name, metric_value, metadata)
VALUES (
    'migration_003_access_control',
    1,
    '{"description": "Added access control and audit logging for HIPAA compliance", "date": "2025-10-20"}'::jsonb
);
