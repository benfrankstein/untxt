-- Migration: Fix create_original_version trigger to work with deferrable constraints
-- Created: 2025-10-21
-- Purpose: ON CONFLICT doesn't support deferrable constraints, use explicit check instead

CREATE OR REPLACE FUNCTION create_original_version()
RETURNS TRIGGER AS $$
DECLARE
  v_result RECORD;
  v_character_count INTEGER;
  v_existing_version_count INTEGER;
BEGIN
    -- When task status changes to 'completed', create original version
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        -- Check if version 0 already exists for this task
        SELECT COUNT(*) INTO v_existing_version_count
        FROM document_versions
        WHERE task_id = NEW.id AND version_number = 0;

        -- Only proceed if version 0 doesn't exist
        IF v_existing_version_count = 0 THEN
            -- Fetch result data
            SELECT s3_result_key, word_count, extracted_text
            INTO v_result
            FROM results
            WHERE task_id = NEW.id;

            -- Only create version if result exists with S3 key
            IF FOUND AND v_result.s3_result_key IS NOT NULL THEN
                -- Calculate character count from extracted text
                v_character_count := COALESCE(LENGTH(v_result.extracted_text), 0);

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
                    v_character_count,
                    v_result.word_count,
                    NEW.user_id,
                    NEW.completed_at,
                    'Original OCR output',
                    '', -- Will be calculated by backend if needed
                    NULL
                );
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_original_version() IS
'Creates version 0 (original) when task completes. Uses explicit existence check instead of ON CONFLICT to work with deferrable constraints.';
