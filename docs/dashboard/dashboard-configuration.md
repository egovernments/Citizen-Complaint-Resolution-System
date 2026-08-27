# Dashboard configuration

## What ships by default on a fresh `tenant_bootstrap`

| MDMS record | What it is |
|---|---|
| `dss.KpiDefinition` | 40 KPI tile definitions (query, viz, params) |
| `dss.DashboardPack` | 2 packs: `supervisor-default` (employee dashboard) and `public-default` (public curated dashboard) |
| `dss.DashboardConfig` | Number-format display config only — no role list lives here |

And on the access-control side:

| Grant | Purpose | Held by (as shipped) |
|---|---|---|
| Nav action `4557` | Dashboard sidebar entry | SUPERVISOR, GRO, DGRO, SUPERUSER |
| Capability actions `2640–2645` (`_access`, `_query`, `packs`, `catalog/_search`, `_schema`, `config/_refresh`) | Base dashboard usage | Same as above |
| `2646` `capabilities/officer` | Officer-tier KPIs | PGR_SUPERVISOR, PGR_ADMIN, SUPERUSER, SUPERVISOR, MDMS_ADMIN, HRMS_ADMIN |
| `2647` `capabilities/reports` | Reports-tier KPIs | PGR_VIEWER, TICKET_REPORT_VIEWER |
| `2648` `capabilities/reports-extended` | Most-restricted tier | TICKET_REPORT_VIEWER |

Each `dss.KpiDefinition` / `dss.DashboardPack` record declares which of the above tiers it needs via
a `requiredActionUrl` field — e.g. `"requiredActionUrl": "/pgr-services/v2/analytics/capabilities/officer"`.
A KPI with `"public": true` instead bypasses auth entirely and appears on the public dashboard.

## Updating it — APIs

All of the above is live MDMS data. Change it with the standard `mdms-v2` record APIs — no rebuild,
no redeploy, no restart:

- **Add or edit a KPI**: `POST /mdms-v2/v2/_create/dss.KpiDefinition` (new) or
  `POST /mdms-v2/v2/_update/dss.KpiDefinition` (existing — include the record's `id`).
- **Change a pack's tile set or layout**: same, against `dss.DashboardPack`.
- **Change number formatting**: same, against `dss.DashboardConfig`.
- **Change which roles hold a capability tier**: `POST /mdms-v2/v2/_update/ACCESSCONTROL-ROLEACTIONS.roleactions`
  — add/remove a `{rolecode, actionid}` row for the tier's action id (2646/2647/2648 above).
- **Add a new capability tier**: create a new action under `ACCESSCONTROL-ACTIONS-TEST.actions-test`
  with a `/pgr-services/v2/analytics/capabilities/<name>` URL, grant it to whichever roles via
  `ACCESSCONTROL-ROLEACTIONS.roleactions`, then point the relevant KPI/pack's `requiredActionUrl`
  at it.
- **Change labels**: `_upsert` the message key against the tenant's localization module, then
  `POST /localization/messages/cache-bust`.

One gotcha: editing the ansible-seed JSON files themselves (rather than a live tenant's data)
requires regenerating `digit-mcp/src/tools/dashboard-catalog-seed.ts` via
`digit-mcp/scripts/gen-dashboard-catalog.mjs` — CI checks for this drift and fails if the generated
file is out of sync with the source JSON.

That's it — this is the entire configuration surface. Anything not listed above (query planning,
row-scope/ABAC enforcement, the frontend module itself) is application code, not configuration.
