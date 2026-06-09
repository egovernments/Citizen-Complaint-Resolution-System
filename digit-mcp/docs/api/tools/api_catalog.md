# api_catalog

> Get the complete DIGIT platform API catalog as an OpenAPI 3.0 specification covering 14 services and 37 endpoints.

**Group:** `docs` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Returns the full DIGIT platform API catalog in OpenAPI 3.0 format. The catalog covers all 14 core services: Auth, User, MDMS, Boundary, Boundary Management, HRMS, PGR, Workflow, Localization, Filestore, Access Control, ID Generation, Location, and Encryption. Together these expose 37 API endpoints.

Two output formats are available. The `summary` format returns a compact listing of all services and their endpoints, suitable for quick reference and discovering available APIs. The `openapi` format returns the full OpenAPI 3.0 JSON specification including request/response schemas, parameter definitions, and data models. The full spec is useful for UI developers building integrations or agents constructing API calls programmatically.

You can optionally filter by a single service name to get only that service's endpoints, which keeps the output focused when you already know which service you need.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `service` | string | no | -- | Filter by service name (case-insensitive). Options: `Auth`, `User`, `MDMS`, `Boundary`, `Boundary Management`, `HRMS`, `PGR`, `Workflow`, `Localization`, `Filestore`, `Access Control`, `ID Generation`, `Location`, `Encryption`. Omit for all services. |
| `format` | string | no | `"summary"` | Output format. `"summary"` returns a compact endpoint listing. `"openapi"` returns the full OpenAPI 3.0 JSON spec with schemas. |

## Response

### Summary Format

```json
{
  "format": "summary",
  "serviceCount": 14,
  "endpointCount": 37,
  "services": [
    {
      "name": "PGR",
      "endpoints": [
        "POST /pgr-services/v2/request/_create",
        "POST /pgr-services/v2/request/_search",
        "POST /pgr-services/v2/request/_update"
      ]
    },
    {
      "name": "Workflow",
      "endpoints": [
        "POST /egov-workflow-v2/egov-wf/businessservice/_search",
        "POST /egov-workflow-v2/egov-wf/process/_search",
        "POST /egov-workflow-v2/egov-wf/businessservice/_create"
      ]
    }
  ]
}
```

### OpenAPI Format

Returns a full OpenAPI 3.0 JSON object with `info`, `servers`, `paths`, `components/schemas`, etc.

## Examples

### Basic Usage

Get a quick overview of all available APIs:

```
api_catalog({})
```

Get only PGR service endpoints:

```
api_catalog({ service: "PGR" })
```

Get the full OpenAPI spec for the Workflow service:

```
api_catalog({ service: "Workflow", format: "openapi" })
```

Get the complete OpenAPI specification for all services:

```
api_catalog({ format: "openapi" })
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Unknown service | The `service` parameter does not match any known service name | Check spelling; use the summary format without a filter to see all service names |

## See Also

- [docs_search](docs_search.md) -- Search documentation for guides and references
- [health_check](health_check.md) -- Check if DIGIT services are running and reachable
