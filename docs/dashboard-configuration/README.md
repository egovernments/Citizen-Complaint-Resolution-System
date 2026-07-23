# Configuring the CCRS Supervisor Dashboard

Operator/developer documentation for the catalog-driven supervisor dashboard: pgr-services'
dynamic analytics API (`/v2/analytics/*`) + the MDMS `dss` catalog + the digit-ui dashboard
frontend. Two audiences:

- **Operators / implementers** — configure a deployment through MDMS. Almost everything a
  deployment needs to change is data: **no rebuild, no deploy, no restart.**
- **Developers** — extend the platform: new grain columns, planner/catalog changes, new FE viz
  kinds.

## The config surface at a glance

| you want to change | mechanism | deploy needed? | doc |
|---|---|---|---|
| add / edit / retire a KPI tile (query, viz, thresholds, params) | MDMS `dss.KpiDefinition` (state root) | **No** | [10-kpi-catalog.md](10-kpi-catalog.md) |
| which roles see which KPI | `rbac.visibleTo` on the def | **No** | [10](10-kpi-catalog.md) §7, [20](20-packs-and-rbac.md) |
| default tile set + grid layout per role | MDMS `dss.DashboardPack` | **No** | [20-packs-and-rbac.md](20-packs-and-rbac.md) |
| expose a KPI to anonymous/public | add `"PUBLIC"` to `visibleTo` | **No** | [20](20-packs-and-rbac.md) §2 |
| which rows a user's tiles aggregate (department scoping) | HRMS assignments (+ role choice) | **No** | [20](20-packs-and-rbac.md) layer 1 |
| home card for the dashboard | MDMS `tenant.citymodule` (`Dashboard` row) | **No** | [30-view-access.md](30-view-access.md) §1a |
| which roles can *open* the view (card + deep-link route) | MDMS `dss.DashboardConfig` `allowedRoles` (fallback: `products/dashboard/roles.js` `DASHBOARD_ROLES`) | **No** | [70-esbuild-embedding.md](70-esbuild-embedding.md) §4 |
| how the dashboard is mounted inside digit-ui | esbuild product module + always-on route fallback | — | [70-esbuild-embedding.md](70-esbuild-embedding.md) |
| sidebar entry + role gating of the view | MDMS `ACCESSCONTROL-ACTIONS-TEST` + `ACCESSCONTROL-ROLEACTIONS` | **No** | [30-view-access.md](30-view-access.md) |
| menu/card labels | localization `_upsert` + cache bust | **No** | [30](30-view-access.md) §3–4 |
| per-subtype resolution SLA | MDMS `RAINMAKER-PGR.ServiceDefs.slaHours` | **No** (next MV refresh) | [50-sla-and-hierarchies.md](50-sla-and-hierarchies.md) |
| escalation ladder timers | MDMS `RAINMAKER-PGR.EscalationConfig` | **No** (next MV refresh) | [50](50-sla-and-hierarchies.md) §1 |
| complaint-type taxonomy (N-level) | MDMS `RAINMAKER-PGR.ComplaintHierarchy(+Definition)` | **No** (next MV refresh) | [50](50-sla-and-hierarchies.md) §2 |
| filter-bar option lists | derived automatically (ABAC-scoped distincts) | **No** | [40-filters-and-options.md](40-filters-and-options.md) |
| MV refresh cadence / freshness | `pgr.dashboard.refresh.*` properties | restart pgr-services | [60-operations.md](60-operations.md) |
| new queryable column / grain | Flyway migration + `AnalyticsCatalog` registration | **Yes** (pgr-services image) | [50](50-sla-and-hierarchies.md) §3 |
| SLA precedence / grain shape | Flyway migration (append-only; reproduce the MVs) | **Yes** | [50](50-sla-and-hierarchies.md) |
| new `viz.kind` / render behavior | `KpiTile.jsx` + dashboard components | **Yes** (FE bundle) | [10](10-kpi-catalog.md) §3 |
| scope-resolution policy (HRMS → policy engine) | `PrincipalScopeResolver` ("the seam") | **Yes** | [20](20-packs-and-rbac.md) layer 1 |
| any on-screen text / new language | localization `_upsert` (module `rainmaker-dashboard` + platform families) + cache bust | **No** | [90-localization.md](90-localization.md) |

Rule of thumb: **tenant-specific values live in MDMS, never in code.** If you find yourself
wanting to hardcode a deployment's ward list, SLA, or role name in the FE or a service — stop
and find the master.

## The documents

| doc | contents |
|---|---|
| [10-kpi-catalog.md](10-kpi-catalog.md) | `dss.KpiDefinition` anatomy: query grammar essentials, every `viz.kind`, params & server-side defaults, status lifecycle, versioning, and the add-a-KPI-end-to-end cookbook |
| [20-packs-and-rbac.md](20-packs-and-rbac.md) | `dss.DashboardPack` (roles/tiles/12-col layout), the four RBAC layers (row-scope ABAC, `visibleTo`, inline PII gate, public floor), error-code table, which knob grants what |
| [30-view-access.md](30-view-access.md) | Reaching the dashboard in digit-ui: citymodule, actions/roleactions + `/access/v1/actions/mdms/_get`, localization keys, the three-layer cache-bust story, and the mdms-v2 operational gotchas |
| [40-filters-and-options.md](40-filters-and-options.md) | Where the global filter bar's options come from (scoped `_query` distincts), persistence/reconciliation, and the "option shows no data" checklist |
| [50-sla-and-hierarchies.md](50-sla-and-hierarchies.md) | SLA target: the three sources and COALESCE order (post-#1028); boundary & complaint hierarchies as materialized path + level registry (post-#1079); extending the catalog |
| [60-operations.md](60-operations.md) | MV refresh scheduler + manual REFRESH commands, the `asOf` staleness signal, tenant-bootstrap coverage (and the `dss.*` gap), what a redeploy wipes |
| [70-esbuild-embedding.md](70-esbuild-embedding.md) | **The frontend architecture (PR #1062).** How the dashboard embeds into digit-ui: module registry, `App.js` `enabledModules`, the always-on route fallback vs the citymodule-gated card, `roles.js` `DASHBOARD_ROLES`, embedded mode, the analytics API client + MDMS context-path resolution, and the catalog→tile render pipeline (`useCatalog`/`useCatalogLayout`/`KpiTile`) |
| [80-live-bomet-state.md](80-live-bomet-state.md) | **Live-verified snapshot (2026-07-09).** A reproducible bomet probe: 37 published defs / 10 PUBLIC tiles, the two-pack first-match (`executive-default` vs `supervisor-default`), the anonymous inline lock, the **catalog-divergence trap** (repo seed vs mdms-v2 store vs served catalog; the #1026 stale-record no-op), the sidebar seeding bug (ACCESSCONTROL actions under `-TEST`; fixed via the actions bridge, CCRS#1106), and an empty-tile triage flow |
| [90-localization.md](90-localization.md) | **Localizing the dashboard.** The no-fallback rule (missing message ⇒ raw key/code on screen), the three bundles the module loads, every dashboard-owned key family (`DASHBOARD_*`, KPI `titleKey`/`subtitleKey`, series/column `labelKey`s, geo-tier vocabulary), the reused platform families (`COMPLAINT_HIERARCHY.*`, boundary codes, departments), the gap-triage table, the generated en_IN pack + tenant_bootstrap floor, and the add-a-language cookbook |

## Primary sources (cross-linked throughout)

- Query grammar reference: `backend/pgr-services/ANALYTICS-QUERY-API.md`
- RBAC design series: `docs/dashboard-rbac-design/`
- Live MDMS examples: `ansible/nairobi-mdms/mdms/dss/KpiDefinition.json`, `DashboardPack.json`
- Enabling it on a running deployment: `local-setup/scripts/enable-dashboard.sh` (run `--help`
  for the full runbook — prerequisites, the role-remap decision, and a symptom→cause table for
  every known blocker), with supporting schemas + message packs in `local-setup/db/dss-mdms-seed/`
- Backend: `backend/pgr-services/src/main/java/org/egov/pgr/analytics/`
- Frontend (deployed, post-#1062): `digit-ui-esbuild/products/dashboard/` — module root (`Module.js`,
  `roles.js`, `DashboardCard.js`) with the engine under `src/` (`AdminDashboard.jsx`, `components/`,
  `hooks/`, `services/`, `config/`). The reference tree `frontend/micro-ui/web/src/dashboard/` is the
  near-verbatim source of the port; older cites of it map to the `products/dashboard/src/` path.
- Grain migrations: `backend/pgr-services/src/main/resources/db/migration/main/V20260608*/V20260629*/V20260708*`

In-flight changes referenced with "changed in PR #NNNN" notes: server-side params defaults +
SLA-target COALESCE (**#1026/#1028**), Complaint Type Details all-time coverage (**#1074**),
ABAC-scoped filter options (**#1075**), map mounted through empty results (**#1076**),
registry-driven hierarchy levels (**#1079**).

**PR provenance (read this if the numbers look off).** These docs were authored against in-flight
branches. The dashboard bug-train landed under a *renumbered* set of PRs; treat the pairs as
aliases: complaint-type coverage **#1074 ≈ #1026**, ABAC filter options **#1075 ≈ #1030**, map
survives empty results **#1076 ≈ #1031**, hierarchy grains **#1079** (SLA-target COALESCE **#1028**,
same migration `V20260708000000__sla_and_hierarchy_grains.sql`). The **esbuild embedding** that
made the dashboard live inside digit-ui is **PR #1062** — see [70-esbuild-embedding.md](70-esbuild-embedding.md).
All are live on bomet; the live *catalog records* may still lag the repo seed (see
[80-live-bomet-state.md](80-live-bomet-state.md) §4).
