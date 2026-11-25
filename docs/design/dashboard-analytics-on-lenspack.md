# Dashboard analytics on lenspack (proposal)

**Status:** draft for review. Nothing changes for any deployment until the overlay is enabled.

## What

The dashboard already describes itself as data: MDMS `dss.KpiDefinition` (KPIs) and `dss.DashboardPack` (layouts). [lenspack](https://github.com/theflywheel/lenspack) compiles that catalog into a metric pack and answers the dashboard's own analytics API (`/pgr-services/v2/analytics/*`: `packs`, `catalog/_search`, `_query`, `public/*`) from the same `complaint_facts`, `complaint_events` and `complaint_open_state_daily` tables. The UI is unchanged.

What stays in CCRS: the UI, login, the analytics tables and their refresh, and access control. For a signed-in user, lenspack asks pgr-services' `/_access` for the capabilities and applies pgr-services' own row scope (departments, jurisdictions, own records).

## Proof

Live, against Bomet's data: **https://ccrs-lenspack.proto.chakshu.co.in/digit-ui/public-dashboard.html** (employees: `/digit-ui/employee/dashboard`, sign in with a Bomet account). Every analytics response carries `x-served-by: lenspack`.

| Check (against Bomet) | Result |
|---|---|
| Public dashboard, pixels at 1280/1456/1920 px | 0 px |
| Public KPIs, 18 filter combinations × 8 KPIs | 144/144 identical |
| Supervisor dashboard, signed in as the same employee | 0 px on 12/12 runs; 20/20 results identical |
| Whole catalog: 40 KPIs × 817 parameter combinations | 770 byte-identical; 43 differ only in row order where our SQL has no ORDER BY (it varies between calls on pgr-services itself); 4 refused (daily series of a two-dimension KPI, never requested by the UI) |

Reproduce with `examples/ccrs/pixel-parity.mjs` in lenspack. It first compares the deployment with itself (must be 0 px).

## How to try it

```sh
docker compose -f docker-compose.yml -f docker-compose.lenspack.yml up -d ccrs-lenspack
# open http://<host>:8795/digit-ui/public-dashboard.html: same UI, analytics by lenspack
```

Cutover (not in this PR): route `/pgr-services/v2/analytics` in Kong to `ccrs-lenspack:8795` and set `CCRS_ANALYTICS_UPSTREAM=http://pgr-services:8080`. Rollback is reverting the route.

## Security

- Queries run in read-only transactions with a statement timeout.
- Board and KPI queries are compiled from the catalog with bound parameters. There's no free SQL.
- Tenant and scope are applied to every query; a query the scope can't reach is refused.

## Open items

- Only ADMIN has been compared signed in. DEMO_SUPERVISOR (narrower scope) still needs a run.
- The `executive-default` pack has no `requiredActionUrl`, so CCRS shows it to no one.
- Ownership, image publishing and the Kong cutover need decisions.
