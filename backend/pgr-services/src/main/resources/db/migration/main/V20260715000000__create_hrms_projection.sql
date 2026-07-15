-- Visibility V1 Step-2 (reportee core): local projection of the HRMS
-- reporting hierarchy, so inbox visibility resolution makes zero live HRMS
-- calls (VISIBILITY-DESIGN.md §4.3). One row per employee; only the fields
-- the resolver reads. Kept fresh by HrmsProjectionConsumer (HRMS save/update
-- topics) with a scheduled full rebuild as backstop.

CREATE TABLE IF NOT EXISTS eg_pgr_hrms_projection (
    uuid            character varying(128) NOT NULL,
    tenantid        character varying(256) NOT NULL,
    reporting_to    character varying(128),
    department      character varying(256),
    active          boolean DEFAULT TRUE,
    lastmodifiedtime bigint,
    CONSTRAINT pk_eg_pgr_hrms_projection PRIMARY KEY (uuid)
);

-- children-by-manager lookup (the reportee walk)
CREATE INDEX IF NOT EXISTS idx_eg_pgr_hrms_projection_reporting
    ON eg_pgr_hrms_projection (tenantid, reporting_to);
