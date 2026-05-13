CREATE TABLE IF NOT EXISTS eg_pgr_document_v2(
    id character varying(64) NOT NULL,
    document_type character varying(64),
    filestore_id character varying(64),
    document_uid character varying(64),
    service_id character varying(64),
    additional_details jsonb,
    created_by character varying(64),
    last_modified_by character varying(64),
    created_time bigint,
    last_modified_time bigint,
    CONSTRAINT uk_eg_pgr_document_v2 PRIMARY KEY (id),
    CONSTRAINT fk_eg_pgr_document_v2 FOREIGN KEY (service_id)
        REFERENCES eg_pgr_service_v2 (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS index_eg_pgr_document_v2_tenant_service ON eg_pgr_document_v2 (service_id);
CREATE INDEX IF NOT EXISTS index_eg_pgr_document_v2_filestore_id ON eg_pgr_document_v2 (filestore_id);
