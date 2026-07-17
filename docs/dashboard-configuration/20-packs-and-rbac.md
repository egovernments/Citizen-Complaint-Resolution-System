# 20 — Dashboard Packs and the Four RBAC Layers

## 1. `dss.DashboardPack` — who gets which default dashboard

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
    "roles": ["SUPERVISOR","PGR_SUPERVISOR","GRO","DGRO","PGR_LME","PGR_ADMIN","SUPERUSER"],
    "tiles":  ["cl_resolution_rate_count", "rs_breach_total", ...],   // KpiDefinition ids
    "layout": [ { "kpiId": "cl_resolution_rate_count", "x": 0, "y": 0, "w": 2, "h": 2 }, ... ]
  }
}
```

Semantics (`POST /pgr-services/v2/analytics/packs`):

- **Role match**: the **first** pack (in MDMS record order) whose `roles` overlap the caller's
  roles wins (`DashboardPack.matchesRoles`, `anyMatch`). There is no specificity scoring — order
  your packs most-specific-first. **Live example (bomet, 2026-07-09):** two packs exist —
  `executive-default` (roles `TICKET_REPORT_VIEWER`, `PGR_VIEWER`; 15 tiles) *before*
  `supervisor-default` (the seven supervisor roles; 11 tiles). `KE_ADMIN` carries `PGR_VIEWER`, so
  its `/packs` returns the **executive** pack first — even though it also holds
  `SUPERUSER`/`GRO`/`DGRO` that match `supervisor-default`. A pure supervisor (no `PGR_VIEWER`)
  correctly lands on `supervisor-default`. See `80-live-bomet-state.md` §3.
- **Ceiling filter**: pack `tiles`/`layout` are filtered down to the KPIs the caller can actually
  see (`rbac.visibleTo` + `status:published`). A pack can never leak a tile past the catalog
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

## 2. The four RBAC layers

Design series: `docs/dashboard-rbac-design/` (parts A–F + 70-view-management). What is actually
enforced in `backend/pgr-services/src/main/java/org/egov/pgr/analytics/`:

### Layer 1 — Row-scope ABAC (what rows a query may aggregate)

Resolved once per request by `PrincipalScopeResolver.resolve` ("the seam") and injected by
`AnalyticsPlanner.applyScope` as WHERE conjuncts. Never taken from the request body.

| principal | injected scope |
|---|---|
| any caller | tenant scope, always: state-root tenant → `tenant_id LIKE 'ke%'`, city tenant → `tenant_id = ?` |
| pure citizen | `account_id = <own uuid>` (self-scope) |
| employee | `department_code IN (<active HRMS assignment departments>)` — resolved live via `POST /egov-hrms/employees/_search?codes=<userName>` |
| employee with a `TENANT_WIDE_ROLES` role | unrestricted within tenant (`PGR_ADMIN`, `SUPERUSER`, `MDMS_ADMIN`, `HRMS_ADMIN`, `STADMIN`, `SUPERVISOR`, `PGR_SUPERVISOR`) |
| employee whose department cannot be resolved (no HRMS record, no active assignment, HRMS error) | **fail-closed**: sentinel department `__scope_denied__` that matches no row — unless they hold a tenant-wide role |

Boundary/jurisdiction scope (`boundary_path LIKE '<prefix>%'`) is wired end-to-end but
deliberately disabled in the resolver today (`boundaryPrefix = null` with the enabling block
commented out in `PrincipalScopeResolver.java` — see the inline rationale).

Operator consequences:

- A department-scoped supervisor's dashboard (all tiles, and the filter option lists) shows
  **only their departments' complaints**. That is scoping, not "missing data".
- An officer role that should see the dashboard **must have an active HRMS assignment with a
  department**, or hold a tenant-wide role — otherwise every tile returns zero rows.
- `department_code` on the grains comes from `RAINMAKER-PGR.ServiceDefs.department` per
  serviceCode; complaints whose type has no department are excluded for department-scoped users
  (NULL never matches an `IN` list).

### Layer 2 — Catalog visibility (`rbac.visibleTo`)

Per-KPI role ceiling, evaluated in `KpiDefinition.isVisibleTo`:

- `visibleTo: []` (or absent) → visible to **every authenticated** role. Not to anonymous.
- `visibleTo: ["ROLE_A","ROLE_B"]` → any listed role.
- `"PUBLIC"` in the list is an **additive audience marker**, not a ceiling: it opts the tile into
  anonymous access and is stripped before evaluating the authenticated ceiling (so tagging a tile
  PUBLIC never narrows who can see it; `["PUBLIC"]` alone = everyone incl. anonymous).

Applies uniformly to `/packs`, `/catalog/_search`, and `kpiId`-by-reference `/_query` calls.

### Layer 3 — Inline PII gate

The `kpiId` path is governed by layer 2, but `/_query` also accepts **inline** query bodies. An
inline query that projects an officer/citizen-identity column as a raw *dimension*
(`AnalyticsService.PII_DIMENSIONS`: `current_assignee_uuid`, `assignee_uuid`, `actor_uuid`,
`account_id`) is rejected with `pii_forbidden` unless the caller holds one of
`OFFICER_PII_ROLES` (`SUPERVISOR`, `PGR_SUPERVISOR`, `PGR_ADMIN`, `SUPERUSER`, `MDMS_ADMIN`,
`HRMS_ADMIN`). Aggregate `count_distinct` over these columns is *not* gated (never exposes an
individual UUID). Additionally, these columns are groupable/distinct-countable but **never
filterable** (no UUID probing), and the API returns raw UUIDs only — name resolution happens at
the edge with the caller's own credentials.

### Layer 4 — Public floor

An unauthenticated / role-less caller degrades to the synthetic `PUBLIC` role
(`AnalyticsService.extractRoles`), which may:

- see only tiles whose `visibleTo` explicitly contains `"PUBLIC"` (**10** live `ke` tiles, verified
  via anonymous `/packs` on bomet 2026-07-09 — `80-live-bomet-state.md` §2);
- run **only** `kpiId`-by-reference queries — every inline body gets `kpi_forbidden`.

This is a deliberate degrade-to-curated-aggregates, not a lock-out; it closed the old fail-open
where anonymous callers could read every `visibleTo: []` tile.

## 3. Error codes and what to do about them

Per-entry in a batch (`results.<name>.error` + top-level `partial: true`) or a 400 body on a
single query. Codes are the prefix before `:` in the message (`AnalyticsService.err`).

| code | meaning | operator action |
|---|---|---|
| `scope_incomplete` | the caller's mandatory row-scope (citizen / department / boundary) cannot be **enforced on the target grain** — the grain lacks that scope column, so the server refuses rather than silently widening | Since `V20260629000000__grain_scope_columns.sql` all three grains carry department + citizen axes, so this signals a custom grain/def problem, not a user problem |
| `kpi_forbidden` | kpiId not found, not `published`, or caller's roles fail `visibleTo`; also any inline/public-floor violation | Check def status + `visibleTo` vs the user's roles; FE renders "No access" |
| `pii_forbidden` | inline query projected a PII dimension without an officer-PII role | Use a curated KPI def (layer 2) instead of inline, or grant the proper role; FE renders "Restricted" |
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
| role R sees KPI X (picker + by-reference query) | add R to X's `rbac.visibleTo` (or leave `[]` for all-authenticated) | `dss.KpiDefinition` (MDMS) |
| role R gets a curated default dashboard | add R to a pack's `roles` (and X to its `tiles`/`layout`) | `dss.DashboardPack` (MDMS) |
| role R sees only its own department's numbers | give the user an HRMS assignment with that department; keep R out of `TENANT_WIDE_ROLES` | HRMS + (code constant, deploy) |
| role R sees the whole tenant | grant one of the `TENANT_WIDE_ROLES` (e.g. `PGR_SUPERVISOR`) | HRMS/user roles |
| anonymous/public page shows KPI X | add `"PUBLIC"` to X's `visibleTo` | `dss.KpiDefinition` (MDMS) |
| role R can *open the dashboard view at all* (home card, deep-link route) | add R to `dss.DashboardConfig` `allowedRoles` (MDMS; the FE falls back to its built-in `DASHBOARD_ROLES` when the record is absent) **and** a `Dashboard` `tenant.citymodule` row (home card) — **a different system entirely** | `70-esbuild-embedding.md` §4, `30-view-access.md` |
| role R gets a *sidebar* entry for the dashboard | ACCESSCONTROL actions/roleactions | `30-view-access.md` §2 (note the live bomet sidebar outage, `80-live-bomet-state.md` §5) |

The last rows are the classic confusion: `visibleTo`/packs govern *what renders inside* the
dashboard; whether the user can *navigate to* it is a different stack — the FE gate resolved from
`dss.DashboardConfig` + home card + always-on deep-link route (`70-esbuild-embedding.md`), plus the optional
digit-ui sidebar access-control surface (`30-view-access.md`). Three independent gates; align all
that apply.
