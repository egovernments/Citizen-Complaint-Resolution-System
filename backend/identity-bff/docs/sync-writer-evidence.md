# Sync writer verification

Item 12, first increment. Executed 2026-10-04 in the core-sync worktree.

- `REDIS_PORT=16388 npx vitest run`: 17 files passed; 209 tests passed,
  21 existing TODO tests. Run before adding the opt-in real fixture.
- `npx tsc --noEmit`: passed.
- `REDIS_PORT=16388 node tests/fixtures/keycloak/run.mjs`: 2 tests passed
  against `quay.io/keycloak/keycloak:26.7.3` on local port 18388:
  - preserves email, emailVerified, username and unrelated attributes;
  - does not undo an admin disable between its fresh GET and PUT.
- `tests/unit/keycloak-writer.test.ts`: 6 passing cases cover callback
  mutations, null/no-write, absent or wrong-subject leases, lease loss before
  PUT, and a failed PUT without stale retry.

The writer permits changes only to attributes and names. It preserves the
fresh profile even if a callback mutates identity fields, and never sends
`enabled`. Keycloak has no conditional user PUT, so unrelated external profile
edits between the GET and PUT can still race. The person lease serializes BFF
writers. The disable race is explicitly covered against real Keycloak.

Mirror, identifier propagation, reconciliation and their remaining acceptance
cases are subsequent increments; this record does not claim those complete.
