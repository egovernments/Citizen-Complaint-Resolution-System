CREATE TABLE config_entry (
    id                 VARCHAR(64) PRIMARY KEY,
    config_code        VARCHAR(128) NOT NULL,
    module             VARCHAR(128),
    event_type         VARCHAR(128),
    channel            VARCHAR(64),
    tenant_id          VARCHAR(256) NOT NULL,
    locale             VARCHAR(16),
    enabled            BOOLEAN DEFAULT TRUE,
    "value"            TEXT NOT NULL,
    revision           INT DEFAULT 1,
    created_by         VARCHAR(64),
    created_time       BIGINT,
    last_modified_by   VARCHAR(64),
    last_modified_time BIGINT,
    CONSTRAINT uq_config_entry UNIQUE (tenant_id, config_code, module, event_type, channel)
);

CREATE INDEX idx_config_entry_config_code ON config_entry (config_code);
CREATE INDEX idx_config_entry_tenant_id ON config_entry (tenant_id);
CREATE INDEX idx_config_entry_module ON config_entry (module);
CREATE INDEX idx_config_entry_event_type ON config_entry (event_type);
CREATE INDEX idx_config_entry_channel ON config_entry (channel);
