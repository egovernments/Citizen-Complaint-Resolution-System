# persister_monitor

> Comprehensive persister health monitor that runs all monitoring probes and cross-references results.

**Group:** `monitoring` | **Risk:** `read` | **DIGIT Service:** `multiple (composite)`

## Description

Runs a comprehensive health check of the DIGIT persistence layer by executing multiple monitoring probes and cross-referencing their results. This is the single tool to call when you want a full picture of whether the platform is operating correctly end-to-end, from API request through Kafka to the database.

Five probes are executed: (1) **Kafka lag** -- checks consumer group lag for `egov-persister`, (2) **Persister errors** -- scans container logs for categorized errors, (3) **DB counts** -- queries row counts in key database tables with delta tracking, (4) **Kafka-vs-DB delta comparison** -- cross-references Kafka message offsets against database row counts to detect data loss, and (5) **PGR-Workflow transaction parity** -- queries the PGR and Workflow APIs to verify that every complaint has a corresponding workflow process instance. Any probe can be skipped via the `skip_probes` parameter.

The tool aggregates results into an `overallStatus` of `OK`, `WARN`, or `CRITICAL` based on the worst status across all probes. Individual probe results and a list of aggregated alerts are included. The tool auto-logs in if authentication is needed for API-based probes (parity check).

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | no | Environment state tenant | Tenant ID for API-based probes (PGR search, workflow search). Used by the parity probe. |
| `since` | string | no | `"5m"` | Time window for the persister error log scan. One of: `"30s"`, `"1m"`, `"5m"`, `"15m"`, `"30m"`, `"1h"`, `"2h"`, `"6h"`, `"12h"`, `"24h"`. |
| `skip_probes` | array | no | `[]` | Probe names to skip. Options: `"kafka_lag"`, `"persister_errors"`, `"db_counts"`, `"parity"`. |

## Response

```json
{
  "overallStatus": "WARN",
  "probes": {
    "kafka_lag": {
      "status": "OK",
      "totalLag": 0,
      "topicCount": 12
    },
    "persister_errors": {
      "status": "WARN",
      "totalErrors": 3,
      "categories": {
        "DataIntegrityViolation": 2,
        "ListenerExecutionFailed": 1
      }
    },
    "db_counts": {
      "status": "OK",
      "tables": {
        "eg_pgr_service_v2": { "count": 47, "delta": 1 },
        "eg_pgr_address_v2": { "count": 47, "delta": 1 },
        "eg_wf_processinstance_v2": { "count": 142, "delta": 3 },
        "eg_wf_state_v2": { "count": 8, "delta": 0 },
        "eg_hrms_employee": { "count": 5, "delta": 0 }
      }
    },
    "kafka_vs_db": {
      "status": "OK",
      "detail": "Kafka offsets and DB counts are consistent"
    },
    "parity": {
      "status": "OK",
      "pgrCount": 47,
      "workflowCount": 47,
      "mismatches": []
    }
  },
  "alerts": [
    "WARN: persister_errors found 3 errors in last 5m (2x DataIntegrityViolation, 1x ListenerExecutionFailed)"
  ]
}
```

## Examples

### Basic Usage

Run all probes with defaults:

```
persister_monitor({})
```

Run for a specific tenant:

```
persister_monitor({ tenant_id: "pg.citya" })
```

Skip the API-based parity check (faster, no auth needed):

```
persister_monitor({ skip_probes: ["parity"] })
```

Scan a wider error log window:

```
persister_monitor({ since: "1h" })
```

### After Creating a Complaint

1. Create a complaint: `pgr_create({...})`
2. Wait a few seconds
3. Run full monitor: `persister_monitor({ tenant_id: "pg.citya" })`
4. Check that `db_counts` shows delta +1 for PGR and workflow tables
5. Check that `parity` shows matching counts

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Probe failed: kafka_lag | Redpanda container not running | Start DIGIT services |
| Probe failed: persister_errors | Persister container not running | Start DIGIT services |
| Probe failed: db_counts | PostgreSQL not reachable | Check database container and port 15432 |
| Probe failed: parity | Authentication failed or tenant invalid | Run `configure` first; verify tenant exists |

## See Also

- [kafka_lag](kafka_lag.md) -- Individual Kafka lag check
- [persister_errors](persister_errors.md) -- Individual persister error scan
- [db_counts](db_counts.md) -- Individual database row count check
- [Guide: Debugging](../../guides/debugging.md) -- End-to-end debugging workflow
