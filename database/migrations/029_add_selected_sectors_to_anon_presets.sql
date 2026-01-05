-- Migration 029: Add selected_sectors to anon_presets
-- Stores which sectors were selected when the preset was saved
-- This allows proper reconstruction of the UI state

ALTER TABLE anon_presets
ADD COLUMN IF NOT EXISTS selected_sectors JSONB DEFAULT '[]';

COMMENT ON COLUMN anon_presets.selected_sectors IS 'Array of sector IDs that were selected for this preset';
