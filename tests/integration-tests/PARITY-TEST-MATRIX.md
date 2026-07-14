# Parity test matrix — per-test status across k3s / compose / bomet

One row per test (272 unique). **Kept updated** as fixes land; referenced from issue #1160.

Columns:
- **k3s (base)** — our Maputo / Kubernetes at the *baseline* (before any §-fix)
- **k3s (now)** — our Maputo / Kubernetes *currently* (after the §-fixes applied so far). `✅` = flipped to pass since baseline · `⚠️` = regressed · `◐` = changed, still not passing
- **compose** — our Maputo / Docker Compose (Kong). Initially treated as the stable reference, but it had its **own** gap: `egov-workflow-v2` was mis-tenanted — the compose file grouped it with `enc-service` on the city-tier `STATE_LEVEL_TENANT_ID` (`mz.maputo`), so it looked for the PGR businessservice at the city and found nothing (PGR is seeded at the state root `mz`, identically on both stacks). Every complaint failed. Fixing the env to the state root (§1.9 — one line, matching k3s) unblocked the pipeline; the three affected suites re-run → **23 tests flipped to pass, 0 regressions**, lifting compose to **119 pass**.
- **bomet** — the suite's native **Kenya** tenant, full Compose stack (reference)

> **Reading it:** `compose` vs `k3s` (identical Maputo data) is the clean parity control; `bomet` adds the *"is this test meaningful on Maputo"* axis. Categories below are computed from **current** state, so a fixed test moves into *Clean parity* with a `✅` showing where it came from.

> **Parity status:** compose passes **119**, k3s **114**; they agree on **266/272** rows. Of the 6 disagreements: **5** are a **k3s-only gap** — the configurator DSS/PGR dashboard (`/manage/pgr-dashboard`) fetches `GET /pgr-services/v2/dashboard`, and the **k3s Spring gateway NPEs on that bodyless GET** (`CorrelationIdFilterHelper` does `Mono.just(null)` inside a ModifyRequestBody filter) → 500 before it reaches pgr-services; Kong forwards it fine (**§1.10**, root-caused — needs a gateway code fix, do NOT match k3s's bug); **1** is an onboarding edge row (`invalid role lands as Error`) that also fails/skips on bomet (suite issue, not parity). The former **§2.6b** divergence (`create — citizen user`) is now **FIXED** — passes on both stacks via the harness `apiAuth()` fresh-token change.

> **Data currency:** all four re-run areas are post-§1.9 and fresh like-for-like (compose + k3s admin both re-run with PGR complaints present). Fixes reflected: §1.2 (configurator/MCP), §1.6 (egov-user), §1.7 (filestore), §1.8 (digit-ui config), §1.9 (PGR businessservice @ city), §2.4 (RBAC grant), §2.5 (egov-hrms). Open: §1.10 (DSS dashboard on k3s).

## Summary

**Since baseline: 52 tests flipped fail/skip → pass** (the ✅ rows); 2 regressed.

| Category | Count | What it means |
|---|---:|---|
| k8s-specific gap | 5 | Pass on bomet AND our compose, still fail/skip on k3s → the real k8s deployment delta still open. |
| Maputo-data gap | 23 | Pass on bomet, fail on BOTH our stacks → the suite's Kenya/Bomet data-coupling, not the deployment. |
| Suite / app bug | 30 | Fails on bomet too (its native tenant) → a genuine suite/app bug or flake, unrelated to parity. |
| Tenant-coupled skip | 25 | Runs on bomet, skipped on both our stacks → hidden signal; needs tenant-portable fixtures. |
| Ours better | 3 | Fails on bomet, passes on ours. |
| Other / mixed | 9 |  |
| Clean parity | 103 | Pass on all three (includes tests we FIXED — look for the ✅ in the k3s (now) column). |
| Inherent N/A | 74 | Skipped everywhere (@local-only, no-keycloak, structural). |
| **Total** | **272** | |

Status legend: `pass` · `**fail**` · `skip` (includes did-not-run).

## Fix reference — to raise fix PRs

The `Fix` column in the tables below points here. **Exact reproducible steps per fix (chart diffs + the live commands/manifests/SQL) are in [`PARITY-FIXES.md`](./PARITY-FIXES.md).** Ranked by number of tests it flips.

| Fix | Flips | Permanent fix (the PR) |
|---|---:|---|
| §1.8 · Local **digit-ui globalConfigs** | 17 | Render digit-ui `globalConfigs.js` locally from the tenant config (like Compose) instead of the external-S3 injection; at minimum fail-loud on a missing/unreachable config instead of silently falling back to India defaults. |
| §1.6 · Pin **egov-user** mobile-validation image | 12 | Pin the `mobilevalidation` egov-user image on k8s (reads the per-tenant MDMS mobile rule); align `OTP_VALIDATION_REGISTER_MANDATORY` with Compose. Unblocks citizen register/OTP/provisioning. |
| §2.4 · Seed **RBAC** write grant | 6 | Seed the mdms-v2 write actions' roleaction grants to the configurator-operator role (a dedicated config-admin / `MDMS_ADMIN`) in the access-control MDMS; add a CI check that drives one create with RBAC enforced. |
| §2.5 · Deploy **egov-hrms** | 5 | Wire `common-services-helmfile.yaml` (egov-hrms + peers) into the k8s deploy sequence; the Spring gateway auto-discovers the service on (re)start. Restore-safe: `initContainers.dbMigration.enabled:false`. |
| §2.6 · Harness **role-string** fix | 5 | The manage-API test helpers sent `RequestInfo.userInfo.roles` as bare code strings; expand to Role objects (`tests/utils/manage/api.ts`, `tests/admin/users.spec.ts`) so the strict k8s gateway deserializes them. Test-code fix. |
| §1.6b · **OTP mock** on k3s | 3 | Deploy the nginx OTP mock (`tests/integration-tests/deploy/otp-mock.k8s.yaml`) that rubber-stamps the fixed 123456 for `_validate`/`_send`, and repoint user-otp+egov-otp to it — matching Compose's default OTP-mock mode. Unblocks citizen register/login (and any citizen-gated flow, e.g. the photo-upload tests, which also need filestore §1.7). Pairs with the egov-user OTP-flag alignment (§1.6). |
| §1.7 · Real **minio** object store | 1 | Install minio; chart-template the egov-ns `minio` secret (accesskey/secretkey from the minio release); set `egov-filestore minio-enabled:true`, correct `minio-url` (no trailing slash), fixed bucket. |
| §1.2 · Add **configurator + digit-mcp** charts | 1 | Add `configurator` + `digit-mcp` charts to the k8s helmfile (Service + Ingress at `/configurator`, `/mcp`, `/v1`; MCP session DB). |
| §2.6b · Harness **fresh-token** fix | 1 | `create — citizen user` failed on k3s (`/user/_search` 401): the API verify used the configurator storageState token, which resolves role-less on the fail-closed gateway. Added `apiAuth()` (fresh OAuth login → operator's real roles) in `tests/utils/manage/api.ts`; `users.spec.ts` uses it for /user/* verify+teardown. Passes on both stacks. Test-code fix. |
| §1.4 · Right-size **pgr-services** memory | 1 | Set `memory_limits >= Xmx + ~50%` (or `-XX:MaxRAMPercentage`) so pgr-services doesn't cgroup-OOM and stays up. |

> Attribution is best-effort (primary fix per test); some flips have more than one contributing fix. Total flipped since baseline: **52**.

## k8s-specific gap (5)

Pass on bomet AND our compose, still fail/skip on k3s → the real k8s deployment delta still open.

| Area | Test | k3s (base) | k3s (now) | compose | bomet | Fix (to productionize) |
|---|---|:--:|:--:|:--:|:--:|---|
| admin | all chart canvases render | **fail** | **fail** | pass | pass | — |
| admin | breakdown table with 4 tabs | **fail** | **fail** | pass | pass | — |
| admin | chart section titles are visible | **fail** | **fail** | pass | pass | — |
| admin | KPI values show numbers | **fail** | **fail** | pass | pass | — |
| admin | overview card shows 3 KPI metrics | **fail** | **fail** | pass | pass | — |

## Maputo-data gap (23)

Pass on bomet, fail on BOTH our stacks → the suite's Kenya/Bomet data-coupling, not the deployment.

| Area | Test | k3s (base) | k3s (now) | compose | bomet | Fix (to productionize) |
|---|---|:--:|:--:|:--:|:--:|---|
| admin | 1. create with multi-department persists as a string[] | **fail** | **fail** | **fail** | pass | — |
| admin | 1. login tenant placeholder uses configured tenant, not "pg" | **fail** | **fail** | **fail** | pass | — |
| admin | 1. tenant parity — both ke and ke.nairobi return the same rainmaker-common en_IN count | **fail** | **fail** | **fail** | pass | — |
| admin | 2. UI create happy path — chain of 2 levels shows up in list + API | **fail** | **fail** | **fail** | pass | — |
| admin | API smoke — ThemeConfig record exists on the expected tenant | **fail** | **fail** | **fail** | pass | — |
| admin | API: rainmaker-pgr en_IN has sentence-cased labels for ESCALATE/ASSIGN/etc | **fail** | **fail** | **fail** | pass | — |
| admin | targetTenant persists in localStorage and survives reload | **fail** | **fail** | **fail** | pass | — |
| admin | username, password, tenant inputs render empty on initial load | **fail** | **fail** | **fail** | pass | — |
| citizen+employee | walks 6 steps + submits + lands on /pgr/response with PGR ID | **fail** | **fail** | **fail** | pass | — |
| onboarding | 3 valid + 2 invalid → preview reports 5 total / 3 valid / 2 errors and Create button reads | **fail** | **fail** | **fail** | pass | — |
| onboarding | add + remove level + submit advances to Boundary Data Upload | **fail** | **fail** | **fail** | pass | — |
| onboarding | Back from preview → re-upload corrected xlsx → preview shows valid | **fail** | **fail** | **fail** | pass | — |
| onboarding | Back from verify → re-upload valid xlsx → all valid | **fail** | **fail** | **fail** | pass | — |
| onboarding | boundary xlsx with a missing parentCode lands the row in the Errors tab | **fail** | **fail** | **fail** | pass | — |
| onboarding | Cancel on the confirm dialog dismisses without firing creates | **fail** | **fail** | **fail** | pass | — |
| onboarding | empty hierarchyType blocks "Create Hierarchy" | **fail** | **fail** | **fail** | pass | — |
| onboarding | hierarchy created via Option 1 is selectable via Option 2 | **fail** | **fail** | **fail** | pass | — |
| onboarding | login → upload → preview → tenant lands in manage list | **fail** | **fail** | **fail** | pass | — |
| onboarding | preview reports counts for 3 depts + 2 designations, then advances to Step 3.2 | **fail** | **fail** | **fail** | pass | — |
| onboarding | row with invalid role lands as Error | skip | skip | **fail** | pass | — |
| onboarding | row with non-existent department code lands as Error + Create button disabled | **fail** | **fail** | **fail** | pass | — |
| onboarding | uploading a PNG to the first branding row flips it to "Uploaded ✓" | **fail** | **fail** | **fail** | pass | — |
| onboarding | xlsx with no recognized master sheets is rejected before preview | **fail** | **fail** | **fail** | pass | — |

## Suite / app bug (30)

Fails on bomet too (its native tenant) → a genuine suite/app bug or flake, unrelated to parity.

| Area | Test | k3s (base) | k3s (now) | compose | bomet | Fix (to productionize) |
|---|---|:--:|:--:|:--:|:--:|---|
| admin | 1. file complaint — citizen, locality, required landmark | skip | **fail** ◐ | **fail** | **fail** | — |
| admin | 2. create → edit → deactivate round-trip; visible at city tenant | skip | **fail** ◐ | **fail** | **fail** | — |
| admin | 2. single create — happy path derives code + username, employee lands | skip | **fail** ◐ | **fail** | **fail** | — |
| admin | 2. single create → edit → deactivate round-trip | **fail** | **fail** | **fail** | **fail** | — |
| admin | 3. edit — username disabled, name updates round-trip | skip | **fail** ◐ | **fail** | **fail** | — |
| admin | 6. bulk import accepts comma-list department values as array | skip | skip | skip | **fail** | — |
| admin | edit page renders the flagship editor (tabs + preview) | **fail** | **fail** | **fail** | **fail** | — |
| admin | editing a brand token updates the preview live | **fail** | **fail** | **fail** | **fail** | — |
| admin | search returns both PW-prefixed boundaries created through onboarding | **fail** | **fail** | **fail** | **fail** | — |
| admin | users + edit + create + validators bidirectional | **fail** | **fail** | **fail** | **fail** | — |
| api+smoke | 5 — admin assigns complaint to specific employee | skip | skip | skip | **fail** | — |
| api+smoke | boundary-relationships API returns only the ward subtree | skip | skip | skip | **fail** | — |
| api+smoke | pgr search round-trips a known CLOSEDAFTERRESOLUTION complaint | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | 2 — citizen creates complaint via UI wizard | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | FAQ page does not render the error fallback | pass | **fail** ⚠️ | **fail** | **fail** | — |
| citizen+employee | How-it-works page does not render the error fallback | pass | **fail** ⚠️ | **fail** | **fail** | — |
| citizen+employee | no raw localization keys visible at any wizard step | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | pin step + locality cascade no longer trap the citizen | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | REJECTED state advertises a non-empty rejection-reason mdms list | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.1 — details page loads without error (terminal fixture) @p0 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.16 — Complaint Timeline section renders with checkpoint rows @p0 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.18 — timeline actor name is clean (no role-list concat) — #524 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.24a — Take Action HIDDEN on terminal-state complaint @p1 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.24b — Take Action VISIBLE on non-terminal complaint @p0 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.4 — Complaint No. label + value match the SRID @p0 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.5 — Current Status chip renders localized status text @p0 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.6 — complaint classification rows render localized values @p1 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | Story 5.9 — Filed Date renders in DD/MM/YYYY @p1 | **fail** | **fail** | **fail** | **fail** | — |
| citizen+employee | upload preview renders, then detail page surfaces the same image | **fail** | **fail** | **fail** | **fail** | — |
| keycloak | mobile + OTP (existing citizen) authenticates via overlay and lands at dashboard with KC t | skip | skip | skip | **fail** | — |

## Tenant-coupled skip (25)

Runs on bomet, skipped on both our stacks → hidden signal; needs tenant-portable fixtures.

| Area | Test | k3s (base) | k3s (now) | compose | bomet | Fix (to productionize) |
|---|---|:--:|:--:|:--:|:--:|---|
| admin | 2. edit round-trip preserves array shape (add then remove) | skip | skip | skip | pass | — |
| admin | 2. upsert + cache-bust round-trip — value lands after bust, not before | skip | skip | skip | pass | — |
| admin | 3. _upsert rejects same code on different modules in one batch (DUPLICATE_RECORDS) | skip | skip | skip | pass | — |
| admin | 3. show page renders levels in chain order | skip | skip | skip | pass | — |
| admin | 4. duplicate hierarchyType is rejected with DUPLICATE_RECORD | skip | skip | skip | pass | — |
| admin | 4. list renders with a usable layout and shows data | skip | skip | skip | pass | — |
| admin | 5. deactivation guard counts dependent records | skip | skip | skip | pass | — |
| admin | 5. validation — empty hierarchyType blocks client-side submit | skip | skip | skip | pass | — |
| admin | 5a. department chip input dropdown loads options from mdms | skip | skip | skip | pass | — |
| admin | 5b. show page renders department chips for a multi-dept designation | skip | skip | skip | pass | — |
| admin | 5c. API soft-delete (isActive=false) removes row from active list | skip | skip | skip | pass | — |
| admin | 5d. HRMS probe returns assignments.designation for guard counter | skip | skip | skip | pass | — |
| admin | 6. API response shape — BoundaryHierarchy comes back as an array | skip | skip | skip | pass | — |
| api+smoke | 3 — ensure 2-level employee hierarchy (reportingTo) in HRMS | skip | skip | skip | pass | — |
| api+smoke | 4 — citizen creates complaint | skip | skip | skip | pass | — |
| keycloak | Authorize URL with PKCE + kc_idp_hint=google does not 400 at KC (realm allows the SPA clie | skip | skip | skip | pass | — |
| keycloak | Continue with Google emits an /authorize URL with PKCE S256 + kc_idp_hint=google | skip | skip | skip | pass | — |
| keycloak | OIDC discovery: every endpoint URL lives under the issuer origin + /auth prefix | skip | skip | skip | pass | — |
| keycloak | OIDC discovery: issuer includes the /auth prefix (frontendUrl regression) | skip | skip | skip | pass | — |
| keycloak | Overlay healthz: status=ok and redis connected | skip | skip | skip | pass | — |
| keycloak | Overlay password grant mints a KC JWT for ADMIN (KC→DIGIT fallback on first login, KC dire | skip | skip | skip | pass | — |
| keycloak | Overlay-issued JWT round-trips through the proxy: /mdms-v2 _search returns a DIGIT respons | skip | skip | skip | pass | — |
| onboarding | login → Phase 1 → Phase 2 → Phase 3 → ready for Phase 4 | skip | skip | skip | pass | — |
| onboarding | Phase 1 → 2 → 3 setup, then Phase 4 employee xlsx → confirm → success | skip | skip | skip | pass | — |
| onboarding | Phase 2 landing survives a full reload + targetTenant persists | skip | skip | skip | pass | — |

## Ours better (3)

Fails on bomet, passes on ours.

| Area | Test | k3s (base) | k3s (now) | compose | bomet | Fix (to productionize) |
|---|---|:--:|:--:|:--:|:--:|---|
| admin | 3. show page renders Code / Name / City / District for a known tenant | **fail** | pass ✅ | pass | **fail** | §2.6 — Harness **role-string** fix |
| api+smoke | 3 — admin assigns complaint | skip | pass ✅ | pass | **fail** | §1.6 — Pin **egov-user** mobile-validation image |
| specs | form has all expected sections | pass | pass | pass | **fail** | — |

## Other / mixed (9)
| Area | Test | k3s (base) | k3s (now) | compose | bomet | Fix (to productionize) |
|---|---|:--:|:--:|:--:|:--:|---|
| admin | 4. API shape — search returns records with code / name / city | skip | pass ✅ | pass | skip | §2.6 — Harness **role-string** fix |
| admin | 5. QUIRK — city tenant object may lack districtName, list tolerates it | skip | pass ✅ | pass | skip | §2.6 — Harness **role-string** fix |
| api+smoke | 4 — admin resolves complaint | skip | **fail** ◐ | **fail** | skip | — |
| citizen+employee | ASSIGN (GRO) → PENDINGATLME, then RESOLVE (LME) → RESOLVED @p0 | skip | pass ✅ | pass | skip | §2.5 — Deploy **egov-hrms** |
| citizen+employee | complaint-type filter → only rows of the chosen serviceCode @p0 | skip | pass ✅ | pass | skip | §1.6 — Pin **egov-user** mobile-validation image |
| citizen+employee | search by complaint number returns exactly that complaint @p1 | skip | pass ✅ | pass | skip | §1.6 — Pin **egov-user** mobile-validation image |
| citizen+employee | search by mobile number returns the matching complaint @p1 | skip | pass ✅ | pass | skip | §1.6 — Pin **egov-user** mobile-validation image |
| citizen+employee | search for a well-formed but non-existent complaint number returns nothing @p1 | skip | pass ✅ | pass | skip | §1.6 — Pin **egov-user** mobile-validation image |
| citizen+employee | status filter → only rows in the chosen workflow state @p0 | skip | pass ✅ | pass | skip | §1.6 — Pin **egov-user** mobile-validation image |

## Clean parity (103)

Pass on all three (includes tests we FIXED — look for the ✅ in the k3s (now) column).

| Area | Test | k3s (base) | k3s (now) | compose | bomet | Fix (to productionize) |
|---|---|:--:|:--:|:--:|:--:|---|
| admin | 1. list renders expected columns and at least one row | pass | pass | pass | pass | — |
| admin | 1. list renders with header columns and filter narrows results | pass | pass | pass | pass | — |
| admin | 1. list renders with hierarchy type + levels columns | pass | pass | pass | pass | — |
| admin | 1. list renders with profile columns + at least one citizen row | pass | pass | pass | pass | — |
| admin | 1. list renders with Service Code / Name / Department / SLA / Status columns | **fail** | pass ✅ | pass | pass | §2.6 — Harness **role-string** fix |
| admin | 1. list renders, search narrows, status filter applies | **fail** | pass ✅ | pass | pass | §1.2 — Add **configurator + digit-mcp** charts |
| admin | 2. create — citizen user lands and is retrievable via API | **fail** | pass ✅ | pass | pass | §2.6b — Harness **fresh-token** fix |
| admin | 2. employee create payload contains no literal "pg" | pass | pass | pass | pass | — |
| admin | 2. search filter narrows to a known tenant code | pass | pass | pass | pass | — |
| admin | 3. complaint create payload contains no literal "pg" | pass | pass | pass | pass | — |
| admin | 4. localization endpoint never uses tenantId=pg | pass | pass | pass | pass | — |
| admin | API: active=true & isActive=true returns the tenant employee list | **fail** | pass ✅ | pass | pass | §2.5 — Deploy **egov-hrms** |
| admin | API: ES_COMMON_TAKE_ACTION resolves to "Take Action" | pass | pass | pass | pass | — |
| admin | API: pgr-services SortBy accepts `sla` but rejects unknown literals like `serviceSla` | **fail** | pass ✅ | pass | pass | §1.4 — Right-size **pgr-services** memory |
| admin | API: rainmaker-common sw_KEIN (the buggy mangle) is empty — proves the dataset itself is c | pass | pass | pass | pass | — |
| admin | API: workflow business service exposes the 11 PGR states (drives statusMap) | pass | pass | pass | pass | — |
| admin | Bundle: open-states constant is present in the served JS | pass | pass | pass | pass | — |
| admin | ComplaintHierarchy schema declares keywords / order / parentCode (so ComplaintTypeCreate d | pass | pass | pass | pass | — |
| admin | dashboard page loads with heading | pass | pass | pass | pass | — |
| admin | Department create REJECTS the legacy `description` field | **fail** | pass ✅ | pass | pass | §2.4 — Seed **RBAC** write grant |
| admin | Department create with only schema-allowed fields SUCCEEDS | **fail** | pass ✅ | pass | pass | §2.4 — Seed **RBAC** write grant |
| admin | department localizations are in rainmaker-common, not rainmaker-common-masters | pass | pass | pass | pass | — |
| admin | Department update with leaked `_isActive` / `_uniqueIdentifier` / `id` is REJECTED by MDMS | **fail** | pass ✅ | pass | pass | §2.4 — Seed **RBAC** write grant |
| admin | dept is scoped to child tenant, does not leak to root | **fail** | pass ✅ | pass | pass | §2.4 — Seed **RBAC** write grant |
| admin | designation localizations are in rainmaker-common, not rainmaker-common-masters | pass | pass | pass | pass | — |
| admin | Edit view exposes a Workflow Action select; ESCALATE present when state=PENDINGATLME | skip | pass ✅ | pass | pass | §2.6 — Harness **role-string** fix |
| admin | form + password input carry autocomplete-off attributes | pass | pass | pass | pass | — |
| admin | invalid mobile surfaces help text and aria-invalid | pass | pass | pass | pass | — |
| admin | MDMS ThemeConfig is fetched and applied as CSS variables | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| admin | mdmsCreate REJECTS the same `_isActive` / `id` leak | **fail** | pass ✅ | pass | pass | §2.4 — Seed **RBAC** write grant |
| admin | rainmaker-common-masters module has no localization data at all | pass | pass | pass | pass | — |
| admin | second valid mobile candidate clears aria-invalid — #674 fallback | pass | pass | pass | pass | — |
| admin | sidebar has PGR Dashboard nav link | pass | pass | pass | pass | — |
| admin | UI: no UndoToast container is mounted after navigating into the configurator | pass | pass | pass | pass | — |
| admin | valid mobile clears aria-invalid | pass | pass | pass | pass | — |
| api+smoke | 1 — acquire admin and citizen tokens | **fail** | pass ✅ | pass | pass | §1.6 — Pin **egov-user** mobile-validation image |
| api+smoke | 2 — citizen creates complaint | skip | pass ✅ | pass | pass | §1.6 — Pin **egov-user** mobile-validation image |
| api+smoke | 2 — ensure PGR workflow config is correct (ESCALATE, role grants, nextState fix) | skip | pass ✅ | pass | pass | §1.6 — Pin **egov-user** mobile-validation image |
| api+smoke | ADMIN can oauth/token (post-bootstrap enc-key guard) | pass | pass | pass | pass | — |
| api+smoke | all API calls carry JWT through proxy (no 401s after login) | **fail** | pass ✅ | pass | pass | §2.4 — Seed **RBAC** write grant |
| api+smoke | all employee flow APIs return valid responses through proxy | pass | pass | pass | pass | — |
| api+smoke | authenticate via api | pass | pass | pass | pass | — |
| api+smoke | citizen flow APIs work without authentication | pass | pass | pass | pass | — |
| api+smoke | hrms employee search returns >0 LMEs | **fail** | pass ✅ | pass | pass | §2.5 — Deploy **egov-hrms** |
| api+smoke | Larger valid JPEG should succeed regardless of fix state (control) | **fail** | pass ✅ | pass | pass | §1.7 — Real **minio** object store |
| api+smoke | login returns token | pass | pass | pass | pass | — |
| api+smoke | mdms search returns Department schema records | pass | pass | pass | pass | — |
| api+smoke | MDMS, localization, and access APIs work with JWT auth | pass | pass | pass | pass | — |
| api+smoke | PGR business service is present | pass | pass | pass | pass | — |
| api+smoke | REPRO: tiny synthetic JPEG triggers EG_FILESTORE_INPUT_ERROR (pre-fix) | pass | pass | pass | pass | — |
| citizen+employee | #421 — landing ServicesSection top padding matches side padding | pass | pass | pass | pass | — |
| citizen+employee | #422 — navigating into Create New Complaint lands at top of page | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | /all-services renders CCRS title + File a Complaint + My Complaints links | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | /citizen/ redirects to /citizen/all-services | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | /pgr-home renders the PGR module home with action links | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | 1 — citizen logs in via UI with fixed OTP | pass | pass | pass | pass | — |
| citizen+employee | 5-digit number shows inline error + helper hint | pass | pass | pass | pass | — |
| citizen+employee | API session injection loads employee home | pass | pass | pass | pass | — |
| citizen+employee | auto-skip-home: All Services menu renders | skip | pass ✅ | pass | pass | §1.6 — Pin **egov-user** mobile-validation image |
| citizen+employee | bad credentials are rejected | pass | pass | pass | pass | — |
| citizen+employee | Change Password button styling check | pass | pass | pass | pass | — |
| citizen+employee | citizen can log in with OTP and reach home page | pass | pass | pass | pass | — |
| citizen+employee | citizen logout redirects to login page | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | complaint details page loads without crashing for a freshly-filed complaint | skip | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | complaint type dropdown shows human-readable translated names | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | Detail page renders Summary / Details / Map / Timeline sections | skip | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | Detail URL uses /complaints/:id (PLURAL) — Routes.js export diverges | skip | pass ✅ | pass | pass | §1.6 — Pin **egov-user** mobile-validation image |
| citizen+employee | digit-ui bundle declares AddressOne + AddressTwo populators (PR-C re-enabled) | pass | pass | pass | pass | — |
| citizen+employee | fresh phone → OTP → name+email → /all-services | **fail** | pass ✅ | pass | pass | §1.6b — **OTP mock** on k3s |
| citizen+employee | header language pill renders the current locale | pass | pass | pass | pass | — |
| citizen+employee | Localization keys for the timeline rendering are seeded across the deployment locales (rai | pass | pass | pass | pass | — |
| citizen+employee | login page renders with mobile input | pass | pass | pass | pass | — |
| citizen+employee | mobile prefix chip renders the tenant dial code (not hardcoded +91) | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | My Complaints list shows the seeded complaint with OPEN badge | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | only Name + Gender + Email + photo render (no password/language/mobile/notifications) | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | PGR business service: PENDINGFORASSIGNMENT.ASSIGN forward-state is PENDINGATLME, not a sel | pass | pass | pass | pass | — |
| citizen+employee | PGR_LME-only role filter returns LMEs (not all-of-HRMS) | **fail** | pass ✅ | pass | pass | §2.5 — Deploy **egov-hrms** |
| citizen+employee | post-auth UserProfile mount + onChange do not throw | pass | pass | pass | pass | — |
| citizen+employee | rate page renders 5 stars + 4 feedback checkboxes + Comments textarea | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | reopen step 0 renders title + 4 reason radios + Next button | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | smoke: lands on a usable citizen page | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| citizen+employee | the deployment postal-code pattern accepts this tenant's valid sample and rejects malforme | pass | pass | pass | pass | — |
| citizen+employee | the legacy Indian pattern would have rejected this tenant's valid postal code | pass | pass | pass | pass | — |
| citizen+employee | upload JPEG photo, _update returns 2xx, no hard reload | **fail** | pass ✅ | pass | pass | §1.6b — **OTP mock** on k3s |
| citizen+employee | upload photo, _update returns 2xx, no hard reload | **fail** | pass ✅ | pass | pass | §1.6b — **OTP mock** on k3s |
| citizen+employee | valid credentials return access token | pass | pass | pass | pass | — |
| lifecycle | authenticate | pass | pass | pass | pass | — |
| lifecycle | provision a fresh citizen (suite-wide) | pass | pass | pass | pass | — |
| lifecycle | seed lifecycle fixtures (one non-terminal + one terminal-with-rating complaint) | pass | pass | pass | pass | — |
| onboarding | rejects a missing tenantCode (empty cell) | pass | pass | pass | pass | — |
| onboarding | rejects a tenantCode that does not match the regex | pass | pass | pass | pass | — |
| onboarding | rejects an xlsx with headers but no data rows | pass | pass | pass | pass | — |
| specs | assignment without dept/designation shows validation error (#458) | pass | pass | pass | pass | — |
| specs | edit employee preserves assignments and jurisdictions | **fail** | pass ✅ | pass | pass | §2.5 — Deploy **egov-hrms** |
| specs | employee list loads | pass | pass | pass | pass | — |
| specs | mobile field is required — form stays on create page | pass | pass | pass | pass | — |
| specs | mobile field shows tenant help text | pass | pass | pass | pass | — |
| specs | mobile validation reflects the deployment MDMS rule | **fail** | pass ✅ | pass | pass | §1.6 — Pin **egov-user** mobile-validation image |
| specs | no Username input field exists (#460) | pass | pass | pass | pass | — |
| specs | postal code field is not required — form proceeds without it | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| specs | submit with invalid mobile shows format error | pass | pass | pass | pass | — |
| specs | valid postal code (deployment format) is accepted | **fail** | pass ✅ | pass | pass | §1.8 — Local **digit-ui globalConfigs** |
| specs | valid tenant mobile does not show validation error | pass | pass | pass | pass | — |

## Inherent N/A (74)

Skipped everywhere (@local-only, no-keycloak, structural).

| Area | Test | k3s (base) | k3s (now) | compose | bomet | Fix (to productionize) |
|---|---|:--:|:--:|:--:|:--:|---|
| admin | 10. real pagination — offset-based _search fires with page 2 nav, not client-slice of firs | skip | skip | skip | skip | — |
| admin | 11. department column renders via EntityLink — not a raw code | skip | skip | skip | skip | — |
| admin | 12. edit saves description + workflow in a single _update round-trip | skip | skip | skip | skip | — |
| admin | 13. PENDINGFORASSIGNMENT filter returns the expected queue size | skip | skip | skip | skip | — |
| admin | 2. edit merges description + workflow ASSIGN in one round-trip | skip | skip | skip | skip | — |
| admin | 3. bulk import — happy path creates 5 rows | skip | skip | skip | skip | — |
| admin | 3. legacy single-string department is coerced to array on save | skip | skip | skip | skip | — |
| admin | 3. too-short mobile shows inline validation error | skip | skip | skip | skip | — |
| admin | 3. workflow dropdown labels are human-readable, not UUIDs | skip | skip | skip | skip | — |
| admin | 4. bulk import — duplicate code rejected client-side | skip | skip | skip | skip | — |
| admin | 4. department filter narrows list to designations referencing that code | skip | skip | skip | skip | — |
| admin | 4. department reference filter narrows the list | skip | skip | skip | skip | — |
| admin | 4. edit — DOB round-trips as YYYY-MM-DD (not epoch-ms) | skip | skip | skip | skip | — |
| admin | 4. show — profile fields render for a freshly seeded user | skip | skip | skip | skip | — |
| admin | 4. source select offers only Web/Mobile/WhatsApp | skip | skip | skip | skip | — |
| admin | 4a. edit — add CITIZEN role round-trips without JsonMappingException (CCRS#439) | skip | skip | skip | skip | — |
| admin | 5. deactivate — INACTIVE + deactivation reason applied | skip | skip | skip | skip | — |
| admin | 5. inline edit — UI save round-trips via localizationUpsert + cache-bust | skip | skip | skip | skip | — |
| admin | 5. list footer count matches /pgr-services/v2/request/_count | **fail** | skip ◐ | skip | skip | — |
| admin | 5. tenant parity — api create at root is visible at city tenant | skip | skip | skip | skip | — |
| admin | 5a. Show page renders "Related" reverse references (complaint-types + employees) | skip | skip | skip | skip | — |
| admin | 5b. deactivation guard probes designation + employee APIs | skip | skip | skip | skip | — |
| admin | 5c. API update round-trip preserves auditDetails on a department | skip | skip | skip | skip | — |
| admin | 6. bulk export round-trip — downloaded xlsx parses | skip | skip | skip | skip | — |
| admin | 6. create via API — new tenant row shows up in the UI list | skip | skip | skip | skip | — |
| admin | 6. missing locale translation renders em-dash placeholder | skip | skip | skip | skip | — |
| admin | 6. reset password — collapsed by default, expand rotates token | skip | skip | skip | skip | — |
| admin | 6. status + date filters fire as XHR query params | skip | skip | skip | skip | — |
| admin | 7. bulk import — 3 valid + 2 invalid rows, create 3 lands | skip | skip | skip | skip | — |
| admin | 7. department filter narrows visible rows | skip | skip | skip | skip | — |
| admin | 7. module filter narrows rows | skip | skip | skip | skip | — |
| admin | 8. show page renders address extras and a working geo link | skip | skip | skip | skip | — |
| admin | 9. mobile-only citizen heuristic shows suffix on Show page | skip | skip | skip | skip | — |
| admin | API: 19 SERVICEDEFS.<categoryCode> rows exist in en_IN AND sw_KE | skip | skip | skip | skip | — |
| admin | API: rainmaker-common sw_KE search returns rows (not the broken sw_KEIN) | skip | skip | skip | skip | — |
| admin | fills the create form and submits — tenant correct + form clears | skip | skip | skip | skip | — |
| api+smoke | 10 — citizen creates complaint for PENDINGFORASSIGNMENT escalation | skip | skip | skip | skip | — |
| api+smoke | 11 — ESCALATE from PENDINGFORASSIGNMENT (self-loop, pre-assignment) | skip | skip | skip | skip | — |
| api+smoke | 12 — cleanup: assign and resolve the PFA-escalated complaint | skip | skip | skip | skip | — |
| api+smoke | 13 — auto-escalation: SLA breach triggers scheduler | skip | skip | skip | skip | — |
| api+smoke | 5 — citizen verifies complaint is resolved | skip | skip | skip | skip | — |
| api+smoke | 6 — manual ESCALATE level 0→1 | skip | skip | skip | skip | — |
| api+smoke | 7 — verify escalation: workflow action + PGR assignee | skip | skip | skip | skip | — |
| api+smoke | 8 — second ESCALATE level 1→2 (skip if no second-level supervisor) | skip | skip | skip | skip | — |
| api+smoke | 9 — resolve the escalated complaint | skip | skip | skip | skip | — |
| api+smoke | ADMIN can still oauth/token immediately after a force-recreate flip | skip | skip | skip | skip | — |
| api+smoke | HRMS _count returns employee count without offset/limit in URL | skip | skip | skip | skip | — |
| api+smoke | HRMS _search response contains employee records | skip | skip | skip | skip | — |
| api+smoke | HRMS _search returns employee data without offset/limit in URL | skip | skip | skip | skip | — |
| api+smoke | HRMS _search with explicit offset/limit preserves them | skip | skip | skip | skip | — |
| api+smoke | KC client has deployment domain in redirect URIs | skip | skip | skip | skip | — |
| api+smoke | KC CORS allows deployment domain | skip | skip | skip | skip | — |
| api+smoke | KC OIDC endpoints are accessible (not blocked by proxy) | skip | skip | skip | skip | — |
| citizen+employee | #441 — submit rating without "What was good?" boxes does not crash | skip | skip | skip | skip | — |
| citizen+employee | 3 — admin sees complaint in PGR inbox (UI) | skip | skip | skip | skip | — |
| citizen+employee | 4 — admin assigns complaint via UI | skip | skip | skip | skip | — |
| citizen+employee | 5 — admin resolves complaint via UI | skip | skip | skip | skip | — |
| citizen+employee | 6 — citizen sees resolved complaint on complaints page (UI) | skip | skip | skip | skip | — |
| citizen+employee | auto-skip-login: single-language tenant lands on login | skip | skip | skip | skip | — |
| citizen+employee | HELPLINE sidebar item is reachable + click-actionable | skip | skip | skip | skip | — |
| citizen+employee | IM options hidden; HRMS + Complaint Registry visible | **fail** | skip ◐ | skip | skip | — |
| citizen+employee | language-selection: shows Choose Language and Continue navigates onward | skip | skip | skip | skip | — |
| citizen+employee | locality filter → only rows in the chosen leaf boundary @p0 | skip | skip | skip | skip | — |
| citizen+employee | login + chrome + visible decrypt + inbox honest drives | skip | skip | skip | skip | — |
| citizen+employee | PENDINGATLME → Escalate → PENDINGATSUPERVISOR (workflow state moves) | skip | skip | skip | skip | — |
| citizen+employee | PGR _search returns service.rating + workflow.action=RATE for the rated complaint | skip | skip | skip | skip | — |
| citizen+employee | REJECT (GRO) with a rejection reason → REJECTED, reason on timeline @p0 | skip | skip | skip | skip | — |
| citizen+employee | sidebar avatar img.src changes after save without a hard refresh | skip | skip | skip | skip | — |
| lifecycle | 1 — acquire tokens | skip | skip | skip | skip | — |
| lifecycle | 2 — verify ESCALATE allows SYSTEM role on PENDINGATLME | skip | skip | skip | skip | — |
| lifecycle | 3 — verify HRMS reportingTo chain has at least one link | skip | skip | skip | skip | — |
| lifecycle | 4 — auto-escalation: scheduler fires within ~120 s of SLA breach | skip | skip | skip | skip | — |
| specs | invalid postal code (6 digits / Indian format) is rejected | **fail** | skip ◐ | skip | skip | — |
| specs | invalid postal code (short / 3 digits) is rejected | **fail** | skip ◐ | skip | skip | — |
