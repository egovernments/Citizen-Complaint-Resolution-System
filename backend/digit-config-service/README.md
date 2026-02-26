# DIGIT Config Service

A centralized configuration management service for the DIGIT platform, built to power bidirectional WhatsApp communication and other notification services. It manages runtime configurations, templates, feature flags, and notification policies with multi-tenant support, versioning, and tenant-hierarchy-based config resolution.

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
  - [Config Set APIs](#config-set-apis)
  - [Config Catalog APIs](#config-catalog-apis)
  - [Resolve API](#resolve-api)
  - [Template Preview API](#template-preview-api)
- [Seed Data (OOTB Configs)](#seed-data-ootb-configs)
- [Tenant Hierarchy Fallback](#tenant-hierarchy-fallback)
- [Schema Validation](#schema-validation)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)

---

## Overview

The DIGIT Config Service provides a unified API layer for managing:

- **Config Sets** - Logical groupings of related configurations (e.g., "Default WhatsApp Config Set")
- **Configs with Versioning** - Individual config entries with immutable version snapshots, supporting namespaces like templates, feature flags, channel definitions, etc.
- **Config Resolution** - Resolves the effective config for a given tenant by walking up the tenant hierarchy (e.g., `pb.amritsar.ward1` -> `pb.amritsar` -> `pb`)
- **Template Preview** - Renders `{{placeholder}}` templates with provided data for real-time preview
- **Schema Validation** - Optional JSON schema validation of config content via MDMS v2

The service follows standard DIGIT platform patterns: `Controller -> Service (validate -> enrich -> persist) -> Repository (JdbcTemplate + QueryBuilder + RowMapper)`.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | Java 17 |
| Framework | Spring Boot 3.2.2 |
| Database | H2 (in-memory, swappable to PostgreSQL) |
| Migrations | Flyway |
| Build | Maven |
| Validation | Jakarta Bean Validation |
| Serialization | Jackson |
| Code Generation | Lombok |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Controllers                           │
│  ConfigController (/v1)    ConfigSetController (/config-set/v1) │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
┌──────────────▼──────────────────────────▼───────────────────┐
│                        Services                             │
│  ConfigService  ConfigSetService  ResolveService            │
│  TemplateService  SchemaValidationService                   │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│                    Validators & Enrichers                    │
│  ConfigValidator    ConfigSetValidator                      │
│  ConfigEnricher     ConfigSetEnricher                       │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│                      Repository Layer                       │
│  ConfigRepository          ConfigSetRepository              │
│  ConfigQueryBuilder        ConfigSetQueryBuilder            │
│  ConfigRowMapper           ConfigSetRowMapper               │
│  ConfigVersionRowMapper                                     │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│               H2 Database (Flyway-managed)                  │
│  eg_config_set | eg_config | eg_config_version              │
│  eg_config_set_activation                                   │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

The schema is normalized across 4 tables, managed by Flyway migrations (V1 -> V2 -> V3):

```
eg_config_set  1──N  eg_config  1──N  eg_config_version
eg_config_set  1──N  eg_config_set_activation (audit trail)
```

### Tables

| Table | Purpose |
|-------|---------|
| `eg_config_set` | Logical grouping of configs. Has `status` (ACTIVE/INACTIVE). Only one set can be ACTIVE per tenant. |
| `eg_config` | Individual config entries. Unique on `(tenant_id, namespace, config_code)`. Belongs to a config set. |
| `eg_config_version` | Immutable versioned snapshots of config content (JSON). Unique on `(config_id, version)`. |
| `eg_config_set_activation` | Audit trail recording config set activations, including the previously active set. |

### ER Diagram

```
eg_config_set
├── id (PK)
├── tenant_id
├── name
├── code (UNIQUE per tenant)
├── description
├── status (ACTIVE/INACTIVE)
└── audit fields

eg_config
├── id (PK)
├── config_set_id (FK -> eg_config_set)
├── tenant_id
├── namespace
├── config_name
├── config_code (UNIQUE per tenant+namespace)
├── environment
├── description
├── status
└── audit fields

eg_config_version
├── id (PK)
├── config_id (FK -> eg_config)
├── version (UNIQUE per config_id)
├── content (CLOB - JSON)
├── schema_ref
├── status (ACTIVE/INACTIVE)
└── audit fields

eg_config_set_activation
├── id (PK)
├── config_set_id (FK -> eg_config_set)
├── tenant_id
├── activated_by
├── activated_time
└── previous_active_set_id
```

---

## API Reference

**Base URL:** `http://localhost:8080/configs`

All endpoints accept `POST` requests with `Content-Type: application/json`. Every request body must include a `requestInfo` object following the DIGIT common contract:

```json
{
  "requestInfo": {
    "apiId": "config-service",
    "ver": "1.0",
    "ts": 1700000000000,
    "msgId": "unique-msg-id",
    "userInfo": {
      "uuid": "user-uuid",
      "userName": "username"
    }
  }
}
```

---

### Config Set APIs

#### POST `/configs/config-set/v1/_create`

Creates a new config set. Status defaults to `INACTIVE`.

**Request:**
```json
{
  "requestInfo": { "..." },
  "configSet": {
    "tenantId": "pb",
    "name": "Punjab Config Set",
    "code": "PB_CONFIG",
    "description": "Punjab state configuration set"
  }
}
```

**Response (201 Created):**
```json
{
  "ResponseInfo": { "status": "successful" },
  "configSets": [{
    "id": "generated-uuid",
    "tenantId": "pb",
    "name": "Punjab Config Set",
    "code": "PB_CONFIG",
    "description": "Punjab state configuration set",
    "status": "INACTIVE",
    "auditDetails": { "createdBy": "SYSTEM", "createdTime": 1700000000000, "..." }
  }]
}
```

**Errors:**
- `400 DUPLICATE_CONFIG_SET` - A set with the same code already exists for the tenant

---

#### POST `/configs/config-set/v1/_search`

Searches config sets by criteria.

**Request:**
```json
{
  "requestInfo": { "..." },
  "criteria": {
    "tenantId": "pb",
    "code": "PB_CONFIG",
    "status": "INACTIVE"
  }
}
```

**Response (200):**
```json
{
  "ResponseInfo": { "status": "successful" },
  "configSets": [ { "..." } ],
  "pagination": { "totalCount": 1, "limit": 10, "offSet": 0 }
}
```

---

#### POST `/configs/config-set/v1/_update`

Updates a config set's metadata (name, description, status).

**Request:**
```json
{
  "requestInfo": { "..." },
  "configSet": {
    "id": "existing-set-id",
    "tenantId": "pb",
    "name": "Updated Name",
    "code": "PB_CONFIG",
    "description": "Updated description"
  }
}
```

---

#### POST `/configs/config-set/v1/_activate`

Activates a config set for a tenant. Automatically deactivates any previously active set and records the activation in the audit trail.

**Request:**
```json
{
  "requestInfo": { "..." },
  "tenantId": "pb",
  "configSetId": "set-uuid-to-activate"
}
```

**Response (200):**
```json
{
  "ResponseInfo": { "status": "successful" },
  "configSetId": "set-uuid-to-activate",
  "status": "ACTIVE"
}
```

---

### Config Catalog APIs

#### POST `/configs/v1/_create`

Creates a new config entry with an initial version.

**Request:**
```json
{
  "requestInfo": { "..." },
  "config": {
    "tenantId": "pb",
    "namespace": "WHATSAPP_TEMPLATES",
    "configName": "Welcome Template",
    "configCode": "WA_WELCOME",
    "status": "ACTIVE",
    "environment": "prod",
    "versions": [{
      "version": "v1",
      "content": {
        "template": "Hello {{name}}, welcome to {{city}} services!",
        "type": "TEXT",
        "locale": "en_IN"
      }
    }]
  }
}
```

**Response (201 Created):**
```json
{
  "ResponseInfo": { "status": "successful" },
  "configs": [{
    "id": "generated-uuid",
    "tenantId": "pb",
    "namespace": "WHATSAPP_TEMPLATES",
    "configCode": "WA_WELCOME",
    "versions": [{
      "id": "generated-uuid",
      "version": "v1",
      "content": { "..." },
      "status": "ACTIVE"
    }],
    "auditDetails": { "..." }
  }]
}
```

**Errors:**
- `400 DUPLICATE_CONFIG` - A config with the same `tenantId + namespace + configCode` already exists

---

#### POST `/configs/v1/_search`

Searches configs with optional version content.

**Request:**
```json
{
  "requestInfo": { "..." },
  "criteria": {
    "tenantId": "pb",
    "namespace": "WHATSAPP_TEMPLATES",
    "configCode": "WA_WELCOME",
    "environment": "prod",
    "status": "ACTIVE",
    "version": "v1",
    "includeContent": true,
    "limit": 10,
    "offset": 0
  }
}
```

All criteria fields are optional except `tenantId`. Set `includeContent: false` to exclude version content from the response for lighter payloads.

**Response (200):**
```json
{
  "ResponseInfo": { "status": "successful" },
  "configs": [ { "..." } ],
  "pagination": { "totalCount": 1, "limit": 10, "offSet": 0 }
}
```

---

#### POST `/configs/v1/_update`

Updates a config and adds a new version. The previous active version is automatically deactivated.

**Request:**
```json
{
  "requestInfo": { "..." },
  "config": {
    "id": "existing-config-id",
    "tenantId": "pb",
    "namespace": "WHATSAPP_TEMPLATES",
    "configName": "Welcome Template",
    "configCode": "WA_WELCOME",
    "status": "ACTIVE",
    "versions": [{
      "version": "v2",
      "content": {
        "template": "Hello {{name}}! Welcome to {{city}} municipal services. How can we help?",
        "type": "TEXT",
        "locale": "en_IN"
      }
    }],
    "auditDetails": { "createdBy": "user-uuid", "createdTime": 1700000000000 }
  }
}
```

---

### Resolve API

#### POST `/configs/v1/_resolve`

Resolves the effective configuration for a given tenant, namespace, and config code. Walks up the tenant hierarchy until a match is found.

**Request:**
```json
{
  "requestInfo": { "..." },
  "tenantId": "pb.amritsar.ward1",
  "namespace": "WHATSAPP_TEMPLATES",
  "configCode": "WA_WELCOME",
  "environment": "prod",
  "context": {
    "environment": "prod"
  }
}
```

**Response (200):**
```json
{
  "ResponseInfo": { "status": "successful" },
  "tenantId": "pb.amritsar.ward1",
  "namespace": "WHATSAPP_TEMPLATES",
  "configCode": "WA_WELCOME",
  "version": "v1",
  "content": {
    "template": "Hello {{name}}, welcome to {{city}} services!",
    "type": "TEXT",
    "locale": "en_IN"
  },
  "resolvedFrom": "pb"
}
```

The `resolvedFrom` field indicates which tenant level the config was actually found at.

**Errors:**
- `400 CONFIG_NOT_RESOLVED` - No matching active config found at any tenant level

---

### Template Preview API

#### POST `/configs/v1/template/_preview`

Renders a template by replacing `{{placeholder}}` tokens with provided data values.

**Request:**
```json
{
  "requestInfo": { "..." },
  "tenantId": "pb",
  "template": {
    "namespace": "WHATSAPP_TEMPLATES",
    "configName": "Welcome Template",
    "configCode": "WA_WELCOME"
  },
  "locale": "en_IN",
  "data": {
    "name": "Lokendra",
    "city": "Amritsar"
  }
}
```

**Response (200):**
```json
{
  "ResponseInfo": { "status": "successful" },
  "rendered": "Hello Lokendra, welcome to Amritsar services!",
  "locale": "en_IN"
}
```

---

## Seed Data (OOTB Configs)

The service ships with out-of-the-box seed data loaded via Flyway migration `V3__seed_config_data.sql` under `tenantId = "default"`:

| Namespace | Config Code | Description |
|-----------|------------|-------------|
| `OOTB_TEMPLATES` | `WELCOME_MSG` | Welcome message template for first WhatsApp interaction |
| `OOTB_TEMPLATES` | `OTP_MSG` | OTP verification message template |
| `OOTB_TEMPLATES` | `PAYMENT_RECEIPT` | Payment confirmation template |
| `OOTB_TEMPLATES` | `COMPLAINT_STATUS` | Complaint status update template |
| `OOTB_TEMPLATE_BINDINGS` | `TEMPLATE_BINDINGS` | Maps `eventType + channel` to template codes |
| `EVENT_CHANNELS` | `CHANNEL_DEFS` | Channel definitions (WhatsApp, SMS, Email, Push) with provider config |
| `EVENT_CATEGORY_MAP` | `EVENT_CATEGORIES` | Maps event types to categories (TRANSACTIONAL, SERVICE, PROMOTIONAL) |
| `LANGUAGE_STRATEGY` | `LANG_STRATEGY` | Locale resolution rules and 11 supported Indian locales |
| `FEATURE_FLAGS` | `FEATURE_FLAGS` | Runtime feature toggles with tenant-level override support |

### Feature Flags (default values)

| Flag | Default |
|------|---------|
| `whatsapp_bidirectional_enabled` | `true` |
| `template_preview_enabled` | `true` |
| `multilingual_enabled` | `true` |
| `schema_validation_enabled` | `false` |
| `config_set_activation_enabled` | `true` |
| `event_category_routing_enabled` | `true` |
| `rate_limiting_enabled` | `false` |
| `audit_logging_enabled` | `true` |

---

## Tenant Hierarchy Fallback

The Resolve API supports automatic tenant hierarchy fallback. When resolving a config for `pb.amritsar.ward1`, the service searches in order:

```
1. pb.amritsar.ward1   (exact match)
2. pb.amritsar          (city level)
3. pb                   (state level)
```

This allows tenants to inherit parent configurations while overriding specific configs at lower levels. The `resolvedFrom` field in the response indicates where the config was actually found.

---

## Schema Validation

The service includes optional JSON schema validation for config content via integration with MDMS v2. When a `ConfigVersion` has a `schemaRef` field set:

1. The service fetches the schema definition from MDMS v2
2. Validates required fields, field types (`string`, `integer`, `number`, `boolean`, `array`, `object`)
3. Validates string constraints (`minLength`, `maxLength`)
4. Caches schemas in-memory (ConcurrentHashMap) for performance

Schema validation is **disabled by default** (when `mdms.schema.host` is empty). To enable, configure the MDMS host in `application.properties`:

```properties
mdms.schema.host=http://mdms-v2-host:8082
mdms.schema.search.path=/mdms-v2/schema/v1/_search
```

---

## Getting Started

### Prerequisites

- Java 17+
- Maven 3.8+

### Build

```bash
mvn clean package
```

### Run

```bash
java -jar target/digit-config-service-0.1.0-SNAPSHOT.jar
```

The service starts on **port 8080** with context path `/configs`.

- Health check: `GET http://localhost:8080/configs/health`
- H2 Console: `http://localhost:8080/configs/h2-console`
  - JDBC URL: `jdbc:h2:mem:configdb`
  - Username: `sa`
  - Password: *(empty)*

### Quick Test

```bash
# Health check
curl http://localhost:8080/configs/health

# Search seed OOTB templates
curl -s -X POST http://localhost:8080/configs/v1/_search \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {"apiId":"config-service","ver":"1.0","ts":1700000000000,"msgId":"test","userInfo":{"uuid":"user1","userName":"admin"}},
    "criteria": {"tenantId":"default","namespace":"OOTB_TEMPLATES"}
  }'

# Resolve a template with tenant fallback
curl -s -X POST http://localhost:8080/configs/v1/_resolve \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {"apiId":"config-service","ver":"1.0","ts":1700000000000,"msgId":"test","userInfo":{"uuid":"user1","userName":"admin"}},
    "tenantId": "default",
    "namespace": "OOTB_TEMPLATES",
    "configCode": "WELCOME_MSG"
  }'

# Preview a template with data
curl -s -X POST http://localhost:8080/configs/v1/template/_preview \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": {"apiId":"config-service","ver":"1.0","ts":1700000000000,"msgId":"test","userInfo":{"uuid":"user1","userName":"admin"}},
    "tenantId": "default",
    "template": {"namespace":"OOTB_TEMPLATES","configName":"Welcome Message","configCode":"WELCOME_MSG"},
    "locale": "en_IN",
    "data": {"name":"Lokendra","cityName":"Amritsar"}
  }'
```

---

## Configuration

### application.properties

| Property | Default | Description |
|----------|---------|-------------|
| `server.port` | `8080` | Server port |
| `server.servlet.context-path` | `/configs` | Base context path for all endpoints |
| `spring.datasource.url` | `jdbc:h2:mem:configdb` | Database JDBC URL |
| `spring.flyway.enabled` | `true` | Enable Flyway migrations |
| `config.default.offset` | `0` | Default pagination offset |
| `config.default.limit` | `10` | Default pagination limit |
| `app.timezone` | `UTC` | Application timezone |
| `mdms.schema.host` | *(empty)* | MDMS v2 host for schema validation (disabled when empty) |
| `mdms.schema.search.path` | `/mdms-v2/schema/v1/_search` | MDMS schema search endpoint path |

### Switching to PostgreSQL

Replace the H2 datasource in `application.properties`:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/configdb
spring.datasource.driver-class-name=org.postgresql.Driver
spring.datasource.username=postgres
spring.datasource.password=postgres
```

Add the PostgreSQL driver to `pom.xml`:

```xml
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>
```

> **Note:** The SQL migrations use H2-compatible syntax (`CLOB`, `LIMIT ? OFFSET ?`). For PostgreSQL, adjust column types (`CLOB` -> `TEXT`) and verify query syntax compatibility.

---

## Running Tests

```bash
# Run all tests
mvn test

# Run with verbose output
mvn test -X
```

The test suite includes **14 integration tests**:

| Test | Description |
|------|-------------|
| `configSet_createAndSearch` | Create a config set and verify search returns it |
| `configSet_duplicateReturns400` | Duplicate config set code returns 400 |
| `configSet_activateDeactivatesPrevious` | Activation deactivates the previously active set |
| `config_createWithVersion` | Create config with initial version |
| `config_searchWithVersions` | Search returns configs with version content and pagination |
| `config_updateAddsNewVersion` | Update adds new version, deactivates previous |
| `resolve_returnsActiveConfig` | Resolve returns the active version content |
| `resolve_tenantFallback` | Resolves from parent tenant when child has no config |
| `resolve_notFoundReturns400` | Returns 400 when no config found at any level |
| `templatePreview_rendersPlaceholders` | Renders `{{placeholder}}` tokens with provided data |
| `seedData_ootbTemplatesLoadedAndSearchable` | Verifies 4 OOTB templates are loaded from seed data |
| `seedData_featureFlagsLoaded` | Verifies feature flags content is correct |
| `seedData_resolveOotbTemplate` | Verifies seed templates are resolvable |
| `contextLoads` | Spring application context loads successfully |

---

## Project Structure

```
digit-config-service/
├── pom.xml
├── README.md
└── src/
    ├── main/
    │   ├── java/org/egov/config/
    │   │   ├── ConfigServiceApplication.java          # Entry point
    │   │   ├── config/
    │   │   │   ├── ApplicationConfig.java             # App defaults (offset, limit, timezone)
    │   │   │   └── GlobalExceptionHandler.java        # @RestControllerAdvice error handler
    │   │   ├── controller/
    │   │   │   ├── ConfigController.java              # /v1 endpoints (CRUD, resolve, template)
    │   │   │   └── ConfigSetController.java           # /config-set/v1 endpoints (CRUD, activate)
    │   │   ├── service/
    │   │   │   ├── ConfigService.java                 # Config CRUD business logic
    │   │   │   ├── ConfigSetService.java              # ConfigSet CRUD + activation logic
    │   │   │   ├── ResolveService.java                # Tenant fallback resolution
    │   │   │   ├── TemplateService.java               # {{placeholder}} template rendering
    │   │   │   ├── SchemaValidationService.java       # JSON schema validation via MDMS v2
    │   │   │   ├── enrichment/
    │   │   │   │   ├── ConfigEnricher.java            # UUID, audit details for configs
    │   │   │   │   └── ConfigSetEnricher.java         # UUID, audit details for config sets
    │   │   │   └── validator/
    │   │   │       ├── ConfigValidator.java           # Config request validation
    │   │   │       └── ConfigSetValidator.java        # ConfigSet request validation
    │   │   ├── repository/
    │   │   │   ├── ConfigRepository.java              # JDBC ops for config + versions
    │   │   │   ├── ConfigSetRepository.java           # JDBC ops for config sets + activations
    │   │   │   ├── querybuilder/
    │   │   │   │   ├── ConfigQueryBuilder.java        # Dynamic SQL for config search
    │   │   │   │   └── ConfigSetQueryBuilder.java     # Dynamic SQL for config set search
    │   │   │   └── rowmapper/
    │   │   │       ├── ConfigRowMapper.java           # ResultSet -> Config
    │   │   │       ├── ConfigSetRowMapper.java        # ResultSet -> ConfigSet
    │   │   │       └── ConfigVersionRowMapper.java    # ResultSet -> ConfigVersion (JSON parsing)
    │   │   ├── utils/
    │   │   │   ├── CustomException.java               # DIGIT-style error with code + message map
    │   │   │   └── ResponseUtil.java                  # Response envelope helpers
    │   │   └── web/model/
    │   │       ├── AuditDetails.java
    │   │       ├── Config.java
    │   │       ├── ConfigRequest.java
    │   │       ├── ConfigResolveRequest.java
    │   │       ├── ConfigResolveResponse.java
    │   │       ├── ConfigResponse.java
    │   │       ├── ConfigSearchCriteria.java
    │   │       ├── ConfigSearchRequest.java
    │   │       ├── ConfigSet.java
    │   │       ├── ConfigSetActivateRequest.java
    │   │       ├── ConfigSetActivateResponse.java
    │   │       ├── ConfigSetActivation.java
    │   │       ├── ConfigSetRequest.java
    │   │       ├── ConfigSetResponse.java
    │   │       ├── ConfigSetSearchCriteria.java
    │   │       ├── ConfigSetSearchRequest.java
    │   │       ├── ConfigVersion.java
    │   │       ├── ErrorResponse.java
    │   │       ├── Pagination.java
    │   │       ├── RequestInfo.java
    │   │       ├── ResponseInfo.java
    │   │       ├── TemplatePreviewRequest.java
    │   │       ├── TemplatePreviewResponse.java
    │   │       └── TemplateRef.java
    │   └── resources/
    │       ├── application.properties
    │       └── db/migration/
    │           ├── V1__create_config_table.sql         # Initial bootstrap table
    │           ├── V2__normalize_config_schema.sql     # Normalized 4-table schema
    │           └── V3__seed_config_data.sql            # OOTB seed configs
    └── test/java/org/egov/config/
        ├── ConfigServiceApplicationTests.java          # Context load test
        └── controller/
            └── ConfigControllerTest.java               # 13 integration tests
```
