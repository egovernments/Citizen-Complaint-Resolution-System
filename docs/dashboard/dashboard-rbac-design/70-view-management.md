# Dashboard View Management Across Users (Part 70)

**Status:** v1 (pass-1, no adversarial review yet — see note at end), 2026-06-23.
**Answers** the first item appended to CCRS #631: *"Elaborate more on how exactly the management of dashboard views work for different users."*
**Reads:** `40-kpi-catalog-governance.md` (Part D — KPI defs + ceiling), `50-packs-config-ownership.md` (Part E — packs + per-user layout), `60-frontend-inversion.md` (Part F — the thin renderer), `00-requirements.md` §2 (personas) / §5 (ownership split). This part is **synthesis**: it does not introduce a new data model — it narrates *who manages what surface, through which tool, over which lifecycle*, so the management experience is legible end-to-end rather than scattered across D/E/F.

> Parts D/E define the *artifacts* (KpiDefinition, DashboardPack, layout preference). This part defines the *operations* on them and the *experience* each persona has. Where it states a mechanism it cites the part that owns it.

---

## 1. The core idea: a view is assembled, never authored whole

No one "designs a dashboard." A user's dashboard is **computed at request time** from three independently-owned inputs, each managed by a different actor through a different surface:

| Input | Artifact | Managed by | Surface | Churn | Owner part |
|---|---|---|---|---|---|
| **What questions exist** | `dss.KpiDefinition` (query + viz + `visibleTo` ceiling) | Tenant admin / KPI author | Configurator → KPI editor → publish pipeline | low (governed, versioned) | D |
| **Which questions each role gets** | `dss.DashboardPack` (role → ordered tiles + default layout) | **Single tenant curator** ("dashboard owner") | Configurator → Dashboard Pack editor (customEditor) | medium (tenant policy) | E |
| **My personal arrangement** | `PGR_DASHBOARD_LAYOUT` preference (sparse overrides) | the **end user**, themselves | the dashboard itself (drag/resize/hide) | high (every drag) | E.3 |
| **Which rows I see** | *no artifact* — derived from the principal | nobody — automatic | n/a | B/C |

The discipline (00-requirements §3, §5): **these never collapse into one another.** The curator picks *which KPIs a role sees* and **never** *which rows* (that is automatic per-user, B/C); the user personalizes *arrangement* and **never** *membership or access* (the ceiling re-checks on every tile). A view is the deterministic merge of these layers, recomputed per request — so a change at any layer (publish a KPI, re-curate a pack, drag a tile) reflects on the next load with no rebuild and no release.

---

## 2. The three management surfaces, by actor

### 2.1 KPI author / tenant admin — *manages what questions exist* (Part D)

**Surface:** the configurator's KPI-definition editor (registered as a managed MDMS resource, 50-packs §E.4(a): `'kpi-definition'` → `dss.KpiDefinition`), backed by the publish pipeline (40-kpi §D.5).

**Lifecycle of one KPI (40-kpi §D.1, §D.5):**
```
draft ──(validate → bounded dry-run → cost estimate → PII/officer gate)──► published ──► archived
                                                                            │
                                            edit ⇒ NEW immutable version ───┘ (forward-only; old version frozen)
```
- A KPI is **immutable + versioned**: editing a published def creates a *new version*; the old one is never mutated (40-kpi §D.1 — "immutable versioning is an explicit pipeline invariant"). So a live dashboard never breaks mid-edit, and a pack can pin a version to avoid drift.
- The def carries its own **security ceiling** (`rbac.visibleTo`, the max role set that may *ever* see it) — set here, by the author, under the platform ceiling. The **publish-time PII×audience check** (40-kpi §D.5, design §5) rejects publishing a def whose query projects an officer/PII column to an audience that includes `PUBLIC`. This is the one governance gate at *author* time; everything else is enforced at *serve* time.
- **Management actions:** create draft, validate, publish (forward-only transition), supersede with a new version, archive. All audited (who/when/diff).

The admin manages *the catalog of possible questions*. They do **not** decide who sees what here beyond the ceiling — that is the curator's job (§2.2), bounded by this ceiling.

### 2.2 Tenant curator ("dashboard owner") — *manages which role sees which KPIs* (Part E)

**Surface:** the configurator's **Dashboard Pack editor** — a `customEditor` (`dashboardPackEditor`, 50-packs §E.4(b)), **required from MVP** because `tiles[]` is an object-array the generic form can't express (50-packs §E.4(b), `types.ts:11–21`). The editor's KPI picker is **fed by Part D's catalog `_search`** (50-packs §E.4(b)), so the curator can only add KPIs that exist and are visible at the editing tenant.

**One curation tier, tenant-wide (00-requirements §2; design §6).** A single designated role curates for the *whole* tenant. There is no per-ward / per-team delegation in this version (explicitly out of scope, product-overview §"Scope & phasing"). The curator:
- Authors **one `dss.DashboardPack` per role** (`role` is the record key, 50-packs §E.1): picks the ordered list of `kpiId`s that role sees, and arranges the **default layout** grid.
- Works **strictly under the ceiling.** A pack listing an out-of-ceiling KPI is **not an author-time error and not a serve-time leak** — it is *dropped* at serve time and 403s if invoked directly (50-packs §E.1, §E.2 step 4; the `disjoint(visibleTo, roles)` re-check). So a mis-curated pack degrades to "missing tile," never "leaked data."
- Sets the pack's own **`status: draft|published`** (the same lifecycle as the def, design §6) so a half-built dashboard is never exposed — and for the public path the gate is the triple `pack.status:published` **AND** `def.status:published` **AND** `PUBLIC` eligibility (design §6, §7).

**Management actions:** create/edit a role's pack, reorder tiles, set default layout, add/remove a KPI for a role, publish the pack. **Per-KPI visibility lives in the pack, not on the def** — deliberately, because visibility is tenant policy that changes often while defs are immutable artifacts (50-packs §E.1; design §6). Changing what a role sees is a pack edit, never a def re-publish.

### 2.3 End user — *manages their own arrangement only* (Part E.3)

**Surface:** the dashboard itself — drag, resize, hide a tile. Saved as **one sparse `PGR_DASHBOARD_LAYOUT` preference row** per `(user, tenant)` in `digit-user-preferences-service` (50-packs §E.3), holding only the *delta* against the role default.

**The user can subtract and rearrange, never add (50-packs §E.3 merge contract):**
- They may move/resize a tile, or `hidden:true` a tile they're permitted to see.
- They **cannot** surface a tile the backend withheld: the override is filtered *through* the ceiling-filtered `tiles` set, never the reverse (50-packs §E.3 step 4). A stale personal layout can never resurrect a tile the pack/ceiling already dropped.
- The override is keyed to the **token uuid, never a body value** — the identity-binding precondition (50-packs §E.3, the IDOR fix) is what makes "subtract-only" actually hold; without it the personalization store is an open IDOR.

**Management actions:** drag/resize/hide/reset. Switching a tile between table↔bar↔line↔map is a **pure client re-render** (Part F.4) — not a saved view, just a viz toggle on the same data; "map" additionally fetches boundary polygons by code.

---

## 3. What each persona experiences (the "many audiences, one view system" view)

Same pack-resolution path, different inputs in, different dashboard out (00-requirements §2; product-overview §"What we're building"):

| Persona | KPIs they get (Layer 2: pack ∩ ceiling) | Rows they get (Layer 1: auto, B/C) | What they manage |
|---|---|---|---|
| **Citizen** | the `CITIZEN` pack — published, public-eligible KPIs + "my complaints" | `account_id = self` (injected) | their own tile arrangement |
| **Ward supervisor (GRO)** | the `GRO` (∪ polluted roles) pack — incl. *approved* bounded officer leaderboards | their `boundary_path` subtree (auto) | their arrangement |
| **Department head** | the dept-role pack | their `department_code` slice (auto, once dept scope ships) | their arrangement |
| **Tenant admin** | any KPI in ceiling; **inline queries** allowed | whole tenant | their arrangement **+ authors KPIs** |
| **Tenant curator** | (whatever their role pack lists) | per their role | **authors every role's pack** |
| **Public (no login)** | only `status:published` ∧ `PUBLIC`-eligible, aggregate-only | tenant aggregates, strictest column tier | nothing (no personalization) |

**Multi-role / HRMS pollution (50-packs §E.1 role-union).** A real principal usually holds several roles (every `GRO` also carries `PGR_LME`, memory [HRMS role pollution]). The serve path resolves the **union** of the caller's role-packs, then **ceiling-filters per tile** — so pack membership is never wider than the union *and* the ceiling closes the door regardless. Union order is made deterministic by a **config-driven role priority** (50-packs §E.2, resolving the pass-1 open question). Packs are *authored/tested* against clean single-role `RBAC_TEST_*` users so intent is provable without pollution noise.

**Degrade-to-public-floor (00-requirements §6; design §8; product-overview §3).** When HRMS attribute resolution *fails* (not "resolved to empty"), the principal **downgrades to the public-equivalent view** — tenant aggregates, `PUBLIC` KPIs, strictest column tier — with a `degraded:true` signal so the FE shows a *"showing public view"* banner, plus telemetry on every fall-to-floor (the HRMS data-quality monitor). Never their jurisdiction's detail, never a blank screen, never everyone's records. This is *view management's* failure mode made graceful.

---

## 4. End-to-end management lifecycle (who touches what, in order)

```
① KPI author (configurator → KPI editor)
     draft def → validate/dry-run/cost → PII×audience gate → PUBLISH (immutable version)
     └─ artifact: dss.KpiDefinition{ query, viz, visibleTo ceiling, status:published }   [Part D]

② Tenant curator (configurator → Dashboard Pack editor, KPI picker fed by D's catalog)
     for each role: pick KPIs (under ceiling), order tiles, set default layout → PUBLISH pack
     └─ artifact: dss.DashboardPack{ role, tiles[], layout, status:published }            [Part E]

③ End user (the dashboard)
     opens dashboard → POST /v2/analytics/packs (resolves role-union ∩ ceiling) → tiles+defaultLayout
     reads PGR_DASHBOARD_LAYOUT (userId coerced to token uuid) → overlays personal deltas
     drags/resizes/hides → POST _upsert (sparse override)                                  [Part E.3]
     per tile → POST /v2/analytics/_query?kpiId  → D re-checks ceiling, B/C inject row scope [Parts D/B/C]
     toggles viz table↔bar↔line↔map → pure client re-render                                [Part F.4]
```

(The serve-path control flow is 50-packs §E.5 in full. The point of *this* part is the **left column** — the management actions and who performs them.)

**The drift guarantees that make this safe to manage independently:**
- Curator references a since-archived KPI → tile **dropped** at serve, dashboard doesn't 500 (50-packs §E.2 "drop-not-error").
- Curator over-curates beyond ceiling → tile **dropped** + `403` if hand-invoked (50-packs §E.1).
- User's stale layout references a withheld tile → **dropped** (50-packs §E.3 step 4).
- Admin re-publishes a KPI → live packs pinned to the old version are unaffected (immutable versioning, 40-kpi §D.1); packs on `null` (latest) pick it up next load.

Every layer fails toward "less is shown," never "more is leaked."

---

## 5. Interfaces with other parts

| Boundary | Contract |
|---|---|
| **← Part D** | provides the catalog (`_search`) that feeds the curator's KPI picker, the `visibleTo` ceiling re-checked per tile, and the immutable-versioned defs packs reference. |
| **← Part E** | provides the `dss.DashboardPack` model, the `resolveForCaller` serve path, the `PGR_DASHBOARD_LAYOUT` preference + identity binding. This part adds **no new model** — it sequences the management *actions* over E's artifacts. |
| **← Part F** | the thin renderer that consumes `{tiles, defaultLayout}` + overrides and does the viz-agnostic re-render; the user's only "management" of viz is a client toggle. |
| **← Parts B/C** | row scope is *not* a management surface — it is automatic from the principal. This part's only claim about rows is that **no actor ever curates them**; conflating row scope into curation is the failure mode (00-requirements §3). |
| **Configurator** | both `dss.KpiDefinition` and `dss.DashboardPack` are registered managed resources (50-packs §E.4); the pack editor's `customEditor` is MVP, not deferred. |

---

## 6. Open questions for review

1. **Curator role binding.** Which DIGIT role *is* the "dashboard owner" — a new `DASHBOARD_CURATOR`, or an existing top supervisor / `PGR_ADMIN`? (product-overview Open Q1 confirms one tier; this asks which role-code carries it.) Recommendation: a dedicated `DASHBOARD_CURATOR` so curation isn't entangled with admin's inline-query/publish powers.
2. **Public dashboard default** (product-overview Open Q2): opt-in per tenant, or off-everywhere until enabled? Recommendation: **off by default**, opt-in via a published `PUBLIC` pack — fail-closed for the highest-traffic, lowest-auth surface.
3. **Degraded-view notice sufficiency** (product-overview Open Q3): is the "showing public view" banner enough, or do supervisors need an active alert + a self-flag path for their missing HRMS data?
4. **Curator preview-as-role.** Should the pack editor let the curator *preview a role's resolved dashboard* (run `resolveForCaller` as that role against `RBAC_TEST_*`) before publishing? Strongly recommended — it makes the ceiling/drop behavior visible at author time instead of as a surprise missing tile.

---

> **Review status.** This is a **pass-1 synthesis** over Parts D/E/F as written; it introduces no new artifact, so its claims are anchored to those parts' cited code (50-packs §E.1–E.5, 40-kpi §D.1/§D.5, 60-frontend §F.4). Unlike Parts A–F it has not had the adversarial code-grounded review pass. Recommended next: fold §3's persona matrix and §4's lifecycle into the `product-overview.md` "What we're building" section (it currently describes outcomes, not the management *operations*), and run the dual-review pass if this graduates from synthesis to a committed surface.
