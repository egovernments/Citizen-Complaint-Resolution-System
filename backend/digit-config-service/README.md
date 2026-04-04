# Config Service (`digit-config-service`)

A schema-validated, tenant-scoped configuration store for the DIGIT platform. It manages template bindings, provider credentials, and notification channel toggles used by the WhatsApp notification system.

## Features

- **Schema validation** against MDMS v2 schemas before storing data
- **Tenant fallback resolution** via `_resolve` API (`pg.citya` -> `pg` -> `*`)
- **Field-level encryption** for sensitive fields (e.g., auth tokens) marked with `x-security` in schema
- **Unique constraint enforcement** via `x-unique` schema fields
- **Flyway-managed** database migrations

## Data Model

**Table:** `eg_config_data`

| Column | Type | Description |
|--------|------|-------------|
| `id` | VARCHAR(64) | Unique record ID |
| `tenantid` | VARCHAR(255) | Tenant this config belongs to |
| `uniqueidentifier` | VARCHAR(255) | Derived from `x-unique` fields in schema |
| `schemacode` | VARCHAR(255) | Schema type (e.g., `TemplateBinding`) |
| `data` | JSONB | Configuration payload |
| `isactive` | BOOLEAN | Whether this record is active |
| `createdby` / `lastmodifiedby` | VARCHAR(64) | Audit fields |
| `createdtime` / `lastmodifiedtime` | BIGINT | Epoch timestamps |

## API Endpoints

**Base path:** `/config-service/config/v1`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/_create/{schemaCode}` | POST | Create a new config record |
| `/_update/{schemaCode}` | POST | Update an existing config record |
| `/_search` | POST | Search with exact tenant match |
| `/_resolve` | POST | Resolve with tenant hierarchy fallback |

### Create Example

```bash
curl -X POST "http://<host>/config-service/config/v1/_create/TemplateBinding" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": { "userInfo": { "uuid": "system", "tenantId": "pg" } },
    "configData": {
      "tenantId": "pg.citya",
      "data": {
        "eventName": "COMPLAINTS.WORKFLOW.APPLY",
        "channel": "WHATSAPP",
        "locale": "en_IN",
        "templateId": "complaints-workflow-apply",
        "contentSid": "HX350aa0b139780ea87f554276b1f68d6c",
        "paramOrder": ["serviceName", "complaintNo", "submittedDate"],
        "requiredVars": ["complaintNo", "serviceName", "submittedDate"]
      }
    }
  }'
```

### Search Example

```bash
curl -X POST "http://<host>/config-service/config/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {},
    "criteria": { "tenantId": "pg.citya", "schemaCode": "TemplateBinding" }
  }'
```

### Resolve Example (with tenant fallback)

```bash
curl -X POST "http://<host>/config-service/config/v1/_resolve" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {},
    "resolveRequest": {
      "schemaCode": "TemplateBinding",
      "tenantId": "pg.citya",
      "criteria": {
        "eventName": "COMPLAINTS.WORKFLOW.APPLY",
        "channel": "WHATSAPP",
        "locale": "en_IN"
      }
    }
  }'
```

Fallback order: `pg.citya` -> `pg` -> `*` (wildcard)

## Schema Types Used in Notifications

### TemplateBinding

Maps a domain event to a notification template per channel and locale.

| Field | Type | Description |
|-------|------|-------------|
| `eventName` | string | Domain event (e.g., `COMPLAINTS.WORKFLOW.APPLY`) |
| `channel` | string | Notification channel (`WHATSAPP`, `SMS`, `EMAIL`) |
| `locale` | string | Language (`en_IN`, `hi_IN`, `fr_IN`, `pt_IN`) |
| `templateId` | string | Novu workflow ID to trigger |
| `contentSid` | string | Twilio Content Template SID (starts with `HX`) |
| `paramOrder` | string[] | Maps domain vars to Twilio `{{1}}`, `{{2}}`, etc. |
| `requiredVars` | string[] | Variables that must be in the event data |
| `novuApiKey` | string | Optional per-tenant Novu API key |

### ProviderDetail

Stores notification provider credentials.

| Field | Type | Description |
|-------|------|-------------|
| `providerName` | string | Provider identifier (e.g., `twilio`) |
| `channel` | string | Channel (`WHATSAPP`, `SMS`, `EMAIL`) |
| `accountSid` | string | Twilio Account SID |
| `authToken` | string | Twilio Auth Token (encrypted) |
| `senderNumber` | string | WhatsApp sender number |
| `isActive` | boolean | Whether this provider is active |

### NotificationChannel

Toggles notification channels on or off.

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Channel code (`WHATSAPP`, `SMS`, `EMAIL`) |
| `name` | string | Display name |
| `enabled` | boolean | Whether this channel is enabled |

## Setup

### Prerequisites

- Java 17
- PostgreSQL
- MDMS v2 service (for schema validation)

### Database

Create a database (e.g., `configdb`). Flyway auto-creates the `eg_config_data` table on first startup.

### Running Locally

```bash
mvn clean package -DskipTests

java -jar target/digit-config-service-*.jar \
  --server.port=9000 \
  --spring.datasource.url=jdbc:postgresql://<host>:<port>/configdb \
  --spring.flyway.url=jdbc:postgresql://<host>:<port>/configdb
```

### Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `server.servlet.context-path` | `/config-service` | API context path |
| `spring.datasource.url` | `jdbc:postgresql://localhost:5432/configdb` | Database URL |
| `spring.flyway.enabled` | `true` | Auto-create tables |
| `mdms.v2.host` | `http://localhost:8083` | MDMS v2 host |
| `mdms.v2.validation.enabled` | `true` | Schema validation on/off |
| `encryption.service.enabled` | `false` | Field-level encryption |
| `state.level.tenantid` | `pg` | State tenant for encryption |

### Helm Chart

Location: [`deploy-as-code/helm/charts/common-services/digit-config-service`](https://github.com/egovernments/DIGIT-DevOps/tree/sandbox-demo/deploy-as-code/helm/charts/common-services/digit-config-service)

## Resources

- [OpenAPI Spec](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/develop/docs/Configs_Service/config-service.openapi.yaml)
- Postman Collection: Available in the project's Postman workspace
