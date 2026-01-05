-- Migration: Add json_result_s3_key column to task_pages
-- Purpose: Store reference to raw JSON extraction data in S3
-- Date: 2025-12-30

-- Add column for JSON result S3 key
ALTER TABLE task_pages
ADD COLUMN json_result_s3_key TEXT;

-- Add comment
COMMENT ON COLUMN task_pages.json_result_s3_key IS 'S3 key for raw JSON extraction data (structured KVP output)';

-- Create index for faster lookups
CREATE INDEX idx_task_pages_json_result ON task_pages(json_result_s3_key) WHERE json_result_s3_key IS NOT NULL;
