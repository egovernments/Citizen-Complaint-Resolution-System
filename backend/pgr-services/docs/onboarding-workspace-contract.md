# Workspace setup and tenant rename

Workspace setup is separate from identity provisioning. The BFF carries no workspace state. These PGR routes use a normal DIGIT token in RequestInfo.authToken; PGR resolves the token through egov-user and requires live ACCOUNT_ADMIN at the requested tenant. Kong role-action grants provide the gateway check as well.

## Agreed workspace routes

`POST /pgr-services/v2/onboarding/workspaces/_search`

```json
{"RequestInfo":{"authToken":"<token>"},"tenantId":"example"}
```

`POST /pgr-services/v2/onboarding/workspaces/_update`

```json
{"RequestInfo":{"authToken":"<token>"},"tenantId":"example","step":"BRANDING","state":"SKIPPED","version":1}
```

Both return `Workspace` and `Probes`. Search additionally returns `Rename`, containing the latest rename operation or null. Workspace has tenantId, status, steps, version, seedVersion, updatedAt, updatedBy, optional lastErrorCode, and legacy. Each of BRANDING, GEOGRAPHY, DEPARTMENTS, EMPLOYEES and COMPLAINT_TYPES has `{state, updatedAt, updatedBy, lastErrorCode?}`. Existing rows return five boolean probes under Probes. Dependency failure returns 503 and never turns into successful evidence.

Fresh rows start NOT_STARTED, version 1, seedVersion "1", legacy false. Updates compare the supplied version atomically and increment it once. Step states are NOT_STARTED, IN_PROGRESS, DONE or SKIPPED; only BRANDING may be SKIPPED. DONE requires a matching server probe. Overall DONE requires every step DONE or SKIPPED. Updates append audit events.

An absent legacy row is synthesized as DONE with all steps DONE, version 0, seedVersion null, legacy true, and null updatedAt/updatedBy at both workspace and step level. The entire Probes block is null. Search performs no writes or dependency probes for that legacy case.

## Agreed errors and rename replay contract

Error envelope follows existing PGR controllers: `{"Errors":[{"code":"WORKSPACE_VERSION_CONFLICT","message":"Reload workspace state and retry"}]}`. Codes/statuses: WORKSPACE_AUTH_REQUIRED (401), WORKSPACE_ADMIN_REQUIRED (403), WORKSPACE_VERSION_CONFLICT (409), WORKSPACE_PROBE_INCOMPLETE (409), WORKSPACE_INVALID_STATE (400), WORKSPACE_DEPENDENCY_UNAVAILABLE (503).

`POST /pgr-services/v2/onboarding/workspaces/_rename`

```json
{"RequestInfo":{"authToken":"<token>"},"tenantId":"example","name":"Example Council","version":3}
```

Acceptance response: HTTP 202 `{"Rename":{"id":"<uuid>","tenantId":"example","name":"Example Council","version":4,"status":"PENDING","updatedAt":1791126000000}}`. The transaction reserves the new normalized name, records a durable rename operation with requestVersion 3, and increments workspace version to 4. A conflicting name returns WORKSPACE_NAME_TAKEN (409). Replaying the same tenant/requestVersion/normalized-name returns the same operation in its current state, including DONE after publication; a different name at that version conflicts. A second rename while publication is pending returns WORKSPACE_RENAME_PENDING (409).

A publisher resumes MDMS tenant.tenants.name, tenant-name localisation in every configured tenant language, cache invalidation, and final reservation retirement. The old reservation remains held until publication succeeds. Failed calls are retried from durable progress. A legacy rename materializes a DONE legacy-compatible workspace row without gating setup. Row creation and rename acceptance serialize concurrent first renames by tenant; an insert conflict must re-read and apply the expected-version check, never overwrite the winner. No cross-service transaction or synchronous all-or-nothing outcome is claimed. Core sync subsequently mirrors the authoritative MDMS name into Keycloak; PGR does not write Keycloak on rename.

### Observing completion

Search returns `Rename: null` when no rename exists. Otherwise its latest operation has `{id, tenantId, name, version, status, updatedAt, lastErrorCode?}`. `version` is the workspace version assigned when the rename was accepted; subsequent setup updates may make Workspace.version newer. `status` is PENDING or DONE. Transient publication failures retain PENDING and expose a diagnostic lastErrorCode; DONE is recorded only after MDMS, all tenant-language localisation writes, cache invalidation and old reservation retirement succeed. The UI polls search and does not interpret HTTP 202 as an applied rename. Replaying rename returns this current operation state.

### Name normalization and concurrent updates

Use the existing `OnboardingIdentifierService.normalizeOrganizationName` for both reservation keys and replay comparison: normalize to NFC, trim/collapse ECMAScript whitespace (including NBSP and FEFF), lowercase using Locale.ROOT, and normalize to NFC again. This shared signup/rename comparison matches the BFF organization-name check. The stored display name retains case after trimming and whitespace collapse. A replay with equivalent normalized text returns the original operation/display spelling rather than introducing a second write.

Workspace setup updates and new rename acceptance use the same workspace row/version and one transaction with a row lock or conditional expected-version update. If both arrive with version 3, exactly one may advance it to 4; the loser receives WORKSPACE_VERSION_CONFLICT and no reservation or remote-write intent is committed. Check an exact existing rename replay before rejecting its older requestVersion, so retries remain idempotent even after unrelated workspace updates. A pending rename prevents another rename, while setup updates may proceed with the current version; publication does not reset or decrement that version. Completion conditionally retires only that operation's reservations and never writes over a newer rename.
