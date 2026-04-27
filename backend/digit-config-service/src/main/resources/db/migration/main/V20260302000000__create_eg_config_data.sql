CREATE TABLE eg_config_data (
    id                  VARCHAR(64) NOT NULL,
    tenantid            VARCHAR(255) NOT NULL,
    uniqueidentifier    VARCHAR(255),
    schemacode          VARCHAR(255) NOT NULL,
    data                JSONB NOT NULL,
    isactive            BOOLEAN NOT NULL DEFAULT TRUE,
    createdby           VARCHAR(64),
    lastmodifiedby      VARCHAR(64),
    createdtime         BIGINT,
    lastmodifiedtime    BIGINT,
    CONSTRAINT pk_eg_config_data PRIMARY KEY (tenantid, schemacode, uniqueidentifier),
    CONSTRAINT uk_eg_config_data UNIQUE (id)
);

CREATE INDEX idx_eg_config_data_schemacode ON eg_config_data (schemacode);
CREATE INDEX idx_eg_config_data_tenantid ON eg_config_data (tenantid);
CREATE INDEX idx_eg_config_data_uniqueidentifier ON eg_config_data (uniqueidentifier);
CREATE INDEX idx_eg_config_data_isactive ON eg_config_data (isactive);
CREATE INDEX idx_eg_config_data_data_gin ON eg_config_data USING gin (data);
