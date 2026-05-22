# session_checkpoint

> Record a progress checkpoint summarizing what has been accomplished so far in the session.

**Group:** `core` | **Risk:** `write` | **DIGIT Service:** --

## Description

The `session_checkpoint` tool persists a summary of progress at a point in time. It is designed to be called periodically -- roughly every 5-10 tool calls -- to create a trail of what was accomplished during the session. Checkpoints are written to both a JSONL file on disk (`data/events.jsonl`) and a PostgreSQL database (if available).

Each checkpoint captures the summary text, the sequence number within the session, a timestamp, and the list of recently called tools (up to the last 20). The session's internal nudge counter is reset after each checkpoint, so the server can remind the LLM agent to checkpoint again after another 8 non-session tool calls.

Optionally, full conversation turns (messages) can be included. These are persisted separately in the `messages` table for later retrieval by a session viewer or replay tool.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `summary` | string | yes | -- | What was accomplished since the last checkpoint (or session start). Be specific: mention tenant codes, service names, errors resolved, counts of records created. |
| `messages` | array | no | -- | Conversation turns to persist. Each element has `turn` (integer sequence number), `role` (`"user"`, `"assistant"`, or `"tool_result"`), and `content` (array of Anthropic content blocks). |

### Messages element schema

```json
{
  "turn": 5,
  "role": "assistant",
  "content": [{ "type": "text", "text": "Created 3 employees on pg.citya." }]
}
```

## Response

Returns checkpoint metadata and current session statistics.

```json
{
  "success": true,
  "checkpoint": {
    "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "seq": 14,
    "ts": "2026-02-28T10:30:00.000Z",
    "summary": "Bootstrapped tenant 'ke', created city ke.nairobi with boundaries, created 2 GRO employees.",
    "recentTools": [
      "configure",
      "tenant_bootstrap",
      "city_setup",
      "employee_create",
      "employee_create",
      "validate_employees"
    ]
  },
  "session": {
    "toolCount": 14,
    "checkpointCount": 2,
    "errorCount": 0
  }
}
```

## Examples

### Basic Usage

```
Tool: session_checkpoint
Args: {
  "summary": "Authenticated to chakshu-digit as ADMIN. Validated pg.citya tenant exists. Checked complaint types -- 5 active service definitions found."
}
```

### With conversation messages

```
Tool: session_checkpoint
Args: {
  "summary": "Created PGR complaint PB-PGR-2026-02-28-000042 for StreetLightNotWorking in pg.citya. Assigned to employee UUID abc-123.",
  "messages": [
    {
      "turn": 1,
      "role": "user",
      "content": [{ "type": "text", "text": "File a streetlight complaint in pg.citya" }]
    },
    {
      "turn": 2,
      "role": "assistant",
      "content": [{ "type": "text", "text": "I'll create a PGR complaint for a broken streetlight." }]
    }
  ]
}
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `"Summary is required"` | The `summary` parameter was empty or whitespace-only. | Provide a non-empty summary describing what was accomplished. |
| `"No active session"` | No session has been initialized. | Call `init` first, or make any tool call (sessions are auto-created on first tool invocation). |

## See Also

- [init](init.md) -- initialize the session (sets user context and enables tool groups)
