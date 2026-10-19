-- Lease, checkpoints and backoff for upgrading a workspace from its recorded seed_version
-- to the current platform seed (BaselineUpgrader). seed_version itself is bumped only when
-- the upgrade finishes.
ALTER TABLE eg_pgr_onboarding_workspace
    ADD COLUMN upgrade_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN upgrade_lease_token uuid,
    ADD COLUMN upgrade_lease_expires_at bigint,
    ADD COLUMN upgrade_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN upgrade_next_attempt_at bigint,
    ADD COLUMN upgrade_error_code varchar(128);
