# Part B — Attribute Resolution (roles, jurisdiction, department)

**Status:** v2, 2026-06-23 · **Maps to:** implementation-plan Phase 1 · **Blocked by:** Part A (trust foundation) · **Blocks:** Part C (attribute-scope engine)
**Reads:** `00-requirements.md` §4 (attribute-scope model), §5 (ownership split), §6 (fail-closed NFR), §7 (hazards 2/3/4/5); `rbac-kpi-access-implementation-plan.md` §1, Phase 1; `dashboard-query-api-design.md` §5.

> **Grounding rule (inherited from Part 00):** every "today it does X" is anchored to a file:line actually read. Gaps are stated as gaps with the anchor that proves the absence. **v2 note:** all anchors below were re-opened against `CCRS/backend/pgr-services` (the vendored, deploy-target tree — NOT `municipal-services/pgr-services`) during pass-2 revision; the boundary-resolution path was rebuilt after pass-1 found the original endpoint cited a field it does not return.

---

## Goal & responsibilities

**This part owns exactly one transform:** given a **trusted** principal from Part A — `{uuid, type, roles[], tenantId}` that has already been validated against the token and is no longer attacker-controlled — produce a **`PrincipalAttributes`** value object carrying the caller's *row-scoping attributes*:

- **`boundaryPrefixes[]`** — the caller's HRMS jurisdiction boundary codes, each resolved to a delimiter-anchored materialized-path prefix (`ke.bomet.CENTRAL.WARD_3|`) ready for the `boundary_path LIKE` predicate.
- **`departmentCodes[]`** — the caller's active HRMS assignment department codes, intersected with the tenant's MDMS Department code-space, ready for the `department_code IN (…)` predicate.
- **`citizenUuid`** (passthrough) — already derivable in `AnalyticsScope` today; Part B keeps it on the same object so the scope layer has one input.
- **`tenantStateLevel`** — the boolean Part C's `applyScope()` needs to choose `LIKE prefix||'%'` (state-root) vs `= tenantId` (city) for the *tenant* predicate. Carried forward so Part C's `from(PrincipalAttributes)` reproduces today's tenant isolation exactly (see B.1 / B-2 fix).
- **`scopeLevel`** — an enum (`CITIZEN | EMPLOYEE_SCOPED | TENANT_ADMIN`) that records *why* the attribute lists are empty, so Part C can tell "admin → no restriction" apart from "employee → resolution failed → empty → deny."
- **`resolutionComplete`** — the hard fail-closed trip: `false` means an HRMS/boundary hop failed or a jurisdiction code did not resolve; Part C must deny, not fall through to tenant-only.

**What this part explicitly does NOT own:**

- **It does not validate identity.** That is Part A. Part B assumes `requestInfo.getUserInfo()` is already trustworthy; if Part A is not deployed, Part B resolves attributes for a *spoofed* principal and is theater (requirements §7.1). Part B treats `userInfo==null` as fail-closed deny, but cannot itself detect a *populated-but-unsigned* forged body — that is Part A's job (see *Interfaces → Part A*).
- **It does not build the `WHERE` clause.** It produces *values*; Part C's generalized `AnalyticsScope.attrScopes` + `AnalyticsPlanner.applyScope()` loop emit SQL. Part B stops at "here are the anchored prefixes and the dept codes."
- **It does not decide KPI visibility (Part D) or inline-grammar gating (Part F).** Those read `roles[]` off the same principal but are orthogonal to attribute resolution.
- **It does not own the events-MV `department_code` migration, nor the daily-grain citizen-column fix.** Those physical-schema gaps are Part C / plan §3 step 4. Part B only *flags the code-space consistency risk* (HRMS vs MDMS) and the grain-binding gaps as ship-blocking preconditions Part C must close.
- **It does not author HRMS, boundary, or department masters.** "Consume identity, don't rebuild it" (requirements §5). Part B is strictly read-only against egov-hrms, boundary-service/boundary-relationship, and MDMS.

---

## Current code reality (file:line — what exists vs what's missing)

### What exists

| Capability | State | Anchor |
|---|---|---|
| Citizen self-scope derivation from `userInfo` | **Done** (but on an untrusted principal) | `AnalyticsScope.resolve()` reads `requestInfo.getUserInfo()` L34, `u.getType()` L36, `u.getRoles()` L38–42, sets `citizenUuid` L44 |
| `boundaryPrefix` field + LIKE clause | **field exists, never populated** — hardcoded `null` | `AnalyticsScope.java:24` (field), `:47` (`return new AnalyticsScope(…, null)`); planner consumes it at `AnalyticsPlanner.java:247–249` with the escape already coded |
| `tenantStateLevel` field + tenant predicate split | **Done** | `AnalyticsScope.java:22` (field), `:32` (computed from `stateLevelLen`); `AnalyticsPlanner.java:243` (`LIKE` at state) vs `:244` (`= tenantId` at city) |
| Per-grain boundary column binding | **Done** all three grains | `AnalyticsCatalog.java` facts `boundaryColumn="boundary_path"` (Grain ctor positional arg, **L78**), events (**L96**), daily (**L108**) |
| `department_code` as facts column | **Done** (groupable + filterable) | `AnalyticsCatalog.java:59` (groupable list), `:66` (filterable list); MV source `data->>'department'` at migration **L147**, folded into facts select **L169** |
| **An existing HRMS read seam inside pgr-services** | **Done** — this is the seam Part B extends | `HRMSUtil.getDepartment()` (`HRMSUtil.java:44`); builds `/egov-hrms/employees/_search?tenantId=&uuids=` (`getHRMSURI` L105–115); calls `serviceRequestRepository.fetchResult` L50; parses `$.Employees.*.assignments.*.department` (`PGRConstants.java:41`) |
| HRMS current-assignment awareness | **Done** in a sibling path | `PGRConstants.java:168` `$.Employees[0].assignments[?(@.isCurrentAssignment==true)].reportingTo` — proves assignments carry `isCurrentAssignment`; consumed by `HRMSUtil.getSupervisorUuid()` (`HRMSUtil.java:73`) |
| HRMS host/endpoint config | **Done** | `getHRMSURI` reads `config.getHrmsHost()` / `config.getHrmsEndPoint()` (`HRMSUtil.java:107–108`) |
| Boundary-service host/endpoint config | **Done** | `application.properties` `egov.boundary.host` + `egov.boundary.search.url=/boundary-service/boundary/_search` |
| Materialized path construction | **Done & canonical** | grain MV: `(ancestralmaterializedpath \|\| '\|' \|\| code) AS boundary_path` from `boundary_relationship` (`V20260608000000__create_v2_grain_mvs.sql:23`, self-INCLUDED); identical recursive path-build in MCP `digit-mcp/src/tools/boundary.ts:37–60` |
| Department master / code space | **Exists, two shapes** | `common-masters.Department` — nairobi **v2-wrapped** `{"tenantId":…,"data":{"code":"DEPT_01"…}}` (`CCRS/ansible/nairobi-mdms/mdms/common-masters/Department.json`), ddh **v1-flat** `{"code":"DEPT_35"…}` (`CCRS/utilities/default-data-handler/src/main/resources/mdmsData/common-masters/common-masters.Department.json`) |

### What is missing (the gap Part B fills)

1. **No jurisdiction resolution anywhere.** `HRMSUtil` reads `assignments.*.department` (`PGRConstants.java:41`) and `assignments[?isCurrentAssignment].reportingTo` (`PGRConstants.java:168`) but **never reads `jurisdictions[*].boundary`**. There is no constant, no JsonPath, no method for it. The HRMS employee payload's `Jurisdictions` section is real (the configurator form renders it — `tests/integration-tests/.../employee-create.spec.ts:93` lists "Jurisdictions" as one of the four canonical sections; field name `boundary` cross-confirmed against `digit-ui-v2/src/api/types.ts:240` and MCP `hrms.ts:199–212`), but pgr-services has never consumed it. **Net-new.**
2. **No boundary-code → materialized-path resolver in Java.** The path is built in SQL inside the MV (`…grain_mvs.sql:23`) from `boundary_relationship.ancestralmaterializedpath`, and in TypeScript in MCP (`boundary.ts:43–60`), but pgr-services has **no** Java path that returns `ancestralmaterializedpath` for a boundary code. **`/boundary-service/boundary/_search` does NOT carry it** (see B.4 — the v2 entity model has no such field). **Net-new, and re-pointed to the boundary-relationship source.**
3. **No `PrincipalAttributes` class.** `AnalyticsScope.resolve()` (`AnalyticsScope.java:31`) takes `RequestInfo` and *inlines* citizen logic; there is no separate attribute holder and no HRMS/boundary fan-out. The Javadoc itself flags this: *"Full HRMS jurisdiction resolution is the documented extension point"* (`AnalyticsScope.java:16–18`), and L46 `// boundaryPrefix: extension point for HRMS-jurisdiction-restricted employees (TODO).`
4. **No caching layer.** `HRMSUtil` calls HRMS synchronously per invocation with no cache. Resolving jurisdiction+department on every `_query` would add two network hops per request.
5. **No code-space consistency check.** Nothing verifies HRMS assignment dept codes ⊆ MDMS `common-masters.Department` codes. The facts column is sourced from **MDMS ServiceDefs** `data->>'department'` (`…grain_mvs.sql:147`) via `LEFT JOIN mdms m ON m.service_code = s.servicecode` (`:227`); the user's dept comes from **HRMS assignment**. If they diverge — or the join misses — `department_code IN (…)` silently matches nothing (requirements §7.3). **No guard today.**

---

## Design

### B.1 Data model — `PrincipalAttributes`

A new immutable value object, the single output of this part. It is *not* `AnalyticsScope` (that is Part C's generalized type with `attrScopes`); it is the **raw resolved attributes** Part C consumes to build `attrScopes`. **It is a strict superset of every field `AnalyticsScope` carries today** (`tenantId`, `tenantStateLevel`, `citizenUuid`, plus the new attribute lists) so Part C's `from(PrincipalAttributes)` can rebuild today's tenant + citizen predicates without losing information — this closes B-2 (pass-1: `tenantStateLevel` was dropped).

```java
package org.egov.pgr.analytics;

import java.util.List;
import java.util.Collections;

/** Server-resolved row-scoping attributes for a TRUSTED principal (Part A output).
 *  Read-only projection of egov-hrms + boundary-relationship + MDMS Department.
 *  Never built from raw body fields.
 *  Empty attribute lists are MEANINGFUL: distinguish admin (no restriction) from employee
 *  (resolved-empty => deny) via scopeLevel, NOT by list emptiness. */
public final class PrincipalAttributes {

    public enum ScopeLevel { CITIZEN, EMPLOYEE_SCOPED, TENANT_ADMIN }

    public final String tenantId;
    public final boolean tenantStateLevel;        // carried forward from AnalyticsScope.java:22 — Part C tenant predicate
    public final String uuid;
    public final ScopeLevel scopeLevel;
    public final String citizenUuid;              // non-null only for ScopeLevel.CITIZEN
    public final List<String> boundaryPrefixes;   // delimiter-anchored, e.g. "ke.bomet.CENTRAL.WARD_3|"
    public final List<String> departmentCodes;    // MDMS-aligned codes (already intersected), e.g. ["DEPT_03"]
    public final boolean resolutionComplete;      // false => an HRMS/boundary hop failed => fail closed

    private PrincipalAttributes(String tenantId, boolean tenantStateLevel, String uuid, ScopeLevel level,
                                String citizenUuid, List<String> boundaryPrefixes, List<String> departmentCodes,
                                boolean resolutionComplete) {
        this.tenantId = tenantId; this.tenantStateLevel = tenantStateLevel; this.uuid = uuid;
        this.scopeLevel = level; this.citizenUuid = citizenUuid;
        this.boundaryPrefixes = Collections.unmodifiableList(boundaryPrefixes);
        this.departmentCodes  = Collections.unmodifiableList(departmentCodes);
        this.resolutionComplete = resolutionComplete;
    }

    static PrincipalAttributes citizen(String tenantId, boolean stateLevel, String uuid) {
        return new PrincipalAttributes(tenantId, stateLevel, uuid, ScopeLevel.CITIZEN, uuid,
                Collections.emptyList(), Collections.emptyList(), true);
    }
    static PrincipalAttributes admin(String tenantId, boolean stateLevel, String uuid) {
        return new PrincipalAttributes(tenantId, stateLevel, uuid, ScopeLevel.TENANT_ADMIN, null,
                Collections.emptyList(), Collections.emptyList(), true);
    }
    static PrincipalAttributes scoped(String tenantId, boolean stateLevel, String uuid,
                                      List<String> prefixes, List<String> depts, boolean complete) {
        return new PrincipalAttributes(tenantId, stateLevel, uuid, ScopeLevel.EMPLOYEE_SCOPED, null,
                prefixes, depts, complete);
    }
}
```

> **Why `scopeLevel` and not "empty list means admin":** requirements §6 (fail-closed) demands a missing HRMS row yield **empty/denied, never unscoped**. If Part C only saw `boundaryPrefixes=[]`, it could not distinguish a `TENANT_ADMIN` (legitimately unrestricted) from an `EMPLOYEE_SCOPED` whose HRMS row failed to resolve. The enum makes the difference explicit; `resolutionComplete=false` is the hard fail-closed trip.
>
> **Why `tenantStateLevel` is on the object:** `applyScope` (`AnalyticsPlanner.java:243–244`) branches on it for the *tenant* predicate — `LIKE tenantId||'%'` at state root vs `= tenantId` at city. Drop it and Part C either collapses every tenant to `=` (state-root admins see nothing) or to `LIKE` (`ke.bomet` LIKE-matches `ke.bometville` — a cross-tenant leak). The resolver computes it from `stateLevelLen` exactly as `AnalyticsScope.java:32` does and stores it here.

### B.2 The resolver — `PrincipalAttributesResolver`

A new `@Component` that fans out to the seams. It deliberately **reuses `HRMSUtil`'s HTTP plumbing** (`serviceRequestRepository.fetchResult`) rather than introducing a parallel client.

```java
@Component
public class PrincipalAttributesResolver {

    private final HRMSUtil hrmsUtil;                     // extended (see B.3)
    private final BoundaryPathResolver boundaryResolver; // new (B.4)
    private final DepartmentCodeSpace deptCodeSpace;     // new (B.5) — consistency guard + cache
    private final PGRConfiguration config;
    // role-set classification reuses the exact predicate AnalyticsScope uses today

    public PrincipalAttributes resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen) {
        // compute the SAME tenant-state flag AnalyticsScope.java:32 computes, and carry it forward (B-2 fix)
        boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;

        User u = requestInfo == null ? null : requestInfo.getUserInfo();
        if (u == null) {
            // No principal at all — Part A should have rejected this. Fail closed: deny everything.
            return PrincipalAttributes.scoped(tenantId, stateLevel, null,
                       List.of(), List.of(), /*complete=*/false);
        }
        RoleClass rc = classify(u);   // CITIZEN | EMPLOYEE | ADMIN — same logic as AnalyticsScope L36–44

        if (rc == RoleClass.CITIZEN)  return PrincipalAttributes.citizen(tenantId, stateLevel, u.getUuid());
        if (rc == RoleClass.ADMIN)    return PrincipalAttributes.admin(tenantId, stateLevel, u.getUuid());

        // EMPLOYEE_SCOPED: resolve jurisdiction + department from HRMS, cached.
        EmployeeAttrs hrms = hrmsCache.get(cacheKey(u.getUuid(), tenantId)); // B.6 caching
        if (hrms == null || hrms.failed) {
            // HRMS unreachable / null result / no employee row => fail closed (requirements §6, §7.5 drift).
            return PrincipalAttributes.scoped(tenantId, stateLevel, u.getUuid(), List.of(), List.of(), false);
        }
        List<String> prefixes = boundaryResolver.toPrefixes(hrms.boundaryCodes, tenantId); // B.4
        List<String> depts    = deptCodeSpace.filterToKnown(hrms.departmentCodes, tenantId); // B.5
        // every jurisdiction code must resolve; an unresolved code => incomplete => Part C denies
        boolean complete = prefixes.size() == hrms.boundaryCodes.size();
        return PrincipalAttributes.scoped(tenantId, stateLevel, u.getUuid(), prefixes, depts, complete);
    }
}
```

**`classify(User)` is the exact predicate already shipped** in `AnalyticsScope.java:36–44`, lifted verbatim, plus an admin branch keyed on the admin role set named in requirements §2 (`PGR_ADMIN`/`DSS_ANALYST`/`SUPERADMIN`). Citizen = `type==CITIZEN && no employee role` (`AnalyticsScope.java:44`). The employee branch is the *default* for any non-citizen, non-admin principal. This keeps citizen behavior byte-identical to today and adds only the employee/admin split. It must not assume single-role (requirements §7.2 pollution — see Risks).

> **Fail-closed on an `EMPLOYEE_SCOPED` with zero attributes:** a non-citizen, non-admin employee whose HRMS row resolves to *both* `boundaryPrefixes=[]` and `departmentCodes=[]` (no jurisdiction AND no department) is **not** the same as an admin. Part C must treat `EMPLOYEE_SCOPED` with no attribute predicates as **deny** (see *Interfaces → Part C*), never tenant-wide. The contract carries `scopeLevel` precisely so this case cannot collapse into admin.

### B.3 HRMS read — extend `HRMSUtil`, don't fork it

`HRMSUtil.getHRMSURI()` (`HRMSUtil.java:105`) already produces the exact `_search?tenantId=&uuids=` URL Part B needs, and `getDepartment()` (`HRMSUtil.java:44`) already parses `$.Employees.*.assignments.*.department`. Part B adds **one method** that does a single HRMS fetch and pulls *both* attribute families from the one response (so we never make two HRMS calls for one employee):

```java
// HRMSUtil — new. SINGLE-UUID ONLY (see "[0]" note below). Does NOT throw on empty/parse-miss —
// deliberately UNLIKE getDepartment() (HRMSUtil.java:57-62), which throws PARSING_ERROR / DEPARTMENT_NOT_FOUND.
public EmployeeAttrs getEmployeeAttrs(String uuid, RequestInfo requestInfo, String tenantId) {
    StringBuilder url = getHRMSURI(Collections.singletonList(uuid), tenantId);  // reuse L105
    Object res;
    try {
        res = serviceRequestRepository.fetchResult(url,
                  RequestInfoWrapper.builder().requestInfo(requestInfo).build());  // reuse L50
    } catch (Exception e) {
        // NOTE: fetchResult itself SWALLOWS 5xx/timeout and returns null (ServiceRequestRepository.java:38-42 — fail-OPEN),
        // but RE-THROWS 4xx as ServiceCallException (:37). We catch here so a 4xx also fails CLOSED, not 500s the dashboard.
        log.warn("HRMS call failed for {} — failing closed", uuid, e);
        return EmployeeAttrs.failed();                 // => resolutionComplete=false upstream
    }
    if (res == null) return EmployeeAttrs.failed();    // 5xx/timeout swallowed by fetchResult => null => fail closed

    // Active-assignment departments. NOTE: filter to current/active assignments, unlike the
    // unfiltered getDepartment() at HRMSUtil.java:55 — a stale assignment must not widen scope (§7.5 drift).
    List<String> depts = safeRead(res,
        PGRConstants.HRMS_ACTIVE_DEPARTMENT_JSONPATH);   // safeRead returns [] on miss, never throws
    // Jurisdiction boundary codes — NET-NEW path (no existing constant).
    List<String> boundaryCodes = safeRead(res,
        PGRConstants.HRMS_JURISDICTION_BOUNDARY_JSONPATH);

    return new EmployeeAttrs(dedupe(boundaryCodes), dedupe(depts), /*failed=*/false);
}
```

New constants in `PGRConstants.java` (mirroring the L41/L168 style):

```java
public static final String HRMS_JURISDICTION_BOUNDARY_JSONPATH =
    "$.Employees[0].jurisdictions[*].boundary";
public static final String HRMS_ACTIVE_DEPARTMENT_JSONPATH =
    "$.Employees[0].assignments[?(@.isCurrentAssignment==true)].department";
```

> **`safeRead` must not inherit the sibling's throwing behavior (B-5 fix).** The existing `getDepartment()` (`HRMSUtil.java:55`) does `JsonPath.read(...)` and **throws** `CustomException("PARSING_ERROR")` on any parse miss (`HRMSUtil.java:57–58`) and `CustomException("DEPARTMENT_NOT_FOUND")` when the list is empty (`HRMSUtil.java:61–62`). `getEmployeeAttrs` must NOT do that: a supervisor with a valid jurisdiction but a momentarily-empty active department must fail *closed to empty department scope*, not 500 the dashboard. `safeRead` wraps `JsonPath.read` in a try/catch and returns an empty list on miss. This is a deliberate divergence from the sibling whose plumbing it reuses, documented so a future refactor doesn't "unify" them.

> **Why `isCurrentAssignment` here but `getDepartment()` uses the unfiltered `assignments.*.department` (`PGRConstants.java:41`):** the existing `getDepartment()` is used by the complaint *workflow* path where any assignment department is acceptable. For **row scope** a deactivated/historical assignment must NOT grant data access — scope reads the *current* assignment only.

> **`$.Employees[0]` is single-uuid-only (B-6 fix).** Unlike the workflow reads which use `$.Employees.*` (`PGRConstants.java:41`), `getEmployeeAttrs` indexes `[0]` and is therefore valid **only** for a single-uuid `_search` (which returns at most one employee). It must never be called with a batched uuid list — `[0]` would silently resolve only the first employee's jurisdiction and scope every batched caller to one person. The signature takes a single `String uuid`, not a list, to make this a compile-time contract; the resolver only ever resolves the *one* calling principal.

**Multiple active assignments / multiple jurisdictions are first-class.** Both JsonPaths return arrays; `boundaryCodes` and `departmentCodes` are lists. This is the "OR within an attribute" half of requirements §4 — a Sanitation supervisor of Wards 3 & 4 yields `boundaryCodes=[WARD_3,WARD_4]`, `departmentCodes=[SANI]`; Part C ORs within each and ANDs across.

### B.4 Boundary-code → materialized-path prefix — `BoundaryPathResolver` (re-pointed source)

HRMS gives boundary **codes** (`WARD_3`); the grains store **materialized paths** (`ke.bomet.CENTRAL.WARD_3`, `…grain_mvs.sql:23`). Part B resolves each code to its path and appends the delimiter to anchor the prefix.

**Source correction (B-1 fix — this is the one ship-blocking change from pass-1).** Pass-1 designed this against `/boundary-service/boundary/_search` returning a `materializedPath` field. That is **wrong**: there are two `Boundary` classes in pgr-services, and the design cited the wrong one.

- The **legacy** model `web/models/Boundary.java` *does* carry `materializedPath` (`@JsonProperty("materializedPath")` `:57`, field `:58` — verified `:57–59`) — but it is the old egov-location/rainmaker tree model (it also carries `latitude`/`longitude`/`label`/`children` at `:46–55`), not what the v2 endpoint returns. **The materializedPath-bearing model is the legacy one, not v2.**
- The **boundary-service v2** entity model — `web/models/boundary/Boundary.java` — which is what `egov.boundary.search.url=/boundary-service/boundary/_search` actually hits, has **only** `id, tenantId, code, geometry, auditDetails, additionalDetails` (`web/models/boundary/Boundary.java:24–42`) and **no `materializedPath` / `ancestralmaterializedpath` field at all.** boundary-service v2's `/boundary/_search` returns flat boundary *entities*; the ancestral path lives in the **`boundary_relationship`** table.

The grain MV reads exactly that table: `(ancestralmaterializedpath || '|' || code) AS boundary_path` FROM `boundary_relationship` (`…grain_mvs.sql:23`, self-INCLUDED). **`BoundaryPathResolver` therefore resolves against the same `boundary_relationship` source the grain reads, not `/boundary/_search`.**

> **Duplicate-code hazard (B-7 fix — the divergence a second read introduces).** Reading `boundary_relationship` is the *right table*, but a naïve per-code read is NOT automatically "path-identical by construction." The grain's `bnd` CTE does **not** select or filter by `tenantid`; it dedupes globally with `DISTINCT ON (code) … ORDER BY code, length(ancestralmaterializedpath) DESC` (`…grain_mvs.sql:21–25`) — i.e. **one winning row per code across the whole table, the deepest path** — and binds it to facts/events rows purely on `bnd.code = svc.locality_code` (`…grain_mvs.sql:94`, events; the facts MV joins the same way). So the path a row actually carries in `boundary_path` is *the global deepest-path row for that code*. If a boundary `code` is **duplicated** across the hierarchy or across tenants, a `WHERE tenantid = ? AND code = ?` lookup can resolve a **different** `ancestralmaterializedpath` than the one the grain bound — and the resolver's `LIKE` prefix would then miss the rows it should match (or match the wrong subtree). **A separate boundary read is a second source of truth that can disagree with the grain's own row.** Avoid this by anchoring on the grain's own representation, not a per-code re-derivation: resolve through the same global, tenant-agnostic, deepest-path-wins selection the MV uses (`DISTINCT ON (code) ORDER BY length(ancestralmaterializedpath) DESC`) so the resolver returns the exact `boundary_path` the row carries. Two implementation options, in preference order:

1. **Resolve via the grain's own `boundary_path`** (recommended — see Open-Q3). The materialized grains already store the authoritative, deepest-path, code-keyed value: `SELECT DISTINCT boundary_path FROM complaint_facts WHERE … code = ?` (or, equivalently, replicate the MV's exact `bnd` CTE — `DISTINCT ON (code) … ORDER BY length(ancestralmaterializedpath) DESC` against `boundary_relationship`, with **no `tenantid` filter**, matching `…grain_mvs.sql:21–25`). Either way the prefix is taken from the **same row representation** the grain bound, so a duplicated code cannot make Part B and the grain disagree. pgr-services already owns the DB connection and the grain MV proves the table is reachable; this adds zero network hops.
2. **`/boundary-relationship/_search`** (if the boundary-service owner prefers an API boundary over coupling pgr-services to the table). This must be confirmed to return `ancestralmaterializedpath` **and** to apply the same deepest-path-wins, code-keyed dedup before adoption — it is NOT proven in-tree, and boundary-service is not vendored in CCRS (theflywheel registry), so it cannot be grounded here. **Do not** use `/boundary/_search` for this — it cannot carry the column. Whichever option, the resolver must reproduce the MV's *selection* (global `DISTINCT ON (code)`, deepest path), not just its `|| '|' || code` reconstruction, or it reintroduces the divergence.

Either way the resolver reconstructs the *self-included* path exactly as the MV does and appends the anchor delimiter:

```java
@Component
public class BoundaryPathResolver {
    /** code -> "ancestralmaterializedpath|code|"  (self-included like the MV, trailing '|' = subtree anchor). */
    public List<String> toPrefixes(List<String> codes, String tenantId) {
        List<String> out = new ArrayList<>();
        for (String code : codes) {
            // cache value is the SELF-INCLUDED node path "ancestralmaterializedpath|code", matching grain_mvs.sql:23
            String nodePath = cache.get(tenantId, code);     // B.6 cache
            // resolve the SAME row the grain bound: global DISTINCT ON (code), deepest path, NO tenantid filter
            // (matches grain_mvs.sql:21-25), so a duplicated code cannot diverge from boundary_path.
            if (nodePath == null) nodePath = fetchAndCache(code); // grain's boundary_path / replicated bnd CTE (option 1)
            if (nodePath == null) continue;                  // unresolved code dropped => narrows; complete=false upstream
            out.add(nodePath + "|");                         // trailing delimiter anchors the subtree (requirements §4)
        }
        return out;
    }
}
```

**Anchoring + escaping split of responsibility:** Part B produces the *delimiter-anchored* prefix value (`…WARD_3|`). The `%`/`_`/`\` LIKE escaping stays where it already lives — `AnalyticsPlanner.java:249` (`.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")`). Part B does NOT pre-escape, because the planner already does and double-escaping would break the match. The contract is: **Part B = anchored raw prefix; Part C/planner = escape + `|| '%'`**. This exactly matches the boundary-only path the planner already wired at `AnalyticsPlanner.java:247–249`.

> **Path-vs-prefix subtlety (now grounded against the right source):** `boundary_relationship.ancestralmaterializedpath` is the path of *ancestors* (excludes self); the MV appends `'|' || code` to include self (`…grain_mvs.sql:23`). So the *full node path* is `ancestralmaterializedpath|code`, and the *subtree prefix* is that **plus a trailing `'|'`** so `WARD_3` does not prefix-match `WARD_30`. Because the resolver now anchors on the **grain's own representation** — the same global, code-keyed, deepest-path `DISTINCT ON (code)` selection the MV uses (`…grain_mvs.sql:21–25`), with no `tenantid` filter — the path it returns is the exact value the row carries, even for a duplicated code. (A per-code `WHERE tenantid=? AND code=?` read does NOT have this property — see the duplicate-code hazard above.) A test must still assert `BoundaryPathResolver`'s output equals the MV's `boundary_path || '|'` for the same code against real bomet boundary data (the MV is "validated against bomet data") — see Open Questions.

### B.5 Department code-space consistency — `DepartmentCodeSpace`

The biggest hidden risk (requirements §7.3, plan §6.3): the facts column `department_code` is MDMS-ServiceDefs-sourced via a LEFT JOIN (`…grain_mvs.sql:147`, `:227`), the user's dept is HRMS-assignment-sourced. Two distinct failure modes converge here:

1. **Code-list divergence.** If HRMS dept codes and MDMS ServiceDefs dept codes differ, `department_code IN (…)` matches nothing — a *silent* total scope loss that *looks like* "no data," not "denied."
2. **`NULL` department_code from the LEFT JOIN (README cross-cutting #3b).** `department_code` is `NULL` for any complaint whose `service_code` has no matching ServiceDefs row (`LEFT JOIN mdms m ON m.service_code = s.servicecode`, `…grain_mvs.sql:227`), and `NULL IN (…)` is never true. So even a perfectly-aligned dept code silently **under-scopes** away every complaint with an unmapped service. Part B cannot fix the join (that is a data/Part-C concern), but `DepartmentCodeSpace` **must surface it**: the boot check counts facts rows with `NULL department_code` and emits a WARN/metric so dept scope isn't shipped over a grain where it silently drops rows.

`DepartmentCodeSpace` does three things:

1. **Schema-shape-tolerant MDMS load (B-3 fix).** `common-masters.Department` exists in **two shapes**: nairobi is MDMS-v2 wrapped — `{"tenantId":"ke.nairobi","data":{"code":"DEPT_01"}}` (`CCRS/ansible/nairobi-mdms/mdms/common-masters/Department.json`); ddh is MDMS-v1 flat — `{"code":"DEPT_35"}` (`CCRS/utilities/default-data-handler/.../common-masters.Department.json`). The loader must read **both** (`$.data.code` when wrapped, `$.code` when flat) — a single read path silently returns an **empty** code set against one of them. **Loading zero MDMS Department codes is treated as a hard configuration error**, not "everything is unknown": it emits a loud WARN/metric and `filterToKnown` **fails closed by refusing to ship department scope** (returns empty dept list with a flag so the boot gate / step 2 catches it) rather than dropping every HRMS dept and looking like "no data." An empty MDMS set is exactly the silent-total-loss §7.3 warns about, now caused by the guard itself if mishandled.
2. **Boot/refresh consistency check + NULL-join surfacing.** On startup (and cache refresh) it loads the MDMS code set, logs/metrics any HRMS assignment dept code observed that is **not** in that set, and metrics the count of facts rows with `NULL department_code`. This is the "one-time consistency check" plan §1 mandates. It does not 500 a live request, but it **must emit a loud WARN + a metric** so the mismatch is caught in validation, not in production silence.
3. **`filterToKnown(hrmsDepts, tenantId)`** — intersects HRMS dept codes with the (non-empty) MDMS code set before they reach the `IN` clause. A dept code the facts column can never hold is dropped (it would match nothing anyway); dropping it *and recording it* turns a silent empty into an observable event.

> Note this is a **scope-correctness** guard, not a security widening: dropping an unknown code can only *narrow* (or no-op), never widen — consistent with requirements §4 "narrow-only." The *one* exception that must NOT silently narrow is "MDMS loaded zero codes" — that is a misconfiguration and is escalated, not silently applied.

### B.6 Caching (requirements §6 performance, §7.5 drift)

Both HRMS attrs and boundary paths are **mutable HRMS/boundary state, not in the token** (requirements §7.5). Resolving on every `_query` adds network hops. Cache, but short-TTL where the data drifts:

| Cache | Key | Value | TTL | Rationale |
|---|---|---|---|---|
| `hrmsCache` | `{tenantId, uuid}` | `EmployeeAttrs{boundaryCodes[], departmentCodes[], failed}` | **short (e.g. 5 min)** | jurisdiction/dept reassignment in HRMS must propagate quickly; 5 min bounds the staleness window |
| `boundaryPathCache` | `{tenantId, code}` | self-included node path `ancestralmaterializedpath\|code` | **long (e.g. 1 h+)** | boundary topology is near-static; the MCP path-build (`boundary.ts:37`) treats it as stable |
| `deptCodeSpaceCache` | `{tenantId}` | `Set<deptCode>` from MDMS (+ "empty" sentinel = misconfig) | **long, refreshable** | MDMS masters change rarely |

- **Negative caching is bounded:** a `failed` HRMS result is cached only briefly (or not at all) so a transient HRMS blip doesn't lock a supervisor out for 5 minutes. Cache the *success* aggressively, the *failure* barely.
- **Cache key includes `tenantId`** — never serve one tenant's resolved attrs to another (tenant isolation, requirements §7). A resolver keyed by bare `uuid` would leak a multi-tenant employee's scope across tenants.
- **Interaction with the result cache (requirements §6):** the *resolved scope* is part of the analytics result-cache key. Part B's output feeds that key. A drifted-then-refreshed `PrincipalAttributes` therefore naturally produces a different result-cache entry — no stale cross-scope serving.

### B.7 Control flow (end to end)

```
AnalyticsController.query()              [Part A gate runs first — rejects spoofed/unsigned userInfo]
  └─> AnalyticsService.query(body, requestInfo, tenantId, stateLen)   (AnalyticsService.java:30)
        └─> PrincipalAttributesResolver.resolve(requestInfo, tenantId, stateLen)   [PART B]
              ├─ stateLevel = (tenantId split == stateLen)   (same as AnalyticsScope.java:32)  [B-2]
              ├─ classify(userInfo.roles/type)               (logic from AnalyticsScope L36–44)
              ├─ CITIZEN  -> PrincipalAttributes.citizen(uuid)
              ├─ ADMIN    -> PrincipalAttributes.admin()
              └─ EMPLOYEE -> hrmsCache → HRMSUtil.getEmployeeAttrs()    (extends HRMSUtil L44; single-uuid)
                             → BoundaryPathResolver.toPrefixes()        (new; boundary_relationship source)
                             → DepartmentCodeSpace.filterToKnown()      (new; MDMS Department, both shapes)
        └─> AnalyticsScope.from(principalAttributes)   [PART C — builds attrScopes, reads tenantStateLevel]
        └─> planner.plan(q, scope) ... applyScope() loop   (AnalyticsPlanner.java:241) [PART C]
```

Today `AnalyticsService.java:32` calls `AnalyticsScope.resolve(requestInfo, tenantId, stateLevelLen)` directly (the method itself begins at `AnalyticsService.java:30`). The migration inserts Part B *before* that call and changes Part C's `AnalyticsScope` to be built `from(PrincipalAttributes)` instead of from `RequestInfo` — carrying `tenantStateLevel` through so the tenant predicate is unchanged.

---

## Interfaces with other parts

**Consumes (input contract):**
- **From Part A (Trust foundation):** a `RequestInfo` whose `userInfo.{uuid, type, roles[]}` is **token-validated and coercive** — i.e. a spoofed/unsigned body has already been rejected or overwritten. Part B's correctness is *entirely* conditional on this. **Contract:** Part B trusts `userInfo`; if Part A is absent, every guarantee here is void (requirements §7.1). Part B additionally treats `userInfo==null` as fail-closed (deny). It **cannot** itself detect a *populated-but-unsigned* forged body — see the Part A interface issue below.
- **From `boundary_relationship` (NOT `/boundary/_search`):** the `ancestralmaterializedpath` + `code` the grain MV reads (`…grain_mvs.sql:23`). The v2 `/boundary/_search` entity has no path field (`web/models/boundary/Boundary.java:24–42`); see B.4.
- **From egov-hrms:** `/egov-hrms/employees/_search` (`HRMSUtil.getHRMSURI` L105), reading `jurisdictions[*].boundary` (net-new path) and `assignments[?isCurrentAssignment].department` (pattern from `PGRConstants.java:168`), single-uuid only.
- **From MDMS:** `common-masters.Department` for the code-space check — **both** the v2-wrapped (nairobi) and v1-flat (ddh) shapes.

**Produces (output contract):**
- **`PrincipalAttributes`** consumed by **Part C (Attribute-scope engine)**. The named contract — **a superset of today's `AnalyticsScope` fields**: `{tenantId, tenantStateLevel, scopeLevel, citizenUuid, boundaryPrefixes[] (delimiter-anchored, UN-escaped), departmentCodes[] (MDMS-aligned), resolutionComplete}`. Part C maps:
  - `tenantId` + `tenantStateLevel` → the tenant predicate exactly as `applyScope` does today (`AnalyticsPlanner.java:243–244`) — `LIKE tenantId||'%'` at state root, `= tenantId` at city.
  - `citizenUuid` → citizen self-scope on the grain's `citizenColumn` (`AnalyticsPlanner.java:246`).
  - `boundaryPrefixes` → a `PREFIX` `AttrScope` on `boundary_path` (reusing the escape at `AnalyticsPlanner.java:249`).
  - `departmentCodes` → an `IN` `AttrScope` on `department_code`.
  - `scopeLevel==TENANT_ADMIN` → empty `attrScopes` (tenant-only).
  - `scopeLevel==EMPLOYEE_SCOPED` **with both attribute lists empty** → **deny** (not tenant-only).
  - `resolutionComplete==false` → **deny/empty**, never fall through to tenant-only.
- **`roles[]` are NOT re-derived by Part B** for Parts D/F — those read roles off the same trusted principal independently. Part B only consumes roles to classify scope level.

**Hands off (does not implement) — Part C / plan §3 step 4:**
- The **events-MV `department_code` migration**. Part B's `DepartmentCodeSpace` only signals that department scope is *resolvable*; whether a given **grain** can be department-scoped is Part C's grain-binding concern — events lacks the column today (`AnalyticsCatalog.java:88` events groupable/`:92` filterable sets have no `department_code`; facts has it at `:59`/`:66`).
- The **daily-grain citizen leak** (README cross-cutting #1). `complaint_open_state_daily` has `citizenColumn = null` (`AnalyticsCatalog.java:108`, the `null` in the Grain ctor's citizen position) and `applyScope` guards citizen self-scope on `g.citizenColumn != null` (`AnalyticsPlanner.java:246`) — so a pure citizen querying `grain:"daily"` is **not** self-scoped and sees every open complaint in the tenant. Part B's citizen path produces a correct `citizenUuid`; **the leak is entirely in Part C's grain binding** (add `account_id` to the daily grain, or reject citizen daily queries). Part B flags it so Part C cannot ship dept/jurisdiction scope while this citizen leak remains live.

---

## Sequencing & migration steps

Each step is independently reviewable; the part ships as **one PR** against egov/CCRS develop (one-concern: "resolve principal attributes from HRMS"), validated on ovh-cloud-dev (bomet repro) before live.

1. **Add `PrincipalAttributes`** value object (B.1), including `tenantStateLevel`. Pure data; no behavior change yet.
2. **Add `DepartmentCodeSpace`** (B.5) with the schema-shape-tolerant load, the boot consistency check + metric, and the NULL-join surfacing. Run it on bomet/naipepea MDMS and **verify HRMS dept codes ⊆ MDMS Department codes, and that the loader reads a NON-EMPTY set from both v1 and v2 shapes, BEFORE building any `IN` clause** (plan §6.3). If codes diverge, the divergence is fixed in data (HRMS or MDMS), not in code. If the loader reads zero codes, that is a hard config error — fix the shape handling before shipping dept scope.
3. **Add `BoundaryPathResolver`** (B.4) reading `boundary_relationship` + a test asserting its prefix equals the MV's `boundary_path || '|'` for the same code against real bomet boundary data (the self-inclusion subtlety, now grounded against the correct source).
4. **Extend `HRMSUtil`** with `getEmployeeAttrs()` (single-uuid, non-throwing `safeRead`) + the two new `PGRConstants` JsonPaths (B.3). Unit-test the jurisdiction/active-department extraction against a captured HRMS `_search` payload (use an `RBAC_TEST_*` clean-role user, not a polluted real account — requirements §7.2).
5. **Add `PrincipalAttributesResolver`** + caches (B.2, B.6), consuming `stateLevelLen` into `tenantStateLevel`.
6. **Rewire `AnalyticsService`** (`AnalyticsService.java:32`) to call the resolver and pass `PrincipalAttributes` into the (Part-C) `AnalyticsScope` builder. **This is the only behavior-visible change** and is a no-op until Part C consumes the new fields. Citizen and admin paths must be **byte-identical** to today (including `tenantStateLevel`) — assert with the existing scope tests.
7. **Negative/fail-closed tests** (see Risks). Gate the PR on them — including the Part-A-dependent populated-but-unsigned forged body (see *Interfaces → Part A*).

> Sequencing note for host_vars/cutover (per memory discipline): no tenant-specific constants enter code — admin role set, delimiter, TTLs are config (`PGRConfiguration`), and dept/boundary data stays in MDMS/HRMS/boundary_relationship. Same redeploy on any tenant.

---

## Risks, edge cases, failure modes

**Fail-closed is the default, encoded structurally:**

| Scenario | Behavior | Mechanism |
|---|---|---|
| `userInfo == null` (Part A misconfigured/absent) | **Deny** (empty scope, `resolutionComplete=false`) | `resolve()` null branch returns `scoped(…, false)`; Part C treats `false` as deny, not tenant-only |
| Populated-but-**unsigned** forged `userInfo` | **Out of Part B's reach** — Part A must reject it; Part B then handles the residual (forged-uuid-with-no-HRMS-row → deny) | requires Part A; negative test in step 7 (see Part A interface) |
| Employee has **no HRMS row** (uuid drift, requirements §7.5) | **Empty scope, deny** — NOT unscoped | `getEmployeeAttrs` → `failed()` → `resolutionComplete=false` |
| HRMS **5xx/timeout** mid-request | **Deny** — `fetchResult` swallows it to `null` (`ServiceRequestRepository.java:38–42`); resolver maps `null → failed()` | `if (res == null) return EmployeeAttrs.failed()` |
| HRMS **4xx** | **Deny** — `fetchResult` re-throws `ServiceCallException` (`:37`); `getEmployeeAttrs` catch maps to `failed()` (does NOT 500) | try/catch in `getEmployeeAttrs` |
| Employee has jurisdiction codes but **a code won't resolve** to a path | code **dropped**, `resolutionComplete=false` → Part C denies rather than scoping to a partial subtree | `BoundaryPathResolver` drop + `complete = prefixes.size()==codes.size()` |
| HRMS dept code **not in** MDMS Department | dropped + **loud WARN/metric** | `DepartmentCodeSpace.filterToKnown` (§7.3) |
| MDMS Department **loads zero codes** (v1/v2 shape mishandled) | **hard config error** — refuse to ship dept scope, loud WARN/metric; NOT "drop everything" | `DepartmentCodeSpace` empty-set sentinel (B-3 fix) |
| `department_code` **NULL** from LEFT JOIN (unmapped service_code) | surfaced as WARN/metric at boot; the under-scope is real until the join is fixed | `…grain_mvs.sql:227` LEFT JOIN; `NULL IN (…)` never true (README #3b) |
| Employee with **multiple active assignments / jurisdictions** | union (OR-within) — correct, not a bug | array JsonPaths return all; Part C ORs within attribute |
| Stale/deactivated assignment | **excluded** from scope | `isCurrentAssignment==true` filter (B.3), unlike unfiltered `getDepartment()` |
| `EMPLOYEE_SCOPED` with zero jurisdiction AND zero department | **deny** (sees nothing), NOT tenant-admin | `scopeLevel` carries the distinction; Part C deny rule |

**Isolation / leak hazards:**

- **Sibling-prefix leak** (`WARD_3` matching `WARD_30`): prevented by the trailing-delimiter anchor (Part B) + the existing escape (`AnalyticsPlanner.java:249`). Both must be present; a test must assert `WARD_3|` does not match a `WARD_30` row.
- **Tenant cross-contamination via cache:** every cache key carries `tenantId`. A resolver that cached by bare `uuid` would leak a multi-tenant employee's scope across tenants — keyed by `{tenantId,uuid}` to prevent it.
- **Cross-tenant LIKE leak via dropped `tenantStateLevel`** (B-2): carrying `tenantStateLevel` on `PrincipalAttributes` keeps Part C's tenant predicate `= tenantId` at city level, so `ke.bomet` cannot LIKE-match `ke.bometville`.
- **HRMS role pollution (requirements §7.2):** every real `GRO` also carries `PGR_LME`. `classify()` must not assume single-role; the admin branch keys on the *presence* of an admin role, the employee branch is the default for any non-citizen non-admin. Test the scope-matrix with clean `RBAC_TEST_*` users.
- **Department code-space drift + NULL-join silent-empty (requirements §7.3, README #3b):** the most dangerous because it *looks* like "no complaints," not "misconfigured." Mitigated by the boot check (B.5) + metric; ship-blocked by step 2.
- **Events grain has no `department_code`** (`AnalyticsCatalog.java:88/:92`) and **daily grain has no `citizenColumn`** (`AnalyticsCatalog.java:108`): a department-scoped caller querying events, or a citizen querying daily, would — without Part C's grain-binding — get *unscoped rows* (silent grain leaks, requirements §7.4 + README #1). Part B flags both; Part C must add the column or reject. **Part B must not be read as "scope is safe everywhere" — it is only safe on grains whose Grain binding declares the column.**

**Performance / correctness coupling:**
- One extra HRMS hop per *uncached* employee request (boundary resolution is a local `boundary_relationship` read under option 1, not a network hop). Mitigated by B.6; steady-state is a cache hit.
- Drift window: a 5-min HRMS TTL means a jurisdiction reassignment is visible to scope within 5 min, not instantly. Acceptable given the data is already only as fresh as the hourly MV (requirements §6 — "nothing fresher than the last refresh").

---

## Open questions for review

1. **`boundary_relationship` self-inclusion assertion.** `ancestralmaterializedpath` is ancestors-only; the MV reconstructs self via `|| '|' || code` (`…grain_mvs.sql:23`). `BoundaryPathResolver` (now reading the same table) must reproduce that reconstruction and append the anchor. **Resolve by testing against real bomet boundary rows before trusting the resolver** (B.4) — even though same-source makes it identical by construction, the test pins it.
2. **HRMS jurisdiction field name — RESOLVED to `boundary`.** Confirmed `jurisdictions[*].boundary` (a code string) against `digit-ui-v2/src/api/types.ts:240` and MCP `hrms.ts:199–212` (pass-1 anti-FUD). Left here only to flag: validate once against a captured bomet/naipepea HRMS `_search` payload in step 4 before finalizing the JsonPath, since pgr-services has never read it.
3. **Should `BoundaryPathResolver` read `boundary_relationship` directly or call `/boundary-relationship/_search`?** Recommend the **direct table read** for guaranteed path-identity with the grain (same source, zero extra hop) and because `/boundary-relationship/_search`'s response shape is unverifiable in-tree (boundary-service not vendored). Flag for the boundary-service owner if an API boundary is preferred. (`/boundary/_search` is ruled out — B-1.)
4. **Negative-cache policy for HRMS failure.** Cache `failed` for a few seconds (avoid hammering a down HRMS) vs. not at all (a supervisor isn't locked out by a transient blip). Default to "very short" (B.6).
5. **Admin role set source of truth.** `classify()`'s admin branch needs the `PGR_ADMIN/DSS_ANALYST/SUPERADMIN` set. Hardcode in `PGRConfiguration` (config, redeploy-identical) vs. read from an MDMS RBAC master? Part D needs the same set for `visibleTo` — align so the two parts share one definition rather than drifting.
6. **Department-head persona without jurisdiction (requirements §2).** The model supports `boundaryPrefixes=[]`, `departmentCodes=[…]`, `scopeLevel=EMPLOYEE_SCOPED` (dept-head sees their dept across all wards). Confirm that's intended vs. requiring at least one attribute — and that this is distinct from the zero/zero `EMPLOYEE_SCOPED` deny case (which has NO department either). The contract handles both via the attribute lists + `scopeLevel`.

---

## v2 revision log (pass-1 findings → resolution)

- **B-1 (blocker) — `/boundary/_search` does not return `materializedPath`; wrong (legacy) Boundary class cited.** RESOLVED. Re-grounded against both classes: legacy `web/models/Boundary.java:58` has the field but is the old egov-location model; the v2 entity `web/models/boundary/Boundary.java:24–42` (what `/boundary-service/boundary/_search` actually returns) has only `id/tenantId/code/geometry/auditDetails/additionalDetails` — no path field. **B.4 re-pointed `BoundaryPathResolver` to read `boundary_relationship.ancestralmaterializedpath` directly** (the same source the grain MV reads at `…grain_mvs.sql:23`), with `/boundary-relationship/_search` as a secondary option and `/boundary/_search` explicitly ruled out. Interfaces + "Current code reality" + Open-Q3 updated to match.
- **B-2 (major) — `tenantStateLevel` dropped; Part C cannot emit the tenant predicate.** RESOLVED. Added `tenantStateLevel` to `PrincipalAttributes` (B.1) as a field, computed it in the resolver from the previously-dead `stateLevelLen` arg exactly as `AnalyticsScope.java:32` does, and locked the output contract (Interfaces → Part C) to a **superset** of today's `AnalyticsScope` fields so `applyScope`'s state-vs-city branch (`AnalyticsPlanner.java:243–244`) is reproduced — closing the `ke.bomet`/`ke.bometville` cross-tenant LIKE leak.
- **B-3 (major) — `DepartmentCodeSpace` ignores MDMS v1-flat vs v2-wrapped split; may load zero codes (fail-open into silent-empty).** RESOLVED. B.5 now mandates a **schema-shape-tolerant loader** (`$.data.code` for nairobi v2-wrapped vs `$.code` for ddh v1-flat, anchored to both files), and treats **"loaded zero MDMS Department codes" as a hard config error** — loud WARN/metric + refuse to ship dept scope (empty-set sentinel) rather than dropping every HRMS dept. Added to the Risks table and step-2 ship gate.
- **B-4 (minor) — anchor off-by-one: facts `boundaryColumn` is at `AnalyticsCatalog.java:78`, not L79.** RESOLVED. Corrected the "Current code reality" table to L78 (facts), L96 (events), L108 (daily); also re-anchored the `department_code` groupable/filterable rows to `:59`/`:66` after re-reading.
- **B-5 (minor) — `getDepartment()`'s unfiltered path is at `HRMSUtil.java:55` and it `throw`s on empty/parse-miss; the resolver must not reuse it.** RESOLVED. B.3 now explicitly states `getEmployeeAttrs` uses a non-throwing `safeRead` (returns `[]` on miss) and is **deliberately unlike** `getDepartment()`, which throws `PARSING_ERROR` (`HRMSUtil.java:57–58`) and `DEPARTMENT_NOT_FOUND` (`:61–62`) — a supervisor with an empty active department must fail closed to empty scope, not 500.
- **B-6 (minor) — `$.Employees[0]` assumes single-employee search.** RESOLVED. B.3 pins `getEmployeeAttrs` as **single-uuid-only** (signature takes `String uuid`, not a list, as a compile-time contract) and documents that `[0]` must never be fed a batched search, contrasting it with the workflow reads' `$.Employees.*` (`PGRConstants.java:41`).
- **Mis-citation: "`/boundary/_search` returns `materializedPath` (modeled `Boundary.java:58`)".** RESOLVED — see B-1; all references re-pointed to `boundary_relationship` / the v2 entity model.
- **Mis-citation: "`AnalyticsCatalog.java` facts `boundaryColumn` … Grain ctor L79".** RESOLVED — corrected to L78 throughout (B-4).
- **Interface → Part A: only `userInfo==null` is a fail-closed lever; a populated-but-unsigned forged body resolves a real low-priv employee's narrow scope.** ACKNOWLEDGED, NOT fixable in Part B — **owned by Part A** (`10-auth-foundation.md`), which must make introspection mandatory + coercive so a forged/unsigned `userInfo` is rejected before Part B runs (requirements §7.1, `kong.yml:65–68`). Part B documents the residual it *can* handle (forged uuid with no HRMS row → `failed()` → deny) and adds a step-7 negative test asserting a populated-but-unsigned body yields deny — but that test only passes once Part A lands.
- **Interface → Part C: output must carry whatever Part C needs to reproduce today's tenant predicate + citizen/admin distinction.** RESOLVED in Part B by exporting a superset contract (B-2); the *consumption* (mapping `tenantStateLevel`/`scopeLevel`/`resolutionComplete` into `attrScopes` and the deny rules) is **owned by Part C** (`30-row-scope-enforcement.md`) and spelled out in Interfaces → Part C as the binding it must implement.
- **Interface → Part C (grain binding): `departmentCodes[]` is grain-agnostic but only facts has `department_code`.** ACKNOWLEDGED, NOT fixable in Part B — **owned by Part C / plan §3 step 4**. Part B's output deliberately carries no grain signal; Interfaces + Risks now name the two grain gaps (events has no `department_code` at `AnalyticsCatalog.java:88/:92`; daily has no `citizenColumn` at `:108`) and require Part C to add the column or reject, never drop-to-unscoped.
- **Cross-cutting (README #1) — daily-grain citizen leak.** FLAGGED, NOT fixable in Part B — **owned by Part C**. Part B's citizen path produces a correct `citizenUuid`; the leak is `complaint_open_state_daily.citizenColumn == null` (`AnalyticsCatalog.java:108`) bypassing the `citizenColumn != null` guard (`AnalyticsPlanner.java:246`). Added to "Hands off" and Risks so Part C cannot ship scope while it is live.
- **Cross-cutting (README #2) — identity is fail-OPEN via `ServiceRequestRepository.fetchResult` returning `null` on 5xx/timeout.** RESOLVED for Part B's consumption: B.3 + the Risks table now explicitly map a `null` HRMS result to `EmployeeAttrs.failed()` (fail closed) and note that 4xx re-throws `ServiceCallException` (`ServiceRequestRepository.java:37`) which the `getEmployeeAttrs` catch also maps to `failed()`. The broader "make introspection itself coercive" half is **Part A's**.
- **Cross-cutting (README #3b) — `department_code` NULL for unmapped service_code via LEFT JOIN.** FLAGGED + surfaced. `DepartmentCodeSpace` boot check now metrics the count of facts rows with `NULL department_code` (`…grain_mvs.sql:227` LEFT JOIN, `NULL IN (…)` never true). The under-scope is real until the join/data is fixed (Part C / data); Part B makes it observable rather than silent.
- **Cross-cutting (README #4) — the "narrow-only" client param (`boundaryScope`/`departmentScope`) has no code path; `boundary_path` not in any grain's `filterable` set.** ACKNOWLEDGED, NOT fixable in Part B — **owned by Part C** (the planner's filterable set + declared-param plumbing, `AnalyticsPlanner.java:174` / `AnalyticsCatalog` filterable lists). Part B only produces the *injected* scope values; client-supplied narrowing is Part C's grammar concern.

### v3 corrections (pass-3 codex fact-check, 2026-06-23)

- **B-7 (blocker) — boundary resolver could disagree with the grain on duplicate codes; "path-identical by construction" was wrong.** B.4's pass-2 wording claimed a `SELECT ancestralmaterializedpath, code FROM boundary_relationship WHERE tenantid = ? AND code = ?` read was "path-identical by construction" to the grain. **It is not.** The grain's `bnd` CTE selects/filters **no `tenantid`** and dedupes globally — `DISTINCT ON (code) … ORDER BY code, length(ancestralmaterializedpath) DESC` (deepest path per code, across the whole table) — at `V20260608000000__create_v2_grain_mvs.sql:21–25`, binding to rows only on `bnd.code = svc.locality_code` (`…grain_mvs.sql:94`). So the authoritative `boundary_path` a row carries is the *global deepest-path row for that code*; a tenant-filtered per-code read can pick a **different** `ancestralmaterializedpath` for a **duplicated** code and produce a `LIKE` prefix that misses the grain's rows (or matches the wrong subtree). FIX: B.4 now derives the jurisdiction prefix from the **same representation the grain uses** — the grain's own `boundary_path` (`SELECT DISTINCT boundary_path FROM complaint_facts WHERE … code = ?`) or a replica of the MV's exact `bnd` selection (global `DISTINCT ON (code)`, deepest-path-wins, **no `tenantid` filter**) — eliminating the second source of truth. The duplicate-code risk is now stated explicitly (new hazard note in B.4) and the resolver code/comment + the path-vs-prefix note no longer claim "identical by construction" for a tenant-filtered read.
- **materializedPath model claim — corrected/sharpened.** Verified in code: the **legacy** model `web/models/Boundary.java` carries `materializedPath` (`@JsonProperty` `:57`, field `:58`; range `:57–59`) and is the old egov-location tree model; the **v2** boundary-service model `web/models/boundary/Boundary.java:24–42` has only `id/tenantId/code/geometry/auditDetails/additionalDetails` and **no** `materializedPath`/`ancestralmaterializedpath`. B.4 now states explicitly that the materializedPath-bearing model is the legacy one, not v2, and that neither feeds the prefix — the grain's `boundary_path` (from `boundary_relationship.ancestralmaterializedpath`, `…grain_mvs.sql:23`) is the authoritative source.

## Codex review (pass 2 — gpt-5.5, verdict: needs-rework)

> External adversarial review via `codex exec`, read-only, verifying the v2 revision log against the actual code. **Note:** codex evaluated "resolved" as "patched in code"; this is a *design* doc (no code changed yet), so most `actuallyResolved:false` items mean "design specifies it, code not yet written," not "design wrong." Read the findings for genuine design errors vs. implementation-status notes.


**Summary:** Pass-2 verification: several line-anchor corrections are valid, but the main security claims remain design-only or conflict with adjacent Part C. Actual code still has spoofable identity, no PrincipalAttributes resolver, no department/jurisdiction scoping, events lacks department_code, daily lacks citizen scope, and boundary path identity is not guaranteed because the grain MV joins boundary_relationship by code only.


### Resolution check (6/14 confirmed in code)

- ❌ **B-1: /boundary/_search does not return materializedPath; wrong legacy Boundary class cited.** — Partly corrected: legacy Boundary has materializedPath at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/web/models/Boundary.java:57-59 and v2 Boundary has only id/tenantId/code/geometry/auditDetails/additionalDetails at .../web/models/boundary/Boundary.java:24-42. But B.4's 'path-identical' direct read by tenantId is not identical to the grain: the MV dedupes boundary_relationship by code only and does not select/filter tenantid at V20260608000000__create_v2_grain_mvs.sql:21-25, then joins bnd.code = svc.locality_code at :93-94.
- ❌ **B-2: tenantStateLevel dropped; Part C cannot emit the tenant predicate.** — Not resolved in actual code: no PrincipalAttributes class/resolver exists; AnalyticsService still calls AnalyticsScope.resolve(requestInfo, tenantId, stateLevelLen) at AnalyticsService.java:30-32. Also Part C says it computes stateLevel itself and does not depend on B carrying tenantStateLevel at db-inventory/rbac-deep-design/30-row-scope-enforcement.md:116 and :334, conflicting with this interface claim.
- ❌ **B-3: DepartmentCodeSpace ignores MDMS v1-flat vs v2-wrapped split; may load zero codes.** — The source-shape observation is correct: nairobi Department is wrapped at CCRS/ansible/nairobi-mdms/mdms/common-masters/Department.json:3-6 and DDH is flat at CCRS/utilities/default-data-handler/src/main/resources/mdmsData/common-masters/common-masters.Department.json:2-5. But no DepartmentCodeSpace implementation exists in CCRS/backend/pgr-services/src/main/java, so the loader/error/metric claim is not actually resolved.
- ✅ **B-4: anchor off-by-one for facts boundaryColumn.** — Corrected anchors match code: facts boundaryColumn is the Grain ctor arg at AnalyticsCatalog.java:78; events at :96; daily at :108. department_code anchors also match facts groupable/filterable at :59 and :66.
- ❌ **B-5: getDepartment path/throw behavior misread; resolver must not reuse it.** — The cited behavior is verified: getDepartment reads HRMS_DEPARTMENT_JSONPATH at HRMSUtil.java:55, throws PARSING_ERROR at :57-58, and DEPARTMENT_NOT_FOUND at :61-62. But no getEmployeeAttrs/safeRead implementation exists; actual code still exposes only the throwing getDepartment and nullable getSupervisorUuid.
- ❌ **B-6: $.Employees[0] assumes single-employee search.** — The risk is documented, but no getEmployeeAttrs(String uuid, ...) exists to enforce the single-UUID contract. Existing getDepartment accepts List<String> uuids at HRMSUtil.java:44 and uses $.Employees.*.assignments.*.department from PGRConstants.java:41.
- ✅ **Mis-citation: /boundary/_search returns materializedPath modeled by Boundary.java:58.** — The corrected citation is valid: application.properties points boundary search to /boundary-service/boundary/_search at application.properties:149-150, and the v2 response model has no materializedPath at web/models/boundary/Boundary.java:24-42.
- ✅ **Mis-citation: AnalyticsCatalog facts boundaryColumn Grain ctor L79.** — Actual facts Grain ctor has boundaryColumn='boundary_path' at AnalyticsCatalog.java:78.
- ❌ **Interface -> Part A: populated-but-unsigned forged body cannot be fixed in Part B.** — Acknowledged but still live: AnalyticsController converts body RequestInfo directly at AnalyticsController.java:43-44 and passes it to service.query at :47; AnalyticsScope trusts getUserInfo/type/roles/uuid at AnalyticsScope.java:34-44.
- ❌ **Interface -> Part C: output must carry tenant predicate + citizen/admin distinction.** — No actual output exists: no PrincipalAttributes class/resolver in CCRS/backend/pgr-services. Adjacent Part C expects boundaryPrefixes/departmentCodes/isAdmin and computes tenantStateLevel itself at 30-row-scope-enforcement.md:116 and :334, while Part B claims C consumes tenantStateLevel/scopeLevel/resolutionComplete at 20-attribute-resolution.md:314-320.
- ✅ **Interface -> Part C grain binding: departmentCodes is grain-agnostic but only facts has department_code.** — Correctly acknowledged as not Part B: facts has department_code groupable/filterable at AnalyticsCatalog.java:58-66; events groupable/filterable sets omit it at :84-92; events MV projection also omits department_code at V20260608000000__create_v2_grain_mvs.sql:52-91.
- ✅ **Cross-cutting: daily-grain citizen leak.** — Correctly flagged as not Part B: daily Grain has citizenColumn null at AnalyticsCatalog.java:108, and applyScope only adds citizen predicate when g.citizenColumn != null at AnalyticsPlanner.java:246.
- ❌ **Cross-cutting: department_code NULL from LEFT JOIN.** — The risk is real: department_code comes from mdms at V20260608000000__create_v2_grain_mvs.sql:147 and the facts query uses LEFT JOIN mdms m ON m.service_code = s.servicecode at :227. But no DepartmentCodeSpace boot check/metric exists in actual code.
- ✅ **Cross-cutting: narrow-only boundaryScope/departmentScope has no code path; boundary_path not filterable.** — Correctly acknowledged as not Part B: filter validation rejects columns absent from g.filterable at AnalyticsPlanner.java:172-175; facts filterable list omits boundary_path at AnalyticsCatalog.java:64-69, and events/daily filterable lists also omit boundary_path at :89-92 and :104-105.

### Findings

- **[BLOCKER] Boundary resolver can disagree with the grain for duplicate boundary codes** — B.4 claims a tenant-filtered read of boundary_relationship is path-identical to the grain, but the grain does not use tenantid in the boundary CTE or join. If boundary code values repeat across tenants or hierarchies, Part B would compute one path while the MV stores another, causing scope misses or cross-tenant/path confusion.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql:21-25 builds bnd as DISTINCT ON (code) with no tenantid; :93-94 joins bnd.code = svc.locality_code only.`
- **[BLOCKER] Actual endpoint still trusts caller-supplied identity** — Part B's attributes would still be computed from a spoofable body until Part A changes the live code. A forged employee/admin RequestInfo can control the role/type/uuid inputs used for scoping.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsController.java:43-47 converts body.RequestInfo and passes it to service.query; AnalyticsScope.java:34-44 trusts userInfo type, roles, and uuid.`
- **[BLOCKER] Daily grain still leaks all tenant rows to citizens** — Citizen scope is skipped on daily because the grain has no citizenColumn and applyScope silently omits the predicate rather than denying the grain.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:108 sets daily citizenColumn to null; AnalyticsPlanner.java:246 only applies citizen self-scope when g.citizenColumn != null.`
- **[MAJOR] Department scope would be absent on events grain** — The design flags this, but the shipped catalog/MV still cannot bind department_code for events. Any Part C implementation that drops unavailable attributes instead of rejecting would leak event rows tenant-wide for department-scoped users.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:84-92 events groupable/filterable sets omit department_code; V20260608000000__create_v2_grain_mvs.sql:52-91 events SELECT omits department_code.`
- **[MAJOR] Part B and Part C interfaces disagree on tenantStateLevel and admin/deny signals** — Part B says Part C consumes tenantStateLevel, scopeLevel, and resolutionComplete. Part C says it computes stateLevel itself and consumes boundaryPrefixes, departmentCodes, and isAdmin. That mismatch can erase fail-closed semantics for empty employee attributes unless reconciled before implementation.  
  _evidence:_ `db-inventory/rbac-deep-design/20-attribute-resolution.md:314-320 defines the Part C contract with tenantStateLevel/scopeLevel/resolutionComplete; db-inventory/rbac-deep-design/30-row-scope-enforcement.md:116 and :334 say Part C computes stateLevel itself and consumes boundaryPrefixes/departmentCodes/isAdmin.`
- **[MAJOR] Department NULL under-scope remains unimplemented as a boot gate** — The design says DepartmentCodeSpace surfaces NULL department_code counts, but no such code exists. Facts rows with service_code missing ServiceDefs get NULL department_code and will disappear under department IN predicates without an operational failure signal.  
  _evidence:_ `V20260608000000__create_v2_grain_mvs.sql:147 defines department_code from MDMS ServiceDefs; :227 uses LEFT JOIN mdms m ON m.service_code = s.servicecode; rg finds no DepartmentCodeSpace under CCRS/backend/pgr-services/src/main/java.`
- **[MAJOR] No actual HRMS jurisdiction resolver exists** — The design's resolver/safeRead/JsonPath additions are still aspirational. Current HRMSUtil reads departments and reportingTo only; no jurisdiction boundary JsonPath or EmployeeAttrs method exists.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java:41 defines HRMS_DEPARTMENT_JSONPATH and :168 defines HRMS_REPORTING_TO_JSONPATH; no HRMS_JURISDICTION_BOUNDARY_JSONPATH exists in actual Java; HRMSUtil.java:44-64 and :73-96 expose only getDepartment/getSupervisorUuid.`
- **[MINOR] State-level tenant predicate is prefix-unanchored** — The existing state-level tenant predicate uses tenantId + '%' without delimiter anchoring. The design calls out ke.bomet/ke.bometville as a risk when LIKE is used at city level, but state-level LIKE has the same prefix ambiguity unless tenant naming guarantees a delimiter boundary.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:242-244 adds g.tenantColumn LIKE ? with params.add(scope.tenantId + '%').`

### Mis-citations

- B.4 says direct table read SELECT ... WHERE tenantid=? AND code=? is path-identical to the grain; actual grain uses DISTINCT ON (code) with no tenantid at V20260608000000__create_v2_grain_mvs.sql:21-25.
- B.4 cites boundary.ts:43-57 as same-table support, but that file is outside the requested analytics package and was not needed to prove the deploy-target Java/SQL behavior.
- Part B Interfaces claim Part C consumes tenantStateLevel/scopeLevel/resolutionComplete, but Part C's own interface says it consumes boundaryPrefixes/departmentCodes/isAdmin and computes stateLevel itself at 30-row-scope-enforcement.md:116 and :334.

### Gaps

- No PrincipalAttributes, PrincipalAttributesResolver, BoundaryPathResolver, DepartmentCodeSpace, EmployeeAttrs, safeRead, or HRMS jurisdiction constants exist in actual pgr-services Java.
- No code verifies HRMS assignment department codes against either MDMS Department shape.
- No code verifies every live service_code has a ServiceDefs department before enabling department scope.
- No test or implementation proves BoundaryPathResolver output equals complaint grain boundary_path || '|' for real tenant data.
- No implementation rejects grains that cannot satisfy citizen/department/jurisdiction predicates; current planner silently omits citizen scope when the grain lacks citizenColumn.
