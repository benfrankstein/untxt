-- =============================================
-- CREDITS SYSTEM MIGRATION
-- Migration: 016
-- Description: Add credits-based payment system with Stripe integration
-- HIPAA Compliant: Full audit trail for all credit transactions
-- =============================================

-- =============================================
-- STEP 1: Add credits_balance to users table
-- =============================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS credits_balance INTEGER DEFAULT 10 NOT NULL;

ALTER TABLE users
ADD CONSTRAINT non_negative_credits CHECK (credits_balance >= 0);

CREATE INDEX IF NOT EXISTS idx_users_credits ON users(credits_balance);

COMMENT ON COLUMN users.credits_balance IS 'Current credit balance - 1 credit = 1 page processed. New users start with 10 free credits.';

-- =============================================
-- STEP 2: Create ENUM types for credit transactions
-- =============================================

DO $$ BEGIN
    CREATE TYPE credit_transaction_type AS ENUM (
        'initial_grant',      -- First-time user bonus (10 free credits)
        'purchase',           -- Stripe payment completed
        'deduction',          -- Page upload (deduct credits)
        'refund',             -- Failed task refund
        'admin_adjustment',   -- Manual admin correction
        'promotional'         -- Promo codes/bonuses
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE credit_transaction_status AS ENUM (
        'pending',            -- Payment processing
        'completed',          -- Successfully applied
        'failed',             -- Payment failed
        'refunded',           -- Refunded to user
        'cancelled'           -- Cancelled before completion
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================
-- STEP 3: Create credit_transactions table (HIPAA audit log)
-- =============================================

CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Transaction details
    type credit_transaction_type NOT NULL,
    status credit_transaction_status DEFAULT 'pending',
    amount INTEGER NOT NULL, -- Credits (positive = added, negative = deducted)
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,

    -- Related entities
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL, -- If related to task
    payment_intent_id VARCHAR(255), -- Stripe PaymentIntent ID

    -- Metadata
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}', -- Additional context (pricing, package name, etc)

    -- HIPAA Audit fields (mandatory)
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_amount CHECK (amount != 0),
    CONSTRAINT valid_balance_calculation CHECK (balance_before + amount = balance_after)
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_status ON credit_transactions(status);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_payment_intent ON credit_transactions(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_task_id ON credit_transactions(task_id);

COMMENT ON TABLE credit_transactions IS 'Immutable audit log of all credit changes (HIPAA compliant). Records are NEVER deleted.';
COMMENT ON COLUMN credit_transactions.amount IS 'Positive = credits added, Negative = credits deducted';
COMMENT ON COLUMN credit_transactions.balance_before IS 'User balance before this transaction';
COMMENT ON COLUMN credit_transactions.balance_after IS 'User balance after this transaction';

-- =============================================
-- STEP 4: Create payment_records table
-- =============================================

CREATE TABLE IF NOT EXISTS payment_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_id UUID NOT NULL REFERENCES credit_transactions(id) ON DELETE CASCADE,

    -- Stripe details (NO credit card data stored - PCI compliant)
    stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
    stripe_customer_id VARCHAR(255),
    stripe_session_id VARCHAR(255),

    -- Payment details
    amount_usd DECIMAL(10,2) NOT NULL, -- Amount in USD
    credits_purchased INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'usd',

    -- Status
    payment_status VARCHAR(50) NOT NULL, -- succeeded, pending, failed, refunded

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP WITH TIME ZONE,

    -- HIPAA Audit
    ip_address INET,
    user_agent TEXT,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    CONSTRAINT positive_amount CHECK (amount_usd > 0),
    CONSTRAINT positive_credits CHECK (credits_purchased > 0)
);

CREATE INDEX IF NOT EXISTS idx_payment_records_user_id ON payment_records(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_stripe_pi ON payment_records(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_status ON payment_records(payment_status);
CREATE INDEX IF NOT EXISTS idx_payment_records_created_at ON payment_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_records_transaction_id ON payment_records(transaction_id);

COMMENT ON TABLE payment_records IS 'Stripe payment tracking with full audit trail. NO credit card data stored (PCI compliant).';

-- =============================================
-- STEP 5: Create credit_packages table
-- =============================================

CREATE TABLE IF NOT EXISTS credit_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    credits INTEGER NOT NULL,
    price_usd DECIMAL(10,2) NOT NULL,
    savings_percentage INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT positive_credits_package CHECK (credits > 0),
    CONSTRAINT positive_price CHECK (price_usd > 0),
    CONSTRAINT valid_savings CHECK (savings_percentage >= 0 AND savings_percentage <= 100)
);

CREATE INDEX IF NOT EXISTS idx_credit_packages_active ON credit_packages(is_active, sort_order);

COMMENT ON TABLE credit_packages IS 'Available credit purchase packages with pricing tiers';

-- =============================================
-- STEP 6: Insert default credit packages
-- =============================================

INSERT INTO credit_packages (name, credits, price_usd, savings_percentage, sort_order, description)
VALUES
    ('Starter Pack', 10, 10.00, 0, 1, 'Perfect for trying out the service'),
    ('Basic Pack', 50, 45.00, 10, 2, 'Best for occasional users'),
    ('Pro Pack', 100, 80.00, 20, 3, 'Most popular - great value'),
    ('Business Pack', 500, 350.00, 30, 4, 'For high-volume processing')
ON CONFLICT DO NOTHING;

-- =============================================
-- STEP 7: Add credit-related columns to tasks
-- =============================================

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS pages_processed INTEGER;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_tasks_credits_used ON tasks(credits_used);

COMMENT ON COLUMN tasks.pages_processed IS 'Actual number of pages processed (for accurate credit calculation)';
COMMENT ON COLUMN tasks.credits_used IS 'Number of credits deducted for this task (1 credit per page)';

-- =============================================
-- STEP 8: Create function to grant initial credits
-- =============================================

CREATE OR REPLACE FUNCTION grant_initial_credits()
RETURNS TRIGGER AS $$
BEGIN
    -- Grant 10 free credits to new users
    -- Also create audit transaction record
    INSERT INTO credit_transactions (
        user_id,
        type,
        status,
        amount,
        balance_before,
        balance_after,
        description,
        metadata
    ) VALUES (
        NEW.id,
        'initial_grant',
        'completed',
        10,
        0,
        10,
        'Welcome bonus - 10 free credits',
        jsonb_build_object('reason', 'new_user_signup')
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- STEP 9: Create trigger for initial credits
-- =============================================

DROP TRIGGER IF EXISTS grant_initial_credits_trigger ON users;

CREATE TRIGGER grant_initial_credits_trigger
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION grant_initial_credits();

-- =============================================
-- STEP 10: Create view for user credit statistics
-- =============================================

CREATE OR REPLACE VIEW user_credit_stats AS
SELECT
    u.id AS user_id,
    u.username,
    u.email,
    u.credits_balance AS current_balance,
    COUNT(DISTINCT CASE WHEN ct.type = 'purchase' THEN ct.id END) AS total_purchases,
    COALESCE(SUM(CASE WHEN ct.type = 'purchase' AND ct.status = 'completed' THEN ct.amount ELSE 0 END), 0) AS total_credits_purchased,
    COALESCE(SUM(CASE WHEN ct.type = 'deduction' THEN ABS(ct.amount) ELSE 0 END), 0) AS total_credits_used,
    COALESCE(SUM(CASE WHEN ct.type = 'refund' THEN ct.amount ELSE 0 END), 0) AS total_credits_refunded,
    COUNT(DISTINCT CASE WHEN ct.type = 'deduction' THEN ct.task_id END) AS total_tasks_processed,
    MAX(CASE WHEN ct.type = 'purchase' THEN ct.created_at END) AS last_purchase_date,
    MAX(CASE WHEN ct.type = 'deduction' THEN ct.created_at END) AS last_usage_date
FROM users u
LEFT JOIN credit_transactions ct ON u.id = ct.user_id
GROUP BY u.id, u.username, u.email, u.credits_balance;

COMMENT ON VIEW user_credit_stats IS 'Summary statistics of user credit usage and purchases';

-- =============================================
-- STEP 11: Create function to validate sufficient credits
-- =============================================

CREATE OR REPLACE FUNCTION has_sufficient_credits(
    p_user_id UUID,
    p_required_credits INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT credits_balance INTO v_balance
    FROM users
    WHERE id = p_user_id;

    RETURN v_balance >= p_required_credits;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION has_sufficient_credits IS 'Check if user has enough credits before processing';

-- =============================================
-- STEP 12: Create function to safely deduct credits
-- =============================================

CREATE OR REPLACE FUNCTION deduct_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_task_id UUID,
    p_description TEXT,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_balance_before INTEGER;
    v_balance_after INTEGER;
    v_transaction_id UUID;
BEGIN
    -- Lock the user row to prevent race conditions
    SELECT credits_balance INTO v_balance_before
    FROM users
    WHERE id = p_user_id
    FOR UPDATE;

    -- Check sufficient credits
    IF v_balance_before < p_amount THEN
        RAISE EXCEPTION 'Insufficient credits: has %, needs %', v_balance_before, p_amount;
    END IF;

    -- Calculate new balance
    v_balance_after := v_balance_before - p_amount;

    -- Update user balance
    UPDATE users
    SET credits_balance = v_balance_after
    WHERE id = p_user_id;

    -- Create transaction record
    INSERT INTO credit_transactions (
        user_id,
        type,
        status,
        amount,
        balance_before,
        balance_after,
        task_id,
        description,
        ip_address,
        user_agent
    ) VALUES (
        p_user_id,
        'deduction',
        'completed',
        -p_amount, -- Negative for deduction
        v_balance_before,
        v_balance_after,
        p_task_id,
        p_description,
        p_ip_address,
        p_user_agent
    ) RETURNING id INTO v_transaction_id;

    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION deduct_credits IS 'Safely deduct credits with row-level locking to prevent race conditions';

-- =============================================
-- STEP 13: Create function to refund credits
-- =============================================

CREATE OR REPLACE FUNCTION refund_credits(
    p_user_id UUID,
    p_amount INTEGER,
    p_task_id UUID,
    p_reason TEXT,
    p_ip_address INET DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_balance_before INTEGER;
    v_balance_after INTEGER;
    v_transaction_id UUID;
BEGIN
    -- Lock the user row
    SELECT credits_balance INTO v_balance_before
    FROM users
    WHERE id = p_user_id
    FOR UPDATE;

    -- Calculate new balance
    v_balance_after := v_balance_before + p_amount;

    -- Update user balance
    UPDATE users
    SET credits_balance = v_balance_after
    WHERE id = p_user_id;

    -- Create transaction record
    INSERT INTO credit_transactions (
        user_id,
        type,
        status,
        amount,
        balance_before,
        balance_after,
        task_id,
        description,
        ip_address
    ) VALUES (
        p_user_id,
        'refund',
        'completed',
        p_amount, -- Positive for refund
        v_balance_before,
        v_balance_after,
        p_task_id,
        p_reason,
        p_ip_address
    ) RETURNING id INTO v_transaction_id;

    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refund_credits IS 'Refund credits to user (e.g., when task fails)';

-- =============================================
-- STEP 14: Grant permissions (if needed)
-- =============================================

-- Grant access to new tables for your application user
-- Uncomment and modify if you have a specific application database user

-- GRANT SELECT, INSERT, UPDATE ON credit_transactions TO your_app_user;
-- GRANT SELECT, INSERT, UPDATE ON payment_records TO your_app_user;
-- GRANT SELECT ON credit_packages TO your_app_user;
-- GRANT SELECT ON user_credit_stats TO your_app_user;

-- =============================================
-- Migration Complete
-- =============================================

-- Verify migration
DO $$
BEGIN
    RAISE NOTICE '✓ Migration 016 completed successfully';
    RAISE NOTICE '✓ Credits system tables created';
    RAISE NOTICE '✓ Initial credit packages inserted';
    RAISE NOTICE '✓ Triggers and functions created';
    RAISE NOTICE '✓ New users will automatically receive 10 free credits';
END $$;
