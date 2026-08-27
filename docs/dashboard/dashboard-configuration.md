# Dashboard configuration

Dashboard with [40 default KPIs](../../ansible/nairobi-mdms/mdms/dss/KpiDefinition.json) is visible to SUPERVISOR, GRO, DGRO, and SUPERUSER out of the box.

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
no redeploy, no restart. Exact JSON shape (every field, with a real example) for each record type
below is in [`dashboard-rbac-design/95-mdms-schema-reference.md`](dashboard-rbac-design/95-mdms-schema-reference.md):

- **Add or edit a KPI**: `POST /mdms-v2/v2/_create/dss.KpiDefinition` (new) or
  `POST /mdms-v2/v2/_update/dss.KpiDefinition` (existing — include the record's `id`). Shape:
  [§ `dss.KpiDefinition`](dashboard-rbac-design/95-mdms-schema-reference.md#dsskpidefinition).
- **Change a pack's tile set or layout**: same, against `dss.DashboardPack`. Shape:
  [§ `dss.DashboardPack`](dashboard-rbac-design/95-mdms-schema-reference.md#dssdashboardpack).
- **Change number formatting**: same, against `dss.DashboardConfig`. Shape:
  [§ `dss.DashboardConfig`](dashboard-rbac-design/95-mdms-schema-reference.md#dssdashboardconfig).
- **Change which roles hold a capability tier**: `POST /mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions`
  to grant (there's no meaningful `_update` target — the unique key is the `{rolecode, actionid}`
  pair, not a separate id) — deactivate to revoke. Shape:
  [§ `ACCESSCONTROL-ROLEACTIONS.roleactions`](dashboard-rbac-design/95-mdms-schema-reference.md#accesscontrol-roleactionsroleactions).
- **Add a new capability tier**: create a new action under `ACCESSCONTROL-ACTIONS-TEST.actions-test`
  with a `/pgr-services/v2/analytics/capabilities/<name>` URL, grant it to whichever roles via
  `ACCESSCONTROL-ROLEACTIONS.roleactions`, then point the relevant KPI/pack's `requiredActionUrl`
  at it. Shape: [§ `ACCESSCONTROL-ACTIONS-TEST.actions-test`](dashboard-rbac-design/95-mdms-schema-reference.md#accesscontrol-actions-testactions-test).
- **Change labels**: `_upsert` the message key against the tenant's localization module, then
  `POST /localization/messages/cache-bust`.

One gotcha: editing the ansible-seed JSON files themselves (rather than a live tenant's data)
requires regenerating `digit-mcp/src/tools/dashboard-catalog-seed.ts` via
`digit-mcp/scripts/gen-dashboard-catalog.mjs` — CI checks for this drift and fails if the generated
file is out of sync with the source JSON.

That's it — this is the entire configuration surface. Anything not listed above (query planning,
row-scope/ABAC enforcement, the frontend module itself) is application code, not configuration.
