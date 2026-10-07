-- Per-tenant Novu accounts (#2203). One row per ROOT tenant that has (or had) its own Novu
-- organization. A tenant with no row, or a row that is not PROVISIONED, is served by the
-- deployment's shared Novu account exactly as before.
--
--   status            PROVISIONING  a claim is working on it (lease_owner / lease_until)
--                     PROVISIONED   organization + key + workflows in place; dispatch uses it
--                     FAILED        the last attempt failed (last_error_*); a re-provision resumes
--                     DEPROVISIONED integrations deleted and the key regenerated (forgotten here);
--                                   the organization stays, because self-hosted Novu 2.3.0 cannot
--                                   delete one, and a re-provision reuses it
--   novu_organization_id  recorded the moment Novu creates the org, before anything else, so a
--                         retry never creates a second organization for the tenant
--   api_key_ciphertext    AES-256-GCM (novu.bridge.tenant.accounts.encryption.key), the tenant id
--                         as authenticated data: never the key in clear
--   workflows_version     the bridge's workflow set last ensured in the org; a newer bridge
--                         re-ensures on the next provision
--
-- NOTE: do NOT edit an applied migration (Flyway checksum); this is additive.

CREATE TABLE IF NOT EXISTS nb_tenant_account (
    tenant_id              VARCHAR(256) PRIMARY KEY,
    status                 VARCHAR(32)  NOT NULL,
    novu_organization_id   VARCHAR(64),
    novu_organization_name VARCHAR(256),
    novu_environment_id    VARCHAR(64),
    novu_environment_name  VARCHAR(64),
    api_key_ciphertext     TEXT,
    api_key_id             VARCHAR(16),
    workflows_version      INT          NOT NULL DEFAULT 0,
    last_error_code        VARCHAR(128),
    last_error_message     TEXT,
    lease_owner            VARCHAR(128),
    lease_until            BIGINT,
    provisioned_time       BIGINT,
    deprovisioned_time     BIGINT,
    created_time           BIGINT       NOT NULL,
    last_modified_time     BIGINT       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nb_tenant_account_status ON nb_tenant_account (status);
