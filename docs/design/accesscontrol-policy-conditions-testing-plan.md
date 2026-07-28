# Testing Plan — Access-Control Policy Conditions (backend slice)

Companion to [`accesscontrol-policy-conditions-design.md`](accesscontrol-policy-conditions-design.md).
Covers the implemented slice: `egov-accesscontrol` schema/CRUD changes, and the PGR
`/request/_search` reference rule (citizen-self / employee-department scoping) in `pgr-services`.
UI verification is explicitly out of scope — per the agreed rollout, the UI is wired up only after
this backend contract is exercised and frozen.

JUnit coverage (unit + persistence-integration) already proves the logic in isolation; this plan is
the API-level pass to confirm real end-to-end behavior against a running stack.

---

## 0. Getting a stack up to test against (`local-setup/`)

This repo's `local-setup/docker-compose.yml` runs ~20 containers behind a single Kong gateway at
`http://localhost:18000` — every curl below goes through that one host, matching how
`local-setup/README.md`'s own "API Access" section is written.

```bash
cd local-setup
docker compose up -d
watch 'docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -v "Exited"'   # wait for healthy
```

**Important**: `pgr-services` and `egov-accesscontrol` in that compose file run **pre-built images**
(`egovio/pgr-services:...`, `egovio/egov-accesscontrol:...`), not the source in this workspace. To
actually exercise the changes made in this session you need to get your locally-built jars into
those two running containers:
- `pgr-services` — use the `redeploy-pgr-backend` skill (rebuilds the jar and hot-swaps it into the
  `pgr-services` container without a full compose rebuild).
- `egov-accesscontrol` — no skill wired up for this yet; ask and I'll do it manually
  (`mvn -pl core-services/egov-accesscontrol package`, `docker cp` the jar in, `docker compose
  restart egov-accesscontrol`).

**Also required**: the MDMS data condition on action 2008 needs to actually be loaded into this
stack's MDMS instance — either by re-running whatever seeded `ACCESSCONTROL-ACTIONS-TEST` in the
first place (`utilities/default-data-handler`'s bulk loader), or by `_update`-ing that one MDMS
record directly (step 2.10 below shows how to read it back to confirm).

Get an auth token (default local-setup superuser credentials, tenant `pg`):

```bash
curl -s -X POST "http://localhost:18000/user/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "username=ADMIN&password=eGov@123&tenantId=pg&grant_type=password&scope=read&userType=EMPLOYEE"
```

Take `access_token` from the response as `authToken` below — Kong's auth-enrichment plugin
resolves the rest of `userInfo` (uuid/roles/type) from that token, so requests only need
`{"apiId":"Rainmaker","authToken":"<access_token>"}` in `RequestInfo`. For a citizen persona,
repeat the login with `userType=CITIZEN` and that citizen's mobile number/password; for
department-scoped employee tests you'll need HRMS-onboarded employees in different departments
(see `local-setup/README.md`'s HRMS employee seeding section) rather than the `ADMIN` superuser,
since `ADMIN` is tenant-wide and will bypass the rule under test.

---

## 1. `egov-accesscontrol` — schema round-trip, zero behavior change

Run against a deployed `egov-accesscontrol` (e.g. via the local-setup stack).

| # | Step | Expected |
|---|------|----------|
| 1.1 | `POST /access/v1/actions/_create` with an action carrying `method`, `resource`, `condition` set | 201, response echoes back the three fields unchanged |
| 1.2 | `POST /access/v1/actions/_search` (or the role-action list endpoint) for that action | Response includes `method`/`resource`/`condition` exactly as created |
| 1.3 | `POST /access/v1/actions/_update` changing `method`/`resource`/`condition` on the same action | Response reflects the new values; re-fetch confirms persistence |
| 1.4 | Create/search an action **without** setting the new fields (today's normal flow) | `method`/`resource`/`condition` come back `null`; nothing else on the response changes |
| 1.5 | `POST /access/v1/actions/_authorize` for a handful of existing, unmodified URL-only actions/roles (pick some already known allow/deny pairs) | Identical allow/deny verdict to the pre-change build — this is the explicit "no behavior change" check from the design doc's rollout step 1 |

## 2. `pgr-services` `/request/_search` — the reference rule

Seed one tenant with:
- Two citizens, **Citizen A** and **Citizen B**, each with at least one complaint.
- Two departments, **SANITATION** and **ROADS**, each with at least one complaint (department is
  resolved from MDMS at complaint create time — use complaint types mapped to different
  departments).
- Two localities/wards, **WARD_5** and **WARD_9** (the complaint's `address.locality.code`), each
  with at least one SANITATION complaint — needed to exercise the jurisdiction axis (§2.4a) as a
  second, independent restriction alongside department.
- One employee in SANITATION assigned (via HRMS `jurisdictions[]`) to WARD_5 only, one employee
  holding a tenant-wide role (e.g. `PGR_ADMIN`).

| # | Step | Expected |
|---|------|----------|
| 2.1 | Citizen A calls `_search` with no params | Only Citizen A's own complaints (existing behavior, unaffected) |
| 2.2 | Citizen A calls `_search?ids=<Citizen B's complaint id>` | **Empty result** — this is the gap closed by this change; today (pre-change) this leaks Citizen B's complaint |
| 2.3 | Citizen A calls `_search?serviceRequestId=<Citizen B's serviceRequestId>` | Empty result, same reasoning as 2.2 |
| 2.4 | SANITATION/WARD_5 employee calls `_search` with any allowed employee param (e.g. `applicationStatus=PENDINGFORASSIGNMENT`) | Only SANITATION **and** WARD_5 complaints returned — a SANITATION complaint in WARD_9 must NOT appear, even though department matches (jurisdiction is now a second, independently-enforced axis, not just department) |
| 2.4a | Same employee calls `_search?ids=<a SANITATION complaint in WARD_9>` | Empty result — proves jurisdiction is enforced even when department alone would have allowed it |
| 2.5 | Tenant-wide role (e.g. `PGR_ADMIN`) calls `_search` | All complaints matching the query, unrestricted regardless of department or jurisdiction — confirms the bypass axis works |
| 2.6 | Force an HRMS failure/empty-assignment for an employee (e.g. temporarily unassign them in HRMS, or remove their `jurisdictions[]` entry while keeping their department assignment) and call `_search` | **Zero results**, not a 500 and not "see everything" — fail-closed; a WARN/INFO should appear in `pgr-services` logs from `PrincipalScopeResolver` (`"no HRMS jurisdiction assignment"` or `"no active HRMS department assignment"`) and `SearchAccessPolicyService` |
| 2.7 | Repeat 2.1, 2.4, 2.5 against `/request/_count` | Count matches the number of rows `_search` would return for the same caller/params |
| 2.8 | Call `/request/_plainsearch` as any of the above principals | Behavior unchanged from before this change (cross-tenant, unrestricted) — explicitly out of scope for this rule |
| 2.9 | Tail `pgr-services` logs while running 2.2–2.4 | No `SearchAccessPolicyService: dropping complaint ... (SQL-level scope should already have excluded this; check for drift)` WARN should appear — if it does, the SQL-level scope and the JsonLogic condition have drifted apart and need reconciling before sign-off |
| 2.10 | Call accesscontrol's own `/access/v1/actions/mdms/_get` directly (not through pgr-services) — see curl below | Response's `actions` array includes id 2008 (`url=/pgr-services/v2/request/_search`) carrying `method`/`resource`/`condition` — confirms the data landed in MDMS and is visible for this caller's roles, independent of pgr-services' cache |
| 2.11 | Edit the `condition` on that MDMS entry (e.g. temporarily remove it or break the JSON) and call `_search` within the 15-minute cache window, then again after it expires | Within the window: previous behavior persists (cached — but only if it was a **successful** prior resolution; see the "only positive hits are cached" limitation below). After expiry: **zero results** (fail-closed — a missing/malformed condition is never treated as "no restriction") and an `AccessPolicyRegistry`/`PolicyEvaluator` ERROR log appears |

Curl for 2.10 (mirrors the exact request shape pgr-services itself sends, minus the `enabled` field
— see `MDMSUtils.fetchAccessControlActions`'s javadoc for why `enabled` is deliberately omitted):

```bash
curl -s -X POST "http://localhost:18000/access/v1/actions/mdms/_get" \
  -H "Content-Type: application/json" \
  -d '{
    "roleCodes": ["CITIZEN"],
    "tenantId": "pg",
    "actionMaster": "actions-test",
    "RequestInfo": {"apiId": "Rainmaker", "authToken": "<access_token>"}
  }' | jq '.actions[] | select(.url == "/pgr-services/v2/request/_search")'
```

Curls for 2.1/2.2/2.4/2.5 (swap `<access_token>` for the relevant persona's token, `<tenantId>` for
the seeded tenant, and `<citizen-B-complaint-id>` for a real id from your seed data):

```bash
# 2.1 — citizen A, no params
curl -s -X POST "http://localhost:18000/pgr-services/v2/request/_search?tenantId=<tenantId>&limit=10&offset=0" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","authToken":"<citizenA_token>"}}' | jq

# 2.2 — citizen A trying to fetch citizen B's complaint by id (expect empty "ServiceWrappers")
curl -s -X POST "http://localhost:18000/pgr-services/v2/request/_search?tenantId=<tenantId>&ids=<citizen-B-complaint-id>" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","authToken":"<citizenA_token>"}}' | jq

# 2.4 — SANITATION employee (expect only SANITATION complaints)
curl -s -X POST "http://localhost:18000/pgr-services/v2/request/_search?tenantId=<tenantId>&applicationStatus=PENDINGFORASSIGNMENT" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","authToken":"<sanitationEmployee_token>"}}' | jq

# 2.5 — tenant-wide role (expect everything, unrestricted)
curl -s -X POST "http://localhost:18000/pgr-services/v2/request/_search?tenantId=<tenantId>" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","authToken":"<adminEmployee_token>"}}' | jq

# 2.7 — count, same params/persona as above, compare to the _search result length
curl -s -X POST "http://localhost:18000/pgr-services/v2/request/_count?tenantId=<tenantId>" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","authToken":"<citizenA_token>"}}'
```

Tail logs while running these (2.9):

```bash
docker compose logs -f pgr-services | grep -E "AccessPolicyRegistry|SearchAccessPolicyService|PolicyEvaluator"
```

## 2b. Field-level attribute masking (`citizen.mobileNumber`)

Extends the same action (id 2008) with a structured `resource` object (see
[`field-level-attribute-access-design.md`](field-level-attribute-access-design.md)) — verifies
`FieldVisibilityService` alongside the record-level checks in §2, same tenant/seed data.

| # | Step | Expected |
|---|------|----------|
| 2b.1 | Citizen A calls `_search` for their own complaint | `citizen.mobileNumber` visible in full (own-record condition passes) |
| 2b.2 | SANITATION employee (GRO/LME) calls `_search` for a complaint they're allowed to see (own department) | `citizen.mobileNumber` is masked (`XXXXXXXX##`, last 2 digits per the seeded `MASK_SHOW_LAST_N` rule) — the field rule is independent of the record-level department check already passing |
| 2b.3 | Tenant-wide role (e.g. `PGR_ADMIN`) calls `_search` | `citizen.mobileNumber` visible in full (`tenantWide` condition bypass) |
| 2b.4 | Call `_plainsearch` as a GRO/LME | `citizen.mobileNumber` masked too — field masking applies there despite `_plainsearch` staying record-level unrestricted (§2.8) |
| 2b.5 | Temporarily break the `condition` or `onDeny.strategy` on the `citizen.mobileNumber` rule in MDMS (e.g. remove `"condition"`, or set `"strategy": "not-a-real-strategy"`) | Field is masked for **everyone**, including the record's own citizen — fail-closed; an `AccessPolicyRegistry`/`MaskingStrategy` ERROR log names the exact path and the fallback applied |
| 2b.6 | Add a second `attributes` entry for a different field (e.g. `citizen.emailId`) via MDMS only, no redeploy | New field is masked/visible per its own condition on the next cache refresh — confirms "add a field = data change only" |

Curl (reuses 2.1's citizen token vs. 2.4's SANITATION-employee token):
```bash
curl -s -X POST "http://localhost:18000/pgr-services/v2/request/_search?tenantId=<tenantId>&ids=<complaint-id>" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","authToken":"<sanitationEmployee_token>"}}' \
  | jq '.ServiceWrappers[].service.citizen.mobileNumber'
```

## 3. Regression pass

Run the existing `_search` test matrix (serviceCode filter, applicationStatus filter, date range,
`sortBy`/`sortOrder`, pagination via `limit`/`offset`) as the tenant-wide role from 2.5, confirming
identical results to the pre-change behavior — the scope axis should be a no-op for an unrestricted
caller.

## 4. Sign-off

Once 1.x and 2.x pass against a real deployment:
- Fine-tune the JsonLogic condition / SQL predicates if any gap surfaces (see design doc §3.5/§3.6
  for the fail-closed contract to preserve while tuning).
- Only then proceed to wiring the UI against this contract, per the agreed rollout.

## Known, accepted limitations (carried forward, not blocking)

- `/request/_count` applies the SQL-level scope only; there's no per-row JsonLogic re-check for a
  scalar count (nothing to filter). If SQL scope and the JsonLogic condition ever drift, `_count`
  and `_search` could disagree — watch for this in 2.7/2.9.
- The condition for `/request/_search` is fetched live from the `ACCESSCONTROL-ACTIONS-TEST
  .actions-test` MDMS master (action id 2008, url `/pgr-services/v2/request/_search`) via
  `MDMSUtils.fetchAccessControlActions`, cached per `(tenant, url)` for 15 minutes in
  `AccessPolicyRegistry` — changing the condition is an MDMS data change, not a pgr-services
  deploy. An MDMS outage or a missing/edited-out `condition` field fails closed (denies
  everything) for up to the cache TTL; test 2.6 exercises this. Per the current implementation
  scope this per-URL MDMS lookup is still PGR-search-specific — the design doc's rollout
  eventually moves this behind a generic accesscontrol/gateway policy lookup usable by any
  service/action.
- Department scoping matches on `eg_pgr_service_v2.additionaldetails->>'department'`, populated
  only at complaint create/update time. Complaints created before this enrichment existed may have
  a null department and will be invisible to department-scoped employees (tenant-wide roles still
  see them).
