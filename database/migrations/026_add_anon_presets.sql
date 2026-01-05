-- Migration 026: Add Anonymization Presets
-- Creates table for user-saved anonymization presets with field selections

CREATE TABLE IF NOT EXISTS anon_presets (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preset_name VARCHAR(100) NOT NULL,
  strategy_id VARCHAR(50) NOT NULL REFERENCES anon_strategies(id) ON DELETE CASCADE,
  generate_audit BOOLEAN DEFAULT FALSE,
  selected_fields JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, preset_name)
);

-- Create indexes
CREATE INDEX idx_anon_presets_user_id ON anon_presets(user_id);
CREATE INDEX idx_anon_presets_strategy_id ON anon_presets(strategy_id);
CREATE INDEX idx_anon_presets_created_at ON anon_presets(created_at DESC);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_anon_presets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER anon_presets_updated_at_trigger
  BEFORE UPDATE ON anon_presets
  FOR EACH ROW
  EXECUTE FUNCTION update_anon_presets_updated_at();

COMMENT ON TABLE anon_presets IS 'User-saved anonymization presets with field selections and strategy';
COMMENT ON COLUMN anon_presets.selected_fields IS 'Array of field objects with key_name or custom_key_name';
COMMENT ON COLUMN anon_presets.strategy_id IS 'Anonymization strategy (synthetic, redact, generalize, mask)';
COMMENT ON COLUMN anon_presets.generate_audit IS 'Whether to generate HIPAA/GDPR compliance audit trail';
