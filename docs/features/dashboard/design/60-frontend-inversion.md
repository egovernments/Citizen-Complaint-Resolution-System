# RBAC + ABAC for PGR Analytics — Part F: Frontend Inversion (FE → BE)

**Status:** v2, 2026-06-23 (pass-1 findings folded) · **Part F** of the A–F series.
**Reads (precedence):** `00-requirements.md` (the shared spec), `dashboard-query-api-design.md` §5a ("authority moves to the backend" + the Today/Moves-to table), `rbac-kpi-access-implementation-plan.md` Phases 4–6.
**Grounding rule:** every claim about current FE behaviour is anchored to a `file:line` actually read under `CCRS/frontend/micro-ui/web/src/dashboard/`. Where a capability is *missing*, that is stated as missing with the anchor showing the gap.

> **Naming note.** The requirements doc (`00-requirements.md` §8) labels its Part F "Inline-query gating (Layer 3)". This document is the *Frontend Inversion* part as scoped by the workflow brief: turning the dashboard UI from an authoritative catalog-owner into a thin renderer. The two are complementary — inline gating (Layer 3) is the *server* contract that this FE inversion *consumes* (the FE stops sending inline bodies for citizen/supervisor roles). Wherever this doc says "Layer 3 / inline gating" it refers to the contract defined in requirements §3 and the design §5; this part owns only the *frontend* side of that contract.

---

## Part F — Frontend Inversion (FE → BE)

### Goal & responsibilities (what this part owns; what it explicitly does NOT)

**The inversion in one sentence.** Today the dashboard FE *is the catalog*: it hardcodes every KPI query body, hardcodes which tiles exist and which are shown, and computes/derives values client-side. Part F strips the FE down to a **thin renderer**: it fetches the catalog (`/catalog`) and the caller's dashboard pack from the backend, POSTs `{kpiId, params}` (never an inline query body for non-analyst roles), and renders the **viz-agnostic** response (`columns` + `rows`/`values` + `series`) into table / bar / line / map — with zero embedded knowledge of what the KPI computes.

**This part OWNS (frontend only):**

1. **Catalog/pack consumption.** Replace the hardcoded `BATCH_QUERIES` map (`config/kpiQueries.js:47-416`) and the hardcoded tile inventory (`config/*Landscape.js`, assembled in `config/supervisorMetrics.js:52-93`) with a runtime fetch of `/catalog` (Layer-2 filtered, Part D) and `/pack` (Part E). The FE renders only the tiles the backend returns.
2. **kpiId-by-reference invocation.** Change the request path in `services/analyticsService.js:84-89` and `hooks/useDashboardData.js:53` from "POST a dict of inline query bodies" to "POST `{kpiId, params}` per tile" (or a batch of `{kpiId, params}` references). Non-analyst surfaces send **no inline grammar** (honours the Layer-3 `inline_forbidden` contract, design §5 / requirements §3 Layer 3).
3. **Viz-agnostic rendering.** A generic renderer keyed off the response `columns[].role` (`dimension`/`measure`/`rank`) + `viz` block (from the def, design §3 `viz`), able to draw table↔bar↔line↔map from the same `rows`+`columns` without a re-query (design §6 "pure client re-render"). The current renderer is hardwired per widget id (`components/DashboardGrid.jsx:102-131`) and must become data-driven.
4. **Error-state & freshness surfacing.** Render per-tile error states from the batch `errors` map and `partial` flag (design §6/§11), and the `asOf`/`scope` badges from the response — never a silent zero for a failed tile (design §6, §11). The FE already plumbs `asOf` (`useDashboardData.js:20-24,69`); it must additionally honour `partial`/`errors` and render the `scope` badge.
5. **Dead-code retirement.** Identify and delete the FE code that becomes authority-bearing-but-now-redundant (the query bodies, the per-metric format/derive logic, the hardcoded inventory). Enumerated in *Current code reality* below.

**This part explicitly does NOT own:**

- **Access enforcement.** The FE may *hide* tiles for UX, but that is cosmetic. `visibleTo` discovery filtering and the invocation re-check are **Part D**'s job (server-side, design §5a Layer 2). Part F consumes the already-filtered catalog; it never decides visibility. (Design §5a: "access control on the FE *is not access control*.")
- **Row scope / attribute scope.** Injected `WHERE` is **Parts B/C** (`AnalyticsPlanner.applyScope()`). The FE never sends a scope predicate and never receives raw rows it must filter.
- **The pack/visibility data model.** `dss.KpiDefinition` (Part D) and `dss.DashboardPack` (Part E) MDMS schemas are defined by those parts. Part F only *reads* the `/catalog` and `/pack` HTTP responses.
- **Auth.** Trustworthy principal is **Part A**. Part F's invocation correctness *depends* on A but does not implement it. In particular the "stop sending client `userInfo`" hardening (F.1) only fails *closed* if Part A makes an absent/forged `userInfo` a `401` — see the named Part-A exit-gate in *Sequencing* step 1.
- **Layout personalization storage.** Pack layout is a server-supplied *default* (Part E); per-user reordering stays in user-preferences-service (requirements §5) — **with the caveat (cross-cutting README finding 6) that the preferences store keys on body `Preference.UserId` and is itself spoofable; Part E must bind it to the token uuid before the FE trusts it for personalization.** Part F keeps the *interaction* code (`useDashboardLayout.js`) but re-points its **seed** from the hardcoded `DEFAULT_LAYOUT` (`constants/layoutConfig.js:72-199`) to the pack-supplied layout.

---

### Current code reality (file:line — what exists today vs what's missing)

**1. KPI query bodies are hardcoded in the bundle — the thing that moves to MDMS.**
`config/kpiQueries.js:47-416` defines `BATCH_QUERIES`, a static dict of **52 top-level inline query bodies** (verified count over `kpiQueries.js:47-416`; e.g. `cl_reg_daily` L48, `rs_sla_compliance_week` L185-197, the `er_*` escalation ratios L228-340). These 52 are what migrate 1:1 to `dss.KpiDefinition`. Note the *tile* count the user sees is larger because 6 landscape configs fan each card out into selectable sub-metrics (see item 7 and Open-Q 6) — do not conflate the 52 bodies with the sub-metric count. Helper builders `filedWindow`/`resolvedWindow`/`openWindow`/`officerTopCount`/`channelRatio` (L10-45) assemble grain+window+measures+filters **in the client**. This is exactly design §5a's "Today: KPI query definitions hardcoded in the FE bundle (`kpiQueries.js`)" and requirements §1.1. Every one of these is an *inline* body — which the Layer-3 gate (design §5) will reject for citizen/supervisor tokens.

**2. The request actually sent today is an inline batch — incompatible with the inline gate.**
`services/analyticsService.js:84-89` `runBatchQueries(queries)` POSTs `{ tenantId, queries }` straight to `/_query`, where `queries` *is* `BATCH_QUERIES` (passed at `hooks/useDashboardData.js:53`). So the dashboard's only call path is the **inline grammar** — the one the requirements say citizen/supervisor tokens must be denied (requirements §3 Layer 3, error `inline_forbidden`). Under the new contract a supervisor dashboard built this way would get `403` on every tile. This is the single most load-bearing reason the inversion is a *correctness* requirement, not a nicety. **Cross-cutting caveat (README finding 5):** the server-side gate this depends on has a hole today — `AnalyticsService.query()`'s batch-dict arm (`AnalyticsService.java:42-46`) calls `runOne()` directly, bypassing the inline gate + kpiId re-check; Part D must arm *both* arms. The FE flip is necessary but not sufficient; it is safe only once D closes that arm.

**3. The tile inventory (what tiles exist + which a user sees) is hardcoded — moves to packs.**
- The full universe of tiles is assembled statically: `config/supervisorMetrics.js:52-59` concatenates `LANDSCAPE_METRICS`, `EMPLOYEE_PERFORMANCE_METRICS`, … into `KPI_METRICS`. Each landscape file hardcodes its tiles, e.g. `config/complaintLandscape.js:66-226` (`LANDSCAPE_METRICS`) and the chart widgets `:230-263` (`LANDSCAPE_CHARTS`).
- The default *shown* set is hardcoded in `constants/layoutConfig.js:72-199` (`DEFAULT_LAYOUT`).
- The "metric inventory" picker (`components/KpiInventory.jsx:16-26`) lists `INVENTORY_SECTIONS` and offers any metric **not currently on the grid** (`:23` `.filter((m) => !visibleKpiIds.includes(m.id))`). Crucially **`visibleKpiIds` is layout-presence, not access** (`hooks/useDashboardLayout.js:400`: `layout.filter(isKpiWidget).map(i)`). So the FE today lets *any* authenticated employee add *any* tile.
- **The FE today does NOT gate any tile by role.** (Corrected from v1's overstated "no role concept anywhere": the FE *does* read the principal's roles client-side for a cosmetic label — `components/Navbar.jsx:33` `user?.roles?.[0]?.name || user?.type` — and `user.roles` is already in `localStorage`. What is absent is any *access* use of that role: no tile, inventory entry, or query path is gated on it. The grep-confirmed `role` hits in the dir are exactly two: the ARIA `role="tooltip"` at `components/DepartmentBarChart.jsx:100` and the cosmetic navbar read at `Navbar.jsx:33`.) **Design consequence:** because `user.roles` is locally available, the inverted FE *may* use it for **UX-only** pre-hiding (e.g. not even rendering the inventory section a role will be denied) — but this is decoration over the server-filtered catalog (F.5), never a substitute for it; the catalog the server returns is the only ceiling. See risk #11.

**4. Value formatting / derivation is computed client-side — partially redundant under viz-agnostic responses.**
`config/kpiQueries.js:479-551` (`formatSubMetricValue`) re-implements percent/duration/signed formatting and *derives* metrics in the client: `dailyAvgFromWeekly` (L492-497), `hourlyAvgFromDaily` (L499-504), `openRateComplement` (L439-445/L506-508), `netBacklogDaily` (L447-454/L510-512). Several sub-metrics have `queryKey: null` and are computed purely client-side or stubbed `UNSUPPORTED_VALUE` (e.g. WoW/MoM deltas `complaintLandscape.js:39-52` → `formatPercentDelta()` returns `—` at `kpiQueries.js:435-437`). Under the new contract, **`format`/`unit` travel in `columns[]`** (design §6) and **derivations become server measures** (`compare`, `derivative:"lag"`, ratios — design §4), so most of this block is dead. The thin client keeps only generic presentational formatting driven by `columns[].format`.

**5. The renderer is hardwired per widget id — must become data-driven.**
`components/DashboardGrid.jsx:102-131` switches on literal widget ids (`"cl-chart-categories"`, `"cl-chart-wards"`, `"cl-chart-dow"`, `"cl-list-categories"`) and parses each result with a chart-specific parser (`parseBarChart`/`parseDowChart`/`parseRankedList`, `kpiQueries.js:575-601`) that hardcodes the dimension column name. The hardcoding is at two levels: `service_code`/`ward_code` are literal *call-site arguments* at `useDashboardData.js:64-65`, while `created_dow` is hardcoded one level **down inside `parseDowChart`** (`kpiQueries.js:586`), reached via `parseDowChart(results.cl_chart_dow)` at `useDashboardData.js:66`. A new KPI cannot render without an FE deploy — the inverse of design §3a's "no-deploy" promise. The viz type must instead come from the def's `viz` block and the dimension/measure from `columns[].role`.

**6. `fetchSchema()` exists but is never wired — the catalog hook is missing.**
`services/analyticsService.js:80-82` defines `fetchSchema()` (POST `/_schema`), but **no hook calls it** (grep: the only references are its definition). There is **no `/catalog` client, no `/pack` client, no `useCatalog` hook**. These are net-new. (Cross-cutting README mis-citation note for Part D: `/_schema` is unauthenticated and returns PII/officer columns past any def ceiling — so Part F must NOT repurpose `_schema` as its catalog; it must consume the new role-filtered `/catalog`, see Open-Q 2.)

**7. Sub-metric switchers fan one card into N selectable measures — a cardinality the inversion must resolve.**
A landscape "card" is not one query: `hooks/useSubMetricSelection.js:14-35` keeps a `{metricId → subMetricId}` selection (persisted to `localStorage`), and `config/kpiQueries.js:553-566` (`buildAllSubMetricValues`) emits a flat `metricId:subMetricId` value map consumed by `components/DashboardGrid.jsx:73-92` (`renderKpi`). So one tile renders a switcher over several sub-metrics, each with its own `queryKey`. Whether each sub-metric becomes its own `kpiId` or one `kpiId` carries a `params`-selectable sub-metric is **Open-Q 6**, and it decides the shape of F.3/F.4 — the sketches below are drawn for the recommended "one `kpiId` per sub-metric, grouped by a catalog `group` field" resolution and are **marked contingent** on that decision.

**8. Identity passed to the backend is the spoofable body `userInfo` — Part A territory, but the FE is the sender.**
`services/analyticsService.js:41-53` `buildRequestInfo()` reads `Employee.token` and `Employee.user-info` from `localStorage` and stuffs **both** into the request body (`authToken` L43 + `userInfo` L51). That populated `userInfo` is exactly what the Kong enrichment skips validating (requirements §1.2 / §7.1): `kong.yml:65-67` returns early when `ui["uuid"] or ui["id"] or ui["userName"]` is present. Part A fixes the trust; Part F must **stop sending a client-authored `userInfo`** (send the token only; let the gateway populate `userInfo` authoritatively) so the FE is not complicit in the spoof surface. **Fail-open caveat (README finding 2, see risk #1 below):** removing client `userInfo` forces every request through the *best-effort* enrichment HTTP call at `kong.yml:71` (`egov-user-proxy:8107/user/_details`), which on any failure **logs and `return`s leaving `userInfo` absent** (`kong.yml:75-78`). The FE flip is therefore gated on a *named Part-A precondition* (Sequencing step 1), not a generic "in lockstep with A."

**Summary table — Today vs Moves-to (grounded extension of design §5a):**

| Today (FE-authoritative) | file:line | Moves to (part) |
|---|---|---|
| `BATCH_QUERIES` inline bodies (52 entries) | `kpiQueries.js:47-416` | `dss.KpiDefinition` in MDMS, served by `/catalog` (Part D) |
| Inline `/_query` POST is the only call path | `analyticsService.js:84-89` | `{kpiId, params}` reference call; inline gated off for non-analysts (Part F sender; Layer 3 contract design §5; both `AnalyticsService.query()` arms armed, README finding 5 / Part D) |
| Hardcoded tile universe + sections | `supervisorMetrics.js:52-93`, `complaintLandscape.js:66-263` | `/catalog` (universe) + `dss.DashboardPack` `/pack` (per-role tiles) (Parts D/E) |
| Default shown tiles | `layoutConfig.js:72-199` `DEFAULT_LAYOUT` | pack `layout` default (Part E) + user-preferences personalization (token-bound, Part E) |
| "Which tiles a user can add" = layout presence, no role gate | `KpiInventory.jsx:23`, `useDashboardLayout.js:400` | server `visibleTo` discovery filter (Part D); FE hides for UX only |
| Sub-metric switcher (one card → N measures) | `useSubMetricSelection.js:14-35`, `kpiQueries.js:553-566`, `DashboardGrid.jsx:73-92` | one `kpiId` per sub-metric + catalog `group` (recommended, Open-Q 6 / Part D) |
| Client-side derive/format (`dailyAvgFromWeekly`, deltas, ratios) | `kpiQueries.js:435-551` | server measures (`compare`/`derivative`/`ratio`) + `columns[].format` (design §4/§6) |
| Hardwired per-id chart parsers | `DashboardGrid.jsx:102-131`, `kpiQueries.js:575-601` (`created_dow` at `:586`) | generic renderer keyed on `columns[].role` + def `viz` block |
| Cosmetic role label (UX only, not a gate) | `Navbar.jsx:33` | unchanged (UX); may seed UX-only pre-hiding over the server catalog |
| Sends client-authored `userInfo` | `analyticsService.js:41-53` (token L43, userInfo L51) | token-only; gateway populates `userInfo` (Part A) — gated on the L71 enrichment exit-gate |

---

### Design (data model, API/control flow — concrete sketches grounded in the real modules)

The FE is JS/React (esbuild micro-ui), so "data model" here is the **HTTP contracts it consumes** and the **client modules** that replace the dead config. No Java in this part.

#### F.1 — New service-layer clients (`services/analyticsService.js`)

Add two read clients and change the query client. The existing `postAnalytics` helper (`analyticsService.js:55-78`) is reused; only the body shape changes. (Transport verb: DIGIT convention is POST+RequestInfo even for reads — the existing `fetchSchema` uses POST at `analyticsService.js:80-82` — so `/catalog` and `/pack` are POST with the token in the RequestInfo body, *not* literal `GET`; the design §5a "GET" naming is logical, see Open-Q 1.)

```js
// services/analyticsService.js  (additions / change)

// (1) Catalog — Layer-2 filtered server-side (Part D). Returns only defs whose
//     rbac.visibleTo ∩ caller.roles ≠ ∅.  POST + RequestInfo per DIGIT convention.
export function fetchCatalog() {
  return postAnalytics("/catalog", { tenantId: getTenantId() });
  // → { kpis: [ { id, version, title, description, viz, params, freshness, group? } ] }
  //   NB: no `query` body and no `rbac` block are returned to the client — the FE
  //   never sees the frozen SQL-shaping body nor the ceiling; both stay server-side.
}

// (2) Pack — per-role default tile bundle + default layout (Part E).
export function fetchPack() {
  return postAnalytics("/pack", { tenantId: getTenantId() });
  // → { packs: [ { role, tiles: [kpiId…], layout: [...] } ] }  (server resolves caller roles → pack(s))
}

// (3) Query BY REFERENCE — replaces the inline runBatchQueries.
//     Each batch entry is a {kpiId, params} reference, NOT an inline body.
export function runKpiBatch(refs) {
  // refs: { tileKey: { kpiId, kpiVersion?, params } }
  return postAnalytics("/_query", { tenantId: getTenantId(), queries: refs });
}
```

Also harden `buildRequestInfo()` (`analyticsService.js:41-53`): **stop forwarding a client-authored `userInfo`** (the L51 stuff-in); send `authToken` only (L43) and let the gateway (Part A) populate `userInfo`. This removes the FE from the spoof surface (requirements §7.1).

```js
function buildRequestInfo() {
  const authToken = getEmployeeToken();
  return { apiId: "Rainmaker", ver: ".01", ts: Date.now(),
           action: "_search", msgId: `dashboard-${Date.now()}`,
           ...(authToken && { authToken }) };   // ← no userInfo
}
```

**Fail-closed contract for this flip.** Token-only is correct *only* once the gateway reliably resolves `userInfo` from the token and an unresolved token fails closed. Both depend on Part A (see Sequencing step 1); until then the flip is held behind the same feature flag as the renderer. The FE itself must additionally treat any analytics response that comes back with a `401`/`unauthenticated` as a hard error banner (not zero tiles silently), so a deployment where enrichment is down surfaces loudly rather than rendering an empty-but-green dashboard.

#### F.2 — New `useCatalog` hook (catalog + pack → renderable tile descriptors)

A net-new hook that fetches catalog+pack once and produces the tile list the grid and the inventory picker both read. It replaces the static imports in `KpiInventory.jsx:2` and `DashboardGrid.jsx:16-17`.

```js
// hooks/useCatalog.js  (NEW)
export function useCatalog() {
  const [state, setState] = useState({ loading: true, kpis: {}, pack: null, error: null });
  useEffect(() => {
    if (!hasAuth()) { setState({ loading:false, kpis:{}, pack:null, error: LOGIN_MESSAGE }); return; }
    Promise.all([fetchCatalog(), fetchPack()])
      .then(([cat, pk]) => {
        const kpis = Object.fromEntries((cat.kpis||[]).map(k => [k.id, k]));   // visibleTo already applied server-side
        const pack = (pk.packs||[])[0] || { tiles: Object.keys(kpis), layout: [] };
        // a tile referenced by the pack but absent from the catalog = out-of-ceiling → drop it (never a leak)
        const tiles = pack.tiles.filter(id => kpis[id]);
        setState({ loading:false, kpis, pack: { ...pack, tiles }, error:null });
      })
      .catch(err => setState({ loading:false, kpis:{}, pack:null, error: mapError(err) }));  // fail-closed: zero tiles
  }, []);
  return state;
}
```

Key property: the **catalog is the ceiling the FE knows about**. A pack tile not in the catalog is silently dropped (it would `403` at invocation anyway, design §5a "mis-authored pack → 403 on that tile, never a leak"). The FE never reconstructs a hidden KPI because it never receives its body. The error branch returns `{ kpis:{}, pack:null }` → zero tiles + banner; it must **never** fall back to the deleted local `BATCH_QUERIES`/`DEFAULT_LAYOUT` (risk #1).

#### F.3 — Rewire `useDashboardData` to invoke by reference

> **Contingent on Open-Q 6.** This sketch models **one `kpiId` per tile** returning one result, which is correct under the recommended "one `kpiId` per sub-metric, grouped by catalog `group`" resolution. If Part D instead keeps the in-card switcher as one `kpiId` with a `params`-selectable sub-metric, `refs` must carry the *selected* sub-metric param (from a `useSubMetricSelection`-equivalent) and the result is selected per-sub-metric in the renderer — the loop shape is the same but the param map is keyed by `{metricId, subMetricId}`. The two sketches differ only in where the sub-metric selector lives; both are buildable. Do not freeze this code until Open-Q 6 is answered by Part D.

`hooks/useDashboardData.js` changes from "send `BATCH_QUERIES`" to "send `{kpiId, params}` for each tile the pack/catalog gave us". The default params come from the catalog def's `params[*].default` (design §3); the FE may override only within `params[*].allowed` (e.g. a window picker). Out-of-`allowed` → server `422 param_not_allowed`; the FE renders that tile's error state.

```js
// hooks/useDashboardData.js  (reshaped)
const refs = Object.fromEntries(
  pack.tiles.map(id => [id, { kpiId: id, params: defaultParams(catalog.kpis[id]) }])
);
const resp = await runKpiBatch(refs);          // { results: {id: <grain-tagged result>}, partial, errors }
setResults(resp.results || {});
setErrors(resp.errors || {});                  // ← per-tile errors, NOT silent zero (design §6/§11)
setPartial(Boolean(resp.partial));
setAsOf(extractAsOf(resp.results));            // existing helper L20-24 still works
```

The current `parseBarChart`/`parseDowChart`/`parseRankedList` + the hardcoded column names (`service_code`/`ward_code` at `useDashboardData.js:64-65`, `created_dow` inside `parseDowChart` at `kpiQueries.js:586`) are **deleted**; parsing moves into the generic renderer (F.4) which reads `columns[]`.

#### F.4 — Generic, viz-agnostic renderer

> **Contingent on Open-Q 6** in the same way as F.3 — `KpiTile` below renders one result per tile; if a `kpiId` carries a `params`-selectable sub-metric, `KpiTile` additionally renders the sub-metric switcher and re-invokes (or selects a pre-fetched series) on change. Drawn here for the one-`kpiId`-per-sub-metric resolution.

A single `<KpiTile def={catalog.kpis[id]} result={results[id]} error={errors[id]} />` that:

1. Reads the **viz type** from `def.viz.default` / the user's chosen `def.viz.allowed` (design §3 `viz`) — *not* from a hardcoded widget id.
2. Reads `result.columns[]` to find the dimension(s) (`role:"dimension"`) and measure(s) (`role:"measure"`), and `result.series[]` for multi-series (design §6). No column name is hardcoded.
3. Switches table↔bar↔line↔map as a **pure client re-render of the same `rows`+`columns`** (design §6) — no re-query. Map additionally fetches polygons from boundary-service keyed on the dimension's boundary codes (design §6 "API returns codes, never geometry"); only a *different boundary level* needs a new query.
4. Applies presentational formatting from `columns[].format`/`unit` (design §6) via a small generic formatter (the survivor of the old `formatSubMetricValue` switch).
5. Renders the per-tile **error state** when `error[id]` is set, and the `scope`/`asOf` badges from the result.

```jsx
function pickViz(def, override) { return override ?? def.viz?.default ?? "table"; }
function dims(cols)    { return cols.filter(c => c.role === "dimension"); }
function measures(cols){ return cols.filter(c => c.role === "measure"); }

function KpiTile({ def, result, error, vizOverride }) {
  if (error)  return <TileError code={error.code} message={error.message} />;   // never a silent zero
  if (!result) return <TilePlaceholder message="Loading…" />;
  const viz = pickViz(def, vizOverride);
  const { columns = [], rows, value, values, series } = result;
  switch (viz) {
    case "scalar": return <Scalar value={value ?? Object.values(values||{})[0]} fmt={measures(columns)[0]} />;
    case "bar":
    case "line":
    case "area":   return <SeriesChart rows={rows} dim={dims(columns)[0]} series={series||measures(columns)} type={viz} />;
    case "map":    return <ChoroplethMap rows={rows} dim={dims(columns)[0]} measure={measures(columns)[0]} />;
    case "table":
    default:       return <DataTable columns={columns} rows={rows} />;
  }
}
```

This makes "add a KPI" a pure backend (`dss.KpiDefinition` + pack) operation with **zero FE deploy** — the design §3a promise, finally true end-to-end.

#### F.5 — Inventory picker becomes catalog-driven (and honest about access)

`KpiInventory.jsx` stops importing `INVENTORY_SECTIONS`/`KPI_METRICS` from static config and instead lists `catalog.kpis` (already `visibleTo`-filtered). The "available" set = catalog tiles not currently on the grid (the same UX as `KpiInventory.jsx:23`, but the *universe* is now the server-filtered catalog, so a user can never even see — let alone add — a tile the server would deny). Sections can come from a `def.group`/`def.section` field on the catalog entry (Part D may add it; same `group` field that resolves the sub-metric grouping in Open-Q 6) or a flat list. The locally-available `user.roles` (`Navbar.jsx:33`) may optionally drive *additional* UX-only pre-hiding, but only over the already-server-filtered catalog — it is decoration, never the ceiling (risk #11).

---

### Interfaces with other parts (inputs consumed, outputs produced — named contracts)

**Consumes (inputs):**

| From part | Contract | What the FE reads |
|---|---|---|
| **Part A — Trust foundation** | trustworthy principal from validated token; **absent/forged `userInfo` ⇒ `401` (coercive, fail-closed)** | The FE sends `authToken` only (no client `userInfo`); relies on A's gateway/filter to populate `RequestInfo.userInfo` authoritatively *and* to reject an unresolved token. Without A's coercion, the token-only flip fails **open** at `kong.yml:75-78` (best-effort enrichment, silent `return`). Part F's flip blocks on A's named exit-gate (Sequencing step 1). |
| **Parts B/C — Attribute scope** | injected row `WHERE` | The FE receives **already-scoped rows** and a `scope` badge (design §6 `scope.boundaryPrefixes`) to display. It never filters rows itself and never sends a scope predicate. (Cross-cutting: README findings 1/3/4/7 — citizen daily-grain leak, department silent-drops, missing narrowing param, `tenantStateLevel` drop — are all **B/C concerns the FE correctly disclaims**; Part F renders whatever scoped rows arrive and must not compensate client-side, see risk #4.) |
| **Part D — KPI catalog access (Layer 2)** | `/catalog` (visibleTo-filtered, role-filtered — NOT `_schema`) + invocation re-check on **both** `AnalyticsService.query()` arms (README finding 5) | The FE renders the catalog as-returned; the def's `viz`, `params`, `freshness`, `title`, `group?` drive the renderer. The FE does **not** receive each def's frozen `query` body or `rbac` ceiling. On invocation, a `kpiId` the caller can't see → `403 kpi_forbidden`, surfaced as a tile error. |
| **Part E — Dashboard packs + layout** | `/pack` (role→tiles + default layout); **token-bound** user-preferences (README finding 6) | The pack's `tiles[]` seed the grid; the pack's `layout` seeds `useDashboardLayout` (replacing `DEFAULT_LAYOUT`). Per-user reordering persists to user-preferences-service **only after Part E binds that store to the token uuid** (it currently keys on body `Preference.UserId`, spoofable) — until then layout personalization stays in `localStorage` (Open-Q 3). |
| **Layer-3 inline gating (design §5; requirements §3 Layer 3)** | `inline_forbidden` for non-analysts | The FE's non-analyst surfaces send **only** `{kpiId, params}` references, never inline `measures/dimensions/filters`. The analyst/admin "explore" surface (if built) is the *only* place inline grammar may be sent, and only by roles the server permits. |

**Produces (outputs):**

| Output | Consumed by | Contract |
|---|---|---|
| `{kpiId, params}` reference requests | Part D invocation path + Parts B/C planner | Each tile is a saved-KPI invocation with declared params within `allowed`. This is the request shape the whole RBAC stack is designed around (design §3 "Composition at call time"). |
| Per-user layout deltas | user-preferences-service (Part E boundary), once token-bound | Personalization is preference state, not config; the FE writes it there (or `localStorage` interim), not to the pack MDMS master. |
| Catalog/pack fetch volume | caching tier (design §8) | Catalog/pack are cacheable per-role; the FE fetching them once per session keeps the cost off `/_query`. |

**Contract names (for cross-referencing):** `CATALOG_RESPONSE` (Part D), `PACK_RESPONSE` (Part E), `KPI_REF_REQUEST` (`{kpiId, kpiVersion?, params}`, Part F↔D), `BATCH_RESULT` (design §6 `results`/`partial`/`errors`), `SCOPE_BADGE` (design §6 `scope`).

---

### Sequencing & migration steps

Part F sits **downstream of A and D/E** in the dependency graph (requirements §8: D→E; A blocks everything). It cannot land before A (or the dashboard breaks under the inline gate), and it cannot fetch a catalog before Part D serves one. Concretely:

1. **(Blocks on A — named exit-gate.)** Land Part A so the gateway populates `userInfo` **and** an unresolved/forged token fails closed (`401`). The *specific, named precondition the FE flip blocks on* is: **"the `kong.yml:71` enrichment call (`egov-user-proxy:8107/user/_details`) is proven to populate `RequestInfo.userInfo` for a real employee token end-to-end on bomet, AND an enrichment failure / absent `userInfo` returns `401`, not unscoped"** — because today that call is best-effort and `return`s silently on failure (`kong.yml:75-78`), so dropping client `userInfo` (F.1, removing `analyticsService.js:51`) before this gate would break login *or* fail open. This is a concrete Part-A deliverable, owned by Part A; Part F asserts it as a gate, does not implement it. Ship the FE token-only change **in lockstep with that gate**, behind the feature flag, with the `401`→banner behaviour of F.1 in place.
2. **(Blocks on D.)** Once `dss.KpiDefinition` + `/catalog` exist (Part D) **and both `AnalyticsService.query()` arms are armed (README finding 5)**, add `fetchCatalog()` and the `useCatalog` hook (F.1/F.2). **Migrate the 52 `BATCH_QUERIES` entries → MDMS defs** as the authoring step: each entry in `kpiQueries.js:47-416` becomes one `dss.KpiDefinition` (frozen `query` body + `viz` + `params` + `rbac.visibleTo`), run through the publish pipeline (design §3a). This is a config migration, not code — the bodies move verbatim, then get `visibleTo`/`viz` metadata. (Sub-metric fan-out is resolved per Open-Q 6 — likely >52 defs once each switcher sub-metric becomes its own `kpiId`.)
3. **(Parallel-safe.)** Build the generic renderer (F.4) behind a feature flag, rendering from `columns[]`. Keep the old hardcoded path live until the renderer reaches parity, then swap `DashboardGrid.jsx:94-134`.
4. **(Blocks on E.)** Add `fetchPack()` + re-seed `useDashboardLayout` from the pack layout (replacing `DEFAULT_LAYOUT` import, `layoutConfig.js:72-199`). Make `KpiInventory` catalog-driven (F.5). Layout personalization writes to `localStorage` until Part E binds the preferences store to the token uuid (README finding 6 / Open-Q 3).
5. **Reshape `useDashboardData`** to invoke by reference (F.3); delete the inline `runBatchQueries` body shape.
6. **Delete dead code** (below) once the renderer + catalog path are at parity and the feature flag is removed. Each deletion is a separate, reviewable commit so a regression can be bisected.

**Dead code to retire (explicit list):**

- `config/kpiQueries.js:47-416` — `BATCH_QUERIES` (52 entries) + builders `channelRatio`/`filedWindow`/`resolvedWindow`/`openWindow`/`officerTopCount` (L10-45) → MDMS defs.
- `config/kpiQueries.js:435-551` — client-side derive/format (`formatPercentDelta`, `formatOpenRateComplement`, `formatNetBacklogDaily`, `formatSubMetricValue`, the `derived:` branches) → server measures + `columns[].format` (keep only a generic `columns[].format` formatter).
- `config/kpiQueries.js:553-566` — `buildAllSubMetricValues` (the flat `metricId:subMetricId` value map) → per-`kpiId` results (resolution per Open-Q 6).
- `config/kpiQueries.js:575-601` — `parseBarChart`/`parseDowChart`/`parseRankedList` (incl. the `created_dow` literal at `:586`) → generic renderer reading `columns[]`.
- `hooks/useSubMetricSelection.js:14-35` — in-card sub-metric selection state → driven by catalog `group` + (if Open-Q 6 keeps a switcher) a `params`-selector, otherwise deleted.
- `config/*Landscape.js` + `config/supervisorMetrics.js:52-93` — the static `*_METRICS`/`INVENTORY_SECTIONS`/`*_CHARTS` tile catalog → `/catalog` + `/pack`.
- `constants/layoutConfig.js:72-199` — `DEFAULT_LAYOUT` → pack default layout (the WIDGETS-derivation L30-49 also re-derives from static config and must instead derive from the fetched catalog).
- `DashboardGrid.jsx:102-131` — per-id widget switch → data-driven `KpiTile`.
- `analyticsService.js:51` — the client-authored `userInfo` stuff-in (token-only flip, gated on Sequencing step 1).

**Survives (kept, lightly re-pointed):** `useDashboardLayout.js` interaction logic (drag/resize/pack/reflow) — re-seeded from pack layout; `KpiCard`/`DepartmentBarChart`/`RankedList`/`TrendLineChart` presentation components — reused by the generic renderer; `analyticsService.js` `postAnalytics` transport (L55-78) and `authToken` read (L43); the `asOf` plumbing (`useDashboardData.js:20-24`); `Navbar.jsx:33` cosmetic role label.

---

### Risks, edge cases, failure modes (fail-closed, leaks, drift, isolation)

1. **Token-only flip is fail-OPEN unless Part A coerces (the load-bearing dependency).** Removing client `userInfo` (F.1, `analyticsService.js:51`) forces every request through the best-effort enrichment at `kong.yml:71`; on a down/mis-wired `egov-user-proxy` that call `return`s silently leaving `userInfo` **absent** (`kong.yml:75-78`), and the early-return on a pre-populated `userInfo` (`kong.yml:65-67`) means today the dashboard works *because* the FE supplies it. So the flip is only safe behind the **named Part-A exit-gate** (Sequencing step 1): enrichment proven to populate `userInfo` for an employee token end-to-end on bomet AND absent `userInfo` → `401`. Until that gate, hold the flip behind the feature flag. FE-side mitigation: F.1 maps any `401`/`unauthenticated` response to a hard error banner, never silent zero tiles. **Owner of the fix: Part A** (Part F only asserts the gate).

2. **Fail-closed on catalog/pack fetch failure.** If `/catalog` or `/pack` errors, the FE must render **empty + an error banner**, never fall back to the deleted hardcoded `BATCH_QUERIES`/`DEFAULT_LAYOUT`. A "fallback to local config" would resurrect the exact FE-authoritative leak this part removes (a stale local def could show a tile the server would now deny). The `useCatalog` error branch (F.2) returns `{ kpis:{}, pack:null }` → zero tiles, banner shown. Requirements §6 "fail-closed."

3. **Pack/catalog drift = no-leak by construction.** A pack referencing an out-of-ceiling KPI is dropped client-side (F.2 `tiles.filter(id => kpis[id])`) *and* `403`s at invocation (Part D re-check, on **both** query arms per README finding 5). The FE must surface the `403` as a tile error (design §11), not hide it — hiding could mask a mis-authored pack. The security boundary is the invocation re-check; the client-side drop is UX only (design §5a).

4. **The inline-grammar trap (the big one).** If any tile slips through still sending an inline body (e.g. an un-migrated `BATCH_QUERIES` entry, or an analyst-only explore widget shown to a supervisor), the server returns `403 inline_forbidden` (design §5) — *provided Part D has armed the batch-dict arm* (`AnalyticsService.java:42-46`, README finding 5; the single-arm hole would let an inline body through). **Migration step 2 must be complete** and D's both-arms fix in place — a half-migrated dashboard mixing `{kpiId}` refs and inline bodies will partially `403`. Mitigation: a build-time assertion that the FE never constructs an inline body on non-analyst surfaces; a negative test that a supervisor token POSTing the dashboard's requests gets zero `inline_forbidden`.

5. **Tenant/jurisdiction/department isolation is server-side — the FE must not "help".** The FE today derives `tenantId` from `globalConfigs` (`analyticsService.js:29-35`); under the new contract the body `tenantId` is **cross-checked against the principal** server-side (design §5). The FE must not attempt to "fix up" scope client-side (e.g. filtering rows by ward) — rows arrive pre-scoped (Parts B/C). Any client-side row filtering would be a *false* sense of isolation and could leak in the inverse direction (showing a count computed over more rows than displayed). The renderer renders rows verbatim. **This is the FE's correct disclaimer of the cross-cutting B/C findings (README 1/3/4/7): the citizen daily-grain leak, department silent-drops, missing narrow param, and `tenantStateLevel` drop are all fixed in B/C, not compensated for in the renderer.**

6. **PII / officer-dimension tiles.** Officer-leaderboard tiles (`ep_leaderboard_closed` `kpiQueries.js:149-157`, `officerTopCount` tiles) return `current_assignee_uuid`/`assignee_uuid` as codes; names decrypt **at the edge for bounded top-N only** (design §6 Example 5, §13). The generic renderer must treat a `pii`/uuid dimension as a code unless the response explicitly carries a decrypted label — it must **never** call a decrypt endpoint itself for arbitrary rows. A citizen-visible KPI must never carry an officer dimension (Part D publish gate §3a step 4); the FE trusts that gate and does not re-check, but also must not *render* a uuid as if it were a name. (Verified live officer-PII path: the escalation tile `er_critical_by_officer` (`kpiQueries.js:314`) is built via `officerTopCount` (`kpiQueries.js:37-45`), which projects the dimension `current_assignee_uuid` (an officer UUID). So at least one `er_*` tile **does** project an officer dimension and is delivered to the client on every dashboard load — a real Layer-2 officer-PII concern, not a non-leak. The FE inversion must route this tile through `visibleTo` / the officer-dimension approval gate exactly like the leaderboard tiles, not treat it as exempt.)

7. **`asOf`/freshness honesty.** The FE already shows `asOf` (`useDashboardData.js:69`). It must show the **per-grain** `asOf` for batch results spanning grains (design §6 `asOfByGrain`) so a daily-grain tile isn't mislabelled with an hourly `asOf`. A missing `asOf` → "as of —", not a fabricated `now()`. This is a genuine net-new behaviour (the current single-`asOf` plumbing is per-batch, not per-grain), not a refactor.

8. **Partial-batch silent-zero regression.** The current code throws on a non-object response (`useDashboardData.js:56-58`) but does **not** handle `partial`/`errors` — a failed sub-query today surfaces as a missing key → `UNSUPPORTED_VALUE` (`—`), indistinguishable from "no data". The new renderer must distinguish **error** (red tile, from `errors[id]`) from **empty** (no rows) from **loading** (design §11 "never rendered as empty or zero"). This is a behavioural upgrade, not just a refactor.

9. **HRMS role pollution affects what packs/catalog return — but that's Parts D/E.** The FE renders whatever the (polluted-role-aware) backend returns. The risk for Part F is only that **testing** the inverted FE against a real polluted account (e.g. a GRO who also holds `PGR_LME`) shows more tiles than a clean GRO would. Test the FE against clean single-role `RBAC_TEST_*` users (requirements §7.2) so a "too many tiles" bug is attributed to the right layer.

10. **Cache-key correctness is server-side, but FE param choices feed it.** Resolved scope is part of the cache key (design §8); the FE's `params` (window/timeRole/boundaryScope) also key the cache. A FE that sends inconsistent param casing/ordering could miss cache. Normalize params client-side (stable key order) before sending.

11. **UX-only role pre-hiding must not become a phantom gate.** Because `user.roles` is locally available (`Navbar.jsx:33`, `localStorage`), it is tempting to pre-filter the inventory/catalog by role client-side. That is allowed *only* as decoration over the already-server-filtered catalog (F.5) — the server `/catalog` is the sole ceiling. A future contributor must never read `user.roles` and *decide* what to fetch or render as if it were authoritative; a lint/comment guard on `KpiInventory`/`useCatalog` should document that `user.roles` is cosmetic.

12. **Boundary geometry fetch (map viz) is a separate trust surface.** The choropleth fetches polygons from boundary-service keyed on returned codes (design §6). Those codes are already row-scoped, so the FE can only ever request geometry for boundaries it was shown — no widening. But the FE must request geometry **only** for codes present in `rows`, never enumerate the hierarchy, to avoid revealing the existence of out-of-scope boundaries.

---

### Open questions for review

1. **Catalog transport verb.** DIGIT convention is `POST … {RequestInfo}` even for reads (the existing `fetchSchema` uses POST, `analyticsService.js:80-82`). The design names these `GET /catalog` / `GET /pack` (design §5a). **Resolved in this revision toward POST+RequestInfo** (F.1) to keep auth uniform with the rest of the stack (Part A acts on POST bodies per `kong.yml:56-58`); confirm Part D/E publish them as POST endpoints, not literal `GET`.

2. **Does the catalog response include `query` bodies?** This part assumes **no** — the FE never receives the frozen SQL-shaping body (only `viz`/`params`/`title`/`freshness`/`group?`), so it cannot reconstruct a hidden query. Confirm Part D strips `query` and `rbac` from `/catalog` output, and that `/catalog` is a **new role-filtered endpoint, not `_schema`** (which README flags as unauthenticated + PII-leaking). If the body *is* returned (e.g. for an analyst editor), it must be gated to analyst/admin roles only.

3. **Pack layout vs user-preferences split — gated on the store's identity binding.** Requirements §5 puts personalization in user-preferences-service, but README finding 6 shows that store keys on body `Preference.UserId` (spoofable). So personalization can be delegated there **only after Part E binds it to the token uuid**. Interim: the pack layout is the *seed* and `localStorage` (current behaviour, `useDashboardLayout.js:299-301`) the override — acceptable for v1; the tenant-scoped key already exists (`dashboardConfig.js:46-48`). Confirm Part E's binding timeline so the FE knows when to switch the personalization sink.

4. **Analyst "explore" surface.** Is there a planned analyst/admin ad-hoc surface that *does* send inline grammar (the only Layer-3-permitted path)? If yes, it is a separate component with its own role gate; if no, the inline `/_query` body shape can be deleted from the FE entirely. This affects whether `runKpiBatch` is the *only* query client.

5. **Migration parity check.** Should we add an automated parity test that, for each migrated `dss.KpiDefinition`, the `{kpiId, defaultParams}` invocation returns the same value the old `BATCH_QUERIES` entry did (against a fixed dataset on ovh-cloud-dev)? This would catch a body-translation error during the 52-body migration (more once sub-metrics fan out) before the hardcoded path is deleted.

6. **Tile→KPI cardinality (gates F.3/F.4 shape).** Today some tiles are *sub-metric switchers* (one card, N selectable sub-metrics each with its own `queryKey`, e.g. channel-mix `complaintLandscape.js:88-127`; selection state in `useSubMetricSelection.js:14-35`, value map in `kpiQueries.js:553-566`, render in `DashboardGrid.jsx:73-92`). Does each sub-metric become its own `kpiId`, or does one `kpiId` carry a `params`-selectable sub-metric? The former is simpler and maps cleanly to `{kpiId, params}` (and is what F.3/F.4 are drawn for); the latter preserves the in-card switcher UX. **Recommend: one `kpiId` per sub-metric, with the card grouping driven by a catalog `group` field** — but this is **Part D's def-shape decision** and the F.3/F.4 sketches are explicitly marked contingent on it. Owner of the resolution: Part D.

## v2 revision log (pass-1 findings → resolution)

- **nit→minor — "no role concept anywhere" is false (`Navbar.jsx:33`).** v1 claimed (via "confirmed by grep") that the only `role` hit was the ARIA `role="tooltip"`. **Resolved:** *Current code reality* item 3 is rewritten to state the FE does NOT *gate* any tile by role, while acknowledging it reads `user?.roles?.[0]?.name` cosmetically at `components/Navbar.jsx:33` (verified — grep returns exactly two hits: `DepartmentBarChart.jsx:100` ARIA + `Navbar.jsx:33`). Added design consequence (UX-only pre-hiding) and new risk #11 guarding against `user.roles` becoming a phantom gate; summary table now carries the `Navbar.jsx:33` row.

- **nit — "~70 inline query bodies" overcounts.** **Resolved (count further corrected in v3, see below):** corrected to **52 top-level entries** throughout (item 1, summary table, dead-code list, Sequencing step 2, Open-Q 5), verified by counting `BATCH_QUERIES` keys over `config/kpiQueries.js:47-416` (= 52). Added explicit note that the larger *tile* count comes from sub-metric fan-out, not from the body count.

- **nit — `created_dow` not hardcoded at `useDashboardData.js:64-67`.** **Resolved:** item 5 and F.3 now state precisely that `service_code`/`ward_code` are literal call-site args at `useDashboardData.js:64-65`, while `created_dow` is hardcoded one level down inside `parseDowChart` at `config/kpiQueries.js:586` (reached via `:66`). Dead-code list and summary table updated with the corrected anchor.

- **major (fail-open risk) — token-only flip depends on the unproven Kong L71 enrichment.** **Resolved within this part as a named gate (fix owned by Part A).** Item 8, the Part-A interface row, Sequencing step 1, F.1's "Fail-closed contract", and new risk #1 now make the precondition concrete: "the `kong.yml:71` enrichment (`egov-user-proxy:8107/user/_details`) is proven to populate `userInfo` for an employee token end-to-end on bomet AND an absent/forged `userInfo` returns `401`" — anchored to the best-effort silent-return at `kong.yml:75-78` and the early-return at `kong.yml:65-67` (both verified verbatim). The flip is held behind the feature flag until that gate; F.1 maps `401`→hard banner so a down enrichment surfaces loudly. Not fixable inside Part F (gateway coercion is Part A's deliverable); Part F asserts it as a blocking gate.

- **minor (internal tension) — F.3/F.4 presuppose unresolved Open-Q 6 (sub-metric cardinality).** **Resolved:** added *Current code reality* item 7 grounding the switcher (`hooks/useSubMetricSelection.js:14-35`, `config/kpiQueries.js:553-566`, `components/DashboardGrid.jsx:73-92`, all verified); F.3 and F.4 now carry explicit **"Contingent on Open-Q 6"** banners describing both the one-`kpiId`-per-sub-metric (drawn) and one-`kpiId`-with-params resolutions; Open-Q 6 expanded with the grounding anchors and reassigned to **Part D** as the def-shape owner; summary table + dead-code list gained the sub-metric rows.

- **nit (confirming a non-leak) — events-grain tiles are not an FE leak.** **Partially superseded in v3 (see below): the escalation-tile non-leak claim was FALSE.** Risk #6 and the Parts B/C interface row record that the events-grain `department_code` gap and the uuid PII dims are B/C/D concerns Part F correctly disclaims. The original claim that current `er_*` tiles project no officer dims is **incorrect** — `er_critical_by_officer` (`kpiQueries.js:314`) projects `current_assignee_uuid` via `officerTopCount` (`kpiQueries.js:37-45`), so there *is* a live FE officer-PII path that must go through `visibleTo` / the officer-dimension gate. Folded the cross-cutting README findings 1/3/4/7 into risk #5 as the FE's explicit disclaimer.

- **interface check — batch-arm bypass (README finding 5).** **Folded in as a dependency Part F asserts (fix owned by Part D).** Item 2, the Part-D interface row, risks #3/#4, and Sequencing step 2 now state that the FE inversion is safe only once **both** `AnalyticsService.query()` arms (`AnalyticsService.java:42-46`) are armed for the inline gate + kpiId re-check. Not fixable in Part F.

- **interface check — user-preferences spoofability (README finding 6).** **Folded in as a gating caveat (fix owned by Part E).** The "does NOT own" personalization bullet, the Part-E interface row, Sequencing step 4, and Open-Q 3 now state personalization may be delegated to user-preferences-service **only after Part E binds it to the token uuid**; until then layout personalization stays in `localStorage`. Not fixable in Part F.

- **interface check — `_schema` is unauthenticated/PII-leaking (README D mis-citation).** **Resolved:** item 6, Open-Q 2, and the Part-D interface row now explicitly require `/catalog` to be a **new role-filtered endpoint, NOT a repurpose of `_schema`**.

- **Open-Q 1 (transport verb) resolved toward POST+RequestInfo** in this revision (F.1 + Open-Q 1 note), keeping auth uniform per `kong.yml:56-58`; left open only as "confirm Part D/E publish as POST."

All five severity-tagged findings (1 major, 2 minor, plus the two nit mis-citations and the confirming nit) plus the four cross-cutting interface findings touching Part F are addressed: the three in-part rigor/tension defects (Navbar, count, dow-anchor, Open-Q-6 tension) are fixed directly; the four cross-part risks (Kong fail-open, batch-arm bypass, prefs spoofability, `_schema` PII) are folded in as named gates with the owning part identified.

### v3 corrections (pass-3 codex fact-check, 2026-06-23)

External codex fact-check caught two genuine factual errors in the v2 log, both verified against code and corrected throughout:

- **`BATCH_QUERIES` count was wrong (48 → 52).** A brace-depth-aware count of top-level keys in `BATCH_QUERIES` returns **52**, not 48 (`kpiQueries.js:47` opens the object; keys run `cl_reg_daily` at `:48` through `ce_tfr_median` at `:411`, closing at `:416`). Corrected in item 1, the summary table, the dead-code list, Sequencing step 2, the parity-check Open-Q, and the v2 log entry.
- **The escalation "non-leak" claim was false.** The v2 log claimed current `er_*` tiles project no officer dimensions. In fact `er_critical_by_officer` (`kpiQueries.js:314`) is built via `officerTopCount` (`kpiQueries.js:37-45`), which projects the dimension `current_assignee_uuid` (an officer UUID) and is delivered to the client on every dashboard load (`useDashboardData.js:53` posts all `BATCH_QUERIES`). This is a **real Layer-2 officer-PII path**, not a non-leak: the FE inversion must route this tile through `visibleTo` / the officer-dimension approval gate. Corrected in risk #6 and the v2 log entry.

## Codex review (pass 2 — gpt-5.5, verdict: needs-rework)

> External adversarial review via `codex exec`, read-only, verifying the v2 revision log against the actual code. **Note:** codex evaluated "resolved" as "patched in code"; this is a *design* doc (no code changed yet), so most `actuallyResolved:false` items mean "design specifies it, code not yet written," not "design wrong." Read the findings for genuine design errors vs. implementation-status notes.


**Summary:** Several v2 log items are accurately grounded, but the count fix is wrong, the claimed escalation non-leak is false, and the actual backend still has the auth, inline-batch, schema, and scope fail-open holes the design depends on other parts to fix.


### Resolution check (4/10 confirmed in code)

- ✅ **"no role concept anywhere" is false because Navbar reads roles.** — Corrected: dashboard role hits are cosmetic Navbar role read and ARIA tooltip; no tile/query access gate uses roles.
- ❌ **"~70 inline query bodies" overcounts.** — The revised 48 count is still wrong. Actual top-level BATCH_QUERIES keys over kpiQueries.js:47-416 are 52.
- ✅ **created_dow anchor was wrong.** — Corrected: useDashboardData.js:64-65 passes service_code/ward_code; parseDowChart hardcodes created_dow at kpiQueries.js:583-588.
- ❌ **Token-only flip depends on unproven Kong enrichment and can fail open.** — Design now names the Part-A gate, but actual code still sends client userInfo and Kong still returns early/silently; code hole remains.
- ✅ **F.3/F.4 presuppose unresolved sub-metric cardinality.** — Design now marks F.3/F.4 contingent and grounds current switcher code at useSubMetricSelection.js:14-35 and DashboardGrid.jsx:73-92.
- ❌ **Events-grain tiles are not an FE leak / current er_* tiles project no officer dims.** — False against code: er_critical_by_officer uses officerTopCount, which projects current_assignee_uuid.
- ❌ **Batch-arm bypass needs to be folded in.** — Design mentions it, but actual AnalyticsService batch arm still sends each query directly to runOne with no inline gate or kpiId re-check.
- ✅ **User-preferences spoofability needs a Part-E caveat.** — Consistent with current FE: layout persistence remains localStorage only at useDashboardLayout.js:299-300 pending Part E.
- ❌ **_schema is unauthenticated/PII-leaking and must not be catalog.** — Design warns about this, but actual backend still exposes unauthenticated _schema and no /catalog endpoint exists.
- ❌ **Open-Q 1 transport verb resolved toward POST+RequestInfo.** — POST convention is consistent with Kong, but actual analytics package only maps /_query and /_schema; no /catalog or /pack implementation exists.

### Findings

- **[BLOCKER] Identity spoofing remains fully exploitable in actual code** — Part F now treats this as a gate, but the actual path is still fail-open: the FE sends localStorage userInfo, Kong skips enrichment/validation when userInfo is present, the controller converts body RequestInfo directly, and scope trusts type/roles from that body.  
  _evidence:_ `analyticsService.js:41-52 reads Employee.user-info and includes userInfo; kong.yml:65-67 returns early for populated userInfo; AnalyticsController.java:43-47 passes body RequestInfo to service; AnalyticsScope.java:34-44 derives citizen/employee posture from that userInfo.`
- **[MAJOR] Revised 48-query count is wrong; actual BATCH_QUERIES has 52 entries** — The v2 log claims 48 top-level inline bodies, but counting the top-level keys inside BATCH_QUERIES gives 52. Migration sizing and parity-test claims based on 48 are undercounted.  
  _evidence:_ `CCRS/frontend/micro-ui/web/src/dashboard/config/kpiQueries.js:47 opens BATCH_QUERIES; top-level keys run from cl_reg_daily at :48 through ce_tfr_median at :411-414, closing at :416. A top-level key scan over :48-416 returns 52.`
- **[MAJOR] Claimed escalation non-leak is false: an er_* tile returns officer UUIDs** — The revision log says current er_* tiles project no officer dims. In fact er_critical_by_officer is wired to a helper that dimensions by current_assignee_uuid, and useDashboardData sends the full batch for every dashboard load. Even if the card displays only total, the UUID-bearing rows are delivered to the client.  
  _evidence:_ `kpiQueries.js:37-42 defines officerTopCount with dimensions ["current_assignee_uuid"]; kpiQueries.js:314 defines er_critical_by_officer with that helper; escalationsRiskLandscape.js:168-175 exposes that queryKey as an escalation submetric; useDashboardData.js:53 posts all BATCH_QUERIES.`
- **[MAJOR] No kpiId, inline_forbidden, catalog, or pack API exists in the analytics package** — The proposed Part-F interfaces depend on Part D/E code that is absent. Current /_query accepts inline single or batch grammar only, and there are no symbols for KpiDefinition, DashboardPack, kpiId, inline_forbidden, kpi_forbidden, /catalog, or /pack in the relevant backend/frontend paths.  
  _evidence:_ `AnalyticsController.java:40-59 maps only POST /_query and /_schema; AnalyticsService.java:38-51 handles only body.queries inline dict or body.query inline node; rg for KpiDefinition|DashboardPack|/catalog|/pack|kpiId|inline_forbidden|kpi_forbidden finds no implementation in the analytics package/dashboard except local variable names.`
- **[MAJOR] Batch-arm bypass is still real and returns errors inline, not an errors map** — The design's BATCH_RESULT contract expects errors[id], but current code catches per-query exceptions and stores error objects inside results[name]. Existing FE then treats missing rows as unsupported values, so partial failures can remain silent per tile.  
  _evidence:_ `AnalyticsService.java:38-49 iterates body.queries and on catch does results.put(name, err(ex)) plus partial=true; err shape is {error,message} at :118-123. useDashboardData.js:62-68 parses chart/results without errors map; kpiQueries.js:516-517 returns UNSUPPORTED_VALUE when rows are absent.`
- **[MAJOR] _schema remains unauthenticated and exposes PII-adjacent columns** — The design correctly says not to reuse _schema as catalog, but actual code still serves it without RequestInfo and includes UUID/account dimensions and distinctable columns. This is an existing discovery leak until Part D replaces or gates it.  
  _evidence:_ `AnalyticsController.java:57-59 returns service.schema() with no RequestInfo/auth; AnalyticsService.java:71-92 returns dimensions/filterable/measurable/distinctable; AnalyticsCatalog.java:58-77 exposes current_assignee_uuid/account_id on facts and :84-95 exposes assignee_uuid/actor_uuid/account_id on events.`
- **[MAJOR] Row scope is fail-open for missing principals, jurisdiction, and daily citizen scope** — Requirements demand fail-closed, but current scope defaults to tenant-only when userInfo is absent, never resolves boundaryPrefix for employees, and skips citizen self-scope on grains without a citizenColumn. This can leak jurisdiction or daily-grain data if the frontend flip lands before B/C.  
  _evidence:_ `AnalyticsScope.java:34-47 leaves citizenUuid null for absent/non-citizen userInfo and always returns boundaryPrefix null; AnalyticsPlanner.java:246 only applies citizen scope when g.citizenColumn != null; AnalyticsCatalog.java:99-108 defines daily with citizenColumn null.`
- **[MINOR] Current asOf plumbing does not match the backend batch response** — The design says asOf is already plumbed, but current backend puts asOf at the top level of the batch response while the FE extracts asOf from individual result entries after replacing response with response.results. Navbar therefore gets null for normal batch responses.  
  _evidence:_ `AnalyticsService.java:34-49 sets out.asOf then out.results; useDashboardData.js:53-54 assigns results=response.results; extractAsOf scans result entries at useDashboardData.js:20-24 and setAsOf(extractAsOf(results)) at :69.`

### Mis-citations

- v2 log: "BATCH_QUERIES ... (= 48)" is false; actual top-level count over CCRS/frontend/micro-ui/web/src/dashboard/config/kpiQueries.js:47-416 is 52.
- v2 log/risk #6: "current er_* tiles project no officer dims" is false; er_critical_by_officer projects current_assignee_uuid via kpiQueries.js:37-42 and :314.
- Current code reality item 4 says WoW/MoM deltas in complaintLandscape.js:39-52; those lines define shared COUNT_WINDOWS, not only deltas. The delta-specific null queryKey is applied through countSubMetrics at complaintLandscape.js:55-62.
- The design's "already plumbs asOf" citation is line-accurate but behaviorally misleading with the actual backend response shape: AnalyticsService.java:35 top-level asOf is discarded by useDashboardData.js:54 before extractAsOf.

### Gaps

- No implemented /catalog or /pack endpoint in the analytics package; Part F cannot be integrated until Part D/E add them.
- No implemented saved-KPI invocation shape; current /_query values are inline query bodies, not {kpiId, params}.
- No frontend useCatalog hook, catalog-driven inventory, generic columns[].role renderer, per-tile errors map, or scope badge path exists yet.
- No code-level feature flag is shown for the token-only flip; landing analyticsService.js:51 removal before Part A would break or fail open.
- No automated parity/count check exists for migrating BATCH_QUERIES, which matters because the revised design already undercounted the bodies.
