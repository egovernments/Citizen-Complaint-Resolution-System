# Core internals (items 7–10, 12, 19)

Owner: core-owner. This note fixes the internal APIs that the core leaves call
across each other's modules, so they can work in parallel. It is internal to
the BFF and sits under the frozen contract in `identity-bff.md` (item 0):
where the two disagree, item 0 wins and this note is corrected.

Changing anything below: message core-owner first. Changing a shared piece
named in item 0 (`digit.accounts`, `digit.bindings`, the lease and lock order,
Redis key families, error codes) also needs a `contract.proposal` on thread
`identity-contract`.

## Who owns which file

| Module (path under `src/modules/`) | Owner leaf | Items |
|---|---|---|
| `accounts/person-lease.ts`, `accounts/uuid-lock.ts` | core-owner | A2 |
| `accounts/credential.ts` (`encode_v1`, from item 0) | contract-owner | 0 |
| `accounts/credential-service.ts`, `accounts/digit-writer.ts`, `managed-accounts/digit-user-client.ts` (login-failure parsing) | core-credential | 7 |
| `bindings/*` (store, predicate, routes), `workspace-members/*`, `jobs/convert-account-links.ts` | core-bindings | 8, 9, 19 |
| `revocation/*`, `sessions/session-store.ts` (update-only writes, generation) | core-revocation | 10 |
| `sync/*` (mirror, Keycloak writer, reconcile, email/phone write-through) | core-sync | 12 |

**Exact export paths** (consumers import these; nothing else):
- `sync/keycloak-writer.ts`: `updateKeycloakUser`; `sync/mirror.ts`: `mirrorPerson`;
  `sync/reconcile.ts`: `getReconcileReadiness`, `startReconcile`.
- `accounts/credential-service.ts`: §3; `accounts/digit-writer.ts`: `writeDigitIdentifiers`.
- `revocation/index.ts`: every §5 function; `revocation/poller.ts`:
  `getPollerReadiness`, `startKeycloakEventPoller`.
- `bindings/predicate.ts`, `bindings/store.ts`: §2; `bindings/invitations.ts`:
  `pendingInvitationsFor(subject)`.
- Keycloak Admin calls: `request()` exported from
  `organizations/organization-service.ts` (one-word `export`, made identically
  by whoever needs it first).

A temporary seam (`bindings/ports.ts`) is allowed while a provider hasn't
merged, but it is removed before the owner PR: consumers import the real
modules directly.

A leaf edits another leaf's file only by agreement on the bridge. Each module
exports exactly the functions below; a consumer whose provider has not merged
yet codes against the signature and fakes it in its own tests.

## 1. The person lease (A2) — `accounts/person-lease.ts`

One renewable Redis lease per Keycloak subject. It is the only lease around
any Keycloak user read-modify-write, `_select`, revocation, provider unlink and
binding transition for that person. It replaces the attribute lease
(`organization-service.ts` `withUserAttributeLease`) and the per-account lease
(`managed-account-service.ts`).

```ts
export class LeaseBusyError extends Error {}   // 503 IDENTITY_BUSY; wait timed out
export class LeaseLostError extends Error {}   // 503 IDENTITY_BUSY; renewal failed; revoke anything minted, return nothing

export interface PersonLease {
  readonly subject: string;
  readonly token: string;
  /** Throws LeaseLostError if the lease has expired or moved. Call before every externally visible effect. */
  assertHeld(): Promise<void>;
  /** SET key value PXAT expiresAtMs, only while this lease is held (Lua fence). false = lost. */
  fencedSet(key: string, value: string, expiresAtMs: number): Promise<boolean>;
}

export function withPersonLease<T>(
  subject: string,
  operation: (lease: PersonLease) => Promise<T>,
  options?: { waitMs?: number },              // default 15 000
): Promise<T>;

/** The lease held by the current async call chain, or null. */
export function currentPersonLease(): PersonLease | null;
```

- Key `{prefix}:identity:subject-lease:{sub}`, `SET NX PX 30000`, renewed every
  10 s with Lua `if get==token then pexpire`. Released with compare-and-delete.
- **Pass the lease down** (contract §2.5). As a safety net only, a nested `withPersonLease` for the **same** subject in the same
  async chain (AsyncLocalStorage) reuses the held lease. Nesting a **different**
  subject throws: code that touches several people (Organization disable,
  reconcile) takes each person's lease in turn, never two at once.
- **Lock order:** operation → tenant → slug → **person** → phone → uuid. Short
  locks below the person lease are taken only inside it.
- `withUuidLock(tenantId, uuid, fn)` in `accounts/uuid-lock.ts`: key
  `{prefix}:identity:uuid-lock:{tenantId}:{uuid}`, 30 s, wait ≤ 15 s, NX; throws if called
  outside a person lease; a timed-out wait is `BindingBusyError` (503 `BINDING_BUSY`).

## 2. The access predicate (§3, D10) — `bindings/predicate.ts`

```ts
export type AccessDenial =
  | "KEYCLOAK_DISABLED" | "NO_ACTIVE_BINDING" | "NOT_A_MEMBER"
  | "ORGANIZATION_INACTIVE" | "TENANT_INACTIVE" | "PHONE_NOT_VERIFIED";

export interface StaffAccess {
  allowed: boolean;
  denial?: AccessDenial;
  binding?: Binding;                          // the active binding, when there is one
  via: "binding" | "managed";                 // "managed" = kcbff- fallback until D13
}

/** Fresh reads only (Keycloak user, digit.bindings, live Organization membership + lifecycle). Never session claims. */
export function staffAccess(subject: string, tenantId: string): Promise<StaffAccess>;
export function citizenAccess(subject: string): Promise<{ allowed: boolean; denial?: AccessDenial }>;
```

- The predicate does not check DIGIT `active`; callers that have the DIGIT
  account check it next (discovery shows `DIGIT_ACCOUNT_INACTIVE`; `_select` refuses).
- `bindings/store.ts` exports `readBindings(subject)`, `bindingsFor(tenantId)`
  (search via `digit.boundUuids`) and the transitions `ensureActive`,
  `createPending`, `accept`, `remove`. All transitions run inside the person
  lease and the uuid lock and write `digit.bindings` + `digit.boundUuids` in one
  PUT through the sync module's Keycloak writer (§4).

```ts
export type BindingActor =
  | { kind: "browser"; subject: string; requestId: string }        // _link: actor rules apply
  | { kind: "workload"; operationId: string; restartNo: number }   // PGR bindings/_ensure: trusted
  | { kind: "migration" };                                         // item 19

export class BindingConflictError extends Error {}                 // 409 BINDING_CONFLICT

/** Make (subject, tenantId) → uuid active. Takes the person lease (re-entrant) and the uuid lock itself. */
export function ensureActive(input: {
  subject: string; tenantId: string; uuid: string; actor: BindingActor;
}): Promise<{ binding: Binding; created: boolean }>;
```

`ensureActive` rules:
- same key, same uuid, already `active` → `{created: false}`, no write;
- same key, different uuid → `BindingConflictError` (409 `BINDING_CONFLICT`);
- uuid bound to another person → 409 `DIGIT_ACCOUNT_LINKED_ELSEWHERE`;
- same key, `removed` → 409 `BINDING_REMOVED` (never resurrected; only a
  browser `_link` with `reinvite: true` makes it `pending` again);
- the workload actor skips the browser actor rules and does **not** set the
  credential: the founder's credential is set at their first `_select` (B8).
  Browser and migration actors leave credential activation to the caller.

## 3. The credential module (§6, item 7) — `accounts/credential-service.ts`

```ts
export type StaffLoginFailure = "INVALID_CREDENTIALS" | "ACCOUNT_LOCKED" | "ACCOUNT_INACTIVE" | "DEPENDENCY";
export class StaffLoginError extends Error { constructor(readonly reason: StaffLoginFailure, message?: string); }

export interface StaffAccountRef { tenantId: string; uuid: string; userName: string; keyVersion?: number }

/** Derived mode only: write, sign in, log out the existing token once, then mirror the key version. Callers skip activation in rotate mode; calling it there throws. */
export function activateStaffCredential(account: StaffAccountRef, lease: PersonLease): Promise<{ keyVersion: number }>;

/** Mint a DIGIT token for an active binding. Derived mode: sign in; on INVALID_CREDENTIALS repair once per lease, never on locked/inactive. Rotate mode: today's per-login rotation. */
// ACCOUNT_INACTIVE above is the internal reason; the wire code is DIGIT_ACCOUNT_INACTIVE (contract B5).
export function staffLogin(account: StaffAccountRef, lease: PersonLease): Promise<DigitLogin & { keyVersion?: number }>;

/** Revocation fallback: sign in with the derived credential to find the live token. Never repairs, never reactivates. null = not grant-eligible. */
export function findLiveStaffToken(account: StaffAccountRef): Promise<DigitLogin | null>;

export function staffCredentialMode(): "rotate" | "derived";   // IDENTITY_STAFF_CREDENTIAL_MODE, default "rotate"
```

- `accounts/digit-writer.ts` exports the safe writer used for the derived
  credential and verified identifiers (legacy rotate/provisioning paths remain
  until their owning items replace them):

  ```ts
  export interface DigitIdentifierChanges {
    emailId?: string; mobileNumber?: string; countryCode?: string; password?: string;
  }
  export interface DigitWriteResult {
    status: "written" | "unchanged" | "skipped-masked";
    account: DigitAccount;
  }
  export function writeDigitIdentifiers(
    account: { tenantId: string; uuid: string }, changes: DigitIdentifierChanges,
  ): Promise<DigitWriteResult>;
  ```

  It does its own fresh admin search, never clears an identifier, and does no
  phone parsing. The §6 field map of `03-state-schema.md` omits `dob`, `active`,
  and locks. Roles are copied unchanged from the fresh search because stock
  egov-user validates at least one role code even on identifier/password updates;
  callers cannot change them. A masked copied field (including role metadata)
  skips the write; activation maps this to `DIGIT_PII_MASKED`. `DigitValidationError` exposes `DIGIT_ACCOUNT_INVALID`
  (503). HRMS edits before the search are preserved; edits between search and
  update may still be overwritten because egov-user has no conditional update.
- `StaffAccountRef.keyVersion` is the version freshly read from `digit.accounts`.
  A known different version rolls over before login. An absent, current or
  unavailable recorded version tries the current credential first; only an
  invalid grant triggers activation, counting as the lease's one repair. This
  prevents repeated logout when mirroring failed. A successful unrecorded-version
  grant retries the mirror without rewriting the password or logging out. A
  request never probes several keys. `findLiveStaffToken` returns null for an absent
  or unavailable recorded key, or in rotate mode, and never repairs.
- Repair is allowed once per `PersonLease` object (a `WeakSet`), only for
  `INVALID_CREDENTIALS`. Key rollover and first activation use the current key
  directly. Locked/inactive accounts never trigger repair.
- Activation order is write → login → revokeToken → mirrorPerson. A failed
  mirror is logged without undoing the changed DIGIT credential. Callers must
  authorize an active binding first; this API never activates pending bindings.
- Login refusals come from item 6: `digit-user-client.passwordLogin` throws
  `DigitLoginRejectedError {reason: invalid_credentials | locked | inactive | unknown}`.
  The credential service maps it (no re-parsing): `invalid_credentials` → one
  repair; `locked` → `ACCOUNT_LOCKED`; `inactive` → `DIGIT_ACCOUNT_INACTIVE`;
  anything else → `DEPENDENCY`. `StaffLoginError` is the credential service's
  own error carrying that mapped reason.
- The keyVersion goes into the `digit.accounts` staff entry by calling the
  mirror (§4) with `{ credential: { tenantId, keyVersion, setAt } }`.

## 4. The sync module (§4, item 12) — `sync/`

```ts
/** Re-read DIGIT + Keycloak and rewrite this person's digit.accounts and name. Runs inside the person lease (takes it if not held). */
export function mirrorPerson(subject: string, hint?: { credential?: { tenantId: string; keyVersion: number; setAt: number } }): Promise<void>;

/** The one Keycloak user writer: fresh GET, change only `attributes` (+ firstName/lastName when mirroring), preserve email, emailVerified, username; never send `enabled`. Must be called inside the person lease. */
export function updateKeycloakUser(subject: string, change: (user: UserRepresentation) => UserRepresentation | null): Promise<void>;
```

- Bindings transitions write through `updateKeycloakUser`; the mirror writer
  refuses to create or restore a binding (it only touches `digit.accounts` and
  the name).
- `_link`, `_accept` and `_remove` call `mirrorPerson` at the end (immediate
  mirror). Reconcile calls revocation for drift it finds.

## 5. Revocation (§6, item 10) — `revocation/`

`revokePerson` and `revokeAccount` default to credential fallback. Reconciliation
uses `{ fallback: false }` for steady denial: sessions and inventoried tokens
are still revoked, but `findLiveStaffToken` is skipped. This option is persisted
in the subject job so retries preserve it (core-owner decision, thread `core`).

```ts
export type RevocationReason =
  | "KEYCLOAK_DISABLED" | "KEYCLOAK_DELETED" | "LOGOUT_ALL" | "CREDENTIAL_CHANGED"
  | "MEMBERSHIP_REMOVED" | "BINDING_REMOVED" | "DIGIT_INACTIVE" | "ROLE_CHANGED"
  | "ORGANIZATION_DISABLED" | "TENANT_INACTIVE" | "DIGIT_ACCOUNT_MISSING" | "LOGOUT";

/** Bump the revocation generation, revoke every inventoried token (fallback via findLiveStaffToken), end BFF sessions; failures go to the retry set. Takes the person lease. */
export function revokePerson(subject: string, reason: RevocationReason, options?: { keepSessionId?: string; fallback?: boolean }): Promise<void>;

/** Revoke one DIGIT account's tokens only (binding removed at one tenant, role change at one tenant). */
export function revokeAccount(subject: string, account: { tenantId: string; uuid: string }, reason: RevocationReason, options?: { fallback?: boolean }): Promise<void>;

/** Inventory: record a minted token under the lease fence. Called by _select. */
export function recordToken(lease: PersonLease, account: { tenantId: string; uuid: string }, login: DigitLogin, kind: "staff" | "citizen"): Promise<void>;

/**
 * An Organization went FAILED/disabled, or its MDMS tenant was deactivated.
 * Durably enqueue one subject job per member (Keycloak Organization members ∪
 * bindingsFor(tenantId)) on the revoke-subject-jobs set, then drain them one
 * person at a time (never two leases at once). Returns once every job is
 * enqueued; a failed person stays queued for the retry worker. Idempotent:
 * callers repeat it on every repeat of the transition, even if the stored
 * state already matches, so an interrupted fan-out is finished.
 */
export function revokeTenantMembers(tenantId: string, reason: "ORGANIZATION_DISABLED" | "TENANT_INACTIVE"): Promise<void>;

/** Cached token for this account, validated cheaply against egov-user, or null. */
export function cachedToken(lease: PersonLease, account: { tenantId: string; uuid: string }): Promise<DigitLogin | null>;
```

### Session and logout API for surf-bff (owner: core-revocation)

```ts
// sessions/session-store.ts
export class SessionRevokedError extends Error {}   // 401 SESSION_REVOKED
export function requireCurrentSession(lease: PersonLease, sessionId: string): Promise<IdentitySession>;
export function listPersonSessions(subject: string): Promise<Array<{
  sessionId: string; surface: IdentitySurface; oidcClientId?: string;
  createdAt?: number; lastSeenAt?: number; kcSessionId?: string;
}>>;

// revocation/index.ts
/** logout {scope}: ends BFF/Keycloak sessions; others must preserve current-held account tokens.
 * Snapshot current-held accounts/tokens before logout; protect token values across duplicate inventory refs.
 * Shared DIGIT tokens cannot be revoked per consumer (identity-bff.md §8). */
export function logoutSessions(subject: string, scope: "current" | "others" | "all", currentSessionId: string): Promise<void>;
/** Phone change: end this person's sessions carrying oldPhoneRef, except keepSessionId. */
export function endPhoneSessions(subject: string, oldPhoneRef: string, keepSessionId?: string): Promise<void>;
```

### Identifier write-through for surf-bff (owner: core-sync)

```ts
// sync/identifiers.ts
/** Fresh-read the person's verified email/phone in Keycloak and write them to every bound DIGIT account (and the citizen account). Never clears. */
export function propagateIdentifiers(subject: string): Promise<{ written: number; unchanged: number; skipped: number }>;
```

### Readiness (for `/readyz`, wired by surf-bff)

`revocation/poller.ts`: `getPollerReadiness(): Promise<{status: "ok"|"down"|"disabled"; lagSeconds: number|null}>`, `startKeycloakEventPoller(): () => void`.
`sync/reconcile.ts`: `getReconcileReadiness(): Promise<{status: "ok"|"down"|"disabled"; intervalSeconds: number; lagSeconds: number|null}>`, `startReconcile(): () => void`, `requestReconcileNow(reason: string): Promise<void>`.

## 6. `_select` order (who writes what)

Inside `withPersonLease(sub)`: re-read session and compare generation
(core-revocation) → `staffAccess` (core-bindings) → DIGIT `active` →
`cachedToken` or `staffLogin` (core-credential) → `recordToken` under the
fence → save context `SET XX`. If the lease is lost after minting, revoke the
minted token instead of returning it. core-bindings owns the `_select` route
edit; core-revocation supplies the session and inventory pieces.

## 7. Test fixtures

- Redis: each leaf uses its own port from `lanes/02-TREE.md`.
- Real Keycloak 26.7.3 suite: one shared compose fixture, agreed with
  contract-owner. core-sync drafts it; others reuse it.
