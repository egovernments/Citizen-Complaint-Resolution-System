# db_counts

> Get row counts for key DIGIT database tables with delta tracking between calls.

**Group:** `monitoring` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Queries the DIGIT PostgreSQL database directly via `psql` to get current row counts for the most important platform tables. The tool connects to PostgreSQL at `localhost:15432` using the `egov` user and `egov` database, which is the standard configuration for the Docker Compose development environment.

Five tables are monitored: `eg_pgr_service_v2` (PGR complaints), `eg_pgr_address_v2` (complaint addresses), `eg_wf_processinstance_v2` (workflow process instances), `eg_wf_state_v2` (workflow state definitions), and `eg_hrms_employee` (HRMS employees). These tables cover the core data flow for PGR operations.

The tool tracks deltas between consecutive calls. On the first call, delta values are `null`. On subsequent calls, each table shows how many rows were added since the previous call. This is invaluable for verifying that end-to-end operations are working: after creating a PGR complaint, you should see +1 in both `eg_pgr_service_v2` and `eg_wf_processinstance_v2`.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| *(none)* | | | | |

## Response

```json
{
  "database": "egov",
  "host": "localhost:15432",
  "tables": {
    "eg_pgr_service_v2": {
      "count": 47,
      "delta": 1
    },
    "eg_pgr_address_v2": {
      "count": 47,
      "delta": 1
    },
    "eg_wf_processinstance_v2": {
      "count": 142,
      "delta": 3
    },
    "eg_wf_state_v2": {
      "count": 8,
      "delta": null
    },
    "eg_hrms_employee": {
      "count": 5,
      "delta": 0
    }
  },
  "timestamp": "2026-02-28T10:30:00.000Z"
}
```

On first call, all deltas are `null`:

```json
{
  "tables": {
    "eg_pgr_service_v2": {
      "count": 46,
      "delta": null
    }
  }
}
```

## Examples

### Basic Usage

Get current row counts:

```
db_counts({})
```

### Verify End-to-End Flow

1. Get baseline counts: `db_counts({})`
2. Create a PGR complaint: `pgr_create({...})`
3. Wait a moment for the persister to write
4. Check counts again: `db_counts({})`
5. Expect `eg_pgr_service_v2` delta = +1 and `eg_wf_processinstance_v2` delta = +1

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Connection refused | PostgreSQL is not running or not exposed on port 15432 | Start DIGIT services: `cd ~/code/tilt-demo && docker compose -f docker-compose.deploy.yaml up -d` |
| psql not found | PostgreSQL client tools not installed | Install: `apt-get install postgresql-client` |
| Authentication failed | Database credentials do not match | Verify the `egov` user and database exist in the Docker Compose configuration |

## See Also

- [persister_monitor](persister_monitor.md) -- Comprehensive health check combining all monitoring probes
- [Guide: Debugging](../../guides/debugging.md) -- End-to-end debugging workflow
