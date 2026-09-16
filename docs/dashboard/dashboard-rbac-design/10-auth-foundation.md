# Part A — Trust Foundation (identity & auth)

**Status:** v2, 2026-06-23 (pass-1 review folded in) · **Maps to:** implementation plan Phase 0 · **Requirements:** `00-requirements.md` §1, §3 (Layer 1 enforcement point), §5 (consume-don't-rebuild), §6 (fail-closed), §7.1 (the auth gap), §7.5 (opaque token).
**Reads first:** `dashboard-query-api-design.md` §5/§5a (Hard prerequisite — "identity must be trustworthy first"), `rbac-kpi-access-implementation-plan.md` §0/Phase 0.

> **Grounding rule:** every claim about current behaviour below carries a `file:line` that was actually read. Where a thing is missing, that is stated as missing with the anchor showing the gap.

---

## Goal & responsibilities

### What this part owns

This part makes `RequestInfo.userInfo` **trustworthy** on the analytics route, so that everything `AnalyticsScope.resolve()` and (later) `PrincipalAttributes` read off the principal is server-vouched, not attacker-supplied. Concretely Part A owns:

1. **Token introspection that overwrites userInfo.** On a protected analytics request, the service (or a coercive gateway plugin) resolves the opaque `RequestInfo.authToken` against egov-user `/user/_details?access_token=…` and **replaces** `RequestInfo.userInfo` with the introspection result — it never trusts a client-supplied `userInfo`, even a populated one.
2. **Rejection of missing/invalid tokens on protected routes.** No token, an expired/unknown token, an introspection 4xx, **and any introspection 5xx/timeout/unreachable/parse-failure** on `POST /v2/analytics/_query` and `POST /v2/analytics/_schema` ⇒ **`401`**, fail-closed. There is no "trust the body" fallback path and no path where a `null` introspection result silently becomes a 200 or a 500 — `null` is mapped to `401` explicitly (see A.2).
3. **A trustworthy `Principal` hand-off.** Part A produces exactly the fields downstream RBAC consumes today and tomorrow: `{ uuid, type, roles[], tenantId }`, vouched-for. This is the single contract every other part builds on — for the single-query arm **and** the batch `queries` arm, which share the same resolved scope (`AnalyticsService.java:32`).
4. **The spoof negative test** (plan §0 exit criterion): a forged `userInfo` claiming `type:"EMPLOYEE"` / admin roles with no valid token resolves to **denied** (no token) or **citizen/empty scope** (citizen token), never admin scope. The test is specified **per-grain** (see A.6), because the emitted scope differs by grain — notably `daily` has no citizen column (`AnalyticsCatalog.java:108`) and would otherwise give a false-green.

### What this part explicitly does NOT own

- **Resolving jurisdiction/department attributes** from HRMS — that is **Part B** (`PrincipalAttributes`). The DIGIT token is opaque and carries no attributes (req §7.5); Part A only makes `{uuid, roles, type, tenantId}` trustworthy. Part B resolves the rest server-side.
- **Building or injecting the row-scope `WHERE`** — that is **Part C** (`applyScope()` over `attrScopes`). Part A does not touch `AnalyticsPlanner.applyScope()` (`AnalyticsPlanner.java:241–251`).
- **Closing the `daily`-grain citizen leak** — the missing citizen column on the `daily` grain (`AnalyticsCatalog.java:108`, `citizenColumn=null`; predicate guarded at `AnalyticsPlanner.java:246`) is **Part C's** fix (add `account_id` to the daily grain or reject citizen `daily` queries). Part A only **surfaces** the leak in its negative test rather than passing over it (A.6).
- **KPI catalog visibility / `kpi_forbidden`** (Part D), **dashboard packs** (Part E), **inline-query gating / `inline_forbidden`** (Part F). Those are authorization decisions over a trusted principal; Part A only delivers the trusted principal. (Note: Part A authenticates; it does **not** authorize beyond "is this a real, logged-in user." `403` decisions live in D/F.)
- **Caching.** Resolved scope is part of the cache key (req §6) but the cache is designed in C/D, not here. Part A's only caching concern is whether to memoize introspection (see Risks).

---

## Current code reality (file:line — what exists today vs what's missing)

**The endpoint trusts the body and validates nothing.**

- `AnalyticsController.query()` (`AnalyticsController.java:40–55`) reads the request body as a raw `JsonNode`, and at **L43–44** does `mapper.convertValue(body.get("RequestInfo"), RequestInfo.class)` — taking `userInfo` verbatim from whatever the client POSTed. It hands that `RequestInfo` straight to `service.query(...)` at **L47**. There is **no token check, no introspection, no rejection of an unsigned/forged userInfo**. `authToken` is never read in this class. (Tenant comes from the **body** at **L45**, not the principal — the hole A.4 plugs.)
- `AnalyticsController.schema()` (`AnalyticsController.java:57–60`) takes **no `RequestInfo` at all** — it is fully anonymous today. Under Part A `_schema` becomes a protected route too (it leaks the catalog/grain shape, and Part D will make `/catalog` role-filtered; the underlying `_schema` must not be an unauthenticated bypass).
- `AnalyticsScope.resolve()` (`AnalyticsScope.java:31–48`) derives the **entire** RBAC posture from `requestInfo.getUserInfo()`: **L34** `requestInfo.getUserInfo()`, **L36** `u.getType()`, **L38–42** `u.getRoles()`, **L44** `if (isCitizen && !hasEmployeeRole) citizenUuid = u.getUuid();`, **L47** returns `boundaryPrefix` hardcoded `null`. So a body with `type:"EMPLOYEE"` and no `CITIZEN`-only role set **escapes citizen self-scope** and is treated as a tenant-wide employee — purely on the client's say-so.
- `AnalyticsService.query()` (`AnalyticsService.java:30–32`) calls `AnalyticsScope.resolve(requestInfo, tenantId, stateLevelLen)` at **L32** with the untrusted `requestInfo` straight from the controller. That single resolved `scope` is then reused by **both** request arms — the single-query arm (`AnalyticsService.java:51`) and the batch dict arm (`AnalyticsService.java:42–46`, each `runOne(e.getValue(), scope)`). No introspection sits between controller and scope, so both arms inherit the spoofable principal identically. (Wiring the gate at the controller before `service.query` fixes both arms in one place; the batch-arm-bypass risk the cross-cutting review flags is a Part-D *kpiId re-check* concern, not a Part-A trust concern — A's principal already covers both arms.)

**The gateway enrichment exists but is non-enforcing (two early-return guards).**

The Kong global `pre-function` "auth-enrichment" (`kong.yml:49–82`) is meant to backfill `userInfo` from the token, but it is **advisory, not coercive** — it has two guards that make a spoofed body sail through:

- **Guard 1 — no token ⇒ no-op (`kong.yml:63–64`):** `local token = ri["authToken"]` (L63); `if not token or type(token) ~= "string" or token == "" then return end` (L64). A request with **no `authToken`** and a hand-written `userInfo` returns early and is passed through **untouched**.
- **Guard 2 — pre-populated userInfo ⇒ skip introspection (`kong.yml:65–67`):** `if ri["userInfo"] and type(ri["userInfo"]) == "table" then` (L65) … `if ui["uuid"] or ui["id"] or ui["userName"] then return end` (L67). If the caller supplies a `userInfo` that *already* has a `uuid`/`id`/`userName`, the plugin **does no validation and returns** — the client's claimed identity wins.

So the enrichment only fires for the well-behaved case (token present, userInfo absent) and **defends nobody against a malicious client** who simply supplies their own `userInfo`. The plugin's introspection target — `http://egov-user-proxy:8107/user/_details?access_token=` `..token` POST (`kong.yml:71`) — is the right call; it is just skippable. On its own error paths the plugin **logs and passes the request through** (`kong.yml:75` `if not res then kong.log.err(...); return`, `kong.yml:76` `if res.status ~= 200 then kong.log.err(...); return`). This is the "V2 auth gap" (req §7.1; plan §0).

> **Flat top-level `_details` shape (correcting the A.2 table below).** The plugin treats the decoded `_details` body **as the flat user object** — it checks `user["uuid"]`/`user["userName"]` at **top level** (`kong.yml:79`) and assigns `ri["userInfo"] = user` (`kong.yml:80`) with **no `UserRequest` wrapper**. This is the only working in-tree evidence of the response shape, so the A.2 parser is written against a **flat** top-level user, not a `{UserRequest:{…}}` envelope (still confirmed on a recorded live response — O1).

**There is no auth plugin on the pgr route.** The `pgr-service` Kong service/route (`kong.yml:334–343`, `paths: /pgr-services`, `strip_path:false`) carries **no `key-auth`, no `jwt`, no custom auth plugin** — only the global pre-function above. So `/pgr-services/v2/analytics/*` is reachable unauthenticated, and the pre-function does not enforce.

**What already exists and is reusable (so Part A is mostly wiring, not green-field):**

- A POST JSON client: `ServiceRequestRepository.fetchResult(StringBuilder uri, Object request)` (`ServiceRequestRepository.java:30–43`) — `restTemplate.postForObject(uri, request, Map.class)`. **Caveat (load-bearing for fail-closed):** it only rethrows on `HttpClientErrorException` (4xx) as `ServiceCallException` (`ServiceRequestRepository.java:35–37`). **Every other failure — connection refused, timeout, 5xx `HttpServerErrorException`, decode error — is caught at `ServiceRequestRepository.java:38–40`, logged, and returns `null` with no rethrow.** So `fetchResult` is *not* fail-closed by itself; A.2 must treat a `null` return as auth-failure (it does — see A.2).
- User-service host config already injected: `PGRConfiguration` `@Value("${egov.user.host}") userHost` (`PGRConfiguration.java:48–49`), plus context path `@Value("${egov.user.context.path}")` (`PGRConfiguration.java:51`). So the introspection base URL needs **no new config plumbing**, only a `_details` path value. **Caveat:** the local prop `egov.user.host=http://localhost:8081` (`application.properties:63`) and the deployed value are templated per-env, and the Kong plugin hardcodes a *different* host (`egov-user-proxy:8107`, `kong.yml:71`). The service-side and gateway-side introspection may therefore hit different hosts; A.2 binds to `${egov.user.host}` and the migration step verifies the deployed value actually fronts egov-user (`/user/_details`-capable).
- `stateLevelTenantIdLength` (`PGRConfiguration.java:220`) is already threaded controller→service→scope; Part A does not change it.
- `RequestInfo`/`User`/`Role` contract (`org.egov.common.contract.request.*`) is already the type `AnalyticsScope` reads (`u.getType()`, `u.getRoles()`, `u.getUuid()`).

**Net gap:** identity on this route is presently attacker-controlled at two layers (the gateway skips, the service trusts). Part A closes it by making introspection **coercive** (overwrite, never trust) and **mandatory** (reject when absent **or** unresolvable, including 5xx/null).

---

## Design

### A.0 Decision: defense-in-depth, service-side is authoritative

The plan offers Option A (gateway plugin) vs Option B (service-side introspection). **This part specifies BOTH, with the service-side check as the authoritative one:**

- **A.1 (gateway, hardening):** make the Kong pre-function **coercive** by removing Guard 2 and turning Guard 1 (and the error paths) into a hard reject on protected routes. This shrinks the attack surface and means well-behaved traffic is already enriched.
- **A.2 (service, authoritative):** an `AnalyticsAuthService` in pgr-services that **re-introspects the token and overwrites `userInfo`** before scope resolution, and **rejects** when the token is missing, invalid, **or unresolvable for any reason (4xx, 5xx, timeout, null)**. This is the security boundary.

**Why both, why service-authoritative:** the gateway is the right place to enrich for the whole platform, but (a) Kong config is environment-specific (`kong.yml` is the local-setup file; bomet/naipepea front with nginx+Kong differently), and (b) a pre-function that silently no-ops on its own error path (`kong.yml:75–76`: log and **pass the request through** on introspection failure) cannot be the sole enforcement. A fix that "redeploys the same way on any tenant" (memory: holistic fixes) must live in the **service**, which is identical across tenants. The gateway change is belt; the service change is suspenders, and suspenders hold the trousers up.

### A.1 — Gateway: make enrichment coercive (kong.yml)

Two surgical edits to the pre-function (`kong.yml:49–82`), scoped so it only hard-enforces on analytics paths (it must stay enrichment-only for the rest of the platform, which still POSTs `userInfo` legitimately in service-to-service calls):

```lua
-- after L62 (ri table obtained), add a protected-route gate:
local path = kong.request.get_path()
local protected = path:find("/v2/analytics/", 1, true) ~= nil

local token = ri["authToken"]                         -- (was kong.yml:63)
if (not token or type(token) ~= "string" or token == "") then  -- (was kong.yml:64)
  if protected then
    return kong.response.exit(401,
      cjson.encode({error="unauthenticated", message="missing auth token"}),
      {["Content-Type"]="application/json"})
  end
  return                          -- non-protected: unchanged (enrichment is opportunistic elsewhere)
end

-- REMOVE the old Guard-2 early-return (kong.yml:65-67). On protected routes we
-- ALWAYS introspect and OVERWRITE userInfo; a client-supplied userInfo is discarded.
-- (Keep the skip only for NON-protected routes if desired.)

-- introspect (existing call, kong.yml:71) ...
-- error paths that today log+return (kong.yml:75-76) become 401 on protected:
if not res or res.status ~= 200 then
  if protected then
    return kong.response.exit(401, cjson.encode({error="unauthenticated",
      message="token introspection failed"}), {["Content-Type"]="application/json"})
  end
  kong.log.err("auth-enrichment: ", err or (res and res.status)); return
end
-- ... decode (kong.yml:78), then ALWAYS overwrite on protected routes.
-- NOTE: the decoded body is the FLAT user object (kong.yml:79-80 read user["uuid"]
-- at top level, no UserRequest wrapper), so the overwrite is the existing assignment:
ri["userInfo"] = user            -- overwrite, never merge (kong.yml:80 unchanged)
```

The two non-negotiable behavioural changes: **(1)** on `/v2/analytics/*`, a missing token, a non-200 introspection, **or an unreachable egov-user (`not res`)** is now a **`401`**, not a pass-through (folds the `kong.yml:75–76` error paths into a hard reject); **(2)** on `/v2/analytics/*`, the pre-function **always overwrites** `userInfo` rather than honouring a pre-populated one (Guard-2 deletion). Note the introspection target `egov-user-proxy:8107` is the **proxy**, not `egov-user` directly — verify the proxy forwards `/user/_details` (Part A test step).

### A.2 — Service: AnalyticsAuthService (authoritative)

A new class in `org.egov.pgr.analytics` that the controller calls **before** `service.query(...)`. It is the part that holds regardless of gateway topology. **Fail-closed is enforced on the `null` path, because the reused `fetchResult` returns `null` (not throws) on 5xx/timeout/unreachable (`ServiceRequestRepository.java:38–40`).**

```java
package org.egov.pgr.analytics;

/** Coercive token introspection for the analytics route. Overwrites client-supplied
 *  userInfo with the egov-user /_details result; fail-closed on missing/invalid/unresolvable token. */
@Component
@Slf4j
public class AnalyticsAuthService {

    private final ServiceRequestRepository repo;     // reuse: ServiceRequestRepository.java:30
    private final PGRConfiguration config;           // egov.user.host : PGRConfiguration.java:48
    private final ObjectMapper mapper;

    /** Returns a RequestInfo whose userInfo is server-vouched. Throws 401 on no/invalid/unresolvable token. */
    public RequestInfo authenticate(JsonNode body) {
        JsonNode ri = (body != null && body.has("RequestInfo")) ? body.get("RequestInfo") : null;
        String token = (ri != null && ri.hasNonNull("authToken"))
                ? ri.get("authToken").asText() : null;
        if (token == null || token.isEmpty())
            throw new UnauthenticatedException("unauthenticated: missing auth token");

        User u = introspect(token);                  // egov-user /user/_details
        if (u == null || u.getUuid() == null)
            throw new UnauthenticatedException("unauthenticated: invalid, expired, or unresolvable token");

        // Build a RequestInfo that KEEPS the client's correlation fields but
        // OVERWRITES the trust-bearing userInfo with the introspected user.
        RequestInfo out = mapper.convertValue(ri, RequestInfo.class); // apiId/ts/msgId/authToken
        out.setUserInfo(u);                          // <-- the overwrite. client userInfo discarded.
        if (log.isDebugEnabled() && ri.hasNonNull("userInfo") && ri.get("userInfo").hasNonNull("uuid")
                && !u.getUuid().equals(ri.get("userInfo").get("uuid").asText()))
            log.debug("analytics auth: client userInfo.uuid != introspected uuid; client value discarded");
        return out;
    }

    private User introspect(String token) {
        // /user/_details?access_token=<token>  (POST). Body: empty/RequestInfo wrapper.
        StringBuilder uri = new StringBuilder(config.getUserHost())
                .append(config.getUserDetailsPath())          // NEW @Value, e.g. "/user/_details"
                .append("?access_token=").append(token);
        Object res;
        try {
            res = repo.fetchResult(uri, Collections.emptyMap()); // ServiceRequestRepository:30
        } catch (ServiceCallException e) {                       // 4xx from egov-user (bad token) — ServiceRequestRepository:37
            return null;                                         // -> caller throws Unauthenticated (401)
        }
        // CRITICAL fail-closed: fetchResult swallows 5xx/timeout/unreachable/parse to a NULL return
        // (ServiceRequestRepository.java:38-40, generic catch logs + returns null, no rethrow).
        // A null res is NOT a valid user — it must become 401, never a 200 or a parser NPE/500.
        if (res == null) return null;                            // -> caller throws Unauthenticated (401)
        return parseUserRequest(res);                            // flat top-level user (kong.yml:79-80); see O1
    }

    /** Map the egov-user /_details body onto org.egov.common.contract.request.User.
     *  Per kong.yml:79-80 the response is a FLAT top-level user object (no UserRequest wrapper).
     *  Confirm the exact shape (incl. roles[] nesting) against a recorded live response — O1. */
    private User parseUserRequest(Object res) { /* tolerant of null sub-fields; returns null if no uuid */ }
}
```

**Introspection contract consumed (egov-user `/user/_details?access_token=`):** a POST returns the authenticated user envelope. Per the only in-tree evidence (`kong.yml:79–80`) the body is a **flat top-level user object**, so the fields Part A depends on are read at top level and mapped onto `org.egov.common.contract.request.User`:

| `_details` field (flat, top-level) | Mapped to | Used by |
|---|---|---|
| `uuid` | `User.uuid` | citizen self-scope (`AnalyticsScope.java:44`), Part B HRMS lookup key |
| `type` (`CITIZEN`/`EMPLOYEE`/`SYSTEM`) | `User.type` | citizen-vs-employee branch (`AnalyticsScope.java:36`) |
| `roles[].code` | `User.roles[].code` | employee-role test (`AnalyticsScope.java:38–41`); Part D `visibleTo`; Part F inline gate |
| `roles[].tenantId` | `Role.tenantId` | tenant cross-check (A.4) |
| `tenantId` | `User.tenantId` | tenant cross-check (A.4) |

> **Verify-before-build (open question O1):** the in-tree evidence (`kong.yml:79` reads `user["uuid"]` at top level, `kong.yml:80` assigns the whole decoded body as `userInfo`) says the proxy emits a **flat** user, not a `{UserRequest:{…}}` wrapper. The A.2 table is now drawn flat to match. **Still confirm on a recorded live response** that `roles[]` is an array of `{code,name,tenantId}` at `roles` (flat) and not nested — if the parser maps `roles` wrong, `AnalyticsScope.resolve`'s `u.getRoles()` (`AnalyticsScope.java:38`) gets an empty list and **every employee silently degrades to "no employee role"** (a fail-*open*-looking under-scope downstream). Assert this in the Part A integration test; do not assume.

### A.3 — Controller wiring

`AnalyticsController` calls `authenticate(...)` first and uses **only** the returned `RequestInfo`. The client-supplied `RequestInfo` is never passed to `service.query`. Because `service.query` resolves one `AnalyticsScope` and feeds it to both the single-query arm (`AnalyticsService.java:51`) and the batch arm (`AnalyticsService.java:42–46`), authenticating once at the controller covers both arms.

```java
// AnalyticsController.query() — replaces the L43-44 convertValue + L47 hand-off
@PostMapping("/_query")
public ResponseEntity<Map<String,Object>> query(@RequestBody JsonNode body){
    try {
        RequestInfo requestInfo = auth.authenticate(body);          // NEW: coercive, throws 401 on bad/unresolvable token
        crossCheckTenant(requestInfo, body);                        // NEW: see A.4
        String tenantId = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
        int stateLen = config.getStateLevelTenantIdLength() == null ? 1 : config.getStateLevelTenantIdLength();
        Map<String,Object> result = service.query(body, requestInfo, tenantId, stateLen);
        return ResponseEntity.ok(result);
    } catch (UnauthenticatedException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error(e));   // 401, fail-closed
    } catch (ForbiddenException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(error(e));      // 403, tenant mismatch
    } catch (IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(error(e));
    } catch (Exception e) {
        log.error("analytics query failed", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
    }
}

@PostMapping("/_schema")
public ResponseEntity<Map<String,Object>> schema(@RequestBody(required=false) JsonNode body){
    try {
        auth.authenticate(body == null ? NullNode.getInstance() : body); // NEW: _schema is now protected
        return ResponseEntity.ok(service.schema());
    } catch (UnauthenticatedException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error(e));   // 401
    }
}
```

`_schema` gains a body + auth (today it takes **no `RequestInfo` and no body** — `AnalyticsController.java:57–60`). A null/empty body ⇒ no `authToken` ⇒ `401`, consistent with `_query`. The `error()` helper (`AnalyticsController.java:62–69`) derives the error code from the message prefix before `:`, so throwing `"unauthenticated: …"` / `"forbidden: …"` yields `error:"unauthenticated"`/`"forbidden"` with **no new code** in `error()`.

### A.4 — Tenant cross-check (defense, not the main job)

Design §5 requires "the `tenantId` in the body is cross-checked against the principal's allowed tenants; mismatch → `403`." The hole is real today: the scope's tenant comes from the **body** at the controller (`AnalyticsController.java:45`) and is threaded to `AnalyticsScope.resolve` (`AnalyticsService.java:32`), so even a real token could widen tenant via the body. Part A wires the **hook**; the principal's allowed-tenant set comes from the introspected `roles[].tenantId` / `user.tenantId`.

**Conservative form (this part's commitment):** Part A enforces **same-tenant only**. It deliberately does **not** ship the `startsWith`/prefix widening, because the underlying tenant-scope SQL predicate at `AnalyticsPlanner.java:243` is an **un-anchored, un-escaped** `LIKE scope.tenantId + '%'` — `ke` matches `ke.bomet` AND a hypothetical `kenya`/`ke2`. Layering a same-shape `startsWith` widening into the cross-check would re-introduce the exact sibling-prefix leak req §4 (`00-requirements.md:63`) bans for boundaries. The state-root-employee-querying-a-city case is deferred to Part C (O4), where the anchored+escaped tenant predicate is designed.

```java
private void crossCheckTenant(RequestInfo ri, JsonNode body){
    String bodyTenant = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
    User u = ri.getUserInfo();
    if (bodyTenant == null || u == null) return; // tenant-required is enforced in service
    // Same-tenant only (conservative). Cross-tenant/state-root widening is Part C (O4),
    // gated on an ANCHORED+ESCAPED tenant predicate (today's AnalyticsPlanner.java:243 LIKE is neither).
    boolean allowed = bodyTenant.equals(u.getTenantId())
        || (u.getRoles() != null && u.getRoles().stream()
              .anyMatch(r -> bodyTenant.equals(r.getTenantId())));   // exact match, no startsWith
    if (!allowed) throw new ForbiddenException("forbidden: tenant mismatch");
}
```

This guarantees the body tenant can't diverge from the *vouched* identity's exact tenant(s). The precise "allowed tenants" policy (state-root employee querying any sub-tenant) is finalized with Part C's scope semantics.

### A.5 — The Principal contract (output of Part A)

The single artifact every downstream part consumes. Part A does **not** introduce a new type — it guarantees the **existing** `RequestInfo.userInfo` is now trustworthy. Stated as a contract:

```
Principal (vouched-for, post-A.2):
  uuid     : String   — egov-user UUID (introspected, never client-set)
  type     : String   — CITIZEN | EMPLOYEE | SYSTEM (introspected)
  roles[]  : {code, name, tenantId}  (introspected, flat-top-level per kong.yml:79-80)
  tenantId : String   (introspected)
INVARIANT: these fields equal the egov-user /_details result for a valid token,
           or the request was rejected 401 before reaching AnalyticsScope.resolve()
           (including the 5xx/timeout/null path — fetchResult null ⇒ 401, never 200/500).
```

`AnalyticsScope.resolve()` (`AnalyticsScope.java:31–48`) is **unchanged by Part A** — it keeps reading `u.getType()`/`u.getRoles()`/`u.getUuid()`, but those reads are now sound because `userInfo` was overwritten upstream. (Part B will extend `resolve` to also carry the `uuid`/`roles` forward into attribute resolution; Part C generalizes the scope and is also where `tenantStateLevel` (`AnalyticsScope.java:22`) must be carried into `PrincipalAttributes` so C can choose `LIKE prefix` vs `= tenant` — a cross-cutting B/C gap, not Part A's. Part A's contribution is that the inputs to both are no longer forgeable.)

### A.6 — Spoof negative test, specified per-grain (exit criterion)

The plan §0 exit criterion is "forged-admin body gets citizen/empty scope." Part A's test must assert the **emitted scope per grain**, not a single grain, because the scope predicate differs by grain — and one grain leaks today:

1. **Forged-admin body, NO token** → `401` on both `_query` and `_schema` (before `AnalyticsScope.resolve` ever runs).
2. **Forged-admin body, CITIZEN token** → introspection overwrites to the real citizen → for grain `facts` and grain `events`, the emitted `WHERE` includes `account_id = :self` (`AnalyticsCatalog.java:78`/`:96` define `account_id` as the citizen column; predicate at `AnalyticsPlanner.java:246`). **Assert this exact predicate.**
3. **Same citizen token, grain `daily`** → the test must assert that **no `account_id` predicate is emitted** (because `daily` has `citizenColumn=null`, `AnalyticsCatalog.java:108`, and the guard at `AnalyticsPlanner.java:246` short-circuits) **and flag this as a Part-C interface gap** (citizen `daily` is tenant-wide today). The test does **not** pass silently on `daily`; it records the leak as an explicit known-failure pending Part C. This prevents a false-green where the suite is green on `facts` while `daily` leaks every open complaint in the tenant.

The exit criterion is met for Part A when (1) and (2) hold; (3) is a **must-surface** assertion that hands a tracked failure to Part C, not a pass.

### Control flow (end to end)

```
client → Kong /pgr-services/v2/analytics/_query
  └─ pre-function (A.1): protected route?
        ├─ no authToken            → 401 (was: pass-through, kong.yml:64)
        ├─ introspect /_details unreachable/non-200 → 401 (was: log+pass-through, kong.yml:75-76)
        └─ 200 → OVERWRITE userInfo (was: skip if pre-populated, kong.yml:65-67)   ──┐
  → pgr-services AnalyticsController.query()                                          │ even if Kong is bypassed
        └─ AnalyticsAuthService.authenticate(body) (A.2)  ◄───────────────────────────┘ this RE-introspects
              ├─ no authToken               → UnauthenticatedException → 401
              ├─ /_details 4xx              → null → 401
              ├─ /_details 5xx/timeout/null → null → 401  (NOT 200, NOT 500; ServiceRequestRepository.java:38-40)
              └─ valid → RequestInfo.userInfo := introspected User   (the overwrite)
        └─ crossCheckTenant (A.4)  → 403 on tenant mismatch (same-tenant only)
        └─ service.query(body, TRUSTED requestInfo, …)   (AnalyticsService.java:30)
              └─ AnalyticsScope.resolve(TRUSTED requestInfo, …)  (AnalyticsScope.java:32, unchanged code, sound inputs)
              └─ runOne(...) for single arm (L51) AND each batch query (L42-46) — SAME trusted scope
              └─ planner.applyScope(...)  (Part C territory — unchanged here; daily citizen leak is C's)
```

The service-side re-introspection (A.2) is what makes Part A robust to a misconfigured or bypassed gateway: even a request that reaches pgr-services directly (e.g. in-cluster, or an nginx that doesn't run the pre-function) is re-validated, and an egov-user 5xx/timeout maps to `401` rather than silently passing.

---

## Interfaces with other parts

**Outputs produced (consumed by B–F):**

- **`Principal` (trustworthy `RequestInfo.userInfo`)** — the contract in A.5. Consumed by:
  - **Part B** uses `Principal.uuid` (+ `tenantId`) as the HRMS lookup key for `PrincipalAttributes resolve(uuid, tenantId)`. B's "fail-closed on missing HRMS row" is only meaningful because the `uuid` is real. **Dependency:** O1 (flat `roles[]` shape) must resolve before B codes against `Principal.roles`, or B inherits an empty-role principal.
  - **Part C** uses the same trusted `roles`/`type` that `AnalyticsScope.resolve` reads; C's `attrScopes` (jurisdiction PREFIX, department IN) are derived from B's attributes keyed on A's `uuid`. The admin-bypass branch (C: empty `attrScopes`) keys off A's vouched `roles`. **C owns:** the `daily`-grain citizen column fix (`AnalyticsCatalog.java:108`), the anchored+escaped tenant predicate (`AnalyticsPlanner.java:243`), and carrying `tenantStateLevel` into attribute resolution. Part A's negative test (A.6) hands C the tracked `daily` failure.
  - **Part D** re-checks `rbac.visibleTo ∩ Principal.roles` at invocation (`kpi_forbidden`), and must re-check `kpiId` on **both** request arms — the batch arm (`AnalyticsService.java:42–46`) is a separate code path from the single arm (`L51`). A's trusted principal feeds both; D owns the per-arm `kpiId` re-check (the cross-cutting "batch-arm bypass" finding is D's, not A's).
  - **Part F** gates inline grammar on `Principal.roles` (`inline_forbidden`). Sound only because A vouches `roles`.
- **`401 unauthenticated`** — new failure mode Part A introduces on protected routes. D's `403 kpi_forbidden` and F's `403 inline_forbidden` are layered **after** A's 401 (authn precedes authz): a bad token never reaches a 403 path.
- **`403 forbidden: tenant mismatch`** — from A.4 (same-tenant only). Part C may widen this policy; A ships the conservative floor.

**Inputs consumed:**

- egov-user **`/user/_details?access_token=`** introspection (external DIGIT contract; the same endpoint the Kong plugin already targets at `kong.yml:71`). Read-only; Part A never writes user state. This honours req §5 "consume identity, don't rebuild it."
- `PGRConfiguration.getUserHost()` (`PGRConfiguration.java:48`) + a **new** `egov.user.details.path` value. (Note host divergence: Kong uses `egov-user-proxy:8107` hardcoded at `kong.yml:71`; service uses `${egov.user.host}`, locally `http://localhost:8081` at `application.properties:63` — reconcile the deployed value in migration step 6.)
- `ServiceRequestRepository.fetchResult` (`ServiceRequestRepository.java:30`) as the HTTP client, **with the explicit `null`-is-auth-failure handling in A.2** (because `ServiceRequestRepository.java:38–40` returns `null` rather than throwing on 5xx/timeout).

**Explicitly NOT an interface of Part A:** HRMS (`eg_hrms_*`), boundary-service, MDMS `dss.*`. Those belong to B/C/D. Part A's only outward call is egov-user introspection.

---

## Sequencing & migration steps

1. **Config:** add `egov.user.details.path=/user/_details` to pgr-services `application.properties` (host already present, `application.properties:63` / `PGRConfiguration.java:48`). Add `getUserDetailsPath()` getter (mirroring the existing `egov.user.context.path` binding at `PGRConfiguration.java:51`).
2. **Service:** add `AnalyticsAuthService` (A.2) + `UnauthenticatedException`/`ForbiddenException` (or reuse `org.egov.tracer.model.CustomException` with code mapping). **Unit-test the fail-closed matrix explicitly:** valid token → user; 4xx (`ServiceCallException`) → 401; 5xx/timeout/unreachable (`fetchResult` returns `null`, `ServiceRequestRepository.java:38–40`) → **401, asserted** (this is the path the pass-1 review flagged as not-fail-closed); malformed/no-uuid body → 401.
3. **Controller:** wire `authenticate(...)` into `query` and `schema` (A.3), add `crossCheckTenant` (A.4, same-tenant only), map `UnauthenticatedException→401`, `ForbiddenException→403`. **This is the cut-over commit** — after it, a forged `userInfo` no longer wins.
4. **Gateway hardening (A.1):** edit the `kong.yml` pre-function — protected-route 401 (token + error paths `kong.yml:64`,`75–76`) + Guard-2 deletion (`kong.yml:65–67`). Ship in the same PR but note it is **belt to the service's suspenders**; the service change (step 3) is what makes it tenant-portable. Replicate the equivalent on bomet/naipepea nginx+Kong fronts (host_vars note, not code).
5. **Negative test (exit criterion, A.6):** integration test — forged-admin body with **no token** → 401; forged-admin body with a **citizen token** → introspection overwrites to citizen → assert `account_id = :self` predicate on `facts` and `events`, and assert (as a tracked known-failure handed to Part C) that `daily` emits **no** citizen predicate. Per-grain, per plan §0.
6. **Validate on ovh-cloud-dev (bomet repro)** before live bomet (memory: ovh must stay bomet; validate per-PR). Confirm (O1) `egov-user-proxy` actually serves `/user/_details`, that the deployed `${egov.user.host}` fronts egov-user (vs the Kong hardcode `egov-user-proxy:8107`), and **record one live `_details` response** to fix the flat-vs-wrapped shape and the `roles[]` nesting before the parser is finalized.
7. **PR-per-part** against egov/CCRS develop under `backend/pgr-services/` (+ `local-setup/kong/kong.yml`). One concern: "Part A — trust foundation / coercive analytics auth."

**Ordering within the series:** Part A merges and validates **before** any of B–F (req §8 dependency graph: "A blocks EVERYTHING"). B/C and D/E/F may then proceed in parallel.

---

## Risks, edge cases, failure modes

- **Fail-closed is the default — and now explicit on the `null` path.** No token → 401. Introspection 4xx (`ServiceCallException`, `ServiceRequestRepository.java:37`) → 401. Introspection **5xx / timeout / egov-user unreachable / decode error → `fetchResult` returns `null` (`ServiceRequestRepository.java:38–40`), which A.2 maps to 401, never 200, never a parser NPE/500.** Do *not* fall back to body `userInfo` — that recreates the gap. The Kong plugin's current `log+return` pass-through on error (`kong.yml:75–76`) is the exact anti-pattern Part A removes for protected routes. (This was the pass-1 [major] — resolved by the explicit `if (res == null) return null;` in `introspect`.)
- **Gateway-bypass leak (why service-side is authoritative).** If only A.1 shipped and an operator fronts pgr-services with an nginx that doesn't run the pre-function (bomet/naipepea differ from `kong.yml`), the endpoint would be wide open again. A.2 (service re-introspection) closes this — the service trusts no upstream.
- **`_schema` was anonymous (`AnalyticsController.java:57–60`).** Leaving it open is a catalog/grain disclosure and a Part-D bypass (read the schema, then POST a hidden `kpiId`). Part A protects it. Edge: existing FE callers that hit `_schema` without a token will start getting 401 — coordinate with the FE (O5).
- **Token↔body identity drift.** A valid token for user X with a body `userInfo` claiming user Y: the overwrite (A.2) discards Y. Logged at debug when `client userInfo.uuid != introspected.uuid` (A.2) to surface broken clients without leaking the token.
- **Tenant isolation.** A.4 stops a vouched ke.bomet employee from passing `tenantId:"pb.amritsar"` (same-tenant only). The body-widens-tenant hole is real today (tenant flows from `AnalyticsController.java:45` → `AnalyticsService.java:32` → `resolve`); A.4 is the minimal plug. Part A deliberately ships **only** the exact-match floor and defers any prefix widening to Part C, because the live tenant predicate (`AnalyticsPlanner.java:243`) is an un-anchored/un-escaped `LIKE …%` that would leak siblings if A widened the check to match it. Full jurisdiction/department isolation is B/C.
- **Flat `_details` shape & `roles[]` mapping (the silent-degrade risk).** If the live response nests `roles[]` differently than the parser expects, `u.getRoles()` (`AnalyticsScope.java:38`) returns empty and every employee reads as "no employee role" — an under-scope that looks like a citizen leak path downstream. O1 + the integration assertion (step 6) close this; the parser is written flat to match `kong.yml:79–80` but is verified, not assumed.
- **HRMS role pollution (memory).** Not introduced by A, but A is where roles become *trusted* — so a polluted role set (every GRO also `PGR_LME`) is now authoritatively believed. Mitigation is downstream (D/F test against clean `RBAC_TEST_*` users); Part A's job is only that the roles are the *real* (polluted-or-not) egov-user roles, not client-invented ones.
- **Performance — introspection per request.** Each `_query` adds one egov-user round-trip (the Kong plugin already pays this on the enrich path). The token is a redis-backed opaque UUID, so `_details` is a redis lookup — cheap. **Cache** introspection by token with a **short TTL (≤60s) and a hard cap below token validity**, keyed on the raw token (never log it). **Never cache `null`/401 results** (a transient egov-user 5xx must not pin a token to "denied"). Part B sets the caching policy for HRMS attributes; A only caches the token→identity, which is comparatively stable within a session.
- **`SYSTEM`-type tokens.** Internal service calls (escalation scheduler, persister) carry `type:SYSTEM`. Part A must not 401 legitimate internal callers; but analytics is a read API — default: treat SYSTEM as **denied on the analytics route** unless explicitly allow-listed (it has no dashboard use); revisit if an internal aggregator needs it (O3).
- **Double introspection cost (A.1 + A.2).** When both gateway and service introspect, the token is validated twice. Acceptable (both are cheap redis hits) and the redundancy is the point; the per-token cache (above) collapses it within a request burst.
- **Error-code surface.** `AnalyticsController.error()` (`AnalyticsController.java:62–69`) derives the error code from the message prefix before `:`. Keep that convention: throw messages like `"unauthenticated: …"` / `"forbidden: …"` so the existing extractor emits `error:"unauthenticated"`/`"forbidden"` without new code.

---

## Open questions for review

- **O1 — `/user/_details` response shape via the proxy (downgraded, not closed).** In-tree evidence (`kong.yml:79–80`) says the proxy emits a **flat** top-level user, and the A.2 table is now drawn flat to match. Still confirm on a **recorded live response** that `roles[]` is `{code,name,tenantId}` at top-level `roles` (not nested) before finalizing the parser — a wrong `roles` mapping silently degrades every employee to "no employee role" (`AnalyticsScope.java:38`). *Resolve by recording one live response on ovh before coding the parser (step 6).*
- **O2 — gateway vs service as the canonical fix.** This part ships both but declares the **service** authoritative. Is the team comfortable carrying the Kong change as non-load-bearing (so bomet/naipepea nginx fronts need no parity edit for correctness, only for defense-in-depth)? Confirm the holistic-fix rule (memory) is satisfied by the service-side change alone.
- **O3 — `SYSTEM` token policy** on the analytics route: deny by default, or allow-list specific internal callers? No current consumer is known; defaulting to deny is safest but may surprise a future internal aggregator.
- **O4 — tenant-allowed policy (deferred to Part C).** Part A ships **same-tenant only** (A.4). The state-root (`ke`) employee querying a city (`ke.bomet`) case needs an **anchored+escaped** tenant predicate first — the live `AnalyticsPlanner.java:243` `LIKE …%` is neither, and widening A.4 to match it would leak siblings (`ke` vs `kenya`). Part C owns the anchored predicate and the widened allowed-tenant rule; A.4 stays conservative until then.
- **O5 — FE coordination for `_schema` auth.** `_schema` becomes protected (was anonymous, `AnalyticsController.java:57–60`). Confirm every current caller sends `RequestInfo.authToken`; otherwise stage A's `_schema` protection behind a flag for one release while the FE catches up.
- **O6 — introspection cache TTL & token logging.** Agree the token→identity cache TTL (proposed ≤60s), the absolute rule that the raw token is never logged (it is a bearer credential), and that **`null`/401 results are never cached**. Should a token-revocation event (logout) bust the cache, or is ≤60s staleness acceptable?

---

## v2 revision log (pass-1 findings → resolution)

- **[major → resolved] Reused HTTP client is not fail-closed on 5xx/unreachable — `fetchResult` swallows the exception and returns `null`.** Confirmed exact: `ServiceRequestRepository.fetchResult` rethrows only `HttpClientErrorException` (4xx) as `ServiceCallException` (`ServiceRequestRepository.java:35–37`); the generic `catch(Exception)` at `ServiceRequestRepository.java:38–40` logs and **returns `null`** with no rethrow. **Resolution:** A.2's `introspect()` now (a) wraps only the call in `try/catch ServiceCallException → null`, and (b) adds an explicit `if (res == null) return null;` *before* `parseUserRequest`, so 5xx/timeout/unreachable/decode-error all become `null → 401` rather than an NPE-500 or a fall-through. The Current-code-reality section, A.2 code+comment, the fail-closed risk bullet, the control-flow diagram, the Principal INVARIANT, and migration step 2's unit-test matrix all now state this explicitly.
- **[major → resolved] Spoof negative test asserted "citizen self-scope" but `daily` grain never applies it (citizen reads tenant-wide).** Confirmed exact: `daily` registered with `citizenColumn=null` (`AnalyticsCatalog.java:108`, 3rd-from-last ctor arg after `boundary_path`); citizen predicate guarded by `g.citizenColumn != null` (`AnalyticsPlanner.java:246`). **Resolution:** rewrote the exit-criterion test into a new **A.6 (per-grain)** section + migration step 5: assert `account_id = :self` on `facts`/`events` (columns at `AnalyticsCatalog.java:78`/`:96`), and assert `daily` emits **no** citizen predicate as a **tracked known-failure handed to Part C**, preventing a false-green. The `daily` fix itself (add `account_id` or reject citizen `daily`) is explicitly scoped to **Part C** (it is not fixable inside Part A — A does not own `applyScope`/the catalog grain definitions).
- **[minor → resolved] A.4 sibling-prefix leak — `startsWith` widening mirrors the un-anchored/un-escaped tenant `LIKE`.** Confirmed: `AnalyticsPlanner.java:243` is `tenantColumn LIKE scope.tenantId + '%'` (no delimiter anchor, no escape); req §4 (`00-requirements.md:63`) mandates anchored+escaped PREFIX. **Resolution:** A.4 now ships **same-tenant exact match only** — the `startsWith`/`stateOf` widening is removed from the code block and explicitly deferred to Part C (O4), which owns the anchored+escaped predicate. Risk bullet and O4 updated to say A ships only the conservative floor.
- **[minor → resolved] `_details` response-shape table assumed `UserRequest.*` nesting; in-tree evidence is flat top-level.** Confirmed: `kong.yml:79` reads `user["uuid"]`/`user["userName"]` at top level and `kong.yml:80` assigns the whole decoded body as `userInfo` — no wrapper. **Resolution:** the A.2 table is redrawn **flat** (top-level `uuid`/`type`/`roles[]`/`tenantId`), a "flat top-level" note added in Current-code-reality and A.5, and the `parseUserRequest` comment + O1 now call out the **silent-degrade** risk if `roles[]` nesting is wrong (`AnalyticsScope.java:38` → empty roles → "no employee role"). O1 downgraded to "confirm `roles[]` shape on a recorded response," not "confirm wrapper vs flat."
- **[minor → resolved] `egov.user.host` local value is `:8081` and there's no `_details` path prop; Kong hardcodes a different host.** Confirmed: `application.properties:63` `egov.user.host=http://localhost:8081`; `egov.user.context.path` exists (`PGRConfiguration.java:51`) but no details path; Kong uses `egov-user-proxy:8107` hardcoded (`kong.yml:71`). **Resolution:** corrected the "no new config plumbing" claim to add the host-divergence caveat in Current-code-reality and the Inputs section; migration step 1 mirrors the existing `egov.user.context.path` binding, and step 6 now explicitly verifies the **deployed** `${egov.user.host}` fronts egov-user vs the Kong hardcode.
- **[citation corrections → applied] Kong guard line numbers.** Pass-1 cited Guard 2 as `kong.yml:65–68`; the actual early-return block is `kong.yml:65–67` (`if ri["userInfo"]…` L65, `if ui["uuid"]…return end` L67). Guard 1 split to `kong.yml:63` (`local token`) + `kong.yml:64` (`if not token…return end`); introspection POST at `kong.yml:71` (single line, not 71–74); error pass-throughs at `kong.yml:75` and `kong.yml:76`; flat read/assign at `kong.yml:79–80`. All design references corrected to these exact lines.
- **[interface A→B → addressed] empty-role principal from wrong `roles[]` mapping.** Resolved jointly with the flat-shape fix: O1 now blocks B coding against `Principal.roles`, stated in the A→B interface bullet and the risk list (silent employee→"no role" degrade).
- **[interface A→C → addressed] negative test must surface, not hide, C's open leaks.** Resolved by A.6: the per-grain test records `daily` as a tracked failure for C (and notes the `AnalyticsPlanner.java:243` un-anchored tenant LIKE as C's to fix), so A cannot "ship green" while C leaks.
- **[interface A→D → addressed] batch `queries` arm.** Verified: `AnalyticsService.query()` resolves one `scope` at `AnalyticsService.java:32` and feeds it to both the single arm (`L51`) and the batch arm (`L42–46`), so A's trusted principal covers both. Clarified in Current-code-reality, A.3, the control-flow diagram, and the A→D interface bullet that the **batch-arm bypass is a Part-D `kpiId` re-check concern, not a Part-A trust gap** (not fixable here; owner = Part D).
- **[interface B/C → noted, not owned] `tenantStateLevel` drop in `PrincipalAttributes`.** Cross-cutting README finding. `AnalyticsScope.tenantStateLevel` exists (`AnalyticsScope.java:22`); carrying it into attribute resolution so C can pick `LIKE prefix` vs `= tenant` is **B/C's** responsibility. Noted in A.5; **not fixable in Part A** (owner = Parts B and C).
- **[verdict] verified-citations were all confirmed exact** against the tree (`AnalyticsController.java:40–69`, `AnalyticsScope.java:31–48`, `AnalyticsService.java:30–32`/`42–46`/`51`, `kong.yml:49–82`/`334–343`, `AnalyticsCatalog.java:54–108`, `AnalyticsPlanner.java:241–251`, `ServiceRequestRepository.java:30–43`, `PGRConfiguration.java:48`/`51`/`220`, `application.properties:63`). No mis-citation remained beyond the line-number tightening above; the two majors and three minors are folded into the design body with concrete changes; the only items left open are O1–O6 and the explicitly-Part-C/Part-D/Part-B-owned downstream fixes.

## Codex review (pass 2 — gpt-5.5, verdict: needs-rework)

> External adversarial review via `codex exec`, read-only, verifying the v2 revision log against the actual code. **Note:** codex evaluated "resolved" as "patched in code"; this is a *design* doc (no code changed yet), so most `actuallyResolved:false` items mean "design specifies it, code not yet written," not "design wrong." Read the findings for genuine design errors vs. implementation-status notes.


**Summary:** The v2 design resolves several citation/design-review issues on paper, but the actual code still has the original auth gap. There is also a remaining gateway fail-open path if the proposed A.1 gate is inserted after the existing body/RequestInfo early returns.


### Resolution check (5/11 confirmed in code)

- ❌ **Reused HTTP client is not fail-closed on 5xx/unreachable because fetchResult swallows and returns null.** — Code still has only ServiceRequestRepository.fetchResult returning null on generic exceptions at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/repository/ServiceRequestRepository.java:38-42; no AnalyticsAuthService or null-to-401 path exists, and AnalyticsController still trusts body RequestInfo at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsController.java:43-47.
- ❌ **Spoof negative test missed daily grain citizen leak.** — Design now surfaces the issue, but code still has daily citizenColumn=null at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:108 and applyScope skips citizen scope when null at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:246.
- ❌ **A.4 sibling-prefix leak from startsWith widening over unanchored tenant LIKE.** — The design removes prefix widening, but actual code still emits state tenant scope as tenant_id LIKE tenantId + '%' at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:242-244.
- ✅ **_details response-shape table assumed UserRequest nesting instead of flat top-level user.** — The cited in-tree Kong evidence is flat: decoded user is checked at top-level for uuid/userName and assigned directly to userInfo at CCRS/local-setup/kong/kong.yml:77-80.
- ❌ **egov.user.host local value differs from Kong hardcode and no _details path prop exists.** — The design acknowledges it, but code still only has egov.user.host/context/search/update config at CCRS/backend/pgr-services/src/main/resources/application.properties:63-68 and PGRConfiguration.java:48-61; no egov.user.details.path/getUserDetailsPath exists.
- ✅ **Kong guard line number citations were wrong.** — The corrected citations match: token guard at CCRS/local-setup/kong/kong.yml:63-64, userInfo early return at :65-67, URL at :71, error pass-throughs at :75-76, flat read/assign at :79-80.
- ❌ **A→B empty-role principal risk from wrong roles[] mapping.** — Design flags O1, but actual code has no parser or verified mapping. AnalyticsScope still consumes whatever body userInfo roles contain at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsScope.java:34-44.
- ❌ **A→C negative test must surface C's open leaks.** — No code/test change exists; C leaks remain: daily skips citizen scope via AnalyticsCatalog.java:108 plus AnalyticsPlanner.java:246, and tenant LIKE remains unanchored at AnalyticsPlanner.java:243.
- ✅ **A→D batch queries arm must not bypass trusted principal.** — For Part-A identity only, one scope is resolved once at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsService.java:30-32 and reused for batch runOne calls at :42-46 and single query at :50-51. D still owns kpiId re-checks.
- ✅ **B/C tenantStateLevel drop in PrincipalAttributes.** — Correctly noted as not owned by A. Current code has tenantStateLevel in AnalyticsScope at CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsScope.java:21-28 and no PrincipalAttributes implementation in the cited analytics package.
- ✅ **v2 verdict says verified citations exact.** — The cited current-code anchors checked in this pass are materially accurate, except the actual implementation remains unchanged and vulnerable.

### Findings

- **[BLOCKER] Auth foundation is not implemented; forged userInfo still reaches scope resolution** — The revised design describes service-side authoritative introspection, but the actual controller still converts RequestInfo directly from the request body and passes it to AnalyticsService. AnalyticsScope then derives citizen/employee posture from that body-supplied userInfo. This leaves identity spoofing and scope widening open in the actual code.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsController.java:43-47; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsScope.java:34-44`
- **[BLOCKER] Gateway still fails open on missing token, prefilled userInfo, and introspection failure** — The actual Kong pre-function returns without rejecting when authToken is missing, returns before introspection when userInfo has uuid/id/userName, and logs then passes through on unreachable/non-200 introspection. The pgr route has no route-level auth plugin to compensate.  
  _evidence:_ `CCRS/local-setup/kong/kong.yml:63-67; CCRS/local-setup/kong/kong.yml:75-76; CCRS/local-setup/kong/kong.yml:334-343`
- **[MAJOR] Proposed gateway hardening still misses malformed/no-body protected requests if inserted after RequestInfo parsing** — A.1 says to add the protected-route gate after ri is obtained, but the existing pre-function returns before that point for non-POST, empty body, invalid JSON, or missing RequestInfo. For protected analytics routes, those paths would bypass the claimed gateway 401 unless the protected-route check is moved before these early returns or those returns become protected-route 401s. Service-side auth would still catch this, but the A.1 resolution claim is overstated.  
  _evidence:_ `CCRS/local-setup/kong/kong.yml:56-62`
- **[MAJOR] _schema remains anonymous in code** — The design says _schema becomes protected, but the actual endpoint still accepts no body and directly returns service.schema(). This leaks grains, columns, and scope columns without authentication.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsController.java:57-59; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsService.java:71-93`
- **[MAJOR] Tenant is still body-controlled and can widen scope** — The controller still reads tenantId from the request body and passes it into AnalyticsScope; there is no cross-check against a vouched principal tenant or role tenant. At state-level tenant ids, the planner expands it with an unanchored LIKE.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsController.java:45-47; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsService.java:30-32; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:242-244`
- **[MAJOR] Daily grain still silently drops citizen self-scope** — Citizen self-scope is only injected when the grain has citizenColumn. The daily grain has null citizenColumn, so a citizen-scoped daily query only gets tenant scope.  
  _evidence:_ `CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsCatalog.java:98-108; CCRS/backend/pgr-services/src/main/java/org/egov/pgr/analytics/AnalyticsPlanner.java:246`
- **[MINOR] New service/config APIs cited by the design do not exist yet** — AnalyticsAuthService, UnauthenticatedException/ForbiddenException, egov.user.details.path, and getUserDetailsPath are design additions only. Treat any claim relying on them as unimplemented until the code adds them.  
  _evidence:_ `Search found no AnalyticsAuthService/getUserDetailsPath/egov.user.details.path in CCRS/backend/pgr-services; existing user config is only CCRS/backend/pgr-services/src/main/java/org/egov/pgr/config/PGRConfiguration.java:48-61 and CCRS/backend/pgr-services/src/main/resources/application.properties:63-68`

### Gaps

- No actual Part-A implementation exists in the cited code: no service-side token introspection, no controller 401/403 mapping, no tenant cross-check, and no protected _schema.
- No tests were found or cited that assert forged-admin/no-token, citizen-token overwrite, facts/events account_id scope, or daily known-failure behavior.
- Part-D and Part-F interfaces remain only aspirational: there is no kpiId/visibleTo invocation re-check or inline_forbidden gate in the analytics package.
