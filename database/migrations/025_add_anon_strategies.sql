-- Migration 025: Add Anonymization Strategies
-- Creates table for anonymization strategies (redact, synthetic, generalize, mask)

CREATE TABLE IF NOT EXISTS anon_strategies (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  color VARCHAR(20),
  recommended BOOLEAN DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_anon_strategies_display_order ON anon_strategies(display_order);
CREATE INDEX idx_anon_strategies_recommended ON anon_strategies(recommended);

-- Seed with initial strategies
INSERT INTO anon_strategies (id, name, description, icon, color, recommended, display_order) VALUES
  (
    'synthetic',
    'Synthetic',
    'Replace with realistic fake data using Faker library. Best for maintaining document structure while ensuring privacy.',
    '🎭',
    '#4CAF50',
    TRUE,
    1
  ),
  (
    'redact',
    'Redact',
    'Replace with [REDACTED] markers. Most restrictive option, leaves obvious placeholders.',
    '⬛',
    '#F44336',
    FALSE,
    2
  ),
  (
    'generalize',
    'Generalize',
    'Reduce precision for k-anonymity style protection. DOB→Year, ZIP→3-digit, etc.',
    '📊',
    '#FF9800',
    FALSE,
    3
  ),
  (
    'mask',
    'Mask',
    'Partial masking showing last few characters. SSN: ***-**-1234, Email: ***@domain.com',
    '👁️',
    '#2196F3',
    FALSE,
    4
  )
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE anon_strategies IS 'Available anonymization strategies for PII replacement';
COMMENT ON COLUMN anon_strategies.id IS 'Strategy identifier (synthetic, redact, generalize, mask)';
COMMENT ON COLUMN anon_strategies.recommended IS 'Whether this strategy is recommended by default';
