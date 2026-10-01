# FE → BE Dashboard Config Extraction Inventory (Part 65)

**Status:** v1, 2026-06-25. The concrete extraction that feeds **Part D** (`dss.KpiDefinition`) and **Part F** (frontend inversion). Answers: *"pull all the data about dashboards, default KPIs, queries, and visualization models from the FE to the BE."*
**Reads:** the live FE config at `CCRS/frontend/micro-ui/web/src/dashboard/` (read directly, file:line below); `40-kpi-catalog-governance.md` (Part D target schema), `50-packs-config-ownership.md` (Part E packs/layout), `60-frontend-inversion.md` (Part F renderer).
**Scope:** PGR only.

> This is an **inventory + target-mapping**, not new design. It enumerates exactly what is hardcoded in the FE today, classifies each artifact, maps it to its BE home, and flags the migration decisions (unimplemented placeholders, client-derived metrics, officer-PII, formatting). It is the worklist for generating the actual MDMS seed records.

---

## 0. The FE config surface (what physically exists today)

All under `src/dashboard/`:

| File | Role today | Becomes |
|---|---|---|
| `config/kpiQueries.js` | `BATCH_QUERIES` = **52 named query bodies** in the analytics DSL + builders + client formatters/parsers | `dss.KpiDefinition.query` (×52) |
| `config/complaintLandscape.js` + 5 sibling `*Landscape.js` | per-section **metric cards** (title, accent, sub-metrics → `{format, measureKey, queryKey, derived}`) + **charts** | `dss.KpiDefinition.viz` + params; section grouping → catalog |
| `config/supervisorMetrics.js` | aggregates the 6 landscapes into `KPI_METRICS`, `CHART_WIDGETS`, `INVENTORY_SECTIONS` | the served **catalog** (Part D `/catalog`) |
| `constants/layoutConfig.js` | `DEFAULT_LAYOUT` (grid), `WIDGETS`, sizing | `dss.DashboardPack.layout` + `tiles` (Part E) |
| `config/dashboardConfig.js` | branding + `localStorage` layout key | branding stays `globalConfigs`; layout key → user-preferences |
| `hooks/useDashboardData.js`, `services/analyticsService.js` | batch-POST `BATCH_QUERIES`, render | thin renderer invoking by `kpiId` (Part F) |

**Three logical layers to extract:** (1) **queries** → defs; (2) **visualization models** (format + chart type + sub-metric selectors) → def viz; (3) **composition** (sections + default grid) → packs. They are tangled in the FE; the BE separates them (query-shape vs viz-config vs pack — Part D §0.6).

---

## 1. Layer 1 — the 52 KPI queries → `dss.KpiDefinition.query`

`BATCH_QUERIES` (`kpiQueries.js:47–416`). The analytics DSL is already exactly the `/v2/analytics/_query` body, so **each entry transplants verbatim** into a def's `query` field. Grouped by section prefix:

| Prefix | Section | # queries | Grain(s) | Notable |
|---|---|---|---|---|
| `cl_` | Complaint landscape | 19 | facts | channel ratios, `service_code`/`ward_code`/`created_dow` dimensioned charts |
| `ep_` | Employee performance | 7 | facts | **officer-PII** (4 project `current_assignee_uuid`) |
| `rs_` | Resolution & SLA | 7 | facts | ratios, percentile TTR |
| `er_` | Escalations & risk | 11 | facts **+ events** | events grain for escalation source (auto/manual) |
| `ce_` | Citizen experience | 8 | facts | CSAT avg, `count_distinct account_id` |

**DSL vocabulary used** (the catalog the BE must accept): `grain ∈ {facts, events}`; `window {name ∈ last_1d/last_7d/last_30d/wtd/mtd, timeRole ∈ filed_at/resolved_at/event_at}`; `measures[{agg ∈ count|ratio|avg|percentile|count_distinct, column, p, filter}]`; `dimensions`; `filters`; `sort`; `limit`. Every one of these must be a recognized catalog token server-side (Part D / `AnalyticsCatalog`).

**Officer-PII defs (route through the eligibility ceiling — design §12):** `ep_open_by_officer`, `ep_closed_by_officer`, `ep_leaderboard_closed`, `er_critical_by_officer` — all via `officerTopCount` projecting `current_assignee_uuid` (`kpiQueries.js:37–45`). These are **never** `PUBLIC`-eligible and must carry `rbac.visibleTo` excluding public + a PII flag (Part D §D.5 publish-time check).

---

## 2. Layer 2 — visualization models → `dss.KpiDefinition.viz`

Each landscape "metric" is a **card with selectable sub-metrics**; each sub-metric binds a query to a **format**. Shape (from `complaintLandscape.js:66–263`):

```jsonc
{ id:"cl-metric-channel-mix", metric:"Channel mix", accent:"slate", defaultSubMetricId:"online",
  subMetrics:[ { id:"online", label:"% via online portal",
                 outputFormat:"...", format:"percentInteger", measureKey:"pct",
                 queryKey:"cl_channel_online" }, ... ] }
```

What moves where:

| FE field | Meaning | BE home |
|---|---|---|
| `metric`, `label` | English titles | **localization keys** on `KpiDefinition.title` (resolved at edge, like Part D/E titles) — not raw strings |
| `accent` | card color | `viz` (presentation) |
| `format` / `outputFormat` | how to render the scalar (integer, percentInteger, percentOneDecimal, decimalOne, hoursDays, hoursDecimal, ordinal, signedInteger, …) | `viz.format` — **the BE-served catalog tells the FE how to render**; FE keeps the *renderer*, BE owns the *spec* |
| `measureKey` | which column of the result row to show (`total`/`pct`/`avg_ms`/…) | `viz.valueKey` |
| `defaultSubMetricId`, `subMetrics[]` | the in-card selector | `viz.variants[]` (one def with selectable params, or N defs) — **decision below** |
| chart `type` (`bar-chart`, `ranked-list`) | viz kind | `viz.chart` |

**Chart widgets** (`LANDSCAPE_CHARTS`, `complaintLandscape.js:230–263`): `bar-chart` / `ranked-list`, each with a `queryKey`. These are dimensioned KPIs whose viz is a chart not a scalar → `viz.chart ∈ {bar, rankedList, line, map}` (Part F.4 viz-agnostic set).

**The render *engine* (code) stays FE; the viz *spec* (declarative config) comes from the BE.** `formatSubMetricValue` (`kpiQueries.js:479–551`) and the chart parsers `parseBarChart`/`parseDowChart`/`parseRankedList` (`:575–601`) are interpreters — pure functions from `(spec, data) → pixels`. They stay. What moves is the *spec they interpret*: `format`, `chart`, `valueKey`, `accent`, `variants`, `compose` are all declarative config that must be served in the catalog response. The FE has zero embedded knowledge of which format a given KPI uses — it reads that from the def's `viz` object. The full `viz` schema is specified in **Part 66** (`66-viz-schema-api-contract.md`). The rendering code lives in the FE; the rendering instructions live in the BE.

---

## 3. Layer 3 — composition → `dss.DashboardPack`

- **Sections** (`supervisorMetrics.js` `INVENTORY_SECTIONS`): 6 groups (complaint-landscape, employee-performance, resolution-sla, escalations-risk, citizen-experience, comparative-reporting) each listing `metricIds`. → the **catalog grouping** the picker shows; and the seed for per-role pack `tiles`.
- **Default grid** (`layoutConfig.js` `DEFAULT_LAYOUT`, `:` block): a concrete 12-col react-grid-layout — 6 complaint KPIs on row 0 + 4 charts below. → `dss.DashboardPack.layout.grid` (opaque blob, Part E.1) for the **default/supervisor** role. **Only one default grid exists today** (complaint-landscape); the other 5 sections are inventory-only (added via the `KpiInventory` picker). Per-role packs (citizen/supervisor/admin/public) are **net-new authoring** — there's no FE precedent to extract, only this one default.
- **Layout persistence:** `getLayoutStorageKey()` = `localStorage["<tenant>-supervisor-dashboard-layout-v13"]` (`dashboardConfig.js`). → migrates to user-preferences `PGR_DASHBOARD_LAYOUT` (Part E.3), with the identity-binding fix.
- **Branding:** `dashboardConfig.js` already reads `globalConfigs` (`DASHBOARD_BRAND_PRIMARY/DARK/SLATE`, `DASHBOARD_STATE_LABEL`, `DASHBOARD_SYSTEM_TITLE`). **Already externalized — leave as globalConfigs**, do not move to MDMS.

---

## 4. Migration decisions / gaps (the part that isn't mechanical)

### 4a. Unimplemented placeholders (`queryKey: null`) — decide: implement or drop
A large share of declared sub-metrics have **no query** — they are spec'd cards with `queryKey: null`, rendering `—`. Found across every landscape:
- **WoW/MoM deltas** (`format: percentDelta` / `percentPointDelta`) — `cl` count cards' `wow`/`mom`, `rs` `wow_delta`/`median_delta`, `cl-metric-inflow-rate.wow_avg`, `ep` `rank_sla`. `formatPercentDelta()` literally returns `—` (`kpiQueries.js:435–437`). **No period-comparison support exists** in the DSL.
- **Map / hot-ward** (`cl-metric-hot-ward`, all 3 sub-metrics `na`/`multiplier`/`text`, no query) — needs the `map` viz + a spike computation.
- **By-category breakdowns** (`rs-metric-resolution-by-category`, `rs` `by_category`, `breach` `by_category`/`trend_7d`) — dimensioned queries not yet written.
- **Pending-ack / approaching-SLA early-warning** (`ep-metric-pending-ack` all null; `er-metric-approaching-sla` `breach_4h`/`breach_24h` null) — need new measures.
- **`net_14d`** (`rs-metric-inflow-outflow`) — null.

**Decision required:** for each null placeholder, either (a) author a real `dss.KpiDefinition` (preferred where the DSL already supports it — most by-category and the early-warning counts are expressible), or (b) drop it from the catalog. **Do not migrate `queryKey:null` tiles as-is** — a BE catalog of defs that return nothing is worse than the FE placeholder. This is the single biggest scoping item in the pull.

### 4b. Client-derived metrics — declarative `compose` rule in the def, evaluated in the FE engine
Four sub-metrics have **no query of their own**; they are computed from *other* query results (`formatSubMetricValue` `derived` branch):
- `dailyAvgFromWeekly` (cl inflow) = `cl_reg_weekly / daysElapsedThisWeek()`
- `hourlyAvgFromDaily` (cl inflow) = `cl_reg_daily / hoursElapsedToday()`
- `openRateComplement` (rs) = `100 − rs_closure_rate`
- `netBacklogDaily` (rs) = `rs_inflow_daily − rs_outflow_daily`

Under the strict migration direction (§0/Part 66): the **derivation rule is declarative knowledge** and belongs in the served `viz.compose` directive, not embedded in the FE. The FE engine *evaluates* the rule but does not *know* it a priori. Concretely:

```jsonc
// in the def for "Daily average complaints (this week)"
"viz": { "kind":"scalar", "format":"integer", "compose": {
  "type": "dailyAvgFromWeekly",
  "sourceKpiIds": ["cl_reg_weekly"],
  "elapsedFromAsOf": true   // FE divides by elapsed-days using the asOf the server stamps on cl_reg_weekly
} }
```

The FE engine has a small `compose` dispatcher keyed on `type` (4 entries); it evaluates the rule using already-scoped data + the server-supplied `asOf`. **The clock is not client-authoritative**: the elapsed-time divisor is derived from `asOf` (server-stamped), never from `Date.now()`. This removes the last piece of domain knowledge embedded in the FE — the FE knows *how to divide*; the BE tells it *what to divide and by what*. Migration: each derived sub-metric becomes a `dss.KpiDefinition` with `query:null` + `viz.compose` populated; its data dependencies are fetched by `kpiId` first, then the compose rule is evaluated client-side. See Part 66 for the full `viz.compose` schema.

### 4c. Localization
All `metric`/`label`/`outputFormat` strings are English literals. They must become **localization codes** (resolved at the edge like `KpiDefinition.title`), not shipped as raw text in MDMS — otherwise the multilingual tenants (Maputo PT, Nairobi SW/EN) get English dashboards. Add to the localization seed alongside the def migration.

### 4d. Officer-PII ceiling
The 4 `officerTopCount` defs (§1) and any leaderboard tile must carry `rbac.visibleTo` excluding `PUBLIC` + the PII flag, gated by Part D's publish-time consistency check. Do not migrate them as ungated/public tiles.

### 4e. The DSL token whitelist must exist server-side first
Every `filter` key the FE uses (`is_open`, `is_resolved`, `sla_breached`, `sla_status_bucket`, `aging_bucket`, `is_escalation`, `escalation_source`, `is_first_time_complainant`, `is_reopened`, `has_rating`, `is_negative_rating`, …) and every `column`/`dimension` (`resolution_ms`, `time_to_assign_ms`, `rating`, `account_id`, `current_assignee_uuid`, `service_code`, `ward_code`, `created_dow`) must be a **catalog-recognized token** on the right grain, or the def fails validation. Reconciling the FE's used-token set against `AnalyticsCatalog` is a **prerequisite** to seeding defs (a Part D validate-time gate).

---

## 5. Target-home summary

| FE artifact (count) | BE home | Owner part |
|---|---|---|
| `BATCH_QUERIES` query bodies (52, minus null placeholders) | `dss.KpiDefinition.query` | D |
| metric/sub-metric `format`/`outputFormat`/`accent`/`measureKey`/chart `type` | `dss.KpiDefinition.viz` | D / F |
| titles & labels (strings) | localization codes referenced by the def | D + localization |
| `INVENTORY_SECTIONS` grouping | served catalog grouping | D |
| `DEFAULT_LAYOUT` grid + `tiles` per role | `dss.DashboardPack` (default = supervisor; others net-new) | E |
| `localStorage` layout | user-preferences `PGR_DASHBOARD_LAYOUT` | E.3 |
| `formatSubMetricValue` / `parse*` render *engine* (code) | **stays FE** — pure interpreter, driven by `viz` spec | F |
| `format`, `chart`, `valueKey`, `variants`, `compose`, `accent` viz *spec* | `dss.KpiDefinition.viz` (served in catalog response) | D / Part 66 |
| branding (`DASHBOARD_BRAND_*`) | **stay `globalConfigs`** | — |

---

## 6. Sequencing (the actual pull)

1. **Reconcile the DSL token set** used by the 52 queries against `AnalyticsCatalog` (§4e) — fix gaps or the defs won't validate. *Prerequisite.*
2. **Triage the `queryKey:null` placeholders** (§4a): implement-as-def vs drop. Record the decision per tile.
3. **Generate `dss.KpiDefinition` seed records** for the surviving queries (query verbatim + `viz` from the landscape format spec + `rbac.visibleTo` ceiling, officer-PII flagged).
4. **Author localization** for titles/labels (§4c).
5. **Seed one `dss.DashboardPack`** = the supervisor default (from `DEFAULT_LAYOUT` + complaint-landscape section); author citizen/admin/public packs net-new (Part E).
6. **Flip the FE to thin renderer** (Part F): replace `BATCH_QUERIES`/landscape imports with catalog+pack fetch; keep formatters/parsers as the viz layer.
7. Validate on ovh-cloud-dev (bomet repro) before live; defs/packs are MDMS so they redeploy with the nightly develop pull.

**Gate:** none of this is real access control until Part A (trustworthy principal) lands — but the *extraction* (steps 1–4) is independent of A and can proceed now.

---

> **Note.** This inventory was read directly from the live FE config (file:line cited). It is the worklist, not the records themselves — the actual `dss.KpiDefinition`/`dss.DashboardPack` JSON is generated in step 3/5 once the §4e token reconciliation and §4a placeholder triage are decided.
