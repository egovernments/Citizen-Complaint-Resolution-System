# tenant_bootstrap

Bootstrap a tenant from the versioned platform baseline shared with PGR onboarding.

**Group:** `mdms` | **Risk:** `write` | **Access:** authenticated platform administrator

## Behavior

The canonical resource is `backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json`.
The MCP build stages these same bytes into `dist/data/`; published npm packages and Docker images resolve the resource locally at runtime. Generated copies are not committed.

Bootstrap creates missing schemas and baseline records, substitutes the target tenant into seed data, creates the tenant self-record and mobile validation records, and provisions the administrator user, employee, and minimal ADMIN boundary. The administrator username follows the authenticated caller (falling back to `ADMIN`); founder roles come from the seed.

The country mobile rule comes from the seed's `countryMobileRules` (selected by `country`, or by a seeded `mobile_prefix`); `source_tenant` is an explicit opt-in to read it from a live tenant instead, and nothing else is read from it. Workspace branding, geography, business departments/designations, complaint hierarchy, and workflow setup are configured separately. Existing active records are skipped; inactive baseline records fail instead of being silently reactivated. New records must become visible before bootstrap continues. Replays reuse an existing administrator and employee.

## Authorization and transport

The default transport uses existing gateway APIs. Setting `EGOV_MDMS_HOST` alone does not enable direct calls.

An operator may explicitly enable direct MDMS with `MCP_PLATFORM_BOOTSTRAP_DIRECT=true`. This requires trusted server settings `EGOV_MDMS_HOST`, `EGOV_USER_HOST`, and the state root `CRS_STATE_TENANT` (default `pg`). Every direct bootstrap verifies the caller token live through trusted egov-user and requires an active user with `SUPERUSER` or `MDMS_ADMIN` scoped to that state root. Caller-supplied user claims or configurable API environments do not authorize direct access.

## Parameters

| Parameter | Type | Behavior |
| --- | --- | --- |
| `target_tenant` | string, required | Tenant root to bootstrap. |
| `country` | string | ISO country whose seeded mobile rule is used (KE, IN, ET, MZ). |
| `source_tenant` | string | Opt-in: read the country mobile rule from this live tenant instead of the seed. |
| `mobile_regex` | string | Overrides the country's mobile regex. A missing country rule without an explicit regex fails. |
| `mobile_prefix` | string | Overrides the country dialling prefix. |
| `mobile_zone` | string | Legacy alias used only when `mobile_prefix` is absent. |
| `mobile_length` | integer | Generated administrator mobile length; default 10. |
| `admin_mobile` | string | Explicit administrator mobile number. |
| `user_validation` | array | Explicit countryCode/mobileNumberRegex rules; supersedes mobile regex/prefix inputs. |
| `user_only` | boolean | Skip seed and employee setup; create or update the administrator user after encryption-key registration. |
| `pincode_allowlist` | array | Legacy compatibility input; ignored with a warning. Configure postal codes in the workspace. |
| `dashboard_roles` | array | Legacy compatibility input; ignored with a warning. Configure dashboard access in the workspace. |

## Response and retry

The response retains `success`, `source`, `target`, `summary`, `adminUser`, `adminEmployee`, `results`, `localizations`, and `nextSteps`, and includes `seedVersion`. `results.schemas` and `results.data` report copied/skipped items. Workflow and localization counters remain zero because platform bootstrap does not clone those resources. `results.warnings` describes ignored legacy inputs and `summary.warnings` counts them.

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
