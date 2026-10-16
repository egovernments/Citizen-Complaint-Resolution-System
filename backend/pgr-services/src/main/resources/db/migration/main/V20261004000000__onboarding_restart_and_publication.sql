ALTER TABLE eg_pgr_onboarding_signup
    ADD COLUMN founder_name varchar(256),
    ADD COLUMN founder_email varchar(256),
    ADD COLUMN founder_email_verified boolean NOT NULL DEFAULT false;

ALTER TABLE eg_pgr_onboarding_operation
    ADD COLUMN organization_ensure_started boolean NOT NULL DEFAULT false,
    ADD COLUMN lifecycle_publication_reason varchar(64),
    ADD COLUMN restart_no integer NOT NULL DEFAULT 0 CHECK (restart_no >= 0),
    ADD COLUMN record_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN founder_digit_uuid varchar(128),
    ADD COLUMN lifecycle_decision varchar(16) CHECK (lifecycle_decision IN ('ACTIVE', 'FAILED')),
    ADD COLUMN lifecycle_restart_no integer,
    ADD COLUMN lifecycle_decided_at bigint,
    ADD COLUMN lifecycle_published_at bigint,
    ADD COLUMN lifecycle_next_publish_at bigint,
    ADD COLUMN lifecycle_publish_attempts integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_pgr_lifecycle_restart CHECK
        (lifecycle_restart_no IS NULL OR lifecycle_restart_no = restart_no),
    ADD CONSTRAINT ck_pgr_lifecycle_published CHECK
        (lifecycle_published_at IS NULL OR lifecycle_decision IS NOT NULL);

CREATE INDEX idx_pgr_onboarding_unpublished ON eg_pgr_onboarding_operation(lifecycle_next_publish_at)
    WHERE lifecycle_decision IS NOT NULL AND lifecycle_published_at IS NULL;
