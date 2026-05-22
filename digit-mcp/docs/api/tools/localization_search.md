# localization_search

> Search localization messages (UI labels) for a tenant, filtered by locale and module.

**Group:** `localization` | **Risk:** `read` | **DIGIT Service:** `egov-localization`

## Description

Queries the DIGIT localization service for translated UI strings matching a given tenant, locale, and optional module filter. Returns the localization code, display message, and module name for each match. Results are capped at the first 100 messages; if there are more, the response includes a `truncated: true` flag.

Localization messages drive all user-facing labels in DIGIT -- department names, complaint type labels, status descriptions, form field labels, and navigation items. Each message is identified by a unique code (e.g. `"DEPT_1"`, `"SERVICEDEFS.STREETLIGHTNOTWORKING"`) within a module (e.g. `"rainmaker-common"`, `"rainmaker-pgr"`). The module parameter is important for narrowing results: without it, all messages across all modules are returned.

Common modules include `"rainmaker-pgr"` for PGR complaint type labels, `"rainmaker-common"` for shared labels like department and designation names, and `"rainmaker-hr"` for HRMS-related strings. Use this tool to verify that UI labels exist before deploying a new complaint type or department, and to audit which translations are already in place.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search localization for (e.g. `"pg"`, `"pg.citya"`) |
| `locale` | string | no | `"en_IN"` | Locale code (e.g. `"en_IN"`, `"hi_IN"`, `"pt_MZ"`) |
| `module` | string | no | -- | Module filter (e.g. `"rainmaker-pgr"`, `"rainmaker-common"`) |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "locale": "en_IN",
  "module": "rainmaker-pgr",
  "count": 3,
  "messages": [
    {
      "code": "SERVICEDEFS.STREETLIGHTNOTWORKING",
      "message": "Street Light Not Working",
      "module": "rainmaker-pgr"
    },
    {
      "code": "SERVICEDEFS.GARBAGENOTCOLLECTED",
      "message": "Garbage Not Collected",
      "module": "rainmaker-pgr"
    },
    {
      "code": "SERVICEDEFS.DAMAGEDROAD",
      "message": "Damaged Road",
      "module": "rainmaker-pgr"
    }
  ],
  "truncated": false
}
```

When results exceed 100 messages:

```json
{
  "success": true,
  "tenantId": "pg",
  "locale": "en_IN",
  "module": "(all)",
  "count": 100,
  "messages": [ ... ],
  "truncated": true
}
```

## Examples

### Basic Usage

List all PGR complaint type labels for a tenant:

```
localization_search({
  tenant_id: "pg",
  module: "rainmaker-pgr"
})
```

### Search Common Labels

Find department and designation labels:

```
localization_search({
  tenant_id: "pg",
  module: "rainmaker-common"
})
```

### Search All Modules

Retrieve all localization messages (first 100) across all modules:

```
localization_search({ tenant_id: "pg" })
```

### Check a Specific Locale

Verify Hindi translations exist:

```
localization_search({
  tenant_id: "pg",
  locale: "hi_IN",
  module: "rainmaker-pgr"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `count: 0` with valid module | No messages registered for this module/locale | Create labels with `localization_upsert` |
| `truncated: true` | More than 100 messages match | Narrow with the `module` parameter to get specific results |

## See Also

- [localization_upsert](localization_upsert.md) -- create or update localization messages
- [Guide: City Setup](../../guides/city-setup.md) -- city setup includes creating localization labels for new complaint types and departments
