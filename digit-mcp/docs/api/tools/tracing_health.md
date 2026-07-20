# tracing_health

> Check the health of the distributed tracing infrastructure: Grafana Tempo, OpenTelemetry Collector, and Grafana.

**Group:** `tracing` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Verifies that the distributed tracing infrastructure is operational by probing three components: Grafana Tempo (the trace storage backend), the OpenTelemetry Collector (which receives and forwards spans from instrumented services), and Grafana (the web UI for exploring traces). Each component is checked for reachability and basic health.

In addition to component status, the tool reports the number of traces that Tempo has indexed. This gives a quick sense of whether tracing data is actually flowing through the pipeline. If the trace count is zero despite services being active, it indicates a configuration problem in the OpenTelemetry Collector or the service instrumentation.

Always call this tool first before using `trace_search`, `trace_get`, or `trace_debug`. If the tracing infrastructure is down, those tools will not return useful results. This tool does not require DIGIT authentication.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| *(none)* | | | | |

## Response

```json
{
  "components": {
    "tempo": {
      "status": "healthy",
      "url": "http://localhost:3200",
      "traceCount": 1542
    },
    "otel_collector": {
      "status": "healthy",
      "url": "http://localhost:4318"
    },
    "grafana": {
      "status": "healthy",
      "url": "http://localhost:3000"
    }
  },
  "overallStatus": "healthy"
}
```

When a component is down:

```json
{
  "components": {
    "tempo": {
      "status": "unhealthy",
      "url": "http://localhost:3200",
      "error": "Connection refused"
    },
    "otel_collector": {
      "status": "healthy",
      "url": "http://localhost:4318"
    },
    "grafana": {
      "status": "healthy",
      "url": "http://localhost:3000"
    }
  },
  "overallStatus": "degraded"
}
```

## Examples

### Basic Usage

Check tracing infrastructure health:

```
tracing_health({})
```

### Pre-flight Check Before Debugging

Before investigating an API failure with tracing:

1. Verify tracing is working: `tracing_health({})`
2. If healthy, search for traces: `trace_debug({ service_name: "pgr-services" })`
3. If unhealthy, restart services: `cd ~/code/tilt-demo && docker compose -f docker-compose.deploy.yaml restart tempo otel-collector grafana`

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| All components unhealthy | Docker Compose services not running | Start DIGIT services: `cd ~/code/tilt-demo && docker compose -f docker-compose.deploy.yaml up -d` |
| Tempo unhealthy only | Tempo container crashed or OOM | Check Tempo container logs; restart Tempo |
| Zero trace count | OTEL collector not forwarding spans, or services not instrumented | Verify OTEL collector configuration and service JAVA_OPTS include the OTEL agent |

## See Also

- [trace_search](trace_search.md) -- Search for distributed traces
- [trace_debug](trace_debug.md) -- One-call API failure debugger
- [Guide: Debugging](../../guides/debugging.md) -- End-to-end debugging workflow
