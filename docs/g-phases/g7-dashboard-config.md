# G7: Dashboard Configuration

> **Status**: DESIGN ONLY. No production-ready code or UI lands with this sub-doc.
> Implementation tracked on the draft PR linked in the roadmap. Stacked on the escalation
> foundation (PR #770) and the wiring-strategies doc (PR #B).

## Why

Per-tenant configurable dashboards (indicator selection, formula editing, threshold alerts).
Drives the operator + leadership analytics surface. Today the dashboard widget hardcodes
every formula (`Resolution Rate = Cases Resolved / Cases Received * 100`,
`% SLA Compliance = Cases within timeframe / Total cases * 100`, etc.), which means a
country deployment cannot swap a denominator without a frontend rebuild.

BRD §5.3 ("Dashboard Requirements") and BRD Appendix C ("Dashboard Formulas and Indicators")
enumerate ~15 indicators across the IGE and IGSAE dashboards. G7 lifts that list into
MDMS so operators can edit, deactivate, regroup, and (in a constrained way) re-formulate
the indicators they care about.

Cross-reference: `docs/crs-configurator-roadmap.md` Phase G7.

## Scope

**In:**
- A registry of indicators keyed by `(dashboard, code)`, with label, unit, grouping,
  access-level, display-order, and a constrained formula expression.
- Per-tenant per-dashboard layout (the row/column grid of indicator codes).
- Per-indicator threshold-alert rules (warn/critical levels) that drive a coloured
  badge on the dashboard and an OTEL `dashboard.threshold.breached` span.
- A constrained mini-DSL evaluator surface defined by this doc (the implementation lives
  in the dashboard service, tracked separately).
- A formula sandbox in the editor that evaluates against last-7d data so operators see
  what the indicator will compute *before* saving.

**Out (explicitly deferred):**
- Arbitrary SQL or arbitrary code-eval. The DSL is intentionally narrow (see below).
- User-defined indicators from scratch in v1 — only edits to the BRD-Appendix-C seed
  set, plus a small whitelisted list of derived indicators, are in scope. New indicator
  codes ship behind a future phase.
- Cross-dashboard composite indicators (a single tile showing IGE+IGSAE combined).
- Export to CSV/XLSX from the dashboard surface — separate follow-up.
- Custom charting library swap. The existing chart components stay.
- Realtime/streaming refresh. Indicators are computed on dashboard-render (with a short
  cache) and on threshold-evaluation cron tick.

## MDMS schemas

Schema codes reserved (stub committed at
`utilities/default-data-handler/src/main/resources/schema/CRS.G7.json` so the registration
does not need re-doing once the contract below is ratified):

### `CRS.DashboardIndicator`
```
{
  code: string,                  // unique within (dashboard)
  dashboard: "IGE"|"IGSAE"|"BOTH",
  group: "VOLUME"|"PERFORMANCE"|"OTHER"|"SPECIFIC",
  accessLevel: "OPERATIONAL"|"EXECUTIVE",
  label: string,
  formulaExpr: string,           // mini-DSL, see below
  unit: "count"|"pct"|"hours"|"days"|"rating",
  displayOrder: number,
  thresholds: { warn?: number, critical?: number, direction: "above"|"below" }?,
  active: boolean
}
```
- `x-unique`: `["dashboard", "code"]`
- `additionalProperties`: `false`

### `CRS.DashboardLayout`
Singleton per `(tenant, dashboard)`. uniqueIdentifier = `<dashboard>`.
```
{
  singletonKey: string,          // = dashboard value, enforces x-unique
  dashboard: "IGE"|"IGSAE",
  rows: [ { indicators: [ code, ... ] } ],
  updatedAt: number,
  updatedBy: string
}
```
- `x-unique`: `["singletonKey"]`
- `additionalProperties`: `false`

### Formula DSL (informal grammar)

```
expr     := term (('+'|'-') term)*
term     := factor (('*'|'/') factor)*
factor   := NUMBER | call | '(' expr ')'
call     := func '(' args? ')'
func     := 'count' | 'avg' | 'sum' | 'pct'
args     := pred (',' pred)*
pred     := IDENT '=' literal | IDENT 'in' '[' literal (',' literal)* ']'
literal  := STRING | NUMBER
```

Allowed `IDENT`s for `pred` come from a whitelist anchored to the PGR/CRS complaint
record (`state`, `category`, `subcategoryL1`, `path`, `withinSla`, `createdDateBucket`).
No subqueries, no joins, no arbitrary identifiers — the evaluator rejects everything
else with a parse error at save time.

### `CRS.SLAAuditLog` reuse

Dashboard config changes write through the existing `CRS.SLAAuditLog` (with
`schemaCode = "CRS.DashboardIndicator"` or `"CRS.DashboardLayout"`). No new audit log
table — extension only.

## Configurator routes + UI sketch

New routes under `/manage/crs-dashboards/...`:

- `/manage/crs-dashboards` — indicator list, filter by dashboard + group + access-level,
  inline activate/deactivate toggle.
- `/manage/crs-dashboards/:code/edit` — formula editor + threshold editor + sandbox.
- `/manage/crs-dashboards/:dashboard/layout` — drag-to-arrange layout editor.
- `/manage/crs-dashboards/import` — bulk import (BRD Appendix C XLSX shape).

Sidebar nav: under the existing **Analytics** group (which currently only contains the
SLA Matrix link). The configurator's sidebar registry takes one new entry.

Page anatomy for the indicator editor:

```
+-------------------------------------------------------------------+
|  CRS DASHBOARDS  >  Edit indicator: % SLA Compliance        [x]   |
+-------------------------------------------------------------------+
|  Dashboard: [IGE v]   Group: [PERFORMANCE v]   Access: [EXEC v]   |
|  Code: SLA_COMPLIANCE_PCT     Unit: [pct v]    Order: [3]         |
|  Label: [% SLA Compliance                                    ]    |
|                                                                   |
|  Formula:                                                         |
|  +-------------------------------------------------------------+  |
|  | count(withinSla=true) / count(*) * 100                      |  |
|  +-------------------------------------------------------------+  |
|  [ Validate ]    parse: OK    last-7d sample: 78.4 %              |
|                                                                   |
|  Thresholds:   warn [80]   critical [60]   direction [below v]    |
|                                                                   |
|  [ Save ]   [ Save & view dashboard ]   [ Cancel ]                |
+-------------------------------------------------------------------+
```

The layout editor is a single-page drag surface: a left rail listing
active indicators for the chosen dashboard, a centre grid showing the
current rows, and a right rail previewing how the dashboard will look.

## API endpoints touched

- `mdms-v2`: standard `/mdms-v2/v2/_create`, `/mdms-v2/v2/_update`, `/mdms-v2/v2/_search`
  against the two new schema codes. Same pattern PR #770 already uses for
  `CRS.CategorySLA`.
- `pgr-dashboard` (or its successor): one new endpoint to evaluate the formula DSL
  against tenant data and return the numeric result. Drafted as
  `POST /pgr-dashboard/indicators/_evaluate` taking `{ indicatorCode, tenantId,
  dateRange }` and returning `{ value, sampleSize, asOf }`. The Validate button in the
  editor calls this with the *unsaved* `formulaExpr` so the operator sees a number
  before committing.
- `pgr-dashboard` background cron evaluates threshold rules on the active layout once
  per N minutes and emits OTEL spans on breach. Cron interval is a tenant config.
- No new backend service.

## Dependencies on prior phases

**Hard prerequisites:**
- **G4 — Role Permission Matrix.** The `accessLevel` field on each indicator gates
  visibility (Operational vs Executive). Without G4's role-binding contract, the
  filtering at render time is hand-wavy. **Blocking.**
- **G6 — Territorial Hierarchy.** Geographic indicators (Territorial distribution,
  Ranking by ward, etc.) need the boundary tree to exist. **Blocking for the
  geo-indicators only; other indicators can ship without G6.**

**Soft prerequisites (already in place via earlier PRs):**
- PR #770 — gives us the audit log pattern (`CRS.SLAAuditLog`) which G7 reuses.
- PR #A — the workflow state-name MDMS (`CRS.WorkflowStateMapping`) — used by any
  indicator that predicates on `state=...` so the operator picks human state names,
  not raw PGR codes.
- PR #B — the wiring-strategies doc — referenced by indicators that depend on
  `path`/`category`/`subcategoryL1` (those become available once intake either
  carries the tuple or the ServiceDef extension is wired).

**What this phase blocks:**
- Any future "dashboard widget on the operator home page" work — the home widget
  reads the same indicator registry.
- The dashboard-export PR (CSV/XLSX) — needs the indicator registry to know what
  columns to export.

## Acceptance criteria

1. All BRD Appendix C indicators (Total Cases Received, Resolution Rate, Avg Resolution
   Time, Avg Screening Time, % SLA Compliance, % Outside SLA, Distribution by type,
   Distribution by category, Ranking of institutions, Territorial distribution,
   Citizen Satisfaction, Trends) load on a fresh tenant via the bulk-import XLSX.
2. Editing the `% SLA Compliance` formula in the editor and saving immediately changes
   the rendered dashboard number on the next refresh (no app restart).
3. The Validate button in the editor returns a numeric sample for a syntactically valid
   formula and a parse-error message for an invalid one, *without* writing to MDMS.
4. A user with role `LEADERSHIP` sees only Executive-tier indicators on the dashboard;
   a user with role `CASE_MANAGER` sees only Operational ones (per BRD §5.2 and G4).
5. Saving an invalid formula expression is rejected at the API layer (not just client-side)
   with a parse error referencing the offending token.
6. Setting `thresholds.critical = 60` on `% SLA Compliance` and dropping the live value
   below 60 produces (a) a red badge on the dashboard tile and (b) an OTEL span named
   `dashboard.threshold.breached` with attributes `{indicator, dashboard, value,
   threshold}`.
7. Drag-rearranging the layout and saving persists the new order; reloading the page
   shows the rearranged grid; the audit log records a layout-update event with
   before/after JSON snapshots.

## Estimated effort

**L (~1 week of focused work)**, possibly stretching toward **XL** if the formula DSL
evaluator surfaces edge cases. Breakdown:

- UI (list, editor, layout drag-surface, sandbox) — ~2 days.
- MDMS schema registration + audit-log wiring — ~0.5 day.
- Formula DSL parser + evaluator (shared with dashboard service) — ~2 days. **Largest
  unknown.**
- Threshold cron + OTEL spans + tests — ~1 day.
- Bulk-import (XLSX → MDMS rows) + reuse of the existing import dialog — ~0.5 day.
- Playwright coverage (edit formula → assert dashboard number changes) — ~1 day.

## Open questions

1. **DSL expressivity floor.** The grammar above admits arithmetic + four aggregation
   functions over a fixed identifier whitelist. Is that enough for every BRD Appendix C
   formula, or do we need (e.g.) date-bucket arithmetic, ratios across two predicate
   sets without a parenthesised divisor, or a `median()` aggregate? Spike before locking.
2. **Where does the evaluator live — pgr-dashboard or a new tiny service?** Co-locating
   in `pgr-dashboard` keeps the deployment footprint flat but couples G7 to that
   service's release cadence. A standalone `crs-indicator-eval` is cleaner but adds one
   more container to the stack.
3. **How are deactivated indicators handled in the layout?** Option A: layout silently
   skips inactive codes at render. Option B: the layout editor refuses to save a layout
   that references an inactive indicator. B is safer; A is friendlier mid-edit. Pick
   one and document.
4. **Threshold cron cadence — per tenant or platform-wide?** Tenant-configurable risks
   one tenant DoS-ing the evaluator with a 30s cadence. Platform-wide (e.g. 5min) is
   simpler but inflexible. Recommend platform-wide with a per-tenant override flag.
5. **Localisation of indicator labels.** BRD §5.3 expects Portuguese (Mozambique) and
   English. Do we add `label_ptMZ` + `label_en` columns to the schema directly (mirrors
   G8's approach for submission form fields) or piggyback on the platform localization
   service with a key convention like `CRS_DASHBOARD_INDICATOR_<code>`? The latter
   keeps the schema clean; the former keeps the editor self-contained.

## Cross-references

- **Discussion**: _(filled in once the linked GitHub Discussion is opened)_
- **Roadmap doc**: [`docs/crs-configurator-roadmap.md`](../crs-configurator-roadmap.md)
  Phase G7
- **Escalation design doc**: [`docs/escalation-feature-design.md`](../escalation-feature-design.md)
- **Wiring strategies doc**: [`docs/categorysla-wiring-strategies.md`](../categorysla-wiring-strategies.md)
- **PR #770** — escalation foundation; provides the audit-log + MDMS patterns G7 reuses.
- **PR #A** — state-name MDMS (`CRS.WorkflowStateMapping`); underpins state predicates
  in formulas.
- **PR #B** — wiring-strategies doc; defines how complaints become routable by
  `(path, category, subcategoryL1)` which several indicators slice on.
