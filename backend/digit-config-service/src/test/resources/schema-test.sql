CREATE TABLE IF NOT EXISTS eg_config_data (
    id                  VARCHAR(64) NOT NULL,
    tenantid            VARCHAR(255) NOT NULL,
    uniqueidentifier    VARCHAR(255),
    schemacode          VARCHAR(255) NOT NULL,
    data                TEXT NOT NULL,
    isactive            BOOLEAN NOT NULL DEFAULT TRUE,
    createdby           VARCHAR(64),
    lastmodifiedby      VARCHAR(64),
    createdtime         BIGINT,
    lastmodifiedtime    BIGINT,
    CONSTRAINT pk_eg_config_data PRIMARY KEY (tenantid, schemacode, uniqueidentifier),
    CONSTRAINT uk_eg_config_data UNIQUE (id)
);
