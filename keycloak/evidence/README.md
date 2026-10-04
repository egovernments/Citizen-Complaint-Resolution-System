# Keycloak extraction evidence

Draft PR: https://github.com/KDwevedi/Citizen-Complaint-Resolution-System/pull/50

`validation.json` records the source revision and exact checks. The local
logs contain only test results; no process environments or credentials are
included. Live realm summaries distinguish failures from passed checks and
record the harness exit status. An interrupted startup is not a passed test.

Reproduce from the repository root:

```sh
npm run lint --prefix keycloak/theme-src
npm test --prefix keycloak/theme-src
(cd backend/identity-bff && npx tsc --noEmit)
# REDIS_PORT points at a dedicated local test Redis, not a deployed service.
(cd backend/identity-bff && REDIS_PORT=16491 npx vitest run)
(cd local-setup/tests && npx jest static/deployment-contracts.test.ts --runInBand)
keycloak/tests/run-live-check.sh
```

CI separately executes the image build, browser smoke and pinned-container
screenshot suite. Their durable job URLs are in `validation.json`. They do not
substitute for the full BFF/DIGIT completion gate.

Realm CI at `09e479139` passed all 24 checks on stock Keycloak 26.7.3.
`live-check-summary.log` lists each case and links the full CI artifact.
The final catalogue correction removes exactly the obsolete item-14 branding
route from `ROUTES` and the frozen route table, per root approval
`apr_1810cd9a95a04b42bf1cddaa6a76c6c3`; catalogue drift checks remain intact.
