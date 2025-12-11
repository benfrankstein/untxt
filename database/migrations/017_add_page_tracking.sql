-- Migration 017: Add Page-Level Tracking for HIPAA Compliance
-- This migration adds granular page tracking for concurrent processing and audit compliance
-- Created: 2025-11-30

-- =============================================
-- 1. Add page_count to files table
-- =============================================

ALTER TABLE files
ADD COLUMN page_count INTEGER DEFAULT 1;

COMMENT ON COLUMN files.page_count IS 'Number of pages in the original file (intrinsic property of the file)';

-- Add constraint to ensure positive page count
ALTER TABLE files
ADD CONSTRAINT positive_page_count CHECK (page_count > 0);

-- =============================================
-- 2. Add page_count to tasks table
-- =============================================

ALTER TABLE tasks
ADD COLUMN page_count INTEGER DEFAULT 1;

COMMENT ON COLUMN tasks.page_count IS 'Number of pages processed in this task (usually matches files.page_count)';

-- Add constraint to ensure positive page count
ALTER TABLE tasks
ADD CONSTRAINT positive_task_page_count CHECK (page_count > 0);

-- =============================================
-- 3. Create task_pages table for granular tracking
-- =============================================

CREATE TYPE page_status AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE task_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

    -- Page identification
    page_number INTEGER NOT NULL,
    total_pages INTEGER NOT NULL,

    -- Processing status
    status page_status DEFAULT 'pending',
    format_type VARCHAR(10) DEFAULT 'html', -- 'html' or 'json'

    -- Worker information
    worker_id VARCHAR(100),

    -- S3 storage keys
    page_image_s3_key TEXT NOT NULL,
    result_s3_key TEXT,

    -- Performance metrics
    processing_time_ms INTEGER,

    -- Timestamps for audit trail
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,

    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Constraints
    CONSTRAINT unique_task_page UNIQUE(task_id, page_number),
    CONSTRAINT positive_page_number CHECK (page_number > 0 AND page_number <= total_pages),
    CONSTRAINT positive_total_pages CHECK (total_pages > 0),
    CONSTRAINT positive_processing_time CHECK (processing_time_ms IS NULL OR processing_time_ms > 0),
    CONSTRAINT positive_retry_count CHECK (retry_count >= 0),
    CONSTRAINT completed_after_started CHECK (
        completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at
    ),
    CONSTRAINT started_after_created CHECK (
        started_at IS NULL OR started_at >= created_at
    )
);

-- Indexes for performance
CREATE INDEX idx_task_pages_task_id ON task_pages(task_id);
CREATE INDEX idx_task_pages_status ON task_pages(status);
CREATE INDEX idx_task_pages_worker_id ON task_pages(worker_id);
CREATE INDEX idx_task_pages_created_at ON task_pages(created_at DESC);
CREATE INDEX idx_task_pages_page_number ON task_pages(page_number);

-- Index for finding pending pages to process
CREATE INDEX idx_task_pages_pending ON task_pages(task_id, status) WHERE status = 'pending';

-- Comments for documentation
COMMENT ON TABLE task_pages IS 'Granular page-level tracking for HIPAA compliance and concurrent processing';
COMMENT ON COLUMN task_pages.page_number IS 'Page number within the document (1-indexed)';
COMMENT ON COLUMN task_pages.format_type IS 'Output format: html (pixel-perfect) or json (key-value extraction)';
COMMENT ON COLUMN task_pages.worker_id IS 'ID of worker that processed this page (for audit trail)';
COMMENT ON COLUMN task_pages.page_image_s3_key IS 'S3 key for the page image (JPG at 300 DPI)';
COMMENT ON COLUMN task_pages.result_s3_key IS 'S3 key for the processed result (HTML or JSON)';

-- =============================================
-- 4. Create function to auto-update task status based on pages
-- =============================================

CREATE OR REPLACE FUNCTION update_task_status_from_pages()
RETURNS TRIGGER AS $$
DECLARE
    v_task_id UUID;
    v_total_pages INTEGER;
    v_completed_pages INTEGER;
    v_failed_pages INTEGER;
    v_processing_pages INTEGER;
BEGIN
    -- Get task_id from the changed row
    v_task_id := COALESCE(NEW.task_id, OLD.task_id);

    -- Count page statuses for this task
    SELECT
        COUNT(*) FILTER (WHERE status = 'completed'),
        COUNT(*) FILTER (WHERE status = 'failed'),
        COUNT(*) FILTER (WHERE status = 'processing'),
        COUNT(*)
    INTO
        v_completed_pages,
        v_failed_pages,
        v_processing_pages,
        v_total_pages
    FROM task_pages
    WHERE task_id = v_task_id;

    -- Update parent task status based on page statuses
    IF v_completed_pages = v_total_pages THEN
        -- All pages completed
        UPDATE tasks
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE id = v_task_id AND status != 'completed';

    ELSIF v_failed_pages > 0 AND (v_completed_pages + v_failed_pages) = v_total_pages THEN
        -- Some pages failed and no pages are pending/processing
        UPDATE tasks
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
            error_message = v_failed_pages || ' of ' || v_total_pages || ' pages failed'
        WHERE id = v_task_id AND status != 'failed';

    ELSIF v_processing_pages > 0 THEN
        -- At least one page is processing
        UPDATE tasks
        SET status = 'processing', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
        WHERE id = v_task_id AND status = 'pending';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update task status when page status changes
CREATE TRIGGER update_task_status_on_page_change
    AFTER INSERT OR UPDATE OF status ON task_pages
    FOR EACH ROW
    EXECUTE FUNCTION update_task_status_from_pages();

COMMENT ON FUNCTION update_task_status_from_pages IS 'Automatically updates parent task status based on page completion';

-- =============================================
-- 5. Create view for page processing overview
-- =============================================

CREATE VIEW task_pages_overview AS
SELECT
    t.id AS task_id,
    t.user_id,
    f.original_filename,
    t.status AS task_status,
    t.page_count AS total_pages,
    COUNT(tp.id) AS pages_created,
    COUNT(tp.id) FILTER (WHERE tp.status = 'completed') AS pages_completed,
    COUNT(tp.id) FILTER (WHERE tp.status = 'failed') AS pages_failed,
    COUNT(tp.id) FILTER (WHERE tp.status = 'processing') AS pages_processing,
    COUNT(tp.id) FILTER (WHERE tp.status = 'pending') AS pages_pending,
    ROUND(
        100.0 * COUNT(tp.id) FILTER (WHERE tp.status = 'completed') / NULLIF(COUNT(tp.id), 0),
        1
    ) AS completion_percentage,
    t.created_at,
    MIN(tp.started_at) AS first_page_started,
    MAX(tp.completed_at) AS last_page_completed
FROM tasks t
JOIN files f ON t.file_id = f.id
LEFT JOIN task_pages tp ON t.id = tp.task_id
GROUP BY t.id, t.user_id, f.original_filename, t.status, t.page_count, t.created_at;

COMMENT ON VIEW task_pages_overview IS 'Overview of page processing progress for each task';

-- =============================================
-- 6. Backfill existing data (if any)
-- =============================================

-- Update existing tasks to have page_count = 1 (most likely single page)
UPDATE tasks SET page_count = 1 WHERE page_count IS NULL;

-- Update existing files to have page_count = 1 (most likely single page)
UPDATE files SET page_count = 1 WHERE page_count IS NULL;

-- =============================================
-- Migration Complete
-- =============================================

-- Log migration success
INSERT INTO system_stats (metric_name, metric_value, metadata)
VALUES (
    'migration_017_completed',
    1,
    jsonb_build_object(
        'description', 'Added page-level tracking for HIPAA compliance',
        'tables_added', ARRAY['task_pages'],
        'columns_added', ARRAY['files.page_count', 'tasks.page_count'],
        'completed_at', CURRENT_TIMESTAMP
    )
);
