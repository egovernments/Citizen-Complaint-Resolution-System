# Identifier propagation verification

Executed 2026-10-04 on core-sync, based on owner branch e698f7f23.

- `npx tsc --noEmit`: passed before the subsequent reconcile draft.
- `REDIS_PORT=16388 npx vitest run`: 372 passed, 5 opt-in real tests skipped,
  14 existing TODO tests.
- `REDIS_PORT=16388 node tests/fixtures/keycloak/run.mjs`: 5/5 passed against
  Keycloak 26.7.3. New cases verify that a changed staff email propagates only
  after Keycloak marks it verified, and a duplicate address produces the typed
  `KeycloakConflictError`. DIGIT identifier writes are mocked in this real-KC
  suite; its Keycloak reads, updates and uniqueness checks are real.
- Six identifier unit cases cover staff/citizen direction, verified-only
  propagation, fresh reads and drift retries, masked skips, removed bindings,
  phone-country validation, and retryable failures.
- Writer tests cover the explicit `{allowEmailChange: true}` option, refusing
  clearing or setting verification true, preserving username and enabled, and
  mapping a 409 conflict to `IDENTITY_EMAIL_CHANGED`.
- Tenant-directory tests cover explicit inactive flags, omitted flags in
  legacy seeds, and bypassing/replacing the 300-second cache with `{fresh:true}`.

Bindings are read through the shared store so invitation expiry is handled by
one parser and transition owner. A citizen phone remains a citizen-only write;
verified email remains staff-only. No field is cleared. Missing mirror entries
are counted as skips until a later successful mirror observes recovery.

Source evidence for activity handling: onboarding/tenant-foundation.ts creates
MDMS rows with envelope `isActive: true`; Nairobi tenant data seeds omit an
activity property. V1 responses with explicit isActive/active/isactive false
are excluded, while omitted flags remain active.

Reconciliation and its final provider integration remain the next increment.
