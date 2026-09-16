# Part 66 — Viz Schema & Wide-Migration API Contract

**Status:** v1, 2026-06-25. Defines the concrete HTTP API surface and the `viz` JSON schema that enable the "wide migration" direction: **the FE receives the full visualization schema AND token-scoped data FROM the BE; only tile size, ordering, and KPI visibility (hide/show) stay FE-side.**

**Reads:** `65-fe-config-inventory.md` (the 52-query worklist), `60-frontend-inversion.md` Part F (the renderer design), `40-kpi-catalog-governance.md` Part D (def lifecycle), `50-packs-config-ownership.md` Part E (packs/layout).

**Grounding:** the `viz` schema is derived by reading the actual landscape files (`config/complaintLandscape.js:66–263`, `config/supervisorMetrics.js`, and the 5 sibling `*Landscape.js` files) and the format dispatcher `formatSubMetricValue` (`config/kpiQueries.js:479–551`). Every format code, chart type, valueKey, and compose rule below was found there.

---

## The migration line — what stays FE vs what moves

The guiding rule is: **declarative knowledge (config) moves BE-side; imperative code (interpreter) stays FE-side; transient personal state (size/order/visibility) stays local.**

| FE-side | BE-side |
|---|---|
| Render engine (`formatSubMetricValue`, `parseBarChart`, compose dispatcher) | **Viz spec** (`format`, `chart`, `valueKey`, `variants[]`, `compose`, `accent`, `group`, `titleKey`) |
| Grid interaction (drag, resize, reflow) | Default grid layout (`dss.DashboardPack.layout`) |
| Transient UI state (hover, active tab, drill) | KPI definitions and query bodies |
| Personal layout delta: tile `hidden`, `{x,y,w,h}` overrides | Row-scoped data (server injects `WHERE` from token) |
| `asOf` display | `asOf` value (server-stamped on each result) |
| Elapsed-time evaluation in compose (`asOf → daysElapsed`) | `elapsedFromAsOf: true` directive (says to derive elapsed from asOf, not `Date.now()`) |

**Nothing else stays FE.** No format codes, no chart type assignments, no sub-metric selector labels, no accent colors, no section groupings, no compose arithmetic rules are hardcoded in JS. The FE is a typed interpreter with no domain knowledge of its own.

---

## 1. The `viz` JSON schema

Each `dss.KpiDefinition` carries a `viz` object. This is what the catalog endpoint returns to the FE for every tile. The FE renders solely from this; it never falls back to a hardcoded format.

```jsonc
{
  // ─── Required ───────────────────────────────────────────────────────────
  "kind": "scalar" | "bar" | "rankedList" | "line" | "map" | "dow",
  // ^ "dow" = day-of-week radar/bar; "scalar" = a single formatted number

  "format": "integer" | "percentInteger" | "percentOneDecimal" | "percentNoDecimal"
          | "decimalOne" | "decimalTwo"
          | "hoursDays" | "hoursDecimal"
          | "ordinal" | "signedInteger",
  // ^ matches the 8 branches of formatSubMetricValue (kpiQueries.js:479–551);
  //   for non-scalar kinds this is the format of the primary measure column

  "valueKey": "total" | "pct" | "avg_ms" | "median_ms" | "avg" | "rank" | "count",
  // ^ which key in the result row the renderer shows as the headline number

  // ─── Presentation ────────────────────────────────────────────────────────
  "accent": "teal" | "amber" | "green" | "slate" | "red" | "blue" | "orange",
  // ^ card background accent; replaces hardcoded `accent` in *Landscape.js

  "titleKey": "<localization_module>.<UPPER_SNAKE_KEY>",
  // ^ localization key, NOT a raw English string; resolved at the edge
  //   example: "CMS-DASHBOARD.DASHBOARD_KPI_TITLE_OPEN_COMPLAINTS"

  // ─── Grouping / picker ───────────────────────────────────────────────────
  "group": "<string>",
  // ^ groups sub-metric variants together in the card picker and
  //   in the inventory section list; replaces INVENTORY_SECTIONS grouping
  //   example: "complaint-landscape", "employee-performance"

  // ─── Sub-metric variants (optional) ─────────────────────────────────────
  "variants": [
    {
      "id": "<string>",           // matches the sub-metric id in complaintLandscape.js
      "labelKey": "<loc_key>",    // localization key for the switcher label
      "default": true | false     // which variant is shown on first load
    }
    // ...
  ],
  // ^ present when one card shows a sub-metric switcher (e.g. "channel mix").
  //   Each variant corresponds to a SEPARATE kpiId (one def per sub-metric,
  //   grouped by `group` field). This field enumerates which sibling kpiIds
  //   belong to the same card and should render as a switcher.
  //   Resolved by Part D (Open-Q 6): one kpiId per sub-metric + group field.
  //   If omitted, the tile is a standalone scalar/chart with no switcher.

  // ─── Chart-specific config (present when kind ≠ scalar) ─────────────────
  "dimensionKey": "<column_name>",
  // ^ the column to use as the x-axis / category label
  //   example: "ward_code", "service_code", "created_dow"
  //   replaces the hardcoded column names in parseBarChart/parseDowChart
  //   (kpiQueries.js:586 `created_dow`; useDashboardData.js:64-65 `service_code`/`ward_code`)

  "measureKeys": ["<column_name>", ...],
  // ^ columns to plot as y-values; typically ["total"] or ["pct"]
  //   for multi-series charts (rankedList with score + rank) can be >1

  // ─── Composed metrics (present when this tile has no own query) ──────────
  "compose": null | {
    "type": "openRateComplement"    // 1 - sourceKpiIds[0].pct
           | "netBacklogDaily"      // sourceKpiIds[0].total - sourceKpiIds[1].total
           | "dailyAvgFromWeekly"   // sourceKpiIds[0].total / elapsedDays(asOf)
           | "hourlyAvgFromDaily",  // sourceKpiIds[0].total / elapsedHours(asOf)
    "sourceKpiIds": ["<kpiId>", ...],
    // ^ the sibling kpiIds whose fetched results feed the formula
    "elapsedFromAsOf": true | false
    // ^ when true, the FE derives elapsed days/hours from the server-stamped
    //   `asOf` on sourceKpiIds[0], NOT from Date.now(); this makes the
    //   divisor server-controlled and avoids client clock drift
  },
  // ^ when non-null, `query` on the def is null (no own query body).
  //   The FE fetches the sourceKpiIds first, then evaluates the compose rule.
  //   The compose dispatcher in the FE is a small keyed function (~20 lines);
  //   it does NOT know which KPI uses which type — that comes from this field.

  // ─── PII flags ───────────────────────────────────────────────────────────
  "pii": false | {
    "dimension": "<column_name>"
    // ^ which dimension column carries officer UUIDs; the renderer treats this
    //   as an opaque code unless the result row explicitly carries a decrypted label.
    //   Present on the 4 officerTopCount defs (ep_open_by_officer, ep_closed_by_officer,
    //   ep_leaderboard_closed, er_critical_by_officer).
  }
}
```

### Format inventory (grounded in `formatSubMetricValue`, `kpiQueries.js:479–551`)

| `format` value | Example output | Source in FE |
|---|---|---|
| `integer` | `1,234` | `L481–484` |
| `percentInteger` | `42%` | `L486–488` |
| `percentOneDecimal` | `42.3%` | `L490–492` |
| `percentNoDecimal` | `42%` (no rounding) | alias of percentInteger |
| `decimalOne` | `3.5` | `L494–496` |
| `decimalTwo` | `3.54` | `L498–500` |
| `hoursDays` | `2d 3h` | `L502–506` (ms → day+hour) |
| `hoursDecimal` | `2.3h` | `L508–510` (ms → decimal hours) |
| `ordinal` | `3rd` | `L512–515` |
| `signedInteger` | `+5` / `-3` | `L517–521` |

> `percentDelta` / `percentPointDelta` (WoW/MoM) are NOT in this list — they correspond to the `queryKey:null` tiles that are `—` today (Part 65 §4a). They are deferred until period-comparison DSL support is added; do not create `viz.format` entries for them until the underlying query exists.

### Compose dispatch (grounded in `formatSubMetricValue` `derived` branches, `kpiQueries.js:439–454,492–512`)

| `compose.type` | Formula | `elapsedFromAsOf` | Source |
|---|---|---|---|
| `openRateComplement` | `(1 − pct) × 100` | false | `L439–445, L506–508` |
| `netBacklogDaily` | `source[0].total − source[1].total` | false | `L447–454, L510–512` |
| `dailyAvgFromWeekly` | `source[0].total ÷ daysElapsed(asOf)` | true | `L492–497` |
| `hourlyAvgFromDaily` | `source[0].total ÷ hoursElapsed(asOf)` | true | `L499–504` |

---

## 2. The API surface — the 3+1 calls

All endpoints follow DIGIT convention: `POST` with `RequestInfo` in the body, token in `authToken`, no client-authored `userInfo`. The token is the only identity signal; the gateway populates `userInfo` (Part A gate).

### Read 1 — Schema bootstrap (one call per session, token-scoped)

```
POST /v2/analytics/packs
```

**Purpose:** Returns everything the FE needs to *know what to draw* — the full catalog of tiles the caller's token is allowed to see, each with its complete `viz` spec, plus the default layout. No data. Cached per-role by the server.

**Request:**
```jsonc
{ "RequestInfo": { "authToken": "<token>" },
  "tenantId": "ke.bomet" }
```

**Response:**
```jsonc
{
  "tiles": [
    {
      "kpiId": "cl_open_weekly",
      "version": "1.0.0",
      "titleKey": "CMS-DASHBOARD.DASHBOARD_KPI_TITLE_OPEN_WEEKLY",
      "viz": {
        "kind": "scalar",
        "format": "integer",
        "valueKey": "total",
        "accent": "teal",
        "group": "complaint-landscape",
        "compose": null,
        "pii": false
      },
      "params": [
        { "name": "window", "default": "last_7d", "allowed": ["last_1d","last_7d","last_30d","wtd","mtd"] }
      ],
      "freshness": { "grainRefreshMs": 300000 }
    }
    // ... one entry per tile the token's roles permit (visibleTo ceiling already applied)
  ],
  "defaultLayout": [
    { "kpiId": "cl_open_weekly", "x": 0, "y": 0, "w": 2, "h": 1 }
    // ... grid positions for each tile (12-col react-grid-layout compatible)
  ],
  "asOf": "2026-06-25T09:00:00Z"
}
```

**What the response does NOT include:** `query` bodies (the frozen SQL-shaping DSL), `rbac` ceiling declarations, or any row data. The FE never sees the analytic query body.

**What stays FE:** the caller's personal layout delta — which tiles are `hidden`, and any `{x,y,w,h}` overrides — is fetched separately from user-preferences and applied as a diff over `defaultLayout`.

---

### Read 2 — Data (batched, token-scoped, server injects `WHERE`)

```
POST /v2/analytics/_query
```

**Purpose:** Returns the actual numbers for the requested tiles, already row-filtered to the caller's principal (jurisdiction/department/self via Part B/C). This is the same endpoint as today but with a `kpiId`-by-reference shape instead of inline query bodies.

**Request:**
```jsonc
{ "RequestInfo": { "authToken": "<token>" },
  "tenantId": "ke.bomet",
  "queries": {
    "cl_open_weekly": { "kpiId": "cl_open_weekly", "params": { "window": "last_7d" } },
    "cl_chart_wards": { "kpiId": "cl_chart_wards", "params": { "window": "last_7d" } }
    // ... one entry per tile to fetch (typically all tiles from Read 1)
  }
}
```

**Response:**
```jsonc
{
  "results": {
    "cl_open_weekly": {
      "columns": [
        { "name": "total", "role": "measure", "format": "integer" }
      ],
      "rows": [{ "total": 412 }],
      "asOf": "2026-06-25T09:00:00Z",
      "scope": { "boundaryPrefixes": ["BOMET|CENTRAL|CHESOEN"] }
    },
    "cl_chart_wards": {
      "columns": [
        { "name": "ward_code",  "role": "dimension" },
        { "name": "total",      "role": "measure", "format": "integer" }
      ],
      "rows": [
        { "ward_code": "CHESOEN", "total": 87 },
        { "ward_code": "SIGOR",   "total": 63 }
      ],
      "asOf": "2026-06-25T09:00:00Z"
    }
  },
  "partial": false,
  "errors": {}
}
```

**Server-side guarantees:** every result in `results` is already scoped to the caller's principal — no client-side row filtering. A tile the caller cannot invoke returns in `errors[kpiId]`, not in `results`. `partial:true` means at least one tile errored; the FE renders error state per tile (never silent zero).

---

### Read 3 — Inventory picker (superset, for adding tiles)

```
POST /v2/analytics/catalog/_search
```

**Purpose:** The "add a KPI" picker needs to show tiles the caller is *allowed to add* but hasn't put on the grid yet. This is the full role-filtered catalog — same ceiling as Read 1 but not pack-filtered. The FE subtracts `currentGridKpiIds` client-side to find the addable set.

**Request:**
```jsonc
{ "RequestInfo": { "authToken": "<token>" },
  "tenantId": "ke.bomet",
  "filters": { "status": "published" }
}
```

**Response:** same shape as Read 1's `tiles[]` array, no `defaultLayout`. The FE never sees draft/archived defs.

---

### Write — Personal layout (the only FE-owned state)

```
POST /user-preference/v1/_upsert    (existing DIGIT endpoint)
```

**Purpose:** Persist the caller's personal layout delta — only `hidden` booleans and `{x,y,w,h}` grid overrides per tile. Nothing else. The server owns the rest.

**Key:** `PGR_DASHBOARD_LAYOUT_<tenantId>` (one per tenant per user). The value is a sparse diff over `defaultLayout`: tiles not in the delta inherit their default position.

```jsonc
{
  "RequestInfo": { "authToken": "<token>" },
  "Preference": {
    "key": "PGR_DASHBOARD_LAYOUT_ke.bomet",
    "value": {
      "overrides": [
        { "kpiId": "cl_chart_wards", "x": 4, "y": 2, "w": 4, "h": 2, "hidden": false },
        { "kpiId": "ep_leaderboard_closed", "hidden": true }
      ]
    }
  }
}
```

**What does NOT go here:** tile `format`, `chart`, `accent`, anything from `viz`. Those are read-only from the catalog.

**Caveat (README finding 6):** The preferences store currently keys on body `Preference.UserId`, spoofable. Part E must bind it to the token uuid before this write is identity-safe. Until then, layout personalization can stay in `localStorage` under the existing key (`dashboardConfig.js:46-48` `getLayoutStorageKey()`). The client-side structure of the write (sparse delta over defaultLayout) is the same either way — only the sink changes.

---

## 3. Session initialization sequence

On dashboard load the FE makes **two parallel calls**, then one batched data call:

```
1a. POST /v2/analytics/packs         → tile catalog + viz schema + default layout
1b. POST /user-preference/v1/_search → personal layout delta (sparse overrides + hidden set)

    (merge: apply personal delta over default layout → final grid)

2.  POST /v2/analytics/_query        → data for all unhidden tiles
```

Tiles that have `compose.sourceKpiIds` are included in the `_query` batch for their source KPIs; the compose evaluation happens client-side after the data arrives, using the `asOf` from the source result.

**Separation of concerns:** Read 1 (schema) and Read 2 (data) are deliberately separate so:
- A viz toggle (table ↔ bar) re-renders with no refetch — the FE already has the data.
- A data refresh (polling) re-POSTs `_query` without re-fetching the schema.
- Schema is cacheable per-role (long TTL); data is fresh per-request (short TTL or SSE push in future).

---

## 4. What the FE renderer needs to implement (and nothing more)

Given the above contract, the FE renderer is a pure interpreter:

```
(viz, columns, rows | value) → rendered tile
```

It needs exactly:
- A `kind` dispatcher: scalar / bar / rankedList / line / map / dow
- A `format` dispatcher: 8–10 entries (§1 format inventory)
- A `compose` dispatcher: 4 entries (§1 compose dispatch)
- A `columns[].role` reader to find dimensions vs measures
- An `asOf` display per tile
- A `scope` badge display per tile
- An error state renderer for `errors[kpiId]`

Zero domain knowledge. No hardcoded column names, no hardcoded format assignments, no hardcoded chart type decisions.

---

## 5. Impact on Part 65 §4b (correction)

Part 65 §4b originally recommended keeping compose logic "FE-side" for the 4 derived metrics. **This is corrected here:** the compose *rule* is declarative knowledge and belongs in `viz.compose`. The FE *engine* evaluates it, but the rule itself (which type, which sourceKpiIds, whether to use `elapsedFromAsOf`) comes from the catalog response. The FE never hardcodes "this tile = `cl_reg_weekly / daysElapsed`" — it reads that from `viz.compose.type = "dailyAvgFromWeekly"` and `viz.compose.sourceKpiIds = ["cl_reg_weekly"]`.

The `elapsedFromAsOf: true` flag ensures the divisor is derived from the server-stamped `asOf` on the source result, not from `Date.now()`. This removes the client clock as an authority over any computed number.

---

## 6. Open questions

1. **`variants[]` shape vs Part D's Open-Q 6 resolution.** If Part D chooses "one kpiId per sub-metric + `group` field" (recommended), `variants[]` in viz is the group manifest — one entry per sibling kpiId, the FE renders a switcher for kpiIds sharing the same `group`. If Part D chooses "one kpiId with `params`-selectable sub-metric", `variants[]` becomes a `params` enum and the field shape above needs revision. Part D owns this; Part 66 follows.

2. **`map` viz — unimplemented tiles.** The 3 `cl-metric-hot-ward` sub-metrics are `queryKey:null` today (Part 65 §4a). `viz.kind:"map"` is reserved in the schema; populate it only when a real query body exists. Boundary geometry is fetched from `boundary-service` by the renderer using the `dimensionKey` codes from `rows` — the FE never enumerates the hierarchy.

3. **`dow` viz.** `parseDowChart` (`kpiQueries.js:575–587`) hardcodes `created_dow` as the dimension. Under the new contract `viz.dimensionKey:"created_dow"` carries this. The renderer applies the same day-of-week label mapping it does today, driven by `dimensionKey`.

4. **Analyst/explore surface.** If an analyst role sends inline grammar to `/_query`, it must use a separate endpoint or role-gate (Part F Open-Q 4). The 3+1 API surface above is for the *standard* dashboard (no inline grammar). An explore surface is out of scope for this doc; document it in Part F when scoped.

5. **Localization of `titleKey` and `variants[].labelKey`.** These are resolved at the edge — the FE calls the localization service (or has them in the pre-loaded localization bundle) exactly as it does for any other `t("KEY")` string. The BE does not resolve them in the catalog response.

---

> **Note.** This part was written 2026-06-25, prompted by the direction: "FE will HAVE to get the visualization schema and the data corresponding to a KPI scoped to the token. Why keep anything FE-side other than size and ordering and what KPI is visible or not as local storage." It is a design specification, not implementation — no code changed. The 3+1 API surface above is the target contract for Part D/E/F implementation.
