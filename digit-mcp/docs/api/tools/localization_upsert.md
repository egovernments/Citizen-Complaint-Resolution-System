# localization_upsert

> Create or update localization messages (UI labels) for a tenant.

**Group:** `localization` | **Risk:** `write` | **DIGIT Service:** `egov-localization`

## Description

Upserts localization messages into the DIGIT localization service. If a message code already exists for the given tenant and locale, it is updated with the new text. If it does not exist, a new message is created. This makes the tool safe for idempotent operations -- calling it multiple times with the same data will not create duplicates.

Each message requires three fields: a `code` (the localization key used by the UI), a `message` (the human-readable translated text), and a `module` (the module namespace the label belongs to). Common modules are `"rainmaker-pgr"` for PGR complaint labels, `"rainmaker-common"` for shared labels like departments and designations, and `"rainmaker-hr"` for HRMS labels.

This tool is typically used after creating new master data -- for example, after adding a new department via `mdms_create`, you would call `localization_upsert` to register a display name so the UI can render it. Similarly, new PGR complaint types need corresponding localization entries under the `"rainmaker-pgr"` module before they appear correctly in the citizen-facing UI.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID (e.g. `"pg"`, `"pg.citya"`) |
| `locale` | string | no | `"en_IN"` | Locale code (e.g. `"en_IN"`, `"hi_IN"`) |
| `messages` | array | yes | -- | Array of message objects to upsert (see schema below) |

### Message Object Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | yes | Localization key (e.g. `"DEPT_HEALTH"`, `"SERVICEDEFS.POTHOLEONROAD"`) |
| `message` | string | yes | Translated display text (e.g. `"Health & Sanitation"`) |
| `module` | string | yes | Module name (e.g. `"rainmaker-common"`, `"rainmaker-pgr"`) |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "locale": "en_IN",
  "upserted": 2,
  "messages": [
    {
      "code": "DEPT_HEALTH",
      "message": "Health & Sanitation",
      "module": "rainmaker-common"
    },
    {
      "code": "SERVICEDEFS.POTHOLEONROAD",
      "message": "Pothole on Road",
      "module": "rainmaker-pgr"
    }
  ]
}
```

## Examples

### Basic Usage

Add a label for a new department:

```
localization_upsert({
  tenant_id: "pg",
  messages: [
    {
      code: "DEPT_99",
      message: "Parks Department",
      module: "rainmaker-common"
    }
  ]
})
```

### Add PGR Complaint Type Labels

Register display names for new complaint types:

```
localization_upsert({
  tenant_id: "pg",
  messages: [
    {
      code: "SERVICEDEFS.POTHOLEONROAD",
      message: "Pothole on Road",
      module: "rainmaker-pgr"
    },
    {
      code: "SERVICEDEFS.WATERLEAK",
      message: "Water Leak",
      module: "rainmaker-pgr"
    }
  ]
})
```

### Multi-language Support

Add Hindi translations alongside English:

```
localization_upsert({
  tenant_id: "pg",
  locale: "hi_IN",
  messages: [
    {
      code: "SERVICEDEFS.STREETLIGHTNOTWORKING",
      message: "सड़क की बत्ती काम नहीं कर रही",
      module: "rainmaker-pgr"
    }
  ]
})
```

### Update an Existing Label

Change the display text of an existing label (same code replaces the message):

```
localization_upsert({
  tenant_id: "pg",
  messages: [
    {
      code: "DEPT_1",
      message: "Street Lighting & Electrical Department",
      module: "rainmaker-common"
    }
  ]
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `messages is required` | Missing or empty messages array | Provide at least one message object with `code`, `message`, and `module` |
| Upsert returns fewer messages than sent | Some messages may have failed silently | Verify with `localization_search` that all expected codes exist |

## See Also

- [localization_search](localization_search.md) -- verify labels exist after upserting
