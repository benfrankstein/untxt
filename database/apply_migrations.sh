#!/bin/bash

cd "/Users/mitch/_PROJEKTE/___UNTXT/08_web_app/untxt/database/migrations"

migrations=(
  "001_add_s3_fields.sql"
  "002_make_local_paths_optional.sql"
  "003_add_access_control_and_audit.sql"
  "003_add_document_versions.sql"
  "004_add_draft_versions.sql"
  "005_fix_draft_trigger.sql"
  "006_allow_draft_version_number.sql"
  "007_fix_create_original_version_trigger.sql"
  "008_fix_create_original_version_character_count.sql"
  "009_create_document_edit_sessions.sql"
  "010_fix_create_original_version_deferrable.sql"
  "011_simplify_to_google_docs_flow.sql"
  "012_add_html_content_column.sql"
  "013_fix_trigger_for_google_docs_flow.sql"
  "014_make_s3_key_nullable.sql"
  "04_add_change_notifications.sql"
  "05_add_s3_cleanup_on_delete.sql"
  "06_preserve_task_history.sql"
  "07_add_user_id_to_results_and_history.sql"
  "015_add_project_folders.sql"
  "016_add_credits_system.sql"
)

for file in "${migrations[@]}"; do
  if [ -f "$file" ]; then
    echo "Applying $file..."
    /opt/homebrew/opt/postgresql@16/bin/psql -U ocr_platform_user -d ocr_platform_dev -f "$file"
  else
    echo "Warning: $file not found, skipping..."
  fi
done

echo "All migrations applied!"
