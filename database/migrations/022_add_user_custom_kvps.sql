-- Migration: Add user custom KVPs table
-- Purpose: Store custom fields created by users (independent of presets)
-- Created: 2025-12-20

-- Create table for user custom KVPs
CREATE TABLE IF NOT EXISTS user_custom_kvps (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  custom_key_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Ensure unique custom field names per user
  UNIQUE(user_id, custom_key_name)
);

-- Create indexes for performance
CREATE INDEX idx_user_custom_kvps_user_id ON user_custom_kvps(user_id);
CREATE INDEX idx_user_custom_kvps_created_at ON user_custom_kvps(created_at);

-- Grant permissions to application user
GRANT ALL PRIVILEGES ON TABLE user_custom_kvps TO ocr_platform_user;
GRANT USAGE, SELECT ON SEQUENCE user_custom_kvps_id_seq TO ocr_platform_user;

-- Add updated_at trigger
CREATE TRIGGER update_user_custom_kvps_updated_at
  BEFORE UPDATE ON user_custom_kvps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE user_custom_kvps IS 'Stores custom KVP fields created by users (independent of presets)';
COMMENT ON COLUMN user_custom_kvps.custom_key_name IS 'The custom field name entered by the user';
