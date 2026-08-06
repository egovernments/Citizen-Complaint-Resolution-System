# Tenant bootstrap → validation → smoke test pipeline

**Date:** 2026-06-04
**Status:** Draft, awaiting user review
**Owner:** Subhashini Srinivasan
**Supersedes:** `2026-06-04-test-tier-skip-mechanism-design.md` (the skip mechanism survives as Phase 7 of this spec, with reduced scope)

## Summary

End-to-end pipeline so an operator who has freshly deployed DIGIT (default `pg` tenant) can run **one command** to:
1. Bootstrap a new tenant (e.g. `ke`) by cloning `pg` via a country template (`africa` or `india`).
2. Provision the canonical test persona set (admin, GRO, LME, ward-CSR, supervisor, citizen) automatically.
3. Validate the seed comprehensively (~25 checks across MDMS, HRMS, workflow, localization, boundaries).
4. Run the standard Tier 1 + Tier 2 Playwright suite against the new tenant.
5. Get a per-test pass/skip/fail report.

The default template is `africa` (modelled on Kenya). The main inter-template differences are boundary hierarchy depth/names and the level at which complaints are filed.

## Goals

- One operator command from DIGIT-deployed → tenant-ready → tests run.
- Tests parameterized: every spec reads tenant, persona credentials, and country specifics from env vars. No hardcoded `ke.nairobi`, `pg`, `+254`, `sw_KE`.
- Bootstrap is idempotent — running twice produces the same final state.
- Seed validation is declarative — adding a new check is a config edit, not code.
- Templates are extensible — adding a new country is a YAML file, not code.
- The standard suite produces a structured report (JSON + summary table) suitable for CI.

## Non-goals

- Replacing the operator-driven XLSX onboarding flow (`city_setup_from_xlsx`). That serves a different audience (one-off per-city). The new pipeline is for test-deployment bootstrap.
- Fixing the historical-SRID Tier 3 tests by seeding (out of scope; Phase 7 handles them via skip).
- Production tenant provisioning. This pipeline is test-focused — `pg` data leaks (Indian masters with Kenyan labels) are acceptable for testing, not for production.

## Hard constraint — MCP only, no dataloader

All bootstrap, persona, and seeding operations go through the existing **MCP tools** (`tenant_bootstrap`, `city_setup`, `boundary_create`, `mdms_create`, `localization_upsert`, `employee_create`, `user_create`, `validate_*`, `employee_update`, `boundary_mgmt_process`, etc.). The pipeline does **NOT** invoke:

- The Jupyter dataloader at `local-setup/jupyter/dataloader/` (`unified_loader.py`, `crs_loader.py`, etc.)
- The `city_setup_from_xlsx` MCP (which wraps the dataloader)
- Any XLSX-driven path

Rationale: the dataloader is an operator-driven path; MCP is the programmatic path. Keeping the pipeline on MCP avoids a parallel orchestration layer and stays aligned with how everything else (configurator UI, MCP-driven test setup) talks to DIGIT.

## What's already there (MCP findings 2026-06-04)

| Capability | MCP tool | Coverage |
|------------|----------|----------|
| Clone schemas + workflow defs + Department + Designation + StateInfo + IdFormat + InboxQueryConfiguration | `tenant_bootstrap` | ✓ |
| Declarative `user_validation` rules (Kenya `^[17][0-9]{8}$`, Mozambique `^8[0-9]{8}$`) | `tenant_bootstrap` | ✓ |
| ADMIN user on root tenant | `tenant_bootstrap` | ✓ |
| City tenant + dual-scoped ADMIN + workflow copy + boundary hierarchy *types* | `city_setup` | ✓ |
| Tenant existence check | `validate_tenant` | partial (only checks tenant in MDMS list, not seed completeness) |
| Employee creation (with roles/dept/designation/jurisdiction) | `employee_create` | ✓ |
| Citizen/employee user creation | `user_create` | ✓ |
| Tenant validity probes | `validate_boundary`, `validate_employees`, `validate_complaint_types`, `validate_departments`, `validate_designations`, `validate_boundary_hierarchy` | ✓ (Phase 4 wraps these) |
| **Complaint types (ServiceDefs)** | — | **NOT covered by tenant_bootstrap** — template carries them |
| **Localization rows (incl. sw_KE)** | `localization_upsert` (write tool) | **NOT covered by tenant_bootstrap** — template carries them |
| **Boundary entity data (ward/locality *names*)** | `boundary_create`, `city_setup_from_xlsx` | NOT auto-cloned; template carries them |
| **Async bootstrap notification** | — | unknown — need to test whether `tenant_bootstrap` is sync or async |

## Architecture

```
        ┌─────────────────────────────────────────────────────┐
        │ digit-bootstrap --template africa --target ke       │
        └────────────────────────┬────────────────────────────┘
                                 │
        ┌────────────────────────▼────────────────────────────┐
        │ Phase 1 — Bootstrap orchestrator                    │
        │ ├── tenant_bootstrap(source=pg, target=ke,          │
        │ │     user_validation=template.user_validation)      │
        │ ├── city_setup(tenant_id=ke.nairobi, city_name=...) │
        │ ├── Apply template extras:                          │
        │ │   ├── boundary entities (template.boundaries)     │
        │ │   ├── complaint types (template.complaint_types)  │
        │ │   └── localization rows (template.localizations)  │
        │ └── Wait/notify (Phase 3)                           │
        └────────────────────────┬────────────────────────────┘
                                 │
        ┌────────────────────────▼────────────────────────────┐
        │ Phase 2 — Persona provisioning                      │
        │ ├── employee_create(name=gro,   role=GRO, dept=...) │
        │ ├── employee_create(name=lme,   role=PGR_LME, ...)  │
        │ ├── employee_create(name=csr,   role=CSR, ward=...) │
        │ ├── employee_create(name=sup,   role=GRO, reportsTo)│
        │ └── user_create(citizen via OTP-register helper)    │
        └────────────────────────┬────────────────────────────┘
                                 │
        ┌────────────────────────▼────────────────────────────┐
        │ Phase 4 — Seed validation (~25 checks)              │
        │ Refactored from lifecycle/api-smoke-2026-04-29 +    │
        │ validate_* MCPs.                                    │
        └────────────────────────┬────────────────────────────┘
                                 │
        ┌────────────────────────▼────────────────────────────┐
        │ Phase 6 — Suite runner                              │
        │ digit-run-suite --tier 1,2 --target ke              │
        │ Sets env vars from Phase 2 outputs, invokes         │
        │ `playwright test --grep '@tier:[12]'`               │
        └────────────────────────┬────────────────────────────┘
                                 │
                       per-test JSON + summary table
```

Phase 5 (test parameterization) and Phase 7 (residual skip) are repository-wide refactors that don't appear in the runtime pipeline but unblock Phase 6.

## Phases

### Phase 0 — Templates (~2-3 days)

Location: `local-setup/digit-bootstrap/templates/`

```yaml
# templates/africa.yaml
name: africa
modeled_on: kenya
default: true

# Country-aware validation rules — passed to tenant_bootstrap.user_validation
user_validation:
  - fieldType: mobile
    pattern: '^[17][0-9]{8}$'
    minLength: 9
    maxLength: 9
    errorMessage: 'Enter a 9-digit Kenya mobile starting with 1 or 7'
  - fieldType: email
    pattern: '^[^@]+@[^@]+\.[^@]+$'

# Country prefix used in display + form helper text
mobile_display_prefix: '+254'

# Boundary hierarchy structure — applied via city_setup + boundary_create
boundary_hierarchy:
  hierarchy_type: ADMIN
  levels: [Country, Region, County, SubCounty, Ward, Locality]
  complaint_filing_level: Ward     # citizens file at Ward level

# Boundary entity tree — uploaded after city_setup
boundary_entities:
  - { code: COUNTY_NAIROBI, name: Nairobi County, type: County, parent: null }
  - { code: SUBCOUNTY_WESTLANDS, name: Westlands, type: SubCounty, parent: COUNTY_NAIROBI }
  - { code: WARD_WESTLANDS, name: Westlands Ward, type: Ward, parent: SUBCOUNTY_WESTLANDS }
  # ... etc

# Complaint types — applied via mdms_create against RAINMAKER-PGR.ServiceDefs
complaint_types:
  - { code: GarbageNotCollected, name: Garbage not collected, department: DEPT_Sanitation, sla_hours: 48 }
  - { code: Pothole, name: Pothole on road, department: DEPT_Roads, sla_hours: 72 }
  # ... etc

# Localization deltas — applied via localization_upsert (locale, module, code, message)
localizations:
  - { locale: sw_KE, module: rainmaker-common, code: 'CS_PGR_LOGIN', message: 'Ingia' }
  # ... etc
```

```yaml
# templates/india.yaml — for parity testing, India-pinned
name: india
modeled_on: punjab
default: false

user_validation:
  - fieldType: mobile
    pattern: '^[6-9][0-9]{9}$'
    minLength: 10
    maxLength: 10
    errorMessage: 'Enter a 10-digit Indian mobile'

mobile_display_prefix: '+91'

boundary_hierarchy:
  hierarchy_type: ADMIN
  levels: [State, District, City, Locality]
  complaint_filing_level: Locality

# ... boundary_entities, complaint_types, localizations
```

### Phase 1 — Bootstrap orchestrator (~3 days)

Location: `local-setup/digit-bootstrap/`

CLI (language TBD per open question 7 below — likely Python to match the MCP shim, or a thin Node wrapper that shells out to the MCP CLI):
```
digit-bootstrap [--template TEMPLATE] [--source pg] --target TENANT [--city CITY]
                [--wait] [--timeout SECONDS] [--webhook URL]
```

Steps:
1. Load template YAML; validate against zod/pydantic schema.
2. Call `tenant_bootstrap(source_tenant=source, target_tenant=target, user_validation=template.user_validation)`.
3. Call `city_setup(tenant_id=target+'.'+city, city_name=..., source_tenant=target)`.
4. Apply template extras:
   - For each boundary entity → `boundary_create` (or batch upload).
   - For each complaint type → `mdms_create` against `RAINMAKER-PGR.ServiceDefs`.
   - For each localization → `localization_upsert` batch.
5. If `--wait`, poll for completion (Phase 3). Otherwise return job-id.
6. Emit env file `tenant.env` with the resolved tenant id, ADMIN credentials, locale list. Operator can `source tenant.env` before tests.

Idempotency: each step checks if the artifact already exists (uses `validate_tenant`, `mdms_search`, `boundary_entity_exists`) before creating. Safe to re-run.

### Phase 2 — Persona provisioning (~2 days)

Triggered automatically at end of Phase 1.

Creates the canonical persona set, all idempotent:
- `<tenant>-admin` — already created by `tenant_bootstrap`
- `<tenant>-gro` — `employee_create(roles=[GRO], department=DEPT_Sanitation, jurisdiction=<city tenant>)`
- `<tenant>-lme` — `employee_create(roles=[PGR_LME], department=DEPT_Sanitation, jurisdiction=<city tenant>)`
- `<tenant>-csr-ward1` — `employee_create(roles=[CSR], jurisdiction=WARD_WESTLANDS)` (ward-scoped)
- `<tenant>-supervisor` — `employee_create(roles=[GRO])`, then set `reportingTo` to the GRO via HRMS update
- `<tenant>-citizen` — first try `user_create(user_type=CITIZEN, mobile=<generated per user_validation>)` for admin-side creation, falling back to the OTP-register flow used by `tests/integration-tests/tests/utils/citizen-login.ts` if FIXED_OTP is enabled on the deployment

Outputs appended to `tenant.env`:
```
DIGIT_TENANT=ke.nairobi
ADMIN_USER=ke-admin
ADMIN_PASSWORD=eGov@123
GRO_USER=ke-gro
GRO_PASSWORD=eGov@123
LME_USER=ke-lme
LME_PASSWORD=eGov@123
WARD_CSR_USER=ke-csr-ward1
WARD_CSR_BOUNDARY=WARD_WESTLANDS
SUPERVISOR_USER=ke-supervisor
CITIZEN_MOBILE=712345678
```

### Phase 3 — Async + notification (~1-3 days, depends on bootstrap latency)

**Unknown today:** is `tenant_bootstrap` synchronous from the operator's perspective, or does it kick off background work? Need to test against a fresh deployment.

If sync (< 30s) → CLI just blocks; no extra work needed.
If async → add:
- `digit-bootstrap status <job-id>` — polling endpoint
- `--wait [--timeout SECONDS]` flag on the bootstrap command
- Optional `--webhook URL` to POST completion
- Optional `--notify slack:<channel>` (uses existing Slack MCP)

Verify on first sprint day: run `tenant_bootstrap` and measure.

### Phase 4 — Seed validation (~3-4 days)

CLI: `digit-validate-tenant <tenant>`

Aggregates ~25 checks. Most live as MCP tools already (`validate_*`); this phase wraps them + adds the missing checks. Output: structured JSON pass/fail per check + summary.

Check categories:
- **MDMS**: schemas registered (Department, Designation, ServiceDefs, UserValidation, ThemeConfig...), record counts ≥ threshold per master.
- **HRMS**: ADMIN exists, ≥1 employee with GRO role, ≥1 with PGR_LME, ≥1 with reportingTo set.
- **Workflow**: businessservice `PGR` registered with expected actions (APPLY, ASSIGN, RESOLVE, REJECT, ESCALATE, REOPEN, RATE).
- **Localization**: en_IN row count ≥ N per module; if sw_KE expected, ≥ N rows per module.
- **Boundary**: hierarchy registered, entity tree walkable, leaf-level entities exist.
- **OAuth**: ADMIN credentials produce a valid token.
- **PGR**: smoke create + assign + resolve round-trip succeeds.

Source material: `tests/integration-tests/tests/lifecycle/api-smoke-2026-04-29.spec.ts` already does ~5 of these. Refactor those into reusable validator functions, then add the rest.

### Phase 5 — Test parameterization (~4-5 days, parallelizable)

Repository-wide refactor. Every test reads from env vars:
- `DIGIT_TENANT`, `ROOT_TENANT`, `CITY_TENANT`
- `ADMIN_USER`, `ADMIN_PASSWORD`
- `GRO_USER`, `LME_USER`, `WARD_CSR_USER`, etc.
- `MOBILE_PATTERN`, `MOBILE_PREFIX`, `EXPECTED_LOCALE`
- `WARD_CSR_BOUNDARY`

No more hardcoded `ke.nairobi`, `pg`, `+254`, `'NCCG-PGR-2026-04-28-011862'`, `'kenya-green'`.

Execution: parallel agents per bucket. The 8 trivial refactors from the parked Phase 1 are the prototype — same pattern scales to ~30-50 files.

Where data is genuinely deployment-pinned (e.g., historical SRIDs in `pgr-details`, `timeline-fixes:8`), the test moves to Tier 3 + Phase 7 skip.

### Phase 6 — Suite runner (~2 days)

CLI: `digit-run-suite [--tier 1,2|1|2|3|smoke] --target TENANT [--report report.json]`

Thin wrapper:
1. Loads `tenant.env` for the target tenant.
2. Sets `BASE_URL`, `CONTEXT_PROFILE`, persona env vars.
3. Invokes `playwright test --grep '@tier:[12]'` (or specified tiers).
4. Parses Playwright JSON reporter output → produces summary table:
   ```
   Tier 1: 142/146 passed, 4 skipped, 0 failed
   Tier 2:  61/67  passed, 6 skipped, 0 failed
   ```
5. Exits non-zero on any failure (CI-friendly).

### Phase 7 — Residual skip mechanism (~1-2 days)

Reduced from the superseded spec. Now handles ONLY:
- Keycloak overlay presence (~6 KC tests)
- Scheduler running (~4 SLA-escalation tests)
- Historical pinned SRIDs (~10 `pgr-details` + `api-smoke:41` + `timeline-fixes:8`)
- Country-specific assertions that can't be parameterized (~5)

Uses the same `assertContext({ tier, requires })` API as the superseded spec, but profiles are smaller and tests using it are a clear minority. The bootstrapped tenant emits a profile alongside `tenant.env`:
```yaml
# generated by digit-bootstrap into tenant.profile.yaml
maxTier: 2
overlays: []        # add 'keycloak' if KC overlay enabled
scheduler: false    # set true if scheduler running
pinnedFixtures: []  # populated only on environments with seeded historicals
```

Operator: `CONTEXT_PROFILE=tenant.profile.yaml digit-run-suite --tier 1,2`.

## Open questions

1. **Does `tenant_bootstrap` copy ServiceDefs (complaint types)?** "All schema definitions" is ambiguous — if it copies data not just schema, template doesn't need to carry complaint types. Verify on day 1.
2. **Bootstrap latency** — sync or async? Drives Phase 3's existence.
3. **Localization upsert batch size limits** — applying 4000+ rows from a template needs paging. `localization_upsert` MCP exists; need to check batch ceilings.
4. **Boundary entity bulk upload** — `boundary_mgmt_process` exists; verify it handles template-style YAML, or whether we need a per-entity loop via `boundary_create`.
5. **Citizen OTP-register helper** — fixed-OTP path needs `FIXED_OTP=true` enabled on the deployment. Should bootstrap probe + warn if not set?
6. **`reportingTo` for supervisor persona** — Phase 2 needs an HRMS update step after employee_create. Does any MCP expose this directly? (`employee_update` exists; need to confirm it accepts `assignments[].reportingTo`.)
7. **CLI implementation language** — Python (matches MCP shim) or Node (matches Playwright tests, lets the suite runner share helpers)? Pick on day 1.

## Effort + critical path

| Phase | Effort | Can parallel-start |
|-------|-------:|--------------------|
| 0. Templates | 2-3d | yes |
| 1. Bootstrap orchestrator | 3-5d | after 0 |
| 2. Persona provisioning | 2d | after 1 |
| 3. Async/notify | 1-3d | after measuring bootstrap latency |
| 4. Seed validation | 3-4d | after 2 |
| 5. Test parameterization | 4-5d | yes, in parallel |
| 6. Suite runner | 2d | after 5 + 4 |
| 7. Residual skip | 1-2d | after 5 |

Critical path: 0 → 1 → 2 → 4 → 6. With Phase 5 parallel: **~2.5-3 weeks wall time**. Sequential: ~4-5 weeks.

## Risks

- **Template drift from reality.** Templates encode boundary entity names, complaint types. A deployment that diverges silently breaks tests. Mitigation: Phase 4 validation surfaces drift.
- **`tenant_bootstrap` covers less than the schema suggests.** If it doesn't copy all the masters we assume, template gets bigger and Phase 1 takes longer. Mitigation: Phase 0 day 1 = empirical audit of what bootstrap actually produces.
- **MCP API churn.** The MCP tools we depend on (`employee_create`, `tenant_bootstrap`) could change schema. Mitigation: pin MCP version in tool requirements; treat MCP integration as an external API.
- **Phase 5 refactor cost underestimated.** 30-50 files is a guess. If the actual count is 80+ files with subtle data dependencies, parameterization could push to 7-10d. Mitigation: do one bucket as a pilot before parallelizing.

## Relationship to existing tooling

- **`tenant_bootstrap`, `city_setup`, `employee_create`, `user_create`, `employee_update`, `validate_*`, `mdms_*`, `localization_*`, `boundary_*` MCPs** — Phases 1, 2, 4 consume these. **Only path for bootstrap operations.**
- **Jupyter dataloader (`local-setup/jupyter/dataloader/`) and `city_setup_from_xlsx` MCP** — explicitly NOT used by this pipeline (see "Hard constraint" above).
- **`digit-xlsx-onboard` Claude skill** — operator-driven one-off city onboarding from XLSX. Different audience (humans onboarding real cities). Uses the dataloader path; coexists with this pipeline but doesn't share its orchestration.
- **`digit-ansible-onboard` Claude skill** — installs DIGIT. New pipeline runs after.
- **`lifecycle/api-smoke-2026-04-29.spec.ts`** — Phase 4 absorbs its checks into reusable validators.
- **Existing Playwright test suite** — Phase 5 parameterizes; Phase 6 runs.
