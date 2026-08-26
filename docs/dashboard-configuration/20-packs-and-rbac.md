# 20 — Dashboard Packs and Access-Control Layers

## 1. `dss.DashboardPack` — which capability gets which default dashboard

A **DashboardPack** picks the default tile set + grid layout per audience. Like KpiDefinition it
lives in MDMS module `dss`, master `DashboardPack`, at the **state-root tenant**.

- Live example: `ansible/nairobi-mdms/mdms/dss/DashboardPack.json` (`supervisor-default` on `ke`)
- POJO: `backend/pgr-services/src/main/java/org/egov/pgr/analytics/model/DashboardPack.java`
- Selection logic: `KpiCatalogService.getBestPack`

```jsonc
{
  "tenantId": "ke",
  "data": {
    "id": "supervisor-default",
    "description": "Default supervisor dashboard pack",
    "requiredActionUrl": "/pgr-services/v2/analytics/_query",
    "tiles":  ["cl_resolution_rate_count", "rs_breach_total", ...],   // KpiDefinition ids
    "layout": [ { "kpiId": "cl_resolution_rate_count", "x": 0, "y": 0, "w": 2, "h": 2 }, ... ]
  }
}
```

Semantics (`POST /pgr-services/v2/analytics/packs`):

- **Capability match**: the first pack whose `requiredActionUrl` is in the caller's
  egov-accesscontrol action set wins. The anonymous pack is selected only by `public:true`.
- **Ceiling filter**: pack `tiles`/`layout` are filtered down to the KPIs the caller can actually
  see (`requiredActionUrl` + `status:published`). A pack can never leak a tile past the catalog
  ceiling.
- **No matching pack**: the caller gets *all* visible defs as tiles with an empty
  `defaultLayout` — functional but unlaid-out. Give every dashboard-holding role a pack.
- **Layout grid**: `x/y/w/h` in react-grid-layout units on a **12-column** grid (see the live
  layout: rows of five `w:2` cards, full-width `w:12` tables). Users can rearrange locally; the
  FE persists per-browser layout to localStorage (key `ccrs.dashboard.catalog-layout.v1`,
  `digit-ui-esbuild/products/dashboard/src/hooks/useCatalogLayout.js`) — the pack is only the
  *default*.
- The response (`AnalyticsController.safeTile`) contains viz metadata only — **never** the
  def's `query` or `rbac` blocks.

Editing a pack (add/remove/rearrange default tiles for a role) is an MDMS `_update` — no deploy.

## 2. The access-control layers

Design series: `docs/dashboard-rbac-design/` (parts A–F + 70-view-management). What is actually
enforced in `backend/pgr-services/src/main/java/org/egov/pgr/analytics/`:

### Layer 1 — Row-scope ABAC (what rows a query may aggregate)

Resolved once per request by `AnalyticsRowScopeResolver`, which delegates to Vinoth's shared
`SearchAccessPolicyService.resolveScope` for action 2008. The resulting `PgrSearchScope` is the
same object used by PGR complaint search and is injected by `AnalyticsPlanner.applyScope` as SQL
WHERE conjuncts. It is never taken from the request body.

| principal | injected scope |
|---|---|
| any caller | tenant scope, always: state-root tenant → `tenant_id LIKE 'ke%'`, city tenant → `tenant_id = ?` |
| pure citizen | `account_id = <own uuid>` (self-scope) |
| employee | department and jurisdiction axes are resolved from HRMS, then action 2008's `resource.complaint.scope.roleScopes` decides `OWN` versus `ALL` per axis |
| employee whose required `OWN` value cannot be resolved | **fail-closed** on that axis with sentinel `__scope_denied__`; there is no hard-coded tenant-wide role bypass |

The canonical policy grants GRO `department:ALL/jurisdiction:OWN`, PGR_LME `OWN/OWN`,
SUPERVISOR `OWN/ALL`, and defaults other employee roles to `ALL/OWN`. Change the authored action
policy, not Java role constants, to change those outcomes.

#### Tenant-configurable department scoping — `dss.DashboardConfig.departmentScoping` (#1280)

The employee department axis above can be switched off per tenant via an OPTIONAL field on the
`dss.DashboardConfig` MDMS master (the tenant-level dashboard config record introduced by #1258
and extended by #1272 — this field composes additively with whatever else that record carries):

| value | effect |
|---|---|
| `"enforced"` (or the field/record absent — the default) | today's behavior, exactly as the table above: HRMS department resolution, `department_code IN (...)`, fail-closed sentinel for unresolvable constrained employees |
| `"disabled"` | the resolver skips HRMS department resolution ENTIRELY for employees: no department filter, no fail-closed sentinel. Tenant scoping (always applied) and citizen self-scope are untouched |

**Fail-safe**: anything that is not an explicit `"disabled"` (case-insensitive) — missing
module/record/field, a malformed value, an MDMS error — resolves to `"enforced"`. The lookup
never widens scope on failure.

The value is read at the tenant's **state root** (like the rest of the dss module) and cached
in-memory for 5 minutes per state root, so a config flip takes effect within 5 minutes without
a redeploy.

**When to use it**: deployments whose complaint data carries no departments (#1280 —
`ServiceDefs` entries without a `department`, so `department_code` is NULL on every fact row).
Under `"enforced"`, every department-scoped officer there sees zero rows on every tile; under
`"disabled"` they see the tenant's real numbers.

**Warning — this widens data visibility**: with `"disabled"`, EVERY employee on the tenant sees
the tenant-wide aggregates (equivalent to holding a `TENANT_WIDE_ROLES` role for Layer 1). Treat
it as a temporary bridge until department enrichment lands in the complaint data, then flip back
to `"enforced"`.

Seed note: the `DashboardConfig` seed file (`ansible/nairobi-mdms/mdms/dss/DashboardConfig.json`)
lives on the #1258/#1272 branches, not this one; add `"departmentScoping": "enforced"` to that
record whichever merges first — the master's schema is additive/open, and absence already means
enforced.

Operator consequences:

- A department-scoped supervisor's dashboard (all tiles, and the filter option lists) shows
  **only their departments' complaints**. That is scoping, not "missing data".
- An officer role that should see the dashboard **must have an active HRMS assignment with a
  department**, or hold a tenant-wide role — otherwise every tile returns zero rows.
- `department_code` on the grains comes from `RAINMAKER-PGR.ServiceDefs.department` per
  serviceCode; complaints whose type has no department are excluded for department-scoped users
  (NULL never matches an `IN` list).

#### Tenant-configurable calendar zone — `dss.DashboardConfig.timeZone` (#29)

Every analytics request resolves ONE IANA time zone from this OPTIONAL field on the same
`dss.DashboardConfig` record (composes additively with `departmentScoping` and `numberFormat`)
and builds exactly one `BusinessCalendar` (a resolved `ZoneId` +
a single captured `asOf` instant) that every downstream consumer of the request shares — the
planner's named windows (`dtd`/`wtd`/`mtd`/`qtd`/`ytd`), the `#1462` pinned-window
suppression/prior decision, an explicit `dateFrom`/`dateTo` range, the runtime `timeBucket` SQL,
and the compose `*_Avg` elapsed-time math. The response's own `asOf`/`calendar` fields
(`{timeZone, businessDate}`) echo exactly this same resolved calendar.

**Fail-safe**: absent, empty, or a value that fails `ZoneId.of(...)` (not a valid IANA zone id)
falls back to `Africa/Nairobi` — the zone every unconfigured tenant already behaved as before
this field existed (a migration-compatibility default, not an assertion that EAT is the "right"
default for new tenants). The fallback is logged at WARN (once per cache TTL window per state
root); it never throws and never falls back to the server's JVM/OS zone.

Read at the tenant's **state root** and served from the SAME cached fetch/TTL as
`departmentScoping` (one MDMS call resolves both axes together; see the shared-cache note above)
— a config flip on either field takes effect within one `pgr.analytics.config-cache-ttl-ms`
window (default 5 minutes) without a redeploy.

**DB-refresh lag is separate from calendar resolution.** The calendar itself (window boundaries,
`businessDate`) is computed once per request from the resolved `timeZone` value. A config change
therefore reaches the request path on the first request after the shared config cache refreshes
(within the TTL above). What can lag further is the underlying DATA: `complaint_facts` /
`complaint_events` are materialized views refreshed by `DashboardRefreshScheduler` on its own
cadence (`pgr.dashboard.refresh.interval.ms`, default 5 min — see `60-operations.md`), so a
DB-derived tile's numbers reflect a `timeZone` change (e.g. it shifting which rows fall in
"today") only from that view's next refresh onward, not instantaneously.

Seed note: `ansible/nairobi-mdms/mdms/dss/DashboardConfig.json` carries
`"timeZone": "Africa/Nairobi"` for the canonical `ke` tenant — the explicit value matches what
absence would already resolve to, kept explicit so the seed is self-documenting.

### Layer 2 — Endpoint and catalog capabilities

PGR resolves the caller's visible egov-accesscontrol action URLs once per request. Actions
2640–2644 gate the route bootstrap, query, packs, catalog and schema endpoints. Each KPI and
employee pack declares `requiredActionUrl`; absence or a misspelled/ungranted URL is fail-closed.
Specialized actions 2646–2648 grant officer PII and report catalog slices.

Applies uniformly to `/packs`, `/catalog/_search`, and `kpiId`-by-reference `/_query` calls.

### Layer 3 — Inline PII gate

The `kpiId` path is governed by layer 2, but `/_query` also accepts **inline** query bodies. An
inline query that projects an officer/citizen-identity column as a raw *dimension*
(`AnalyticsService.PII_DIMENSIONS`: `current_assignee_uuid`, `assignee_uuid`, `actor_uuid`,
`account_id`) is rejected with `pii_forbidden` unless the caller holds
the `/pgr-services/v2/analytics/capabilities/officer` capability. Aggregate `count_distinct` over
these columns is *not* gated (never exposes an
individual UUID). Additionally, these columns are groupable/distinct-countable but **never
filterable** (no UUID probing), and the API returns raw UUIDs only — name resolution happens at
the edge with the caller's own credentials.

### Layer 4 — Public floor

An unauthenticated caller uses `AnalyticsCapabilities.publicSurface()`, which may:

- see only tiles whose definition explicitly carries `public:true`;
- run **only** `kpiId`-by-reference queries — every inline body gets `kpi_forbidden`.

This is a deliberate degrade-to-curated-aggregates, not a lock-out; it closed the old fail-open
where anonymous callers could reach authenticated catalog entries.

#### The public dashboard page (`/digit-ui/public-dashboard`, #1540 / #1797)

The anonymous page never touches the mixed-auth endpoints above. It uses four Kong-only
auth-optional aliases under `/v2/analytics/public/*` (`AnalyticsController`), each of which
**discards `RequestInfo` by construction** and fails closed when
`dss.DashboardConfig.publicDashboardEnabled` is not `true`:

| alias | returns | feeds |
|---|---|---|
| `POST …/public/packs` | the matched `PUBLIC` pack: tiles + default layout (no `recordCount`); `{enabled:false}` when disabled | default page |
| `POST …/public/catalog/_search` | every published def with `public:true` (safe descriptors) | the **Add KPI** menu |
| `POST …/public/_options` | ward / complaint-type **codes** that carry complaints (counts stripped); the two distinct queries are server constants, the caller sends only `tenantId` | the filter bar's dropdowns |
| `POST …/public/_query` | batch of `{kpiId[, params]}` refs | tile data |

`/public/_query` accepts a ref for **any `public:true` def** (not only pack tiles — the pack is
the enablement gate, the public marker is the disclosure boundary), and its `params` are rebuilt from a
fixed allow-list — `dateFrom`, `dateTo`, `ward`, `serviceCode`, `complaintPath` — i.e. exactly
the global filter bar. Each value must be a non-empty scalar ≤ 128 chars; dates must be ISO
calendar days supplied together. Any other key (`hierLevel`, `compare`, `series`, `window`, …),
shape or value is a whole-batch `400 invalid_param`. So the anonymous page gets the same Ward /
Complaint type / date filters as the employee dashboard, but no companion fan-out (no prior-period deltas or
sparklines), no Group-by level switch and no per-complaint pin source.

Three details of that policy worth knowing when authoring PUBLIC defs:

- **It is enforced in the service, not just the alias.** `AnalyticsService` applies the same
  allow-list to every PUBLIC-floor caller (`PUBLIC_QUERY_PARAMS`), so an anonymous body that
  reaches the employee `/_query` while Kong runs in audit mode gets per-entry `invalid_param`
  for anything outside it — the alias only adds the whole-batch 400 and discards RequestInfo.
- **A public param never displaces a predicate the def bakes itself.** The composer *replaces*
  an existing `eq` rather than intersecting with it (that is the employee filter-bar semantics),
  so for the public floor a `ward` / `serviceCode` / `complaintPath` param whose column the def's
  own `query.filters` already pins is dropped and reported in `paramsIgnored`. "Water complaints"
  stays water complaints however the visitor filters.
- **Date ranges follow employee semantics:** `dateFrom`/`dateTo` replace the def's named
  `window` (the `params[].allowed` list governs only the `window` param). A public tile can
  therefore be asked for any historical interval; if a deployment wants a ceiling, that is a
  product decision (see the open question in PR #1838), not something the catalog expresses today.

All four aliases share one fail-closed gate: `publicDashboardEnabled` **and** a matching PUBLIC
pack. Enabled-but-no-pack exposes neither descriptors (`catalog/_search`) nor option codes
(`_options`) — both return `400 public_pack_not_found`, the same as a query would.

**Which knob grants what, publicly:** set a def's `public:true` → it appears in the public Add KPI
menu and is queryable anonymously; add it to the `public-default` pack → it is on the page by
default. Untag it → both disappear on the next config-cache refresh. The visitor's own layout and
filter choices persist only in their browser (`ccrs.dashboard.*.public` keys, disjoint from every
employee slot).

## 3. Error codes and what to do about them

Per-entry in a batch (`results.<name>.error` + top-level `partial: true`) or a 400 body on a
single query. Codes are the prefix before `:` in the message (`AnalyticsService.err`).

| code | meaning | operator action |
|---|---|---|
| `scope_incomplete` | the caller's mandatory row-scope (citizen / department / boundary) cannot be **enforced on the target grain** — the grain lacks that scope column, so the server refuses rather than silently widening | Since `V20260629000000__grain_scope_columns.sql` all three grains carry department + citizen axes, so this signals a custom grain/def problem, not a user problem |
| `kpi_forbidden` | kpiId not found, not `published`, or caller lacks its `requiredActionUrl`; also any inline/public-floor violation | Check def status + action URL/grant; FE renders "No access" |
| `pii_forbidden` | inline query projected a PII dimension without the officer capability | Use a curated KPI def (layer 2) instead of inline, or grant action 2646; FE renders "Restricted" |
| `invalid_param` | bad grammar value: unknown window, `window` outside the def's `allowed` list, unparseable `dateFrom/dateTo`, bad percentile/sort/limit | Fix the def or the caller's params |
| `unknown_column` / `op_not_allowed` / `unknown_grain` / `unknown_agg` | identifier not in the `AnalyticsCatalog` whitelist for that operation | Register the column (developer change — see 50-sla-and-hierarchies.md §extending) |
| `invalid_kpi` | def misconfiguration (e.g. `query: null` without a valid `viz.compose`) | Fix the def in MDMS |
| `query_failed` | anything else (SQL/runtime) | Check pgr-services logs |

Note for FE developers: `KpiTile.errorLabel` maps `pii_forbidden` → "Restricted",
`kpi_forbidden` → "No access", and a `scope_forbidden` code → "Out of scope" — but the backend
emits `scope_incomplete`, which currently falls through to the raw-code default label.
(TODO-verify: align `errorLabel` with `scope_incomplete` or add the alias.)

## 4. Granting access — which knob for which outcome

| you want | change | where |
|---|---|---|
| role R sees KPI X (picker + by-reference query) | grant R the action named by X's `requiredActionUrl` | access-control actions/roleactions + `dss.KpiDefinition` |
| role R gets a curated default dashboard | grant R the pack's `requiredActionUrl` (and add X to `tiles`/`layout`) | access-control + `dss.DashboardPack` |
| role R sees only its own department/jurisdiction | author `OWN` for that role/axis in action 2008 and ensure HRMS carries the value | action 2008 policy + HRMS |
| role R sees the whole tenant | author `ALL` for both axes in action 2008 | action 2008 policy |
| anonymous/public page can show KPI X (Add KPI menu + anonymous query) | set `public:true` on X | `dss.KpiDefinition` (MDMS) |
| anonymous/public page shows KPI X **by default** | also list X in the `public-default` pack's `tiles` + `layout` | `dss.DashboardPack` (MDMS) |
| role R can open and use the dashboard | grant 2640–2644; add a `Dashboard` `tenant.citymodule` row for the home card | access-control + `30-view-access.md` |
| role R gets a sidebar entry | also grant navigation action 4557 | `30-view-access.md` §2 |

Navigation and API/catalog access are distinct action IDs but one access-control model. The 0→1
bootstrap grants 4557 and 2640–2644 together so a visible link cannot bounce into a denied view.
