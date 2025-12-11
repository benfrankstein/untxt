-- Migration: Add OAuth Support
-- Allows users to sign in with Google while maintaining local auth

-- Add auth provider enum type
CREATE TYPE auth_provider AS ENUM ('local', 'google');

-- Add OAuth-related columns to users table
ALTER TABLE users
ADD COLUMN auth_provider auth_provider DEFAULT 'local',
ADD COLUMN google_id VARCHAR(255) UNIQUE,
ADD COLUMN linked_providers JSONB DEFAULT '[]';

-- Make password_hash nullable (Google users won't have passwords)
ALTER TABLE users
ALTER COLUMN password_hash DROP NOT NULL;

-- Auto-verify email for Google users (they're already verified by Google)
-- This will be handled in application logic, but we'll add a trigger for safety

-- Add indexes for performance
CREATE INDEX idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
CREATE INDEX idx_users_auth_provider ON users(auth_provider);

-- Add constraints to ensure data integrity
-- If auth_provider is 'local', password_hash must exist
ALTER TABLE users
ADD CONSTRAINT check_local_auth_has_password
CHECK (
    (auth_provider = 'local' AND password_hash IS NOT NULL) OR
    (auth_provider != 'local')
);

-- If auth_provider is 'google', google_id must exist
ALTER TABLE users
ADD CONSTRAINT check_google_auth_has_id
CHECK (
    (auth_provider = 'google' AND google_id IS NOT NULL) OR
    (auth_provider != 'google')
);

-- Update existing users to have 'local' provider (they all have passwords)
UPDATE users
SET auth_provider = 'local'
WHERE auth_provider IS NULL;

-- Add comments for documentation
COMMENT ON COLUMN users.auth_provider IS 'Primary authentication method for the user';
COMMENT ON COLUMN users.google_id IS 'Unique Google account ID for OAuth authentication';
COMMENT ON COLUMN users.linked_providers IS 'Array of linked auth providers (for future multi-provider support)';
