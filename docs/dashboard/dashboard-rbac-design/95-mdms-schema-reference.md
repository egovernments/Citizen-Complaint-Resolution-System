# MDMS schema reference

The exact JSON shape of every MDMS record `docs/2.12/dashboard-configuration.md` describes updating.
Field docs are copied from each schema's own `description`/`x-unique`/`x-ref-schema` — the schema
files are the source of truth; this page just puts them next to a real example so you don't have to
find and read all six files to write one update payload.

Schema sources:
- `local-setup/db/dss-mdms-seed/schemas/dss.{KpiDefinition,DashboardPack,DashboardConfig}.json`
- `utilities/default-data-handler/src/main/resources/schema/ACCESSCONTROL-ROLEACTIONS.json`
  (holds all three of `ACCESSCONTROL-ACTIONS-TEST.actions-test`,
  `ACCESSCONTROL-ROLEACTIONS.roleactions`, and `ACCESSCONTROL-ROLES.roles`)

---

## `dss.KpiDefinition`

One record per KPI tile. `x-unique: [id]`.

| Field | Type | Notes |
|---|---|---|
| `id` | string, **required** | Stable snake_case key matching the `BATCH_QUERIES` key, e.g. `cl_open_weekly` |
| `version` | string, required | Pattern `\d+\.\d+\.\d+` |
| `status` | enum, required | `draft` \| `published` \| `archived` |
| `query` | object or null | The analytics DSL body verbatim from `BATCH_QUERIES`; null for compose-only defs |
| `viz` | object, required | See below |
| `params` | array | `{name, default, allowed[]}` — user-adjustable query params (e.g. time window) |
| `requiredActionUrl` | string | The access-control action URL a caller must be granted to see this KPI. Absent = no authenticated caller reaches it |
| `public` | boolean | Additive, not a ceiling — `true` also opts the tile into the credential-free public dashboard |

`viz` (required: `kind`, `format`, `valueKey`, `accent`, `group`, `titleKey`):

| Field | Type | Notes |
|---|---|---|
| `kind` | enum | `scalar` \| `bar` \| `rankedList` \| `line` \| `map` \| `dow` \| `number-tile-delta` \| `number-tile-sparkline` \| `stacked-bar` \| `data-table` \| `table` \| `horizontal-bar` \| `sla-risk-table` \| `histogram` \| `pie` |
| `format` | enum | `integer` \| `percentInteger` \| `percentOneDecimal` \| `percentNoDecimal` \| `decimalOne` \| `decimalTwo` \| `hoursDays` \| `hoursDecimal` \| `ordinal` \| `signedInteger` \| `ratingOutOfFive` |
| `accent` | enum | `teal` \| `amber` \| `green` \| `slate` \| `red` \| `blue` \| `orange` |
| `titleKey` | string | Localization key |
| `pii` | `false` or `{dimension}` | Marks a dimension as PII for masking |
| `compose` | object or null | `{type, sourceKpiIds[], elapsedFromAsOf?}` — derives this tile from others instead of its own query. `type` ∈ `openRateComplement` \| `netBacklogDaily` \| `dailyAvgFromWeekly` \| `hourlyAvgFromDaily` |
| `columns` | array | For table-kind tiles: `{id, type, label|labelKey, align?, width?, dimension?}` |
| `comparison` | object | `{period: "prior", mode: "percentChange", joinBy[], valueKey, outputKey}` |
| `rowFilter` | object | `{column, eq?/gte?/gt?/lte?/lt?}` |
| `variants`, `measureKeys`, `dimensionKey` | array/array/string | Multi-series tile support |

**Example** (live record, `id: cl_new_created_count`):

```json
{
  "id": "cl_new_created_count",
  "version": "1.0.0",
  "status": "published",
  "query": {
    "grain": "facts",
    "measures": [{ "name": "total", "agg": "count" }]
  },
  "supportsSeries": true,
  "viz": {
    "kind": "number-tile-sparkline",
    "format": "integer",
    "valueKey": "total",
    "accent": "teal",
    "group": "complaint-landscape",
    "titleKey": "CMS-DASHBOARD.DASHBOARD_KPI_CL_NEW_CREATED_COUNT",
    "title": "New complaints created",
    "delta": { "mode": "percent", "compare": "prior" },
    "deltaLabel": "vs prior period",
    "dateKey": "created_date",
    "sparklineMeasureKey": "total"
  },
  "params": [
    { "name": "window", "default": "last_7d", "allowed": ["last_1d", "last_7d", "last_30d", "wtd", "mtd"] }
  ],
  "requiredActionUrl": "/pgr-services/v2/analytics/_query",
  "public": true
}
```

---

## `dss.DashboardPack`

One record per named pack (tile set + grid layout). `x-unique: [id]`.

| Field | Type | Notes |
|---|---|---|
| `id` | string, required | e.g. `supervisor-default`, `public-default` |
| `tiles` | string[], required | `kpiId`s in this pack — must all be `published` `KpiDefinition`s |
| `layout` | array, required | `{kpiId, x, y, w, h}` grid position per tile |
| `description` | string | |
| `requiredActionUrl` | string | Action URL a caller must be granted for this pack to be a match candidate; the server picks the best-match pack for the caller's resolved capabilities |
| `public` | boolean | `true` marks this pack as the public dashboard's default |

**Example** (abbreviated — first 2 tiles of the shipped `supervisor-default`):

```json
{
  "id": "supervisor-default",
  "description": "Default supervisor dashboard pack — complaint metrics, officer SLA chart, map, and at-risk table",
  "tiles": ["cl_resolution_rate_count", "rs_breach_total", "..."],
  "layout": [
    { "kpiId": "cl_resolution_rate_count", "x": 0, "y": 0, "w": 2, "h": 2 },
    { "kpiId": "rs_breach_total", "x": 2, "y": 0, "w": 2, "h": 2 }
  ],
  "requiredActionUrl": "/pgr-services/v2/analytics/_query"
}
```

---

## `dss.DashboardConfig`

Single-record master — the UI reads the record with `id: "default"`. `x-unique: [id]`.

| Field | Type | Notes |
|---|---|---|
| `id` | string, required | The UI reads the `"default"` record |
| `numberFormat` | string or `{[locale]: string, default?: string}` | Display-only number mask, per locale. String form = one mask tenant-wide (legacy). `#,##0.00` → `1,234.56`; `#.##0,00` → `1.234,56`. Absent/malformed → UI keeps built-in formatting. CSV export always stays raw |
| `departmentScoping` | enum | `enforced` \| `disabled`. `disabled` widens visibility to all employees (temporary, pending #1280). Absent = `enforced` |
| `publicDashboardEnabled` | boolean, default `false` | Fail-closed switch for the public dashboard. Only literal `true` enables it |
| `timeZone` | string (IANA) | e.g. `Africa/Nairobi`, `Asia/Kolkata`. All windowed queries (dtd/wtd/mtd/qtd/ytd) resolve against this zone's calendar day. Absent/invalid falls back to `Africa/Nairobi`. MV-backed tiles only pick up a change on their next `DashboardRefreshScheduler` run, not instantly |

**Example** (live `ke` record — number-format only, no role list):

```json
{ "id": "default", "numberFormat": "#,##0.00" }
```

---

## `ACCESSCONTROL-ACTIONS-TEST.actions-test`

Defines one navigable/callable action. `x-unique: [id]`.

| Field | Type | Notes |
|---|---|---|
| `id` | number, required | |
| `url` | string, required | The path this action gates (nav route or API path) |
| `name`, `displayName` | string, required | |
| `enabled` | boolean, default `true` | An action with `enabled: false` is excluded from resolution — this bit is what caused [#1899](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1899) |
| `orderNumber` | number, default `0` | |
| `serviceCode` | string, default `""` | |
| `path`, `code`, `leftIcon`, `rightIcon`, `parentModule`, `navigationURL` | string | UI-facing metadata |

**Example** (the dashboard nav action, id 4557 — the record [#1899](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1899) is about):

```json
{
  "id": 4557,
  "url": "url",
  "name": "Dashboard",
  "path": "Dashboard",
  "enabled": true,
  "leftIcon": "action:dashboard",
  "displayName": "Dashboard",
  "orderNumber": 2,
  "serviceCode": "DASHBOARD",
  "navigationURL": "/digit-ui/employee/dashboard"
}
```

**Capability actions** (2640–2648 — see `docs/2.12/dashboard-configuration.md` for which role holds which):

```json
{ "id": 2646, "url": "/pgr-services/v2/analytics/capabilities/officer", "name": "MDMS", "displayName": "...", "enabled": false, "serviceCode": "MDMS" }
```

---

## `ACCESSCONTROL-ROLEACTIONS.roleactions`

Grants one role access to one action. `x-unique: [rolecode, actionid]` — the pair is the identity;
there's no separate `id` to target for `_update`, only add/remove the row.

| Field | Type | Notes |
|---|---|---|
| `rolecode` | string, required | References `ACCESSCONTROL-ROLES.roles.code` |
| `actionid` | number, required | References `ACCESSCONTROL-ACTIONS-TEST.actions-test.id` |
| `tenantId` | string, required | |
| `actioncode` | string | Usually empty |

**Example** (grants `PGR_SUPERVISOR` the officer capability tier):

```json
{ "id": 1872, "actionid": 2646, "rolecode": "PGR_SUPERVISOR", "tenantId": "pg", "actioncode": "" }
```

---

## `ACCESSCONTROL-ROLES.roles`

Declares a role code as one that exists on the tenant — required before any `roleactions` row
referencing it will resolve. `x-unique: [code]`, `additionalProperties: false`.

```json
{ "code": "PGR_SUPERVISOR", "name": "PGR Supervisor", "description": "..." }
```

---

Back to [`../../2.12/dashboard-configuration.md`](../../2.12/dashboard-configuration.md#updating-it--apis) for how
these get written to (the `mdms-v2 _create`/`_update` calls) rather than just their shape.
