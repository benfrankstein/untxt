-- Migration: Add Password Reset Tokens
-- Implements secure password reset functionality with time-limited tokens

-- Create password_reset_tokens table
CREATE TABLE password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT check_token_not_expired CHECK (expires_at > created_at),
    CONSTRAINT check_used_after_created CHECK (used_at IS NULL OR used_at >= created_at)
);

-- Add indexes for performance
CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- Add index for cleanup queries (finding expired/used tokens)
CREATE INDEX idx_password_reset_tokens_cleanup ON password_reset_tokens(used_at, expires_at);

-- Add comments for documentation
COMMENT ON TABLE password_reset_tokens IS 'Stores time-limited tokens for password reset functionality';
COMMENT ON COLUMN password_reset_tokens.user_id IS 'References the user requesting password reset';
COMMENT ON COLUMN password_reset_tokens.token_hash IS 'Bcrypt hash of the reset token (never store plaintext)';
COMMENT ON COLUMN password_reset_tokens.expires_at IS 'Token expiration timestamp (15 minutes from creation for HIPAA compliance)';
COMMENT ON COLUMN password_reset_tokens.used_at IS 'When token was used (null if unused, prevents reuse)';
COMMENT ON COLUMN password_reset_tokens.ip_address IS 'IP address of the reset request (audit trail)';
COMMENT ON COLUMN password_reset_tokens.user_agent IS 'User agent of the reset request (audit trail)';
COMMENT ON COLUMN password_reset_tokens.created_at IS 'Token creation timestamp';

-- Function to automatically clean up old tokens (optional, for maintenance)
CREATE OR REPLACE FUNCTION cleanup_expired_reset_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM password_reset_tokens
    WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'
       OR used_at < CURRENT_TIMESTAMP - INTERVAL '24 hours';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_reset_tokens() IS 'Cleans up expired/used tokens older than 24 hours';
