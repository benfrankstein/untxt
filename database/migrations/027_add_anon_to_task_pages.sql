-- Migration 027: Add Anonymization Support to Task Pages
-- Adds columns for storing anonymization results and metadata

ALTER TABLE task_pages
ADD COLUMN IF NOT EXISTS anon_json_s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS anon_txt_s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS anon_mapping_s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS anon_audit_s3_key VARCHAR(500),
ADD COLUMN IF NOT EXISTS anon_strategy VARCHAR(50),
ADD COLUMN IF NOT EXISTS anon_generate_audit BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS anon_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS anon_error TEXT,
ADD COLUMN IF NOT EXISTS anon_completed_at TIMESTAMP;

-- Create indexes for anon queries
CREATE INDEX IF NOT EXISTS idx_task_pages_anon_status ON task_pages(anon_status);
CREATE INDEX IF NOT EXISTS idx_task_pages_anon_json_s3_key ON task_pages(anon_json_s3_key) WHERE anon_json_s3_key IS NOT NULL;

-- Add check constraint for anon_status
ALTER TABLE task_pages
ADD CONSTRAINT task_pages_anon_status_check
CHECK (anon_status IN ('pending', 'processing', 'completed', 'failed'));

COMMENT ON COLUMN task_pages.anon_json_s3_key IS 'S3 key for anonymized JSON output (*_ANON.json)';
COMMENT ON COLUMN task_pages.anon_txt_s3_key IS 'S3 key for tokenized redacted text output (*_REDACTED.txt)';
COMMENT ON COLUMN task_pages.anon_mapping_s3_key IS 'S3 key for token mapping file (*_MAPPING.json)';
COMMENT ON COLUMN task_pages.anon_audit_s3_key IS 'S3 key for compliance audit log (*_AUDIT.json)';
COMMENT ON COLUMN task_pages.anon_strategy IS 'Strategy used (synthetic, redact, generalize, mask)';
COMMENT ON COLUMN task_pages.anon_status IS 'Anonymization processing status';
