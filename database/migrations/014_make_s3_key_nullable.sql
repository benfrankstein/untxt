-- Migration: Make s3_key nullable for Google Docs flow
-- Created: 2025-10-22
-- Purpose: Allow NULL s3_key during auto-save (content in database only)

-- =====================================================
-- ALTER COLUMN: s3_key can be NULL
-- =====================================================

ALTER TABLE document_versions
ALTER COLUMN s3_key DROP NOT NULL;

-- =====================================================
-- COMMENT
-- =====================================================

COMMENT ON COLUMN document_versions.s3_key IS
'S3 key for archived version. NULL during editing (content in html_content), set when session ends or download happens.';

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Show the column definition
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'document_versions'
AND column_name = 's3_key';

-- Expected result:
-- column_name | data_type | is_nullable | column_default
-- ------------+-----------+-------------+----------------
-- s3_key      | text      | YES         | null
