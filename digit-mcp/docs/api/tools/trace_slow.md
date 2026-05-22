# trace_slow

> Find slow distributed traces above a duration threshold, sorted by duration descending.

**Group:** `tracing` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Searches Grafana Tempo for traces that exceed a specified duration threshold, returning them sorted by duration in descending order (slowest first). This is a focused performance analysis tool for identifying bottlenecks across the DIGIT platform.

The default threshold is 500 milliseconds, which catches most notably slow requests while filtering out normal fast operations. Adjust the threshold up for high-traffic environments where only very slow requests matter, or down to catch subtle performance regressions. The time window defaults to the last 5 minutes.

Each result includes the trace ID, root service and operation, duration, and start time. Use `trace_get` on any returned trace ID to drill into the span-level breakdown and identify exactly which service or database query is causing the slowdown.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `min_duration_ms` | number | no | `500` | Minimum duration in milliseconds to consider "slow". |
| `seconds_ago` | number | no | `300` | How far back to search in seconds. Default is 5 minutes. |
| `limit` | number | no | `10` | Maximum number of traces to return. Maximum: 50. |

## Response

```json
{
  "traces": [
    {
      "traceId": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "rootService": "pgr-services",
      "rootOperation": "POST /pgr-services/v2/request/_create",
      "durationMs": 4523,
      "startTime": "2026-02-28T10:22:00.000Z"
    },
    {
      "traceId": "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3",
      "rootService": "egov-workflow-v2",
      "rootOperation": "POST /egov-wf/process/_transition",
      "durationMs": 2187,
      "startTime": "2026-02-28T10:23:15.000Z"
    },
    {
      "traceId": "1234567890abcdef1234567890abcdef",
      "rootService": "egov-mdms-service",
      "rootOperation": "POST /mdms-v2/v2/_search",
      "durationMs": 891,
      "startTime": "2026-02-28T10:24:30.000Z"
    }
  ],
  "totalFound": 3,
  "threshold": 500
}
```

## Examples

### Basic Usage

Find slow traces in the last 5 minutes:

```
trace_slow({})
```

Find very slow traces (over 5 seconds):

```
trace_slow({ min_duration_ms: 5000 })
```

Search the last hour for slow traces:

```
trace_slow({ seconds_ago: 3600, limit: 25 })
```

Find traces with moderate latency:

```
trace_slow({ min_duration_ms: 200, limit: 50 })
```

### Performance Investigation Workflow

1. Find the slowest traces: `trace_slow({ min_duration_ms: 1000 })`
2. Pick the slowest one and get details: `trace_get({ trace_id: "a1b2c3d4..." })`
3. Check which service/span accounts for the most time
4. If database queries are slow, check the `db.statement` attribute in the span
5. If a downstream service is slow, follow the call chain

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| No traces found | No traces exceed the duration threshold in the time window | Lower `min_duration_ms` or increase `seconds_ago` |
| Tempo unreachable | Grafana Tempo container not running | Start DIGIT services or check Tempo container |

## See Also

- [trace_debug](trace_debug.md) -- One-call debugger for API failures
- [trace_search](trace_search.md) -- Search traces with full filter options
- [Guide: Debugging](../../guides/debugging.md) -- End-to-end debugging workflow
