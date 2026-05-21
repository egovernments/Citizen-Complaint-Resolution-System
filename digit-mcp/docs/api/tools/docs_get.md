# docs_get

> Fetch the full markdown content of a DIGIT documentation page by URL.

**Group:** `docs` | **Risk:** `read` | **DIGIT Service:** `--`

## Description

Retrieves the complete content of a single documentation page, given its URL. Accepts two types of URLs: standard `https://docs.digit.org/...` URLs for remote documentation pages, and `local://` URLs for bundled documentation files shipped with the MCP server (e.g. `local://ui.md` for the UI building guide).

For remote pages, the tool fetches the page from docs.digit.org and converts it to markdown. For local pages, it reads the bundled file directly. In both cases, the full markdown content is returned along with the page title.

Use `docs_search` first to discover relevant pages and obtain their URLs, then pass those URLs to this tool to read the full content. This is particularly useful when a search snippet is not detailed enough and you need the complete guide or reference material.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | yes | -- | The documentation page URL. Either a `https://docs.digit.org/...` URL or a `local://` URL (e.g. `local://ui.md`) |

## Response

Returns a JSON object with the page title and full markdown content.

```json
{
  "title": "MDMS v2 - Master Data Management Service",
  "content": "# MDMS v2 - Master Data Management Service\n\nMDMS v2 provides a schema-based approach to managing master data...\n\n## Overview\n\n..."
}
```

## Examples

### Basic Usage

Fetch a remote documentation page:

```
docs_get({ url: "https://docs.digit.org/platform/platform/core-services/mdms-v2-master-data-management-service" })
```

Fetch a local bundled guide:

```
docs_get({ url: "local://ui.md" })
```

### Typical Workflow

1. Search for relevant docs:
   ```
   docs_search({ query: "boundary service setup" })
   ```
2. Read the full page from a result:
   ```
   docs_get({ url: "https://docs.digit.org/platform/platform/core-services/boundary-service" })
   ```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Page not found | Invalid or broken URL | Use `docs_search` to find a valid URL |
| Network error | Remote docs.digit.org unreachable | Retry later; use `local://` URLs for bundled docs |
| Invalid URL format | URL is not a docs.digit.org or local:// URL | Provide a valid docs.digit.org URL or a local:// path |

## See Also

- [docs_search](docs_search.md) -- Search documentation to find page URLs
