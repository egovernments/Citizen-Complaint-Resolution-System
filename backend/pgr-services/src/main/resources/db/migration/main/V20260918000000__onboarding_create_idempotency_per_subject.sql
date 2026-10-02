-- Two tenant admins under the same issuer (one Keycloak realm) that send the same
-- Idempotency-Key collided: the second create failed on an index it had no part in.
-- The key is only ever meaningful within one owner, so scope it to the subject too.
DROP INDEX IF EXISTS uq_pgr_onboarding_create_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pgr_onboarding_create_idempotency
    ON eg_pgr_onboarding_signup (owner_issuer, owner_subject, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
