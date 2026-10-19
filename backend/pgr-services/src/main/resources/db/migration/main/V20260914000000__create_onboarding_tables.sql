CREATE TABLE IF NOT EXISTS eg_pgr_onboarding_signup (
    id                      uuid PRIMARY KEY,
    owner_issuer            character varying(512) NOT NULL,
    owner_subject           character varying(128) NOT NULL,
    status                  character varying(32) NOT NULL,
    account_name            character varying(200),
    account_code            character varying(64),
    organization_alias      character varying(63),
    requested_tenant_id     character varying(256),
    url_slug                character varying(63),
    country_code            character varying(2),
    languages               jsonb NOT NULL DEFAULT '[]'::jsonb,
    time_zone               character varying(64),
    financial_year_policy   character varying(32),
    accepted_terms_version  character varying(32),
    tenant_metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key         character varying(128),
    version                 bigint NOT NULL DEFAULT 1,
    created_at              bigint NOT NULL,
    updated_at              bigint NOT NULL,
    CONSTRAINT uq_pgr_onboarding_owner UNIQUE (owner_issuer, owner_subject),
    CONSTRAINT ck_pgr_onboarding_signup_status CHECK
        (status IN ('DRAFT', 'PROVISIONING', 'ACTIVE', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pgr_onboarding_create_idempotency
    ON eg_pgr_onboarding_signup (owner_issuer, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS eg_pgr_onboarding_identifier (
    identifier_type     character varying(32) NOT NULL,
    normalized_value    character varying(256) NOT NULL,
    signup_id           uuid NOT NULL REFERENCES eg_pgr_onboarding_signup(id),
    status              character varying(16) NOT NULL DEFAULT 'RESERVED',
    reserved_at         bigint NOT NULL,
    CONSTRAINT pk_pgr_onboarding_identifier PRIMARY KEY (identifier_type, normalized_value),
    CONSTRAINT ck_pgr_onboarding_identifier_status CHECK
        (status IN ('RESERVED', 'CONSUMED', 'RELEASED'))
);

CREATE INDEX IF NOT EXISTS idx_pgr_onboarding_identifier_signup
    ON eg_pgr_onboarding_identifier (signup_id);

CREATE TABLE IF NOT EXISTS eg_pgr_onboarding_operation (
    id                  uuid PRIMARY KEY,
    signup_id           uuid NOT NULL REFERENCES eg_pgr_onboarding_signup(id),
    status              character varying(32) NOT NULL,
    current_step        character varying(64),
    completed_steps     jsonb NOT NULL DEFAULT '[]'::jsonb,
    error_code          character varying(128),
    error_message       character varying(500),
    attempt             integer NOT NULL DEFAULT 1,
    idempotency_key     character varying(128) NOT NULL,
    created_at          bigint NOT NULL,
    updated_at          bigint NOT NULL,
    CONSTRAINT uq_pgr_onboarding_operation_signup UNIQUE (signup_id),
    CONSTRAINT uq_pgr_onboarding_submit_idempotency UNIQUE (signup_id, idempotency_key),
    CONSTRAINT ck_pgr_onboarding_operation_status CHECK
        (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'RETRYABLE_FAILED', 'TERMINAL_FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_pgr_onboarding_operation_status
    ON eg_pgr_onboarding_operation (status, updated_at);
