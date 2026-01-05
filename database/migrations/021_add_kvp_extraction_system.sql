/**
 * Migration: Add KVP Extraction System
 * Version: 021
 * Description: Creates tables for master KVP list, user presets, and extraction results
 *
 * Tables:
 * - master_kvp_sectors: 23 sector categories (banking, healthcare, etc.)
 * - master_kvps: 824 canonical keys with aliases
 * - user_presets: User-created preset templates
 * - user_preset_kvps: KVPs in each preset (master + custom)
 * - document_extractions: Extraction session metadata
 * - extracted_kvps: Actual extracted key-value pairs
 */

-- ============================================================================
-- 1. MASTER KVP SECTORS (Read-only system data)
-- ============================================================================

CREATE TABLE IF NOT EXISTS master_kvp_sectors (
  id SERIAL PRIMARY KEY,
  sector_code VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  document_types JSONB DEFAULT '[]',
  kvp_count INTEGER DEFAULT 0,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  version VARCHAR(20) DEFAULT '2.0',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_sectors_code ON master_kvp_sectors(sector_code);
CREATE INDEX idx_sectors_active ON master_kvp_sectors(is_active);
CREATE INDEX idx_sectors_sort ON master_kvp_sectors(sort_order);

COMMENT ON TABLE master_kvp_sectors IS 'System-managed KVP sectors (e.g., banking, healthcare, tax)';
COMMENT ON COLUMN master_kvp_sectors.sector_code IS 'Unique code for sector (e.g., "banking_finance")';
COMMENT ON COLUMN master_kvp_sectors.display_name IS 'User-facing name (e.g., "Banking & Finance")';
COMMENT ON COLUMN master_kvp_sectors.kvp_count IS 'Number of KVPs in this sector (denormalized for UI)';

-- ============================================================================
-- 2. MASTER KVPS (Read-only system data with versioning)
-- ============================================================================

CREATE TABLE IF NOT EXISTS master_kvps (
  id SERIAL PRIMARY KEY,
  sector_id INTEGER NOT NULL REFERENCES master_kvp_sectors(id) ON DELETE CASCADE,
  key_name VARCHAR(100) NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]',
  description TEXT,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  version VARCHAR(20) DEFAULT '2.0',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_kvps_sector ON master_kvps(sector_id);
CREATE INDEX idx_kvps_key_name ON master_kvps(key_name);
CREATE INDEX idx_kvps_active ON master_kvps(is_active);
CREATE INDEX idx_kvps_aliases ON master_kvps USING GIN(aliases);
CREATE INDEX idx_kvps_sort ON master_kvps(sort_order);

COMMENT ON TABLE master_kvps IS 'System-managed KVP keys with aliases for extraction prompts';
COMMENT ON COLUMN master_kvps.key_name IS 'Canonical key name shown to user (e.g., "SSN", "Invoice Number")';
COMMENT ON COLUMN master_kvps.aliases IS 'Array of alternate names for extraction (e.g., ["Social Security Number", "SS#"])';
COMMENT ON COLUMN master_kvps.version IS 'Master list version when this key was added/updated';

-- ============================================================================
-- 3. USER PRESETS (User-created templates)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_presets (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preset_name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_user_preset UNIQUE(user_id, preset_name)
);

-- Indexes
CREATE INDEX idx_presets_user ON user_presets(user_id);
CREATE INDEX idx_presets_created ON user_presets(created_at);

COMMENT ON TABLE user_presets IS 'User-saved KVP extraction templates';
COMMENT ON COLUMN user_presets.preset_name IS 'User-defined name for preset (e.g., "My W2 Extraction")';

-- ============================================================================
-- 4. USER PRESET KVPS (Junction table for preset contents)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_preset_kvps (
  id SERIAL PRIMARY KEY,
  preset_id INTEGER NOT NULL REFERENCES user_presets(id) ON DELETE CASCADE,

  -- Either reference master KVP OR custom field (not both)
  master_kvp_id INTEGER REFERENCES master_kvps(id) ON DELETE CASCADE,
  custom_key_name VARCHAR(100),

  sort_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Ensure exactly one source is populated
  CONSTRAINT check_kvp_source CHECK (
    (master_kvp_id IS NOT NULL AND custom_key_name IS NULL) OR
    (master_kvp_id IS NULL AND custom_key_name IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX idx_preset_kvps_preset ON user_preset_kvps(preset_id);
CREATE INDEX idx_preset_kvps_master ON user_preset_kvps(master_kvp_id);
CREATE INDEX idx_preset_kvps_sort ON user_preset_kvps(sort_order);

COMMENT ON TABLE user_preset_kvps IS 'KVPs included in each preset (master or custom)';
COMMENT ON COLUMN user_preset_kvps.master_kvp_id IS 'Reference to master KVP (NULL if custom field)';
COMMENT ON COLUMN user_preset_kvps.custom_key_name IS 'Custom field name (NULL if master KVP)';

-- ============================================================================
-- 5. DOCUMENT EXTRACTIONS (Extraction session metadata)
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_extractions (
  id SERIAL PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preset_id INTEGER REFERENCES user_presets(id) ON DELETE SET NULL,

  -- Track which sectors were selected for this extraction
  sector_ids JSONB DEFAULT '[]',

  -- Extraction status and statistics
  extraction_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- Values: 'pending', 'processing', 'completed', 'failed'

  total_kvps_requested INTEGER,
  total_kvps_extracted INTEGER,
  processing_time_ms INTEGER,

  -- Error tracking
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT check_extraction_status CHECK (
    extraction_status IN ('pending', 'processing', 'completed', 'failed')
  )
);

-- Indexes
CREATE INDEX idx_extractions_file ON document_extractions(file_id);
CREATE INDEX idx_extractions_user ON document_extractions(user_id);
CREATE INDEX idx_extractions_preset ON document_extractions(preset_id);
CREATE INDEX idx_extractions_status ON document_extractions(extraction_status);
CREATE INDEX idx_extractions_created ON document_extractions(created_at);

COMMENT ON TABLE document_extractions IS 'Extraction session metadata (which KVPs were requested)';
COMMENT ON COLUMN document_extractions.sector_ids IS 'Array of sector IDs selected for extraction';
COMMENT ON COLUMN document_extractions.preset_id IS 'Preset used (NULL if ad-hoc selection)';

-- ============================================================================
-- 6. EXTRACTED KVPS (Actual extracted values)
-- ============================================================================

CREATE TABLE IF NOT EXISTS extracted_kvps (
  id SERIAL PRIMARY KEY,
  extraction_id INTEGER NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,

  -- The key-value pair
  kvp_key VARCHAR(100) NOT NULL,
  kvp_value TEXT,

  -- Source tracking
  source_type VARCHAR(20) NOT NULL,
  -- Values: 'master' (from master_kvps), 'custom' (user-defined)
  master_kvp_id INTEGER REFERENCES master_kvps(id) ON DELETE SET NULL,

  -- Optional: Document location for future features
  page_number INTEGER,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT check_source_type CHECK (source_type IN ('master', 'custom'))
);

-- Indexes
CREATE INDEX idx_extracted_kvps_extraction ON extracted_kvps(extraction_id);
CREATE INDEX idx_extracted_kvps_key ON extracted_kvps(kvp_key);
CREATE INDEX idx_extracted_kvps_master ON extracted_kvps(master_kvp_id);
CREATE INDEX idx_extracted_kvps_page ON extracted_kvps(page_number);

COMMENT ON TABLE extracted_kvps IS 'Actual extracted key-value pairs from documents';
COMMENT ON COLUMN extracted_kvps.kvp_key IS 'Key name (e.g., "SSN", "Invoice Number")';
COMMENT ON COLUMN extracted_kvps.kvp_value IS 'Extracted value (e.g., "123-45-6789")';
COMMENT ON COLUMN extracted_kvps.source_type IS 'Whether from master list or custom field';

-- ============================================================================
-- AUDIT TRAIL INTEGRATION
-- ============================================================================

-- Add audit logging for KVP operations
COMMENT ON TABLE document_extractions IS 'HIPAA: Tracks who extracted what KVPs and when';
COMMENT ON TABLE extracted_kvps IS 'HIPAA: Stores extracted PHI values (encrypt in production)';

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ Migration 021: KVP Extraction System tables created successfully';
  RAISE NOTICE '  - master_kvp_sectors (sector categories)';
  RAISE NOTICE '  - master_kvps (824 canonical keys)';
  RAISE NOTICE '  - user_presets (user-created templates)';
  RAISE NOTICE '  - user_preset_kvps (preset contents)';
  RAISE NOTICE '  - document_extractions (extraction sessions)';
  RAISE NOTICE '  - extracted_kvps (extracted values)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next step: Run seed script to populate master_kvp_sectors and master_kvps';
END $$;
