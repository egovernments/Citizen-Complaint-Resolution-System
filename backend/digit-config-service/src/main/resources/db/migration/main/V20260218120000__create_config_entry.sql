CREATE TABLE config_data (
    id                 VARCHAR(64) PRIMARY KEY,
    config_code        VARCHAR(128) NOT NULL,
    module             VARCHAR(128),
    channel            VARCHAR(64),
    tenant_id          VARCHAR(256) NOT NULL,
    enabled            BOOLEAN DEFAULT TRUE,
    "value"            TEXT NOT NULL,
    revision           INT DEFAULT 1,
    created_by         VARCHAR(64),
    created_time       BIGINT,
    last_modified_by   VARCHAR(64),
    last_modified_time BIGINT,
    CONSTRAINT uq_config_data UNIQUE (tenant_id, config_code, module, channel)
);

CREATE INDEX idx_config_data_config_code ON config_data (config_code);
CREATE INDEX idx_config_data_tenant_id ON config_data (tenant_id);
CREATE INDEX idx_config_data_module ON config_data (module);
CREATE INDEX idx_config_data_channel ON config_data (channel);
CREATE INDEX IF NOT EXISTS idx_config_data_value_gin ON config_data USING gin (CAST("value" AS jsonb));
