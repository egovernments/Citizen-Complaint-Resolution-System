# Real Keycloak fixture

From `backend/identity-bff`, with the lane's Redis already running:

```sh
REDIS_PORT=16388 node tests/fixtures/keycloak/run.mjs
```

The runner pins Keycloak 26.7.3, uses HTTP port `REDIS_PORT + 2000`
(override with `KEYCLOAK_TEST_PORT`), generates a disposable admin password in
memory, and stops its compose project after the tests. There are no persistent
volumes and no realm-delete calls. Pass Vitest file paths after `run.mjs` to
run other suites. Each test owns and removes its users and Organizations.

Normal Vitest runs skip the real suite unless `KEYCLOAK_TEST_URL` is set.
An explicitly enabled but unreachable or unauthorized fixture fails the tests.
The minimal realm import will be replaced by the declarative realm from the
Keycloak configuration owner when it lands.
