# WhatsApp Notification System – Setup Guide

A step-by-step guide to set up end-to-end WhatsApp notifications. This system is **module-agnostic** — any module that publishes domain events to Kafka can trigger WhatsApp messages.

---

## Architecture

```
                                          ┌──────────────┐
                                  ┌──────▶│ user-        │
                                  │  ①    │ preferences  │
                                  │       └──────────────┘
                                  │       (consent check)
┌────────────┐   Kafka         ┌──┴───────────┐           ┌──────────────┐
│ Your       │───────────────▶ │  novu-bridge  │──────────▶│ config-      │
│ Module     │  domain events  │               │  ②        │ service      │
└────────────┘                 └───────┬───────┘ /_resolve └──────────────┘
                                       │
                                       │ ③ /v1/events/trigger
                                       ▼
                                 ┌───────────┐   Twilio   ┌───────────┐
                                 │   Novu    │───────────▶│ WhatsApp  │
                                 │ (self-    │  Content   │ user      │
                                 │  hosted)  │  Template  └───────────┘
                                 └───────────┘
```

| Component | Responsibility |
|-----------|----------------|
| **Your Module** | Publishes domain events to a Kafka topic on state changes |
| **novu-bridge** | Consumes events, resolves templates, checks consent, triggers Novu |
| **config-service** | Stores template bindings (which event maps to which template) |
| **user-preferences** | Stores per-user channel consent; novu-bridge skips sending if consent is not granted |
| **Novu** (self-hosted) | Notification orchestration; routes to Twilio SMS provider |
| **Twilio** | Delivers WhatsApp messages via Content Templates |

---

## Prerequisites

- **PostgreSQL** — databases: `configdb` (config-service), `egov` (novu-bridge)
- **Kafka / Redpanda** — running and reachable
- **Novu self-hosted** — API and dashboard running ([self-hosting docs](https://docs.novu.co/community/self-hosting-novu))
- **Twilio account** — with Account SID, Auth Token, and a WhatsApp-enabled sender number
- **DIGIT platform services** — User service, MDMS v2, Preference service

---

## Step 1 – Bootstrap Novu

### Fill the environment file

Copy and edit the template at `novu-bridge/config/.env.novu`:

```bash
NOVU_BASE_URL=http://localhost:3000
NOVU_API_KEY=<your-novu-api-key>

TWILIO_ACCOUNT_SID=<your-twilio-account-sid>
TWILIO_AUTH_TOKEN=<your-twilio-auth-token>
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

NOVU_ENV_NAME=digit-dev
NOVU_WORKFLOW_ID=complaints-whatsapp-v1
NOVU_EVENT_WORKFLOWS=COMPLAINTS.WORKFLOW.APPLY,COMPLAINTS.WORKFLOW.ASSIGN,COMPLAINTS.WORKFLOW.RESOLVE
```

### Run the bootstrap script

```bash
cd novu-bridge/config
NOVU_ENV_FILE=.env.novu bash bootstrap-novu-whatsapp.sh
```

This creates the Novu environment, Twilio integration, and one workflow per event listed in `NOVU_EVENT_WORKFLOWS`.

> **Alternative:** Import the Postman collection `novu-bridge/config/Novu-Bootstrap.postman_collection.json` and run requests in sequence.

### Verify

```bash
# Workflows exist
curl -s "$NOVU_BASE_URL/v2/workflows?limit=100" \
  -H "Authorization: ApiKey $NOVU_API_KEY" | jq '.workflows[].workflowId'
```

---

## Step 2 – Start Config Service

Build and start with your database connection:

```bash
java -jar digit-config-service/target/digit-config-service-*.jar \
  --server.port=9000 \
  --spring.datasource.url=jdbc:postgresql://<host>:<port>/configdb \
  --spring.flyway.url=jdbc:postgresql://<host>:<port>/configdb
```

Flyway auto-creates the `eg_config_data` table on first startup.

> **Key:** novu-bridge expects config-service at the host/port configured in `novu.bridge.config.host`. Make sure they match.

---

## Step 3 – Register an MDMS v2 Schema

If MDMS v2 validation is enabled (the default), register a schema so config-service can validate data before storing it. Here is an example for `TemplateBinding`:

```bash
curl -s -X POST "<MDMS_HOST>/egov-mdms-service/schema/v1/_create" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {
      "apiId": "config-setup",
      "ver": "1.0",
      "ts": 0,
      "msgId": "schema-setup-001",
      "userInfo": {
        "uuid": "system",
        "id": 0,
        "roles": [{ "code": "SUPERUSER", "tenantId": "pg" }],
        "tenantId": "pg"
      }
    },
    "SchemaDefinition": {
      "tenantId": "pg",
      "code": "TemplateBinding",
      "description": "Maps a domain event to a Novu workflow + Twilio content template",
      "definition": {
        "type": "object",
        "properties": {
          "eventName":    { "type": "string" },
          "templateId":   { "type": "string" },
          "contentSid":   { "type": "string", "pattern": "^HX[a-fA-F0-9]{32}$" },
          "paramOrder":   { "type": "array", "items": { "type": "string" } },
          "requiredVars": { "type": "array", "items": { "type": "string" } },
          "novuApiKey":   { "type": "string" }
        },
        "required": ["eventName", "templateId", "contentSid", "paramOrder"],
        "x-unique": ["eventName"]
      },
      "isActive": true
    }
  }'
```

**Fields explained:**

| Field | Description |
|-------|-------------|
| `eventName` | Domain event name, e.g. `COMPLAINTS.WORKFLOW.APPLY` |
| `templateId` | Novu workflow ID to trigger |
| `contentSid` | Twilio Content Template SID (starts with `HX`) |
| `paramOrder` | Ordered variable names mapped to Twilio `{{1}}`, `{{2}}`, etc. |
| `requiredVars` | Variables that must be present in the event data |
| `novuApiKey` | Optional per-event Novu API key override |

> Use the same pattern to register additional schemas like `ProviderDetail` or `NotificationChannel` if needed.

---

## Step 4 – Seed Config Data

Create a TemplateBinding record for each event that should trigger a WhatsApp message. Here is one example:

```bash
curl -s -X POST "http://<config-service-host>/config-service/config/v1/_create/TemplateBinding" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {
      "apiId": "config-seed",
      "ver": "1.0",
      "ts": 0,
      "msgId": "seed-001",
      "userInfo": { "uuid": "system", "tenantId": "pg" }
    },
    "configData": {
      "tenantId": "*",
      "data": {
        "eventName": "COMPLAINTS.WORKFLOW.APPLY",
        "templateId": "complaints-whatsapp-v1",
        "contentSid": "HX158f8edc7079e2c2b76d9c8f68e87791",
        "paramOrder": ["serviceName", "complaintNo", "status", "citizenName", "departmentName"],
        "requiredVars": ["complaintNo", "status", "serviceName", "citizenName", "departmentName"]
      },
      "isActive": true
    }
  }'
```

- `tenantId: "*"` makes this a catch-all for all tenants. Use a specific tenant for scoped overrides.
- Repeat for each event (e.g. `COMPLAINTS.WORKFLOW.ASSIGN`, `COMPLAINTS.WORKFLOW.RESOLVE`, etc.).
- The `paramOrder` must match the positional `{{1}}`, `{{2}}`, ... variables in your Twilio Content Template.

---

## Step 5 – Create Twilio Content Templates

1. Go to **Twilio Console → Content → Content Templates**
2. Create a WhatsApp template with positional variables:
   ```
   Hi {{1}}, your complaint {{2}} for {{3}} is now {{4}}.
   ```
3. Submit for approval and copy the **Content SID** (e.g. `HX158f8edc7079e2c2b76d9c8f68e87791`)
4. Make sure the `paramOrder` in your TemplateBinding matches the variable positions:

| Twilio var | paramOrder index | Domain variable |
|-----------|------------------|-----------------|
| `{{1}}` | 0 | `citizenName` |
| `{{2}}` | 1 | `complaintNo` |
| `{{3}}` | 2 | `serviceName` |
| `{{4}}` | 3 | `status` |

---

## Step 6 – Start novu-bridge

Build and run:

```bash
cd novu-bridge && mvn -q -DskipTests package && cd ..

NOVU_API_KEY=<your-novu-api-key> \
java -jar novu-bridge/target/novu-bridge-*.jar
```

Key properties to configure (in `application.properties` or via `--` overrides):

| Property | Description |
|----------|-------------|
| `spring.kafka.bootstrap-servers` | Kafka broker address |
| `novu.bridge.kafka.input.topic` | Topic to consume domain events from |
| `novu.bridge.config.host` | Config-service base URL |
| `novu.bridge.user.host` | User service base URL |
| `novu.bridge.preference.host` | Preference service base URL |
| `novu.base.url` | Novu API base URL |
| `novu.api.key` | Novu API key (prefer `NOVU_API_KEY` env var) |
| `spring.datasource.url` | novu-bridge database JDBC URL |

Create the Kafka topics if they don't exist:

```bash
rpk topic create <your-input-topic> novu-bridge.retry novu-bridge.dlq --brokers <broker>
```

Flyway auto-creates the `nb_dispatch_log` table on first startup.

---

## Step 7 – Set Up User Preferences

novu-bridge checks whether the user has granted WhatsApp consent before sending. Create a preference:

```bash
curl -s -X POST "http://<preference-service-host>/user-preferences/v1/_create" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {
      "apiId": "preferences",
      "ver": "1.0",
      "ts": 0,
      "msgId": "pref-setup",
      "userInfo": { "uuid": "<user-uuid>", "tenantId": "pg.citya" }
    },
    "preference": {
      "userId": "<user-uuid>",
      "tenantId": "pg.citya",
      "channels": {
        "WHATSAPP": { "consent": "GRANTED", "locale": "en_IN" }
      }
    }
  }'
```

To skip preference checks during development, set `novu.bridge.preference.enabled=false`.

---

## Step 8 – Publish Domain Events from Your Module

Any module can trigger WhatsApp notifications by publishing a domain event to the configured Kafka topic. The event must follow this structure:

```json
{
  "eventId": "<unique-id>",
  "eventType": "DOMAIN_EVENT",
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",
  "tenantId": "pg.citya",
  "module": "Complaints",
  "entityType": "COMPLAINT",
  "entityId": "<entity-id>",
  "workflow": { "toState": "PENDINGFORASSIGNMENT" },
  "stakeholders": [
    { "mobile": "9123456789", "userId": "<user-uuid>", "type": "CITIZEN" }
  ],
  "data": {
    "complaintNo": "CMP-001",
    "status": "PENDINGFORASSIGNMENT",
    "serviceName": "POTHOLE",
    "citizenName": "Jane Doe",
    "departmentName": "Public Works"
  }
}
```

**Required fields:** `eventId`, `eventType`, `eventName`, `tenantId`, `workflow.toState`

The `data` map must include all variables listed in the TemplateBinding's `requiredVars`.

---

## Verification & Debugging

### Diagnostic endpoints

novu-bridge exposes three endpoints at `/novu-bridge/novu-adapter/v1/dispatch`:

| Endpoint | What it does |
|----------|-------------|
| `POST /_validate` | Validates the event through the full pipeline without sending |
| `POST /_dry-run?send=true` | Full pipeline with actual Novu trigger |
| `POST /_test-trigger` | Direct Novu trigger bypassing config and preference checks |

### Quick health checks

```bash
# Check dispatch log for recent events
psql -d egov -c "SELECT event_name, status, last_error_code FROM nb_dispatch_log ORDER BY created_time DESC LIMIT 5;"

# Inspect dead-letter queue
rpk topic consume novu-bridge.dlq --brokers <broker> --num 5

# Check Novu activity feed
curl -s "$NOVU_BASE_URL/v1/notifications?page=0&limit=5" \
  -H "Authorization: ApiKey $NOVU_API_KEY" | jq '.data[0]'
```

### Common issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Config not found | No TemplateBinding for this eventName | Seed config data (Step 4) |
| Preference denied | User hasn't opted in | Create preference (Step 7) or disable check |
| Missing required vars | Event `data` lacks variables from `requiredVars` | Ensure your module populates all fields |
| Novu trigger failed | Wrong API key or workflow doesn't exist | Re-run bootstrap (Step 1) |
| paramOrder required | `contentSid` set but `paramOrder` missing | Add `paramOrder` to the TemplateBinding |
