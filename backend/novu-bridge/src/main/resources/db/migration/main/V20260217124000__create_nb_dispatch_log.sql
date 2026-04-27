CREATE TABLE IF NOT EXISTS nb_dispatch_log (
    id UUID PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    module VARCHAR(128) NOT NULL,
    event_name VARCHAR(256) NOT NULL,
    tenant_id VARCHAR(256) NOT NULL,
    channel VARCHAR(64) NOT NULL,
    recipient_value VARCHAR(256) NOT NULL,
    template_key VARCHAR(256),
    template_version VARCHAR(64),
    status VARCHAR(32) NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    last_error_code VARCHAR(128),
    last_error_message TEXT,
    provider_response_jsonb JSONB,
    created_time BIGINT NOT NULL,
    last_modified_time BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_nb_dispatch_event_channel
    ON nb_dispatch_log (event_id, channel);

CREATE INDEX IF NOT EXISTS idx_nb_dispatch_status_lmt
    ON nb_dispatch_log (status, last_modified_time);

CREATE INDEX IF NOT EXISTS idx_nb_dispatch_tenant_event
    ON nb_dispatch_log (tenant_id, event_name);
