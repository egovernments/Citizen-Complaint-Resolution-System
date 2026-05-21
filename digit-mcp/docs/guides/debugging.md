# Debugging & Monitoring

> Trace API failures, find slow requests, and monitor platform health using distributed tracing and monitoring probes.

## Prerequisites

- Authenticated via [`configure`](../api/tools/configure.md)
- Tool groups enabled: `tracing`, `monitoring`
- DIGIT Docker stack running locally (for monitoring probes)

```
enable_tools({ enable: ["monitoring", "tracing"] })
```

## Service Health

Before diving into traces or logs, verify that DIGIT services are running. Call [`health_check`](../api/tools/health_check.md):

```json
{}
```

This probes all 11 DIGIT services and reports their status and response time. If a service shows `"unhealthy"`, fix the infrastructure issue first -- tracing and monitoring will not help if the service is down.

---

## Quick Debug: API Call Failed

When an API call fails, use [`trace_debug`](../api/tools/trace_debug.md) immediately:

```json
{
  "service_name": "pgr-services",
  "operation": "_create",
  "seconds_ago": 60
}
```

This composite tool finds the most recent matching trace and returns:
- Full error analysis across all services involved
- Service call chain (e.g. PGR → Workflow → Persister → DB)
- Error spans with HTTP status codes, error messages
- Grafana link for visual exploration

Example response (abbreviated):

```json
{
  "found": true,
  "traceId": "3a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d",
  "errors": [
    "egov-workflow-v2: POST /process/_transition → 500 (BusinessService not found for PGR)"
  ],
  "spanSummary": {
    "total": 12,
    "byService": { "pgr-services": 4, "egov-workflow-v2": 5, "egov-persister": 3 },
    "errors": 1
  },
  "grafanaUrl": "http://localhost:3000/explore?traceId=3a2b1c4d..."
}
```

The `errors` array pinpoints which service and operation failed. The `grafanaUrl` opens the trace in Grafana for a visual span waterfall.

> **Grafana access:** For local Docker setups, Grafana is typically available at `http://localhost:3000`. Navigate to Explore and select the Tempo data source to search and visualize traces.

## Tracing Workflow

### 1. Check Infrastructure

Call [`tracing_health`](../api/tools/tracing_health.md) first to verify tracing is working:
- Grafana Tempo (trace storage)
- OpenTelemetry Collector (trace collection)
- Grafana (visualization UI)

### 2. Search for Traces

Call [`trace_search`](../api/tools/trace_search.md):
```json
{
  "service_name": "egov-workflow-v2",
  "min_duration_ms": 100,
  "seconds_ago": 300
}
```
Returns matching traces with traceId, root service, operation, duration.

### 3. Inspect a Trace

Call [`trace_get`](../api/tools/trace_get.md):
```json
{ "trace_id": "abc123def456..." }
```
Returns spans grouped by service, error spans highlighted, duration breakdown, Grafana link.

### 4. Find Slow Requests

Call [`trace_slow`](../api/tools/trace_slow.md):
```json
{ "min_duration_ms": 500, "seconds_ago": 600 }
```
Returns traces sorted by duration (slowest first).

## Monitoring Workflow

### Quick Health Check

Call [`persister_monitor`](../api/tools/persister_monitor.md) for a comprehensive check:
```json
{ "tenant_id": "pg.citya" }
```

Runs 5 probes:
1. **Kafka consumer lag** — Is the persister keeping up?
2. **Persister error logs** — Any errors in the last 5 minutes?
3. **DB row counts** — Are records being persisted?
4. **Kafka-vs-DB delta** — Lag exists but DB isn't changing? Data loss.
5. **PGR-Workflow parity** — Same number of complaints and workflow instances?

Status: OK (all clear), WARN (minor issues), CRITICAL (action needed).

### Individual Probes

**Kafka Lag** — [`kafka_lag`](../api/tools/kafka_lag.md):
No params. Checks egov-persister consumer group via Redpanda rpk.
- OK: lag = 0
- WARN: lag 1-100
- CRITICAL: lag > 100

**Persister Errors** — [`persister_errors`](../api/tools/persister_errors.md):
```json
{ "since": "15m" }
```
Scans Docker logs. Categories: DataIntegrityViolation, CommitFailed, ListenerExecutionFailed, Rollback, etc.

**DB Row Counts** — [`db_counts`](../api/tools/db_counts.md):
No params. Queries key tables (eg_pgr_service_v2, eg_wf_processinstance_v2, etc.). Tracks delta from previous call.

## Correlating Issues

**Scenario: Complaints created but not persisted**
1. `pgr_create` succeeds (returns service request ID)
2. `pgr_search` returns nothing
3. Check `kafka_lag` — high lag means persister is behind
4. Check `persister_errors` — look for DataIntegrityViolation
5. Check `db_counts` — delta should be 0 if nothing persisted

**Scenario: Slow API responses**
1. `trace_slow` with min_duration_ms 1000
2. `trace_get` on the slowest trace
3. Look at span durations — which service is the bottleneck?
4. Common culprits: large MDMS queries, workflow state lookups, DB connection pool exhaustion

**Scenario: Workflow state mismatch**
1. `persister_monitor` with parity probe shows PGR count != workflow count
2. `pgr_search` shows complaint in wrong state
3. `workflow_process_search` to see actual transitions
4. `trace_debug` on egov-workflow-v2 to find the failure

## What's Next

- [PGR Complaint Lifecycle](pgr-lifecycle.md) — Understand the workflow being debugged
- [Architecture: Observability](../architecture.md#8-observability) — How tracing is built
- [API Reference: Tracing Tools](../api/README.md#tracing-tracing) — Detailed tool docs
- [API Reference: Monitoring Tools](../api/README.md#monitoring-monitoring) — Detailed tool docs
