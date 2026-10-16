# RBAC + ABAC for PGR Analytics — Requirements & Stage-Setting (Part 00)

**Status:** v1, 2026-06-23 · **Scope:** the shared spec every later part (A–F) builds on.
**Reads (graded by precedence):** `dashboard-query-api-design.md` §5/§5a (the layering model), `rbac-kpi-access-implementation-plan.md` (the grounded phase plan). This document is *requirements only* — it fixes the problem, the actors, the layers, the attribute model, the ownership split, the NFRs, the hazards, and the part graph. It does **not** design the Java or the SQL; that is Parts A–F.

> **Grounding rule for this whole series:** every claim about current behaviour is anchored to a file:line that was actually read. No aspirational "the system does X" without an anchor. Where a thing is *missing*, that is stated as missing with the anchor showing the gap.

---

## 1. Problem statement — config + access control must move server-side

The PGR analytics API (`POST /v2/analytics/_query`, `POST /v2/analytics/_schema`) computes KPIs over three denormalized grains. Today two things that must be authoritative live in the wrong place:

1. **KPI definitions live client-side.** The dashboard FE *is* the catalog — query bodies are hardcoded in the bundle (`kpiQueries.js`), and the FE decides which tiles to render (design §5a, "Today vs Moves to" table). A client can read the bundle and POST any "hidden" KPI directly. **FE filtering is not access control.**

2. **Identity is spoofable, so all access control built on it is theater.** The endpoint trusts whatever `RequestInfo.userInfo` arrives in the request body and does no token validation of its own:

   - `AnalyticsController.query()` (`AnalyticsController.java:41–47`) reads the body, does `mapper.convertValue(body.get("RequestInfo"), RequestInfo.class)` at L43–44, and hands it straight to `service.query(...)` at L47. There is **no token check, no introspection, no rejection of an unsigned `userInfo`**.
   - `AnalyticsScope.resolve()` (`AnalyticsScope.java:31–48`) derives the entire RBAC posture — citizen-vs-employee — purely from `requestInfo.getUserInfo()` (L34: `requestInfo.getUserInfo()`; L36 reads `u.getType()`; L39–42 reads `u.getRoles()`). Whatever role/type the caller writes into the body is believed verbatim. A body claiming `type:"EMPLOYEE"` with no `CITIZEN`-only role set escapes self-scope (L44: `if (isCitizen && !hasEmployeeRole) citizenUuid = u.getUuid();`).

   The gateway is supposed to backfill `userInfo` from the opaque token, but its enrichment is **non-coercive and skippable**: the Kong `pre-function` (`kong.yml:49–82`) only acts on POST with a non-empty body (L56–58) and only when an `authToken` is present (L63–64) — and critically, **if the body already carries a populated `userInfo`, it returns early and does no validation** (`kong.yml:65–68`: `if ui["uuid"] or ui["id"] or ui["userName"] then return end`). So a caller who supplies their *own* `userInfo` (with no token at all, since L63's `token` guard simply `return`s) sails straight through to a service that trusts it. This is the "V2 auth gap."

   Design §5a "Hard prerequisite": *"Layer-2/3 RBAC on an unauthenticated endpoint is theater… roles/jurisdiction/accountId are presently spoofable."* The implementation plan §0 records the same: *"endpoint trusts gateway `userInfo`, Kong route unauthenticated → spoofable."*

**Therefore (the requirement):** KPI definitions move to MDMS (governed, no-deploy, design §3/§3a) and **access enforcement moves to the backend behind a trustworthy principal**. The FE becomes a thin renderer of whatever the authenticated, role-scoped backend returns (design §5a "authority moves to the backend").

---

## 2. Actors / personas

| Persona | Identity source | May SEE | May DO |
|---|---|---|---|
| **Citizen** | `type=CITIZEN`, no employee role | only their own complaints | invoke a published `kpiId` with declared params; row-locked to `account_id = self`; **no inline queries**, no officer/PII dims |
| **Ward / jurisdiction supervisor (GRO)** | employee + `GRO`; HRMS jurisdiction + dept | complaints in their boundary subtree (and dept, once dept-scoping ships) | invoke published KPIs incl. *approved* officer-leaderboard (bounded top-N); narrow within own scope; **no inline queries** |
| **Department head** | employee + dept role; HRMS dept assignment | complaints for their department(s), across the tenant boundary (or intersected with a jurisdiction if also bounded) | same as supervisor but department- rather than ward-anchored |
| **Tenant admin (`PGR_ADMIN`)** | employee + `PGR_ADMIN` | all boundaries/depts in the tenant | invoke any KPI in ceiling; **inline queries allowed**; author/publish KPI defs (governed, §3a); curate packs |
| **Analyst / SUPERADMIN (`DSS_ANALYST`, `SUPERADMIN`)** | analyst/superadmin role | tenant-wide (SUPERADMIN cross-boundary in tenant) | inline ad-hoc exploration; all of admin's powers; the only personas with raw-grammar access |

"What each may see" is two independent decisions: **which KPIs they may ask** (catalog ceiling) and **which rows come back** (row scope). They do not substitute for each other (§3).

---

## 3. The three orthogonal RBAC layers

These are three different questions answered at three different points in the request lifecycle. Conflating them is the classic failure mode (design §5a). All three are **server-enforced**; none is an FE decision.

**Layer 1 — Row scope ("which rows of the data are yours").** An injected `WHERE` predicate ANDed into every generated query, on every grain. Citizen → `account_id = :self`; supervisor/dept-head → attribute predicates (boundary subtree / department); admin → tenant-only. Enforced in `AnalyticsPlanner.applyScope()` (`AnalyticsPlanner.java:241–251`) — today it emits tenant scope (L242–245) and citizen self-scope (L246), and has the boundary-LIKE branch wired (L247–249) but never fed (the prefix is hardcoded `null` in `AnalyticsScope.java:47`). Enforcement point: **every generated query, after KPI-def materialization** (design §5a Layer 1).

**Layer 2 — KPI catalog access ("which questions you may ask at all").** `rbac.visibleTo` (a role set) on each stored KPI def (design §3). Enforced at **two** points: discovery (`GET /catalog` returns only `visibleTo ∩ roles ≠ ∅`) **and** invocation (`POST /_query` re-checks `visibleTo` before planning → `403 kpi_forbidden`). The invocation re-check is the security boundary; discovery filtering is UX (design §5a Layer 2, "this re-check is the whole ballgame"). **Missing today** — no saved KPI defs exist yet (plan §0).

**Layer 3 — Capability / grammar ("may you send raw inline queries").** A role gate at request parse, before planning. Only `PGR_ADMIN`/`DSS_ANALYST`/`SUPERADMIN` may POST inline `measures`/`dimensions`/`filters`; citizen/supervisor tokens may invoke published `kpiId`+declared params only → inline body rejected `403 inline_forbidden` (design §5, §5a Layer 3). **Missing today** (plan §0).

Layer 1 and Layer 2 are independent: a KPI's `visibleTo` is the **security ceiling** (the max role set that may ever see it) and is never widened just because row scope returned empty (design §5a). A mis-authored dashboard pack that lists an out-of-ceiling KPI yields `403` on that tile, never a leak.

---

## 4. The attribute-scope model

Row scope (Layer 1) is generalized from "boundary OR citizen" into **a list of ANDed attribute predicates**, each predicate matching one user attribute with OR-within (plan §1). This avoids special-casing `department` next to `boundary` and then special-casing the next attribute.

- **Attributes, v1:** **jurisdiction** (`boundary_path` materialized-path **PREFIX** match) and **department** (`department_code` **IN** match). The model is open to further `EQ`/`IN`/`PREFIX` attributes with no grammar change.
- **AND across attributes, OR within an attribute.** A Sanitation supervisor for Wards 3 & 4 sees rows where `(boundary_path under W3 OR W4) AND (department_code IN ('SANI'))`. The OR-within covers multi-jurisdiction / multi-department employees.
- **PREFIX is anchored + escaped.** The boundary prefix ends in the path delimiter (`…WARD_3|`) and the bound value escapes `\`/`%`/`_` so a sibling (`WARD_3` vs `WARD_30`) cannot leak across — exactly the escape already coded at `AnalyticsPlanner.java:249`.
- **Admin bypass.** Admin/SUPERADMIN → the attribute list is **empty** (tenant-only), as today (design §5; plan §1).
- **Narrow-only.** A client may pass a *declared* `boundaryScope`/`departmentScope` param that ANDs **under** the injected scope; an out-of-scope selection yields an **empty** (not denied) result. There is no free `prefix`/department `filter` leaf — narrowing rides declared KPI-def params only (design §2, §5; plan §1).
- **Grain-aware binding.** Each predicate names a *logical* attribute; the planner maps it to the grain's physical column or **drops/rejects** the query if the grain cannot serve it (the events-department gap, §7). Never raw column names from the client (plan §1, §4).

---

## 5. Config ownership & source-of-truth split

The governing rule: **consume identity, don't rebuild it.** Identity, roles, jurisdiction and department already exist in DIGIT; analytics reads them, never re-authors them. Only the *KPI/dashboard config surface* is newly owned by the analytics backend.

**Newly pulled to the analytics backend (was FE / nowhere):**
- **KPI definitions** — `dss.KpiDefinition` MDMS records (frozen query body + viz + declared params + `rbac.visibleTo`), governed by the publish-time safety pipeline (design §3/§3a). Previously hardcoded in the FE bundle.
- **The served catalog / `/_schema`** — the column-and-grain whitelist the planner already owns server-side (`AnalyticsCatalog`, e.g. Grain definitions at `AnalyticsCatalog.java:54–108`); KPI **visibility** filtering is layered on top.
- **Dashboard packs** — `dss.DashboardPack` MDMS records (role → tile bundle + default layout), the curation layer above per-KPI `visibleTo` (design §5a).
- **The visibility mapping itself** — `rbac.visibleTo` (and optional `rbac.requiresAttributes`) on each def, plus the role→pack binding.

**Consumed from existing DIGIT (read-only, never rebuilt):**
- **Roles & user type** — from the validated principal (egov-user via the token), the `roles[]`/`type` that `AnalyticsScope.resolve()` reads today at `AnalyticsScope.java:34–44`.
- **Jurisdiction** — `uuid → eg_hrms_employee → eg_hrms_jurisdiction.boundary[]`, each resolved to its `ancestralmaterializedpath` via boundary-service (cached). HRMS owns it; analytics resolves it at request time (plan §1).
- **Department** — `uuid → eg_hrms_assignment.department[]` (active assignments). HRMS owns it (plan §1).
- **Layout/personalization** → user-preferences-service, **not** MDMS. Pack layout is a *default*; a user's per-tile reordering is preference state, owned by the preferences service, not the KPI config store.

---

## 6. Non-functional requirements

- **Freshness — MV `asOf`, never realtime.** Nothing the API returns is fresher than the last grain refresh. `complaint_facts`/`complaint_events` are hourly materialized views; `complaint_open_state_daily` is an append-only daily table (design §8, §10). Every window's upper bound is the grain's `asOf`; `live` means "current snapshot of the fact MV," not `now()`. RBAC does not change this contract — a scoped query is still bounded by `asOf`.
- **Performance — cacheable per-scope rollups.** Results cache in Redis keyed by `{kpiId|queryBody, params, **resolved scope**, asOf}` (design §8). **Resolved scope is part of the cache key** — a supervisor and an admin asking "the same" KPI get different cached entries (different injected `WHERE`); never serve a cached row across scope boundaries. This makes RBAC and caching co-designed, not bolt-on.
- **Auditability — the publish pipeline.** KPI defs become queryable only through validate → bounded dry-run → cost estimate → PII/officer approval gate → immutable versioned publish, each transition audited (who/when/diff), rollback = re-point "latest" (design §3a). The served catalog only ever holds catalog-valid, cost-bounded, PII-reviewed, versioned defs.
- **Fail-closed.** A missing/forged principal, an unresolved HRMS row, or a grain that cannot serve an attribute predicate must yield **empty or denied**, never unscoped. Specifically: a department-restricted caller's query against a grain lacking `department_code` is rejected/scoped, never returned unscoped (§7; plan §3 step 4); a missing HRMS row → empty scope, not open (plan §1 "Drift caution").

---

## 7. Constraints & known hazards

1. **The auth gap (blocks everything).** `AnalyticsController.java:41–47` trusts body `userInfo`; the Kong enrichment (`kong.yml:65–68`) skips validation when `userInfo` is pre-populated. Until a real auth filter / coercive gateway plugin lands, Layers 1–3 read attacker-controlled input. Exit criterion (plan §0/Phase 0): a forged-admin body gets citizen/empty scope, proven by a negative test.
2. **HRMS role pollution.** On real tenants every employee provisioned `GRO` also carries `PGR_LME` (and vice versa) — memory [HRMS role pollution]. A KPI gated on `PGR_LME` then surfaces to GROs unintentionally. Author/test `visibleTo` and packs against **clean single-role `RBAC_TEST_*` users**, never real provisioned accounts whose role sets have drifted (design §5a; plan §5).
3. **Department code-space mismatch.** The complaint's `department_code` is sourced from **MDMS ServiceDefs** (`data->>'department'`, migration L147; folded into the facts MV select at L169), while the *user's* department comes from **HRMS assignment**. If these draw from different code lists, the `department_code IN (…)` predicate silently matches nothing. A one-time consistency check (HRMS dept codes ⊆ MDMS `Department`/`Departments`) is a prerequisite to shipping department scope (plan §1, §6 "Biggest hidden risk").
4. **Events grain has no `department_code`.** The facts MV carries it (migration L169) and the catalog marks it groupable/filterable on facts (`AnalyticsCatalog.java:58–66`); the **events** Grain's column sets do not include it (`AnalyticsCatalog.java:81–96`) because the events MV select never projects it. Shipping department scope on facts but not events is a **silent grain leak** — the fix is to add `department_code` to the events MV (one migration), not to leave events unscoped (plan §3 step 4).
5. **Opaque, non-JWT token.** The DIGIT token is a redis-backed opaque UUID; **roles/attributes are never in the token** (plan §0 note). Phase 0 makes `userInfo` *trustworthy*; the attributes the token cannot carry (jurisdiction, department) are resolved server-side from HRMS at request time, cached short-TTL because they are mutable HRMS state.

---

## 8. Part breakdown (A–F) and dependency graph

This series decomposes into six parts. Parts map onto the implementation plan's phases but are documents, not commits.

| Part | Title | Covers | Maps to plan |
|---|---|---|---|
| **A** | Trust foundation | close the auth gap; make `userInfo` token-derived & coercive; spoof negative test | Phase 0 |
| **B** | Identity → attribute resolution | `PrincipalAttributes` (jurisdiction + department from HRMS); caching; dept code-space consistency check; fail-closed on missing HRMS row | Phase 1 |
| **C** | Attribute-scope engine | generalize `AnalyticsScope` to ANDed `attrScopes`; `applyScope()` loop (PREFIX reuse L249 + parameterized IN); wire jurisdiction; add department incl. events-MV migration | Phases 2–3 |
| **D** | KPI catalog access (Layer 2) | `dss.KpiDefinition` + `rbac.visibleTo`/`requiresAttributes`; discovery `/catalog`; invocation re-check `kpi_forbidden`; publish pipeline | Phase 4 (+ §3a) |
| **E** | Dashboard packs + layout split | `dss.DashboardPack` (role → tiles); layout default vs user-preferences-service personalization | Phase 5 |
| **F** | Inline-query gating (Layer 3) | role gate at parse; `inline_forbidden`; analyst/admin-only raw grammar | Phase 6 |

**Dependency graph (what blocks what):**

```
                 A (trust foundation)         ← blocks EVERYTHING; nothing below is real without it
                /            |            \
               B             D             F
        (attr resolve)  (catalog access) (inline gate)
               |             |
               C             E
        (attr-scope     (packs +
          engine)        layout)
```

- **A blocks all of B–F.** RBAC over a spoofable principal is theater (§1, §7.1; plan §6.1 "non-negotiable and first").
- **B → C.** The attribute-scope engine (C) cannot scope rows until the principal's jurisdiction/department are resolved (B). C's department half additionally blocks on the dept code-space check (B) and the events-MV migration (within C, plan §3 step 4).
- **D → E.** Packs (E) reference KPI defs whose `visibleTo` ceiling is defined in D; packs are assembly above the ceiling and re-check it at invocation.
- **F is independent of B/C/D/E** once A is in — it gates the *grammar* (raw inline) by role, orthogonal to row scope and catalog visibility.
- **B/C (row scoping, the Layer-1 spine) and D/E/F (catalog + grammar access) proceed in parallel after A** (plan §6.2). Each part ships as a one-concern PR against egov/CCRS develop, validated on ovh-cloud-dev (bomet repro) before live, with the emitted `WHERE` reviewed in tests, not just the Java (plan §5, §6.5).
