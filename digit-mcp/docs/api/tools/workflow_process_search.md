# workflow_process_search

> Search the workflow audit trail for specific business IDs, showing every state transition for a complaint or entity.

**Group:** `pgr` | **Risk:** `read` | **DIGIT Service:** `egov-workflow-v2`

## Description

Queries the DIGIT workflow service for process instances associated with specific business IDs (e.g. PGR service request IDs). Each process instance represents a single workflow transition -- the action taken, the state it moved to, who performed it, any comment left, and when it happened. Together, the process instances for a business ID form a complete audit trail of every workflow action.

For PGR complaints, this tool shows the full history: the initial APPLY action when the complaint was created, the ASSIGN action when a GRO routed it, the RESOLVE action when the LME fixed the issue, and the RATE action when the citizen closed it. This is useful for debugging workflow issues, verifying that complaints moved through the expected states, and auditing who took each action.

Results support pagination via `limit` and `offset`. Each process instance includes the instance ID, business ID, business service code (e.g. `"PGR"`), current state name, action performed, assignee information, comment text, and creation timestamp.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID (e.g. `"pg.citya"`) |
| `business_ids` | string[] | no | -- | Business IDs to look up (e.g. PGR service request IDs like `["PB-PGR-2026-01-15-000123"]`) |
| `limit` | number | no | `50` | Maximum results to return |
| `offset` | number | no | `0` | Pagination offset |

## Response

```json
{
  "success": true,
  "tenantId": "pg.citya",
  "count": 3,
  "processInstances": [
    {
      "id": "f1e2d3c4-b5a6-7890-abcd-ef1234567890",
      "businessId": "PB-PGR-2026-01-15-000123",
      "businessService": "PGR",
      "state": "PENDINGATLME",
      "action": "ASSIGN",
      "assignee": {
        "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "name": "Street Lighting Officer"
      },
      "comment": "Assigning to street lighting team",
      "createdTime": 1736985600000
    },
    {
      "id": "e2d3c4b5-a6f7-8901-bcde-f12345678901",
      "businessId": "PB-PGR-2026-01-15-000123",
      "businessService": "PGR",
      "state": "PENDINGFORASSIGNMENT",
      "action": "APPLY",
      "assignee": null,
      "comment": null,
      "createdTime": 1736899200000
    }
  ]
}
```

## Examples

### Basic Usage

Get the workflow audit trail for a specific complaint:

```
workflow_process_search({
  tenant_id: "pg.citya",
  business_ids: ["PB-PGR-2026-01-15-000123"]
})
```

### Look Up Multiple Complaints

Fetch the audit trail for several complaints at once:

```
workflow_process_search({
  tenant_id: "pg.citya",
  business_ids: [
    "PB-PGR-2026-01-15-000123",
    "PB-PGR-2026-01-15-000124"
  ]
})
```

### Paginated Audit Trail

For complaints with many transitions, paginate through the history:

```
workflow_process_search({
  tenant_id: "pg.citya",
  business_ids: ["PB-PGR-2026-01-15-000123"],
  limit: 10,
  offset: 0
})
```

### Debug a Complaint Lifecycle

Verify a complaint went through the expected states:

```
// Step 1: Check current status
pgr_search({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123"
})

// Step 2: See the full history of actions
workflow_process_search({
  tenant_id: "pg.citya",
  business_ids: ["PB-PGR-2026-01-15-000123"]
})
// Shows: APPLY -> ASSIGN -> RESOLVE -> RATE (or whatever transitions occurred)
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `count: 0` | No process instances found for the given business IDs | Verify the complaint exists with `pgr_search` and that the business IDs are correct |
| Empty response without `business_ids` | The API may return nothing without a filter | Provide specific business IDs to search for |

## See Also

- [pgr_search](pgr_search.md) -- look up complaint details and current status
