# Baseline tenant scope correction

Security review of the signup write fence found two action records, 2553 and
2554, whose nested data.tenantId was hard-coded to statea. Both now use the
canonical {tenantid} placeholder. No role, action, country rule or grant changed.
The strict signup write fence is preserved.

A recursive regression inspects every nested tenantId after substitution and
requires the target tenant. Executed against the prior HEAD seed, the new test
failed on action2553/statea as expected. The canonical source was not replaced;
only generated test copies temporarily held the previous bytes and were restored.

Validation (2026-10-05 IST):
- npm ci installed this worktree's missing MCP dependencies; initial attempts
  failed because ajv/tsx were not installed, before reaching assertions.
- npm run build --prefix digit-mcp: passed, including canonical staging and tsc.
- npm run test:platform-baseline --prefix digit-mcp: 19 passed, zero failures/skips.
- npm run test:platform-packaging --prefix digit-mcp: two passed, zero failures/skips;
  actual npm archive/standalone loaders use the updated canonical bytes.

Canonical SHA256: 4480a9374295f902b770aced529d19be637a92282b7ecaab5790d38710996bf1.
Still 25 schemas and 984 records. Historical seed evidence records the older hash.
PGR leaf must consume this correction before strict tenant-scope validation.
No deployment performed.

Local log hashes:
- .artifacts/onboarding-security/seed-tenant-before.log: 5274293ac2f096faf049b7bc59800fd1e26c6c7d0b51e6955fc8a7ab32eed434
- .artifacts/onboarding-security/seed-build.log: d8f8809d48d1a4a2bd3718a5f8febda8b43acd5cc343af444212c3b4b9815ce7
- .artifacts/onboarding-security/seed-baseline-after.log: 8e17ed9dc3c18ddad6234d2ba91a48f19f6d43afa7374b95677e4e92f769c76c
- .artifacts/onboarding-security/seed-packaging-after.log: c3b6716a64f78c79ada4fd096358b0c3d7260797cc4e78cd0a50a01b5f031db1
