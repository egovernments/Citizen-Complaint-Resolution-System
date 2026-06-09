# pgr_update

> Update a PGR complaint by applying a workflow action (ASSIGN, RESOLVE, REJECT, REOPEN, RATE, or REASSIGN).

**Group:** `pgr` | **Risk:** `write` | **DIGIT Service:** `pgr-services`

## Description

Advances a PGR complaint through its workflow by applying an action. The tool automatically fetches the complaint by service request ID, then submits the action along with optional assignees, comment, and rating. The response shows both the previous and new status, making it easy to track state transitions.

The PGR workflow follows this state machine:

```
PENDINGFORASSIGNMENT --(ASSIGN)--> PENDINGATLME --(RESOLVE)--> RESOLVED --(RATE)--> CLOSEDAFTERRESOLUTION
         |                              |                          |
         +--(REJECT)--> REJECTED        +--(REASSIGN)--> PENDING   +--(REOPEN)--> PENDINGFORASSIGNMENT
                                           FORREASSIGNMENT
```

Different actions require different roles. GRO (Grievance Routing Officer) can ASSIGN, REASSIGN, and REJECT. PGR_LME (Last Mile Employee) can RESOLVE. CITIZEN can REOPEN and RATE. For citizen actions (REOPEN, RATE), you must authenticate as the citizen who filed the complaint -- use the `citizenLogin` credentials returned by `pgr_create` with the `configure` tool.

For ASSIGN and REASSIGN, you can optionally provide employee UUIDs in the `assignees` parameter. If omitted, PGR auto-routes based on department and locality configuration. Use `validate_employees` to find employee UUIDs with the PGR_LME role.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID (e.g. `"pg.citya"`) |
| `service_request_id` | string | yes | -- | Service request ID to update (e.g. `"PB-PGR-2026-01-15-000123"`) |
| `action` | string | yes | -- | Workflow action: `ASSIGN`, `REASSIGN`, `RESOLVE`, `REJECT`, `REOPEN`, or `RATE` |
| `assignees` | string[] | no | -- | Employee UUIDs for ASSIGN/REASSIGN. If omitted, PGR auto-routes. |
| `comment` | string | no | -- | Comment for the action (recommended for all actions) |
| `rating` | number | no | -- | Citizen satisfaction rating (1-5). Used with the RATE action. |

## Response

```json
{
  "success": true,
  "message": "Complaint PB-PGR-2026-01-15-000123 updated: ASSIGN",
  "complaint": {
    "serviceRequestId": "PB-PGR-2026-01-15-000123",
    "previousStatus": "PENDINGFORASSIGNMENT",
    "newStatus": "PENDINGATLME",
    "workflowState": "PENDINGATLME",
    "rating": null
  }
}
```

ASSIGN without explicit assignees includes a warning:

```json
{
  "success": true,
  "message": "Complaint PB-PGR-2026-01-15-000123 updated: ASSIGN",
  "warning": "No assignees specified — PGR will auto-route. Pass employee UUIDs in assignees for explicit assignment.",
  "complaint": { ... }
}
```

Error response with diagnostic hint:

```json
{
  "success": false,
  "error": "User is not authorized to perform action RATE",
  "currentStatus": "RESOLVED",
  "attemptedAction": "RATE",
  "hint": "RATE requires CITIZEN role tagged to \"pg\". FIX: The citizen who filed the complaint has login credentials (returned by pgr_create in the citizenLogin field). Call configure with the citizen's username (their mobile number) and password \"eGov@123\" and tenant_id=\"pg\". Then retry pgr_update with action=\"RATE\".",
  "alternatives": [
    { "tool": "workflow_create", "purpose": "Register PGR workflow if missing" },
    { "tool": "pgr_search", "purpose": "Verify complaint current status" },
    { "tool": "workflow_business_services", "purpose": "Check valid workflow transitions and role requirements" },
    { "tool": "validate_employees", "purpose": "Find employees with correct PGR roles" }
  ]
}
```

## Examples

### Basic Usage

Assign a complaint to an employee:

```
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "ASSIGN",
  assignees: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
  comment: "Assigning to street lighting team"
})
```

### Resolve a Complaint

Mark a complaint as resolved (requires PGR_LME role):

```
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "RESOLVE",
  comment: "Replaced the street light bulb"
})
```

### Citizen Rates a Resolved Complaint

Authenticate as the citizen first, then rate:

```
// Step 1: Authenticate as the citizen
configure({
  username: "9876543210",
  password: "eGov@123",
  tenant_id: "pg"
})

// Step 2: Rate and close the complaint
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "RATE",
  rating: 5,
  comment: "Very satisfied with the resolution"
})
```

### Reject a Complaint

GRO rejects a complaint (from PENDINGFORASSIGNMENT):

```
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "REJECT",
  comment: "Duplicate complaint - already addressed in PB-PGR-2026-01-14-000098"
})
```

### Reopen a Resolved Complaint

Citizen reopens a complaint they are not satisfied with:

```
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "REOPEN",
  comment: "The street light is not working again"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `Complaint not found` | Invalid service request ID or wrong tenant | Verify with `pgr_search` |
| `BusinessService not found` | PGR workflow not registered | Call `workflow_create` with `copy_from_tenant: "pg"` |
| `User is not authorized` (citizen action) | RATE/REOPEN requires CITIZEN role | Authenticate as the citizen using `citizenLogin` from `pgr_create`, then retry |
| `User is not authorized` (employee action) | ASSIGN/RESOLVE/REJECT requires GRO or PGR_LME role | Use `validate_employees` to find an employee with the right role, or create one with `employee_create` |
| `User is not authorized` (cross-tenant) | User authenticated on a different tenant root | Re-authenticate on the target tenant with `configure` |
| Invalid state transition | Action not valid for current status | Check `workflow_business_services` for valid transitions from the current state |

## See Also

- [pgr_search](pgr_search.md) -- look up complaint details and current status before updating
- [validate_employees](validate_employees.md) -- find employee UUIDs for ASSIGN/REASSIGN actions
- [pgr_create](pgr_create.md) -- create a complaint (returns `citizenLogin` credentials for REOPEN/RATE)
- [workflow_business_services](workflow_business_services.md) -- inspect the PGR state machine to understand valid transitions and roles
- [Guide: PGR Lifecycle](../../guides/pgr-lifecycle.md) -- end-to-end walkthrough of the complaint lifecycle
