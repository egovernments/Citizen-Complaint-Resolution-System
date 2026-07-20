# Novu Bridge (`novu-bridge`)

Pass-through notification delivery for the DIGIT platform.

## Overview

novu-bridge is a thin delivery + tracking layer between PGR and Novu. **PGR owns
all resolution**: it resolves the recipient, picks + fills + localizes the
template, and publishes ONE pre-rendered event per (recipient × channel) to the
`complaints.domain.events` Kafka topic, with the final text in `renderedBody`.

novu-bridge does NOT resolve templates, providers, or localization, and makes
no config-service `_resolve`/`_search` calls. Per event it only:

1. validates the pre-rendered envelope,
2. applies the channel gate (`novu.bridge.channels.enabled`, default
   `SMS,EMAIL`) and the optional user-preference consent check,
3. upserts the Novu subscriber (identify) with the carried contact profile, and
4. triggers the fixed per-channel Novu workflow (`complaints-sms` /
   `complaints-email`; `complaints-whatsapp` delivers via a Twilio Programmable
   WhatsApp integration, with the recipient prefixed `whatsapp:`), passing the
   pre-rendered body in `payload.body`, then
5. records the outcome in `nb_dispatch_log` keyed by `transactionId`.

WHATSAPP is a known channel but is disabled by default: until a legitimate
provider is onboarded as a Novu integration, WHATSAPP events persist an honest
`SKIPPED` / `NB_NO_PROVIDER` row instead of falling back to another channel.

## Pre-requisites

- Java 17
- PostgreSQL
- Kafka / Redpanda
- Novu self-hosted (API at port 3000)
- User Preferences Service (optional — consent gate; disabled via
  `NOVU_BRIDGE_PREFERENCE_ENABLED=false`)
- MDMS v2 (phone country-code prefix via
  `ValidationConfigs.mobileNumberValidation`)

## Processing Pipeline

```
1. Validate envelope    (eventId, eventType, eventName, tenantId,
                         channel, renderedBody, subscriberId)
2. Derive context       (contact profile, channel, transactionId — all
                         carried on the event; nothing is looked up)
3. Preference gate      (optional consent check per channel — SKIPPED/
                         NB_PREFERENCE_DENIED when denied)
4. Channel gates        (unknown channel -> SKIPPED/NB_UNSUPPORTED_CHANNEL;
                         known-but-disabled -> SKIPPED/NB_NO_PROVIDER;
                         missing phone/email -> SKIPPED/NB_CONTACT_MISSING)
5. Identify subscriber  (POST /v1/subscribers, TTL-cached, non-fatal)
6. Trigger Novu         (POST /v1/events/trigger with the per-channel
                         workflow id; rendered text in payload.body)
7. Persist log          (upsert to nb_dispatch_log)
```

## Domain Event Structure (pre-rendered envelope)

PGR publishes one event per (recipient × channel):

```json
{
  "eventId": "unique-uuid",
  "eventType": "DOMAIN_EVENT",
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",
  "tenantId": "pg.citya",
  "module": "Complaints",
  "entityType": "COMPLAINT",
  "entityId": "PG-PGR-2026-03-25-043118",
  "channel": "SMS",
  "subscriberId": "pg.citya:user-uuid",
  "renderedBody": "Dear Jane, your complaint PG-PGR-2026-03-25-043118 ...",
  "renderedSubject": null,
  "contact": {
    "userId": "user-uuid",
    "type": "CITIZEN",
    "name": "Jane Doe",
    "phone": "+919123456789",
    "email": null,
    "locale": "en_IN"
  },
  "data": { "complaintNo": "PG-PGR-2026-03-25-043118" }
}
```

**Required fields:** `eventId`, `eventType`, `eventName`, `tenantId`,
`channel`, `renderedBody`, `subscriberId`. `renderedSubject` is used for
EMAIL. A legacy coarse shape (with a `workflow.toState` block) is still
accepted by the dry-run endpoints.

## Dispatch Log

**Table:** `nb_dispatch_log`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `event_id` | VARCHAR(64) | Domain event ID |
| `reference_number` | VARCHAR(256) | Business reference (e.g., complaint number) |
| `module` | VARCHAR(128) | Source module (e.g., `Complaints`) |
| `event_name` | VARCHAR(256) | Event name (e.g., `COMPLAINTS.WORKFLOW.APPLY`) |
| `tenant_id` | VARCHAR(256) | Tenant ID |
| `channel` | VARCHAR(64) | `SMS`, `EMAIL`, or `WHATSAPP` |
| `recipient_value` | VARCHAR(256) | Recipient's phone/email |
| `template_key` | VARCHAR(256) | Novu workflow ID used |
| `status` | VARCHAR(32) | `SENT`, `FAILED`, `SKIPPED`, or `RECEIVED` |
| `attempt_count` | INT | Number of delivery attempts |
| `last_error_code` | VARCHAR(128) | Error code if failed/skipped |
| `last_error_message` | TEXT | Error details |
| `provider_response_jsonb` | JSONB | Raw Novu API response |

**Status values:**

| Status | Meaning |
|--------|---------|
| `SENT` | Novu trigger succeeded (2xx) |
| `FAILED` | Processing/delivery error |
| `SKIPPED` | Gated: preference denied, unsupported/disabled channel, or missing contact |
| `RECEIVED` | Validation-only mode (no actual send) |

## API Endpoints

**Base path:** `/novu-bridge/novu-adapter/v1`

Configurator proxy endpoints (routed through Kong; the DIGIT bearer token is
validated server-side by `ProxyAuthFilter` against egov-user `/user/_details`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/logs` | GET | Dispatch log listing |
| `/integrations` | GET | Novu integrations (secrets redacted) |
| `/preferences` | GET | User notification preference listing |
| `/providers` | POST | Create/activate a Novu provider integration |
| `/providers/templates` | GET | Provider form templates |
| `/providers/verify` | POST | Verify provider credentials |
| `/providers/test-send` | POST | Send a test notification via a provider |

Diagnostics under `/dispatch/*` (intentionally NOT routed at the gateway —
direct service access only):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/dispatch/_validate` | POST | Full pipeline without sending |
| `/dispatch/_dry-run?send=true` | POST | Full pipeline with optional actual send |
| `/dispatch/_test-trigger` | POST | Direct Novu trigger, bypasses gates |

## Kafka Topics

| Topic | Purpose |
|-------|---------|
| `complaints.domain.events` (configurable) | Input — pre-rendered events from PGR |
| `novu-bridge.retry` | Reserved for future use — the consumer listens on it, but nothing publishes to it yet |
| `novu-bridge.dlq` | Dead-letter queue for failed events |

## Setup

### Database

Create a database. Flyway auto-creates the `nb_dispatch_log` table.

### Bootstrap Novu

Bootstrap Novu with the provider integration and the per-channel workflows
using [`config/bootstrap-novu-whatsapp.sh`](config/bootstrap-novu-whatsapp.sh)
(requires `curl` + `jq`; credentials via a `.env.novu`-style file — see
[`config/.env.novu`](config/.env.novu)). Providers can also be onboarded at
runtime through the configurator's provider management screens (the
`/providers*` endpoints above).

### Running Locally

```bash
mvn clean package -DskipTests

NOVU_API_KEY=<your-key> java -jar target/novu-bridge-*.jar
```

### Configuration

| Property | Default | Description |
|----------|---------|-------------|
| `server.servlet.context-path` | `/novu-bridge` | API context path |
| `spring.kafka.bootstrap-servers` | `localhost:9092` | Kafka broker |
| `novu.bridge.kafka.input.topic` | `complaints.domain.events` | Input topic |
| `novu.bridge.kafka.retry.topic` | `novu-bridge.retry` | Retry topic (reserved, not yet published to) |
| `novu.bridge.kafka.dlq.topic` | `novu-bridge.dlq` | DLQ topic |
| `novu.bridge.channels.enabled` | `SMS,EMAIL` | Channels actually delivered; others persist `SKIPPED`/`NB_NO_PROVIDER` |
| `novu.bridge.workflow.id.sms` | `complaints-sms` | Novu workflow for SMS |
| `novu.bridge.workflow.id.email` | `complaints-email` | Novu workflow for EMAIL |
| `novu.bridge.workflow.id.whatsapp` | `complaints-whatsapp` | Novu workflow for WHATSAPP |
| `novu.bridge.identify.cache.ttl.ms` | `300000` | Subscriber identify TTL cache window |
| `novu.bridge.preference.enabled` | `true` | Enable/disable the consent gate |
| `novu.bridge.preference.host` | `http://digit-user-preferences-service.egov:8080/user-preference` | Preferences service URL |
| `novu.bridge.user.host` | `http://egov-user.egov:8080` | egov-user (proxy-auth token introspection) |
| `novu.bridge.proxy.auth.enabled` | `true` | Validate DIGIT bearer tokens on proxy endpoints |
| `mdms.host` | `http://mdms-v2.egov:8080` | MDMS v2 (phone country-code prefix) |
| `novu.base.url` | `http://novu-api.novu:3000` | Novu API URL |
| `novu.api.key` | (env `NOVU_API_KEY`) | Novu API key |
| `spring.datasource.url` | `jdbc:postgresql://localhost:5432/postgres4` | Database URL |
| `novu.bridge.dispatch.log.enabled` | `true` | Enable dispatch logging |

## System Flow

```
┌────────────┐   pre-rendered event    ┌──────────────┐  (1) consent   ┌──────────────────┐
│    PGR     │────────────────────────▶│  Novu Bridge │───────────────▶│ User Preferences │
│ (resolves, │  per (recipient×channel)│  (validate + │                └──────────────────┘
│  renders,  │  on Kafka topic         │   gate +     │
│  localizes)│  complaints.domain.     │   deliver)   │
└────────────┘  events                 └──────┬───────┘
                                              │ (2) trigger per-channel workflow
                                              ▼
                                        ┌───────────┐   provider    ┌───────────┐
                                        │   Novu    │──────────────▶│ SMS/Email │
                                        │           │  integration  │ recipient │
                                        └───────────┘               └───────────┘
```

1. **PGR** resolves the recipient, renders + localizes the message, and
   publishes one pre-rendered event per (recipient × channel)
2. **Novu Bridge** validates the envelope, applies the channel + preference
   gates, and triggers the per-channel Novu workflow with the rendered body
3. **Novu** delivers through the configured provider integration

## Resources

- [OpenAPI Spec](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/develop/docs/Novu_Adapter/novu-adapter.openapi.yaml)
- [Novu Bootstrap Script](config/bootstrap-novu-whatsapp.sh)
- [Bootstrap Postman Collection](config/Novu-Bootstrap.postman_collection.json)
