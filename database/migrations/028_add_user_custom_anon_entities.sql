-- Migration: Add user custom anonymization entities table
-- Similar to user_custom_kvps for KVP extraction

CREATE TABLE IF NOT EXISTS user_custom_anon_entities (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  custom_entity_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, custom_entity_name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_custom_anon_entities_user_id ON user_custom_anon_entities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_custom_anon_entities_created_at ON user_custom_anon_entities(created_at);

-- Trigger for updated_at
CREATE TRIGGER update_user_custom_anon_entities_updated_at
  BEFORE UPDATE ON user_custom_anon_entities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON user_custom_anon_entities TO ocr_platform_user;
GRANT USAGE, SELECT ON SEQUENCE user_custom_anon_entities_id_seq TO ocr_platform_user;

COMMENT ON TABLE user_custom_anon_entities IS 'User-defined custom entities for anonymization';
COMMENT ON COLUMN user_custom_anon_entities.custom_entity_name IS 'Name of the custom PII entity to anonymize';
