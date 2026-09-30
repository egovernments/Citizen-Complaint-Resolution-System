# Part C — Row-Scope Enforcement (generalized attribute scoping)

**Status:** v2 (pass-1 findings folded in), 2026-06-23 · **Maps to:** implementation plan Phases 2–3 · **Depends on:** Part A (trust foundation) and Part B (identity → attribute resolution) · **Series spec:** `rbac-deep-design/00-requirements.md`.

**Reads grounded for this part (every claim below is anchored to a line actually re-opened for v2):**
- `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsScope.java` (the scope object to generalize; `resolve()` L31–48; boundary hardcoded `null` at L47)
- `…/analytics/AnalyticsPlanner.java` — `applyScope()` **L241–251** (the injection point; tenant L242–245, citizen L246, boundary LIKE + escape L247–249); `predicate()` L173–201 with the filterable gate at **L174**; `inferGrain()` L267–275; scope ANDed at L98 and joined at L103
- `…/analytics/AnalyticsCatalog.java` — `Grain` model fields **L34–37** (`tenantColumn` L34, `boundaryColumn` L35, `citizenColumn` L36, `defaultTimeRole` L37); facts grain L54–78, events L81–96, daily L99–108 (daily `citizenColumn=null` at **L108**); facts filterable L65–69 (`department_code` at L66, `boundary_path` **absent**); events filterable L89–92; daily filterable L104–105
- `…/analytics/AnalyticsService.java` — `query()` L30–56; batch arm try/catch **L45–46**; `runOne()` L58–69; `scopeCols()` **L96–102**; `asOf()` L104–107; `scopeInfo()` L109–116 (reads `s.boundaryPrefix` at **L114**); `err()` split L118–124
- `…/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql` — events MV L12–97 (no `department_code`, no MDMS join; the `FROM tx`/LEFT JOIN block L92–97); facts MV `mdms` CTE L141–151 (`data->>'department' AS department_code` at L147), `m.department_code` projected at **L169**, `LEFT JOIN mdms m` at **L227**; facts indexes L231–236; daily table L239–253 (no `department_code`, no `account_id`); daily snapshot INSERT described at L255
- design `dashboard-query-api-design.md` §5 (scope-is-`boundary_path`-on-all-grains; never `ward_code`) and §5a (layering)

---

## Goal & responsibilities (what this part owns; what it explicitly does NOT)

**This part owns the Layer-1 row-scope spine: turning a resolved principal's attributes into injected `WHERE` predicates on *every* generated query, on *every* grain — and making *every* scope axis (tenant, citizen, attribute) fail closed when a grain cannot serve it.** Concretely it owns four deliverables:

1. **Generalize `AnalyticsScope`** from the fixed pair `{citizenUuid, boundaryPrefix}` (`AnalyticsScope.java:23–24`) into `{citizenUuid, List<AttrScope> attrScopes}` — an ANDed list of attribute predicates, OR-within-each, per requirements §4.
2. **Generalize `applyScope()`** (`AnalyticsPlanner.java:241–251`) from three hardcoded branches into the existing tenant/citizen branches **plus** a loop over `attrScopes`, emitting `PREFIX` (escaped `LIKE … ESCAPE '\'`) for `boundary_path` and a parameterized `IN (?,…)` for `department_code`; bind each logical attribute to the grain's physical column via the `Grain` model and **fail closed** when a grain cannot serve a *required* scope axis.
3. **Close the citizen×daily silent leak (NEW in v2 — the convergent blocker).** The citizen self-scope predicate at `AnalyticsPlanner.java:246` is guarded by `g.citizenColumn != null`, and the daily grain's `citizenColumn` is `null` (`AnalyticsCatalog.java:108`). So a pure citizen issuing `grain:"daily"` today gets **only tenant scope** → the whole tenant's open-complaint backlog. Part C closes this by routing **citizen self-scope through the same fail-closed gate** as attribute scopes (C.3a) **and** by adding `account_id` to the daily grain in the C.5 migration so the citizen predicate binds on daily.
4. **Close the events-grain `department_code` leak** — the facts MV carries `department_code` (`…create_v2_grain_mvs.sql:169`, sourced from the `mdms` CTE L141–151, join L227) but the events MV select never projects it (L52–91; the `FROM tx`/join block L92–97 has no MDMS join); shipping department scope on facts-but-not-events is a silent leak (requirements §7.4). This part adds the one migration that alters the events MV to project `department_code`, and only then marks events department-capable in the catalog.

**This part explicitly does NOT own:**
- **Trust.** Whether the principal is real is Part A's job. Part C consumes whatever the resolver is handed; if that principal is forged, Part C faithfully scopes the forged identity. Part C is correct *given* a trustworthy principal and meaningless without one — hence the hard A→C dependency (requirements §8). **Fail-open identity** (the reused `ServiceRequestRepository.fetchResult` swallowing 5xx → `null`, README cross-cutting #2) is **Part A's**: Part C assumes a non-null, coerced principal and does not itself map `null`→`401`.
- **Attribute resolution.** *How* `boundaryPrefixes[]` and `departmentCodes[]` are produced from HRMS, their caching, the HRMS-vs-MDMS department code-space consistency check, **and the propagation of `tenantStateLevel` into the resolved attributes** are **Part B** (`PrincipalAttributes`). Part C defines the *contract* it consumes (C.1) and assumes the codes are already normalized to the complaint code-space. README cross-cutting #7 ("`tenantStateLevel` dropped in `PrincipalAttributes`") is therefore **owned by Part B**; Part C still computes `stateLevel` itself from `tenantId` + `stateLevelLen` exactly as the live `resolve()` does (`AnalyticsScope.java:32`), so the state-vs-city `LIKE`/`=` choice is never lost on the Part C side.
- **Catalog visibility (Layer 2 / Part D), packs (Part E), inline-query gating (Layer 3 / Part F).** Those decide *which question* you may ask; Part C decides *which rows* come back. The two never substitute (requirements §3): an empty row scope never widens a `visibleTo` ceiling, and a forbidden KPI is never rescued by row scope. The **batch-arm bypass** (README cross-cutting #5: `AnalyticsService.query()`'s batch dict arm calls `runOne()` directly at L45–46, bypassing any single-arm-only gate) is a **Part D/F** wiring concern — Part C's scope is injected inside `runOne()`→`plan()`→`applyScope()` (L98) and so applies to **both** arms identically; Part C neither relies on nor reintroduces that hole.

**The citizen self-scope branch is NO LONGER preserved verbatim.** v1 kept the citizen predicate (`AnalyticsScope.java:44`; planner L246) unchanged as a parallel, non-attribute predicate. The pass-1 review showed that "unchanged" is precisely the daily-grain leak. v2 keeps citizen scope as a distinct, non-attribute axis (it is still an exact `account_id =`, not an `AttrScope`) **but routes it through the same fail-closed binding** so it can never silently no-op on a grain lacking the column (C.3a).

---

## Current code reality (file:line — what exists today vs what's missing)

**The injection point already exists and already ANDs into every grain's query.** `AnalyticsPlanner.plan()` calls `applyScope(scope, g, conj, whereParams)` at L98, after explicit filters (L90–96) and window (L97), and the `conj` list becomes the `WHERE` at L103. So scope is structurally guaranteed to be ANDed into every query already — Part C changes *what* `applyScope` emits, not *whether* it runs. **This also closes the batch-arm concern at the Part-C layer:** both the batch arm (`AnalyticsService.java:45`) and the single arm (L51) call `runOne()` → `plan()`, so scope injection covers both.

**`applyScope()` today (L241–251) has exactly three branches:**
```java
// AnalyticsPlanner.java:241-251 (verbatim)
private void applyScope(AnalyticsScope scope, Grain g, List<String> conj, List<Object> params){
    if (scope.tenantId != null) {
        if (scope.tenantStateLevel) { conj.add(g.tenantColumn + " LIKE ?"); params.add(scope.tenantId + "%"); }
        else { conj.add(g.tenantColumn + " = ?"); params.add(scope.tenantId); }
    }
    if (scope.citizenUuid != null && g.citizenColumn != null) { conj.add(g.citizenColumn + " = ?"); params.add(scope.citizenUuid); }
    if (scope.boundaryPrefix != null && g.boundaryColumn != null) {
        conj.add(g.boundaryColumn + " LIKE ?");
        params.add(scope.boundaryPrefix.replace("\\","\\\\").replace("%","\\%").replace("_","\\_") + "%");
    }
}
```
- **Tenant scope (L242–245): done.** State-level `LIKE prefix%`, city-level `=`. Part C only adds the explicit `ESCAPE '\'` (see below); semantics unchanged.
- **Citizen self-scope (L246): done but UNSAFE on daily.** `account_id = ?` guarded by `g.citizenColumn != null` — and daily's `citizenColumn` is `null` (`AnalyticsCatalog.java:108`), so on `grain:"daily"` the guard makes the predicate silently disappear (the blocker). Part C **changes this branch** (C.3a).
- **Boundary scope (L247–249): SQL is built but never fires.** `scope.boundaryPrefix` is hardcoded `null` (`AnalyticsScope.java:47`: `return new AnalyticsScope(tenantId, stateLevel, citizenUuid, null);`). The inline escape (`\`→`\\`, `%`→`\%`, `_`→`\_`, then append `%`) is the anchored-prefix escape requirements §4 wants, but it relies on Postgres's *default* `LIKE` escape being backslash. Design §5 specifies `LIKE :prefix || '%' ESCAPE '\'`. **Gap: Part C adds the explicit `ESCAPE '\'`** on every `LIKE` it emits (tenant state-level and boundary).

**The `Grain` model already carries `tenantColumn`, `boundaryColumn`, `citizenColumn`** at `AnalyticsCatalog.java:34–36` (`defaultTimeRole` is L37 — v1 mis-cited this block as L34–37 for the three scope columns; the scope columns are **L34–36**). Wired in the constructor tail of each grain:
- facts: `"tenant_id","boundary_path","account_id"` (`AnalyticsCatalog.java:78`)
- events: `"tenant_id","boundary_path","account_id"` (`AnalyticsCatalog.java:96`)
- daily: `"tenant_id","boundary_path",null` (`AnalyticsCatalog.java:108`) ← the `null` citizen column

**What is missing (the Part C deltas):**
- **No `departmentColumn` on `Grain`** — there is no department scope column at all. `department_code` exists only as a *queryable dimension* on facts (`AnalyticsCatalog.java:59` groupable, L66 filterable), not as a *scope* binding.
- **No `AttrScope` type, no `attrScopes` field.** `AnalyticsScope` is the fixed 4-field final class (L20–29) with a single private constructor and a static `resolve()` that always passes `null` for boundary (L47).
- **The events MV has no `department_code` column.** Facts computes it via the `mdms` CTE (`…create_v2_grain_mvs.sql:141–151`, `data->>'department' AS department_code` at L147) and folds it into the facts select at L169 (`m.department_code`), joining at L227. The events MV (L12–97) joins `svc`, `bnd`, `bs`, `asg`, `eg_user` (its join block is L92–97) but never the ServiceDefs MDMS rows, so `department_code` is absent from its projection (L52–91). Events `groupable`/`filterable` sets (`AnalyticsCatalog.java:84–92`) correctly do **not** list `department_code`.
- **The daily table has neither `department_code` nor `account_id`** (`…create_v2_grain_mvs.sql:239–253`). This is *two* gaps: department-unscopable (Q3) **and** citizen-unscopable (the blocker). C.5 adds both columns.
- **Two consumers of the scope shape will break on the field rename and must be updated by Part C:**
  - `AnalyticsService.scopeInfo()` (`AnalyticsService.java:109–116`) reads `s.boundaryPrefix` at L114.
  - `AnalyticsService.scopeCols()` (`AnalyticsService.java:96–102`) emits `boundary:`/`citizen:` scope columns for `/_schema`; this grows a `department:` entry once events is department-capable.

---

## Design (data model, API/SQL/MDMS, control flow)

### C.1 Data model — `AttrScope` and the generalized `AnalyticsScope`

New small value type in the same package. `MatchType` is a closed enum — **the client never names a match type or a column**; both are server-chosen by Part B and bound to the grain by Part C.

```java
// new file: analytics/AttrScope.java
public final class AttrScope {
    public enum MatchType { PREFIX, IN, EQ }   // closed set; PREFIX→boundary, IN→department, EQ reserved
    public final String logicalAttr;           // "jurisdiction" | "department" — NOT a SQL column
    public final MatchType match;
    public final List<String> values;          // OR within one attribute (multi-ward / multi-dept)
    public AttrScope(String logicalAttr, MatchType match, List<String> values){
        this.logicalAttr = logicalAttr; this.match = match;
        this.values = values == null ? java.util.Collections.emptyList()
                                     : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(values));
    }
    public static AttrScope denyAll(){   // C.4
        return new AttrScope("jurisdiction", MatchType.PREFIX, java.util.Collections.emptyList());
    }
}
```

`logicalAttr` is deliberately a *logical* name, not a column — the per-grain physical column is resolved by Part C through the `Grain` binding (C.3). This is the requirements §4 "Never raw column names from the client" rule made structural.

Generalized `AnalyticsScope` (keep `tenantId`/`tenantStateLevel`/`citizenUuid`; replace the single `boundaryPrefix` with the list):

```java
public final class AnalyticsScope {
    public final String tenantId;
    public final boolean tenantStateLevel;
    public final String citizenUuid;            // unchanged: citizen self-scope (still NOT an AttrScope)
    public final List<AttrScope> attrScopes;    // NEW: 0..N ANDed attribute restrictions (empty = admin/tenant-only)

    private AnalyticsScope(String tenantId, boolean stateLevel, String citizenUuid, List<AttrScope> attrScopes){
        this.tenantId = tenantId; this.tenantStateLevel = stateLevel; this.citizenUuid = citizenUuid;
        this.attrScopes = attrScopes == null ? java.util.Collections.emptyList()
                                             : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(attrScopes));
    }
    // ...
}
```

`resolve()` signature gains the resolved principal attributes from Part B (it must, since Part C cannot itself read HRMS). The exact param type is Part B's `PrincipalAttributes`; Part C's contract is "give me `boundaryPrefixes[]`, `departmentCodes[]`, and `isAdmin()`, already normalized". **`stateLevel` is still computed Part-C-side from `tenantId`/`stateLevelLen` (`AnalyticsScope.java:32` logic), so cross-tenant state-vs-city choice never depends on Part B carrying it** (README #7 is Part B's to also expose, but Part C does not regress if B omits it):

```java
// AnalyticsScope.resolve — generalized (Part B supplies `attrs`; Part C builds attrScopes)
public static AnalyticsScope resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen,
                                     PrincipalAttributes attrs){
    boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;  // unchanged from L32
    User u = requestInfo == null ? null : requestInfo.getUserInfo();

    boolean isCitizen = u != null && "CITIZEN".equalsIgnoreCase(u.getType());
    boolean hasEmployeeRole = false;
    if (u != null && u.getRoles() != null)
        for (Role r : u.getRoles()) {
            String c = r.getCode() == null ? "" : r.getCode().toUpperCase();
            if (!c.equals("CITIZEN")) hasEmployeeRole = true;
        }

    // Pure citizen → self-scope, NO attribute scopes (semantics of AnalyticsScope.java:44 preserved).
    if (isCitizen && !hasEmployeeRole)
        return new AnalyticsScope(tenantId, stateLevel, u.getUuid(), java.util.Collections.emptyList());

    // Admin/SUPERADMIN → empty attrScopes (tenant-only ceiling), as today (requirements §4 "Admin bypass").
    if (attrs == null || attrs.isAdmin())
        return new AnalyticsScope(tenantId, stateLevel, null, java.util.Collections.emptyList());

    // Scoped employee → one AttrScope per non-empty attribute, ANDed.
    List<AttrScope> scopes = new ArrayList<>();
    if (attrs.boundaryPrefixes() != null && !attrs.boundaryPrefixes().isEmpty())
        scopes.add(new AttrScope("jurisdiction", AttrScope.MatchType.PREFIX, attrs.boundaryPrefixes()));
    if (attrs.departmentCodes() != null && !attrs.departmentCodes().isEmpty())
        scopes.add(new AttrScope("department", AttrScope.MatchType.IN, attrs.departmentCodes()));

    // FAIL-CLOSED: a non-admin employee who resolved to NO usable attribute must NOT fall through
    // to tenant-only. An unresolved/empty-HRMS employee gets an impossible scope, not the whole tenant.
    if (scopes.isEmpty())
        scopes.add(AttrScope.denyAll());     // see C.4
    return new AnalyticsScope(tenantId, stateLevel, null, scopes);
}
```

The fail-closed branch is the single most important behavioural change versus today. Today an employee with no boundary always got tenant-wide rows (boundary was `null`, only tenant scope applied). Under Part C, a *non-admin* employee whom Part B could not resolve any attribute for gets **deny-all**, per requirements §6 "a missing HRMS row → empty scope, not open." Admin-ness is an explicit positive signal from Part B (`attrs.isAdmin()`), never the *absence* of attributes.

#### C.1a The default is DENY-ALL — fail-closed is the *unconditional* fallthrough, not a special case

**Invariant (the one this part exists to guarantee): the default branch of scope resolution is deny-all. An authenticated principal receives non-empty rows ONLY by matching one of three explicit positive grants; anything else — including any unforeseen future principal shape — falls through to an empty/deny result, never to tenant-wide.** The decision is made in exactly one place — `AnalyticsScope.resolve()` (C.1), the same method that today is `AnalyticsScope.java:31–47` — and `applyScope()` (`AnalyticsPlanner.java:241–251`, generalized in C.3) only ever *narrows* what `resolve()` decided; it can never re-widen a denied principal to tenant scope.

`resolve()` classifies every authenticated principal into exactly one of four arms, and only the first three return rows:

1. **Admin / SUPERADMIN → explicit tenant-wide grant.** Selected by Part B's *positive* `attrs.isAdmin()` signal (C.1, line ~138), never inferred from the absence of attributes. `attrScopes` is empty → tenant scope only.
2. **Pure citizen → self-scope.** `type == CITIZEN` with no employee role (C.1, lines ~134–135) → `account_id = self`, no attribute scopes.
3. **Employee with ≥1 resolved attribute scope → attribute-restricted.** At least one of `boundaryPrefixes[]` / `departmentCodes[]` is non-empty (C.1, lines ~142–146) → one ANDed `AttrScope` per resolved attribute.
4. **EVERYTHING ELSE → DENY-ALL (the default arm).** A non-admin, non-pure-citizen principal who resolved to **zero** usable attribute scopes — including the unresolved/failed HRMS lookup, the drifted `complaint.assignee`↔`eg_hrms_employee.uuid` row, the misprovisioned officer, *and any principal shape this enumeration did not anticipate* — falls into `scopes.add(AttrScope.denyAll())` (C.1, lines ~150–151; C.4), which emits an always-false predicate (`FALSE`, equivalently `1=0`) on the always-present `boundary_path` column on every grain. **The result is empty rows, not tenant-wide rows, and not an unscoped fallthrough.**

The critical contrast with today: in `AnalyticsScope.java:31–47` arm 4 does not exist — a non-citizen with no resolved attributes simply returns `new AnalyticsScope(tenantId, stateLevel, null, null)` (L47, boundary always `null`), and `applyScope()` then emits **only the tenant predicate** (`AnalyticsPlanner.java:242–245`), i.e. every row in the tenant. That is the **fail-OPEN** default this part replaces. Part C makes arm 4 the *explicit, unconditional* fallthrough so that omitting a branch can never silently grant tenant scope.

**An unresolved or failed attribute lookup also lands in arm 4 (fail-closed), never in arms 1–3.** If Part B's HRMS resolution misses, errors, or returns a principal it could not classify, Part C must treat the resulting empty attribute set exactly like a deliberately-empty one: deny-all. `resolve()` therefore keys admin strictly on the positive `isAdmin()` signal and treats *every* empty-attribute non-admin non-citizen as deny — an unresolved lookup is indistinguishable from "resolved to nothing," and both must fail closed. (Where Part B exposes a `resolutionComplete`/`scopeLevel` discriminator rather than `isAdmin()`, the same rule binds: anything other than an explicit admin grant with `resolutionComplete == true` falls to arm 4.)

### C.2 `Grain` model — add `departmentColumn`

Add one field to `AnalyticsCatalog.Grain` (`AnalyticsCatalog.java:25–48`) and one constructor arg. The boundary/citizen/tenant columns already exist at L34–36; department joins them:

```java
public final String departmentColumn;   // NEW: null = grain cannot be department-scoped
```

Grain bindings become (only the new arg shown; everything before it unchanged):
- **facts** (`AnalyticsCatalog.java:78`): `…, "account_id", "department_code", "filed_at"` — facts already has the column (migration L169).
- **events** (`AnalyticsCatalog.java:96`): `…, "account_id", "department_code", "event_at"` — **only after the C.5 migration lands.** Until then it stays `null`.
- **daily** (`AnalyticsCatalog.java:108`): after C.5, `…, "account_id", "department_code", "snapshot_date"` — **both** columns are added to the daily table by C.5, so daily becomes citizen- *and* department-scopable. (Pre-C.5 the citizen column is `null` and is the blocker; C.5 is therefore not optional, it is the blocker fix.)

`boundaryColumn` is already non-null on all three grains, so PREFIX/jurisdiction works on facts/events/daily with no migration once values are fed.

### C.3 `applyScope()` — the generalized loop with grain-aware binding + fail-closed

```java
// ---------- RBAC scope (server-injected) ----------
private void applyScope(AnalyticsScope scope, Grain g, List<String> conj, List<Object> params){
    // tenant (unchanged semantics; ESCAPE '\' added — AnalyticsPlanner.java:242-245)
    if (scope.tenantId != null) {
        if (scope.tenantStateLevel) { conj.add(g.tenantColumn + " LIKE ? ESCAPE '\\'"); params.add(esc(scope.tenantId) + "%"); }
        else { conj.add(g.tenantColumn + " = ?"); params.add(scope.tenantId); }
    }
    // citizen self-scope — now FAIL-CLOSED, not a silent no-op (C.3a, was L246)
    if (scope.citizenUuid != null) {
        if (g.citizenColumn == null)
            throw new IllegalArgumentException("grain_scope_unavailable: grain '" + g.name
                + "' cannot enforce citizen self-scope (no account column)");
        conj.add(g.citizenColumn + " = ?"); params.add(scope.citizenUuid);
    }

    // generalized attribute scopes — AND across the list, OR within each
    for (AttrScope a : scope.attrScopes) {
        String column = bindColumn(a, g);                     // logical attr -> physical column, or fail-closed
        switch (a.match) {
            case PREFIX: {
                if (a.values.isEmpty()) { conj.add("FALSE"); break; }   // OR of nothing = deny
                List<String> ors = new ArrayList<>();
                for (String v : a.values) {
                    ors.add(column + " LIKE ? ESCAPE '\\'");
                    params.add(esc(v) + "%");                 // reuse the L249 escape, now in esc()
                }
                conj.add(ors.size() == 1 ? ors.get(0) : "(" + String.join(" OR ", ors) + ")");
                break;
            }
            case IN: {
                if (a.values.isEmpty()) { conj.add("FALSE"); break; }
                List<String> ph = new ArrayList<>();
                for (String v : a.values) { params.add(v); ph.add("?"); }
                conj.add(column + " IN (" + String.join(",", ph) + ")");
                break;
            }
            case EQ: { conj.add(column + " = ?"); params.add(a.values.isEmpty() ? null : a.values.get(0)); break; }
        }
    }
}

// reused escape (was inline at AnalyticsPlanner.java:249)
private static String esc(String s){ return s.replace("\\","\\\\").replace("%","\\%").replace("_","\\_"); }

// logical attribute -> physical grain column; FAIL CLOSED if the grain can't serve it
private String bindColumn(AttrScope a, Grain g){
    String col;
    switch (a.logicalAttr) {
        case "jurisdiction": col = g.boundaryColumn; break;
        case "department":   col = g.departmentColumn; break;
        default: throw new IllegalStateException("scope_unsupported: unknown scope attribute '" + a.logicalAttr + "'");
    }
    if (col == null)
        // grain cannot serve a REQUIRED scope attribute -> reject, NEVER return unscoped (requirements §6 fail-closed)
        throw new IllegalArgumentException("grain_scope_unavailable: grain '" + g.name
            + "' cannot enforce scope attribute '" + a.logicalAttr + "'");
    return col;
}
```

#### C.3a Citizen self-scope is now a fail-closed axis (the blocker fix)

The pass-1 blocker (independently found by reviewers A and C) is that citizen self-scope **silently disappears** on any grain whose `citizenColumn` is `null` — i.e. `daily` (`AnalyticsCatalog.java:108`) — because the live guard at `AnalyticsPlanner.java:246` is `scope.citizenUuid != null && g.citizenColumn != null`. v2 **removes the `&& g.citizenColumn != null` short-circuit** and replaces it with the same `grain_scope_unavailable` throw used for attribute scopes. Net effect: a citizen who somehow reaches `grain:"daily"` either (a) binds against `account_id` once C.5 adds the column to the daily table, or (b) — in the window before C.5 deploys, or on any future grain that lacks the column — **fails closed with `grain_scope_unavailable`**, never returns tenant-wide rows. This makes citizen scope obey the *same* invariant as `department`: a scope axis that the grain cannot serve is rejected, never dropped. The primary remediation is structural (C.5 adds `account_id` to daily so the citizen predicate binds); the throw is the belt-and-suspenders that guarantees no silent leak even if the catalog and migration ever drift.

Key properties, each grounded:
- **`bindColumn` (attributes) and the citizen throw (C.3a) are the leak-stoppers.** If a department-restricted caller's query lands on a grain whose `departmentColumn == null` (events pre-migration), or a citizen lands on a grain whose `citizenColumn == null`, it throws `grain_scope_unavailable` rather than silently dropping the predicate. This is requirements §6 / §7.4 made code. The throw surfaces as a per-query error via the batch handler (`AnalyticsService.runOne` is wrapped in `try/catch` at `AnalyticsService.java:45–46`, mapping to `err(ex)` → `{error,message}`, `partial:true`), so one unscopable tile fails closed without leaking and without failing the whole batch.
- **OR-within / AND-across** matches requirements §4 exactly: each `AttrScope` becomes one ANDed `conj` entry; multiple values inside become an OR group (PREFIX) or an `IN` list. The whole-batch `String.join(" AND ", conj)` at `AnalyticsPlanner.java:103` does the AND-across.
- **`ESCAPE '\'` added** to both the tenant state-level `LIKE` (L243) and the boundary `LIKE` (L249), closing the design-§5 gap.
- **Empty value list → `FALSE`**, never an omitted predicate. An attribute that resolved to zero values is a deny, not an open door.

### C.4 `AttrScope.denyAll()` — the impossible predicate

```java
public static AttrScope denyAll(){
    // jurisdiction PREFIX with no values -> applyScope emits FALSE on a column that always exists (boundary_path)
    return new AttrScope("jurisdiction", MatchType.PREFIX, java.util.Collections.emptyList());
}
```
Because `boundaryColumn` is non-null on all three grains (`AnalyticsCatalog.java:78/96/108`), `denyAll` binds cleanly everywhere and emits `FALSE` — a non-admin employee Part B couldn't resolve sees nothing, on every grain, rather than erroring (which would look like an outage) or leaking (tenant-wide). (Defined inline in `AttrScope` in C.1.)

### C.5 Migration — close BOTH the events `department_code` leak AND the daily citizen/department gaps

This migration is the structural half of the blocker fix (C.3a) **and** the department fix. It does three things in dependency order, in **one** migration so the catalog never advertises a column the storage lacks:

1. **Add `department_code` + `account_id` to the daily table** (it has neither today, `…create_v2_grain_mvs.sql:239–253`). Adding `account_id` is what makes citizen self-scope bind on daily (the blocker); adding `department_code` makes daily department-scopable (Q3 → option a). Both are populated by the snapshot `INSERT … SELECT FROM complaint_facts` (described at migration L255), which already selects from `complaint_facts` where both columns exist.
2. **Recreate the events MV with `department_code`**, sourced the same way facts does (the `mdms` CTE L141–151, joined on `service_code`). The events MV already has `svc.servicecode AS service_code` in scope (L79), so `LEFT JOIN mdms m ON m.service_code = svc.servicecode` works.
3. **Recreate `complaint_facts` in dependency order**, because `DROP MATERIALIZED VIEW complaint_events CASCADE` (L11 pattern) also drops `complaint_facts` (it reads `FROM complaint_events`, L132) and every facts index (L231–236). The migration recreates **both** MVs and **all** indexes within the single migration — it does **not** rely on the refresh scheduler to backfill facts (see the resolved Q1 below).

```sql
-- new migration: V20260624000000__events_department_code_and_scope_columns.sql

-- (1) daily: add the two scope columns that were missing (citizen + department).
ALTER TABLE complaint_open_state_daily ADD COLUMN IF NOT EXISTS account_id     varchar(128);
ALTER TABLE complaint_open_state_daily ADD COLUMN IF NOT EXISTS department_code varchar(256);
CREATE INDEX IF NOT EXISTS ix_cosd_account ON complaint_open_state_daily(account_id);
CREATE INDEX IF NOT EXISTS ix_cosd_dept    ON complaint_open_state_daily(department_code);
-- the daily snapshot INSERT (migration L255) must add account_id, department_code to its column list +
-- SELECT list (both already exist on complaint_facts: account_id L158, department_code L169).

-- (2)+(3) events gains department_code; facts is recreated after it (CASCADE blast radius).
DROP MATERIALIZED VIEW IF EXISTS complaint_events CASCADE;   -- also drops complaint_facts + its indexes
CREATE MATERIALIZED VIEW complaint_events AS
WITH svc AS ( ... ),            -- unchanged (L13-20)
     bnd AS ( ... ),            -- unchanged (L21-26)
     bs  AS ( ... ),            -- unchanged (L27-30)
     asg AS ( ... ),            -- unchanged (L31-35)
     tx  AS ( ... ),            -- unchanged (L36-51)
     mdms AS (                  -- NEW: identical dedupe-by-serviceCode-prefer-root-tenant as facts (L141-151)
       SELECT DISTINCT ON (data->>'serviceCode')
              data->>'serviceCode' AS service_code,
              data->>'department'  AS department_code
       FROM eg_mdms_data
       WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs' AND isactive
       ORDER BY data->>'serviceCode', length(tenantid)
     )
SELECT
  ...,                          -- unchanged projection (L53-91)
  m.department_code,            -- NEW
  ...
FROM tx
LEFT JOIN svc ON svc.servicerequestid = tx.service_request_id   -- unchanged (L93)
LEFT JOIN bnd ON bnd.code = svc.locality_code                   -- unchanged (L94)
LEFT JOIN bs  ON ...                                            -- unchanged (L95)
LEFT JOIN asg ON ...                                            -- unchanged (L96)
LEFT JOIN eg_user ua ON ...                                     -- unchanged (L97)
LEFT JOIN mdms m ON m.service_code = svc.servicecode;           -- NEW

-- recreate events indexes (CASCADE drop took them), L99-103 verbatim,
-- + add ix_ce_dept ON complaint_events(department_code).

-- recreate complaint_facts: re-apply the ORIGINAL facts DDL verbatim from the shared fragment
-- (see Q1 resolution) + all six facts indexes (L231-236). Facts already projects department_code (L169)
-- and account_id (L158); no facts change is needed beyond re-creation.
```

To avoid duplicating ~120 lines of facts DDL and the drift risk that creates, the facts `CREATE MATERIALIZED VIEW … ` body is extracted to a single shared SQL fragment (`_facts_mv.sql`) that **both** the original `V20260608000000` and this migration `\i`/include, so there is exactly one definition of facts. (Flyway runs raw SQL; the include is done at build time by concatenating the fragment into the migration resource, since Flyway has no `\i`.) This is the resolution of the v1 Q1 hand-wave — facts is recreated *inside* the migration, in dependency order, from one source.

Only **after** this migration is deployed does C.2 flip events' and daily's `departmentColumn`/`citizenColumn` in the catalog and `AnalyticsService.scopeCols()` start advertising the new scope columns. The catalog change and the migration ship together (same PR) so the catalog never claims a column the storage lacks.

#### C.5a Coverage hazard — `department_code IS NULL` rows are invisible to department-scoped users (NOT just a code-space issue)

Even with perfectly reconciled code spaces, `department_code` is sourced from a `LEFT JOIN mdms` on both grains (facts `…create_v2_grain_mvs.sql:227`; the new events join above). Any complaint whose `service_code` has **no active `RAINMAKER-PGR.ServiceDefs` row** (CTE filter L149) gets `department_code = NULL`, and `NULL IN ('SANI')` is never true. So such complaints are **invisible to every department-scoped user** (fail-closed → acceptable on the security axis) but **visible only to admins** (a correctness/coverage hazard distinct from the code-space mismatch). This is called out explicitly so it is not mistaken for the §7.3 mismatch:
- It is **fail-closed, not a leak** — so it does not block shipping department scope.
- The *fix* (ensuring every live `service_code` has a ServiceDef, or back-filling `department_code`) is **data/ownership outside Part C** — flagged to Part B's code-space consistency check (extend it to also assert "every distinct `service_code` in `eg_pgr_service_v2` has a ServiceDefs row") and to operations.
- Part C's validation matrix adds a test that asserts a complaint with an unmatched `service_code` returns **zero** rows for a department-scoped caller (proving fail-closed) and is visible to admin.

### C.6 Consumer updates (`AnalyticsService`)

- `scopeInfo()` (`AnalyticsService.java:114`): replace `if (s.boundaryPrefix != null) m.put("boundaryPrefix", s.boundaryPrefix);` with a loop summarizing `s.attrScopes` as value **counts**, not raw values (e.g. `m.put("attrScopes", [{attr:"jurisdiction",match:"PREFIX",valueCount:2}, …])`) — to avoid echoing jurisdiction internals back to the client. Since `boundaryPrefix` is always `null` today (`AnalyticsScope.java:47`), the removed line never fired, so no live FE depends on `scope.boundaryPrefix` — the contract change is safe (confirm no dashboard bundle greps `scope.boundaryPrefix`).
- `scopeCols()` (`AnalyticsService.java:96–102`): add `if (g.departmentColumn != null) l.add("department:" + g.departmentColumn);` so `/_schema` honestly reports which grains are department-scopable. (Citizen column is already reported at L100.)
- `AnalyticsService.query()` (L32) call to `AnalyticsScope.resolve(...)` gains the Part B `PrincipalAttributes` argument (resolved just above it from the trusted principal).

---

## Interfaces with other parts (inputs consumed, outputs produced)

**Inputs Part C consumes:**
- **From Part A (Trust foundation):** a `RequestInfo.userInfo` whose `uuid`/`type`/`roles` are token-derived and non-spoofable, **and a non-null principal** (Part A maps introspection `null`/5xx → `401`, per README cross-cutting #2 "identity is fail-open"). Part C reads `getType()`/`getRoles()`/`getUuid()` exactly as the live `resolve()` does (`AnalyticsScope.java:34–44`) but the *trustworthiness and non-null-ness* of those fields is Part A's contract. **Without A, every predicate Part C emits scopes a forged identity** (requirements §8 "A blocks all of B–F").
- **From Part B (Identity → attribute resolution):** the `PrincipalAttributes` contract — `boundaryPrefixes()` (delimiter-anchored materialized-path prefixes like `…WARD_3|`, already in the complaint code-space and **already `|`-terminated** — anchoring is B's path construction, not C's), `departmentCodes()` (HRMS dept codes **already reconciled to the MDMS-ServiceDefs code-space** *and* with the C.5a "every live service_code has a ServiceDef" coverage assertion added to B's consistency check), and `isAdmin()` (the positive admin signal that selects tenant-only). Part C assumes these are clean; it does no HRMS reads and no code-space translation. **`tenantStateLevel` is computed Part-C-side** (`AnalyticsScope.java:32`) and does not depend on B (README #7).

**Outputs Part C produces:**
- **The generalized `AnalyticsScope` shape** (`attrScopes`) consumed by `AnalyticsService.scopeInfo()`/`scopeCols()` and re-checked against — but **not** widened by — Part D's `visibleTo` and Part F's inline gate. Part C's contract to D/E/F: row scope is independent; an empty scope is a real empty result, never a signal to relax catalog/grammar gates (requirements §3).
- **`AttrScope.MatchType` + the `Grain.departmentColumn` binding** — the extension point for any future `EQ`/`IN`/`PREFIX` attribute (requirements §4 "open to further attributes with no grammar change"). A new attribute = a new `logicalAttr` case in `bindColumn` + a `Grain` column, nothing in the grammar.
- **The `grain_scope_unavailable` error-code string** — the stable, fail-closed signal that Parts D/E **must match as a string** and treat as non-retryable, never widen-on-empty. It is emitted for both attribute scopes (`bindColumn`) and citizen self-scope (C.3a). It surfaces via `AnalyticsService.java:45–46` → `err(ex)` → `{error:"grain_scope_unavailable", message:…}` (the `code:message` split is at `AnalyticsService.java:118–124`). A mis-targeted tile fails closed per-tile (`partial:true`), never leaks.

**Explicitly orthogonal to Part C:**
- Part F's `inline_forbidden` gates the *grammar*; even an admin who may send inline queries still gets `attrScopes` empty (tenant-only) — Layer 1 and Layer 3 are independent (requirements §3).
- The **batch-arm bypass** (README #5) is a D/F gate-wiring concern; Part C's scope injection runs inside `runOne()`→`plan()` for **both** arms (`AnalyticsService.java:45` and L51), so Part C is immune to it. Part C flags it so D/F wire the *catalog/inline* gate on both arms too.
- **Cache-key** is owned by the caching part (no Redis layer exists in `AnalyticsService` today). Part C's only obligation is to expose a stable canonical serialization of `attrScopes` (attr, match, sorted values) **plus** `citizenUuid` and `tenantStateLevel` for keying, so a multi-dept vs single-dept (or citizen vs admin) caller never collide (requirements §6).

---

## Sequencing & migration steps

Part C is plan Phases 2–3; **both gate on A (trust) and B (`PrincipalAttributes`) being mergeable**. Ship as two one-concern PRs against egov/CCRS develop, each validated on ovh-cloud-dev (bomet repro) with the emitted `WHERE` asserted in tests (plan §5):

1. **PR-C1 (Phase 2 — jurisdiction wiring + citizen-scope fail-closed, no MV migration).**
   - Add `AttrScope` + generalize `AnalyticsScope` (C.1) and `applyScope()` (C.3) including `esc()` extraction, `ESCAPE '\'`, `bindColumn`, **and the C.3a citizen fail-closed change** (remove the `&& g.citizenColumn != null` short-circuit at L246, throw `grain_scope_unavailable`).
   - Update the two `AnalyticsService` consumers (C.6) and the `resolve()` call site.
   - Feed only the **jurisdiction** `AttrScope` (department resolution can return empty until PR-C2). `Grain.departmentColumn` is added as a field but set `null` everywhere except facts.
   - **Note:** until PR-C2's migration adds `account_id` to daily, a citizen `grain:"daily"` query **fails closed with `grain_scope_unavailable`** (no longer leaks). This is the immediate blocker mitigation; PR-C2 then makes it bind to `account_id` and return the citizen's own rows.
   - **Exit:** a GRO with jurisdiction `WARD_3` sees only `boundary_path LIKE 'WARD_3|%' ESCAPE '\'`-matching rows on facts/events/daily; sibling `WARD_30` does not leak; **a pure citizen issuing `grain:"daily"` gets `grain_scope_unavailable`, NOT tenant-wide rows** (regression test for the blocker).

2. **PR-C2 (Phase 3 — department + daily scope columns, with the MV migration).**
   - Add migration `V20260624000000__…` (C.5): daily gains `account_id` + `department_code`; events MV gains `department_code`; facts recreated from the shared fragment with all indexes (+ `ix_ce_dept`).
   - Flip events' `departmentColumn` **and** daily's `citizenColumn`/`departmentColumn` in the catalog (C.2) **in the same PR** as the migration.
   - Feed the **department** `AttrScope` from `attrs.departmentCodes()`.
   - **Exit:** a Sanitation supervisor sees `department_code IN ('SANI')` on facts *and* events; a multi-dept user sees the union; a citizen `grain:"daily"` now returns **only their own** rows (`account_id = self`); a complaint whose `service_code` has no ServiceDef is invisible to the dept-scoped caller and visible to admin (C.5a fail-closed test).

3. **Validation matrix (both PRs)** — assert the *generated SQL string*, not just the Java, for: pure citizen on facts/events **and on daily** (the blocker regression — pre-C2 → `grain_scope_unavailable`, post-C2 → `account_id = self`); single-dept single-ward GRO; multi-dept; multi-ward; admin (empty `attrScopes` → tenant-only); **unresolved employee → `denyAll`/`FALSE`**; department-restricted-on-events-pre-migration → `grain_scope_unavailable`; **department-scoped caller + `service_code` with no ServiceDef → zero rows** (C.5a). Use clean single-role `RBAC_TEST_*` users, never real GRO accounts (HRMS role pollution — every GRO also holds `PGR_LME`, requirements §7.2).

---

## Risks, edge cases, failure modes

- **Citizen×daily leak (the convergent blocker — now fixed two ways).** Root cause: `AnalyticsPlanner.java:246` guards citizen scope with `g.citizenColumn != null`, daily's is `null` (`AnalyticsCatalog.java:108`), so `grain:"daily"` from a citizen drops the predicate → tenant-wide backlog. Fix: (1) C.3a removes the short-circuit and throws `grain_scope_unavailable` on any grain lacking the column; (2) C.5 adds `account_id` to the daily table so the predicate binds. PR-C1 ships (1) immediately (fail-closed); PR-C2 ships (2) (correct rows). The negative test `citizen + grain:"daily"` is mandatory in both PRs.
- **Fail-closed on unresolved employee.** Today's code defaults a no-boundary employee to **tenant-wide** (boundary `null`, only tenant scope). The drift hazard is real on bomet/naipepea: `complaint.assignee == eg_hrms_employee.uuid` drifts and HRMS rows can be missing. Part C's `resolve()` treats *non-admin employee + no resolved attribute* as `denyAll`. The discriminator is Part B's explicit `isAdmin()` — **never infer admin from empty attributes**, or a drifted HRMS row silently promotes a supervisor to tenant-wide visibility.
- **The events `department_code` silent leak (requirements §7.4).** If department scope shipped on facts before the events MV carried the column, an events query from a dept-restricted caller would either silently drop the predicate (leak) or error. `bindColumn` enforces the error while `departmentColumn` is `null`; PR-C2 ties the catalog flip to the migration so neither a leak nor a spurious error survives into a released build.
- **`department_code IS NULL` coverage hazard (C.5a).** Distinct from the code-space mismatch: complaints whose `service_code` lacks a ServiceDef row get `department_code = NULL` (LEFT JOIN, `…create_v2_grain_mvs.sql:227` and the new events join), invisible to every dept-scoped user. Fail-closed (acceptable) but a coverage gap; the data fix is Part B's consistency check + operations, not Part C. Tested explicitly.
- **Grain-inference bypass.** `AnalyticsPlanner.inferGrain()` (L267–275) returns only `events` or `facts` (never `daily`), and can route a measure-driven query to `events` automatically. A department-restricted caller thus auto-routed to events pre-migration correctly throws `grain_scope_unavailable`; post-migration it scopes correctly. The inference path cannot escape `applyScope` (it runs unconditionally at L98). The daily-via-inference path is impossible (daily requires an explicit `grain`), so the blocker can only be reached by an explicit `grain:"daily"` — still covered by C.3a. Tested.
- **Sibling-prefix leak (`WARD_3` vs `WARD_30`).** Mitigated by Part B anchoring prefixes on the delimiter (`…WARD_3|`) *and* Part C's `esc()` + `ESCAPE '\'`. If Part B ever hands an un-anchored prefix, `WARD_3%` would match `WARD_30…`. Part C documents the `|`-anchoring as a precondition of the contract and a test asserts a `|`-terminated bound value; Part C does not itself add the delimiter (B's path construction).
- **Department code-space mismatch (requirements §7.3).** If HRMS dept codes ≠ MDMS ServiceDefs `data->>'department'` codes (`…create_v2_grain_mvs.sql:147`), `department_code IN (…)` matches nothing → a Sanitation supervisor sees **zero** rows (fails closed, not open — acceptable but a silent functional outage). Part C depends on Part B's one-time consistency check; Part C's tests assert against codes known to exist in both spaces. (Note this is *separate* from the C.5a NULL-row hazard.)
- **Tenant isolation under state-level scope.** Tenant `LIKE prefix%` (now `ESCAPE '\'`) at L243 plus a boundary prefix could in principle let one tenant's `boundary_path` collide with another's if boundary materialized paths are not tenant-prefixed. Tenant scope is ANDed independently, so cross-tenant rows are excluded by the tenant predicate regardless; boundary scope only ever *narrows further* within the already-tenant-bounded set. Documented invariant: scope predicates only AND (narrow), never OR (widen) across the citizen/tenant/attribute axes.
- **Cache-key correctness (NFR, requirements §6).** Resolved scope is part of the result cache key. Generalizing to `attrScopes` means the cache key must serialize the full ordered attribute list (attr, match, sorted values) **plus** `citizenUuid` and `tenantStateLevel` — otherwise a citizen and an admin, or a multi-dept and single-dept caller, could collide. There is no cache layer in `AnalyticsService` today; this is a forward dependency on the caching part, which must consume Part C's canonical-string contract.
- **`CASCADE` drop blast radius (migration).** `DROP MATERIALIZED VIEW complaint_events CASCADE` drops `complaint_facts` (it reads from events, `…create_v2_grain_mvs.sql:132`) and all facts indexes (L231–236). The C.5 migration recreates both MVs and all indexes **within the single migration, in dependency order**, from a shared facts fragment — it does **not** rely on the refresh scheduler (resolving v1 Q1). If facts were left absent until the first refresh, `asOf()` (`AnalyticsService.java:105`, `SELECT max(facts_built_at) FROM complaint_facts`) would throw → be caught at L106 → fall back to `System.currentTimeMillis()`, *masking* the outage; the in-migration recreate removes that window.

---

## Open questions for review

1. **`denyAll` vs `403` for unresolved employees.** Part C proposes `denyAll` (`FALSE` predicate → empty rows, HTTP 200) for a non-admin employee with no resolved attribute, so the UI shows "no data" rather than an error. Is a `403`/explicit "no jurisdiction assigned" preferable operationally (so an HRMS-misprovisioned officer is *told*, not silently shown empty)? Empty-result is the requirements §6 letter ("empty or denied"); the choice is UX/observability. (Note: this is distinct from the citizen×daily case, which is a hard `grain_scope_unavailable` pre-C2 and correct rows post-C2.)
2. **`scopeInfo` disclosure.** Should the response `scope` block echo attribute *value counts* only (proposed), full values, or nothing? Counts aid FE debugging but leak "you are scoped to 2 wards / 1 dept." Leaning counts-only; confirm against any product requirement to show operators their own scope. The boundary between Part B's resolved attribute *values* and Part C's response *shaping* is where jurisdiction internals could leak — Part C commits to counts-only and never lands raw `boundaryPrefixes[]` into the response.
3. **`EQ` match type.** `AttrScope.MatchType.EQ` is reserved but unused in v1/v2 (jurisdiction=PREFIX, department=IN). Keep for forward-compat (one switch case) or drop until needed (YAGNI)? Leaning keep — it signals the extension model cheaply.
4. **Shared facts-DDL fragment mechanics.** C.5 extracts the facts `CREATE MATERIALIZED VIEW` body to one fragment included by both `V20260608000000` and the new migration. Flyway has no `\i`; the include is a build-time concatenation into the migration resource. Confirm the build packaging step (Maven resource filtering vs a pre-build script) the team prefers, so the single-source guarantee is enforced at build time and not by copy-paste discipline.

---

## v2 revision log (pass-1 findings → resolution)

- **blocker — citizen self-scope silently no-ops on the `daily` grain → tenant-wide leak for citizens (convergent, also in README #1).** RESOLVED in Part C. Root cause confirmed at `AnalyticsPlanner.java:246` (guard `&& g.citizenColumn != null`) + `AnalyticsCatalog.java:108` (daily `citizenColumn = null`). v2 stops preserving the branch "verbatim": (1) **C.3a** removes the `&& g.citizenColumn != null` short-circuit and throws `grain_scope_unavailable` for any grain that cannot serve citizen scope — citizen scope now obeys the same fail-closed invariant as `department`; (2) **C.5** adds `account_id` to `complaint_open_state_daily` (which lacked it, `…create_v2_grain_mvs.sql:239–253`) so the predicate binds on daily. PR-C1 ships the fail-closed throw (immediate leak stop); PR-C2 ships the column (correct rows). Mandatory negative test `citizen + grain:"daily"` added to the validation matrix in both PRs.
- **major — PR-C1 Exit asserted a "declared `boundaryScope` param ANDs to empty" mechanism that does not exist.** RESOLVED by removing the false claim. Verified `boundary_path` is **not** in any grain's `filterable` set (facts filterable `AnalyticsCatalog.java:65–69`, events L89–92, daily L104–105), and the only client narrowing path `predicate()` requires `g.filterable.contains(colKey)` at `AnalyticsPlanner.java:174`. The v2 PR-C1 Exit no longer references a declared boundary-narrowing param; it asserts only the injected jurisdiction scope and the citizen-daily regression. Declared client-side narrowing on `boundary_path` is **not owned by Part C** and is now omitted rather than silently inherited; if it is wanted it belongs to Part D's KPI-def declared-params surface, not Part C's row spine.
- **major — `department_code IN (...)` silently drops NULL-`department_code` rows (LEFT JOIN) even on facts, distinct from the code-space mismatch.** RESOLVED by naming it as its own hazard. Added **C.5a** + a risk entry: any complaint whose `service_code` lacks an active ServiceDefs row gets `department_code = NULL` (`…create_v2_grain_mvs.sql:147` CTE, projected L169, `LEFT JOIN mdms` L227; the new events join is also LEFT), so `NULL IN (...)` makes it invisible to every dept-scoped user and visible only to admin. Classified **fail-closed (acceptable, not a leak)**; the data fix (ServiceDef coverage / back-fill) is assigned to **Part B**'s consistency check (extended to assert every live `service_code` has a ServiceDef) + operations. A dedicated zero-rows-for-dept / visible-to-admin test was added.
- **minor — the C.5 "recreate facts" hand-wave was the riskiest step and v1 Q1 left it open.** RESOLVED. Verified `complaint_facts` reads `FROM complaint_events` (`…create_v2_grain_mvs.sql:132`), so `DROP … CASCADE` drops facts + indexes L231–236, and `asOf()` at `AnalyticsService.java:105` would mask the gap via its L106 fallback. v2 C.5 recreates **both** MVs and all indexes **inside the single migration in dependency order**, sourcing facts from a single shared `_facts_mv.sql` fragment included by both `V20260608000000` and the new migration — it no longer relies on the refresh scheduler. The old open Q1 is closed; only the build-packaging mechanics for the shared fragment remain (new Open Q4).
- **minor — `inferGrain` department side-door analysis correct but worth confirming (never routes to `daily`).** ACKNOWLEDGED, no change needed. Re-verified `inferGrain` returns only `events`/`facts` at `AnalyticsPlanner.java:267–275`; the risk entry now states explicitly that the daily-via-inference path is impossible (daily needs explicit `grain`), so the citizen×daily blocker is reachable only via explicit `grain:"daily"` and is fully covered by C.3a.
- **nit — `scopeInfo()` rewrite drops raw `boundaryPrefix`; confirm contract safety.** RESOLVED. C.6 now states that `s.boundaryPrefix` is always `null` today (`AnalyticsScope.java:47`) so the removed line never fired and no live FE depends on `scope.boundaryPrefix`; the change is contract-safe (with a residual "confirm no dashboard bundle greps `scope.boundaryPrefix`"). v2 emits **value counts only**, never raw values.
- **mis-citation — `Grain` scope columns cited as `AnalyticsCatalog.java:34–37`.** CORRECTED throughout to **L34–36** (`tenantColumn` L34, `boundaryColumn` L35, `citizenColumn` L36); L37 is `defaultTimeRole`. All other file:line anchors were re-verified exact: the verbatim `applyScope` block at `AnalyticsPlanner.java:241–251`, facts `mdms` CTE L141–151, `m.department_code` at L169, `LEFT JOIN mdms` L227, events MV's lack of any MDMS join (join block L92–97), daily table L239–253, `predicate()` filterable gate L174.
- **interface — Part B contract leak surface (jurisdiction values in `scopeInfo`).** RESOLVED at Part C's edge: C.6/Open Q2 commit to counts-only and state Part C never lands raw `boundaryPrefixes[]` into any response path. The upstream guarantee that B never hands raw values into a response is named as **Part B's** responsibility.
- **interface — D/E reliance on `grain_scope_unavailable` should be a stable matchable code.** RESOLVED. The Outputs section now states `grain_scope_unavailable` is a **stable error-code string** D/E must match (not retry, not widen-on-empty), emitted for both attribute and citizen axes, surfaced via `AnalyticsService.java:45–46` → `err()` split L118–124 as `{error:"grain_scope_unavailable", …}`.
- **interface — cache-key must serialize full ordered `attrScopes`.** RESOLVED as a forward dependency. Risk + Outputs now require the canonical key to serialize ordered `attrScopes` (attr, match, sorted values) **plus** `citizenUuid` and `tenantStateLevel`; no cache layer exists in `AnalyticsService` today, so the caching part must consume Part C's canonical-string contract. Owner: caching part (unbuilt).
- **gap — citizen×daily must be closed in Part C, not deferred.** DONE (see blocker above) — closed in Part C via C.3a + C.5, not deferred to any other part.
- **gap — daily is both department- AND citizen-unscopable; if Q3 adds `department_code`, add `account_id` too.** DONE. C.5 adds **both** `account_id` and `department_code` to `complaint_open_state_daily` in one migration, fixing both axes; v1 Q3 is folded into C.5 (no longer an open question).
- **gap — no negative test for "citizen sends `grain:"daily"`" in the validation matrix.** DONE. The validation matrix (and both PR Exit criteria) now include the explicit `citizen + grain:"daily"` case (pre-C2 → `grain_scope_unavailable`; post-C2 → `account_id = self`) alongside the unresolved-employee → `denyAll` case.

**Cross-cutting findings from README owned elsewhere (named, not fixed here):**
- **fail-open identity / introspection `null`→`401` (README #2):** owned by **Part A**. Part C's Inputs section now states it assumes a non-null, coerced principal.
- **batch-arm bypass of the inline/kpi gate (README #5):** owned by **Part D/F**. Part C is immune (scope injects inside `runOne()`→`plan()`→`applyScope()` at L98 for both arms, `AnalyticsService.java:45` and L51) and flags it for D/F to wire their gates on both arms.
- **user-preferences spoofability (README #6):** owned by **Part E** — not in Part C's surface.
- **`tenantStateLevel` dropped in `PrincipalAttributes` (README #7):** owned by **Part B** to expose; Part C does not regress because it computes `stateLevel` itself at `AnalyticsScope.java:32`.

### v3 corrections (pass-3 codex fact-check, 2026-06-23)

- **design gap — the FAIL-CLOSED / deny-all default was not stated explicitly.** RESOLVED by adding **C.1a "The default is DENY-ALL"**. The v2 prose described fail-closed only as a per-case outcome (citizen×daily in C.3a; unresolved employee in the C.1 `resolve()` body) and never named the *default branch of scope resolution* as deny-all. The codex review correctly flagged that the live default is fail-OPEN: in `AnalyticsScope.java:31–47`, `resolve()` always returns `boundaryPrefix = null` (L47) for a non-citizen with no resolved attributes, and `applyScope()` (`AnalyticsPlanner.java:241–251`) then emits **only** the tenant predicate (L242–245) → every row in the tenant. C.1a now states the invariant explicitly: scope resolution classifies every authenticated principal into exactly four arms — (1) admin/SUPERADMIN → tenant-wide, (2) pure citizen → self-scope, (3) employee with ≥1 resolved attribute → attribute-restricted, (4) **everything else, including unresolved/failed HRMS lookups and any unforeseen principal shape → `denyAll()` → `FALSE`/`1=0`, never tenant-wide.** The default arm is the *unconditional* fallthrough (decided in `resolve()`; `applyScope()` can only narrow, never re-widen), and an unresolved/failed attribute lookup is explicitly routed to arm 4 rather than arms 1–3. Where today's fall-through lives: `AnalyticsScope.java:47` (always-`null` boundary) + `AnalyticsPlanner.java:242–246` (tenant-only predicate when no other scope is set).

## Codex review (pass 2 — gpt-5.5, verdict: needs-rework)

> External adversarial review via `codex exec`, read-only, verifying the v2 revision log against the actual code. **Note:** codex evaluated "resolved" as "patched in code"; this is a *design* doc (no code changed yet), so most `actuallyResolved:false` items mean "design specifies it, code not yet written," not "design wrong." Read the findings for genuine design errors vs. implementation-status notes.


**Summary:** The v2 design text documents several fixes, but the actual analytics code and migration remain largely pre-v2: no AttrScope, no PrincipalAttributes integration, no department scope binding, no fail-closed citizen daily handling, no new migration, and no tests found.


### Resolution check (3/13 confirmed in code)

- ❌ **blocker: citizen self-scope silently no-ops on daily, leaking tenant backlog** — Still present. AnalyticsPlanner keeps `scope.citizenUuid != null && g.citizenColumn != null`; daily still binds `citizenColumn=null`; daily table still lacks account_id. Evidence: AnalyticsPlanner.java:246, AnalyticsCatalog.java:108, V20260608000000__create_v2_grain_mvs.sql:239-253.
- ❌ **major: PR-C1 Exit asserted declared boundaryScope narrowing mechanism that does not exist** — The C doc removed the PR-C1 exit claim, but adjacent specs still require `boundaryScope`/`departmentScope` declared narrowings that C ANDs under injected scope; actual planner only supports filterable columns and boundary_path is not filterable. Evidence: 00-requirements.md:65, 40-kpi-catalog-governance.md:192, AnalyticsPlanner.java:173-175, AnalyticsCatalog.java:65-69/89-92/104-105.
- ✅ **major: department_code IN silently drops NULL-department rows distinct from code-space mismatch** — As a design hazard, this is now correctly named and classified fail-closed. Actual code confirms facts uses LEFT JOIN MDMS and projects nullable department_code; events/daily still have no department_code scope column. Evidence: V20260608000000__create_v2_grain_mvs.sql:141-151,169,227.
- ❌ **minor: C.5 recreate-facts hand-wave after DROP complaint_events CASCADE** — No actual V20260624000000 migration or shared `_facts_mv.sql` fragment exists in the migration directory; the only opened migration is still V20260608000000. Existing facts depends on complaint_events and indexes are in that original migration. Evidence: V20260608000000__create_v2_grain_mvs.sql:109-132,231-236.
- ✅ **minor: inferGrain department side-door analysis; confirm it never routes to daily** — Confirmed. inferGrain can return only `events` or `facts`; daily requires explicit grain. Evidence: AnalyticsPlanner.java:267-275.
- ❌ **nit: scopeInfo rewrite drops raw boundaryPrefix; confirm contract safety** — Actual code still emits raw `boundaryPrefix` if non-null and has no attrScopes counts-only output. Boundary is currently always null, but the claimed rewrite is not in code. Evidence: AnalyticsService.java:109-115, AnalyticsScope.java:47.
- ✅ **mis-citation: Grain scope columns cited as AnalyticsCatalog.java:34-37** — Corrected in the design text: tenant/boundary/citizen are L34-L36 and L37 is defaultTimeRole. Evidence: AnalyticsCatalog.java:34-37.
- ❌ **interface: Part B contract leak surface via jurisdiction values in scopeInfo** — No Part C edge implementation exists: AnalyticsScope has no attrScopes, AnalyticsService has no counts-only loop, and raw boundaryPrefix is still the only attribute-like response field. Evidence: AnalyticsScope.java:21-28, AnalyticsService.java:109-115.
- ❌ **interface: D/E reliance on stable grain_scope_unavailable code** — No code emits `grain_scope_unavailable`; citizen and boundary scope axes silently no-op when the grain column is null. err() could split such a string, but the planner never produces it. Evidence: AnalyticsPlanner.java:246-249, AnalyticsService.java:118-124.
- ❌ **interface: cache key must serialize full ordered attrScopes** — No attrScopes type or canonical serialization exists in actual code; there is also no cache layer here. Evidence: AnalyticsScope.java:21-28, AnalyticsService.java:30-36.
- ❌ **gap: citizen×daily must be closed in Part C, not deferred** — Not closed in actual Part C code or SQL. The same daily leak remains. Evidence: AnalyticsPlanner.java:246, AnalyticsCatalog.java:108, V20260608000000__create_v2_grain_mvs.sql:239-253.
- ❌ **gap: daily is both department- and citizen-unscopable; add account_id if adding department_code** — Daily table still has neither `account_id` nor `department_code`; daily catalog still has citizenColumn null and no departmentColumn field exists. Evidence: V20260608000000__create_v2_grain_mvs.sql:239-253, AnalyticsCatalog.java:25-46,108.
- ❌ **gap: no negative test for citizen sends grain:daily** — No analytics tests matching citizen daily, grain_scope_unavailable, denyAll, or AttrScope were found under src/test; actual code also lacks the expected behavior. Evidence: AnalyticsPlanner.java:246, AnalyticsCatalog.java:108.

### Findings

- **[BLOCKER] Citizen daily grain still leaks tenant-wide rows** — A pure citizen scope is only applied if the grain has a citizen column. The daily grain advertises no citizen column, so `applyScope` drops `account_id = ?` and only tenant scope remains. The daily storage also lacks account_id, so the structural fix is absent.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:246; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:108; CCRS/backend/pgr-services/src/main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql:239-253`
- **[BLOCKER] Non-citizen employees with no resolved attributes remain tenant-wide** — AnalyticsScope still only derives citizenUuid from body userInfo and always returns boundaryPrefix null. There is no PrincipalAttributes input, no attrScopes, no denyAll, and no fail-closed path for unresolved HRMS attributes; employees fall through to tenant-only scope.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsScope.java:31-47; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:241-251`
- **[MAJOR] Department scope engine is not implemented** — There is no AttrScope class, no Grain.departmentColumn, no bindColumn, and no department predicate injection. Facts exposes department_code as a normal groupable/filterable column, but RBAC never injects `department_code IN (...)`.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:25-46,59,66; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:241-251`
- **[MAJOR] Events and daily remain department-unscopable** — The events MV still has no MDMS CTE/join and no department_code projection. The daily table still lacks department_code. Any design path that flips events/daily department capability would not be backed by storage.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql:52-97; CCRS/backend/pgr-services/src/main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql:239-253`
- **[MAJOR] Boundary/jurisdiction scope is still wired but never populated** — AnalyticsScope hardcodes boundaryPrefix null, so the planner's boundary LIKE branch never fires. No Part B PrincipalAttributes integration exists in AnalyticsService.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsScope.java:46-47; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsService.java:30-32; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:247-249`
- **[MAJOR] LIKE predicates still omit explicit ESCAPE** — The design claims explicit `ESCAPE '\'` is added for tenant state-level LIKE and boundary LIKE. Actual SQL still emits bare `LIKE ?`; escaped parameter text relies on database default behavior.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:243,248-249`
- **[MAJOR] Part B/C interface is mismatched** — Part C design expects `attrs.isAdmin()`, `boundaryPrefixes()`, and `departmentCodes()`, but Part B's published contract is fields `{scopeLevel, boundaryPrefixes, departmentCodes, resolutionComplete}` and explicitly uses scopeLevel/resolutionComplete to distinguish admin from fail-closed employee. Actual AnalyticsService calls neither shape.  
  _evidence:_ `db-inventory/rbac-deep-design/20-attribute-resolution.md:80-87,115-117,313-321; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsService.java:30-32`
- **[MAJOR] Adjacent D/requirements still assign declared boundaryScope narrowing to Part C** — 30-row-scope-enforcement says declared boundary narrowing is not owned by Part C, but 00 and Part D still require boundaryScope/departmentScope params to be ANDed under injected scope by C. Actual planner has no such path and boundary_path is not filterable.  
  _evidence:_ `db-inventory/rbac-deep-design/00-requirements.md:65; db-inventory/rbac-deep-design/40-kpi-catalog-governance.md:192,271-272; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:173-175; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:65-69`
- **[MINOR] No claimed migration artifact exists** — The design names a new `V20260624000000__events_department_code_and_scope_columns.sql` and `_facts_mv.sql` shared fragment, but no matching migration/fragment is present under the migration resource tree. The existing V20260608000000 file remains unchanged for scope columns.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql:11-12,109-110,239-253`
- **[MINOR] No regression tests found for the claimed fixes** — No src/test analytics test covers citizen+daily, grain_scope_unavailable, denyAll, or AttrScope. The validation matrix is design text only at this point.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:246; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:108`

### Mis-citations

- 30-row-scope-enforcement.md:395 says citizen daily is RESOLVED in Part C, but actual code at AnalyticsPlanner.java:246 and AnalyticsCatalog.java:108 is unchanged.
- 30-row-scope-enforcement.md:398 says v2 C.5 recreates both MVs and indexes inside a single migration, but no such migration exists; only V20260608000000 is present and daily still lacks account_id/department_code at lines 239-253.
- 30-row-scope-enforcement.md:400 says v2 emits value counts only, but actual AnalyticsService still emits raw `boundaryPrefix` at AnalyticsService.java:114 if non-null.
- 30-row-scope-enforcement.md:403 says `grain_scope_unavailable` is emitted for attribute and citizen axes; actual planner has no such error path at AnalyticsPlanner.java:241-251.
- 30-row-scope-enforcement.md:54/238 describe escape/fail-closed changes as Part C additions, but actual planner still emits `LIKE ?` without `ESCAPE` and still short-circuits on null citizenColumn.

### Gaps

- No actual implementation of AttrScope, MatchType, attrScopes, bindColumn, denyAll, or Grain.departmentColumn.
- No actual PrincipalAttributes resolver integration at AnalyticsService.query; it still calls AnalyticsScope.resolve(requestInfo, tenantId, stateLevelLen).
- No storage migration for events.department_code, daily.account_id, or daily.department_code.
- No stable canonical scope serialization for future cache keys.
- No reconciliation between Part C's `isAdmin()` assumption and Part B's `scopeLevel/resolutionComplete` contract.
- No implemented declared boundaryScope/departmentScope narrowing path despite requirements and Part D depending on it.
