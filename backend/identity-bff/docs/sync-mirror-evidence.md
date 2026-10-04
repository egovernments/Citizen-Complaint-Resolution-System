# Sync mirror verification

Item 12, second increment; executed 2026-10-04.

- `REDIS_PORT=16388 npx vitest run`: 219 passed, 3 opt-in real tests skipped,
  21 existing TODO tests, before adding the authorship guard case.
- `REDIS_PORT=16388 node tests/fixtures/keycloak/run.mjs`: 3/3 passed against
  Keycloak 26.7.3, including `never mirrors a masked DIGIT name into the real
  user profile`. The DIGIT read is controlled; the user reads and writes use
  the real Keycloak server.
- `tests/unit/sync-mirror.test.ts`: 10 passing cases cover roles/status,
  no repeat PUT, external profile correction, masked/phone-placeholder names,
  staff-before-citizen precedence, removed/missing accounts, credential and
  boundAt preservation, concurrent HRMS edits, and malformed-state refusal.

Mirroring never writes DIGIT, memberships, or bindings. Fingerprint skips apply
only to the mirror itself: reconcile must still evaluate access and identifier
drift. A DIGIT edit arriving during a pass is picked up on the next pass.

Per core-owner's `core-sync-echo` decision, BFF-authored USER UPDATE events skip
mirror reruns only. Security checks and identifier propagation still run; the
authorship helper must never suppress either. Changed-state comparison avoids
repeat PUTs without a new Redis record family.

Identifier propagation, reconcile, readiness and their gate cases remain for
the next increment; this evidence does not claim those complete.
