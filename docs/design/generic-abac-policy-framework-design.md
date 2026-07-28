# Generalizing the ABAC Policy Engine — Review + Reusable Framework + New-API Runbook

**Author:** Vinoth Rallapalli · **Date:** 2026-07-28 · **Status:** Proposal — feedback requested before implementation
**Scope:** `backend/pgr-services/src/main/java/org/egov/pgr/policy/*` (review), a proposed shared `egov-policy` module, and the MDMS `ACCESSCONTROL-ACTIONS-TEST` / `ACCESSCONTROL-ROLEACTIONS` masters (convention, not schema change).
**Compatibility:** Additive. Nothing in pgr-services' existing wiring changes; this defines how a *second* service adopts the same engine without re-inventing it, and (§5) a mechanical, low-risk path to reshape pgr-services' own wiring to match once a second adopter exists.
**Relationship to prior docs:** Builds directly on [`accesscontrol-policy-conditions-design.md`](accesscontrol-policy-conditions-design.md) (the Tier-1/Tier-2 PDP split, the JsonLogic choice, the `egov-policy` library idea floated in its §5 open questions) and [`field-level-attribute-access-design.md`](field-level-attribute-access-design.md) (field-level masking, explicitly scoped to pgr-services `"complaint"` only). This doc answers the open question those two left hanging: *what does the second adopter actually have to do?*

---

## 1. What exists today (review)

pgr-services has a working Tier-2 policy-decision-point (PDP) for one endpoint: `POST /pgr-services/v2/request/_search`. Four classes, in `org.egov.pgr.policy`:

| Class | Job | Generic today? |
|---|---|---|
| `AccessPolicyRegistry` | Fetch + 15-min-TTL cache the JsonLogic `condition` and field-visibility `resource.attributes` rules for an `(actionUrl, tenantId, caller's roles)` triple, from the `ACCESSCONTROL-ACTIONS-TEST.actions-test` MDMS master via egov-accesscontrol's `/access/v1/actions/mdms/_get`. Fails closed (`null`/empty map) on any absence — no matching action, no `condition` key, a fetch error. | **Yes.** Keyed by `actionUrl` + `tenantId`, not by any PGR concept. Zero changes needed for a new API. |
| `PolicyEvaluator` | `isAllowed(String conditionJson, Map<String,Object> data)` — one JsonLogic (`io.github.jamsesso:json-logic-java`) `apply()` call, fail-closed on missing condition, malformed JSON, evaluator exception, or non-truthy result. | **Yes.** Takes a bare `Map`; has no idea what `user`/`resource` mean. |
| `PolicyInputBuilder` | `buildUserDoc(RequestInfo, AnalyticsScope)` → generic. `buildResourceDoc(Service)` → **hardcoded** to the PGR `Service` domain object and the literal resource key `"complaint"` (`PolicyInputBuilder.java:43-53`). | **Half.** User side is reusable as-is; resource side is not. |
| `FieldVisibilityService` / `FieldVisibilityRule` / `MaskingStrategy` | Given a resolved rule map, walk each `ServiceWrapper`, evaluate each field's condition, mask via Spring `BeanWrapperImpl` (typed-POJO path navigation) with `REDACT` or `MASK_SHOW_LAST_N`, fail-closed to `REDACT` on a malformed rule. | **Mostly.** The masking mechanism (`BeanWrapperImpl`) assumes a typed POJO graph — a JSON-shaped resource (`JsonNode`/`Map`) needs a parallel path-setter, already flagged as an open item in the field-level design doc. |

Two more classes sit *outside* `org.egov.pgr.policy` and are genuinely PGR-specific by necessity, not by accident:

- **`SearchAccessPolicyService`** — orchestrates the above for `/v2/request/_search` specifically: hardcodes `AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL`, calls `PrincipalScopeResolver.resolve(...)`, and does the per-row "defense-in-depth" recheck.
- **`PrincipalScopeResolver`** — derives an `AnalyticsScope` (citizen self-scope, or employee `departmentCodes`/`jurisdictionCodes` from HRMS, with a `TENANT_WIDE_ROLES` bypass and a fail-closed `DENY_ALL_DEPARTMENT` sentinel for principals whose HRMS lookup can't be resolved).

**Wiring today is manual and narrow.** All of the above is invoked from exactly one class, `PGRService`, and only on some of its methods:

| Endpoint | Row-level `enforce()` | Field masking |
|---|---|---|
| `_search` | ✅ | ✅ |
| `_count` | scope narrows the SQL `WHERE`, no per-row recheck (no rows returned) | n/a |
| `_plainsearch` | ❌ (explicitly "unrestricted" per design) | ✅ (reuses `_search`'s action-URL key) |
| `_create` / `_update` | ❌ | ❌ — explicit non-goal per the field-level design doc |

**Test coverage is real and load-bearing.** `PolicyEvaluatorTest`, `AccessPolicyRegistryTest`, `FieldVisibilityServiceTest`, `SearchAccessPolicyServiceTest`, `MaskingStrategyTest` each carry an explicit "unknown/malformed/absent → fail closed" case as a first-class scenario, not an afterthought. **Any generalization must preserve this invariant byte-for-byte** — it is the one thing every other design choice in this doc is built to protect.

**The MDMS data contract** (already stable, reusable as-is): one row per `(actionUrl↔actionId)` in `ACCESSCONTROL-ACTIONS-TEST.actions-test`, carrying an optional top-level `condition` (JsonLogic, row-level) and an optional `resource.<resourceType>.attributes.<fieldPath>` map (each entry `{condition, onDeny}`, field-level); one row per `(rolecode, actionid)` in `ACCESSCONTROL-ROLEACTIONS.roleactions` granting a role visibility of that action at all. This is exactly the shape a brand-new API should reuse — see §4.

---

## 2. Where genericity actually breaks (the two real blockers)

Everything in §1's "generic today" column needs **zero code changes** for a second API. The gap is narrower than "rebuild the ABAC engine" — it's two specific seams:

**Blocker A — the resource doc is hand-written per resource type.** `PolicyInputBuilder.buildResourceDoc(Service)` only knows how to read a PGR `Service`. A new API's resource object (a licence, an asset, an HRMS employee record — whatever) needs its own small mapping function. This is *expected and fine* — the design doc that shipped this already says so (field-level doc §4.5: *"reuse for other resource types... is a config addition, not a code change, once a second call site adopts FieldVisibilityService"*) — but there's no shared *shape* for that mapping function today, so every team would invent their own calling convention.

**Blocker B — there's no reusable orchestration facade.** `SearchAccessPolicyService` bakes the PGR search endpoint's URL constant and its own call sequence (`resolveScope` → SQL-narrow → fetch rows → `enforce` → `FieldVisibilityService.apply`) directly into one class. A second service copy-pastes this whole class today, changing a handful of lines — that's exactly the "bespoke class per service" failure mode we want to avoid.

Scope resolution (`PrincipalScopeResolver`) is *correctly* service-specific and is **not** a blocker — "what does a principal's scope mean" genuinely differs per domain (HRMS department+jurisdiction for PGR; maybe an org hierarchy for a licensing service; maybe nothing at all for a service with no row-level scoping need). What's missing is a common *interface* so the orchestration facade in §3 doesn't need to know which scope resolver it's calling.

---

## 3. Proposed generalization

Three additive pieces. Nothing below requires touching `AccessPolicyRegistry`, `PolicyEvaluator`, `FieldVisibilityService`, `MaskingStrategy`, or `FieldVisibilityRule` — they already are the reusable core.

### 3.1 A `ScopeResolver` interface (closes nothing that's broken — just names what already works)

```java
public interface ScopeResolver<S> {
    S resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen);
}
```

`PrincipalScopeResolver` becomes `ScopeResolver<AnalyticsScope>` with no behavior change (it already has this exact method signature). A new domain that needs no scoping at all can use a trivial `NoOpScopeResolver` that always returns a "tenant-wide" scope — making the facade in §3.3 usable even for APIs that only need field masking, not row filtering.

### 3.2 A generic resource-doc contract, not a generic resource-doc builder

Don't try to build one function that maps *any* domain object to a resource doc — domain objects are too different. Instead, standardize the **function shape** every resource type provides:

```java
@FunctionalInterface
public interface ResourceDocBuilder<T> {
    Map<String, Object> build(T resource); // must return {"<resourceType>": {...fields...}}
}
```

`PolicyInputBuilder.buildResourceDoc(Service)` becomes the PGR implementation of `ResourceDocBuilder<Service>` — same code, same file, just typed against the interface. A new API writes one function of the same shape (see §4 step 6) — typically 5-15 lines, matching `extractBoundary`/`extractDepartment`'s style of "null-safe, fails closed on missing data."

For APIs whose resource is JSON-shaped (`JsonNode`/`Map`) rather than a typed POJO — the exact gap the field-level design doc's "Open items" section already flagged — `FieldVisibilityService`'s masking step needs a `JsonNodeFieldVisibilityService`/`MapFieldVisibilityService` variant alongside the existing `BeanWrapperImpl`-based one, selected by resource shape. This is the one piece of *new* generic code this doc actually calls for (small: a `FieldMasker` interface with a bean-path and a JsonNode-path implementation, swapped by resource shape, everything else in `FieldVisibilityService` unchanged).

### 3.3 A generic orchestration facade — `ApiAccessPolicyEnforcer<S, T>`

```java
@Component
public class ApiAccessPolicyEnforcer {

    public <S> S resolveScope(ScopeResolver<S> scopeResolver, RequestInfo ri, String tenantId, int stateLevelLen) {
        return scopeResolver.resolve(ri, tenantId, stateLevelLen);
    }

    // Row-level defense-in-depth recheck — same shape as SearchAccessPolicyService.enforce today.
    public <T> List<T> enforce(String actionUrl, RequestInfo ri, Object scope,
                                ResourceDocBuilder<T> resourceDocBuilder,
                                UserDocBuilder<Object> userDocBuilder,
                                List<T> rows) { ... }

    // Field-level masking — same shape as FieldVisibilityService.apply today.
    public <T> void applyFieldMasking(String actionUrl, String resourceType, RequestInfo ri,
                                       Object scope, ResourceDocBuilder<T> resourceDocBuilder,
                                       UserDocBuilder<Object> userDocBuilder, List<T> rows) { ... }
}
```

This is a thin wrapper — it delegates straight into `AccessPolicyRegistry`/`PolicyEvaluator`/`FieldVisibilityService`, which do not change. Its only job is to remove the "copy `SearchAccessPolicyService`, rename a few things" step. A new service's integration (§4 step 7) becomes 3-4 lines calling this facade, not a new class.

**Where this lives:** given both prior design docs already flag "should this be a shared `egov-policy` JAR" as an open question (§5 of the conditions doc), and this proposal doesn't need to answer that to be useful — start it as a package inside pgr-services (`org.egov.pgr.policy` already, or promote to a top-level `org.egov.policy` package within the same module) and extract to a real shared module **only once a second consuming service exists and the interface has proven itself against a real second case.** Extracting a library before a second consumer is guessing at the interface; extracting after is refactoring a working thing. See §7.

---

## 4. Runbook: adding ABAC to a new API

This is the part to hand to a team wiring up a *different* service. Concrete, in order, each step calling out what's data/config (no code, no deploy of pgr-services) vs. what's a real code change in the *new* service.

### Step 0 — Decide what you're protecting

Write down, in plain language, before touching any JSON: who should see which rows, and which individual fields (if any) need masking rather than full-row hiding. This is the design doc's whole point — do this in a doc/PR description first, not in code. (See this repo's own [`field-level-attribute-access-design.md`](field-level-attribute-access-design.md) as the template for what that looks like.)

### Step 1 — Pick a resource type name and enumerate protected fields *(design decision, no code)*

Pick a short lower-case name for your resource (`"license"`, `"asset"`, `"employee"`) — this is the key under `resource` in every JsonLogic condition and under `resource.<name>.attributes` in the MDMS action row. List every field that needs masking (not just filtering) by its dotted path on the response object (e.g. `citizen.mobileNumber` in the PGR precedent).

### Step 2 — Write the JsonLogic condition(s) *(data, no code)*

Two, potentially:
- **Row-level `condition`** — top-level `condition` on the action row. Must reference only `user.*` and `resource.<name>.*` paths you intend to populate in step 6. Follow the PGR precedent's shape:
  ```jsonc
  {"or": [
    {"==": [{"var": "user.attributes.tenantWide"}, true]},
    {"and": [{"==": [{"var": "user.type"}, "CITIZEN"]},
             {"==": [{"var": "resource.<name>.accountId"}, {"var": "user.uuid"}]}]},
    {"and": [{"==": [{"var": "user.type"}, "EMPLOYEE"]},
             {"in": [{"var": "resource.<name>.department"}, {"var": "user.attributes.departments"}]}]}
  ]}
  ```
- **Per-field `condition` + `onDeny`** — under `resource.<name>.attributes.<fieldPath>`, each entry `{"condition": <JsonLogic>, "onDeny": {"strategy": "REDACT"}}` or `{"strategy": "MASK_SHOW_LAST_N", "n": 2, "maskChar": "X"}`.

**Test every condition against the fail-closed contract before it ships**: what does it evaluate to if a referenced `var` is absent? JsonLogic returns `null`/`undefined` for a missing var, which is falsy — so an `==`/`in` against a missing var already denies by default. Don't rely on this implicitly; write the test (§8) that proves it.

### Step 3 — Register the Action row *(MDMS data, at the bootstrap-source tenant)*

Create (or, if it already exists with the wrong shape — see this session's own recovery of a stale copy — `_update`) a row in `ACCESSCONTROL-ACTIONS-TEST.actions-test` at your source tenant (typically `pg`, so `tenant_bootstrap` propagates it to every new tenant automatically — see §9):

```jsonc
{
  "id": <pick an unused numeric id>,
  "url": "/your-service/v1/your-resource/_search",
  "method": "POST",
  "name": "Search Your Resource",
  "enabled": false,
  "resource": {"<name>": {"attributes": { "<fieldPath>": {"condition": {...}, "onDeny": {...}} }}},
  "condition": {...from step 2...}
}
```

`enabled: false` is not a mistake — `MDMSUtils.fetchAccessControlActions`'s javadoc explicitly omits the `enabled` filter from its request so it fetches regardless of this flag; it's legacy metadata from the URL-only gateway RBAC path, unrelated to ABAC condition evaluation.

### Step 4 — Register RoleAction mappings *(MDMS data)*

One `ACCESSCONTROL-ROLEACTIONS.roleactions` row per role that should be able to reach this action at all: `{"actionid": <your id>, "rolecode": "<ROLE>", "tenantId": "<source tenant>"}`. **A role with no mapping here never sees the action — the condition is never even evaluated for them, they're denied before the JsonLogic engine runs.** This tripped up this exact session: an action can have a perfect condition and still deny everyone because no role is mapped to it.

### Step 5 — Reuse or implement a `ScopeResolver`

If your row-level scoping is "citizen sees own records; employee sees own department + jurisdiction via HRMS" — you likely don't need a new resolver; check if `PrincipalScopeResolver`'s existing HRMS-based logic fits and reuse it directly (it's already generic over `tenantId`/`stateLevelLen`, nothing PGR-specific in its department/jurisdiction resolution beyond calling HRMS). If your scoping model is genuinely different (e.g., an org hierarchy instead of department+jurisdiction), implement `ScopeResolver<YourScopeType>` (§3.1) — one class, following `PrincipalScopeResolver`'s fail-closed pattern: **any principal whose scope can't be resolved must be denied, never granted broad access as a fallback.**

### Step 6 — Write your `ResourceDocBuilder`

One function, same shape as `PolicyInputBuilder.buildResourceDoc` (§3.2): read your domain object's fields, return `{"<name>": {field: value, ...}}`. Every field referenced by a `resource.<name>.*` path in step 2 must appear here. Null-safe throughout — a missing/unresolvable field should map to `null` (which fails closed against most conditions), not throw.

### Step 7 — Wire the facade into your service method

Using the shared `ApiAccessPolicyEnforcer` (§3.3) once it exists, or `SearchAccessPolicyService`'s current shape as a direct template if it doesn't yet:

```java
YourScope scope = enforcer.resolveScope(yourScopeResolver, requestInfo, tenantId, stateLevelLen);
// ...fetch rows, ideally already narrowed by `scope` at the SQL layer for correctness+performance...
rows = enforcer.enforce(YOUR_ACTION_URL, requestInfo, scope, yourResourceDocBuilder, userDocBuilder, rows);
enforcer.applyFieldMasking(YOUR_ACTION_URL, "<name>", requestInfo, scope, yourResourceDocBuilder, userDocBuilder, rows);
```

SQL-level narrowing (the `scope` feeding your query's `WHERE`) is **not** part of the generic facade — it's inherently specific to your query builder, exactly as it is for `PGRQueryBuilder` today. The facade's `enforce()` step is the safety net if that narrowing has a bug or is skipped, per the "defense-in-depth" name — never treat SQL narrowing alone as sufficient; keep the recheck.

### Step 8 — Tests: the mandatory fail-closed checklist

Mirror the five PGR test classes' scenario list — this is the load-bearing contract from §1, and it's what stops a plausible-looking but wrong condition from shipping:

- [ ] Malformed/unparseable condition → denied.
- [ ] Missing condition on the action row → denied.
- [ ] No matching Action visible for the caller's roles (step 4 forgotten) → denied.
- [ ] MDMS/accesscontrol unreachable → denied, not "allow everything."
- [ ] Scope resolution fails (e.g. HRMS lookup errors) for a non-tenant-wide role → denied, never falls back to unrestricted.
- [ ] The actual intended-allow case: citizen owns the record; employee's department+jurisdiction (or your domain's scoping) matches.
- [ ] The actual intended-deny case: a resource that legitimately shouldn't be visible.
- [ ] Field masking: allowed condition → field passes through untouched; denied condition → correct `onDeny` strategy applied (`REDACT` → null; `MASK_SHOW_LAST_N` → correct partial reveal); unrecognized/missing `onDeny` → defaults to `REDACT`, never to "show".

### Step 9 — Manual verification matrix (mirrors this session's own runbook)

Before calling it done, build the same role × resource parity table the PGR ABAC verification used all session: for each role that should reach the endpoint, log in for real, hit the endpoint for real, and record allowed/masked/denied per row. Concretely, the pattern used repeatedly in this session:
1. `POST /access/v1/actions/mdms/_get` with the role's codes + your action's tenant — confirm your action id appears **and its `condition` is present** (not silently dropped — this happened once this session due to a stale partial MDMS row).
2. Real login (OTP or password grant) as a representative of each role.
3. Real call to your endpoint; compare the returned rows/fields against your parity table.

### Step 10 — Seed the source tenant, not just your test tenant

Steps 3-4's MDMS rows must exist at the tenant `tenant_bootstrap` actually copies *from* (typically `pg`) for every future tenant to inherit them automatically — seeding only your one test tenant repeats the exact gap this session found and fixed (an action that existed only on one tenant, not the bootstrap source, so every *other* tenant silently had no policy at all). If your resource type also needs tenant-specific *data* seeded (not just the policy config) — e.g., the resource's own domain data, analogous to this session's `RAINMAKER-PGR.ComplaintHierarchy` gap — write a small idempotent seed script following `local-setup/scripts/seed-tenant-city-data.py`'s pattern (search-then-create, safe to rerun, no destructive step) rather than one-off manual commands.

---

## 5. What changes in pgr-services itself (mechanical, deferred until a second adopter exists)

To avoid speculative work: **do nothing here yet.** Once a second service has actually gone through §4 and the `ScopeResolver`/`ResourceDocBuilder`/facade interfaces have proven themselves against a real second case (not a hypothetical), retrofitting pgr-services is a rename, not a rewrite:
- `PrincipalScopeResolver implements ScopeResolver<AnalyticsScope>` — no behavior change, its method signature already matches.
- `PolicyInputBuilder::buildResourceDoc` becomes the `ResourceDocBuilder<Service>` implementation — same method body.
- `SearchAccessPolicyService` either stays as a thin PGR-specific caller of the shared facade, or is deleted in favor of direct facade calls from `PGRService` — a judgment call for whoever does the retrofit, not this doc.

## 6. Non-goals

- This doc does **not** propose changing SQL-level query scoping into anything generic — that stays per-service by necessity (§2).
- This doc does **not** resolve the two open questions already on record in `accesscontrol-policy-conditions-design.md` §5 (shared JAR vs. per-service package; a `/whatCanIDo?resource=...` decision endpoint for UI consumption vs. shipping JsonLogic to the frontend) — both are still open, both matter more once there's a second real adopter to design against.
- This doc does **not** cover `_create`/`_update` ABAC for pgr-services itself — still an explicit non-goal per the field-level design doc, unchanged here.

## 7. Rollout

1. Land `ScopeResolver`/`ResourceDocBuilder` interfaces + `ApiAccessPolicyEnforcer` facade in pgr-services' `org.egov.pgr.policy` package (additive; `PrincipalScopeResolver`/`PolicyInputBuilder`/`SearchAccessPolicyService` keep working unchanged, or are updated to implement the new interfaces with no behavior change — see §5).
2. First real adopter follows §4 end-to-end against a genuinely different resource type.
3. Only after step 2 succeeds: decide, with real evidence instead of speculation, whether to extract a shared `egov-policy` module (per the standing open question) — and whether a JSON-shaped `FieldMasker` variant (§3.2) is actually needed or premature.

## 8. Open questions

- Should `ApiAccessPolicyEnforcer` live in pgr-services (fastest to ship, but a new service now depends on pgr-services) or be extracted to a new minimal module *before* the second adopter, accepting the risk of designing an interface against zero real second use cases?
- For a resource type with no natural HRMS-department/jurisdiction analogue, is a `NoOpScopeResolver` (field-masking only, no row filtering) a real, expected use case, or should row-level `enforce()` be made optional/skippable per adopter instead of forcing a trivial resolver?
- Same two unresolved questions from the original conditions design doc (JAR vs. sidecar; UI decision-endpoint vs. shipping JsonLogic client-side) — still open, still blocking a cross-frontend answer.
