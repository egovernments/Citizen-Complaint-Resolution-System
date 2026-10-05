# Workspace setup and tenant rename

Workspace setup is separate from identity provisioning. The BFF carries no workspace state. These PGR routes use a normal DIGIT token in RequestInfo.authToken; PGR resolves the token through egov-user and requires live ACCOUNT_ADMIN at the requested tenant. Kong role-action grants provide the gateway check as well. `_update` only changes local workspace/audit rows and retains the live tenant ACCOUNT_ADMIN check. Workspace dependency reads use the provisioner client’s read-only allowlist; downstream writes never use provisioner credentials.

## Agreed workspace routes

`POST /pgr-services/v2/onboarding/workspaces/_search`

```json
{"RequestInfo":{"authToken":"<token>"},"tenantId":"example"}
```

`POST /pgr-services/v2/onboarding/workspaces/_update`

```json
{"RequestInfo":{"authToken":"<token>"},"tenantId":"example","step":"BRANDING","state":"SKIPPED","version":1}
```

Both return `Workspace` and `Probes`. Search additionally returns `Rename`, containing the latest rename operation or null. Workspace has tenantId, status, steps, version, seedVersion, updatedAt, updatedBy, optional lastErrorCode, and legacy. Each of BRANDING, GEOGRAPHY, DEPARTMENTS, EMPLOYEES and COMPLAINT_TYPES has `{state, updatedAt, updatedBy, lastErrorCode?}`. On search, existing rows return five advisory probes under Probes; a probe whose dependency (MDMS, boundary or HRMS) fails reads null, never true, and the search still succeeds. Update returns only the probe it ran: `{<step>: true}` for an accepted DONE, null for any other state. Probes: BRANDING, the tenant record has an imageId; GEOGRAPHY, the ADMIN `boundary-relationships` tree under the tenant's root boundary has at least one child; DEPARTMENTS, an owned active Department other than ONBOARDING_ADMIN and an owned active Designation other than ONBOARDING_FOUNDER; EMPLOYEES, an active non-founder employee with an active user; COMPLAINT_TYPES, an owned active ComplaintHierarchy leaf (no row names it as parentCode) whose department is one of those Departments and whose slaHours is above 0, and every department named by an owned active leaf has at least one active HRMS employee with an active user, a current assignment (`isCurrentAssignment`) in that department and the GRO role at the tenant. GRO visibility is department OWN, so a routed department without a GRO would leave its complaints in PENDINGFORASSIGNMENT. Within one search, EMPLOYEES and COMPLAINT_TYPES share a single HRMS employee read; an HRMS failure makes both null.

Fresh rows start NOT_STARTED, version 1, seedVersion "1", legacy false. Updates compare the supplied version atomically and increment it once. Step states are NOT_STARTED, IN_PROGRESS, DONE or SKIPPED; only BRANDING may be SKIPPED. DONE runs that step's probe alone and requires it to pass; a dependency failure there returns 503. NOT_STARTED, IN_PROGRESS and SKIPPED writes run no probe. Overall DONE requires every step DONE or SKIPPED. Updates append audit events.

An absent legacy row is synthesized as DONE with all steps DONE, version 0, seedVersion null, legacy true, and null updatedAt/updatedBy at both workspace and step level. The entire Probes block is null. Search performs no writes or dependency probes for that legacy case.

## Agreed errors and rename replay contract

Error envelope follows existing PGR controllers: `{"Errors":[{"code":"WORKSPACE_VERSION_CONFLICT","message":"Reload workspace state and retry"}]}`. Codes/statuses: WORKSPACE_AUTH_REQUIRED (401), WORKSPACE_ADMIN_REQUIRED (403), WORKSPACE_VERSION_CONFLICT (409), WORKSPACE_PROBE_INCOMPLETE (409), WORKSPACE_INVALID_STATE (400), WORKSPACE_DEPENDENCY_UNAVAILABLE (503).

`POST /pgr-services/v2/onboarding/workspaces/_rename`

```json
{"RequestInfo":{"authToken":"<token>"},"tenantId":"example","name":"Example Council","version":3}
```

Successful publication response: HTTP 202 `{"Rename":{"id":"<uuid>","tenantId":"example","name":"Example Council","version":4,"status":"DONE","updatedAt":1791126000000}}`. Before publication, a separate acceptance transaction reserves the new normalized name, records a durable rename operation with requestVersion 3, and increments workspace version to 4. A conflicting name returns WORKSPACE_NAME_TAKEN (409). Replaying the same tenant/requestVersion/normalized-name returns the same operation in its current state, including DONE after publication; a different name at that version conflicts. A second rename while publication is pending returns WORKSPACE_RENAME_PENDING (409).

Only an authenticated `_rename` request publishes MDMS tenant.tenants.name, tenant-name localisation in every configured tenant language, cache invalidation, and final reservation retirement. There is no scheduled publisher. The old reservation remains held until publication succeeds. A downstream 401/403 or dependency 503 returns the existing Errors envelope after committing PENDING, acknowledged progress, reservations and a sanitized diagnostic; it does not undo acceptance. Publication uses a separate transaction with `noRollbackFor=ResponseStatusException.class`, so the Spring interceptor commits checkpoints before the controller handles those errors. Unexpected database failure rolls back that publication transaction; the independently committed intent remains replayable. An explicit authenticated replay resumes durable progress; remote calls remain idempotent if a response or checkpoint is lost. A legacy rename materializes a DONE legacy-compatible workspace row without gating setup. Row creation and rename acceptance serialize concurrent first renames by tenant; an insert conflict must re-read and apply the expected-version check, never overwrite the winner. No cross-service transaction or synchronous all-or-nothing outcome is claimed. Core sync subsequently mirrors the authoritative MDMS name into Keycloak; PGR does not write Keycloak on rename.

### Observing completion

Search returns `Rename: null` when no rename exists. Otherwise its latest operation has `{id, tenantId, name, version, status, updatedAt, lastErrorCode?}`. `version` is the workspace version assigned when the rename was accepted; subsequent setup updates may make Workspace.version newer. `status` is PENDING or DONE. Transient publication failures retain PENDING and expose a diagnostic lastErrorCode; DONE is recorded only after MDMS, all tenant-language localisation writes, cache invalidation and old reservation retirement succeed. The UI may poll search to observe state; `_search` is read-only and never resumes publication. Successful rename/replay returns HTTP 202 with DONE. Failed publication requires the administrator to select Retry name change with a current sign-in. Neither backend nor UI promises background completion.

The UI retains only `{tenantId, name, version}` in sessionStorage for an uncertain request, including 401/403 responses after partial publication. Each explicit retry obtains the current session token separately. On reload without a saved request, a pending operation reconstructs that body from `Rename.tenantId`, `Rename.name`, and `Rename.version - 1`; using a newer `Workspace.version` would create a different request and is forbidden. A saved uncertain request takes precedence over an older DONE result. New name changes use the current Workspace.version. Tokens and caller userInfo are never persisted with rename intent, checkpoints, audit, reservations, or UI replay data.

### Downstream authorization

Configure `egov.gateway.host` (`EGOV_GATEWAY_HOST`) to the Kong origin. A missing or malformed origin fails closed with 503. Workspace publication uses only these fixed routes:

- `/mdms-v2/v2/_update/tenant.tenants`
- `/localization/messages/v1/_upsert`
- `/localization/messages/cache-bust`

Before every write, PGR resolves the current request token again and requires live ACCOUNT_ADMIN at the target tenant, including cache-bust whose Kong action is auth-optional. Each downstream RequestInfo is rebuilt with only apiId, timestamp and the current caller authToken; caller-supplied userInfo is discarded. Kong authorizes MDMS/localisation actions with that token. A 401/403 never falls back to internal service hosts or a provisioner token. Existing role grants remain authoritative: ACCOUNT_ADMIN alone may pass the local check but receive Kong 403 on MDMS update action2601, which requires MDMS_ADMIN. The provisioned founder has the needed action roles; this change does not widen grants.

### Name normalization and concurrent updates

Use the existing `OnboardingIdentifierService.normalizeOrganizationName` for both reservation keys and replay comparison: normalize to NFC, trim/collapse ECMAScript whitespace (including NBSP and FEFF), lowercase using Locale.ROOT, and normalize to NFC again. This shared signup/rename comparison matches the BFF organization-name check. The stored display name retains case after trimming and whitespace collapse. A replay with equivalent normalized text returns the original operation/display spelling rather than introducing a second write.

Workspace setup updates and new rename acceptance use the same workspace row/version and one transaction with a row lock or conditional expected-version update. If both arrive with version 3, exactly one may advance it to 4; the loser receives WORKSPACE_VERSION_CONFLICT and no reservation or remote-write intent is committed. Check an exact existing rename replay before rejecting its older requestVersion, so retries remain idempotent even after unrelated workspace updates. A pending rename prevents another rename, while setup updates may proceed with the current version; publication does not reset or decrement that version. Completion conditionally retires only that operation's reservations and never writes over a newer rename.
