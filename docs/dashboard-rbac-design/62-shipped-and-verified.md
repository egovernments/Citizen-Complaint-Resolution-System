# 62 — Shipped Realization & Live Verification (#1062 and the analytics RBAC train)

The rest of this series is **design + critique** — authored, as its README says, before the code
existed ("no code changed; that is by design"). This document closes that loop: the design
**shipped**, and this is where each design layer maps to the **implemented** file:line and the
**live bomet** probe that proves it. Read it as the answer to "did we actually build what Parts
A–F specified, and is it enforced in production?"

For the operator-facing view of the same system, see `../dashboard-configuration/` (esp.
`70-esbuild-embedding.md` for the frontend and `80-live-bomet-state.md` for the live snapshot).

## 1. Frontend inversion → shipped as a digit-ui product module (PR #1062)

Part 60 ("frontend inversion") proposed a catalog-driven FE with `useCatalog`, a generic
`columns[].role` renderer, a per-tile errors map, and `{kpiId, params}` invocation. All of it
shipped, and the dashboard now runs **embedded in the digit-ui employee app** rather than as a
standalone SPA:

| design intent | shipped as |
|---|---|
| catalog-driven inventory (`useCatalog`) | `digit-ui-esbuild/products/dashboard/src/hooks/useCatalog.js` — `Promise.all([fetchPack, fetchCatalog])` |
| generic `columns[].role` renderer | `products/dashboard/src/components/KpiTile.jsx` `renderByKind` — dispatches on `viz.kind`, reads `columns[].role` (`dimension`/`measure`), zero hardcoded column names |
| `{kpiId, params}` invocation | `products/dashboard/src/AdminDashboard.jsx` `buildRefs` → `runKpiBatch` → `POST /_query {queries:{tileKey:{kpiId,params}}}` |
| per-tile errors map | `AdminDashboard` reads `res.errors[kpiId]` → `KpiTile` renders `errorLabel(code)` |
| scope badge / asOf plumbing | each result carries `asOf`/`scope`; `CardUpdatedStamp` + header stamps |

The embedding itself (module registry, `App.js` `enabledModules`, the always-on route fallback vs
the citymodule-gated card, `roles.js`) is fully documented in
`../dashboard-configuration/70-esbuild-embedding.md`. The relevant RBAC fact: the FE view gate is
**`products/dashboard/roles.js` `DASHBOARD_ROLES`** (`SUPERVISOR, PGR_SUPERVISOR, GRO, DGRO,
PGR_LME, PGR_ADMIN, SUPERUSER`), checked tenant-agnostically via `Digit.UserService.hasAccess`
(role-code only, because employee roles live at the state root while the working tenant is a city
tenant). This is the FE realization of the "who may open the view" layer.

## 2. The backend RBAC layers — design → code → live proof

Every layer the design demanded is enforced in
`backend/pgr-services/src/main/java/org/egov/pgr/analytics/`. (This directly refutes the earlier
codex "[MAJOR] No kpiId, catalog, or pack API exists" finding in `60-frontend-inversion.md` — it
now exists.)

| layer | design part | shipped enforcement | live proof (bomet 2026-07-09) |
|---|---|---|---|
| **Identity → roles** | A | `AnalyticsService.extractRoles` — anonymous/role-less degrades to `PUBLIC` (not empty-set fail-open) | anon `/packs` → 10 PUBLIC tiles only |
| **Row-scope ABAC** | B/C | `PrincipalScopeResolver.resolve` ("the seam") → `AnalyticsPlanner.applyScope` WHERE conjuncts; **fail-closed** for constrained employees (sentinel `__scope_denied__`), tenant-wide roles unrestricted | departments injected from live HRMS `_search` |
| **Catalog visibility** | D | `KpiDefinition.isVisibleTo` — `visibleTo:[]` = all authenticated; `PUBLIC` additive; anon needs explicit `PUBLIC` | `/catalog/_search` (KE_ADMIN) = 37 published visible |
| **Inline PII gate** | D | `AnalyticsService.projectsForbiddenPii` — inline dimension projection of `current_assignee_uuid`/`assignee_uuid`/`actor_uuid`/`account_id` → `pii_forbidden` unless `OFFICER_PII_ROLES` | — |
| **Public floor** | F | `AnalyticsService.isPublicFloor` — PUBLIC caller: only PUBLIC-tagged KPIs, **no inline** | anon inline `/_query` → `kpi_forbidden` |
| **Pack selection** | E | `KpiCatalogService.getBestPack` — first pack whose `roles` overlap, ceiling-filtered to visible tiles | see §3 |

The two convergent must-fixes the critique flagged are both addressed in the shipped code:

- **Fail-open identity** → closed: `extractRoles` degrades to `PUBLIC` and `KpiDefinition.isVisibleTo`
  treats a PUBLIC caller as "must be explicitly PUBLIC-tagged" (the old `visibleTo:[]`⇒all no
  longer leaks to anonymous).
- **Fail-open row-scope for missing principals** → closed: `PrincipalScopeResolver.unresolvedScope`
  returns the deny-all sentinel department for constrained roles; only `TENANT_WIDE_ROLES`
  (`PGR_ADMIN, SUPERUSER, MDMS_ADMIN, HRMS_ADMIN, STADMIN, SUPERVISOR, PGR_SUPERVISOR`) stay
  unrestricted without an HRMS department.

(Still true to the design's caveat: **jurisdiction/boundary scope is deliberately disabled** —
`PrincipalScopeResolver` sets `boundaryPrefix = null` with the enabling block commented out;
department is the sole active row-scope axis. The wiring exists; flip it in the resolver, no
downstream change — the seam holds.)

## 3. Pack first-match — the live PGR_VIEWER demonstration

The design's Part-E "first pack whose roles overlap" is observable on bomet. Two packs exist, in
record order: `executive-default` (roles `TICKET_REPORT_VIEWER`, `PGR_VIEWER`; 15 tiles) then
`supervisor-default` (the seven `DASHBOARD_ROLES`; 11 tiles). `KE_ADMIN` carries `PGR_VIEWER`, so
`getBestPack` returns **`executive-default`** first — even though KE_ADMIN also holds
`SUPERUSER`/`GRO`/`DGRO` matching `supervisor-default`. There is no specificity score
(`DashboardPack.matchesRoles` is a plain `anyMatch`), so **record order is the tie-break** — order
packs most-specific-first. A pure supervisor (no `PGR_VIEWER`) lands on `supervisor-default` as
intended. Full probe: `../dashboard-configuration/80-live-bomet-state.md` §3.

This is the concrete answer to "how do I align a new role to a dashboard": add the role to a
pack's `roles` (and place that pack ahead of any broader pack it must beat), ensure its tiles pass
`visibleTo`, and — for the role to *open* the view at all — add it to the FE `DASHBOARD_ROLES`
gate. Three independent gates (`70` §4).

## 4. Open item carried from the design critique

- **`errorLabel` vs `scope_incomplete`** — `KpiTile.errorLabel` maps `pii_forbidden`→"Restricted",
  `kpi_forbidden`→"No access", `scope_forbidden`→"Out of scope", but the backend emits
  **`scope_incomplete`** (`AnalyticsService`), which falls through to the raw code. Still
  unresolved as of this checkout — align the label map or add the alias. (Also tracked in
  `../dashboard-configuration/20-packs-and-rbac.md` §3.)
- **`_schema` remains unauthenticated** and still lists UUID/`account_id` dimensions
  (`AnalyticsController.schema` → `AnalyticsService.schema`). It is a capabilities descriptor (no
  data), but the design's Part-D note to gate/replace it as a catalog source has not been actioned;
  the shipped catalog surface is `/catalog/_search` + `/packs` (which *are* role-filtered and never
  emit `query`/`rbac`). Prefer those; treat `/_schema` as a dev/editor aid only.
