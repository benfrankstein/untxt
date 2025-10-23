-- Migration: Fix create_original_version trigger to fetch data from results table
-- Created: 2025-10-22
-- Purpose: The trigger was trying to access fields that don't exist on tasks table

CREATE OR REPLACE FUNCTION create_original_version()
RETURNS TRIGGER AS $$
DECLARE
  v_result RECORD;
BEGIN
    -- When task status changes to 'completed', create original version
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        -- Fetch result data (s3_result_key, character_count, word_count)
        SELECT s3_result_key, character_count, word_count
        INTO v_result
        FROM results
        WHERE task_id = NEW.id;

        -- Only create version if result exists with S3 key
        IF FOUND AND v_result.s3_result_key IS NOT NULL THEN
            INSERT INTO document_versions (
                task_id,
                file_id,
                version_number,
                s3_key,
                is_original,
                is_latest,
                character_count,
                word_count,
                edited_by,
                edited_at,
                edit_reason,
                content_checksum,
                ip_address
            ) VALUES (
                NEW.id,
                NEW.file_id,
                0, -- version 0 is original
                v_result.s3_result_key,
                TRUE,
                TRUE,
                v_result.character_count,
                v_result.word_count,
                NEW.user_id,
                NEW.completed_at,
                'Original OCR output',
                '', -- Will be calculated by backend if needed
                NULL
            )
            ON CONFLICT (task_id, version_number) DO NOTHING;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_original_version() IS
'Creates version 0 (original) when task completes. Fetches s3_result_key and metrics from results table.';
