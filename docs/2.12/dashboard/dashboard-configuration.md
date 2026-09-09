# Dashboard configuration

Out of the box, GRO/DGRO/SUPERVISOR/SUPERUSER see 27 of the [40 default KPIs](../../../ansible/nairobi-mdms/mdms/dss/KpiDefinition.json) (the base tier); SUPERVISOR and SUPERUSER additionally hold the officer tier, for 30. See the capability-tier table below — visibility is per-tier, not uniform across these four roles.

## What ships by default on a fresh `tenant_bootstrap`

| MDMS record | What it is |
|---|---|
| `dss.KpiDefinition` | 40 KPI tile definitions (query, viz, params) |
| `dss.DashboardPack` | 2 packs: `supervisor-default` (employee dashboard) and `public-default` (public curated dashboard) |
| `dss.DashboardConfig` | Number-format display config only — no role list lives here |

And on the access-control side:

| Grant | Purpose | Held by (as shipped) |
|---|---|---|
| Nav action `4557` | Dashboard **sidebar** entry | SUPERVISOR, GRO, DGRO, SUPERUSER |
| Capability actions `2640–2645` (`_access`, `_query`, `packs`, `catalog/_search`, `_schema`, `config/_refresh`) | Base dashboard usage | Same as above |
| `2646` `capabilities/officer` | Officer-tier KPIs | PGR_SUPERVISOR, PGR_ADMIN, SUPERUSER, SUPERVISOR, MDMS_ADMIN, HRMS_ADMIN |
| `2647` `capabilities/reports` | Reports-tier KPIs | PGR_VIEWER, TICKET_REPORT_VIEWER |
| `2648` `capabilities/reports-extended` | Most-restricted tier | TICKET_REPORT_VIEWER |

Each `dss.KpiDefinition` / `dss.DashboardPack` record declares which of the above tiers it needs via
a `requiredActionUrl` field — e.g. `"requiredActionUrl": "/pgr-services/v2/analytics/capabilities/officer"`.
A KPI with `"public": true` instead bypasses auth entirely and appears on the public dashboard.

### The home-screen widget is separate, and doesn't ship by default

Action 4557 only gates the **sidebar** entry. The employee-home-screen **card** (some deployments,
e.g. bomet) is a `"Dashboard"` row in `tenant.citymodule` instead, copied by `tenant_bootstrap` from
the source tenant. The base `default-data-handler` seed only lists `Workbench`/`PGR`/`HRMS` — no
`Dashboard` row — so a fresh install gets the sidebar entry but no home-screen card. Same class of
gap as #1408 (fixed for `KpiDefinition`/`DashboardPack`, not extended here). Add it yourself with:

```json
{ "code": "Dashboard", "order": 14, "active": true, "module": "Dashboard", "tenants": [{ "code": "<tenantId>" }] }
```
against `tenant.citymodule` (`POST /mdms-v2/v2/_create/tenant.citymodule`) if you want the card now.

## Updating it — APIs

All of the above is live MDMS data — change it with the standard `mdms-v2` record APIs, no rebuild
or redeploy. Shapes (every field, with a real example) are in
[`95-mdms-schema-reference.md`](../../dashboard/dashboard-rbac-design/95-mdms-schema-reference.md):

| To... | Call | Shape |
|---|---|---|
| Add/edit a KPI | `_create`/`_update` `dss.KpiDefinition` (update needs the record's `id`) | [§ KpiDefinition](../../dashboard/dashboard-rbac-design/95-mdms-schema-reference.md#dsskpidefinition) |
| Change a pack's tiles/layout | `_create`/`_update` `dss.DashboardPack` | [§ DashboardPack](../../dashboard/dashboard-rbac-design/95-mdms-schema-reference.md#dssdashboardpack) |
| Change number formatting | `_create`/`_update` `dss.DashboardConfig` | [§ DashboardConfig](../../dashboard/dashboard-rbac-design/95-mdms-schema-reference.md#dssdashboardconfig) |
| Grant/revoke a capability tier | `_create` `ACCESSCONTROL-ROLEACTIONS.roleactions` — no `_update`, the key is `{rolecode, actionid}`; deactivate to revoke | [§ ROLEACTIONS](../../dashboard/dashboard-rbac-design/95-mdms-schema-reference.md#accesscontrol-roleactionsroleactions) |
| Add a new capability tier | New `ACCESSCONTROL-ACTIONS-TEST.actions-test` action (`/pgr-services/v2/analytics/capabilities/<name>`), grant it via roleactions, point the KPI/pack's `requiredActionUrl` at it | [§ ACTIONS-TEST](../../dashboard/dashboard-rbac-design/95-mdms-schema-reference.md#accesscontrol-actions-testactions-test) |
| Change labels | `_upsert` the message key, then `POST /localization/messages/cache-bust` | — |

Gotcha: editing the ansible-seed JSON files (not a live tenant) also needs regenerating
`digit-mcp/src/tools/dashboard-catalog-seed.ts` via `digit-mcp/scripts/gen-dashboard-catalog.mjs` —
CI fails on drift between the two.

That's it — this is the entire configuration surface. Anything not listed above (query planning,
row-scope/ABAC enforcement, the frontend module itself) is application code, not configuration.
