-- Migration: Make local file paths optional
-- Date: 2025-10-16
-- Description: Make file_path and result_file_path nullable since we're storing files in S3 only

-- =============================================
-- Make file_path nullable in files table
-- =============================================

ALTER TABLE files
ALTER COLUMN file_path DROP NOT NULL;

COMMENT ON COLUMN files.file_path IS 'Legacy local file path (optional, prefer s3_key for cloud storage)';

-- =============================================
-- Migration Notes
-- =============================================

-- With S3-only storage:
-- - file_path can be NULL (S3 is primary storage)
-- - s3_key must be populated for new uploads
-- - result_file_path can be NULL (S3 is primary storage)
-- - s3_result_key must be populated for new results
--
-- This allows the system to work in cloud-native mode without local file dependencies.
