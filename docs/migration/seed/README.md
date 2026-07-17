# Seed data — Citizen Authority→Tenant feature (Phase 0)

Two state-level MDMS masters for the citizen "Complaint related to" + dynamic-fields feature.
See `../citizen-authority-tenant-integration-plan.md` (../../citizen-authority-tenant-integration-plan.md).

| File | Master | Lives at |
|---|---|---|
| `ComplaintRelatedToMap.json` | `RAINMAKER-PGR.ComplaintRelatedToMap` | state tenant |
| `ComplaintTemplateType.json` | `RAINMAKER-PGR.ComplaintTemplateType` | state tenant |

## 1. Register the schemas (once)
The schema definitions live in
`utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`.
The registrar now picks up **all** `RAINMAKER-PGR.*` schemas:

```bash
BASE_URL=http://localhost:18000 TENANT=<state> node docs/migration/install-schemas.cjs
# narrow if needed:
SCHEMA_CODES=RAINMAKER-PGR.ComplaintRelatedToMap,RAINMAKER-PGR.ComplaintTemplateType \
  BASE_URL=http://localhost:18000 TENANT=<state> node docs/migration/install-schemas.cjs
```
Then apply the `x-ref-schema [] → {}` jsonb fix (MDMS v2 quirk) before seeding data —
same step as the ComplaintHierarchy migration (`run-data-migration.sh`).

## 2. Seed the data rows (at the STATE tenant)
POST each array element to `/mdms-v2/v2/_create/{schemaCode}` wrapped as `{ "RequestInfo": {…}, "Mdms": { "tenantId": "<state>", "schemaCode": "<code>", "data": <row> } }`.

## Tenant values
The local stack now runs the **Mozambique** tenants — seed at the state tenant **`mz`**:
```
BASE_URL=http://localhost:18000 TENANT=mz SCHEMA=RAINMAKER-PGR.ComplaintRelatedToMap \
  FILE=docs/migration/seed/ComplaintRelatedToMap.json UID_KEY=templateType node docs/migration/seed-data.cjs
BASE_URL=http://localhost:18000 TENANT=mz SCHEMA=RAINMAKER-PGR.ComplaintTemplateType \
  FILE=docs/migration/seed/ComplaintTemplateType.json UID_KEY=templateType node docs/migration/seed-data.cjs
```
`ComplaintRelatedToMap.tenantId` resolves to the sub-tenants `mz.ige` / `mz.igsae`, each of which
has its own seeded `RAINMAKER-PGR.ComplaintHierarchy` (loaded via the XLSX onboarding).

## ⚠️ FE+MDMS-only: protected fields are NOT collected
`witnessName` / `witnessAddress` (flagged `pii`/`maskable`/`encrypted`) are **excluded by the
frontend** because this phase has no encryption/masking — they stay in the seed so the data is
complete for the backend phase (egov-enc-service, MOZ_014/MOZ_015) but **do not render** until then.
The distinguishing fields (`instituteName`, `entityName`, `entityAddress`, `dateOfFact`, `witnessNote`)
are `pii:false` and **do render** plaintext now.
