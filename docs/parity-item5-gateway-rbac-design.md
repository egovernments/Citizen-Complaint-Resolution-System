# Design: Gateway RBAC enforcement on compose (Kong) — parity item #5

**Status:** 🧭 Design / scoping — not yet implemented. Companion to the
[deployment-parity tracker](deployment-parity-compose-vs-k8s.md) (item #5).

**TL;DR:** The Kubernetes Spring-Cloud gateway enforces action-level RBAC; the
compose Kong gateway does not. This document scopes closing that gap in Kong,
mirroring the K8s model, and recommends a phased, audit-first rollout because it
sits on the critical auth path.

---

## 1. The gap

| | Authenticate (valid token?) | Authorize (may this principal call this action?) |
|---|---|---|
| **K8s Spring gateway** | ✅ | ✅ via `egov-accesscontrol` |
| **Compose Kong (today)** | ✅ *(added in PR #1101 / item #4)* | ❌ **none** |

On compose, **any authenticated principal can call any protected endpoint** —
there is no action-level RBAC. A logged-in citizen, or a low-privilege employee,
can reach endpoints their roles should not. Because compose also runs production
tenants, "auth-soft" is not acceptable — hence the decision (item #5) that the
gateway **must** enforce RBAC to match K8s.

> **Scope boundary:** this is **action-level** RBAC (is role X allowed to call
> URL Y). **Record-level ownership** (can this citizen see *this* complaint) is a
> separate, service-side concern — fixed for PGR search in item #6 / PR #1100 and
> **not** something a gateway can enforce.

## 2. The K8s reference model (what we are matching)

The Spring gateway classifies every request into three buckets, driven by two
env-configured lists (`EGOV_OPEN_ENDPOINTS_WHITELIST`,
`EGOV_MIXED_MODE_ENDPOINTS_WHITELIST`) plus the accesscontrol host
(`EGOV_AUTHORIZE_ACCESS_CONTROL_HOST`):

1. **Open whitelist** → anonymous allowed (login, OTP validate, MDMS/localization
   search, `filestore/v1/files/url`, tenant search, …). No token required.
2. **Mixed-mode** → auth optional: resolve `userInfo` if a token is present, but do
   not require one (`/user/_search`, `/access/v1/actions/mdms/_get`, …).
3. **Protected** (everything else) → require a valid token **and** authorize the
   action via `egov-accesscontrol`.

> **Note on `custom-filter-property: "false"`** (gateway `values.yaml`): this
> toggles a *separate* custom URL-routing filter (`URL_LISTS` — legacy Punjab-PT
> rewrites), **not** RBAC. The core auth/RBAC filter is always active because the
> whitelist + accesscontrol-host env vars are always set. So K8s RBAC is on.

### RBAC data model
- `ACCESSCONTROL-ROLEACTIONS.roleactions` — maps **rolecode → actionid**
  (e.g. `SUPERUSER → 2560`, `GRO → 254`, `CSR → 2562`).
- `ACCESSCONTROL-ACTIONS(-TEST)` — maps **actionid → URL**
  (e.g. `2021 → /report/pgr/GROPerformanceReport/_get`).
- Authorization = does any of the principal's roles have a roleaction whose
  actionid maps to the requested URL, for the request tenant.

The compose `full-dump.sql` has these seeded (368 roleactions on `pg`), so RBAC
will function on the dump. See §5.7 for the freshly-onboarded-tenant caveat.

## 3. Proposed design — extend the Kong `pre-function`

The existing global auth `pre-function` in `local-setup/kong/kong.yml` already:
resolves `userInfo` from the token via `/user/_details`, strips client-supplied
`userInfo` (anti-spoof), and — since PR #1101 — returns
`InvalidAccessTokenException` on a present-but-invalid token.

Extend it into a full authn+authz filter:

```
1. Determine request path P.
2. If P matches an OPEN-whitelist entry     -> pass through (no token needed, no authorize).
3. Else resolve userInfo from the token (existing logic).
     - token present but invalid            -> 401 InvalidAccessTokenException (existing, #4).
4. If P matches a MIXED-mode entry          -> pass through with whatever userInfo resolved.
5. Else (PROTECTED):
     - no valid userInfo                     -> 401 InvalidAccessTokenException.
     - call egov-accesscontrol /access/v1/actions/_authorize
         { roles: userInfo.roles, actionUrl: P, tenantIds: [tenant] }
     - authorized == false                   -> 403 AccessDeniedException envelope.
     - authorized == true                    -> pass through.
```

The 403 body must match what digit-ui expects (an `Errors[]` envelope with an
`AccessDeniedException`/`UnAuthorizedAccess` code), analogous to how #4 shaped the
401 `InvalidAccessTokenException`.

## 4. egov-accesscontrol authorize contract (needs pinning)

Endpoint (confirmed present on the running service):
`POST /access/v1/actions/_authorize`, classes
`AuthorizationRequestWrapper` → `AuthorizationRequest{ tenantIds, roles/roleActions, actionUrl }`.

Live probes returned `NullPointerException: ...AuthorizationRequest.getTenantIds()
because "authorizeRequest" is null` for several guessed wrapper keys, so **the
exact JSON field name(s) must be pinned** before Phase 2 — either by decompiling
`egov-accesscontrol/app.jar` (`org.egov.access.web.controller.ActionController`,
`...domain.model.authorize.*`) or from the platform source. This is a
prerequisite task, not a blocker for Phase 1.

## 5. The hard parts (why this is a mini-project, not a one-line fix)

1. **Whitelist drift (security-critical).** The open/mixed lists would live in
   *both* the Spring gateway config and Kong. Divergence = either blocked traffic
   or leaked endpoints. Mitigation: a **single source of truth** (a shared file
   rendered into both) or a CI check asserting the two lists are equal.
2. **CCRS-curated whitelist.** The K8s whitelist is the generic eGov one and
   carries non-CCRS cruft (`pt-calculator`, `tl-services`, `bpa-services`, `edcr`
   — same family as item #14). #5 must define the **CCRS-correct** open/mixed
   lists (PGR + core services), not copy the generic one.
3. **Exact path-match semantics.** Each entry is prefix- or exact-match in the
   Spring matcher; Kong must replicate this precisely. Wrong = block legit traffic
   or leak protected endpoints.
4. **Authorize contract** (see §4) — pin the exact request shape + response field
   (`authorized` vs `isAuthorized`).
5. **Performance.** Protected requests would make a *second* upstream call
   (accesscontrol) after `/user/_details`, both in Kong's access phase. Needs
   **response caching** (keyed by role-set + URL + tenant) to bound latency and
   load on accesscontrol.
6. **Fail-open vs fail-closed.** If accesscontrol is unreachable: **deny** (safe,
   but an accesscontrol outage takes down the whole app) or **allow** (available,
   but a security hole during the outage)? Explicit decision required; recommend
   fail-closed for protected paths with a short timeout + a loud alert.
7. **Data dependency.** RBAC only works when `ACCESSCONTROL-ROLEACTIONS` is
   seeded. True on the dump; couples to the DDH onboarding bug (#1090) for
   freshly-onboarded tenants — those must onboard roleactions correctly first.

## 6. Recommended phasing (de-risking the auth path)

- **Phase 1 — classification + authn completion (lower risk).**
  Add the open / mixed / protected buckets to the pre-function and enforce
  "protected requires a valid token." Define + curate the **CCRS-specific**
  whitelist. Builds directly on #4; no accesscontrol call yet.
- **Phase 2 — RBAC authorize (higher risk).**
  Call accesscontrol for protected paths, but **ship in audit / log-only mode
  first**: log every would-be 403 without enforcing, run real traffic, analyze
  false-denials (missing roleactions, whitelist gaps), then flip to **enforce**.
- **Phase 3 — config single-source + CI check** so Kong and the Spring gateway
  whitelists cannot diverge.

## 7. Effort & risk

- **Effort: Medium–Large** — ~100–150 lines of careful Kong Lua, whitelist
  curation, contract-pinning, a real role×endpoint test matrix, response caching,
  and the config-sync mechanism.
- **Risk: High** — critical auth path; a mistake locks out users *or* bypasses
  RBAC. The audit-mode rollout in Phase 2 is essential, not optional.

## 8. Open decisions for the team

1. Fail-open or fail-closed when accesscontrol is unreachable? (recommend closed)
2. Single-source-of-truth mechanism for the whitelists (shared file vs CI check)?
3. Curated CCRS whitelist contents — confirm the open/mixed sets for PGR + core.
4. Rollout gate: how long in audit-mode before enforcing?

## 9. Prerequisites & sequencing

- Land **PR #1101** (item #4) first — Phase 1 extends that same pre-function.
- Pin the accesscontrol `_authorize` contract (§4) before Phase 2.
- Ensure the target tenants have `ACCESSCONTROL-ROLEACTIONS` seeded (§5.7 / #1090).

---

_Authored as part of the compose-vs-K8s deployment-parity review. Consumes the
findings in [deployment-parity-compose-vs-k8s.md](deployment-parity-compose-vs-k8s.md)._
