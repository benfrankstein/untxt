-- Migration 024: Add Anonymization Sectors
-- Creates table for anonymization sectors (PII categories)
-- Separate from kvp_sectors but will be populated with same initial data

CREATE TABLE IF NOT EXISTS anon_sectors (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  color VARCHAR(20),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_anon_sectors_display_order ON anon_sectors(display_order);

-- Copy sectors from master_kvp_sectors (same list as KVP)
INSERT INTO anon_sectors (id, name, description, icon, color, display_order)
SELECT
  sector_code,
  display_name,
  description,
  '📄', -- Default icon
  '#2196F3', -- Default color
  sort_order
FROM master_kvp_sectors
WHERE is_active = true
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE anon_sectors IS 'Sectors/categories for anonymization field organization';
COMMENT ON COLUMN anon_sectors.id IS 'Unique sector identifier (e.g., healthcare, financial)';
COMMENT ON COLUMN anon_sectors.display_order IS 'Order for displaying sectors in UI';
