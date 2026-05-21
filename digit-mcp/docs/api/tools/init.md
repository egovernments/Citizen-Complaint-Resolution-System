# init

> Initialize a DIGIT MCP session, mapping user intent to relevant tool groups.

**Group:** `core` | **Risk:** `write` | **DIGIT Service:** --

## Description

The `init` tool is the recommended starting point for every DIGIT MCP conversation. It creates a session context, records the user's name and purpose, and auto-enables the tool groups most relevant to their stated intent.

Intent keywords in the `purpose` string are matched against an internal map. For example, mentioning "pgr" or "complaint" enables the `pgr`, `masters`, `admin`, and `boundary` groups. Mentioning "employee" or "hrms" enables `employees`, `masters`, and `admin`. The `docs` group is always enabled regardless of intent. If no keywords match, only `docs` is added (beyond the always-on `core` group).

After init completes, the response includes suggested next steps tailored to the purpose. Typically the next call should be `configure` to authenticate with the DIGIT environment. Session telemetry (checkpoint tracking, JSONL persistence, database integration) is enabled by default and can be disabled by setting `telemetry` to false.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `purpose` | string | yes | -- | What the user wants to accomplish. Keywords like "pgr", "complaint", "employee", "tenant", "debug", "monitor", "trace", "boundary", "localization", "encrypt", "api", "all" trigger group auto-enable. |
| `user_name` | string | no | `"anonymous"` | Name of the user, used for session attribution in logs and checkpoints. |
| `telemetry` | boolean | no | `true` | Whether to enable session telemetry (JSONL event logging, DB persistence, viewer integration). |

## Response

Returns a JSON object with session metadata, enabled groups, and suggested next steps.

```json
{
  "success": true,
  "session": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "userName": "chakshu",
    "purpose": "set up PGR for a new tenant",
    "telemetry": true
  },
  "enabledGroups": ["core", "pgr", "masters", "admin", "boundary", "docs"],
  "toolCount": "32 of 59 tools now enabled",
  "suggestedNextSteps": [
    "Use configure to connect to the DIGIT environment",
    "Use validate_complaint_types to check available complaint types",
    "Use pgr_create to file a complaint"
  ]
}
```

## Examples

### Basic Usage -- PGR workflow

```
Tool: init
Args: {
  "user_name": "chakshu",
  "purpose": "set up PGR complaints for a new city"
}
```

Response enables: `core`, `pgr`, `masters`, `admin`, `boundary`, `docs`.

### Advanced Usage -- enable everything

```
Tool: init
Args: {
  "purpose": "explore all available tools",
  "telemetry": false
}
```

When the purpose contains "all", every non-core group is enabled. Setting `telemetry` to false disables session persistence.

### Debugging intent

```
Tool: init
Args: {
  "user_name": "dev",
  "purpose": "debug a failing PGR complaint and trace the API call"
}
```

Keywords "debug", "trace", and "pgr" are all matched, enabling: `monitoring`, `tracing`, `pgr`, `masters`, `admin`, `boundary`, `docs`.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `purpose` missing | The `purpose` parameter was not provided. | Always pass a purpose string describing the user's intent. |

The `init` tool does not call any DIGIT APIs, so network/auth errors do not apply. It will succeed even if the DIGIT environment is unreachable.

## See Also

- [configure](configure.md) -- authenticate with a DIGIT environment (typically the next step after init)
- [discover_tools](discover_tools.md) -- see all available tool groups and their contents
- [session_checkpoint](session_checkpoint.md) -- record progress during the session
- [enable_tools](enable_tools.md) -- manually enable/disable groups after init
