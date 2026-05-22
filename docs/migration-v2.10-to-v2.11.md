# Migration Guide: CCRS v2.10 → v2.11

This document covers everything required to upgrade a running CCRS v2.10 deployment to v2.11.

---

## Table of Contents

1. [Overview of Changes](#1-overview-of-changes)
2. [Prerequisites](#2-prerequisites)
3. [Step 1 — Database Migrations](#3-step-1--database-migrations)
4. [Step 2 — Deploy New Services](#4-step-2--deploy-new-services)
5. [Step 3 — Update Existing Services](#5-step-3--update-existing-services)
6. [Step 4 — Update Configs (egov-persister)](#6-step-4--update-configs-egov-persister)
   - [6.1 New persister config](#61-new-persister-config)
   - [6.2 Updated persister configs — eg_pgr_document_v2 queryMaps](#62-updated-persister-configs--eg_pgr_document_v2-querymaps)
   - [6.3 Update persist-yml-path](#63-update-persist-yml-path)
7. [Step 5 — Update Helm Environment Config](#7-step-5--update-helm-environment-config)
8. [Step 6 — Backbone / Infrastructure Changes](#8-step-6--backbone--infrastructure-changes)
9. [Step 7 — Terraform / Infra-as-Code Changes](#9-step-7--terraform--infra-as-code-changes)
10. [Step 8 — Localization Key Format Change (Complaint Type / Sub-type)](#10-step-8--localization-key-format-change-complaint-type--sub-type)
11. [Rollback Plan](#11-rollback-plan)
12. [Service Image Reference](#12-service-image-reference)

---

## 1. Overview of Changes

| Category | What Changed |
|---|---|
| **New services** | `digit-config-service`, `digit-user-preferences-service`, `novu-bridge` |
| **Updated services** | `pgr-services` (v3.0.0), `egov-hrms`, `digit-ui` |
| **New DB tables** | `eg_config_data`, `user_preference`, `nb_dispatch_log`, `eg_pgr_document_v2` |
| **Persister configs** | `boundary-management-urban-persister.yml` added; `persist-yml-path` updated |
| **Backbone** | Minio chart replaced, Novu helm chart added |
| **Infrastructure** | Kubernetes 1.33, PostgreSQL 15, multi-arch (arm64/x86_64) support |
| **Localization keys** | Complaint type/sub-type keys changed from `.` separator to `_` (e.g. `Streetlight.nostreetlight` → `Streetlight_nostreetlight`) |

---

## 2. Prerequisites

- Running CCRS v2.10 cluster (Kubernetes ≥ 1.28 for in-place upgrade; 1.33 for fresh infra)
- PostgreSQL 12+ (15 recommended for fresh deployments)
- Access to push to your Helm environment repo
- Novu account and API key (required for `novu-bridge`)
- Git access to `egovernments/Citizen-Complaint-Resolution-System`

---

## 3. Step 1 — Database Migrations

Run the following SQL migrations **in order** against your DIGIT PostgreSQL instance. These are run automatically via Flyway init-containers when you deploy the services, but are listed here for reference and manual execution if needed.

### 3.1 digit-config-service

```sql
-- V20260302000000__create_eg_config_data.sql
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

CREATE INDEX idx_eg_config_data_schemacode        ON eg_config_data (schemacode);
CREATE INDEX idx_eg_config_data_tenantid          ON eg_config_data (tenantid);
CREATE INDEX idx_eg_config_data_uniqueidentifier  ON eg_config_data (uniqueidentifier);
CREATE INDEX idx_eg_config_data_isactive          ON eg_config_data (isactive);
CREATE INDEX idx_eg_config_data_data_gin          ON eg_config_data USING gin (data);
```

### 3.2 digit-user-preferences-service

```sql
-- V20260205120000__create_user_preference.sql
CREATE TABLE IF NOT EXISTS user_preference (
    id                  UUID PRIMARY KEY,
    user_id             VARCHAR(64) NOT NULL,
    tenant_id           VARCHAR(64),
    preference_code     VARCHAR(128) NOT NULL,
    payload             JSONB NOT NULL DEFAULT '{}',
    created_by          VARCHAR(64) NOT NULL,
    created_time        BIGINT NOT NULL,
    last_modified_by    VARCHAR(64) NOT NULL,
    last_modified_time  BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_preference_unique
    ON user_preference (user_id, tenant_id, preference_code);
```

### 3.3 novu-bridge

```sql
-- V20260217124000__create_nb_dispatch_log.sql
CREATE TABLE IF NOT EXISTS nb_dispatch_log (
    id                      UUID PRIMARY KEY,
    event_id                VARCHAR(64) NOT NULL,
    module                  VARCHAR(128) NOT NULL,
    event_name              VARCHAR(256) NOT NULL,
    tenant_id               VARCHAR(256) NOT NULL,
    channel                 VARCHAR(64) NOT NULL,
    recipient_value         VARCHAR(256) NOT NULL,
    template_key            VARCHAR(256),
    template_version        VARCHAR(64),
    status                  VARCHAR(32) NOT NULL,
    attempt_count           INT NOT NULL DEFAULT 0,
    last_error_code         VARCHAR(128),
    last_error_message      TEXT,
    provider_response_jsonb JSONB,
    created_time            BIGINT NOT NULL,
    last_modified_time      BIGINT NOT NULL
);

-- V20260325120000__add_reference_number.sql
ALTER TABLE nb_dispatch_log ADD COLUMN IF NOT EXISTS reference_number VARCHAR(256);
CREATE INDEX IF NOT EXISTS idx_nb_dispatch_reference_number ON nb_dispatch_log (reference_number);
```

### 3.4 pgr-services

```sql
-- V20260405084400__create_pgr_document_table.sql
CREATE TABLE IF NOT EXISTS eg_pgr_document_v2 (
    id                  character varying(64) NOT NULL,
    document_type       character varying(64),
    filestore_id        character varying(64),
    document_uid        character varying(64),
    service_id          character varying(64),
    additional_details  jsonb,
    created_by          character varying(64),
    last_modified_by    character varying(64),
    created_time        bigint,
    last_modified_time  bigint,
    CONSTRAINT uk_eg_pgr_document_v2 PRIMARY KEY (id),
    CONSTRAINT fk_eg_pgr_document_v2 FOREIGN KEY (service_id)
        REFERENCES eg_pgr_service_v2 (id) MATCH SIMPLE
        ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS index_eg_pgr_document_v2_tenant_service
    ON eg_pgr_document_v2 (service_id);
CREATE INDEX IF NOT EXISTS index_eg_pgr_document_v2_filestore_id
    ON eg_pgr_document_v2 (filestore_id);
```

#### 3.4.1 Data migration — backfill existing PGR documents from workflow

If you have existing complaints with documents attached via the workflow engine, run the following query to backfill them into `eg_pgr_document_v2`. This is a one-time migration step for existing data.

```sql
-- Backfill PGR documents from workflow tables into eg_pgr_document_v2.
-- Safe to re-run: ON CONFLICT DO NOTHING skips already-migrated rows.
INSERT INTO eg_pgr_document_v2 (
    id,
    document_type,
    filestore_id,
    document_uid,
    service_id,
    additional_details,
    created_by,
    last_modified_by,
    created_time,
    last_modified_time
)
SELECT
    d.id,
    d.documenttype,
    d.filestoreid,
    d.documentuid,
    p.businessid,          -- FK → eg_pgr_service_v2.id (validated by JOIN below)
    NULL,                  -- additional_details not available in workflow table
    d.createdby,
    d.lastmodifiedby,
    d.createdtime,
    d.lastmodifiedtime
FROM eg_wf_document_v2 d
JOIN eg_wf_processinstance_v2 p
    ON p.id = d.processinstanceid
JOIN eg_pgr_service_v2 s
    ON s.id = p.businessid
WHERE (p.modulename = 'PGR' OR p.businessservice LIKE 'PGR%')
  AND d.active = true
ON CONFLICT (id) DO NOTHING;
```

**Corrections vs. the original query:**

| Issue | Original | Fixed |
|---|---|---|
| Column list | Missing | Explicit `INSERT` and `SELECT` columns |
| Source column names | `documenttype`, `filestoreid` assumed wrong casing | Correct lowercase names from `eg_wf_document_v2` schema |
| `moduleName` / `businessService` | Mixed case | Lowercase `modulename` / `businessservice` per actual schema |
| Soft-deleted documents | Not filtered | `AND d.active = true` excludes inactive documents |
| Idempotency | Fails on re-run | `ON CONFLICT (id) DO NOTHING` makes it safe to re-run |
| `service_id` source | Ambiguous | Explicitly mapped from `p.businessid` |

> **Verify after running:**
> ```sql
> SELECT COUNT(*) FROM eg_pgr_document_v2;
> -- Should match the number of active PGR workflow documents:
> SELECT COUNT(*) FROM eg_wf_document_v2 d
> JOIN eg_wf_processinstance_v2 p ON p.id = d.processinstanceid
> WHERE (p.modulename = 'PGR' OR p.businessservice LIKE 'PGR%')
>   AND d.active = true;
> ```

> **Note:** All migrations run automatically via Flyway init-containers if you apply the Helm charts in Step 2 and Step 3. Manual execution is only needed if you manage schema changes outside of the deployment pipeline.

---

## 4. Step 2 — Deploy New Services

Three new services are introduced in v2.11. Deploy them in this order:

### 4.1 digit-config-service

Stores notification provider credentials and template bindings in MDMS v2 style.

```bash
helmfile -f devops/deploy-as-code/charts/common-services/common-services-helmfile.yaml \
  -l name=digit-config-service apply
```

**Key configuration** (add to your `env.yaml`):

```yaml
digit-config-service:
  memory_limits: 512Mi
```

**New service endpoint** (add to `module-level-tenant-id` service map):
```yaml
digit-config-service: "http://digit-config-service.egov:8080/"
```

### 4.2 digit-user-preferences-service

Go microservice that stores per-user notification preferences (channel, language).

```bash
helmfile -f devops/deploy-as-code/charts/common-services/common-services-helmfile.yaml \
  -l name=digit-user-preferences-service apply
```

**Key configuration**:

```yaml
digit-user-preferences-service:
  memory_limits: 256Mi
  db-ssl-mode: "require"
```

**New service endpoint**:
```yaml
digit-user-preferences-service: "http://digit-user-preferences-service.egov:8080/"
```

### 4.3 novu-bridge

Notification dispatch bridge for SMS, WhatsApp, and email via Novu.

```bash
helmfile -f devops/deploy-as-code/charts/common-services/common-services-helmfile.yaml \
  -l name=novu-bridge apply
```

**Required configuration** (set in your `env.yaml`):

```yaml
novu-bridge:
  memory_limits: 512Mi
  preference-check-path: "/user-preference/v1/_search"
  config-resolve-path: "/config-service/config/v1/_resolve"
  config-search-path: "/config-service/config/v1/_search"
  novu-base-url: "http://novu-api.novu:3000"
  novu-api-key: "<YOUR_NOVU_API_KEY>"   # Set per environment
```

**New service endpoint**:
```yaml
novu-bridge: "http://novu-bridge.egov:8080/"
novu-api:    "http://novu-api.novu:3000/"
```

---

## 5. Step 3 — Update Existing Services

### 5.1 pgr-services → v3.0.0

Major version bump. Key changes:
- Publishes structured domain events on complaint create/update for the Novu notification pipeline
- Enriches events with `submittedDate`, `assigneeName`, `assigneeDesignation`
- Resolves service display name from MDMS
- Enriches service request with department name (replaces department code)
- New `eg_pgr_document_v2` table for document attachments

```bash
helmfile -f devops/deploy-as-code/charts/urban/urban-helmfile.yaml \
  -l name=pgr-services apply
```

Image: `pgr-services:v2.11-a520687` / DB: `pgr-services-db:v2.11-a520687`

### 5.2 egov-hrms

Updated with boundary integration support.

```bash
helmfile -f devops/deploy-as-code/charts/common-services/common-services-helmfile.yaml \
  -l name=egov-hrms apply
```

Image: `egov-hrms:hrms-boundary-0a4e737` / DB: `egov-hrms-db:hrms-boundary-0a4e737`

**New secret required** — add `egov-hrms-secrets` to your configmaps (see Step 5).

### 5.3 digit-ui

Updated open-endpoint and mixed-mode endpoint whitelists — cleaned up legacy PGR v1 endpoints.

```bash
helmfile -f devops/deploy-as-code/charts/urban/urban-helmfile.yaml \
  -l name=digit-ui apply
```

Image: `digit-ui:v2.11-a520687`

---

## 6. Step 4 — Update Configs (egov-persister)

### 6.1 New persister config

A new file `boundary-management-urban-persister.yml` has been added to `configs/egov-persister/`.

Ensure this file is present in your configs repo/path.

### 6.2 Updated persister configs — `eg_pgr_document_v2` queryMaps

Two existing persister files have been updated to add INSERT queryMaps for the new `eg_pgr_document_v2` table:

**`configs/egov-persister/pgr-services-persister.yml`** — added under the `save-pgr-request` topic mapping:

```yaml
- query: INSERT INTO eg_pgr_document_v2(id, document_type, filestore_id, document_uid, service_id, additional_details, created_by, last_modified_by, created_time, last_modified_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  basePath: service.documents.*
  jsonMaps:
  - jsonPath: $.service.documents.*.id
  - jsonPath: $.service.documents.*.documentType
  - jsonPath: $.service.documents.*.fileStoreId
  - jsonPath: $.service.documents.*.documentUid
  - jsonPath: $.service.id
  - jsonPath: $.service.documents.*.additionalDetails
    type: JSON
    dbType: JSONB
  - jsonPath: $.service.auditDetails.createdBy
  - jsonPath: $.service.auditDetails.lastModifiedBy
  - jsonPath: $.service.auditDetails.createdTime
  - jsonPath: $.service.auditDetails.lastModifiedTime
```

**`configs/egov-persister/pgr-migration-batch.yml`** — added under the `save-pgr-request-batch` topic mapping with the same queryMap structure above.

Ensure your configs repo has the latest versions of both files before restarting `egov-persister`.

### 6.3 Update persist-yml-path

In your `env.yaml`, update the `egov-persister` `persist-yml-path` to add the new file at the end:

```yaml
egov-persister:
  persist-yml-path: >-
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/audit-service-persister.yml,
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/egov-user-event-persister.yml,
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/egov-workflow-v2-persister.yml,
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/hrms-employee-persister.yml,
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/pgr-migration-batch.yml,
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/pgr-services-persister.yml,
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/mdms-persister.yml,
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/boundary-persister.yml,
    file:///work-dir/Citizen-Complaint-Resolution-System/configs/egov-persister/boundary-management-urban-persister.yml
```

> Restart `egov-persister` after updating this value.

---

## 7. Step 5 — Update Helm Environment Config

Apply the following changes to your `devops/deploy-as-code/charts/environments/env.yaml`:

### 7.1 New global config values

```yaml
global:
  dev-enabled: "true"         # set to "false" in production
  egov-mdms-search-endpoint: /mdms-v2/v1/_search
```

### 7.2 New secrets (env-secrets.yaml)

Add the following secrets blocks (fill in actual values per environment):

```yaml
# Minio root credentials
minio:
  root-user: <minio_root_user>
  root-password: <minio_root_password>

# Filestore (S3/Minio) config
egov-filestore:
  fixed-bucketname: <filestore_s3_bucket>
  minio-url: "http://minio-svc.backbone:9000/"

# HRMS secrets
egov-hrms: {}   # populate as required by your deployment
```

### 7.3 Updated configmaps

Three new Kubernetes secret templates are introduced in `core-services/configmaps/`:

- `egov-filestore-secret.yaml`
- `egov-hrms-secrets.yaml`
- `minio-root-secret.yaml`

Apply:

```bash
helmfile -f devops/deploy-as-code/charts/core-services/core-services-helmfile.yaml \
  -l name=configmaps apply
```

### 7.4 MDMS endpoint key rename

The `MDMS_V2_HOST` key was renamed. Verify your `env.yaml` uses:

```yaml
egov-mdms-search-endpoint: /mdms-v2/v1/_search
```

---

## 8. Step 6 — Backbone / Infrastructure Changes

### 8.1 Minio (chart replaced)

The Minio Helm chart has been updated to the Bitnami chart (v13.3.1). **This is a breaking change** if you are using the old chart.

```bash
helmfile -f devops/deploy-as-code/charts/backbone-services/backboneservices-helmfile.yaml \
  -l name=minio apply
```

Ensure persistence is configured in `env.yaml`:

```yaml
minio:
  persistence:
    storageClass: <storage_class>   # e.g. "standard" or your cloud storage class
    accessMode: ReadWriteOnce
    size: 20Gi
```

> **Warning:** If migrating an existing Minio deployment, back up all bucket data before upgrading the chart. The new chart may not be compatible with the existing PVC if storage class differs.

### 8.2 Novu backbone services

Novu is now deployed as a backbone service (v2.3.0 Helm chart). Deploy:

```bash
helmfile -f devops/deploy-as-code/charts/backbone-services/backboneservices-helmfile.yaml \
  -l name=novu apply
```

This installs Novu API, Worker, Dashboard, MongoDB, and Redis.

### 8.3 Kafka-Kraft image

Kafka-Kraft Bitnami image was updated to fix deprecation. No config change needed — the chart handles this.

---

## 9. Step 7 — Terraform / Infra-as-Code Changes

> Skip this section if you are upgrading an existing cluster without reprovisioning infrastructure.

Changes in `devops/infra-as-code/terraform/sample-aws/`:

| Parameter | v2.10 | v2.11 |
|---|---|---|
| Kubernetes version | 1.28 | **1.33** |
| PostgreSQL version | 14.x | **15.12** |
| DB instance class | db.t3.medium | **db.t4g.medium** |
| Worker node arch | x86_64 only | **x86_64 + arm64** |

The `variables.tf` now includes an `architecture` variable:

```hcl
variable "architecture" {
  description = "Architecture for worker nodes (x86_64 or arm64)"
  default     = "x86_64"
}
```

Set `architecture = "arm64"` to use Graviton instances (`t4g.xlarge`).

---

## 10. Step 8 — Localization Key Format Change (Complaint Type / Sub-type)

**Breaking change.** The separator used in localization message codes for complaint types and sub-types has changed from `.` (dot) to `_` (underscore).

### What changed

| v2.10 key format | v2.11 key format |
|---|---|
| `SERVICEDEFS.SERVICECODE` |

**Example:**

| v2.10 | v2.11 |
|---|---|
| `SERVICEDEFS.BADSTREETLIGHT` | `SERVICEDEFS_BADSTREETLIGHT` |
| `SERVICEDEFS.pothole` | `SERVICEDEFS_pothole` |

### Why this matters

Any localization message entries you have loaded (via localisation or the dataloader) using the old `.` separator will **no longer resolve** in the UI after upgrading. The UI will fall back to the raw key, causing untranslated labels to appear for complaint types and sub-types.

### Action required

**Option A — Re-run the dataloader (recommended)**

If you use the default-data-handler or Jupyter dataloader to seed localization data, re-run the load after upgrading. The updated loader generates keys with `_` separators automatically. This will update only for default data, if added any new data for those it won't update it.

**Option B — Manual update via Localization API**

For each affected tenant, upsert the corrected keys. Example payload:

```json
{
  "RequestInfo": { ... },
  "tenantId": "pb",
  "messages": [
    {
      "code": "SERVICEDEFS.BADSTREETLIGHT",
      "message": "Bad Street Light",
      "module": "rainmaker-pgr",
      "locale": "en_IN"
    }
  ]
}
```

Call `POST /localization/messages/v1/_upsert` for each tenant/locale combination.

**Option C — Bulk rename via SQL (advanced)**

If you have direct DB access to the localization service database:

```sql
UPDATE message
SET code = replace(code, '.', '_')
WHERE module = 'rainmaker-pgr'
  AND code LIKE 'SERVICEDEFS.%';
```

Notes:
- Table is `message` (not `eg_ms_messages`).
- Scoping to `code LIKE 'SERVICEDEFS.%'` makes the replace safe — only dots inside SERVICEDEFS keys are affected, other modules are untouched.
- No tenant or locale filter needed — this must run across all tenants (`statea`, etc.) and all locales (`en_IN`, `hi_IN`, `default`).
- Handles multi-dot codes like `SERVICEDEFS.NOSTREETLIGHT.DEPT_1` → `SERVICEDEFS_NOSTREETLIGHT_DEPT_1` correctly.

> **Caution:** Test this query on a non-production database first. Take a backup before running.

### Verification

After migrating keys, open the PGR complaint creation flow in the UI and confirm complaint type and sub-type labels display correctly in all configured locales.

---

## 11. Rollback Plan

If you need to roll back to v2.10:

1. **Revert Helm deployments** to v2.10 image tags (see [Section 11](#11-service-image-reference) for tags — check your v2.10 env.yaml for previous values).
2. **Database**: The new tables (`eg_config_data`, `user_preference`, `nb_dispatch_log`, `eg_pgr_document_v2`) can remain — they are additive and do not affect v2.10 services. To fully clean up, drop them manually.
3. **Persister**: Revert `persist-yml-path` to remove `boundary-management-urban-persister.yml`.
4. **New services** (`digit-config-service`, `digit-user-preferences-service`, `novu-bridge`): Scale down to 0 replicas or delete the Helm releases.

---

## 12. Service Image Reference

| Service | v2.11 Image Tag | DB Migration Image |
|---|---|---|
| `pgr-services` | `v2.11-a520687` | `pgr-services-db:v2.11-a520687` |
| `novu-bridge` | `v2.11-a520687` | `novu-bridge-db:v2.11-a520687` |
| `digit-config-service` | `v2.11-a520687` | `digit-config-service-db:v2.11-a520687` |
| `digit-user-preferences-service` | `v2.11-a520687` | — |
| `egov-hrms` | `hrms-boundary-0a4e737` | `egov-hrms-db:hrms-boundary-0a4e737` |
| `digit-ui` | `v2.11-a520687` | — |
