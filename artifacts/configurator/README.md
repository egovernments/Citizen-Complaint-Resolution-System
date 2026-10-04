# Configurator identity surfaces

Task: `task_4b26ecb4294847689385773b22f4bcce` (surf-configurator → surfaces-owner).
Base integrated: `identity/lane-e@50067f68ac8636a509e8b273d3e30fde218aab9e`.

## Changes

- Employee create, including both bulk imports, requires email and performs HRMS create then BFF link without supplying a password. Retrying searches the immutable employee code before creating another record. Members also exposes completion of an unfinished invitation after a reload.
- Member removal and employee deactivation perform HRMS deactivation then BFF removal. Retries skip an already-completed deactivation; self-removal and cross-workspace mutations are rejected before HRMS writes. Employee edits preserve freshly read identity identifiers; admin email changes go through `_updateEmail` and report verification sent.
- Login and signup prioritize memberships, then pending invitations, then the founder's existing signup or new signup wizard. Entry reads PGR readiness after selecting a normal DIGIT token. Synthetic legacy DONE workspaces remain open; dependency failures are not interpreted as readiness. Setup completion writes expected-version PGR step updates.
- Account menu links to account actions, members and workspace settings. Account actions use the server catalogue and hosted actions; only second-factor credentials can be removed. Scoped logout and provider unlink use the BFF. Management/onboarding sign-out waits for BFF acknowledgement.
- Workspace rename uses only PGR `_rename`. HTTP 202 stays pending; the view polls `_search` and stops polling when it unmounts. Original tenant/name/requestVersion are retained for replay (including a same-tab reload). New actions use Workspace.version, never Rename.version. Direct name edits in tenant/branding forms are replaced by the settings flow.
- Invitation expiry updates the owned `identity.invitationPolicy/default` MDMS record, validates whole hours 1–2160, and preserves record metadata. The unused client `tenantBootstrap.ts` is removed; signup continues through the existing PGR signup/operation APIs.

## Contract references

- Workspace/rename: `b0f7b37770d99acc0579eb830d93f8ebcbedf053:backend/pgr-services/docs/onboarding-workspace-contract.md`.
- Admin email and selectors: `812d5c559:backend/identity-bff/docs/identity-bff.md`, §3.3.11.
- Old-address notification is deferred by root, recorded in `63e88080f:backend/identity-bff/docs/identity-bff.md`. New-address verification and propagation only after verification remain required. This frontend does not implement or claim backend verification propagation.

## Executed local validation

Run from `configurator/`, with a single Vitest worker:

- `npx vitest run src/identity src/pages/LoginPage.test.tsx src/pages/SignupPage.test.tsx src/onboarding/brandingApi.test.ts src/onboarding/employees/employeesApi.test.ts --maxWorkers=1`: 103 passed. See `focused-tests.log`.
- `npx vitest run --maxWorkers=1`: 576 passed, 1 baseline failure across 62 files. See `tests-final.log`.
- `npx tsc -b --pretty false`: passed. `npm run build` also executes `tsc -b` and the production Vite build; see `build.log`.
- `git diff --check`: passed.

The one full-suite failure is unchanged `src/admin/validation.postalCode.test.ts:171`: `local-setup/db/full-dump.sql` contains `^[1-9][0-9]{5}$`, while the DDH seed contains `^[0-9]{5}$`. Root's decision, relayed by surfaces-owner in `bridge:message/msg_a37e39e24b27443485d7021e1419eaf2`, treats it as an existing upstream data/product difference and requires **no new failures**, with no fix or skip in identity work. Neither the test nor either seed file is modified.

Build warnings: existing large bundle and outdated Browserslist dataset. Local test setup required restoring the matching optional `@rollup/rollup-darwin-arm64@4.60.2` package; no lockfile or dependency manifest was changed.

These are client unit/component tests with mocked dependencies. No live host, Docker gate, real Keycloak/Redis/egov-user/egov-otp run, or completed §11 system gate is claimed. PGR owns rename publication to MDMS, every configured language, cache invalidation and reservation retirement; the frontend waits for its DONE result. Backend owners and surf-tests retain those integration gates.
