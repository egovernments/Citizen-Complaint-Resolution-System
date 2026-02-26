-- H2-compatible schema for tests

CREATE TABLE IF NOT EXISTS config_entry (
    id VARCHAR(64) PRIMARY KEY,
    config_code VARCHAR(128) NOT NULL,
    module VARCHAR(128),
    channel VARCHAR(64),
    tenant_id VARCHAR(256) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    "value" TEXT,
    revision INTEGER DEFAULT 1,
    created_by VARCHAR(64),
    created_time BIGINT,
    last_modified_by VARCHAR(64),
    last_modified_time BIGINT,
    CONSTRAINT uq_config_entry UNIQUE (tenant_id, config_code, module, channel)
);

CREATE TABLE IF NOT EXISTS provider_detail (
    id VARCHAR(64) PRIMARY KEY,
    provider_name VARCHAR(128) NOT NULL,
    channel VARCHAR(64),
    tenant_id VARCHAR(256) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    "value" TEXT NOT NULL,
    created_by VARCHAR(64),
    created_time BIGINT,
    last_modified_by VARCHAR(64),
    last_modified_time BIGINT,
    CONSTRAINT uq_provider_detail UNIQUE (tenant_id, provider_name, channel)
);

CREATE TABLE IF NOT EXISTS template_binding (
    id VARCHAR(64) PRIMARY KEY,
    template_id VARCHAR(128) NOT NULL,
    provider_id VARCHAR(64) NOT NULL,
    event_name VARCHAR(256) NOT NULL,
    content_sid VARCHAR(128),
    locale VARCHAR(16),
    param_order TEXT,
    required_vars TEXT,
    tenant_id VARCHAR(256) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(64),
    created_time BIGINT,
    last_modified_by VARCHAR(64),
    last_modified_time BIGINT,
    CONSTRAINT uq_template_binding UNIQUE (event_name, tenant_id),
    CONSTRAINT fk_template_binding_provider FOREIGN KEY (provider_id) REFERENCES provider_detail (id)
);
