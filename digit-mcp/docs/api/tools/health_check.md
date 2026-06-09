# health_check

> Probe all DIGIT platform services and report their health status and response times.

**Group:** `core` | **Risk:** `read` | **DIGIT Service:** all (probes 11 services)

## Description

The `health_check` tool sends lightweight probe requests to each DIGIT platform service and reports whether it is healthy, unhealthy, or skipped. It probes 11 services: MDMS v2, Boundary Service, HRMS, Localization, PGR Services, Workflow v2, Filestore, Access Control, ID Generation, Location, and Encryption.

Each probe is a minimal API request -- for example, an MDMS search with `limit: 1`, or a PGR search with `limit: 1`. A service is considered "healthy" if it returns HTTP 200, 400, or 403 (the latter two indicate the service is up but rejected the probe input). A service is "unhealthy" if it returns any other status code, times out, or is unreachable.

Services that require authentication (all except Encryption) are skipped if you have not called `configure` first. The Encryption service (`egov-enc-service`) is always probed because it does not require an auth token.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | No | Environment's state tenant | Tenant ID used in probe requests. Defaults to the current state tenant (e.g. `"pg"`). |
| `timeout_ms` | number | No | `10000` | Timeout per service probe in milliseconds. Probes that exceed this are marked unhealthy with a timeout error. |

## Response

Returns a summary with counts and per-service detail.

```json
{
  "success": true,
  "environment": "Chakshu Dev",
  "baseUrl": "https://api.egov.theflywheel.in",
  "tenantId": "pg",
  "authenticated": true,
  "summary": {
    "total": 11,
    "healthy": 10,
    "unhealthy": 0,
    "skipped": 1
  },
  "services": [
    {
      "service": "egov-mdms-service",
      "name": "MDMS v2",
      "status": "healthy",
      "responseTimeMs": 142,
      "statusCode": 200
    },
    {
      "service": "boundary-service",
      "name": "Boundary Service",
      "status": "healthy",
      "responseTimeMs": 89,
      "statusCode": 200
    },
    {
      "service": "egov-hrms",
      "name": "HRMS",
      "status": "healthy",
      "responseTimeMs": 203,
      "statusCode": 200
    },
    {
      "service": "egov-localization",
      "name": "Localization",
      "status": "healthy",
      "responseTimeMs": 67,
      "statusCode": 200
    },
    {
      "service": "pgr-services",
      "name": "PGR Services",
      "status": "healthy",
      "responseTimeMs": 156,
      "statusCode": 200
    },
    {
      "service": "egov-workflow-v2",
      "name": "Workflow v2",
      "status": "healthy",
      "responseTimeMs": 98,
      "statusCode": 200
    },
    {
      "service": "egov-filestore",
      "name": "Filestore",
      "status": "healthy",
      "responseTimeMs": 45,
      "statusCode": 400
    },
    {
      "service": "egov-accesscontrol",
      "name": "Access Control",
      "status": "healthy",
      "responseTimeMs": 112,
      "statusCode": 200
    },
    {
      "service": "egov-idgen",
      "name": "ID Generation",
      "status": "healthy",
      "responseTimeMs": 78,
      "statusCode": 200
    },
    {
      "service": "egov-location",
      "name": "Location",
      "status": "healthy",
      "responseTimeMs": 134,
      "statusCode": 200
    },
    {
      "service": "egov-enc-service",
      "name": "Encryption",
      "status": "healthy",
      "responseTimeMs": 23,
      "statusCode": 200
    }
  ]
}
```

### When not authenticated

Auth-required services are skipped:

```json
{
  "service": "egov-mdms-service",
  "name": "MDMS v2",
  "status": "skipped",
  "responseTimeMs": 0,
  "error": "Not authenticated \u2014 call configure first"
}
```

### Unhealthy service

```json
{
  "service": "pgr-services",
  "name": "PGR Services",
  "status": "unhealthy",
  "responseTimeMs": 10001,
  "error": "Timeout after 10000ms"
}
```

## Examples

### Basic Usage -- check all services

```
Tool: health_check
Args: {}
```

### With custom timeout for slow environments

```
Tool: health_check
Args: {
  "timeout_ms": 30000
}
```

### Probe against a specific tenant

```
Tool: health_check
Args: {
  "tenant_id": "statea"
}
```

Uses `"statea"` in all probe requests. Useful to verify services respond correctly for a non-default state root.

## Errors

The `health_check` tool itself always succeeds (`"success": true`). Individual services report their own errors in the `services` array. Common per-service errors:

| Error | Cause | Fix |
|-------|-------|-----|
| `"Not authenticated -- call configure first"` | Service requires auth but no token is set. | Call `configure` before running health check if you want to probe all services. |
| `"Timeout after Nms"` | Service did not respond within the timeout. | Increase `timeout_ms`, or check if the DIGIT Docker environment is running (`docker compose ps`). |
| `"HTTP 502"` or `"HTTP 503"` | Service is down or the reverse proxy cannot reach it. | Check Docker container status. The service may need to be restarted. |
| `"fetch failed"` / connection errors | The API URL is unreachable. | Verify the environment URL and network connectivity. |

## See Also

- [configure](configure.md) -- authenticate first so all services are probed (not skipped)
- [get_environment_info](get_environment_info.md) -- check which environment and URL are configured
