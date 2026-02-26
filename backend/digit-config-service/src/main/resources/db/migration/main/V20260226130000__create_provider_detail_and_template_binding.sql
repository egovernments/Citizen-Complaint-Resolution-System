-- Provider detail table
CREATE TABLE provider_detail (
    id                 VARCHAR(64) PRIMARY KEY,
    provider_name      VARCHAR(128) NOT NULL,
    channel            VARCHAR(64),
    tenant_id          VARCHAR(256) NOT NULL,
    enabled            BOOLEAN DEFAULT TRUE,
    "value"            TEXT NOT NULL,
    created_by         VARCHAR(64),
    created_time       BIGINT,
    last_modified_by   VARCHAR(64),
    last_modified_time BIGINT,
    CONSTRAINT uq_provider_detail UNIQUE (tenant_id, provider_name, channel)
);

CREATE INDEX idx_provider_detail_tenant_id ON provider_detail (tenant_id);
CREATE INDEX idx_provider_detail_provider_name ON provider_detail (provider_name);
CREATE INDEX idx_provider_detail_channel ON provider_detail (channel);

-- Template binding table
CREATE TABLE template_binding (
    id                 VARCHAR(64) PRIMARY KEY,
    template_id        VARCHAR(128) NOT NULL,
    provider_id        VARCHAR(64) NOT NULL,
    event_name         VARCHAR(256) NOT NULL,
    content_sid        VARCHAR(128),
    locale             VARCHAR(16),
    tenant_id          VARCHAR(256) NOT NULL,
    enabled            BOOLEAN DEFAULT TRUE,
    created_by         VARCHAR(64),
    created_time       BIGINT,
    last_modified_by   VARCHAR(64),
    last_modified_time BIGINT,
    CONSTRAINT uq_template_binding UNIQUE (event_name, tenant_id),
    CONSTRAINT fk_template_binding_provider FOREIGN KEY (provider_id) REFERENCES provider_detail (id)
);

CREATE INDEX idx_template_binding_tenant_id ON template_binding (tenant_id);
CREATE INDEX idx_template_binding_event_name ON template_binding (event_name);
CREATE INDEX idx_template_binding_provider_id ON template_binding (provider_id);
