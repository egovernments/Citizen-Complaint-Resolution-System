-- A short database-backed lease serializes ESCALATE across pgr-services replicas
-- without holding a JDBC connection while remote services and Kafka are called.
-- Successful calls release the lease after workflow persistence is visible. Failed or
-- interrupted calls leave it to expire because their remote side effects may be uncertain.
CREATE TABLE IF NOT EXISTS eg_pgr_escalation_claim_v2 (
    tenantid        character varying(256) NOT NULL,
    servicerequestid character varying(256) NOT NULL,
    claimedat       bigint NOT NULL,
    claimuntil      bigint NOT NULL,
    CONSTRAINT pk_eg_pgr_escalation_claim_v2
        PRIMARY KEY (tenantid, servicerequestid)
);

CREATE INDEX IF NOT EXISTS ix_eg_pgr_escalation_claim_until_v2
    ON eg_pgr_escalation_claim_v2 (claimuntil);
