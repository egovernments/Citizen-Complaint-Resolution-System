# trace_get

> Get the full trace by ID with a structured span breakdown grouped by service.

**Group:** `tracing` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Retrieves the complete details of a single distributed trace from Grafana Tempo, given its trace ID. The trace is broken down into individual spans, grouped by the service that produced them. Each span shows its operation name, duration, status, and key attributes extracted from the OpenTelemetry data.

Key attributes surfaced include `http.method`, `http.status_code`, `http.url`, `db.statement`, `db.system`, `messaging.system`, and `messaging.destination`. Error spans are highlighted with their error messages and stack traces when available. The response includes the total span count, total duration, and a direct Grafana URL for visual exploration of the trace in the Grafana UI.

Use `trace_search` or `trace_debug` first to obtain a trace ID, then pass it to this tool for the full breakdown. The trace ID is a hex string; if it is shorter than 32 characters, it will be automatically zero-padded on the left.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `trace_id` | string | yes | -- | The trace ID to retrieve. A hexadecimal string, automatically padded to 32 characters if shorter. |

## Response

```json
{
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "duration": 1245,
  "spanCount": 18,
  "services": {
    "pgr-services": {
      "spans": [
        {
          "operationName": "POST /pgr-services/v2/request/_create",
          "durationMs": 1245,
          "status": "OK",
          "attributes": {
            "http.method": "POST",
            "http.status_code": 200
          }
        },
        {
          "operationName": "POST /egov-workflow-v2/egov-wf/process/_transition",
          "durationMs": 430,
          "status": "OK",
          "attributes": {
            "http.method": "POST",
            "http.status_code": 200
          }
        }
      ]
    },
    "egov-workflow-v2": {
      "spans": [
        {
          "operationName": "POST /egov-wf/process/_transition",
          "durationMs": 410,
          "status": "OK",
          "attributes": {
            "http.method": "POST",
            "http.status_code": 200
          }
        },
        {
          "operationName": "select",
          "durationMs": 12,
          "status": "OK",
          "attributes": {
            "db.system": "postgresql",
            "db.statement": "SELECT * FROM eg_wf_state_v2 WHERE ..."
          }
        }
      ]
    },
    "egov-persister": {
      "spans": [
        {
          "operationName": "save-pgr-request process",
          "durationMs": 85,
          "status": "OK",
          "attributes": {}
        }
      ]
    }
  },
  "errors": [],
  "grafanaUrl": "http://localhost:3000/explore?left=%5B%22now-1h%22,%22now%22,%22Tempo%22,%7B%22traceId%22:%220af7651916cd43dd8448eb211c80319c%22%7D%5D"
}
```

When errors are present:

```json
{
  "errors": [
    {
      "service": "egov-workflow-v2",
      "operationName": "POST /egov-wf/process/_transition",
      "error": "java.lang.RuntimeException: Invalid action ASSIGN on state RESOLVED",
      "statusCode": 500
    }
  ]
}
```

## Examples

### Basic Usage

Get full trace details:

```
trace_get({ trace_id: "0af7651916cd43dd8448eb211c80319c" })
```

Short trace IDs are auto-padded:

```
trace_get({ trace_id: "abc123" })
// Treated as "000000000000000000000000000abc123"
```

### Investigate an Error

1. Search for recent error traces: `trace_search({ service_name: "pgr-services" })`
2. Get details of a suspicious trace: `trace_get({ trace_id: "0af7651916cd43dd8448eb211c80319c" })`
3. Check the `errors` array for failure details
4. Open the `grafanaUrl` in a browser for the visual waterfall view

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Trace not found | Invalid trace ID or trace has expired from Tempo storage | Verify the trace ID; Tempo retains traces for a limited time based on its retention config |
| Tempo unreachable | Grafana Tempo container not running | Start DIGIT services or check Tempo container |

## See Also

- [trace_search](trace_search.md) -- Search for traces to find trace IDs
- [trace_debug](trace_debug.md) -- One-call debugger that finds and analyzes the most recent trace
- [Guide: Debugging](../../guides/debugging.md) -- End-to-end debugging workflow
