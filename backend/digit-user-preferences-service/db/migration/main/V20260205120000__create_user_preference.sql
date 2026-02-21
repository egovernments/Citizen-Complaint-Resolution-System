-- Migration: Create user_preference table
-- Description: Creates the main table for storing user preferences including
--              notification consent and language settings.

-- Create the table
CREATE TABLE IF NOT EXISTS user_preference (
    id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64),
    preference_code VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_by VARCHAR(64) NOT NULL,
    created_time BIGINT NOT NULL,
    last_modified_by VARCHAR(64) NOT NULL,
    last_modified_time BIGINT NOT NULL
);

-- Create unique constraint on (user_id, tenant_id, preference_code)
-- This ensures one preference record per user per code per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_preference_unique
    ON user_preference (user_id, COALESCE(tenant_id, ''), preference_code);

-- Index for user_id lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_user_preference_user_id
    ON user_preference (user_id);

-- Index for tenant_id lookups (for tenant-wide queries)
CREATE INDEX IF NOT EXISTS idx_user_preference_tenant_id
    ON user_preference (tenant_id)
    WHERE tenant_id IS NOT NULL;

-- Index for preference_code lookups
CREATE INDEX IF NOT EXISTS idx_user_preference_code
    ON user_preference (preference_code);

-- Composite index for common search patterns
CREATE INDEX IF NOT EXISTS idx_user_preference_user_tenant
    ON user_preference (user_id, tenant_id);

-- Index on created_time for ordering
CREATE INDEX IF NOT EXISTS idx_user_preference_created_time
    ON user_preference (created_time DESC);

-- GIN index on payload for JSONB queries (optional, for consent queries)
CREATE INDEX IF NOT EXISTS idx_user_preference_payload_gin
    ON user_preference USING GIN (payload jsonb_path_ops);

-- Add comments for documentation
COMMENT ON TABLE user_preference IS 'Stores user preferences including notification consent and language settings';
COMMENT ON COLUMN user_preference.id IS 'Unique identifier (UUID)';
COMMENT ON COLUMN user_preference.user_id IS 'User identifier from DIGIT user service';
COMMENT ON COLUMN user_preference.tenant_id IS 'Tenant identifier for tenant-scoped preferences (nullable for global)';
COMMENT ON COLUMN user_preference.preference_code IS 'Preference type namespace (e.g., USER_NOTIFICATION_PREFERENCES)';
COMMENT ON COLUMN user_preference.payload IS 'JSONB payload containing preference data (language, consent, etc.)';
COMMENT ON COLUMN user_preference.created_by IS 'User ID who created the record';
COMMENT ON COLUMN user_preference.created_time IS 'Unix timestamp in milliseconds when record was created';
COMMENT ON COLUMN user_preference.last_modified_by IS 'User ID who last modified the record';
COMMENT ON COLUMN user_preference.last_modified_time IS 'Unix timestamp in milliseconds when record was last modified';
