# Item 13: phone ownership and proofs

Implemented on `identity/surf-phone`, from surf-bff `1526ec668`. Production effects handoff `417557d50` was cherry-picked as `fbf08f182`; retry handling and additional gates are in `cea72f61b`. Owner `49fd676ba` was merged, with the agreed mobile-validation import relocation completed in `09734da57`. No phone route or error shape changed.

Production OTP routes call `endPhoneSessions` and core `propagateIdentifiers`. A DIGIT outage after the verified Keycloak update returns `503 IDENTITY_UNAVAILABLE` and releases the challenge for retry. Old-phone sessions have already ended; the initiating session retains the verified phone. Retrying preserves the citizen UUID and finishes the DIGIT update.

Anonymous sign-in uses the agreed prospective-person lease, phone lock and fresh lookup before plain Keycloak creation. Both locks are released before taking the actual person's lease and phone lock to create a session. New usernames are opaque. This approved sequence is recorded in the frozen contract §2.5; the PR includes that documentation edit.

Executed coverage:

- `tests/e2e/phone-proof.test.ts`: concurrent first sign-ins create exactly one opaque identity; the prospective lease differs from the actual identity and is released; concurrent claimants cannot steal a phone; old sessions end on change; a released number can be claimed; competing changes from old sessions cannot overwrite the winner.
- `tests/e2e/identity-bff.test.ts`, citizen phone OTP group: session/person/purpose binding, tenant phone validation, fresh ownership check at verification, production propagation to the same citizen UUID, retry after a DIGIT outage, and the national mobile number as an unnamed citizen's actual DIGIT name. Existing OTP delivery, replay, disabled-user and recycling cases remain.

[Committed test summary](evidence/phone-verification.txt): full suite 432 passed, 5 skipped, 15 todo; TypeScript clean. Tests use real Redis, HTTP Keycloak/DIGIT/MDMS mocks, and in-memory OTP delivery. They do not prove stock Keycloak 26.7.3, real egov-user, or non-fixed real OTP delivery; those gates remain root-owned. This leaf removed no tests.

Core integration prerequisite: propagation targets citizen `digit.accounts` entries. The effects test seeds the frozen entry. Core-sync/core-bindings own ensuring the entry from citizen `_select` and the combined new-citizen → entry → phone-change test (owner decision, `identity-contract`, 2026-10-04). No duplicate citizen inventory writer was added here.

The branch inherits surf-bff's shared surface and core dependencies. Integrate surf-bff's prerequisite history before or with this phone PR; the item 13 delta is the phone wiring, retry mapping, tests and documentation described above.
