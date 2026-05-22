# workflow_create

> Create a workflow business service definition for a tenant, registering the state machine that drives PGR and other services.

**Group:** `pgr` | **Risk:** `write` | **DIGIT Service:** `egov-workflow-v2`

## Description

Registers a workflow state machine definition for a tenant. Workflows define the lifecycle of DIGIT entities: the states they can be in, the actions that transition between states, which roles can perform each action, and the SLA. The PGR workflow is the most common use case, defining the complaint lifecycle from creation through assignment, resolution, and citizen rating.

The recommended approach is to use `copy_from_tenant` to clone all workflow definitions from an existing tenant (e.g. `"pg"`). This copies the full state machine -- states, transitions, roles, and SLA -- without requiring manual specification. The tool searches the source tenant for all known business service codes (PGR, PT.CREATE, NewTL, etc.), strips internal IDs and audit fields, resolves UUID-based state references to state names, and creates clean copies on the target tenant. If a business service already exists on the target, it is skipped with a `"skipped"` status rather than throwing an error, making the operation idempotent.

Workflow definitions are stored at the **state root level** (e.g. `"pg"`, `"tenant"`). City-level tenants inherit automatically. If you pass a city-level tenant (e.g. `"tenant.stage3"`), it is auto-resolved to the root (`"tenant"`) before creating the definition. This means you only need to register workflows once per state root, not per city.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID (e.g. `"tenant"`, `"tenant.stage3"`). Auto-resolved to the state root for storage. |
| `copy_from_tenant` | string | no | -- | Source tenant to clone from (e.g. `"pg"`). **Recommended.** Copies all known business service definitions found. |
| `business_service` | string | no | -- | Business service code (e.g. `"PGR"`). Only needed if not using `copy_from_tenant`. |
| `business` | string | no | -- | Module name (e.g. `"pgr-services"`). Only needed if not using `copy_from_tenant`. |
| `business_service_sla` | number | no | -- | SLA in milliseconds (e.g. `259200000` for 3 days). Only needed if not using `copy_from_tenant`. |
| `states` | array | no | -- | State machine definition -- array of state objects (see schema below). Only needed if not using `copy_from_tenant`. |

### State Object Schema (for manual creation)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `state` | string | yes | State name (e.g. `"PENDINGFORASSIGNMENT"`) |
| `applicationStatus` | string | no | Application status label |
| `isStartState` | boolean | no | Whether this is the initial state |
| `isTerminateState` | boolean | no | Whether this is a terminal state |
| `actions` | array | no | Array of action objects with `action`, `nextState`, and `roles` |

## Response

Copy from tenant (recommended):

```json
{
  "success": true,
  "tenantId": "tenant",
  "resolvedFrom": "tenant.stage3",
  "source": "pg",
  "summary": {
    "created": 1,
    "skipped": 0,
    "failed": 0
  },
  "results": {
    "created": ["PGR"],
    "skipped": [],
    "failed": []
  },
  "hint": "Workflow registered at root \"tenant\". All city-level tenants (e.g. \"tenant.stage3\") inherit automatically."
}
```

Copy with some already existing:

```json
{
  "success": true,
  "tenantId": "tenant",
  "source": "pg",
  "summary": {
    "created": 0,
    "skipped": 1,
    "failed": 0
  },
  "results": {
    "created": [],
    "skipped": ["PGR"],
    "failed": []
  }
}
```

Manual creation:

```json
{
  "success": true,
  "message": "Workflow \"PGR\" created for tenant \"tenant\"",
  "businessService": {
    "businessService": "PGR",
    "business": "pgr-services",
    "tenantId": "tenant",
    "stateCount": 6
  }
}
```

## Examples

### Basic Usage

Clone PGR workflow from the reference tenant:

```
workflow_create({
  tenant_id: "tenant",
  copy_from_tenant: "pg"
})
```

### Clone for a City-Level Tenant

City-level tenants auto-resolve to their root:

```
workflow_create({
  tenant_id: "tenant.stage3",
  copy_from_tenant: "pg"
})
// Registers at "tenant" root — "tenant.stage3" inherits automatically
```

### Manual Creation

Define a custom PGR workflow (not recommended -- use copy_from_tenant instead):

```
workflow_create({
  tenant_id: "tenant",
  business_service: "PGR",
  business: "pgr-services",
  business_service_sla: 259200000,
  states: [
    {
      state: null,
      applicationStatus: null,
      isStartState: true,
      isTerminateState: false,
      actions: [
        { action: "APPLY", nextState: "PENDINGFORASSIGNMENT", roles: ["CITIZEN", "CSR", "EMPLOYEE"] }
      ]
    },
    {
      state: "PENDINGFORASSIGNMENT",
      applicationStatus: "PENDINGFORASSIGNMENT",
      isStartState: false,
      isTerminateState: false,
      actions: [
        { action: "ASSIGN", nextState: "PENDINGATLME", roles: ["GRO", "DGRO"] },
        { action: "REJECT", nextState: "REJECTED", roles: ["GRO", "DGRO"] }
      ]
    },
    {
      state: "PENDINGATLME",
      applicationStatus: "PENDINGATLME",
      isStartState: false,
      isTerminateState: false,
      actions: [
        { action: "RESOLVE", nextState: "RESOLVED", roles: ["PGR_LME"] }
      ]
    },
    {
      state: "RESOLVED",
      applicationStatus: "RESOLVED",
      isStartState: false,
      isTerminateState: false,
      actions: [
        { action: "RATE", nextState: "CLOSEDAFTERRESOLUTION", roles: ["CITIZEN"] },
        { action: "REOPEN", nextState: "PENDINGFORASSIGNMENT", roles: ["CITIZEN"] }
      ]
    },
    {
      state: "REJECTED",
      applicationStatus: "REJECTED",
      isStartState: false,
      isTerminateState: true,
      actions: []
    },
    {
      state: "CLOSEDAFTERRESOLUTION",
      applicationStatus: "CLOSEDAFTERRESOLUTION",
      isStartState: false,
      isTerminateState: true,
      actions: []
    }
  ]
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `No workflow business services found in source` | Source tenant has no workflows to copy | Try a different source (e.g. `"pg"`) |
| `DUPLICATE` / `already exists` | Workflow already registered (handled gracefully as `skipped`) | No action needed -- the tool skips duplicates automatically |
| `Either provide copy_from_tenant or business_service + states` | Manual mode missing required fields | Either use `copy_from_tenant` or provide both `business_service` and `states` |
| `API returned 200 but no data` | Tenant may not be properly configured | Ensure the tenant root exists in MDMS -- run `tenant_bootstrap` if needed |

## See Also

- [pgr_create](pgr_create.md) -- create PGR complaints (requires PGR workflow to be registered first)
- [city_setup](city_setup.md) -- sets up a city-level tenant including workflow registration
- [tenant_bootstrap](tenant_bootstrap.md) -- bootstraps a new state root including workflow definitions
