# persister_errors

> Scan egov-persister container logs for categorized errors with sample lines.

**Group:** `monitoring` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Scans the Docker logs of the `egov-persister` container for errors within a configurable time window. The tool categorizes errors into well-known types that correspond to common failure modes in the DIGIT persistence layer.

Eight error categories are tracked: `DataIntegrityViolation` (duplicate keys, constraint violations), `CannotCreateTransaction` (database connection pool exhausted), `CommitFailed` (Kafka offset commit failures), `ListenerExecutionFailed` (message processing exceptions), `Rollback` (transaction rollbacks), `DeadLetterTopic` (messages routed to dead letter queue), `GenericException` (uncategorized Java exceptions), and `GenericError` (other error-level log lines). For each category, the tool returns a count and the first three sample error lines for quick diagnosis.

This tool is essential for understanding why data is not being persisted. A common pattern is: `kafka_lag` shows zero lag (messages consumed) but `db_counts` shows no new rows -- in this case, `persister_errors` will reveal what went wrong during the write step (e.g. a schema mismatch or constraint violation).

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `since` | string | no | `"5m"` | Time window for the log scan. One of: `"30s"`, `"1m"`, `"5m"`, `"15m"`, `"30m"`, `"1h"`, `"2h"`, `"6h"`, `"12h"`, `"24h"`. |

## Response

```json
{
  "container": "egov-persister",
  "since": "5m",
  "categories": {
    "DataIntegrityViolation": {
      "count": 2,
      "samples": [
        "ERROR ... DataIntegrityViolationException: duplicate key value violates unique constraint \"eg_pgr_service_v2_pkey\"",
        "ERROR ... DataIntegrityViolationException: null value in column \"tenantid\" violates not-null constraint"
      ]
    },
    "CannotCreateTransaction": {
      "count": 0,
      "samples": []
    },
    "CommitFailed": {
      "count": 0,
      "samples": []
    },
    "ListenerExecutionFailed": {
      "count": 1,
      "samples": [
        "ERROR ... ListenerExecutionFailedException: Failed to process record from topic save-pgr-request"
      ]
    },
    "Rollback": {
      "count": 0,
      "samples": []
    },
    "DeadLetterTopic": {
      "count": 0,
      "samples": []
    },
    "GenericException": {
      "count": 0,
      "samples": []
    },
    "GenericError": {
      "count": 0,
      "samples": []
    }
  },
  "totalErrors": 3
}
```

## Examples

### Basic Usage

Scan the last 5 minutes of persister logs:

```
persister_errors({})
```

Scan the last hour for errors:

```
persister_errors({ since: "1h" })
```

Scan a wider window after a deployment:

```
persister_errors({ since: "24h" })
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Container not found | The `egov-persister` Docker container is not running | Start DIGIT services: `cd ~/code/tilt-demo && docker compose -f docker-compose.deploy.yaml up -d` |
| No logs available | Container just started, no logs in the time window | Use a wider `since` window or wait for activity |

## See Also

- [persister_monitor](persister_monitor.md) -- Comprehensive health check combining all monitoring probes
- [kafka_lag](kafka_lag.md) -- Check if messages are being consumed from Kafka
- [Guide: Debugging](../../guides/debugging.md) -- End-to-end debugging workflow
