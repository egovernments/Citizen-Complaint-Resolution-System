# 8c credential gate: preserve freshly read roles

The 8c gate found that `UserService.updateWithoutOtpValidation` calls
`validateUserRoles` before the repository update. Omitting roles therefore fails
with `AtleastOneRoleCodeException`, even though an omitted or empty role array
would leave stored roles unchanged at the repository layer. Both derived
credential activation/repair and binding-model rotate login use this writer,
so the refusal surfaced as `503 DIGIT_ACCOUNT_INVALID` in both modes.

The writer now copies the entire role array unchanged from its fresh admin
search. It neither constructs roles nor accepts role overrides from the caller.
The copied code, name and tenant metadata follow the same masked-value skip
rule as other copied fields. DOB, active status and lock fields stay omitted.
As with other copied fields, an HRMS role edit between search and update can
still be overwritten; stock egov-user offers no conditional update.

The stateful egov-user fake now rejects updates without at least one role code.
This corrects the permissive fake that previously hid the gate failure.

## Regression evidence

Base: `identity/completion-base` at `69f9af553`.

Before the writer fix, with strict fake validation and the new tests in place:

`REDIS_PORT=16385 npx vitest run tests/unit/staff-credential.test.ts -t '8c'`

Result: **2 failed, 3 passed, 13 skipped**. The derived and rotate login cases
both failed with `DigitValidationError`; the three malformed-role rejection
cases passed. Thus the tests reproduced the observed refusal locally before
changing the writer.

After the fix:

`REDIS_PORT=16385 npx vitest run tests/unit/staff-credential.test.ts tests/unit/digit-writer.test.ts`

Result: **35 passed**. Key tests:

- `8c gate: %s login preserves fresh roles required by egov-user` (derived and
  rotate): one credential write succeeds; HRMS's fresh role array, including
  role names and tenant IDs, remains unchanged in storage and the login profile.
- `8c contract: egov-user rejects an identifier update without a role code (%j)`:
  absent roles, empty roles and an empty role code all fail before password writes.
- `copies fresh roles unchanged and ignores caller attempts to change them`.
- `skips masked copied role %s without writing`: code, name and tenant ID.

No test was removed. The old role-omission assertion was replaced with an
explicit preservation assertion. There is no Keycloak behavior change, so the
real-Keycloak suite is outside this fix's validation scope. Live 8c redeployment
and gate re-run remain with identity-root.

Final checks before the PR push:

- `npx tsc --noEmit`: clean (exit 0).
- `REDIS_PORT=16385 npx vitest run`: **657 passed, 11 skipped, 2 todo**;
  51 test files passed and 3 skipped. The full suite ran once after the
  affected-file iteration, with no concurrent suite runs in this worktree.
