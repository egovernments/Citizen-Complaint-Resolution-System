# Access Control — Move Actions from URL-Matching to Runtime-Evaluated JSON Policies

**Author:** Vinoth Rallapalli · **Date:** 2026-07-06 · **Status:** Proposal — feedback requested before implementation
**Scope:** `egov-accesscontrol` (`Action.java`, `ActionService`), `gateway` (`RbacFilterHelper`), a new shared `egov-policy` library, and the MDMS `ACCESSCONTROL-ACTIONS` / `ACCESSCONTROL-ROLEACTIONS` masters.
**Compatibility:** Additive and opt-in. No existing action, role-action mapping, or authorization outcome changes unless a service explicitly adopts the new fields.

---

## 1. Problem

Today an access-control **action** is effectively just a URL (plus optional query params). In `egov-accesscontrol`, `Action.java` carries `url`, `queryParams`, `name`, etc., and the only thing evaluated at runtime is *"does the request path match a URL this role can reach."*

The flow:

1. Gateway (`RbacFilterHelper`) extracts the request URI and the user's roles, then POSTs to `egov-accesscontrol`'s `/v1/actions/_authorize`.
2. `ActionService.isAuthorized()` collects every URL reachable by the user's roles (from MDMS `ACCESSCONTROL-ACTIONS` + `ACCESSCONTROL-ROLEACTIONS`) and checks `uris.contains(requestUri)`, or a regex match where `{param}` is substituted with `\w+`.

So **HTTP method, request body, resource ownership, resource state, tenant relationships, time** — none of it participates in the decision. We can express "this role can hit `/pgr/v2/request/_update`" but not "a GRO may assign **only complaints in their own tenant**" or "a citizen may reopen **only their own** complaint."

## 2. Goal

Replace the URL-only definition with a **richer, optional JSON definition evaluated at runtime** — request attributes, resource/contextual conditions, composable boolean logic — while staying **100% backward compatible** with the thousands of existing URL-only actions.

---

## 3. Design

### 3.1 Data model change (additive, opt-in)

Extend the MDMS `ACCESSCONTROL-ACTIONS` action object and `Action.java` with two new optional fields, `method` and `condition` (a `resource` hint list is included so the interceptor knows what to load — see §3.4):

```jsonc
{
  "id": 1543,
  "url": "/pgr-services/v2/request/_update",
  "name": "Assign Complaint",
  "method": "POST",            // NEW — optional; null = any method (today's behavior)
  "resource": [""],            // NEW — optional; null = any resource (today's behavior)
  "condition": {                // NEW — optional JsonLogic; null = URL-match only (today's behavior)
    "and": [
      { "in": [ { "var": "request.body.workflow.action" }, ["ASSIGN", "REASSIGN"] ] },
      { "==": [ { "var": "resource.complaint.tenantId" }, { "var": "user.tenantId" } ] }
    ]
  }
}
```

`condition == null` ⇒ behaves **exactly** like today. No existing action or RoleAction mapping needs to change.

### 3.2 Condition language: JsonLogic

Chosen because it has mature evaluators in **both Java** (`jsonlogic-java`) **and JS** (`json-logic-js`). The same `condition` JSON evaluates identically on the backend (source of truth) and on the **UI** — which already fetches the role-action list — so the frontend can decide whether to render an action button and we eliminate the "button shown → 401 on click" mismatch.

### 3.3 Two-tier evaluation (PEP / PDP split)

```
Tier 1 — Gateway (PEP):   url + method + role match, plus any condition that
                          reads ONLY user.*/action.*/env.* (data the gateway has).
                          Deny early = unchanged fast path.
        │ allow
        ▼
Tier 2 — Service (PDP):   shared `egov-policy` library, as a request interceptor:
                          1. build input doc { user, request(body/params), resource(loaded), env }
                          2. evaluate the action's JsonLogic condition
                          3. allow → proceed; deny → 403
```

Resource-level conditions ("is this MY complaint?") **must** run in Tier 2 — only the owning service can load the complaint. The gateway cannot answer them without parsing bodies and fetching every domain's resources, so it stays coarse and fast, deferring anything it can't fully evaluate.

### 3.4 Input-document contract (the `var` namespace)

A fixed, versioned namespace that both the Java and JS evaluators bind against:

```jsonc
{
  "user":     { "uuid": "...", "id": 42, "tenantId": "ke.nairobi", "roles": ["GRO"], "attributes": {} },
  "action":   { "method": "POST", "url": "/pgr-services/v2/request/_update" },
  "request":  { "body": { /* parsed */ }, "params": {}, "headers": { /* allowlisted */ } },  // Tier 2 only
  "resource": { "complaint": { "assignee": "...", "status": "...", "tenantId": "..." } },     // Tier 2 only
  "env":      { "now": "2026-07-06T10:00:00Z" }
}
```

- Condition reads only `user.*` / `action.*` / `env.*` → **gateway-evaluable**.
- Condition reads `request.*` / `resource.*` → **deferred to Tier 2** (gateway forwards, service decides).
- The policy library **statically inspects the condition's `var` paths at load time** to tag each action `gateway` / `service` / `both` — no human bookkeeping, no drift.
- An action declares a `resourceRefs` hint (the `resource` field in §3.1) so the interceptor knows what to load before evaluating.

### 3.5 Caching & failure behavior

- Conditions are static JSON → cached with the existing 15-minute MDMS role-action cache (`MdmsRepository`). No new hot-path cost for the URL match.
- **Fail-closed**: a malformed condition, missing required resource, or evaluator exception → **deny (403)** + log. Never silently allow.
- Condition JSON is **validated/linted at MDMS write time** so a broken policy can't reach runtime.

### 3.6 Testing

- **Parity unit tests**: a table of `(condition, inputDoc) → allow/deny`, run against *both* the Java and JS evaluators to prove identical verdicts.
- **Integration** (CI server): PGR assign flow — GRO assigns within tenant (allow); cross-tenant / not-assigned (deny).
- **Backward-compat**: condition-less actions authorize identically to the pre-change build.

---

## 4. Rollout

1. Add the two optional fields to the schema + `Action.java`; evaluators treat `null` as legacy. Ship — **no behavioral change**.
2. Build the `egov-policy` shared library + input-doc contract.
3. Annotate the **PGR assign/resolve** flow end-to-end (the ownership case).
4. Expand flow-by-flow.

---

## 5. Open questions for discussion

- Should `egov-policy` be a JAR pulled into each service, or a sidecar/local PDP call? (Proposal: JAR — no extra hop.)
- Do we want a `deny` (negative) policy concept, or keep it allow-only and rely on absence?
- Should the UI consume conditions directly, or expose a `/whatCanIDo?resource=...` decision endpoint to avoid shipping policy logic to the client?
- Versioning the input-document namespace — embed a `schemaVersion` on each condition?

---

Feedback welcome before this becomes an implementation plan / PR against `egov-accesscontrol` + `gateway`.
