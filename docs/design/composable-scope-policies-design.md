# Access Control — Configurable Per-Role Record-Scope Axes

**Author:** Vinoth Rallapalli · **Date:** 2026-07-15 · **Status:** Proposal — feedback requested before implementation
**Scope:** `pgr-services` (`PrincipalScopeResolver`, `SearchAccessPolicyService`, `PolicyInputBuilder`, `PGRQueryBuilder`), the `ACCESSCONTROL-ACTIONS-TEST.actions-test` MDMS master (action id 2008's `condition`/`resource`).
**Compatibility:** Additive and opt-in. A role with no explicit config falls back to today's exact behavior (department **AND** jurisdiction required) — no existing role's visible-complaint set changes unless a policy author explicitly configures it.

---

## 1. Problem

Confirmed empirically this session with a live 2×2 test matrix (two departments × two wards, four employees covering every combination): the current record-level scope for an employee is **department AND jurisdiction**, always, hardcoded in Java, for every non-tenant-wide role. There is no way today to make either axis role-conditional.

Two concrete, contradictory-looking asks that both need to be true at once, per-deployment:
- A `PGR_LME` should see **every department's** complaints within their mapped boundary — jurisdiction matters, department doesn't, for that role.
- A `DEPT_1`-scoped role should be able to see **all boundaries'** complaints within their department — department matters, jurisdiction doesn't, for that role.
- Each country/deployment needs to decide this **for itself**, per role, as configuration — not as a Java code change per combination, and not as an elaborate framework that's its own maintenance burden.

That last point matters as much as the first two: this doc's earlier draft proposed one independent JsonLogic predicate per axis. Feedback on that draft was direct — don't build a mechanism with more moving parts than the actual problem has. The problem, restated plainly: **for each role, which of {department, jurisdiction} must match?** That's a lookup, not a rules engine.

### Why this can't be done by editing the row-level `condition` alone

`PGRQueryBuilder.applyScope` builds the SQL WHERE clause; `SearchAccessPolicyService.enforce`'s JsonLogic `condition` only re-checks rows the SQL layer already fetched — it can narrow the result set, never widen it (see `SearchAccessPolicyService`'s own javadoc). `PrincipalScopeResolver` today always populates **both** `departmentCodes` and `jurisdictionCodes` for every constrained employee, and the query builder ANDs both in whenever they're non-empty. So a more permissive `condition` alone changes nothing — the SQL layer already excluded the row before the condition ever runs. The fix has to start at `PrincipalScopeResolver`, which means it needs role-driven, data-configured behavior, not another hardcoded Java rule.

## 2. Goal

One small piece of configuration, read once per request, that says: *for this role, which axes apply*. Fully flexible (any combination of department/jurisdiction, per role, per tenant) — but nothing more elaborate than a lookup table. Configurable per country/deployment (it's tenant-scoped MDMS data, like everything else in this policy engine) with zero code change to add, remove, or reconfigure a role.

## 3. Design

### 3.1 The config: a flat role → required-axes map

```jsonc
// action 2008's existing "resource" object gains a sibling to "attributes" (field masking):
"resource": {
  "complaint": {
    "attributes": { "citizen.mobileNumber": { "...": "unchanged, existing field masking" } },

    // NEW — for each role code, which axes must match for that role to see a complaint.
    // Values are a subset of ["department", "jurisdiction"]. A role not listed here falls
    // back to the default ["department", "jurisdiction"] — today's exact behavior (see
    // §3.4 for why that's the fail-closed default, not []).
    "scopeAxesByRole": {
      "PGR_LME": ["jurisdiction"],           // sees every department, within their boundary
      "DEPT1_REGIONAL_HEAD": ["department"], // sees every boundary, within their department
      "GRO": ["department", "jurisdiction"], // unchanged — both must match (same as default)
      "PGR_ADMIN": []                        // empty = neither axis applies = unrestricted
    }
  }
}
```

That's the entire config surface. No nested JsonLogic per axis, no nested conditions — one map, one small fixed vocabulary (`"department"`, `"jurisdiction"`), read by role code. A role mapped to `[]` is unrestricted (same effect as today's hardcoded `TENANT_WIDE_ROLES` set in `PrincipalScopeResolver` — see §3.6, this map can absorb that special case too instead of keeping it as a separate hardcoded list).

**Per-country flexibility comes for free**: this lives in the same tenant-scoped MDMS action document every other piece of this policy engine already reads per-tenant. A different country's deployment configures its own `scopeAxesByRole` for its own role codes — no shared code path changes.

### 3.2 Multiple roles on one user: most-permissive-wins

A user can hold more than one role (e.g. `EMPLOYEE` + `PGR_LME`). Take the **intersection** of each held role's required-axes list, not the union — restrictions should only be *removed* by holding an additional, more-permissive role, never added:

```
effective axes = ∩ (scopeAxesByRole[role] for each role the user holds, default axes for unlisted roles)
```

Example: a user holding both `GRO` (`["department","jurisdiction"]`) and `PGR_LME` (`["jurisdiction"]`) gets the intersection `["jurisdiction"]` — the more permissive of the two roles determines what's visible. This needs to be explicit and tested (§4), since "which combination rule" is exactly the kind of thing that's obvious in one direction and wrong in the other.

### 3.3 `PolicyInputBuilder` gains `user.roles`

```java
// PolicyInputBuilder.buildUserDoc
List<String> roleCodes = user == null || user.getRoles() == null
    ? List.of()
    : user.getRoles().stream().map(Role::getCode).filter(Objects::nonNull).toList();
userDoc.put("roles", roleCodes);
```

Needed so the row-level condition (§3.5) can expose axis applicability without re-deriving role logic itself — see below, the condition never actually needs to inspect `user.roles` directly.

### 3.4 `AccessPolicyRegistry` gains one lookup method

```java
/** Effective axes for this caller = intersection of scopeAxesByRole[role] across every role
  * they hold (default ["department","jurisdiction"] for any role not listed). Empty result =
  * unrestricted for both axes. Missing/malformed scopeAxesByRole entirely → every role falls
  * back to the default, i.e. today's behavior, unchanged. */
public Set<String> getEffectiveScopeAxes(String actionUrl, RequestInfo requestInfo, String tenantId, List<String> roleCodes);
```

One extra small computation inside the existing fetch/cache path (`AccessPolicyRegistry` already fetches and caches the whole action document per tenant+url — this reads one more field off the same cached object, no new fetch).

**Fail-closed default is `["department","jurisdiction"]`, not `[]`.** A role with no entry, or a malformed/unparseable `scopeAxesByRole`, must fall back to requiring **both** axes — the current, already-shipped, tested-safe behavior — never to `[]` (unrestricted). Defaulting to unrestricted on a config gap would be a fail-**open** hole; defaulting to "both axes required" only ever narrows visibility for an under-configured role. Same fail-closed posture as everywhere else in this policy engine (`AccessPolicyRegistry`, `PolicyEvaluator`, `FieldVisibilityService`).

### 3.5 `PrincipalScopeResolver` becomes the one place this gets consulted

`resolveEmployeeScope` calls `registry.getEffectiveScopeAxes(...)` once (after resolving the user's roles, before populating `departmentCodes`/`jurisdictionCodes` from HRMS), then populates `departmentCodes` only if `"department"` is in the effective set, and `jurisdictionCodes` only if `"jurisdiction"` is — leaving the other **empty**, not omitted. `PGRQueryBuilder.applyScope` already treats an empty list as "no predicate for this axis" (its existing `CollectionUtils.isEmpty` check) — **no change needed to `PGRQueryBuilder` at all**. This is the same one-line insight the earlier draft had, just now driven by a simpler config shape.

This also means `PrincipalScopeResolver`'s hardcoded `TENANT_WIDE_ROLES` set (§3.6) and this new lookup are doing conceptually the same thing (deciding which axes apply per role) through two different mechanisms — worth actually merging them, not maintaining both.

### 3.6 Absorbing `TENANT_WIDE_ROLES` into the same mechanism

Today, `PrincipalScopeResolver.TENANT_WIDE_ROLES` is a hardcoded Java `Set<String>` (`PGR_ADMIN`, `SUPERUSER`, `MDMS_ADMIN`, `HRMS_ADMIN`, `STADMIN`, `SUPERVISOR`, `PGR_SUPERVISOR`) used as a fail-**open** fallback when HRMS resolution fails. That's a *different* concern from this doc (it's about tolerating a missing HRMS record for admin-tier roles, not about which axes apply when HRMS resolution *succeeds*) — but if a role is mapped to `scopeAxesByRole[role] = []` (e.g. `PGR_ADMIN`), the two mechanisms should agree: an empty effective-axes result should mean "unrestricted" regardless of whether it came from a successful axis lookup or from the existing HRMS-failure fallback. Recommend keeping `TENANT_WIDE_ROLES` as the HRMS-failure fallback (unrelated failure mode, shouldn't be re-plumbed through MDMS), but documenting the overlap so nobody's surprised that `PGR_ADMIN` ends up unrestricted two different ways.

### 3.7 Row-level condition: two booleans, not role names

Rather than teaching the JsonLogic `condition` to inspect `user.roles` (duplicating the axis lookup logic in a second place), `PolicyInputBuilder.buildUserDoc` exposes the **result** of the same `getEffectiveScopeAxes` computation as two booleans, computed once and reused by both the SQL-side resolver and the row-level check:

```java
Set<String> axes = registry.getEffectiveScopeAxes(...);  // same call PrincipalScopeResolver already made
attributes.put("departmentScopeApplies", axes.contains("department"));
attributes.put("jurisdictionScopeApplies", axes.contains("jurisdiction"));
```

The row-level `condition`'s employee branch becomes a small, direct, stable edit — no role names embedded in it at all:

```jsonc
{ "and": [
    { "==": [ { "var": "user.type" }, "EMPLOYEE" ] },
    { "or": [ { "==": [ { "var": "user.attributes.departmentScopeApplies" }, false ] },
              { "in": [ { "var": "resource.complaint.department" }, { "var": "user.attributes.departments" } ] } ] },
    { "or": [ { "==": [ { "var": "user.attributes.jurisdictionScopeApplies" }, false ] },
              { "in": [ { "var": "resource.complaint.boundary" }, { "var": "user.attributes.jurisdictions" } ] } ] }
] }
```

This is a **one-time** condition edit (ships once, with this feature) — after that, every future role/axis reconfiguration is a pure `scopeAxesByRole` data change, the condition itself never needs touching again. Single source of truth: `getEffectiveScopeAxes` is computed once per request and consumed by both the SQL prefilter (as empty/non-empty lists) and the row-level re-check (as these two booleans) — nothing to keep hand-synced, nothing that can drift.

### 3.8 Worked examples

- **`PGR_LME`** (`scopeAxesByRole: ["jurisdiction"]`): `departmentCodes` stays empty (no SQL department predicate), `jurisdictionCodes` populated as today. Sees every department's complaints within their mapped boundary — the original ask.
- **`DEPT1_REGIONAL_HEAD`** (`scopeAxesByRole: ["department"]`): `jurisdictionCodes` stays empty (no SQL boundary predicate), `departmentCodes` populated as today. Sees every boundary's complaints within their department — the follow-up ask.
- **`GRO`** (not listed, or explicitly `["department","jurisdiction"]`): unchanged from today.
- **`PGR_ADMIN`** (`scopeAxesByRole: []`): both lists stay empty — unrestricted, same net effect as today's `TENANT_WIDE_ROLES` fallback, now reachable via ordinary config too.

Acceptance test: re-run this session's 2×2 matrix (`EMP001` DEPT_1/WARD_001, `EMP010` DEPT_2/WARD_001, `EMP004` DEPT_2/WARD_002, `EMP011` DEPT_1/WARD_002) with a `PGR_LME`-role employee at `WARD_001` — should see all `WARD_001` complaints regardless of department. Add one more department-only case (e.g. an employee scoped `["department"]` only, in `DEPT_1`, across both `WARD_001` and `WARD_002`) to prove the reverse axis works too.

## 4. Rollout

1. `PolicyInputBuilder.buildUserDoc` — add `user.roles`, `attributes.departmentScopeApplies`, `attributes.jurisdictionScopeApplies`. Unit tests: default (no config) → both `true`; role-specific overrides → matches `scopeAxesByRole`.
2. `AccessPolicyRegistry.getEffectiveScopeAxes` — new method, same cached fetch. Unit tests: missing/malformed `scopeAxesByRole` → default axes for every role (fail-closed, §3.4); multi-role intersection (§3.2) — explicitly test the "more permissive role wins" direction, since it's easy to get backwards; unknown role code → default axes.
3. `PrincipalScopeResolver.resolveEmployeeScope` — consult effective axes before populating `departmentCodes`/`jurisdictionCodes`; leave a list empty (not the deny-all sentinel) when its axis doesn't apply. `PGRQueryBuilder` unchanged.
4. One-time edit to action 2008's row-level `condition` per §3.7. This is the only condition edit this feature requires, ever — every subsequent role/axis change is pure MDMS data.
5. MDMS data change (no redeploy) to add `scopeAxesByRole` entries for `PGR_LME` (and whichever other roles need it) on action 2008.
6. Re-run the 2×2 matrix (§3.8) plus the department-only case as the acceptance test.
7. Regression: every existing JUnit test in `PrincipalScopeResolverTest`/`SearchAccessPolicyServiceTest`/`PolicyEvaluatorTest`/`AccessPolicyRegistryTest` should pass unchanged — no `scopeAxesByRole` config exists today, so every role defaults to `["department","jurisdiction"]`, identical to current behavior.

## 5. Open questions (feedback wanted before implementation)

- **Where does `scopeAxesByRole` live?** Proposed above as a sibling of `resource.complaint.attributes` on the same action (2008) — reuses the one fetch/cache already in place, and keeps this PGR-search-specific for now (matching `SearchAccessPolicyService`'s own javadoc note that a generic version belongs in a shared library later). Alternative: key it by role on a role master instead of by action, if the same per-role axis choice should ever need to apply across multiple actions/services — not needed yet, called out here so it's a deliberate "not yet" rather than an oversight.
- **§3.2 combination rule** — intersection (most-permissive-role-wins) is proposed as the only sane default; confirming there's no scenario where the *opposite* (most-restrictive-wins) is actually wanted for some role pair.
- **§3.6** — comfortable leaving `TENANT_WIDE_ROLES` as a separate, HRMS-failure-specific fallback rather than folding it fully into `scopeAxesByRole`? (Recommendation: yes, they're different failure modes, but flagging the conceptual overlap so it's a documented decision, not a surprise.)
