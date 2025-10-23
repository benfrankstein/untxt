-- Migration: Allow version_number = -1 for draft versions
-- Created: 2025-10-22
-- Purpose: Fix constraint to allow drafts with version_number = -1

-- Drop the old constraint
ALTER TABLE document_versions
DROP CONSTRAINT IF EXISTS version_number_positive;

-- Add new constraint that allows -1 for drafts, but requires >= 0 for published versions
ALTER TABLE document_versions
ADD CONSTRAINT version_number_valid CHECK (
  (is_draft = TRUE AND version_number = -1) OR
  (is_draft = FALSE AND version_number >= 0)
);

COMMENT ON CONSTRAINT version_number_valid ON document_versions IS
'Draft versions must have version_number = -1, published versions must have version_number >= 0';
