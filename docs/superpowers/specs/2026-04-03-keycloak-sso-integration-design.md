# DIGIT Keycloak SSO Integration — Design Specification & Gap Analysis

**Date:** 2026-04-03
**Status:** Draft
**Authors:** Chakshu Gautam
**Repo:** ChakshuGautam/Citizen-Complaint-Resolution-System (`feat/keycloak-auth-adapter`)
**Overlay Repo:** ChakshuGautam/DIGIT-keycloak-overlay

---

## Table of Contents

- [Part 1: Technical Specification](#part-1-technical-specification)
  - [1. System Overview](#1-system-overview)
  - [2. Authentication Flows](#2-authentication-flows)
  - [3. token-exchange-svc](#3-token-exchange-svc)
  - [4. Frontend Auth Adapter](#4-frontend-auth-adapter)
  - [5. Infrastructure & Routing](#5-infrastructure--routing)
  - [6. Multi-Tenancy Model](#6-multi-tenancy-model)
- [Part 2: Gap Analysis & Production Readiness](#part-2-gap-analysis--production-readiness)
  - [Security](#security)
  - [Scalability](#scalability)
  - [Reliability](#reliability)
  - [Operability](#operability)
  - [Correctness](#correctness)
  - [Summary](#gap-summary)

---

# Part 1: Technical Specification

## 1. System Overview

### Problem

DIGIT's native auth system (`egov-user` + Spring Security OAuth) is tightly coupled — credentials stored in DIGIT's own database, no support for federated identity (Google, SAML), no standards-based SSO, and no separation between identity management and application authorization. This blocks enterprise deployments that require centralized identity, MFA, or integration with existing corporate directories.

### Solution

An adapter layer that introduces Keycloak as the identity provider while keeping DIGIT's backend services completely unchanged. Three components work together:

```
+-------------+     +------------------+     +-------------+     +--------------+
|   Browser   |---->|  Host nginx      |---->|  token-     |---->|  Kong        |
|  (digit-ui) |     |  (TLS + routing) |     |  exchange-  |     |  Gateway     |
|             |<----|                  |<----|  svc        |<----|              |
+------+------+     +------------------+     +------+------+     +------+-------+
       |                                            |                    |
       |  OIDC/ROPC                                 |  JWKS + Admin API  |
       v                                            v                    v
+-------------+                              +-------------+     +--------------+
|  Keycloak   |                              |  egov-user  |     |  DIGIT       |
|  (IdP)      |                              |  (user DB)  |     |  Services    |
+-------------+                              +-------------+     +--------------+
```

| Component | Role | Deployment |
|-----------|------|------------|
| **KeycloakAuthAdapter** (frontend) | Pluggable auth strategy in digit-ui. Handles login/logout/SSO/token refresh via keycloak-js. Stores session in browser. | Bundled in digit-ui static assets |
| **token-exchange-svc** (backend) | Anti-corruption layer. Validates KC JWTs, lazily provisions DIGIT users, injects DIGIT tokens into API requests, proxies to Kong. | Sidecar container on shared Docker network |
| **Keycloak** (IdP) | Standards-based identity provider. Manages credentials, SSO sessions, federated identity (Google, LDAP), MFA. | Standalone container with imported realm config |

**Design principle:** DIGIT backend services are never modified. The token-exchange-svc translates between Keycloak's JWT world and DIGIT's proprietary `RequestInfo.authToken` world transparently.

---

## 2. Authentication Flows

### Flow 1: Password Login (ROPC Grant)

The primary login flow for email/password credentials.

1. User submits credentials in the UnifiedLogin form
2. Browser sends `POST /realms/{realm}/protocol/openid-connect/token` with `grant_type=password`
3. nginx routes to token-exchange-svc (intercepts the token endpoint)
4. token-exchange-svc forwards to Keycloak for credential validation
5. KC returns JWT access token
6. token-exchange-svc enriches the response with `digit_user_type` and `digit_roles` (looked up from egov-user). **Note:** This enrichment is currently incomplete — the frontend reads these fields but falls back to KC `realm_access.roles` when absent.
7. Browser stores tokens in localStorage and SessionStorage
8. Browser redirects to `/employee` or `/citizen`

**Key detail:** The token endpoint is intercepted by nginx and routed to token-exchange-svc, which forwards to KC and enriches the response. The browser never talks to KC directly.

### Flow 2: SSO / Federated Login (Authorization Code + PKCE)

Used for "Sign in with Google" or existing KC session detection.

1. `kc.login({idpHint: "google"})` triggers redirect to KC authorize endpoint
2. KC redirects to Google OAuth
3. User authenticates with Google
4. Google redirects back to KC with auth code
5. KC exchanges code for tokens, issues JWT
6. keycloak-js captures tokens via redirect callback
7. `_loadUserFromToken()` builds user object
8. Auto-redirect to `/employee` or `/citizen`

PKCE S256 is enforced — no client secret needed (public client).

### Flow 3: Silent SSO Check (on page load)

Detects existing KC session without user interaction via hidden iframe.

1. `kc.init({onLoad: "check-sso"})` opens hidden iframe to `/silent-check-sso.html`
2. KC checks session cookie in iframe context
3. If valid: redirects iframe with auth code appended to URL
4. iframe posts `location.href` to parent via `postMessage`
5. keycloak-js exchanges code for tokens
6. `kc.authenticated = true`, auto-redirect off login page

### Flow 4: API Request Proxying (authenticated)

Every API call after login:

1. Browser sends `POST /pgr-services/...` with `Authorization: Bearer <KC JWT>`
2. nginx routes to token-exchange-svc
3. token-exchange-svc validates JWT via JWKS (signature + expiry)
4. Redis cache lookup by `keycloak:{sub}:{tenantId}`
   - **Cache hit (1-3ms):** Returns cached DIGIT user + token. Sync-checks name/email/roles against JWT claims, updates if changed.
   - **Cache miss (200-400ms):** Searches egov-user by email. If not found, lazily provisions user via `_createnovalidate`. Acquires DIGIT token via `/user/oauth/token`. Caches result (TTL 7 days).
5. Rewrites `RequestInfo.authToken` and `RequestInfo.userInfo` in JSON body
6. Forwards to Kong gateway
7. Kong routes to DIGIT backend service
8. Response returned to browser unchanged

---

## 3. token-exchange-svc

**Purpose:** Anti-corruption layer that translates Keycloak JWTs into DIGIT-native auth, transparent to all DIGIT backend services.

**Runtime:** Node.js + Express, TypeScript, ~800 lines across 10 source files.

### Request Processing Pipeline

| Step | Module | Latency (cached) | What happens |
|------|--------|-------------------|--------------|
| 1. JWT extraction | `server.ts` | <1ms | Extract `Authorization: Bearer` header |
| 2. JWT validation | `jwt.ts` | <1ms (JWKS cached) | Verify signature via JWKS, extract claims (sub, email, name, roles, realm) |
| 3. User resolution | `user-resolver.ts` | 1-3ms (cache hit) | Redis lookup, sync name/email/roles, refresh token if expired |
| 4. Request rewrite | `proxy.ts` | <1ms | Inject `RequestInfo.authToken` + `RequestInfo.userInfo` into JSON body |
| 5. Forward to Kong | `proxy.ts` | varies | HTTP proxy to `kong-gateway:8000` |

Cache miss path adds: egov-user search (50-100ms), optional user create (100-200ms), token acquisition (50-100ms), Redis set.

### Lazy User Provisioning

On first API call from a new KC user:

1. Search egov-user by `userName` (set to email)
2. If not found: create via `_createnovalidate` with deterministic password derived from KC `sub`
3. Mobile number: `90000` + `parseInt(sha256(sub)[:5], 16) % 100000`, zero-padded to 5 digits
4. Default role: `CITIZEN` (overridden by KC `realm_access.roles` if present)
5. User created at state root tenant (`pg`, not `pg.citya`)

### Caching Strategy

- **Key:** `keycloak:{sub}:{tenantId}`
- **TTL:** 7 days (configurable via `CACHE_TTL_SECONDS`)
- **Stored:** DIGIT user object + DIGIT token + token expiry timestamp
- **Sync on hit:** Compares JWT claims (name, email, roles) with cached values; updates DIGIT user if changed

### Bi-directional Role Sync

- **KC to DIGIT (on every request):** JWT `realm_access.roles` filtered to known DIGIT roles, synced to egov-user
- **DIGIT to KC (fire-and-forget):** After resolution, sync DIGIT roles back to KC realm roles + assign city group. Non-blocking — failures logged but don't affect requests.

### Content-Type Aware Proxying

| Content-Type | Token Injection Method |
|-------------|----------------------|
| `application/json` | Rewrite `RequestInfo.authToken` + `RequestInfo.userInfo` in body |
| `multipart/form-data` | Token via query parameter `?auth-token=...` (body is binary stream) |
| Other | `Authorization: Bearer` header |

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /realms/.../token` | Intercepted KC token endpoint — forwards to KC, enriches response |
| `POST /register` | Creates KC user (signup flow) |
| `GET /check-email` | Validates email availability |
| `GET /healthz` | Health check — verifies Redis connectivity |
| `ALL *` | Wildcard — validates JWT, resolves user, proxies to Kong |

---

## 4. Frontend Auth Adapter

**Purpose:** Pluggable auth strategy in digit-ui that abstracts login/logout/token management behind a provider-agnostic interface.

### Strategy Pattern

```
AuthAdapter (abstract interface — 11 methods)
  |-- KeycloakAuthAdapter  (KC OIDC/ROPC, keycloak-js, SSO)
  |-- DigitAuthAdapter     (Legacy egov-user OAuth)
```

Selected at runtime by `globalConfigs.getConfig("AUTH_PROVIDER")`. Dynamic import keeps the unused adapter out of the bundle.

### KeycloakAuthAdapter

**Initialization (before React renders):**
1. `index.js` calls `await initAuthAdapter()`
2. Adapter instantiates `window.Keycloak({url, realm, clientId})` (loaded from CDN in index.html)
3. Calls `kc.init({onLoad: "check-sso", pkceMethod: "S256"})` with silent iframe
4. If existing KC session detected: auto-populates tokens, redirects off login page
5. Registers `onTokenExpired` handler for background refresh

**Login (ROPC):**
1. `POST /realms/{realm}/protocol/openid-connect/token` with `grant_type=password`
2. Response may include custom claims `digit_user_type` and `digit_roles` (enriched by token-exchange-svc when the token endpoint intercept is active). When absent, the adapter falls back to KC `realm_access.roles` from the JWT.
3. `_setTokens()` manually populates keycloak-js instance (avoids re-init redirect loop)
4. `_loadUserFromToken()` builds user object and writes to three storage layers

**Logout:**
1. Clears all in-memory state (`_user`, `_tenantId`)
2. `localStorage.clear()` + `sessionStorage.clear()`
3. Redirects to KC OIDC logout endpoint with `id_token_hint` + `post_logout_redirect_uri`
4. KC clears session cookie, redirects back to `/digit-ui/user/login`

### Three-Tier Token Storage

| Layer | Scope | Purpose |
|-------|-------|---------|
| `Digit.SessionStorage` | Tab (in-memory) | Fast access for DIGIT components |
| `localStorage` | Browser (persistent) | Survives page reloads, recovers session on bootstrap |
| `_kc` instance fields | Tab (in-memory) | keycloak-js token refresh, expiry tracking |

Sync points: Login writes all three. Token refresh updates localStorage + SessionStorage. Page reload reads localStorage and populates the other two.

### Unified Login Page

Single `UnifiedLogin` component replaces separate citizen/employee login pages:
- Email + password form with optional tenant dropdown
- SSO buttons from `adapter.getSupportedProviders()` (currently `["google"]`)
- `globalConfigs.js` monkey-patches `history.pushState`/`replaceState` to redirect legacy login URLs to `/digit-ui/user/login`
- User type (employee vs citizen) determined by KC token response, not by which login page they visited

---

## 5. Infrastructure & Routing

### Nginx Routing (host-level)

| Request | Routed to | Why |
|---------|-----------|-----|
| `/realms/.../protocol/openid-connect/token` | token-exchange-svc (:18200) | Intercept token endpoint to enrich with DIGIT data |
| `/realms/*` (all other OIDC) | Keycloak (:18180) | Authorization, JWKS, userinfo, logout — handled by KC directly |
| `/digit-ui/*` | digit-ui (:18080) | Frontend static assets + SPA fallback |
| `/pgr-services/*`, `/user/*`, `/inbox/*`, etc. | token-exchange-svc (:18200) | API calls — validates KC JWT, proxies to Kong |
| `/register`, `/check-email` | token-exchange-svc (:18200) | Signup flow endpoints |

**Design choice:** Only the token endpoint is intercepted. All other OIDC endpoints go directly to Keycloak, minimizing the proxy's attack surface.

### Docker Network

Both compose stacks share `local-setup_egov-network`:
- **local-setup** (24 containers): DIGIT platform services
- **keycloak-overlay** (2 containers): Keycloak + token-exchange-svc

token-exchange-svc resolves internal hostnames (`egov-user:8107`, `kong-gateway:8000`, `keycloak:8080`) via Docker DNS.

### Keycloak Realm Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Client type | Public (no secret) | SPA can't keep secrets; PKCE S256 compensates |
| ROPC (direct access grants) | Enabled | Password login without redirect flow |
| Token lifespan | 15 min access / 7 day SSO session | Short-lived access tokens, long sessions |
| Brute force protection | 5 failures, 15 min lockout | Basic rate limiting |
| Password policy | Min 8 chars | Matches DIGIT policy |
| Default role | CITIZEN | All new users are citizens |

---

## 6. Multi-Tenancy Model

### Realm-per-State Architecture

```
Keycloak
  +-- Realm: pg (state "pg")
  |     +-- Group: pg.citya
  |     +-- Group: pg.cityb
  |     +-- Client: digit-ui
  +-- Realm: mz (state "mz")
  |     +-- Group: mz.maputo
  |     +-- Client: digit-ui
  +-- Realm: master (admin only)
```

- One realm per DIGIT state root tenant
- Cities are KC groups within the realm
- Users created at state level in DIGIT (`tenantId: "pg"`)
- Cache is per-city (`keycloak:{sub}:pg.citya`) to isolate sessions
- Realms auto-provisioned from `DIGIT_TENANTS` env var

### Tenant Resolution

1. Browser sends `tenantId` in request body (e.g., `pg.citya`)
2. token-exchange-svc extracts root: `pg.citya` -> `pg`
3. DIGIT user search/create uses root tenant (`pg`)
4. Cache key uses full tenant (`pg.citya`) for session isolation
5. KC realm determined from JWT issuer claim

---

# Part 2: Gap Analysis & Production Readiness

Each gap is rated by severity:
- **Critical** — Must fix before production. Security vulnerability or data loss risk.
- **High** — Should fix before production. Reliability or correctness issue under real load.
- **Medium** — Fix soon after launch. Operational pain or degraded experience.
- **Low** — Nice to have. Polish or future-proofing.

---

## Security

### S1: ROPC Grant Exposes Credentials to Browser JavaScript — CRITICAL

The password login flow sends `username` + `password` directly from browser JS to the KC token endpoint via `fetch()`. This means:
- Credentials are accessible to any XSS payload in the page
- No CSRF protection on the token endpoint (it's a direct POST)
- The Authorization Code + PKCE flow exists (used for Google SSO) but isn't used for password login
- ROPC is deprecated in OAuth 2.1

**Recommendation:** Replace ROPC with Authorization Code + PKCE for all login flows. KC's login page handles credentials server-side, never exposing them to SPA JavaScript. Use KC's built-in login theme for the form.

### S2: Deterministic Password Derivation from Public Data — CRITICAL

The token-exchange-svc generates DIGIT passwords deterministically from KC `sub` UUIDs. The `sub` is present in every JWT, visible in KC admin console, and potentially logged. Anyone who knows a user's `sub` can compute their DIGIT password and call `egov-user/oauth/token` directly, bypassing Keycloak entirely.

**Recommendation:** Replace with one of:
- (a) Service-account impersonation: token-exchange-svc uses a dedicated service account, no per-user password needed
- (b) Random password stored in Redis alongside the cached session (not derivable)
- (c) Keycloak Token Exchange (RFC 8693): exchange KC token for DIGIT token natively

### S3: Wide-Open CORS — HIGH

`Access-Control-Allow-Origin: *` in token-exchange-svc allows any origin to make authenticated API requests. A malicious site can make API calls using a user's KC token obtained via XSS or session hijacking.

**Recommendation:** Restrict to known DIGIT UI origins. Read allowed origins from config, validate against request `Origin` header.

### S4: No Audience Validation in JWT — HIGH

JWT validation verifies signature and expiry but doesn't check the `aud` (audience) claim. A JWT issued for a different client in the same realm would be accepted.

**Recommendation:** Add `audience` parameter to JWT verification: `{ issuer: iss, audience: "digit-ui" }`.

### S5: Multipart Token in Query Parameter — MEDIUM

File upload requests pass the DIGIT token as `?auth-token=...`. Query parameters are logged in nginx access logs, visible in browser history, and cached by proxies.

**Recommendation:** Use `Authorization` header for multipart where possible, or strip `auth-token` from nginx access logs.

### S6: KC Admin Credentials Hardcoded — MEDIUM

`admin`/`admin` for KC admin API, `ADMIN`/`eGov@123` for DIGIT system token in docker-compose env vars. Fine for dev, needs secrets management in production.

**Recommendation:** Use Kubernetes secrets, HashiCorp Vault, or cloud secrets manager.

---

## Scalability

### SC1: Single-Instance token-exchange-svc — HIGH

Every API request goes through a single container. No horizontal scaling, no failover. If it crashes, all authenticated API calls fail.

**Recommendation:** Run multiple replicas behind a load balancer. The service is stateless (Redis is shared state) — it scales horizontally. Add graceful shutdown for in-flight requests.

### SC2: Redis is a Single Point of Failure — HIGH

If Redis goes down, all requests become cache misses, overwhelming egov-user with search + token acquisition calls for every request.

**Recommendation:** Redis Sentinel or Cluster for HA. Add fallback to in-memory LRU cache when Redis is unavailable. Add circuit breaker on egov-user calls.

### SC3: System Token is Single-Threaded — MEDIUM

One system token shared across all requests with a global `setInterval` refresh. No retry on refresh failure, no concurrent-safe token update.

**Recommendation:** Token manager with automatic retry, jitter, and mutex-protected refresh.

### SC4: No Rate Limiting on Proxy — MEDIUM

token-exchange-svc accepts unlimited requests. A compromised client could flood it, cascading to all DIGIT services.

**Recommendation:** Rate limiting per KC `sub` (per-user) and per-IP, either in token-exchange-svc or in nginx.

---

## Reliability

### R1: KC Admin Token Never Initializes After Startup Race — CRITICAL

Production logs confirm: `KC sync failed (non-fatal): KC admin token not initialized`. The `initKcAdmin()` function failed at startup (KC not ready despite health check) and never retried. The entire DIGIT-to-KC role sync is silently broken.

**Evidence:** `docker logs token-exchange-svc` shows this message on every request.

**Recommendation:** Add retry-with-backoff on `initKcAdmin()` failure. Separate initial acquisition from periodic refresh. Alert on persistent failure.

### R2: No Circuit Breaker on egov-user — HIGH

If egov-user is slow or down, every cache-miss request blocks. Under load, this exhausts Node.js connections and cascades to all requests including cache hits.

**Recommendation:** Circuit breaker (e.g., `opossum`) on egov-user calls. When open, return 503 immediately.

### R3: 7-Day Cache TTL with No Invalidation — HIGH

If a user is deactivated in KC or DIGIT, their cached session persists for up to 7 days. No mechanism to force-invalidate a specific user's cache.

**Recommendation:** Cache invalidation endpoint (`DELETE /cache/user/{sub}`). Listen to KC admin events for user disable/delete. Consider shorter TTL (1 hour) with lazy refresh.

### R4: Token-Exchange-Svc OTEL Not Reaching Tempo — MEDIUM

Despite OpenTelemetry instrumentation, the service doesn't appear in Tempo traces. Likely missing `OTEL_EXPORTER_OTLP_ENDPOINT` in docker-compose env vars.

**Recommendation:** Add `OTEL_EXPORTER_OTLP_ENDPOINT=http://digit-telemetry:4317` to docker-compose. Verify traces in Grafana.

### R5: No Structured Logging — MEDIUM

Logs are `console.log()` with `[RESOLVE]`, `[PROXY]` prefixes. Not JSON-structured. Hard to parse, aggregate, or alert on.

**Recommendation:** Structured JSON logger (e.g., `pino`). Include trace IDs, request IDs, user sub, tenant, and latency.

---

## Operability

### O1: No Metrics Endpoint — HIGH

No Prometheus `/metrics` endpoint. Can't monitor request rate, latency, cache hit/miss ratio, JWT validation failures, user provisioning rate, or token refresh failures.

**Recommendation:** Add `prom-client` with counters and histograms. Expose on `/metrics`.

### O2: No Readiness Probe Separate from Liveness — MEDIUM

Single `/healthz` checks Redis connectivity. Doesn't distinguish liveness (process alive — restart if not) from readiness (can serve traffic — remove from LB if not, e.g., system token not yet acquired).

**Recommendation:** `/healthz` (liveness) and `/readyz` (readiness — checks Redis, system token, KC admin token).

### O3: No Admin/Debug Endpoints — MEDIUM

No way to inspect runtime state without SSH: cache size, system token status, KC admin token status, JWKS cache state.

**Recommendation:** `/debug/status` (behind auth) that reports internal state.

### O4: No Alerting on Silent Failures — MEDIUM

Multiple failure modes are silently caught: KC sync failures, user update failures, JWKS refresh failures. These degrade functionality without visible signal.

**Recommendation:** Emit error metrics for each failure type. Alert on sustained failure rates.

---

## Correctness

### C1: userName Collision Risk — HIGH

Users searched by `userName` (set to email) at state root. If two KC realms have users with the same email, they map to the same DIGIT user. Correct for same-state scenarios, dangerous in multi-state deployments sharing a DIGIT database.

**Recommendation:** Include realm in search key, or namespace userNames: `{realm}:{email}`.

### C2: Mobile Number Uniqueness — MEDIUM

Synthetic mobile numbers derived from `sub` hash have limited range. Hash collisions possible. DIGIT may enforce mobile uniqueness, causing user creation failures.

**Recommendation:** Retry with different hash seeds on collision, or use wider distribution.

### C3: EMPLOYEE vs CITIZEN Type Mismatch — MEDIUM

User always created as `type: "CITIZEN"` in DIGIT, and DIGIT token always acquired with `userType: "CITIZEN"`. But KC token may indicate `digit_user_type: "EMPLOYEE"`. Some DIGIT services may check `userInfo.type` and deny access to employee-only features.

**Recommendation:** Respect `digit_user_type` when creating users and acquiring DIGIT tokens. Use `userType: "EMPLOYEE"` for employee users.

### C4: No Signup Flow for Self-Registration — LOW

The `/register` endpoint exists but there's no UI flow for self-registration in UnifiedLogin. Citizens needing to register must go through a separate path.

**Recommendation:** Add registration form to UnifiedLogin, or redirect to KC's built-in registration page.

---

## Gap Summary

| Severity | Count | IDs |
|----------|-------|-----|
| **Critical** | 3 | S1 (ROPC in browser), S2 (deterministic passwords), R1 (KC admin token) |
| **High** | 7 | S3 (CORS), S4 (no audience validation), SC1 (single instance), SC2 (Redis SPOF), R2 (no circuit breaker), R3 (cache invalidation), C1 (userName collision), O1 (no metrics) |
| **Medium** | 9 | S5 (query param token), S6 (hardcoded creds), SC3 (system token), SC4 (rate limiting), R4 (OTEL missing), R5 (structured logging), O2 (readiness probe), O3 (debug endpoints), O4 (silent failures), C2 (mobile collision), C3 (type mismatch) |
| **Low** | 1 | C4 (no signup UI) |

### Resolution Strategy: NestJS + Fastify + Bun Rewrite

Rather than patching individual gaps in the existing Express codebase, all 20 gaps are resolved via a clean rewrite of token-exchange-svc using a production-grade framework stack:

- **NestJS** — dependency injection, modular architecture, guards/interceptors/filters, built-in health checks, config validation, throttling
- **Fastify** — 2-3x throughput over Express, schema validation, better hooks model
- **Bun** — native TypeScript execution (no build step), faster startup (~50ms), faster crypto + fetch
- **Dragonfly** — drop-in Redis replacement, multi-threaded, better memory efficiency

This is a drop-in replacement with the same API contract — nginx routing, frontend adapter, and DIGIT backends are unaffected.

---

# Part 3: Remediation Design — token-exchange-svc v2

## Architecture

```
src/
  app.module.ts                — Root module
  main.ts                      — Bun + Fastify bootstrap

  auth/
    auth.module.ts             — JWT validation, JWKS management
    jwt.service.ts             — Validates KC JWTs (injectable, JWKS-cached)
    jwt.guard.ts               — Per-request guard: extract + validate JWT

  user/
    user.module.ts             — User resolution, provisioning
    user-resolver.service.ts   — Cache lookup, search/create, role sync
    digit-client.service.ts    — egov-user API (search, create, update, token)

  proxy/
    proxy.module.ts            — Request rewriting + forwarding
    proxy.service.ts           — Content-type aware proxying to Kong
    proxy.controller.ts        — Wildcard catch-all route

  cache/
    cache.module.ts            — Dragonfly connection + in-memory LRU fallback
    cache.service.ts           — get/set/delete with automatic fallback

  keycloak/
    keycloak.module.ts         — KC admin API, realm sync
    kc-admin.service.ts        — Admin token with retry-backoff, realm CRUD
    kc-sync.service.ts         — DIGIT→KC role sync (fire-and-forget)

  circuit-breaker/
    circuit-breaker.service.ts — Generic circuit breaker (injectable)

  health/
    health.module.ts           — @nestjs/terminus
    health.controller.ts       — /healthz (liveness) + /readyz (readiness)

  metrics/
    metrics.module.ts          — prom-client integration
    metrics.controller.ts      — /metrics endpoint
    metrics.interceptor.ts     — Auto-instrument all requests

  config/
    config.module.ts           — @nestjs/config with Zod validation
    config.schema.ts           — Typed schema for all env vars

  login/
    login.module.ts            — BFF login endpoint
    login.controller.ts        — POST /auth/login (replaces browser ROPC)
```

## Gap-to-Module Mapping

| Gap | Resolution | Module |
|-----|-----------|--------|
| **R1** KC admin token race | `kc-admin.service.ts` — retry with exponential backoff on init, separate from refresh interval | `keycloak/` |
| **S2** Deterministic passwords | `digit-client.service.ts` — random password per user, stored in Dragonfly. On cache miss: generate new, update via `_updatenovalidate`, re-auth | `user/` |
| **S1** ROPC in browser | `login.controller.ts` — BFF `/auth/login` endpoint. Browser sends credentials to own backend, not KC directly. KC refresh token stays server-side | `login/` |
| **S4** No audience validation | `jwt.service.ts` — `audience` param in `jwtVerify()` + KC audience mapper in realm config | `auth/` |
| **S3** Wide-open CORS | `main.ts` — Fastify CORS plugin with configurable `CORS_ALLOWED_ORIGINS`. Empty = permissive (dev), non-empty = strict | `main.ts` |
| **SC1** Single instance | Stateless design with DI — no module-scope singletons. Graceful shutdown via `app.enableShutdownHooks()` | Architecture |
| **SC2** Redis SPOF | `cache.service.ts` — Dragonfly primary, in-memory LRU fallback with health-check recovery loop | `cache/` |
| **SC3** System token | `digit-client.service.ts` — injectable `TokenManager` with retry, jitter, lifecycle-managed refresh | `user/` |
| **SC4** No rate limiting | `@nestjs/throttler` — `@Throttle()` decorator on `/auth/login` and wildcard proxy | `login/`, `proxy/` |
| **R2** No circuit breaker | `circuit-breaker.service.ts` — injectable, wraps egov-user calls. 5 failures → open for 30s | `circuit-breaker/` |
| **R3** Cache invalidation | `cache.service.ts` — `DELETE /cache/user/:sub` endpoint + 1-hour TTL with lazy re-validation + auto-clear on invalid JWT | `cache/` |
| **R4** OTEL not reaching Tempo | `nestjs-otel` module — proper lifecycle, auto-instruments HTTP + Dragonfly + fetch | `app.module.ts` |
| **R5** No structured logging | `nestjs-pino` — JSON output, request-scoped context (traceId, sub, tenant, latency) | `app.module.ts` |
| **O1** No metrics | `metrics.module.ts` — prom-client counters/histograms for requests, cache, JWT, provisioning, circuit state, token refresh, role sync | `metrics/` |
| **O2** No readiness probe | `health.controller.ts` — `/healthz` (process alive) + `/readyz` (Dragonfly + system token + KC admin token) | `health/` |
| **O3** No debug endpoints | `health.controller.ts` — `/debug/status` behind `@UseGuards(AdminGuard)` reporting cache size, token status, JWKS state, circuit states | `health/` |
| **O4** Silent failures | NestJS exception filters + interceptors — centralized error handling, metrics emitted on every catch. No silent swallowing | Architecture |
| **S5** Query param token | Fastify `onSend` hook strips `auth-token` from logged URLs. Prefer `Authorization` header for multipart where possible | `proxy/` |
| **S6** Hardcoded creds | `config.schema.ts` — Zod-validated env vars. Startup fails if required secrets missing in production mode | `config/` |
| **C1** userName collision | `user-resolver.service.ts` — namespace userName as `{realm}:{email}`. No migration (new installation) | `user/` |
| **C2** Mobile collision | `digit-client.service.ts` — retry with different seed on 409 from egov-user | `user/` |
| **C3** Type mismatch | `user-resolver.service.ts` — respect `digit_user_type` from JWT when creating user and acquiring token | `user/` |
| **C4** No signup UI | `login.controller.ts` — `POST /auth/register` delegates to KC user creation | `login/` |

## Bootstrap

```typescript
// main.ts
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const origins = config.get("CORS_ALLOWED_ORIGINS");
  if (origins) {
    app.enableCors({ origin: origins.split(","), credentials: true });
  } else {
    app.enableCors(); // Permissive dev mode
  }

  await app.listen(config.get("PORT") || 3000, "0.0.0.0");
}

bootstrap();
// Run: bun run src/main.ts
```

## Test Strategy

Each module has co-located unit tests using NestJS `Test.createTestingModule()` with mocked dependencies:

```
src/
  auth/
    jwt.service.spec.ts        — 5 tests (valid, expired, wrong aud, missing, malformed)
  user/
    user-resolver.service.spec.ts — 9 tests (cache hit, miss, provision, collision, roles, type)
    digit-client.service.spec.ts  — 6 tests (search, create, update, token, password, mobile)
  cache/
    cache.service.spec.ts      — 8 tests (hit, miss, fallback, recovery, invalidation, TTL, staleness)
  circuit-breaker/
    circuit-breaker.service.spec.ts — 5 tests (closed, open, half-open, reset, threshold)
  login/
    login.controller.spec.ts   — 6 tests (success, bad creds, missing fields, rate limit, no refresh in response)
  proxy/
    proxy.service.spec.ts      — 4 tests (JSON rewrite, multipart, no-jwt forward, upstream error)
  keycloak/
    kc-admin.service.spec.ts   — 4 tests (init retry, backoff, refresh, realm sync)
  health/
    health.controller.spec.ts  — 4 tests (liveness, readiness-ok, readiness-degraded, debug-status)
  metrics/
    metrics.interceptor.spec.ts — 3 tests (counter inc, histogram observe, labels)
```

**Total: ~54 unit tests** covering all 20 gaps.

**E2E tests** (extend existing Playwright suite in `/opt/digit-ccrs/local-setup/tests/`):

| Test | Validates |
|------|-----------|
| BFF login returns tokens without refresh_token | S1 |
| Old deterministic password rejected | S2 |
| CORS blocked from disallowed origin | S3 |
| Wrong-audience JWT rejected | S4 |
| Metrics endpoint returns Prometheus format | O1 |
| /readyz reports Dragonfly + token status | O2 |
| Service survives Dragonfly restart | SC2 |
| Service survives egov-user downtime (cached users work) | R2 |
| Cache invalidation endpoint clears user session | R3 |
| Rate limiting on /auth/login | SC4 |
| Multi-realm same-email creates separate users | C1 |

## Docker Compose Changes

```yaml
# docker-compose.prod.yml — v2
digit-dragonfly:
  image: docker.dragonflydb.io/dragonflydb/dragonfly:latest
  command: --maxmemory 512mb --proactor_threads 4
  ports:
    - "16379:6379"
  healthcheck:
    test: ["CMD-SHELL", "redis-cli ping | grep PONG"]
    interval: 10s
    retries: 5
  networks:
    - local-setup_egov-network

token-exchange-svc:
  build: .
  command: bun run src/main.ts
  deploy:
    replicas: 2
  environment:
    PORT: "3000"
    DIGIT_USER_HOST: http://egov-user:8107
    DIGIT_GATEWAY_HOST: http://kong-gateway:8000
    KEYCLOAK_INTERNAL_URL: http://keycloak:8080
    KEYCLOAK_AUDIENCE: digit-sandbox-ui
    KEYCLOAK_ADMIN_URL: http://keycloak:8080
    KEYCLOAK_ADMIN_USERNAME: admin
    KEYCLOAK_ADMIN_PASSWORD: admin     # Use secrets in production
    REDIS_HOST: digit-dragonfly
    REDIS_PORT: "6379"
    CACHE_TTL_SECONDS: "3600"          # 1 hour (down from 7 days)
    CORS_ALLOWED_ORIGINS: "https://keycloak-sandbox.live.digit.org"
    PASSWORD_HMAC_SECRET: ""           # Not needed — random passwords
    TENANT_SYNC_ENABLED: "true"
    DIGIT_TENANTS: "pg:pg.citya,pg.cityb"
    OTEL_EXPORTER_OTLP_ENDPOINT: http://digit-telemetry:4317
    OTEL_SERVICE_NAME: token-exchange-svc
  depends_on:
    keycloak:
      condition: service_healthy
    digit-dragonfly:
      condition: service_healthy
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/readyz || exit 1"]
    interval: 10s
    retries: 5
  networks:
    - local-setup_egov-network
```

## KC Realm Config Changes

1. **Audience mapper** on `digit-sandbox-ui` client — includes client ID in JWT `aud` claim
2. **Disable direct access grants** — ROPC blocked at KC level (browser can't bypass BFF)

```json
{
  "clientId": "digit-sandbox-ui",
  "directAccessGrantsEnabled": false,
  "protocolMappers": [{
    "name": "digit-ui-audience",
    "protocol": "openid-connect",
    "protocolMapper": "oidc-audience-mapper",
    "config": {
      "included.client.audience": "digit-sandbox-ui",
      "id.token.claim": "true",
      "access.token.claim": "true"
    }
  }]
}
```

Note: ROPC is re-enabled only for `token-exchange-svc`'s server-side use via a **separate confidential client** (`digit-svc`) that only the BFF knows the secret for.
