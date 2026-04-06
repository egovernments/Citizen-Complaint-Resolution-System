# Config Service (`digit-config-service`)

A schema-validated, tenant-scoped configuration store for the DIGIT platform. It manages template bindings, provider credentials, and notification channel toggles used by the WhatsApp notification system.

## Features

- **Schema validation** against MDMS v2 schemas before storing data
- **Tenant fallback resolution** via `_resolve` API (`pg.citya` -> `pg` -> `*`)
- **Field-level encryption** for sensitive fields (e.g., auth tokens) marked with `x-security` in schema
- **Unique constraint enforcement** via `x-unique` schema fields
- **Flyway-managed** database migrations

## Schema Setup

Before creating any configuration data (`configdata`), the following schemas must be registered in the MDMS v2 service. The `digit-config-service` uses these schemas to validate incoming data, enforce unique constraints, and apply field-level encryption.

### 1. NotificationChannel Schema

```json
{
  "type": "object",
  "title": "NotificationChannel",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "required": [
    "code",
    "name",
    "enabled"
  ],
  "x-unique": [
    "code"
  ],
  "properties": {
    "code": {
      "type": "string",
      "enum": [
        "WHATSAPP",
        "SMS",
        "EMAIL"
      ],
      "description": "Channel identifier"
    },
    "name": {
      "type": "string",
      "description": "Human-readable channel name"
    },
    "enabled": {
      "type": "boolean",
      "description": "Whether this channel is active for the tenant"
    },
    "providerName": {
      "type": "string",
      "description": "Provider handling this channel (links to ProviderDetail)"
    },
    "priority": {
      "type": "integer",
      "description": "Dispatch priority (lower = higher priority)"
    }
  },
  "additionalProperties": true
}
```

### 2. ProviderDetail Schema

```json
{
  "type": "object",
  "title": "ProviderDetail",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "required": [
    "providerName",
    "channel",
    "priority"
  ],
  "x-unique": [
    "providerName",
    "channel",
    "priority"
  ],
  "properties": {
    "channel": {
      "type": "string",
      "description": "Communication channel (whatsapp, sms, email)"
    },
    "isActive": {
      "type": "boolean",
      "default": true,
      "description": "Whether this provider is active"
    },
    "priority": {
      "type": "integer",
      "default": 0,
      "description": "Provider priority (lower = higher priority)"
    },
    "novuApiKey": {
      "type": "string",
      "description": "Optional provider-specific Novu API key"
    },
    "credentials": {
      "type": "object",
      "description": "Provider-specific credentials in Novu-compatible format"
    },
    "providerName": {
      "type": "string",
      "description": "Provider name (e.g., twilio, sendgrid, etc.)"
    }
  },
  "x-security": [
    "credentials",
    "novuApiKey"
  ],
  "description": "Schema for provider configurations per tenant and channel"
}
```

### 3. TemplateBinding Schema

```json
{
  "type": "object",
  "title": "TemplateBinding",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "required": [
    "eventName",
    "channel",
    "templateId",
    "locale"
  ],
  "x-unique": [
    "eventName",
    "channel",
    "locale"
  ],
  "properties": {
    "locale": {
      "type": "string",
      "default": "en_IN",
      "pattern": "^[a-z]{2}_[A-Z]{2}$",
      "description": "Locale code for provider (e.g., en_IN, hi_IN, en_US)"
    },
    "channel": {
      "type": "string",
      "description": "Communication channel (whatsapp, sms, email)"
    },
    "isActive": {
      "type": "boolean",
      "default": true,
      "description": "Whether this template binding is active"
    },
    "eventName": {
      "type": "string",
      "description": "Event name (e.g., COMPLAINTS.WORKFLOW.REJECT)"
    },
    "contentSid": {
      "type": "string",
      "description": "Provider-specific content SID (for Twilio)"
    },
    "novuApiKey": {
      "type": "string",
      "description": "Optional template-specific Novu API key"
    },
    "paramOrder": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Order of parameters for template"
    },
    "templateId": {
      "type": "string",
      "description": "Template identifier in Novu"
    },
    "requiredVars": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Required variables for template"
    }
  },
  "x-security": [
    "novuApiKey"
  ],
  "description": "Schema for template bindings per event and channel"
}
```

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
