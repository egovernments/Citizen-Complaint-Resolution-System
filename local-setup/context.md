# CRS Platform — Recent Changes & Open Issues

*Date: 2026-04-12*

This document captures two parallel workstreams: (A) making the login/landing pages tenant-independent, and (B) boundary auto-generation and localization in the DataLoader pipeline. Both affect `crs_loader.py` and the overall tenant bootstrapping flow.

---

# Part A: Tenant-Independent Login Bootstrap

## Problem Statement

The CRS frontend login page (`/digit-ui/employee/user/login`) depends on a `stateTenantId` in `globalConfigs.js` to bootstrap the UI. This value is passed to the `DigitUI` npm component which calls `MdmsService.init(<tenantId>)` to fetch the tenant list for the city dropdown. But MDMS scopes `tenant.tenants` records per root tenant — each root only sees its own tenants:

- `"ke"` shows 6 tenants
- `"pg"` shows 10 tenants
- `"statea"` shows 3 tenants

**No single root previously showed ALL tenants.** The old config had `stateTenantId = "ke"`, so the login page only showed Kenya tenants.

## Root Cause

MDMS `tenant.tenants` records are stored per `tenantId` (the root). When `MdmsService.init("ke")` runs, it only gets records where `tenantid = 'ke'`. Cross-root tenants like `pg.kericho` or `statea.citya` are invisible.

## Solution: Bootstrap from `pg` + Dual-Register All Tenants

**Strategy:** Use `pg` as the bootstrap tenant (it's the system seed tenant with the most data). Every time a new tenant is created under a different root, also register it under `pg` so the login page's MDMS call returns everything.

### Changes Made

#### 1. `local-setup/nginx/globalConfigs.js`

**What changed:**
- `stateTenantId` changed from `"ke"` to `"pg"`
- Added new `bootstrapTenantId = "pg"` variable (explicit semantic name for pre-login bootstrap)
- Added `BOOTSTRAP_TENANT_ID` config key to `getConfig()` function

**Why:** The login page needs to bootstrap from a tenant that has all tenants registered, all localization messages (3784 messages already on `pg`), and all MDMS config. `pg` is the system seed tenant and the natural choice.

#### 2. `frontend/micro-ui/web/src/App.js`

**What changed:** Updated `stateCode` resolution to try `BOOTSTRAP_TENANT_ID` first:
```javascript
const stateCode =
  window.globalConfigs?.getConfig("BOOTSTRAP_TENANT_ID") ||
  window.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID") ||
  process.env.REACT_APP_STATE_LEVEL_TENANT_ID ||
  "pg";
```

**Why:** This is the value passed as `stateCode` prop to the `DigitUI` component, which uses it for `MdmsService.init()`. The fallback chain ensures backward compatibility.

#### 3. `frontend/micro-ui/web/src/index.js`

**What changed:** Updated both `stateCode` assignments (pre-login session setup at line 56 and post-login fallback at line 83) to prefer `BOOTSTRAP_TENANT_ID`:
```javascript
const stateCode = window?.globalConfigs?.getConfig("BOOTSTRAP_TENANT_ID")
  || window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
```

**Why:** `index.js` uses `stateCode` as the fallback tenant for `Citizen.tenant-id` and `Employee.tenant-id` in SessionStorage/localStorage when no user session exists. Must match the bootstrap tenant so the pre-login MDMS calls go to the right root.

#### 4. `local-setup/jupyter/dataloader/crs_loader.py` — `create_tenant()` method

**What changed:** After successfully creating a tenant record under its own root, the method now also registers it under `pg` if the root is not already `pg`:
```python
if root_tenant != "pg":
    # POST to mdms-v2/v2/_create/tenant.tenants with tenantId="pg"
    # Ignore "already exists" errors
```

**Why:** This ensures every tenant created via `crs_loader` automatically appears in the login page's city dropdown without manual intervention.

### Architecture: Pre-Login Flow

```
Browser → nginx (:18080) → Kong (:18000) → backend services
                ↓
         digit-ui static files
         + globalConfigs.js (injected via sub_filter)

Pre-login flow:
1. globalConfigs.js sets bootstrapTenantId = "pg"
2. index.js reads BOOTSTRAP_TENANT_ID, sets stateCode = "pg"
3. App.js passes stateCode="pg" to <DigitUI>
4. DigitUI calls MdmsService.init("pg") → fetches tenant.tenants where tenantid='pg'
5. Language-selection page renders with city dropdown showing ALL tenants
6. DigitUI calls /tenant-management/tenant/config/_search?code=pg → 404 (BROKEN)
7. Localization loads from pg (3784 messages available)
8. User selects city, logs in → post-login tenant is whatever they selected
```

---

# Part B: Boundary Auto-Generation & Localization Pipeline

## Background

The CRS DataLoader (`jupyter/dataloader/crs_loader.py`) provides a 6-phase workflow for loading master data into a DIGIT/eGov deployment. Phase 2 handles **administrative boundaries** — the hierarchical geographic units (e.g., Country → County → SubCounty → Ward) that scope complaints and employee assignments.

The boundary loading flow is:
1. **Phase 2a** (`load_hierarchy`): Define hierarchy levels and generate an Excel template via the boundary management service
2. **Phase 2b** (`load_boundaries`): Upload a filled Excel to create boundary entities and parent-child relationships

## Problem 1: Users Had to Manually Create Boundary Codes

### What Was Happening

The boundary Excel required users to fill in a `code` column with machine-friendly identifiers like `KE_KENYA_NAIROBI_WESTLANDS`. For large hierarchies (Kenya has 47 counties, 290 sub-counties, 1,450 wards), this was tedious and error-prone.

### Fix Implemented

Added `_autogenerate_boundary_codes()` in `crs_loader.py` which runs as a pre-processing step before upload. It supports two Excel formats:

- **Standard format**: columns `code`, `name`, `boundaryType`, `parentCode` — users leave `code` blank, auto-gen fills it by walking the parent chain and building a hierarchical code from names
- **Column-per-level format**: columns like `Administrative_Country`, `Administrative_County`, `Administrative_Ward` — each row carries the full hierarchy path in its columns

Code generation uses `_generate_boundary_code(tenant, path, seen_codes)` which:
- Abbreviates multi-word names to initials (e.g., "Nairobi County" → "NC")
- Prefixes with tenant leaf (e.g., `KE_KENYA_NAIROBI`)
- Handles collisions via numeric suffixes
- Caps at 64 characters
- Deduplicates against existing boundaries via fuzzy matching

## Problem 2: Column-Per-Level Format Was Broken End-to-End

### What Was Happening

The auto-gen for column-per-level format wrote generated codes into a `CRS_BOUNDARY_CODE` column but **did not update the level columns themselves**. Downstream, `process_boundary_data()` in `unified_loader.py` reads the level column values and treats them as boundary codes to pass to the API. So it was sending human-readable names like "Nairobi" as boundary codes instead of generated codes like `KE_KENYA_NAIROBI`.

### Root Cause

Disconnect between the pre-processing step (`_autogen_level_format` in `crs_loader.py`) and the upload step (`process_boundary_data` in `unified_loader.py`). The auto-gen only generated a code for the **deepest** level per row and stored it in `CRS_BOUNDARY_CODE`, but the upload step reads from the individual level columns.

### Fix Implemented

Updated `_autogen_level_format` to:

1. **Generate codes for every level** in the path, not just the deepest (using a `path_tuple_to_code` cache so the same boundary always gets the same code across rows)
2. **Replace level column values with generated codes** in the temp file — e.g., `Administrative_County` cell changes from "Nairobi" to "KE_KENYA_NAIROBI"
3. Store the deepest code in `CRS_BOUNDARY_CODE` as before

This means `process_boundary_data` now receives codes in the level columns and creates entities/relationships correctly without any changes to `unified_loader.py`.

**Example transformation (temp file written by auto-gen):**

| Administrative_Country | Administrative_County | Administrative_Ward | CRS_BOUNDARY_CODE |
|---|---|---|---|
| KE_KENYA | KE_KENYA_NAIROBI | KE_KENYA_NAIROBI_WESTLANDS | KE_KENYA_NAIROBI_WESTLANDS |
| KE_KENYA | KE_KENYA_MOMBASA | KE_KENYA_MOMBASA_LIKONI | KE_KENYA_MOMBASA_LIKONI |

## Problem 3: No Localization for Boundary Names

### What Was Happening

When boundaries were created with auto-generated codes, the UI had no way to display human-readable names. The localization service maps codes to display names (e.g., `KE_KENYA_NAIROBI` → "Nairobi"), but boundary loading never created these mappings.

### Fix Implemented

1. **`_autogen_level_format`**: After generating codes, builds a list of localization entries mapping each code back to its original name. Stored in `self._boundary_localizations`.
2. **`_autogen_standard_format`**: Same — builds localizations from the `code_to_name` mapping.
3. **`load_boundaries`**: New step `[4/4]` uploads the collected localizations via `create_localization_messages()` after boundary entities are created.

**Localization format:**
```python
{
    'code': 'KE_KENYA_NAIROBI',      # boundary code
    'message': 'Nairobi',             # human-readable name
    'module': 'rainmaker-boundary',   # localization module
    'locale': 'en_IN'                 # English locale
}
```

## How Column Matching Works

`process_boundary_data` needs to map hierarchy level names (e.g., `County`) to Excel column headers (e.g., `Administrative_County`). This is handled by `_find_best_column_match()` in `unified_loader.py` with this priority:

1. Exact match
2. Case-insensitive exact match
3. Normalized exact match (strips spaces/underscores/hyphens)
4. Normalized suffix match — `administrativecounty` ends with `county`

## Current State — What Works

For **column-per-level format** (recommended for new deployments):

| What the user fills in | What gets auto-generated |
|---|---|
| `Administrative_Country`: Kenya | Code: `KE_KENYA` |
| `Administrative_County`: Nairobi | Code: `KE_KENYA_NAIROBI` |
| `Administrative_SubCounty`: Westlands | Code: `KE_KENYA_NAIROBI_WESTLANDS` |
| `Administrative_Ward`: Karura | Code: `KE_KENYA_NAIROBI_WESTLANDS_KARURA` |

The full pipeline:
1. User fills in boundary **names** only (no codes needed)
2. `_autogenerate_boundary_codes` generates codes and rewrites level columns
3. Excel uploaded to FileStore
4. `process_boundary_data` creates entities and relationships using codes from level columns
5. Localization entries uploaded mapping each code → name

For **standard format** (`code`, `name`, `boundaryType`, `parentCode`):
- Works when parents appear **before** children in the spreadsheet
- Localizations are also generated

---

# Open Issues (All Workstreams)

## Blocking: `/tenant-management/tenant/config/_search` returns 404

**Symptom:** On the language-selection page (`/digit-ui/employee/user/language-selection`), clicking "Continue" triggers:
```
POST /tenant-management/tenant/config/_search?code=pg
```
Returns 404 from Kong: `{"message":"no Route matched with those values"}`.

**Root cause:** The `tenant-management` service does not exist in the local setup:
- No container in `docker-compose.yml`
- No route in `kong/kong.yml`
- No proxy rule in `nginx/digit-ui.conf`
- No backend implementation in the repo

The call originates from `@egovernments/digit-ui-module-core` npm package (v1.9.18-cms) — baked into compiled vendor bundles.

**Impact:** Language-selection page has broken localization (`CORE_COMMON_CONTINUE` shows as raw key). The init flow stalls or degrades when this call fails.

**Possible fixes:**
1. **Mock it in nginx** — Return a static JSON response that satisfies the frontend
2. **Add Kong route to a stub** — Lightweight service or Kong plugin returning expected response
3. **Patch the npm package** — Override the service call in the frontend build (invasive)

**Unknown:** The exact response schema the frontend expects. Need to inspect [DIGIT-Frontend source](https://github.com/egovernments/DIGIT-Frontend) (`digit-ui-module-core` package) or intercept the call in a working DIGIT deployment.

## TODO: Backfill Existing Cross-Root Tenants Under `pg`

Existing tenants (`ke`, `statea`, `statea.citya`, `statea.cityb`, `ug`) are not yet registered under `pg`'s `tenant.tenants`. One-time backfill needed:

```sql
INSERT INTO eg_mdms_data (id, tenantid, schemacode, uniqueidentifier, data, isactive, createdby, createdtime, lastmodifiedby, lastmodifiedtime)
SELECT
  gen_random_uuid(), 'pg', schemacode,
  'tenant.tenants.' || (data->>'code'),
  data, isactive, createdby, now()::bigint, lastmodifiedby, now()::bigint
FROM eg_mdms_data
WHERE schemacode = 'tenant.tenants'
  AND tenantid != 'pg'
  AND data->>'code' NOT IN (
    SELECT data->>'code' FROM eg_mdms_data WHERE schemacode = 'tenant.tenants' AND tenantid = 'pg'
  );
```

## TODO: MCP Server Tools Need Dual-Registration

Documented in `local-setup/mcp_changes.md`. The MCP `city_setup` and `tenant_bootstrap` tools create tenants via MDMS API. They need the same dual-registration logic: after creating a tenant under its own root, also create it under `pg`.

## TODO: Standard Format Chicken-and-Egg Problem (Boundaries)

In the standard boundary format, if ALL codes are blank, children need `parentCode` to reference their parent — but the parent's code is also auto-generated. Works ONLY if parents come before children in row order. **The column-per-level format is the recommended path** since each row carries its full hierarchy and has no ordering dependency.

## TODO: Multi-Language Boundary Localization

Currently boundary localizations are created only for `en_IN`. Deployments needing other languages (Hindi, Swahili) must load them separately via Phase 5. Could be enhanced to accept a multi-language boundary Excel.

## TODO: Kenya Boundary Master Template Update

`dataloader/templates/Kenya_Boundary_Master.xlsx` uses the old standard format with `State`/`District` as `boundaryType` values. Needs update to column-per-level format with correct boundary types (`Country`, `County`, `SubCounty`, `Ward`).

## TODO: Boundary Test Coverage

- Unit tests (44 tests, all passing) cover code generation and auto-gen
- Column-per-level test does **not** verify that level columns are rewritten with codes — needs strengthening
- No integration test for the full pipeline (auto-gen → upload → process → localize)

---

# Files Summary

## Part A — Login Bootstrap

| File | Status | Change |
|------|--------|--------|
| `local-setup/nginx/globalConfigs.js` | Done | `stateTenantId="pg"`, added `bootstrapTenantId`, added config key |
| `frontend/micro-ui/web/src/App.js` | Done | `BOOTSTRAP_TENANT_ID` fallback chain for stateCode |
| `frontend/micro-ui/web/src/index.js` | Done | `BOOTSTRAP_TENANT_ID` in both stateCode assignments |
| `local-setup/jupyter/dataloader/crs_loader.py` | Done | Dual-register tenants under `pg` in `create_tenant()` |
| `local-setup/mcp_changes.md` | Created | Documents pending MCP tool changes |
| Kong routes / nginx proxy | TODO | Need route for `/tenant-management` (mock or stub) |
| MDMS backfill | TODO | Register existing cross-root tenants under `pg` |

## Part B — Boundary Pipeline

| File | Role |
|------|------|
| `jupyter/dataloader/crs_loader.py` | `load_boundaries`, `_autogenerate_boundary_codes`, `_autogen_standard_format`, `_autogen_level_format`, `_generate_boundary_code` |
| `jupyter/dataloader/unified_loader.py` | `process_boundary_data`, `_create_boundary_entity`, `_create_boundary_relationship`, `create_localization_messages` |
| `jupyter/dataloader/test_boundary_codes.py` | Unit tests for code generation and auto-gen (44 tests) |
| `jupyter/DataLoader_v2.ipynb` | User-facing notebook (Phase 2a/2b cells) |
| `jupyter/dataloader/templates/Kenya_Boundary_Master.xlsx` | Kenya boundary data (needs update) |

---

# Verification Checklist

- [x] Smoke tests pass (17/17 — user creation, login, PGR, MDMS, localization all green)
- [x] Boundary unit tests pass (44/44)
- [ ] Language-selection page shows translated labels (blocked by tenant-management 404)
- [ ] City dropdown shows ALL tenants on login page (needs MDMS backfill)
- [ ] Login works for any selected tenant
- [ ] New tenant created via `crs_loader` appears in login dropdown
- [ ] PGR e2e workflow test passes (`cd tests && npx jest smoke/pgr-workflow.test.ts --verbose`)
- [ ] Full boundary pipeline tested end-to-end with column-per-level format

# Environment

- **Platform:** Docker Compose orchestrated via Tilt
- **Frontend:** `@egovernments/digit-ui-module-core` v1.9.18-cms (pre-built npm, not source-editable)
- **Key services:** Kong (gateway :18000), nginx (digit-ui :18080), MDMS, egov-user, egov-enc-service, PGR
- **Bootstrap tenant:** `pg` (system seed with all schemas, localization, and MDMS data)
- **DataLoader:** Jupyter notebook + Python (`crs_loader.py` / `unified_loader.py`)
