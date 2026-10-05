# tenant_bootstrap

Bootstrap a tenant from the versioned platform baseline shared with PGR onboarding.

**Group:** `mdms` | **Risk:** `write` | **Access:** authenticated platform administrator

## Behavior

The canonical resource is `backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json`.
The MCP build stages these same bytes into `dist/data/`; published npm packages and Docker images resolve the resource locally at runtime. Generated copies are not committed.

Bootstrap creates missing schemas and baseline records, substitutes the target tenant into seed data, creates the tenant record and mobile validation records, and provisions the administrator user and employee. The employee's jurisdiction is the tenant's root boundary in the reserved `WORKSPACE` hierarchy, as in PGR onboarding; the operational (`ADMIN`) hierarchy is created later by the workspace Geography step or `city_setup`, which never reuses a `ROOT` level as geography. The administrator username follows the authenticated caller (falling back to `ADMIN`); its roles are the seed's founder roles plus CITIZEN, CSR, GRO, PGR_LME and DGRO. Roles are only ever added: an existing administrator keeps every role it holds.

A root's tenant record is written at the root. A city's (`<root>.<city>`) is written under its root as `Tenant.<city>` with `parent: <root>`, never at city scope, so the city appears in the root's tenant list; the city is also appended to `tenants[]` of each root `tenant.citymodule` record.

The country mobile rule comes from the seed's `countryMobileRules` (selected by `country`, or by a seeded `mobile_prefix`); `source_tenant` is an explicit opt-in to read it from a live tenant instead. Bootstrap also creates the seed's PGR workflow business service (the same `workflow` entry PGR onboarding uses) at the target when workflow-v2 has none; an accepted create is not re-searched, because workflow-v2 caches searches in-JVM. With `source_tenant`, bootstrap also copies localization packs as it did before the seed: for `en_IN` and each locale in the source's `StateInfo.languages`, every message of the source and of its root (the source wins), except complaint types (`SERVICEDEFS*`), plus the dashboard packs as a floor, upserted at the target. It then adds the `TENANT_TENANTS_<TARGET>` name at the target and, for a city, at its root, only where that key is absent, and busts the localization cache. Without `source_tenant` no messages are written and `nextSteps` says so. Workspace branding, geography, business departments/designations, and complaint hierarchy are configured separately. Existing active records are skipped; inactive baseline records fail instead of being silently reactivated. New records must become visible before bootstrap continues. Replays reuse an existing administrator and employee.

## Authorization and transport

The default transport uses existing gateway APIs. Setting `EGOV_MDMS_HOST` alone does not enable direct calls.

Through the gateway, egov-accesscontrol authorizes every MDMS write from the target tenant's own role-action rows, which a brand-new tenant does not have. Before its first write, gateway bootstrap therefore inserts the seed's `ACCESSCONTROL-ACTIONS-TEST` and `ACCESSCONTROL-ROLEACTIONS` rows straight into `eg_mdms_data` (the role-action floor, CCRS#1928). The floor is additive, runs only while the target has no role-action rows, and is reported as `summary.access_floor_seeded`. If the DIGIT database is unreachable, a warning is recorded and the first write then fails with the gateway's own 403.

An operator may explicitly enable direct MDMS with `MCP_PLATFORM_BOOTSTRAP_DIRECT=true`. This requires trusted server settings `EGOV_MDMS_HOST`, `EGOV_USER_HOST`, and the state root `CRS_STATE_TENANT` (default `pg`). Every direct bootstrap verifies the caller token live through trusted egov-user and requires an active user with `SUPERUSER` or `MDMS_ADMIN` scoped to that state root. Caller-supplied user claims or configurable API environments do not authorize direct access.

## Parameters

| Parameter | Type | Behavior |
| --- | --- | --- |
| `target_tenant` | string, required | Tenant root to bootstrap. |
| `country` | string | ISO country whose seeded mobile rule is used (KE, IN, ET, MZ). |
| `source_tenant` | string | Opt-in: read the country mobile rule from this live tenant instead of the seed, and copy its (and its root's) localization packs. |
| `mobile_regex` | string | Overrides the country's mobile regex. A missing country rule without an explicit regex fails. |
| `mobile_prefix` | string | Overrides the country dialling prefix. |
| `mobile_zone` | string | Legacy alias used only when `mobile_prefix` is absent. |
| `mobile_length` | integer | Generated administrator mobile length; default 10. |
| `admin_mobile` | string | Explicit administrator mobile number. |
| `user_validation` | array | Explicit countryCode/mobileNumberRegex rules; supersedes mobile regex/prefix inputs. |
| `user_only` | boolean | Skip seed and employee setup; create or update the administrator user after encryption-key registration (re-encrypts mobile and password, clears `accountLocked`, adds missing roles). |
| `pincode_allowlist` | array | Legacy compatibility input; ignored with a warning. Configure postal codes in the workspace. |
| `dashboard_roles` | array | Legacy compatibility input; ignored with a warning. Configure dashboard access in the workspace. |

## Response and retry

The response retains `success`, `source`, `target`, `summary`, `adminUser`, `adminEmployee`, `results`, `localizations`, and `nextSteps`, and includes `seedVersion`. `results.schemas` and `results.data` report copied/skipped items; `results.workflow` reports created/skipped/failed business services, `localizations` lists copied/failed counts per locale. A workflow or localization failure sets `success: false` (the deploy then stops and prints it). `results.warnings` describes ignored legacy inputs and `summary.warnings` counts them.

Failures reject the call. After correcting authorization, missing country rules, inactive records, or unavailable services, retry the same target; already visible records are reused. Ambiguous administrator or employee matches fail rather than selecting an arbitrary record.

## Example

```json
{
  "target_tenant": "ke",
  "source_tenant": "pg",
  "mobile_regex": "^[17][0-9]{8}$",
  "mobile_prefix": "+254",
  "mobile_length": 9
}
```

Complete workspace setup after platform bootstrap before filing complaints.
