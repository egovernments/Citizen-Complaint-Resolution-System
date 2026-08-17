# Complaint reopen window (`RAINMAKER-PGR.UIConstants.REOPENSLA`)

How long a resolved or rejected complaint stays reopenable. It is the single
source of truth for that window: the citizen timeline, the employee/CSR action
bar and `pgr-services` server-side enforcement all read this one value, so an
edit here changes every surface at once.

- **Schema:** `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`
  (`RAINMAKER-PGR.UIConstants`)
- **Runtime hooks (UI):** `digit-ui-esbuild/products/pgr/src/hooks/pgr/useReopenWindow.js`,
  `digit-ui-esbuild/packages/modules/pgr/src/hooks/useReopenWindow.js`
- **Server enforcement:** `backend/pgr-services/.../util/MDMSUtils.java`
  (`getReopenWindowMillis`) → `.../validator/ServiceRequestValidator.java` (`validateReOpen`)
- **Editor:** configurator → **PGR UI Constants** (`/manage/pgr-ui-constants`)
- **Issues:** egovernments/CCRS#925 (enforcement) · #1252 (configurable + 72h default)

## The record

One record per tenant. `REOPENSLA` is **milliseconds**, and is the only field —
the schema is `additionalProperties: false`.

```jsonc
{
  "REOPENSLA": 259200000   // 72 hours
}
```

Common values:

| Window | Milliseconds |
|---|---|
| 1 hour | `3600000` |
| 24 hours | `86400000` |
| **72 hours (shipped default)** | **`259200000`** |
| 5 days | `432000000` |
| 30 days (configurator maximum) | `2592000000` |

The configurator accepts `60000` (1 minute) to `2592000000` (30 days).

## How the window is applied

The clock runs from the complaint's `auditDetails.lastModifiedTime`, and a
complaint is reopenable while `now - lastModifiedTime <= REOPENSLA`.

- **Citizen timeline** — hides the REOPEN action once the window has elapsed.
- **Employee/CSR action bar** — blocks REOPEN and shows the
  `CS_CANNOT_REOPEN_COMPLAINT_PAST_DEADLINE` toast.
- **`pgr-services`** — rejects the update with
  `400 INVALID_ACTION "Complaint is closed"`. The check reads the **persisted**
  record, not the request body, so it cannot be bypassed by a direct API call
  that forges a fresh `lastModifiedTime`.

Both UI surfaces deliberately **defer to the server when the window is unknown**
(MDMS still loading, master absent, or a non-positive value). They leave REOPEN
available rather than enforcing a deadline nobody configured — the server still
applies its own backstop, so nothing is left unbounded.

> **Note:** `lastModifiedTime` is the last time the complaint record changed, not
> the moment it was resolved. Any later action that keeps the complaint in
> `RESOLVED` — a citizen `COMMENT`, for example — pushes it forward and restarts
> the window. This is long-standing behaviour, unchanged here.

## Rollout notes

**Existing tenants keep their current value.** The 72-hour default ships in the
seed data, so it reaches tenants seeded or bootstrapped after that change. A
tenant already carrying `432000000` (5 days) stays at 5 days until an operator
edits it. To move an existing tenant, edit **PGR UI Constants** in the
configurator — no redeploy, no restart; `pgr-services` caches the value with a
short TTL and picks the change up on its own.

**Do not set `time-before-closing-complaint` (`PGR_COMPLAIN_IDLE_TIME`).**
It used to be the enforced window and is now only a fallback, used when MDMS has
no usable `REOPENSLA` (unseeded tenant or MDMS outage). Setting it pins one
deployment-wide window on the server while every UI keeps honouring the
per-tenant `REOPENSLA` — which is exactly the split-brain #1252 fixes: the screen
offers REOPEN, the API then rejects it as "Complaint is closed". The shipped
`devops/deploy-as-code/charts/environments/env.yaml` no longer sets it.

## Where it is seeded

| Path | Purpose |
|---|---|
| `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.UIConstants.json` | default-data-handler seed |
| `ansible/nairobi-mdms/mdms/RAINMAKER-PGR/UIConstants.json` | per-tenant Ansible MDMS seed |
| `local-setup/db/full-dump.sql` | local-setup database dump |
| `digit-mcp/src/tools/mdms-tenant.ts` | copied to every new tenant by the tenant bootstrap |

## Troubleshooting

**The REOPEN button is offered but the API rejects it.** The UI and the server
disagree about the window. Almost always `time-before-closing-complaint` is still
set in the deployment values — unset it.

**Editing `REOPENSLA` has no effect.** Check the record exists for the tenant the
user is actually on (`GET` the master for that `tenantId`, not just the state
tenant). With no usable record the UI leaves REOPEN visible and the server falls
back to `pgr.complain.idle.time`, so the configured value appears to be ignored.

**REOPEN never appears.** A non-positive `REOPENSLA` is treated as misconfigured
and ignored (with a warning in the `pgr-services` log) rather than hiding REOPEN
forever — so if REOPEN is missing entirely, look at the workflow state and the
user's roles, not at this master.
