CREATE TABLE eg_pgr_onboarding_workspace (
    tenant_id varchar(256) PRIMARY KEY,
    status varchar(16) NOT NULL CHECK (status IN ('NOT_STARTED','IN_PROGRESS','DONE')),
    steps jsonb NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    seed_version varchar(32),
    updated_at bigint,
    updated_by varchar(128)
);
CREATE TABLE eg_pgr_onboarding_workspace_event (
    id uuid PRIMARY KEY,
    tenant_id varchar(256) NOT NULL REFERENCES eg_pgr_onboarding_workspace(tenant_id),
    event_type varchar(32) NOT NULL,
    version bigint NOT NULL,
    details jsonb NOT NULL,
    created_at bigint NOT NULL,
    created_by varchar(128) NOT NULL
);
CREATE TABLE eg_pgr_onboarding_workspace_rename (
    id uuid PRIMARY KEY,
    tenant_id varchar(256) NOT NULL REFERENCES eg_pgr_onboarding_workspace(tenant_id),
    name varchar(200) NOT NULL,
    normalized_name varchar(200) NOT NULL,
    old_normalized_name varchar(200) NOT NULL,
    request_version bigint NOT NULL,
    version bigint NOT NULL,
    status varchar(16) NOT NULL CHECK (status IN ('PENDING','DONE')),
    languages jsonb NOT NULL,
    progress jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at bigint NOT NULL,
    updated_by varchar(128) NOT NULL,
    next_attempt_at bigint NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    last_error_code varchar(128),
    UNIQUE (tenant_id, request_version)
);
CREATE UNIQUE INDEX uq_pgr_workspace_pending_rename ON eg_pgr_onboarding_workspace_rename(tenant_id) WHERE status = 'PENDING';
CREATE TABLE eg_pgr_onboarding_workspace_name (
    normalized_name varchar(200) PRIMARY KEY,
    tenant_id varchar(256) NOT NULL
);
INSERT INTO eg_pgr_onboarding_workspace_name(normalized_name,tenant_id)
SELECT normalized_value, signup.requested_tenant_id
FROM eg_pgr_onboarding_identifier identifier JOIN eg_pgr_onboarding_signup signup ON signup.id = identifier.signup_id
WHERE identifier.identifier_type = 'ORGANIZATION_NAME' AND identifier.status <> 'RELEASED' AND signup.requested_tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;
