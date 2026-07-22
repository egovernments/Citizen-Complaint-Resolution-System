# 60 — Operations: Freshness, Bootstrap, Redeploys

## 1. Materialized-view refresh — how the numbers get fresh

The dashboard never reads live transactional tables; every KPI reads the grains
(`complaint_facts`, `complaint_events` — materialized views — and the
`complaint_open_state_daily` table).

**One scheduler refreshes everything**:
`backend/pgr-services/src/main/java/org/egov/pgr/service/DashboardRefreshScheduler.java`, every
`pgr.dashboard.refresh.interval.ms` (default **300000 = 5 min**, gated by
`pgr.dashboard.refresh.enabled=true` — both in `backend/pgr-services/src/main/resources/application.properties`).
Per run, in order:

1. **V2 grains, dependency order**: `complaint_events` then `complaint_facts` (facts is built
   FROM events) — `REFRESH MATERIALIZED VIEW CONCURRENTLY`, each wrapped in its own try/catch so
   one failure only logs a warning and the rest proceed.
2. **Daily backlog capture**: idempotent upsert into `complaint_open_state_daily` (one row per
   still-open complaint per day; `ON CONFLICT (snapshot_date, service_request_id) DO NOTHING` —
   the day's backlog is fixed at its **first** capture that day).
3. **Legacy MVs** (back-compat, superseded by the grains): `pgr_mv_kpi`, `pgr_mv_monthly`,
   `pgr_mv_monthly_source`, `pgr_mv_dimension`
   (from `V20260422000000__create_dashboard_mvs.sql`).

> Historical note: `backend/pgr-services/ANALYTICS-QUERY-API.md` §9 still says the scheduler
> "does not yet include" the V2 grains, and some migration headers say "MVs are refreshed
> manually in ops" — both predate the scheduler covering the grains; the scheduler above is the
> current source of truth. (TODO-verify: update those stale mentions; if a given deployment
> runs with `pgr.dashboard.refresh.enabled=false`, the manual commands below ARE the refresh
> story there.)

**Manual refresh** — needed right after a data backfill, an MDMS SLA/hierarchy edit you want
reflected *now*, or on an instance running with the scheduler disabled:

```sql
-- order matters; CONCURRENTLY works because every MV has the required unique index
-- (ux_complaint_events, ux_complaint_facts, pgr_mv_*_idx)
REFRESH MATERIALIZED VIEW CONCURRENTLY complaint_events;
REFRESH MATERIALIZED VIEW CONCURRENTLY complaint_facts;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_kpi;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_monthly_source;
REFRESH MATERIALIZED VIEW CONCURRENTLY pgr_mv_dimension;
```

(`psql` into the pgr-services database; on compose deployments:
`docker exec -it <postgres-container> psql -U <user> -d <db>`.) Do **not** hand-insert into
`complaint_open_state_daily`; the scheduler's upsert owns it.

Remember: MDMS masters (ServiceDefs SLA, EscalationConfig, ComplaintHierarchy, department
mapping) are **baked into the grains at refresh time** — an MDMS edit is invisible to the
dashboard until the next refresh cycle.

## 2. `asOf` — the staleness signal

Every `/v2/analytics/_query` response carries `asOf` = `SELECT max(facts_built_at) FROM
complaint_facts` (`AnalyticsService.asOf()`), i.e. the epoch-ms wall-clock of the last successful
facts build (each refresh stamps `facts_built_at = now()`). Consumers should treat it as "data
current as of": with the default interval the dashboard lags reality by up to ~5 min. The FE
shows it in the header/tile stamps (`digit-ui-esbuild/products/dashboard/src/components/DashboardHeader.jsx`,
`CardUpdatedStamp.jsx`), and the server itself uses `asOf` as the clock authority for
elapsed-time compose math.

**An old `asOf` is your primary "refresh is broken" alarm** — check pgr-services logs for
`Failed to refresh <mv>` warnings (a failed refresh does not crash anything; it just goes stale).
Caveat: `/packs` returns `asOf = System.currentTimeMillis()` (schema bootstrap, no data) — only
`_query`'s `asOf` measures data freshness.

## 3. Tenant bootstrap — what a new tenant does and doesn't get

`tenant_bootstrap` (and `city_setup` / `city_setup_from_xlsx`) in
`digit-mcp/src/tools/mdms-tenant.ts` copy MDMS masters from the source root to a new tenant via
an explicit allowlist (`essentialSchemas`, ~line 1276). Relevant to the dashboard:

**Copied**: `ACCESSCONTROL-ACTIONS-TEST.actions-test`, `ACCESSCONTROL-ROLES.roles`,
`ACCESSCONTROL-ROLEACTIONS.roleactions` (+ the ACTIONS bridge, `30-view-access.md` §5),
`tenant.citymodule`, `common-masters.StateInfo`/branding, `RAINMAKER-PGR.UIConstants`,
`Workflow.*`, `INBOX.InboxQueryConfiguration` — i.e. the **view-access surface** arrives.

**Also copied — the KPI catalog** (`dss.KpiDefinition`, `dss.DashboardPack`; added to the
allowlist in PR #1062): KPI defs and packs are platform-level definitions with no tenant
identity inside, so a new state root gets a working catalog out of the box.
`RAINMAKER-PGR.ComplaintHierarchy` remains *deliberately* excluded (operator-loaded in
configurator Phase 3).

Per-tier notes:

- **New city under an existing state root** (`ke.newcity`): nothing to do — the KPI catalog is
  read at the **state root** (`KpiCatalogService` collapses the tenant), so city tenants inherit
  `ke`'s defs/packs automatically.
- **New state root** (`mz`, `pg.x` as its own root): covered by bootstrap since PR #1062 —
  **provided the source root actually has a catalog**. Bootstrap *copies* `dss.*` from the
  source; when the source has no `dss.KpiDefinition` rows it copies nothing and still reports
  success, and the new root gets a working dashboard shell with an empty catalog. (This is
  what happened to `mz`.) Since then bootstrap emits an explicit `warnings[]` entry for that
  case instead of staying silent.
- **Any running deployment** — a root bootstrapped with an older digit-mcp, a root whose source
  had no catalog, or one whose role taxonomy differs from the seed's — run the installer:

  ```bash
  DASHBOARD_TENANT=<root> ./local-setup/scripts/enable-dashboard.sh --dry-run   # read-only preflight
  DASHBOARD_TENANT=<root> ./local-setup/scripts/enable-dashboard.sh
  ```

  It seeds from the repo files rather than another tenant, so it does not depend on a source
  root already being correct: schemas, the 39 defs + pack (roles remapped via `ROLE_MAP`),
  `dss.DashboardConfig`, the sidebar action, the localization packs, the cache-bust and token
  flush, then verifies end-to-end. Step 0 is read-only and reports the problems seeding cannot
  fix — unheld roles, missing department enrichment (#1280), and schema-as-data corruption.
  Full detail: `local-setup/db/dss-mdms-seed/README.md` and the runbook on issue #631.

  Without any of this the dashboard renders empty (`/packs` returns no tiles; the service logs
  "MDMS path not found for dss.KpiDefinition" and gracefully returns empty).

## 4. What a redeploy wipes — never hand-patch bundles

The canonical converge (`local-setup/ansible/deploy.sh <tenant>` →
`local-setup/ansible/playbook-deploy.yml`) **overwrites the served frontend on every run**: the
static-mode task pulls the `digit_ui_bundle_image`, `docker cp`s the bundle out, and
`rsync -a --delete`s it into the nginx-served `/opt/digit-ui-esbuild/build/`. `--delete` means
any file you hand-edited in the served bundle is gone; the repo checkout itself is force-cleaned
to the target ref earlier in the play. On Bomet the nightly cron additionally resets `/opt/ccrs`
to `origin/develop`, rebuilds `nightly-develop` images, and re-converges — **every** manual
patch on the box (source or bundle) has a lifespan of one night.

Therefore:

- FE dashboard changes (KpiTile kinds, filter bar, hooks) go through
  `digit-ui-esbuild/products/dashboard/src/` → PR → image/bundle. Never patch `/opt/*/build/`.
- Backend/grain changes go through `backend/pgr-services` source + a Flyway migration → rebuilt
  image (never patch JARs in containers).
- **MDMS-backed dashboard state survives redeploys** (it lives in the DB) — but keep the ansible
  seed files (`ansible/nairobi-mdms/mdms/dss/*.json`, `tenant/citymodule.json`,
  `ACCESSCONTROL-*/*.json`) in sync with what you upsert by hand, because fresh installs and
  repro environments are seeded from those files, and drift between DB and seed is how "works on
  bomet, empty on the repro box" happens. **Sharpest form:** editing a `dss.KpiDefinition` seed
  does **not** overwrite an already-existing live record — seeding `_create`s new ids but never
  `_update`s existing ones, so a live catalog can silently lag the repo (the #1026 stale-record
  no-op). Reconcile by `_update`ing the live record explicitly; verify with `/catalog/_search`.
  Full detail: `80-live-bomet-state.md` §4.

## 5. Quick health checklist

1. `POST /v2/analytics/_query` (any KPI) → is `asOf` within ~2× the refresh interval?
2. `pgr.dashboard.refresh.enabled=true` and no `Failed to refresh` warnings in pgr-services logs?
3. `POST /v2/analytics/packs` as a supervisor → non-empty `tiles` + `defaultLayout`? (Empty ⇒
   `dss.*` missing at the state root, §3, or role not in any pack, `20-packs-and-rbac.md`.)
4. Dashboard reachable? (Home card / sidebar ⇒ `30-view-access.md`.)
5. Tiles empty for one user only? ⇒ RBAC scope, `20-packs-and-rbac.md` layer 1 and
   `40-filters-and-options.md` §4.
