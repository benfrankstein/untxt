-- Migration 018: Allow Dual Format Processing (HTML + JSON) Per Page
-- Update unique constraint to allow multiple format_types per page
-- Created: 2025-11-30

-- Drop old constraint that only allowed one record per page
ALTER TABLE task_pages
DROP CONSTRAINT unique_task_page;

-- Add new constraint that allows multiple formats per page
ALTER TABLE task_pages
ADD CONSTRAINT unique_task_page_format UNIQUE(task_id, page_number, format_type);

COMMENT ON CONSTRAINT unique_task_page_format ON task_pages IS 'Allows multiple formats (html, json) per page number';

-- Log migration success
INSERT INTO system_stats (metric_name, metric_value, metadata)
VALUES (
    'migration_018_completed',
    1,
    jsonb_build_object(
        'description', 'Updated constraint to allow dual format processing per page',
        'change', 'UNIQUE(task_id, page_number) → UNIQUE(task_id, page_number, format_type)',
        'completed_at', CURRENT_TIMESTAMP
    )
);
