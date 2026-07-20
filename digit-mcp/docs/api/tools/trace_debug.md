# trace_debug

> One-call API debugger that finds the most recent trace for a service and returns full error analysis and call chain.

**Group:** `tracing` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

A composite debugging tool that combines `trace_search` and `trace_get` into a single call. Given a service name (and optionally an operation filter), it finds the most recent trace for that service, retrieves the full trace details, and returns a structured error analysis with the complete call chain across all services involved.

This is the tool to reach for immediately after an API call fails. Rather than manually searching for traces and then inspecting them one by one, `trace_debug` does both steps automatically. It returns whether a matching trace was found, the trace ID, any errors encountered during the request, a per-service span summary showing the call chain, and a Grafana URL for visual exploration.

The default lookback window is 60 seconds, which is appropriate for debugging a failure that just occurred. Increase `seconds_ago` if you need to investigate an older failure. For broader trace exploration (finding patterns, performance analysis), use `trace_search` and `trace_slow` directly instead.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service_name` | string | yes | -- | The service to debug (e.g. `"pgr-services"`, `"egov-workflow-v2"`, `"egov-mdms-service"`, `"egov-hrms"`). |
| `operation` | string | no | -- | Optional operation/endpoint pattern to narrow the search (e.g. `"_create"`, `"_search"`, `"POST"`, `"_transition"`). |
| `seconds_ago` | number | no | `60` | How far back to look in seconds. Default is 1 minute. |

## Response

When a trace is found:

```json
{
  "found": true,
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "durationMs": 1245,
  "errors": [
    {
      "service": "egov-workflow-v2",
      "operation": "POST /egov-wf/process/_transition",
      "error": "java.lang.RuntimeException: Invalid action ASSIGN on state RESOLVED",
      "statusCode": 500
    }
  ],
  "spanSummary": {
    "pgr-services": {
      "spanCount": 5,
      "totalDurationMs": 1245,
      "operations": ["POST /pgr-services/v2/request/_create", "POST /egov-workflow-v2/..."]
    },
    "egov-workflow-v2": {
      "spanCount": 8,
      "totalDurationMs": 430,
      "operations": ["POST /egov-wf/process/_transition", "select", "insert"]
    },
    "egov-persister": {
      "spanCount": 3,
      "totalDurationMs": 85,
      "operations": ["save-pgr-request process"]
    }
  },
  "grafanaUrl": "http://localhost:3000/explore?..."
}
```

When no trace is found:

```json
{
  "found": false,
  "message": "No traces found for pgr-services in the last 60 seconds"
}
```

## Examples

### Basic Usage

Debug the most recent PGR service request:

```
trace_debug({ service_name: "pgr-services" })
```

Debug a specific operation that failed:

```
trace_debug({ service_name: "pgr-services", operation: "_create" })
```

Look further back in time:

```
trace_debug({ service_name: "egov-workflow-v2", seconds_ago: 300 })
```

### Typical Debugging Workflow

1. An API call fails (e.g. `pgr_create` returns an error)
2. Immediately debug: `trace_debug({ service_name: "pgr-services", operation: "_create" })`
3. Check the `errors` array to see which service failed and why
4. Check `spanSummary` to understand the full call chain
5. Open `grafanaUrl` for the visual waterfall view if more detail is needed

### Debug Cross-Service Issues

When a PGR create fails due to a workflow error:

```
trace_debug({ service_name: "pgr-services", operation: "_create" })
```

The `errors` array will show the workflow service error even though the root call was to PGR, because the trace spans the entire request chain.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| No traces found | No matching traces in the time window | Increase `seconds_ago`; verify tracing is healthy with `tracing_health` |
| Tempo unreachable | Grafana Tempo container not running | Start DIGIT services |

## See Also

- [trace_search](trace_search.md) -- Search for traces with more filter options
- [trace_get](trace_get.md) -- Get full details of a trace by ID
- [health_check](health_check.md) -- Check DIGIT service health (API level)
- [Guide: Debugging](../../guides/debugging.md) -- End-to-end debugging workflow
