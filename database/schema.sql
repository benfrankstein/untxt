-- OCR Platform Database Schema
-- PostgreSQL 14+

-- =============================================
-- Extensions
-- =============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- ENUM Types
-- =============================================

CREATE TYPE user_role AS ENUM ('admin', 'user', 'guest');
CREATE TYPE task_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE file_type AS ENUM ('pdf', 'image', 'document');

-- =============================================
-- Users Table
-- =============================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE,

    -- Constraints
    CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    CONSTRAINT username_length CHECK (char_length(username) >= 3)
);

-- Index for faster lookups
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- =============================================
-- User Sessions Table
-- =============================================

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT session_not_expired CHECK (expires_at > created_at)
);

CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_sessions_last_activity ON user_sessions(last_activity);

-- =============================================
-- Files Metadata Table
-- =============================================

CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) UNIQUE NOT NULL,
    file_path TEXT NOT NULL,
    file_type file_type NOT NULL,
    mime_type VARCHAR(100),
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(64), -- SHA-256 hash for deduplication
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT positive_file_size CHECK (file_size > 0)
);

CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_hash ON files(file_hash);
CREATE INDEX idx_files_uploaded_at ON files(uploaded_at DESC);
CREATE INDEX idx_files_type ON files(file_type);

-- =============================================
-- Tasks Table (OCR Job Tracking)
-- =============================================

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    status task_status DEFAULT 'pending',
    priority INTEGER DEFAULT 0,

    -- Timing information
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Processing information
    worker_id VARCHAR(100), -- Identifier of the worker processing this task
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,

    -- Task metadata
    options JSONB DEFAULT '{}', -- Additional OCR options/parameters

    CONSTRAINT valid_priority CHECK (priority >= 0 AND priority <= 10),
    CONSTRAINT valid_attempts CHECK (attempts >= 0 AND attempts <= max_attempts),
    CONSTRAINT completed_after_started CHECK (
        completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at
    )
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_file_id ON tasks(file_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX idx_tasks_priority ON tasks(priority DESC);
CREATE INDEX idx_tasks_status_priority ON tasks(status, priority DESC) WHERE status = 'pending';

-- =============================================
-- Results Table (Processed OCR Output)
-- =============================================

CREATE TABLE results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID UNIQUE NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,

    -- OCR Output
    extracted_text TEXT,
    confidence_score DECIMAL(5,4), -- 0.0000 to 1.0000

    -- Structured data (if applicable)
    structured_data JSONB, -- For structured extraction results

    -- Result metadata
    page_count INTEGER,
    word_count INTEGER,
    processing_time_ms INTEGER, -- Processing time in milliseconds
    model_version VARCHAR(50), -- Qwen3 model version used

    -- Storage
    result_file_path TEXT, -- Path to full result file if stored separately

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_confidence CHECK (confidence_score >= 0 AND confidence_score <= 1),
    CONSTRAINT positive_counts CHECK (
        (page_count IS NULL OR page_count > 0) AND
        (word_count IS NULL OR word_count >= 0)
    ),
    CONSTRAINT positive_processing_time CHECK (processing_time_ms IS NULL OR processing_time_ms > 0)
);

CREATE INDEX idx_results_task_id ON results(task_id);
CREATE INDEX idx_results_user_id ON results(user_id);
CREATE INDEX idx_results_created_at ON results(created_at DESC);
CREATE INDEX idx_results_confidence ON results(confidence_score DESC);

-- =============================================
-- Task History/Audit Log Table
-- =============================================

CREATE TABLE task_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status task_status NOT NULL,
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_history_task_id ON task_history(task_id);
CREATE INDEX idx_task_history_user_id ON task_history(user_id);
CREATE INDEX idx_task_history_created_at ON task_history(created_at DESC);

-- =============================================
-- System Statistics Table (Optional)
-- =============================================

CREATE TABLE system_stats (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB
);

CREATE INDEX idx_system_stats_metric ON system_stats(metric_name);
CREATE INDEX idx_system_stats_recorded_at ON system_stats(recorded_at DESC);

-- =============================================
-- Functions and Triggers
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users table
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically create task history entry on status change
CREATE OR REPLACE FUNCTION log_task_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status != OLD.status THEN
        INSERT INTO task_history (task_id, user_id, status, message)
        VALUES (NEW.id, NEW.user_id, NEW.status, 'Status changed from ' || OLD.status || ' to ' || NEW.status);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for task status changes
CREATE TRIGGER task_status_change_trigger
    AFTER UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION log_task_status_change();

-- Function to prevent deletion of active tasks
CREATE OR REPLACE FUNCTION prevent_active_task_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'processing' THEN
        RAISE EXCEPTION 'Cannot delete task that is currently processing';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger to prevent deletion of processing tasks
CREATE TRIGGER prevent_processing_task_deletion
    BEFORE DELETE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION prevent_active_task_deletion();

-- =============================================
-- Views for Common Queries
-- =============================================

-- View for active tasks with user and file information
CREATE VIEW active_tasks_view AS
SELECT
    t.id,
    t.status,
    t.priority,
    t.created_at,
    t.started_at,
    u.username,
    u.email,
    f.original_filename,
    f.file_size,
    f.file_type
FROM tasks t
JOIN users u ON t.user_id = u.id
JOIN files f ON t.file_id = f.id
WHERE t.status IN ('pending', 'processing');

-- View for completed tasks with results
CREATE VIEW completed_tasks_view AS
SELECT
    t.id AS task_id,
    t.user_id,
    u.username,
    f.original_filename,
    t.created_at AS task_created_at,
    t.completed_at,
    r.confidence_score,
    r.word_count,
    r.processing_time_ms,
    EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) AS total_time_seconds
FROM tasks t
JOIN users u ON t.user_id = u.id
JOIN files f ON t.file_id = f.id
JOIN results r ON t.id = r.task_id
WHERE t.status = 'completed';

-- View for user statistics
CREATE VIEW user_stats_view AS
SELECT
    u.id,
    u.username,
    u.email,
    u.role,
    COUNT(DISTINCT t.id) AS total_tasks,
    COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.id END) AS completed_tasks,
    COUNT(DISTINCT CASE WHEN t.status = 'failed' THEN t.id END) AS failed_tasks,
    COUNT(DISTINCT f.id) AS total_files,
    COALESCE(SUM(f.file_size), 0) AS total_storage_bytes,
    u.created_at AS user_since
FROM users u
LEFT JOIN tasks t ON u.id = t.user_id
LEFT JOIN files f ON u.id = f.user_id
GROUP BY u.id, u.username, u.email, u.role, u.created_at;

-- =============================================
-- Comments for Documentation
-- =============================================

COMMENT ON TABLE users IS 'Stores user account information including authentication and roles';
COMMENT ON TABLE user_sessions IS 'Tracks active login sessions for security and remote logout capability';
COMMENT ON TABLE files IS 'Stores metadata about uploaded files';
COMMENT ON TABLE tasks IS 'Tracks OCR processing jobs and their status';
COMMENT ON TABLE results IS 'Stores the output from completed OCR processing';
COMMENT ON TABLE task_history IS 'Audit log for task status changes - preserved even after task deletion (task_id set to NULL)';

COMMENT ON COLUMN tasks.priority IS 'Higher number = higher priority (0-10)';
COMMENT ON COLUMN results.confidence_score IS 'OCR confidence score from 0.0 to 1.0';
COMMENT ON COLUMN files.file_hash IS 'SHA-256 hash for file deduplication and integrity';
