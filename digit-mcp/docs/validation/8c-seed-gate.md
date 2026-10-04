# 8c seed gate fixes

Scope: gate bugs 1 and 7 (role references and founder branding grants), plus the agreed country-default data handoff for bug 2. Branch rebased onto `identity/completion-base` at `69f9af553`. No deployment or live no-403 result is claimed.

## Changes

- Add `PGR_SUPERVISOR` before all role-action rows. The role's name/description match `local-setup/db/full-dump.sql`; its six existing action grants remain unchanged. All 584 role-action rows now refer to roles and actions appearing earlier in the seed, including all founder roles.
- Add enabled action IDs `901006` and `901007` for `/mdms-v2/v2/_create/common-masters.ThemeConfig` and `/mdms-v2/v2/_update/common-masters.ThemeConfig`. These are the exact paths composed by `configurator/src/api/config.ts` and `configurator/src/api/services/mdms.ts` and routed by `local-setup/kong/kong.yml`. Grant each only to tenant `ACCOUNT_ADMIN`, which founders already receive. Existing service aliases, workspace grants, and direct-bootstrap authorization remain unchanged.
- Add `countryMobileRules` metadata in the single canonical JSON and its TypeScript interface. This is a map of uppercase ISO codes to MDMS record data; it is not part of the records blindly copied to each target.

## Country contract and sources

The isolated data/loader commit is `0d5ad4113`; onb-pgr confirmed consuming it. PGR owns the Java accessor, selection behavior, and fallback regressions in its separate task.

| ISO | Dial code | Regex | Provenance |
| --- | --- | --- | --- |
| IN | +91 | `^[6-9][0-9]{9}$` | Root's `8c-gate-report.md` country master; also matches the existing +91 record in `local-setup/db/full-dump.sql` |
| KE | +254 | `^[17][0-9]{8}$` | `ansible/nairobi-mdms/mdms/common-masters/MobileNumberValidation.json` |

Both defaults have `default:true`. The repository's default-data-handler Kenya sample has a different optional leading-zero regex and `default:false`; it was deliberately not selected over the owner-approved Nairobi source.

Agreed PGR behavior: read the explicit signup country's configured master first; preserve one valid active default. Use this canonical map only after successful authoritative absence, never after HTTP errors or malformed/ambiguous data. Write the chosen rule to the target tenant, without manually pre-seeding country tenants or cloning `pg`. IN/KE have canonical defaults; ET/MZ (also offered by the UI) and other countries require a valid configured country master, otherwise `COUNTRY_NOT_SUPPORTED` is terminal/correctable. PGR implements and verifies that behavior separately.

MCP keeps its existing explicit `user_validation`/mobile overrides and `source_tenant` contract. A tenant identifier is not an ISO-country selector. The metadata is shipped and typed, but MCP neither infers a country nor adds a new caller selector. Executed regression checks preserve configured and explicit rules and reject missing rules even when the tenant name happens to be `in`.

## Executed evidence

Executed 2026-10-05 IST. Only affected checks were run, per this task's test instruction. Raw logs are under `.artifacts/onboarding-seed-8c/` in the leaf worktree.

| Command/check | Result | Log |
| --- | --- | --- |
| `npm run build --prefix digit-mcp` | Pass: canonical staging and TypeScript workspaces | `build.log` |
| `npm exec --prefix digit-mcp -- tsc --noEmit -p digit-mcp/tsconfig.json` | Pass | `typecheck.log` |
| `npm run test:platform-baseline --prefix digit-mcp` | 18 passed, 0 failed; includes every role/action reference and ordering, exact branding grants, country inventory/provenance/schema, existing direct security and workspace/caller regressions | `baseline.log` |
| `npm run test:platform-packaging --prefix digit-mcp` | 2 passed, 0 failed: real npm archive extraction/runtime loader and standalone staging | `packaging.log` |
| `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home mvn -o -q -f backend/pgr-services/pom.xml -Dmaven.test.skip=true package` | Pass; built JAR resource bytes equal canonical | `pgr-package.log`, `package-hashes.log` |
| `docker build -t digit-mcp:onb-seed-8c digit-mcp` | Pass, image `sha256:22cb0612361c0560ef6deab7e4356916717f40dda7d17e5a98a93906f66e6bd0` | `docker-build.log` |
| Docker runtime load with `--network none` | Version 1, 25 schemas, 984 records, IN/KE metadata; raw seed hash matches canonical | `docker-seed.log`, `package-hashes.log` |

Canonical seed SHA-256: `65388a889e29c27c1ec9c51c1bf580a4ce5f4a7507d67bd67008f508207de916`.

`git ls-files '*platform-baseline-v1.json'` still returns only `backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json`. The npm archive, PGR JAR, and Docker image consume its bytes; no generated copy is committed. Structural authorization coverage is not a substitute for the owner's next live founder gate.
