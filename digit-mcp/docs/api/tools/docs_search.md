# docs_search

> Search DIGIT documentation at docs.digit.org and local bundled docs for guides, API references, configuration details, and how-to articles.

**Group:** `docs` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Searches the DIGIT documentation corpus for content matching a query string. The search covers two sources: local documentation files bundled with the MCP server (keyword matching against files in the `docs/` directory), and remote documentation hosted at docs.digit.org. Results from both sources are combined and returned together.

Local docs include bundled guides such as the UI building guide (`local://ui.md`) and API pattern references. Remote docs cover all DIGIT modules: platform core services, PGR, works, sanitation, health, local governance, and public finance. Each result includes a title, a URL (either a `local://` URL for bundled docs or a full `https://docs.digit.org/...` URL for remote docs), and a content snippet.

Use this tool as the starting point when you need to understand how a DIGIT feature works, find configuration instructions, or locate API documentation. Follow up with `docs_get` to read the full content of any result.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | -- | Search query (e.g. "persister configuration", "PGR complaint workflow", "MDMS schema setup", "UI components") |

## Response

Returns a JSON object containing an array of search results.

```json
{
  "results": [
    {
      "title": "MDMS v2 - Master Data Management Service",
      "url": "https://docs.digit.org/platform/platform/core-services/mdms-v2-master-data-management-service",
      "snippet": "MDMS v2 provides a schema-based approach to managing master data across tenants..."
    },
    {
      "title": "UI Building Guide",
      "url": "local://ui.md",
      "snippet": "This guide covers building frontend components for the DIGIT platform..."
    }
  ]
}
```

## Examples

### Basic Usage

Search for PGR workflow documentation:

```
docs_search({ query: "PGR complaint workflow" })
```

Search for information about persister configuration:

```
docs_search({ query: "persister configuration kafka topics" })
```

Search for UI development guides:

```
docs_search({ query: "build PGR frontend" })
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Empty results | No matching documentation found | Try broader or alternative search terms |
| Network error | Remote docs.digit.org unreachable | Local docs still returned; retry for remote results |

## See Also

- [docs_get](docs_get.md) -- Fetch the full content of a documentation page
- [api_catalog](api_catalog.md) -- Browse the complete DIGIT API specification
