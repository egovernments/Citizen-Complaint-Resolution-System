# pgr_search

> Search PGR complaints/service requests for a tenant, with optional filters for status and service request ID.

**Group:** `pgr` | **Risk:** `read` | **DIGIT Service:** `pgr-services`

## Description

Queries the PGR (Public Grievance Redressal) service for complaints filed against a tenant. Returns detailed complaint records including the service code, description, current application status, priority, citizen rating, citizen contact info, address with locality, and the most recent workflow state. Supports pagination via `limit` and `offset`.

Complaints can be filtered by a specific `service_request_id` for direct lookup, or by `status` to find complaints at a particular workflow stage. The six status values map to the PGR workflow states: `PENDINGFORASSIGNMENT` (newly created, awaiting GRO action), `PENDINGATLME` (assigned to a Last Mile Employee), `PENDINGFORREASSIGNMENT` (returned for reassignment), `RESOLVED` (marked resolved by LME), `REJECTED` (rejected by GRO), and `CLOSEDAFTERRESOLUTION` (rated by citizen and closed).

Each complaint in the response includes the citizen who filed it (name, mobile, UUID), the address with locality boundary reference, and the current workflow state showing the last action taken, current state name, and any assignees. Timestamps for creation and last modification are also included.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search complaints in (e.g. `"pg.citya"`) |
| `service_request_id` | string | no | -- | Specific service request ID to look up (e.g. `"PB-PGR-2026-01-15-000123"`) |
| `status` | string | no | -- | Filter by complaint status. One of: `PENDINGFORASSIGNMENT`, `PENDINGATLME`, `PENDINGFORREASSIGNMENT`, `RESOLVED`, `REJECTED`, `CLOSEDAFTERRESOLUTION` |
| `limit` | number | no | `50` | Maximum results to return |
| `offset` | number | no | `0` | Pagination offset |

## Response

```json
{
  "success": true,
  "tenantId": "pg.citya",
  "count": 1,
  "complaints": [
    {
      "serviceRequestId": "PB-PGR-2026-01-15-000123",
      "serviceCode": "StreetLightNotWorking",
      "description": "Street light outside Block 5 has been off for two weeks",
      "status": "PENDINGFORASSIGNMENT",
      "priority": 4,
      "rating": null,
      "citizen": {
        "name": "Ramesh Kumar",
        "mobileNumber": "9876543210",
        "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      },
      "address": {
        "locality": {
          "code": "LOC_CITYA_1",
          "name": "Locality 1"
        },
        "city": "citya",
        "district": "pg"
      },
      "workflow": {
        "action": "APPLY",
        "state": "PENDINGFORASSIGNMENT",
        "assignes": null,
        "comment": null
      },
      "createdTime": 1736899200000,
      "lastModifiedTime": 1736899200000
    }
  ]
}
```

## Examples

### Basic Usage

List all complaints for a tenant:

```
pgr_search({ tenant_id: "pg.citya" })
```

### Look Up a Specific Complaint

Fetch a single complaint by its service request ID:

```
pgr_search({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123"
})
```

### Filter by Status

Find all complaints waiting for assignment:

```
pgr_search({
  tenant_id: "pg.citya",
  status: "PENDINGFORASSIGNMENT"
})
```

### Paginated Search

Fetch the second page of resolved complaints:

```
pgr_search({
  tenant_id: "pg.citya",
  status: "RESOLVED",
  limit: 20,
  offset: 20
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `count: 0` | No complaints match the filters | Verify the tenant has PGR complaints, or broaden the filter |
| Empty response with valid tenant | PGR service may not be configured for this tenant | Check that workflow exists with `workflow_business_services` and complaint types exist with `validate_complaint_types` |

## See Also

- [pgr_create](pgr_create.md) -- create a new PGR complaint
- [pgr_update](pgr_update.md) -- advance a complaint through its workflow (ASSIGN, RESOLVE, RATE, etc.)
- [Guide: PGR Lifecycle](../../guides/pgr-lifecycle.md) -- end-to-end walkthrough of the complaint lifecycle
