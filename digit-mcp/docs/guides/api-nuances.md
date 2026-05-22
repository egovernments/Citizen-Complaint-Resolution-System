# DIGIT API Nuances & Gotchas

This guide documents non-obvious behaviors, format mismatches, and deployment-specific quirks in the DIGIT platform APIs. These were discovered during real integration work and issue investigation. If you are building a client, writing tests, or debugging failures against a DIGIT backend, start here.

---

## 1. Decrypt API Accepts a Flat Array, Not an Envelope

**Symptom:** Calling `/egov-enc-service/crypto/v1/_decrypt` with a `{decryptionRequests: [...]}` wrapper returns a 400 or unexpected error.

**Root cause:** The decrypt and encrypt endpoints use different request formats. The encrypt endpoint expects a nested envelope:

```json
{
  "encryptionRequests": [
    { "tenantId": "pg", "type": "Normal", "value": ["plain text"] }
  ]
}
```

The decrypt endpoint expects a **flat JSON array of encrypted strings** with no envelope at all:

```json
["595525|xBCNa0...encrypted...", "595525|yDEOb1...encrypted..."]
```

Each encrypted string contains an embedded key reference, so no `tenantId` or `type` field is needed on decrypt.

**How to fix:** Send a bare JSON array to `_decrypt`. Do not wrap it in an object. The MCP server's `decrypt_data` tool handles this automatically.

---

## 2. Workflow Default Limit Breaks PGR at Scale

**Symptom:** PGR search returns complaints, but subsequent operations fail with `"The workflow object is not found"` once you have more than 10 complaints in a tenant.

**Root cause:** The `egov-workflow-v2` service has `egov.wf.default.limit=10` hardcoded in its `application.properties`. When PGR batch-fetches workflow states for a set of complaints, it does not pass an explicit `limit` query parameter. The workflow service applies the default limit of 10, silently dropping results beyond that. PGR then cannot find workflow state for the remaining complaints.

**How to fix:** Set environment variables on the `egov-workflow-v2` container:

```yaml
environment:
  EGOV_WF_DEFAULT_LIMIT: "100"
  EGOV_WF_MAX_LIMIT: "500"
```

Spring Boot maps property names to env vars by converting dots to underscores and uppercasing: `egov.wf.default.limit` becomes `EGOV_WF_DEFAULT_LIMIT`. Be precise with the name -- incorrectly named env vars like `EGOV_SEARCH_DEFAULT_LIMIT` are silently ignored by Spring Boot, and the hardcoded default of 10 remains in effect.

---

## 3. HRMS Employee Search NPEs Without Explicit Offset

**Symptom:** Calling `/egov-hrms/employees/_search` without an `offset` query parameter results in a NullPointerException on the server.

**Root cause:** The HRMS service does not provide a default value for the `offset` parameter internally. When it is absent from the request, the code attempts to use a null value in pagination logic, causing an NPE.

**How to fix:** Always pass `offset=0` as a query parameter, even when fetching the first page:

```
GET /egov-hrms/employees/_search?tenantId=pg.citya&offset=0&limit=100
```

The MCP server's `validate_employees` and `employee_create` tools inject `offset=0` automatically.

---

## 4. HRMS Employee Create Sends userName=null

**Symptom:** Creating an employee via `/egov-hrms/employees/_create` fails with an NPE in the user service. The error trace shows `userName=null` being sent to the user creation endpoint.

**Root cause:** The stock `egovio/egov-hrms` Docker image (`hrms-boundary-0a4e737` tag) has a bug where the employee-to-user mapping does not correctly derive the username from the employee's name and mobile number. It passes `null` as the username to the user service, which then throws an NPE.

**How to fix:** Use the patched HRMS image `hrms-boundary-patched` which correctly constructs the username. In Docker Compose:

```yaml
egov-hrms:
  image: egovio/egov-hrms:hrms-boundary-patched
```

Alternatively, create the user first via the user service (with an explicit username), then create the employee record linked to that user.

---

## 5. RequestInfo.userInfo Must Be Fully Populated

**Symptom:** Direct `curl` calls to DIGIT endpoints (PGR, HRMS, Inbox) fail with `NullPointerException: RequestInfo.getUserInfo() is null` or authorization errors, even when a valid auth token is provided.

**Root cause:** Most DIGIT service endpoints expect `RequestInfo.userInfo` in the POST body to contain the full user object, including `id`, `uuid`, `userName`, `type`, `roles[]`, and `tenantId`. The API gateway (Zuul/Kong) authenticates the token but does **not** populate this `userInfo` block in the request body. Services read user context from the body, not from gateway headers.

**How to fix:** After login (`/user/oauth/token`), call `/user/_details` to get the full user object. Then include it in every subsequent request:

```json
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "authToken": "your-token-here",
    "userInfo": {
      "id": 123,
      "uuid": "abc-def-...",
      "userName": "ADMIN",
      "type": "EMPLOYEE",
      "roles": [
        { "code": "EMPLOYEE", "name": "Employee", "tenantId": "pg" }
      ],
      "tenantId": "pg"
    }
  }
}
```

The MCP server stores the full `userInfo` from the login response and injects it into every `RequestInfo` automatically.

---

## 6. egov-location Is Legacy -- Use boundary-service Instead

**Symptom:** Calls to `egov-location` endpoints return connection refused or empty results in newer DIGIT deployments.

**Root cause:** The `egov-location` service is a legacy boundary service that has been superseded by `boundary-service`. In the tilt-demo Docker Compose stack (and many modern deployments), `egov-location` is intentionally not deployed. Its data model and API are incompatible with the newer boundary hierarchy system.

**How to fix:** Use `boundary-service` endpoints for all boundary operations:

- Hierarchy definitions: `POST /boundary-service/boundary-hierarchy-definition/_search`
- Boundary entity search: `POST /boundary-service/boundary/_search`
- Boundary entity create: `POST /boundary-service/boundary-relationships/_create`

The MCP server's `location_search` tool gracefully handles the case where `egov-location` is unavailable, returning a clear error message. For reliable boundary operations, use the `boundary` tool group (`validate_boundary`, `boundary_hierarchy_search`, `boundary_create`).

---

## 7. Inbox v1 Does Not Work for PGR -- Use v2

**Symptom:** Calling `/inbox/v1/_search` for PGR complaints returns `"Inbox service is not configured for the provided business services"`.

**Root cause:** The Inbox v1 API requires module-specific configuration to be registered before it can serve queries. PGR is often not configured in v1, especially in newer deployments that ship with v2 as the default.

**How to fix:** Use the v2 endpoint instead:

```
POST /inbox/v2/_search
```

The v2 API works for PGR without additional configuration and returns a richer response:

```json
{
  "statusMap": [...],
  "totalCount": 5,
  "items": [
    {
      "ProcessInstance": { ... },
      "businessObject": { ... },
      "serviceObject": { ... }
    }
  ]
}
```

---

## 8. Cross-Tenant Operations Require Role Tagging

**Symptom:** A user authenticated on tenant `pg` gets `"User is not authorized"` when creating PGR complaints or performing operations on `tenant.coimbatore`.

**Root cause:** DIGIT's authorization model checks that a user's roles are explicitly tagged to the target tenant's root. Roles are not global -- they are stored as `(roleCode, tenantId)` pairs on the user record. A user with `GRO` role on `pg` does not automatically have `GRO` on `tenant`. The role must be separately added with `tenantId: "tenant"`.

**How to fix:** Before cross-tenant operations, add the required roles for the target tenant:

```
POST /user/users/_updatenovalidate
```

Include the new roles with the target tenant's root ID in the user's role list. The MCP server provides the `user_role_add` tool which handles this: it fetches the current user record, adds the missing roles for the target tenant, and updates the user. Standard PGR roles to add: `CITIZEN`, `EMPLOYEE`, `CSR`, `GRO`, `PGR_LME`, `DGRO`, `SUPERUSER`.
