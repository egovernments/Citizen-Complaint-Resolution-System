# Dashboard Test Strategy (Part 90)

**Status:** v1 (pass-1, no adversarial review yet — see note at end), 2026-06-23.
**Answers** the second item appended to CCRS #631: *"Tests for Dashboard."*
**Reads:** the per-part validation matrices already written into Parts A–F (consolidated here), `00-requirements.md` §6 (NFRs) / §7 (hazards). Test infrastructure facts from memory: [DIGIT integration tests repo], [Bomet integration-tests deploy], [Integration-tests RUN button], [Bomet IT-run findings], [HRMS role pollution].

> The individual Parts A–F each end with their own tests; they are **scattered**, not a plan. This part is the **single test surface**: it (1) names the layers and where each test lives, (2) consolidates every per-part negative/exit test into one **leak-regression matrix**, (3) fixes the fixture discipline (clean-role users) and the one assertion that is non-obvious (assert the *emitted SQL*, not just the Java), and (4) states the exit gate per phase.

---

## 1. The testing pyramid for this feature — three layers, three homes

| Layer | What it proves | Where it lives | Runs |
|---|---|---|---|
| **Unit (JUnit, pgr-services)** | the planner emits the right `WHERE`; the gate rejects the right requests; the principal builder coerces | `backend/pgr-services/src/test/...` (currently **empty for analytics RBAC** — 30-row-scope §"Summary": *"no tests found"*) | CI per-PR (CCRS develop) |
| **Integration / API (HTTP, per-tenant)** | a real token → real scope/ceiling against a running stack; the cross-arm gate; fail-closed degrade | `ChakshuGautam/digit-integration-tests` (memory [DIGIT integration tests repo] — the canonical home for new IT/E2E) | bomet IT runner daemon `:8181`, `/tests/api/` (memory [Integration-tests RUN button]) |
| **E2E (Playwright, FE)** | the thin renderer shows only resolved tiles; viz toggle; "showing public view" banner; personalization subtract-only | integration-tests Playwright specs on bomet `/integration-tests/` (memory [Bomet integration-tests deploy]) | bomet nightly + RUN button |

**Reality anchor:** today there is **no analytics-RBAC test at any layer** — every Part A–F review converged on "design text only, no `src/test` coverage" (30-row-scope §456, §478; 40-kpi §408; README cross-cutting). So this is greenfield test authoring, and the **negative tests are the deliverable**, not an afterthought — each is the proof that a specific known leak is closed.

---

## 2. The leak-regression matrix (consolidated from Parts A–F)

Every row is a **negative test** a reviewer can run; each closes a named hazard. This is the single matrix the per-part exit criteria all feed into. **A PR for a part is not green until its rows pass.**

| # | Test (input → expected) | Closes hazard | Part / anchor |
|---|---|---|---|
| **T1** | Forged-admin body (`type:EMPLOYEE`, `roles:[PGR_ADMIN]`, **no token**) → **citizen/empty scope**, not admin | fail-open identity (the auth gap) | A / 00-req §7.1; `AnalyticsController.java:41–47`, `kong.yml:65–68` |
| **T2** | Valid token, body `userInfo` **overwritten** by introspection; mismatched body `tenantId` → **403** | spoofable principal / cross-tenant | A / 10-auth §A.4 (:231) |
| **T3** | Introspection 5xx/timeout → **401**, NOT null-scope pass-through | fail-OPEN swallow | A / `ServiceRequestRepository.java:38–40` |
| **T4** | **Citizen + `grain:"daily"`** → `grain_scope_unavailable` (pre-C2) / `account_id=self` rows only (post-C2), **never tenant-wide** | the convergent daily-grain citizen leak | C / `AnalyticsPlanner.java:246`, `AnalyticsCatalog.java:108`; 30-row-scope §386, §410 |
| **T5** | GRO with jurisdiction `WARD_3` → only `boundary_path LIKE 'WARD_3|%' ESCAPE '\'` rows; **`WARD_30` does not leak** | sibling-prefix leak | C / 30-row-scope §372, §391 |
| **T6** | Sanitation supervisor → `department_code IN ('SANI')` on **facts AND events**; multi-dept user → union | events-grain dept gap / silent under-scope | C / 00-req §7.4; 30-row-scope §378 |
| **T7** | Complaint whose `service_code` has **no ServiceDef** → invisible to dept-scoped caller, **visible to admin** (fail-closed, not leak) | NULL `department_code` LEFT-JOIN coverage | C / 30-row-scope §389, §412 |
| **T8** | **Unresolved HRMS** employee → **degrade-to-public-floor** (`degraded:true`, aggregates, strictest columns), NOT deny-all blank AND NOT tenant-wide | the degrade rule | B/C / 00-req §6, §8; 30-row-scope §C.1a |
| **T9** | Citizen POSTs **inline** `{"queries":{"x":{...measures...}}}` (batch arm) → `inline_forbidden` | batch-dict arm bypasses the gate | D/F / `AnalyticsService.java:42–46`; 40-kpi §D.3, §302 |
| **T10** | Role POSTs a `kpiId` **absent from its catalog** → `403 kpi_forbidden` | discovery/invocation drift | D / 40-kpi §303 (`disjoint(visibleTo,roles)`) |
| **T11** | `_schema` / `_search` as low-privilege → **role-filtered**, no PII/officer columns past ceiling | unauthenticated `_schema` PII exposure | D / 40-kpi §D.4a |
| **T12** | Publish a def projecting `current_assignee_uuid` with `PUBLIC` in audience → **publish rejected** | PII×audience at publish | D / 40-kpi §D.5; design §5 |
| **T13** | Pack lists an **out-of-ceiling** `kpiId` → tile **dropped** at serve, `403` if hand-invoked (no 500, no leak) | mis-curated pack | E / 50-packs §E.1, §E.2 |
| **T14** | User `_upsert`/`_search` someone **else's** `PGR_DASHBOARD_LAYOUT` (body `userId`) → **rejected** (coerced to token uuid) | user-preferences IDOR | E / 50-packs §E.3; `preference_service.go:107` |
| **T15** | Stale personal override referencing a **withheld** tile → **dropped** (subtract-only; can't resurrect) | personalization can't widen | E / 50-packs §E.3 step 4 |
| **T16** | FE receives only ceiling-filtered tiles; a hidden tile **cannot** be invoked from the bundle | FE-as-authority | F / 60-frontend; design §1 |

**Multi-role coverage (T-pollution).** Because every real `GRO` also carries `PGR_LME` (memory [HRMS role pollution]), the union path (50-packs §E.1) needs its own test: a **`GRO+PGR_LME`** user resolves the deterministic union and ceiling-filters per tile — but **authored/asserted against clean single-role `RBAC_TEST_*` users** so intent is provable. Never write a `visibleTo` test against a real provisioned account whose roles have drifted (00-req §7.2).

---

## 3. The one non-obvious assertion: test the emitted SQL, not just the Java

The plan is explicit (00-req §137; 30-row-scope §365; 40-kpi §295): **review the emitted `WHERE` in tests, not just the Java path.** Row scope is a string-built predicate; a unit test that asserts `applyScope()` was *called* proves nothing — the test must assert the **bound SQL**:

- The injected predicate is **anchored + escaped**: assert the bound value is `'WARD_3|'`-terminated and `ESCAPE '\'` is present (T5), so a refactor that drops the delimiter is caught.
- The predicate is **ANDed unconditionally**: assert it appears for *every* grain and *both* the single and batch arms (T9) — the batch arm calling `runOne` directly is the exact hole (40-kpi §D.3).
- The **cache key includes resolved scope** (00-req §6): assert a supervisor and an admin asking "the same" KPI get **different cache entries** — never a cross-scope cache hit. This is a co-design test, not a perf test.

These are pure unit tests over the planner output (no DB needed) and are the cheapest, highest-signal tests in the suite.

---

## 4. Fixtures & environment

- **Clean-role users.** A fixed set of `RBAC_TEST_*` single-role accounts (one per persona: citizen, `GRO`+ward, dept-head, admin, analyst, and a deliberately **unresolved-HRMS** user for T8). Provisioned once per test tenant; **never** real accounts (role pollution → false confidence, 00-req §7.2). Bomet already has ward-scoped CSR-style users (memory [Bomet ward CSR]) usable as a template.
- **Tenant.** Run integration/E2E against a **sandbox tenant** (e.g. `ke.demo` per memory [bomet MCP REST shim], or a dedicated `ke.dashtest`) so test data is disposable and the leak matrix can seed adversarial rows (the no-ServiceDef complaint for T7, the cross-dept complaint for T6).
- **Where it runs.** bomet redeploys nightly from CCRS develop (memory [bomet redeploy cron]); the IT runner daemon (`:8181`, `/tests/api/`) and Playwright specs run there. **Validate on ovh-cloud-dev (bomet repro) before live bomet** — the standard CCRS path (00-req §137).
- **Known runner hazards to design around** (memory [Bomet IT-run findings], [Bomet nightly integration tests broken]): the Playwright suite has been killed at the 90-minute run-cycle timeout by slow `mdms-v2`/`user` `_search` specs, and an onboarding-wizard hang crashes Playwright. **Keep the dashboard E2E specs fast and isolated** (their own spec file, no dependence on the lifecycle-fixtures collection trap) so they don't inherit the frozen-dashboard failure mode.

---

## 5. Per-phase exit gates (what "done" means for each part's PR)

Tests are the **exit criterion**, mapped to the phase plan (00-req §8):

| Part | Exit gate (must pass before merge) |
|---|---|
| **A** | T1, T2, T3 — a forged-admin body gets citizen/empty scope; mismatched tenant 403s; introspection failure → 401. *No other part may merge before A's gate is green* (A blocks all). |
| **B** | T8 (degrade-to-floor with `degraded:true`); dept code-space consistency check has a test asserting HRMS codes ⊆ MDMS. |
| **C** | T4, T5, T6, T7 — the daily leak, sibling-prefix, events-dept, NULL-coverage. **T4 is mandatory in both PR-C1 and PR-C2** (30-row-scope §386). Emitted-WHERE assertions (§3) required. |
| **D** | T9, T10, T11, T12 — both-arm gate, catalog drift, `_schema` filtering, publish PII×audience. |
| **E** | T13, T14, T15 — mis-curated pack drop, preferences IDOR, subtract-only override. |
| **F** | T16 — FE renders only resolved tiles; viz toggle is a pure re-render with no extra data exposure. |
| **80 (multi-tier)** | a `service_code` with no ServiceDefs row → NULL `complaint_node_path`, fail-closed bucket (the taxonomy analogue of T7); a tier group-by returns correct subtree counts. |

**Regression suite = the whole §2 matrix**, run nightly on bomet. Any row going red is a leak regression, not a flaky test — treat as a release blocker.

---

## 6. What this part deliberately does NOT cover

- **MV correctness / analytics-number accuracy** — that is the grain/MV design's concern (`complaint_facts-design.md`, `dashboard-query-api-design.md`), tested separately; this part tests **access and scope**, not whether the count is right.
- **Load/perf** — beyond the cache-key-includes-scope assertion (§3), throughput testing of public dashboards is a separate NFR exercise.
- **The configurator editor's own UI** — the `dashboardPackEditor`/KPI-editor component tests belong with the configurator, not this suite; this part tests the *resolved output* (T13), not the authoring widget.

---

## 7. Open questions for review

1. **Integration vs. unit split for the leak matrix.** Several rows (T4, T5, T9) are expressible as *pure planner unit tests* (assert emitted SQL) **and** as live API tests. Recommendation: write the **unit** version as the merge gate (fast, in-CI) and the **API** version as the nightly regression (proves the whole stack). Confirm both, or unit-only for merge.
2. **Sandbox tenant.** Reuse `ke.demo` (memory [bomet MCP REST shim]) or stand up a dedicated `ke.dashtest`? A dedicated tenant lets the suite seed adversarial rows (T6/T7) without polluting the demo sandbox — recommended.
3. **Playwright isolation.** Given the nightly suite's 90-min-timeout fragility (memory [Bomet nightly integration tests broken]), should the dashboard E2E specs run as a **separate fast job** rather than inside the main run-cycle? Recommended, so a dashboard regression is visible even when the big suite is red.
4. **Who owns the `RBAC_TEST_*` fixture provisioning** — a seed script in integration-tests, or MCP `tenant_bootstrap`? Recommendation: integration-tests seed (memory [DIGIT integration tests repo] is the canonical home), so the fixture lives next to the tests that need it.

---

> **Review status.** This is a **pass-1** consolidation: every matrix row is lifted from a Part A–F exit criterion or a converged review finding (anchors cited inline), and the infrastructure facts are from operational memory, not freshly re-verified against the live `:8181` runner. Unlike Parts A–F it has not had the adversarial review pass. Recommended next: when Part A implementation begins, author T1–T3 *first* (the auth gate is the prerequisite for every other test being meaningful), and stand up the `RBAC_TEST_*` fixtures so the whole matrix has clean-role accounts to run against.
