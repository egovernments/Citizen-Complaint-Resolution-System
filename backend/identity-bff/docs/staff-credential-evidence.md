# Derived staff credential: item 7

Gate correction: the later 8c run proved stock egov-user requires roles on
updates. The writer now copies freshly read roles unchanged; the fake requires
at least one role code. See `staff-credential-roles-gate-evidence.md` for the
regression and current validation. The original role-omission assumption below
is superseded by that gate result.

The staff credential service uses the frozen `derivedStaffPassword` implementation.
`activateStaffCredential` writes the current key's credential, signs in, logs out
the returned native token once, then mirrors the version. `staffLogin` repairs
an invalid credential at most once per lease object, using activation's logout-once
sequence. Locked, inactive and unknown/dependency failures never enter repair.
A known different version rolls over before a grant. Missing, current or retired
versions try the current key first; a successful grant never re-activates, so a
failed mirror cannot cause the next login to revoke the previous session's token.
A successful unrecorded-version grant retries its mirror without changing the
password or logging out. Revocation uses only the recorded key and never repairs. No plaintext credential is persisted by the service.

## Configuration and rollback

- `IDENTITY_STAFF_CREDENTIAL_MODE=rotate|derived`, default `rotate`.
- `IDENTITY_CREDENTIAL_KEYS=1:<base64 key>,2:<base64 key>`; each key is at least
  32 bytes, versions are distinct positive integers.
- `IDENTITY_CREDENTIAL_KEY_CURRENT=2` must name a configured version when keys
  are supplied or derived mode is enabled. Malformed config fails without
  printing key material. Retain old keys until no mirrored entry uses them.
- Activation is derived-only. Callers skip it in rotate mode. A direct call in
  rotate mode fails rather than returning a fictitious key version.
- The existing managed/linked rotate path is unchanged except for omitting DOB
  from linked updates (`yyyy-MM-dd` search values are invalid in the update DTO;
  omission preserves the stored DOB). The new `staffLogin` rotate helper uses
  the safe writer, so it additionally omits active/locks and preserves roles, re-reads the
  account, classifies refusals and fences the mint. Those differences apply to
  the new helper, not the retained managed rotate branch.
- Derived managed login takes the person lease outside the legacy account lease,
  rechecks the browser session, then reads the credential version fresh from
  Keycloak. Legacy inventory replacement is core-revocation's separate change.

## Safe writer and limits

`writeDigitIdentifiers` searches the account itself and applies the documented
field map. It preserves fresh HRMS fields, omits DOB/active/locks and preserves roles, accepts
already-normalized phone/country values, and never clears an identifier. Masked
copied fields return `skipped-masked`; credential activation exposes
`DIGIT_PII_MASKED`. Stored-field validation errors expose `DIGIT_ACCOUNT_INVALID`.

An HRMS edit before the search is preserved. An edit between the search and
update can still be overwritten because egov-user has no conditional update.
A failed Keycloak mirror is logged without rolling back the successfully changed
credential; the lease is checked again before returning. Native refresh tokens
issued before binding remain subject to the design's revocation limit.

## Executed evidence

From `backend/identity-bff`, Redis at `127.0.0.1:16385`:

- `npx tsc --noEmit`: clean.
- `REDIS_PORT=16385 npx vitest run`: 328 passed, 3 skipped, 14 todo.
  The skipped cases are the existing real-Keycloak fixture; this item exercised
  the stateful local egov-user fake, not a live egov-user deployment. No tests were
  removed. That run used a permissive fake for omitted roles; the later gate correction
  restores stock egov-user validation. Optional-type search remains supported.

Key tests (all executed):

- `credential.test.ts`: frozen `encode_v1` vectors and 10,000 policy-valid passwords.
- `staff-credential.test.ts`: activation logs out the existing native token once;
  missing/retired versions after a failed mirror preserve the previous token (regression
  failed before the fix and passed after); out-of-band change gets exactly one repair per lease object; locked/inactive
  never repair; masked fields prevent activation; failed mirror is logged;
  revocation never repairs/probes retired keys; current-key rollover; derived →
  rotate → derived; managed login reads the recorded version and rejects revoked
  sessions; lost lease after mint revokes the minted token.
- `digit-writer.test.ts`: fresh HRMS name/gender/email preserved; DOB/active/locks omitted and fresh roles preserved; masked copied fields skipped; verified identifiers replace
  masked email; no identifier clears; citizen uuid search; typed validation.
- `staff-credential-config.test.ts`: default mode, retained keys/current version,
  invalid/short/duplicate key configuration rejected without exposing key data.

Shared APIs and agreements are recorded in `core-internals.md` §3.
