# workflow_business_services

> Search workflow state machine definitions for a tenant, showing states, actions, transitions, roles, and SLA.

**Group:** `pgr` | **Risk:** `read` | **DIGIT Service:** `egov-workflow-v2`

## Description

Queries the DIGIT workflow service for business service configurations registered on a tenant. Each business service defines a state machine that controls how entities (like PGR complaints) transition through their lifecycle. The response includes the business service code, associated module name, SLA in milliseconds, and the full state machine: each state with its application status, start/terminate flags, and available actions with their target state and required roles.

The workflow API requires explicit business service codes to return results -- it returns an empty list when no filter is provided. Pass `business_services: ["PGR"]` to check whether the PGR state machine is registered. If no results are returned even with a filter, the workflow has not been created for this tenant yet. The tool includes a diagnostic hint suggesting `workflow_create` in that case.

Workflow definitions are stored at the state root level (e.g. `"pg"`, `"tenant"`). City-level tenants inherit automatically, so searching `"pg.citya"` will find definitions registered at `"pg"`. This is the primary tool for understanding what actions are valid at each stage of the PGR workflow, and which roles can perform them.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID (e.g. `"pg"`, `"pg.citya"`) |
| `business_services` | string[] | no | -- | Business service codes to look up (e.g. `["PGR"]`). Omit to list all, but note the API typically returns empty without a filter. |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "count": 1,
  "businessServices": [
    {
      "businessService": "PGR",
      "business": "pgr-services",
      "businessServiceSla": 259200000,
      "states": [
        {
          "state": null,
          "applicationStatus": null,
          "isStartState": true,
          "isTerminateState": false,
          "actions": [
            { "action": "APPLY", "nextState": "PENDINGFORASSIGNMENT", "roles": ["CITIZEN", "CSR", "EMPLOYEE"] }
          ]
        },
        {
          "state": "PENDINGFORASSIGNMENT",
          "applicationStatus": "PENDINGFORASSIGNMENT",
          "isStartState": false,
          "isTerminateState": false,
          "actions": [
            { "action": "ASSIGN", "nextState": "PENDINGATLME", "roles": ["GRO", "DGRO"] },
            { "action": "REJECT", "nextState": "REJECTED", "roles": ["GRO", "DGRO"] }
          ]
        },
        {
          "state": "PENDINGATLME",
          "applicationStatus": "PENDINGATLME",
          "isStartState": false,
          "isTerminateState": false,
          "actions": [
            { "action": "RESOLVE", "nextState": "RESOLVED", "roles": ["PGR_LME"] },
            { "action": "REASSIGN", "nextState": "PENDINGFORREASSIGNMENT", "roles": ["GRO"] }
          ]
        },
        {
          "state": "RESOLVED",
          "applicationStatus": "RESOLVED",
          "isStartState": false,
          "isTerminateState": false,
          "actions": [
            { "action": "RATE", "nextState": "CLOSEDAFTERRESOLUTION", "roles": ["CITIZEN"] },
            { "action": "REOPEN", "nextState": "PENDINGFORASSIGNMENT", "roles": ["CITIZEN"] }
          ]
        },
        {
          "state": "REJECTED",
          "applicationStatus": "REJECTED",
          "isStartState": false,
          "isTerminateState": true,
          "actions": []
        },
        {
          "state": "CLOSEDAFTERRESOLUTION",
          "applicationStatus": "CLOSEDAFTERRESOLUTION",
          "isStartState": false,
          "isTerminateState": true,
          "actions": []
        }
      ]
    }
  ]
}
```

When no results are found (with filter):

```json
{
  "success": true,
  "tenantId": "tenant.city1",
  "count": 0,
  "businessServices": [],
  "hint": "No workflow business services found for \"tenant.city1\" matching [\"PGR\"]. FIX: Call workflow_create with tenant_id=\"tenant.city1\" and copy_from_tenant set to a tenant that has the PGR workflow (e.g. \"pg\")."
}
```

When no results are found (without filter):

```json
{
  "success": true,
  "tenantId": "pg",
  "count": 0,
  "businessServices": [],
  "hint": "The workflow API requires explicit business service codes — it returns empty without a filter. Retry with business_services=[\"PGR\"] to check if PGR is registered."
}
```

## Examples

### Basic Usage

Check if PGR workflow is registered for a tenant:

```
workflow_business_services({
  tenant_id: "pg",
  business_services: ["PGR"]
})
```

### Inspect All Known Workflows

Check multiple business service codes at once:

```
workflow_business_services({
  tenant_id: "pg",
  business_services: ["PGR", "PT.CREATE", "NewTL"]
})
```

### Debug a pgr_update Failure

When a workflow action fails, check what transitions are valid from the current state:

```
// Step 1: Check the complaint status
pgr_search({ tenant_id: "pg.citya", service_request_id: "PB-PGR-2026-01-15-000123" })
// Returns: status: "PENDINGFORASSIGNMENT"

// Step 2: Check valid actions for this state
workflow_business_services({ tenant_id: "pg.citya", business_services: ["PGR"] })
// Shows: PENDINGFORASSIGNMENT allows ASSIGN (GRO, DGRO) or REJECT (GRO, DGRO)
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `count: 0` with no filter | API requires explicit codes | Retry with `business_services: ["PGR"]` |
| `count: 0` with filter | Workflow not registered for this tenant | Call `workflow_create` with `copy_from_tenant: "pg"` |

## See Also

- [pgr_update](pgr_update.md) -- apply workflow actions to PGR complaints
- [workflow_create](workflow_create.md) -- register a workflow state machine for a new tenant
