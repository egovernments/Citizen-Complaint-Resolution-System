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
(cd backend/identity-bff && REDIS_PORT=16491 npx vitest run tests/unit/surfaces.test.ts tests/e2e/identity-bff.test.ts)
(cd local-setup/tests && npx jest static/deployment-contracts.test.ts --runInBand)
keycloak/tests/run-live-check.sh
```

CI separately executes the image build, browser smoke and pinned-container
screenshot suite. Their durable job URLs are in `validation.json`. They do not
substitute for the full BFF/DIGIT completion gate.
