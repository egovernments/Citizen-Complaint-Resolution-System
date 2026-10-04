ALTER TABLE eg_pgr_onboarding_operation
    ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    ADD COLUMN next_retry_at bigint;
-- Existing retryable attempts resume automatically once after upgrade.
UPDATE eg_pgr_onboarding_operation SET next_retry_at = updated_at WHERE status = 'RETRYABLE_FAILED';
CREATE INDEX idx_pgr_onboarding_retry_due ON eg_pgr_onboarding_operation(next_retry_at)
    WHERE status = 'RETRYABLE_FAILED' AND retry_count < 12;
