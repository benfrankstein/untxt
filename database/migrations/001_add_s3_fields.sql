-- Migration: Add S3 storage fields
-- Date: 2025-10-16
-- Description: Add S3 key fields to support cloud storage alongside local file paths

-- =============================================
-- Add S3 key field to files table
-- =============================================

-- Add s3_key column to store S3 object key
ALTER TABLE files
ADD COLUMN s3_key TEXT;

-- Add index for S3 key lookups
CREATE INDEX idx_files_s3_key ON files(s3_key);

-- Add comment
COMMENT ON COLUMN files.s3_key IS 'S3 object key for cloud storage (e.g., uploads/user-id/2025-10/file-id/filename.pdf)';

-- =============================================
-- Add S3 key field to results table
-- =============================================

-- Add s3_result_key column to store S3 object key for result files
ALTER TABLE results
ADD COLUMN s3_result_key TEXT;

-- Add index for S3 key lookups
CREATE INDEX idx_results_s3_key ON results(s3_result_key);

-- Add comment
COMMENT ON COLUMN results.s3_result_key IS 'S3 object key for result HTML file (e.g., results/user-id/2025-10/task-id/result.html)';

-- =============================================
-- Migration Notes
-- =============================================

-- This migration adds S3 cloud storage support while maintaining backward compatibility
-- with local file paths. Both file_path and s3_key can coexist to support hybrid storage.
--
-- Strategy:
-- - New uploads should populate both file_path (local temp) and s3_key (permanent storage)
-- - Old records will have NULL s3_key values until backfilled
-- - Application should check s3_key first, fall back to file_path if NULL
