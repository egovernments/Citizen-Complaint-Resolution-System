# Docs index — Citizen PGR feature, migrations & caching

Entry point for the recent citizen complaint-management work. Read each area's doc/script
in the order listed.

---

## 1. Citizen complaint-create — 3-step wizard *(feature)*

Streamlined 3-step create flow (Complaint → Location → Details) with the "Complaint related to"
dispatcher that routes to the right authority/sub-tenant and renders per-authority dynamic fields.

- Branch `feat/citizen-create-3step` (commit `81054330`).
- Key code: [`CreatePGRFlowV2.tsx`](../digit-ui-esbuild/products/pgr/src/pages/citizen/Create/CreatePGRFlowV2.tsx),
  hooks [`useCustomMDMS.js`](../digit-ui-esbuild/packages/libraries/src/hooks/useCustomMDMS.js) /
  [`useCustomAPIHook.js`](../digit-ui-esbuild/packages/libraries/src/hooks/useCustomAPIHook.js),
  components [`GeoLocations.js`](../digit-ui-esbuild/products/pgr/src/components/GeoLocations.js) /
  [`BoundaryComponent.js`](../digit-ui-esbuild/products/pgr/src/components/BoundaryComponent.js).
- Depends on the two MDMS masters in §2 being seeded.

## 2. Complaint dynamic-fields masters — onboarding *(dispatcher + templates)*

Seeds `RAINMAKER-PGR.ComplaintRelatedToMap` (the dropdown) + `RAINMAKER-PGR.ComplaintTemplateType`
(the per-authority fields). **State-level — seed once per state; sub-tenants inherit.**

| Order | File | What |
|---|---|---|
| 1 | [migration/seed/pgr-dynamic-fields-masters-onboarding.md](migration/seed/pgr-dynamic-fields-masters-onboarding.md) | **Start here** — beginner step-by-step (Local + Production). |
| 2 | [migration/seed-pgr-masters.cjs](migration/seed-pgr-masters.cjs) | One-shot: preflight → register → seed → verify (auto-handles the x-ref quirk). |
| 3 | [migration/seed/ComplaintRelatedToMap.json](migration/seed/ComplaintRelatedToMap.json) · [ComplaintTemplateType.json](migration/seed/ComplaintTemplateType.json) | Seed data. |
| 4 | [migration/seed/README.md](migration/seed/README.md) | Seed-data notes. |
| – | [migration/install-schemas.cjs](migration/install-schemas.cjs) · [migration/seed-data.cjs](migration/seed-data.cjs) | Supporting scripts (schema registrar + generic seeder). |

**TL;DR:** `BASE_URL=http://localhost:18000 TENANT=mz node docs/migration/seed-pgr-masters.cjs`

## 3. Complaint hierarchy — 2-level → N-level migration

Migrates the legacy 2-level complaint type to the configurable N-level two-master model
(`ComplaintHierarchyDefinition` + `ComplaintHierarchy`).

| Order | File | What |
|---|---|---|
| 1 | [migration/complaint-type-2level-to-Nlevel.md](migration/complaint-type-2level-to-Nlevel.md) | **Migration guide** — the two-master model + how/why. |
| 2 | [migration/operator-runbook.md](migration/operator-runbook.md) | **Operator runbook** — the actual run steps. |
| 3 | [migration/preflight-dryrun.cjs](migration/preflight-dryrun.cjs) | Read-only pre-flight / dry-run. |
| 4 | [migration/install-schemas.cjs](migration/install-schemas.cjs) | Register the hierarchy schemas. |
| 5 | [migration/migrate.cjs](migration/migrate.cjs) · [migration/run-data-migration.sh](migration/run-data-migration.sh) | The migrator + its wrapper. |

## 4. MDMS caching in IndexedDB *(performance / storage)*

Moves the heavy MDMS cache off `localStorage` (which overflowed → `QuotaExceededError`) into
IndexedDB, and persists the citizen dropdown catalogues so they don't re-fetch on every navigation.

- **Storage fix** (merged via **PR #962** → on this branch): the async MDMS cache moved to IndexedDB
  with a fail-soft wrapper + a quota guard —
  [`idbCache.js`](../digit-ui-esbuild/packages/libraries/src/services/atoms/Utils/idbCache.js),
  [`MDMS.js`](../digit-ui-esbuild/packages/libraries/src/services/elements/MDMS.js),
  [`Storage.js`](../digit-ui-esbuild/packages/libraries/src/services/atoms/Utils/Storage.js).
- **v2 MDMS dropdown caching** (this branch): opt-in **1-day IndexedDB** persistence for the
  `useCustomMDMS` v2 path, so the dispatcher/hierarchy/template catalogues load instantly on
  repeat visits — [`useCustomAPIHook.js`](../digit-ui-esbuild/packages/libraries/src/hooks/useCustomAPIHook.js).
- Bust the cache after a data change: DevTools → Application → IndexedDB → `digit-ui` → `mdms_cache`.

---

## Onboarding a NEW tenant — the full order

1. **Tenant + boundary + departments + employees** — via the configurator XLSX wizard.
2. **Complaint hierarchy** — §3 (per sub-tenant).
3. **Dynamic-fields masters** — §2 (once at the state).
4. Verify in the citizen app: *File a Complaint* (hard-refresh — see §4 about the cache).

## Other docs in this folder

[HLD.md](HLD.md) · [deployment-modes.md](deployment-modes.md) · [rapid-release-approach.md](rapid-release-approach.md) ·
[migration-v2.10-to-v2.11.md](migration-v2.10-to-v2.11.md) · [complaint-hierarchy-feature.md](complaint-hierarchy-feature.md) ·
[design/](design/) · [Configs_Service/](Configs_Service/) · [Novu_Adapter/](Novu_Adapter/) ·
[WhatsApp_Bidirectional/](WhatsApp_Bidirectional/) · [onboarding-samples/](onboarding-samples/)
