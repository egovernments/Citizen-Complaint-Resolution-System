-- Worker lease for PENDING onboarding operations. A worker claims one row, owns
-- it until lease_expires_at, and must present lease_token to complete or fail it.
ALTER TABLE eg_pgr_onboarding_operation ADD COLUMN IF NOT EXISTS lease_owner character varying(128);
ALTER TABLE eg_pgr_onboarding_operation ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE eg_pgr_onboarding_operation ADD COLUMN IF NOT EXISTS lease_expires_at bigint;
