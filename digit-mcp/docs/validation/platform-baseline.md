# Platform baseline packaging and bootstrap evidence

Executed 2026-10-04 on `identity/onb-seed`, after isolated seed/security handoff `34af6d710` (cherry-picked as `eaa559e0f`) and owner `09f19f74c` integration. This evidence covers the seed/MCP/build lane, not PGR lifecycle or workspace service completion.

The only tracked seed is `backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json`: version `1`, 25 schemas, 979 records, SHA-256 `39f5dcd8c5d6a6f5870083d181c5ffe6763add35fd83893487d40120cee2d231`. PGR loads it as a classpath resource; MCP stages byte-identical generated copies before compilation. The npm archive and Docker runtime resolve the built copy without the monorepo.

The owner-approved seed delta removes only `SUPERUSER.900000`, `SUPERUSER.900001`, and `SUPERUSER.901000`, retaining tenant `ACCOUNT_ADMIN` for workspace search/update/rename. Invitation policy stays unique on `id=default`, default 336 hours, integer range 1–2160. MCP compatibility inputs `pincode_allowlist` and `dashboard_roles` are retained and explicitly warn that workspace configuration is required; the existing warnings count matches those messages. `user_only` is now correctly inside the registered input schema's properties.

## Executed checks

Commands below run from the repository root unless prefixed with a directory. Raw logs are in `.artifacts/onboarding-seed/` in the leaf worktree; the committed results below record their relevant outcomes.

| Check | Result | Raw log |
| --- | --- | --- |
| `npm run build --prefix digit-mcp` | Passed, including seed staging and both TypeScript workspaces | `mcp-build.log` |
| `cd digit-mcp && npx tsc --noEmit` | Passed | `final-typecheck.log` |
| `npm run test:platform-baseline --prefix digit-mcp` | 14 passed, 0 failed: inventory/schema validation, invitation bounds/default, workspace grants, replay, direct auth rejection, gateway default, compatibility warnings, user-only and registered schema | `mcp-baseline-test.log` |
| `npm run test:platform-packaging --prefix digit-mcp` | 2 passed: actual npm tarball extraction/load; isolated standalone staging and missing-seed failure | `final-platform-packaging.log` |
| `local-setup/tests/node_modules/.bin/jest --config local-setup/tests/jest.config.js --runInBand --runTestsByPath local-setup/tests/static/mcp-baseline-packaging.test.ts` | 5 passed: vendored/fresh-clone build staging, missing seed, both image workflows, Ansible paths | `deployment-packaging-test.log` |
| `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home mvn -o -q -f backend/pgr-services/pom.xml -Dmaven.test.skip=true package` | Passed; inspected built JAR bytes, then instantiated `PlatformBaseline(new ObjectMapper())` from extracted JAR classes/libs/resources outside checkout | `pgr-package.log`, `pgr-jar-verification.log`, `pgr-loader-verification.log` |
| `docker build -t digit-mcp:onb-seed digit-mcp` | Passed; image `sha256:226705c1b6d81a9bf2862a41a72bce9f0722f62ca1c49f99663c00cdfd799504` | `mcp-docker-build.log` |
| Docker `--network none` runtime import of `dist/tools/platform-baseline.js` | Passed: version 1, 25 schemas, 979 records, canonical SHA-256 above | `docker-seed-verification.log` |
| `npm test --prefix digit-mcp` | Registry/disclosure checks passed | `final-registry.log` |
| `cd digit-mcp && npx tsx test-master-localizations.ts` | 19 passed | `final-localizations.log` |
| `npm run test:security --prefix digit-mcp` | 79 passed | `final-security-policy.log` |
| `npm run test:security:http --prefix digit-mcp` | 34 passed against local stub service | `final-security-http.log` |
| `npm run test:safety --prefix digit-mcp` | 60 passed, 2 failures in unchanged phone checks: tests 2.3/2.4 demand rejection of 9/11 digit phones, while existing validation accepts 6–15 digits | `final-safety.log` |

Identity-root classified both phone assertions as "baseline failure, unchanged (validator and test identical to develop)", relayed by onboarding-owner in bridge message `msg_532a02d916f24c8a96009ca6f137a76d`. This leaf did not rerun the baseline suite. Neither phone file was changed or skipped; no phone contract changes were made in this lane.

Offline CI gates ran once before the draft PR. Live `test:full`/OpenAPI integration suites need a configured DIGIT deployment and were not run. Java packaging checks do not claim a PGR full-suite run. No deployment or end-to-end signup is claimed. The monorepo MCP CI now watches canonical-seed changes and runs baseline and npm/standalone packaging gates after its build.
