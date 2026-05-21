# trace_search

> Search distributed traces by service name, operation, and duration using Grafana Tempo.

**Group:** `tracing` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Searches for distributed traces stored in Grafana Tempo. Traces represent end-to-end request flows across DIGIT services, captured by OpenTelemetry instrumentation. Each trace contains multiple spans showing the work done by each service involved in handling a request.

You can filter traces by service name (maps to the `service.name` resource attribute in OpenTelemetry), operation or span name (e.g. HTTP method, endpoint path, or database operation), and duration range. The time window defaults to the last 5 minutes but can be adjusted. Results are returned with the trace ID, root service, root operation, duration in milliseconds, and start time.

This tool is useful for finding traces related to a specific service or operation, identifying patterns in request processing, and locating traces to inspect in detail with `trace_get`. For a quicker debugging workflow when an API call has just failed, use `trace_debug` instead, which combines search and detail retrieval in one call.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service_name` | string | no | -- | Filter by service name (e.g. `"pgr-services"`, `"egov-workflow-v2"`, `"egov-persister"`, `"egov-mdms-service"`). Maps to the `service.name` resource attribute. |
| `operation` | string | no | -- | Filter by span/operation name (e.g. `"POST"`, `"GET"`, `"/_create"`, `"/_search"`, `"select"`). Maps to the span name. |
| `min_duration_ms` | number | no | -- | Minimum trace duration in milliseconds. Useful for finding slow requests. |
| `max_duration_ms` | number | no | -- | Maximum trace duration in milliseconds. |
| `seconds_ago` | number | no | `300` | How far back to search in seconds. Default is 5 minutes. |
| `limit` | number | no | `20` | Maximum number of traces to return. Maximum: 100. |

## Response

```json
{
  "traces": [
    {
      "traceId": "0af7651916cd43dd8448eb211c80319c",
      "rootService": "pgr-services",
      "rootOperation": "POST /pgr-services/v2/request/_create",
      "durationMs": 1245,
      "startTime": "2026-02-28T10:25:00.000Z"
    },
    {
      "traceId": "b3c7e9f2a1d84b6e9c0f1234abcd5678",
      "rootService": "pgr-services",
      "rootOperation": "POST /pgr-services/v2/request/_search",
      "durationMs": 87,
      "startTime": "2026-02-28T10:24:55.000Z"
    }
  ],
  "totalFound": 2
}
```

## Examples

### Basic Usage

Find recent traces for the PGR service:

```
trace_search({ service_name: "pgr-services" })
```

Find traces for a specific operation:

```
trace_search({ service_name: "pgr-services", operation: "_create" })
```

Find slow requests (over 2 seconds):

```
trace_search({ min_duration_ms: 2000 })
```

Search the last 30 minutes:

```
trace_search({ service_name: "egov-workflow-v2", seconds_ago: 1800 })
```

Find workflow traces with a duration cap:

```
trace_search({
  service_name: "egov-workflow-v2",
  min_duration_ms: 100,
  max_duration_ms: 500,
  limit: 50
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| No traces found | No matching traces in the time window, or tracing infrastructure is down | Widen the time window with `seconds_ago`; verify tracing health with `tracing_health` |
| Tempo unreachable | Grafana Tempo container not running | Start DIGIT services or check Tempo container |

## See Also

- [trace_get](trace_get.md) -- Get full details of a specific trace by ID
- [trace_debug](trace_debug.md) -- One-call debugger that combines search and detail retrieval
- [trace_slow](trace_slow.md) -- Find the slowest traces for performance analysis
