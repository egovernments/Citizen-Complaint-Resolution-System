# 70 — Frontend Architecture: the #1062 esbuild Embedding

Everything up to this doc treats the dashboard as a *catalog + API*. This doc is the frontend
half: **how the supervisor dashboard actually loads inside the DIGIT employee app**, after PR
**#1062** moved it out of its standalone build and into `digit-ui-esbuild` as an embedded product
module. It is the ground truth for "where does the code live", "how is the route mounted", "who
gates the view", and "how does the FE talk to the analytics API".

> **Source of truth for paths.** Before #1062 the dashboard lived at
> `frontend/micro-ui/web/src/dashboard/`. That tree is the *reference* implementation. The
> **shipped, deployed** dashboard is `digit-ui-esbuild/products/dashboard/` — an esbuild
> "product" mounted into the core employee chrome. Where older docs in this folder still cite
> `frontend/micro-ui/...`, read the same file under `digit-ui-esbuild/products/dashboard/...`;
> the module contents are a near-verbatim port (the render engine, hooks, and services are the
> same files).

## 1. What #1062 moved, and why

The dashboard used to ship as its own SPA with its own login gate, its own `100dvh` shell, and
its own sidebar. #1062 folded it into the **employee** DIGIT UI so that:

- there is **one** login/session (the employee token), not a second dashboard login;
- it inherits the employee topbar, tenant switcher, and chrome;
- it is served from the same static bundle at **`/digit-ui/employee/dashboard`** (no separate
  deploy, no separate nginx alias);
- the MDMS context path, tenant id, and analytics base are resolved from the host
  `globalConfigs` instead of dashboard-only env.

The module keeps its standalone capability (the `DashboardLogin` gate and self-owned shell are
still in the tree) but runs in **embedded mode** inside digit-ui — see §5.

## 2. Module registration — how it enters the app

Three files wire the product into the core app.

**`digit-ui-esbuild/products/dashboard/Module.js`** — the registration entry point.

```js
const componentsToRegister = { DashboardModule, DashboardCard };
export const initDashboardComponents = () => {
  Object.entries(componentsToRegister).forEach(([key, value]) =>
    Digit.ComponentRegistryService.setComponent(key, value));
};
```

- `DashboardModule` — the route component. Role-gated (§4), renders `<AdminDashboard embedded/>`.
- `DashboardCard` — the employee-home card. Same role gate, links to the deep route.

**`digit-ui-esbuild/src/App.js`** — the host wiring.

- `import { initDashboardComponents } from "../products/dashboard/Module";` (line 7)
- `const enabledModules = ["Utilities", "PGR", "Dashboard"];` (lines 23–27) — the build's
  enabled-module allow-list. `"Dashboard"` here is what lets a `Dashboard` citymodule row survive
  the `citymodule ∩ enabledModules` filter (see `30-view-access.md` §1 and §4 below).
- `initDashboardComponents();` (line 46), alongside `initUtilitiesComponents()` and
  `initPGRComponents()`, registers the two components before `<DigitUI>` renders.
- HRMS + Workbench are deliberately **omitted** from `enabledModules` — those are managed from the
  separate configurator app (closes CCRS#560/#561). The dashboard is one of only three FE modules
  the employee app ships.

Component **codes** matter: the core resolves a module's route via
`getComponent(`${code}Module`)` and its home card via `getComponent(`${code}Card`)`. The
dashboard's code is **`Dashboard`**, so its components must be registered as `DashboardModule`
and `DashboardCard` exactly (they are).

## 3. Route mounting — the always-on fallback

`digit-ui-esbuild/packages/modules/core/src/components/AppModules.js` builds the employee route
table. Two paths reach the dashboard:

1. **Citymodule-driven route** (lines 24–37). `appRoutes` is built from `modules` (=
   `initData.modules` = MDMS `tenant.citymodule` ∩ `enabledModules`). If a `Dashboard` citymodule
   row is present, a `/employee/dashboard` route is generated from it and matched first in the
   `<Switch>`.
2. **Always-on fallback** (lines 38–57). Regardless of citymodule, AppModules looks up the
   registered `DashboardModule` and, if present, mounts an extra `<Route path="${path}/dashboard">`
   at the end of the switch:

   ```js
   const DashboardFallbackModule = Digit.ComponentRegistryService.getComponent("DashboardModule");
   ...
   {DashboardFallbackModule && (
     <Route path={`${path}/dashboard`}>
       <DashboardFallbackModule stateCode={stateCode} moduleCode="Dashboard" .../>
     </Route>
   )}
   ```

   When the citymodule row *is* present, the `appRoutes` entry matches first, so this never
   double-mounts; when it is absent, this fallback still makes **`/digit-ui/employee/dashboard`
   reachable by deep link**. Role-gating lives inside `DashboardModule`, so the fallback is safe.

**Consequence (the card-vs-route asymmetry):** the **route** is always reachable (deep link),
but the **home card** is only rendered when a `Dashboard` module is in `initData.modules`. The
employee home (`packages/modules/core/src/components/Home.js`, `EmployeeHome`) does
`modules.map(({code}) => getComponent(`${code}Card`))` — a card is emitted only for codes present
in `modules`. So:

| surface | requires | if missing |
|---|---|---|
| deep link `/employee/dashboard` | `DashboardModule` registered (always true) | — |
| home **card** | `Dashboard` in `tenant.citymodule` **and** in `enabledModules` | no card; deep link still works |
| left **sidebar** entry | ACCESSCONTROL actions/roleactions grant (`30-view-access.md` §2) | no sidebar entry (see `80-live-bomet-state.md` for the current bomet sidebar outage) |

This is why the operational guidance is "reach the dashboard via the home card + deep link" — the
card and route are self-contained in the dashboard product; the sidebar is a separate MDMS surface.

## 4. Role gating — `roles.js`, one gate on two surfaces

`digit-ui-esbuild/products/dashboard/roles.js`:

```js
export const DASHBOARD_ROLES =
  ["SUPERVISOR", "PGR_SUPERVISOR", "GRO", "DGRO", "PGR_LME", "PGR_ADMIN", "SUPERUSER"];
```

Both `DashboardModule` (route) and `DashboardCard` (home card) gate on
`Digit.UserService.hasAccess(DASHBOARD_ROLES)` — the card returns `null`, the route `Redirect`s to
`/employee`, when the check fails. They therefore **always agree**.

The check is **tenant-agnostic by design** (role *code* only). The rationale is load-bearing:
employee roles live at the **state-root** tenant (`ke`) while the working tenant is usually a city
tenant (`ke.nairobi`). `Digit.Utils.didEmployeeHasAtleastOneRole` filters by the *current* tenant
and would wrongly hide the dashboard on a city tenant, so the dashboard uses the code-only
`hasAccess` path instead (see the comment block atop `roles.js` and `Module.js`).

**This is the FE half of the role story; the API half is the pack `roles` + KPI `rbac.visibleTo`
(`20-packs-and-rbac.md`).** They are independent gates you must align:

- `DASHBOARD_ROLES` decides **whether the view opens at all** (card/route).
- pack `roles` decides **which default tiles** the opened view shows (`/packs` first-match).
- KPI `rbac.visibleTo` decides **which tiles are visible/queryable** at all.

To let a new role *see the dashboard*, it must be added to **all three** where relevant: a role in
a pack but not in `DASHBOARD_ROLES` can be granted a dashboard but cannot open the view; a role in
`DASHBOARD_ROLES` but in no pack opens an empty view (falls through to "all visible defs, no
layout"). Live proof of the pack-first-match subtlety is in `80-live-bomet-state.md` §3.

## 5. Embedded vs standalone — the `embedded` prop

`digit-ui-esbuild/products/dashboard/src/AdminDashboard.jsx`:

- `DashboardModule` renders `<AdminDashboard embedded />`.
- `embedded` short-circuits the standalone login: `useState(() => embedded || hasDashboardSession())`
  — inside digit-ui the host guarantees a session (AppModules already redirected anonymous users
  to login), so the dashboard's own `DashboardLogin` gate is skipped and it never owns sign-out.
- `embedded` also suppresses the standalone shell (internal sidebar, `100dvh` layout) so the grid
  sits inside the employee chrome. `onSignOut` is passed only in the non-embedded path.

The standalone code (`DashboardLogin`, `hasDashboardSession`, `clearDashboardSession`) is retained
for the rare standalone build but is dead in the deployed employee app.

## 6. Talking to the analytics API — `analyticsService.js`

`digit-ui-esbuild/products/dashboard/src/services/analyticsService.js` is the single API client.

- **Base URL** — `getAnalyticsBase()`: `REACT_APP_ANALYTICS_BASE` if set (trailing slash
  stripped), else `"/pgr-analytics"` in `development`, else **`"/api/analytics"`**. On a real
  deployment nginx proxies that prefix to `pgr-services/v2/analytics`.
- **Auth** — reads the employee token from `localStorage["Employee.token"]` and user info from
  `localStorage["Employee.user-info"]`, and folds both into `RequestInfo.authToken` /
  `RequestInfo.userInfo`. Requests use `credentials: "omit"` (bearer-in-body, not cookie). The
  server derives roles/scope from that `RequestInfo.userInfo` (`AnalyticsService.extractRoles`,
  `PrincipalScopeResolver`).
- **Tenant** — `getTenantId()`: `globalConfigs.getConfig("STATE_LEVEL_TENANT_ID")` →
  `REACT_APP_STATE_LEVEL_TENANT_ID` → `"ke"`. Sent as `tenantId` on every call. The service
  collapses it to the state root for the MDMS catalog read anyway.
- **Endpoints** (all POST): `fetchPack` → `/packs`, `fetchCatalog` → `/catalog/_search`
  (`filters.status = "published"`), `runKpiBatch`/`runBatchQueries` → `/_query`, `fetchSchema` →
  `/_schema`. `fetchPack`/`fetchCatalog` return **viz schema only** — never query bodies or rbac.

### MDMS context-path resolution (commit `a7b8a6d34`)

The complaint-type dropdown reads `RAINMAKER-PGR.ComplaintHierarchy` from MDMS directly
(`services/complaintHierarchyService.js`). Deployments serve MDMS under **`mdms-v2`** (with a v1
-compat search under it), not the legacy `egov-mdms-service`, so `getMdmsSearchUrl()` resolves the
context path from the host config:

```js
const contextPath = get("MDMS_V1_CONTEXT_PATH") || get("MDMS_CONTEXT_PATH") || "egov-mdms-service";
return `/${contextPath}/v1/_search`;
```

This is the fix in `a7b8a6d34` ("resolve MDMS context path from globalConfigs"): the embedded
dashboard now uses the same MDMS path the host UI uses, instead of a hardcoded `egov-mdms-service`
that 404s on mdms-v2 deployments. Falls back to `egov-mdms-service` only in a standalone build
with no `globalConfigs.js`.

## 7. The render pipeline — catalog in, tiles out

`AdminDashboard.jsx` is a **pure catalog engine**: it renders entirely from the backend catalog,
with no hardcoded widget config. The flow:

```
useCatalog(tenantId)            → { kpis: {[kpiId]: def}, pack: { tiles, layout } }
useCatalogLayout(kpis, layout)  → grid layout (seeded from pack.defaultLayout, persisted local)
buildRefs(tiles, kpis, filters) → { [tileKey]: { kpiId, params } }
runKpiBatch(refs)               → { results: { [tileKey]: { columns, rows, asOf, scope } } }
assembleResult(...)             → one merged result per tile (+ __prior / __series / __pins)
<KpiTile def result />          → viz.kind-driven render engine
```

Key files and behaviours:

- **`hooks/useCatalog.js`** — one `Promise.all([fetchPack, fetchCatalog])`. `kpis` is the full
  role-filtered catalog (for the add-KPI picker); `pack.tiles` is gated to ids present in the
  catalog. Degrades gracefully (error state, empty) if the endpoints 404, so a missing catalog
  never white-screens the app.
- **`hooks/useCatalogLayout.js`** — kpiId-keyed react-grid-layout state. Seeds from
  `pack.defaultLayout`; a **saved** layout (per-browser localStorage, key
  **`ccrs.dashboard.catalog-layout.v1`**) wins over the seed, including an intentionally-empty
  layout (so removing every tile survives reload). Size/collision constraints are derived from
  each tile's `viz.kind` (`sizeConstraintsForKpi`). `resetLayout` re-seeds from the pack.
  Persistence is debounced (300 ms) on drag/resize.
- **`AdminDashboard.buildRefs`** — one `{kpiId, params}` ref per tile, plus companion refs keyed
  by `viz.kind`: `__prior` (delta cards, `compare:"prior"`), `__series` (sparkline cards,
  `series:"daily"`), `__pins` (map tiles, the internal `cl_map_complaint_pins` source). Only card
  and map kinds emit companions, so a plain chart issues a single query.
- **`AdminDashboard.globalParams`** — the filter-bar → param mapping: `geography!="all"` → `ward`,
  `complaintType!="all"` → `serviceCode`, an active date range → `dateFrom`/`dateTo` (`yyyy-MM-dd`).
  **No global `window` is emitted**, so each def keeps its baked window when no date range is
  active — and live-open-snapshot tiles ignore the date range by design (server side,
  `KpiQueryComposer.isLiveOpenSnapshot`; see `10-kpi-catalog.md` §2 and `40-filters-and-options.md`).
- **`components/KpiTile.jsx`** — the generic render engine (`renderByKind`). Zero hardcoded column
  names: it reads `columns[].role` (`dimension`/`measure`) and the `viz` descriptor to adapt the
  generic `_query` envelope into each polished chart/card/table/map component. This is where a new
  `viz.kind` is added (a `switch` arm + an adapter) — a **FE change**, unlike adding a KPI (MDMS
  only). See `10-kpi-catalog.md` §3 for the kind table.
- **`components/GeographyChoroplethMap.jsx` / `OpenComplaintsByGeographyWidget.jsx`** — the map
  widget renders through empty results (survives `rows: []`), fetching its own ward geometry; the
  tile's ward aggregate + `__pins` companion feed its choropleth + pin layers.

## 8. Where a change goes (FE decision table)

| you want to change | edit | rebuild? |
|---|---|---|
| add/retire a KPI tile, its query, thresholds, params | `dss.KpiDefinition` (MDMS) | no |
| default tiles + layout for a role | `dss.DashboardPack` (MDMS) | no |
| a brand-new `viz.kind` render behaviour | `products/dashboard/src/components/KpiTile.jsx` (+ a component) | **yes** (FE bundle) |
| which roles can *open* the view | `products/dashboard/roles.js` `DASHBOARD_ROLES` | **yes** (FE bundle) |
| analytics base / tenant / MDMS path | host `globalConfigs` (`STATE_LEVEL_TENANT_ID`, `MDMS_V1_CONTEXT_PATH`, `REACT_APP_ANALYTICS_BASE`) | no (config) |
| home card visibility | `tenant.citymodule` `Dashboard` row (`30-view-access.md`) | no |
| card/menu labels | localization `DASHBOARD_CARD_HEADER`, `ACTION_TEST_DASHBOARD` (`30-view-access.md`) | no |

Note that `DASHBOARD_ROLES` and any new `viz.kind` are the **only** two everyday dashboard knobs
that require an FE rebuild — everything else is MDMS/config. A redeploy overwrites the served
bundle (`60-operations.md` §4), so FE edits must land in `products/dashboard/` → PR → image, never
as a hand-patch to `/opt/*/build/`.
