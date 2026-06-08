# PGR Service — DIGIT 3.0 Migration

**Branch:** `pgr-on-digit3`  
**Status:** In Progress  
**Author:** Lokendra Tyagi  
**Date:** June 2026

---

## Overview

This document covers the migration of `pgr-services` from DIGIT 2.x to the DIGIT 3.0 platform. The goal is to recreate PGR as-is — same business logic, same APIs, same workflow — but running on the new platform stack.

---

## What Changed at the Platform Level

| Concern | DIGIT 2.x (old) | DIGIT 3.0 (new) |
|---|---|---|
| **Authentication** | `RequestInfo` + egov-user service | OAuth2 / JWT (Keycloak) |
| **Persistence** | Kafka → Persister → PostgreSQL | `RegistryClient` (direct HTTP) |
| **Service code validation** | MDMS | Registry (schema-based) |
| **Citizen / user lookup** | egov-user service | `IndividualClient` |
| **Boundary validation** | HTTP call to boundary-service | `BoundaryClient` (digit-client) |
| **Workflow** | HTTP calls to egov-workflow-v2 | `WorkflowClient` (digit-client) |
| **ID generation** | HTTP call to egov-idgen | `IdGenClient` (digit-client) |
| **Caching** | None | Redis (boundary, individual, service codes) |
| **SDK** | `egov-tracer`, `mdms-client` | `digit-client` (unified) |
| **Java / Spring Boot** | Java 17, Spring Boot 3.2.2 | Java 21, Spring Boot 3.4.5 |
| **Messaging** | Kafka (produce/consume) | Removed — no Kafka dependency |

---

## What Was Removed

These existed in DIGIT 2.x but have no equivalent in DIGIT 3.0:

- **Kafka producer + consumers** — all write/notify flows were Kafka-based; now replaced by direct HTTP via `digit-client`
- **Persister service** — complaints were asynchronously written to DB via Kafka; now written synchronously to Registry
- **MDMS** — service code, department validation; replaced by Registry schema lookup
- **HRMS** — employee/department enrichment in notifications and escalation; removed
- **egov-user** — citizen user create/search/update; replaced by `IndividualClient`
- **Localization service** — used for SMS message templates; simplified to plain-text messages in 3.0
- **Migration service + controller** — v1→v2 data migration; not applicable in 3.0
- **egov-tracer** — request tracing and `CustomException`; replaced by standard Spring exceptions
- **`RequestInfo`** in all request bodies — auth context now comes from JWT claims

---

## What Is New

- **`RegistryService`** — handles save, update, search, count of complaints via `RegistryClient`
- **`RegistryCacheService`** — Redis-backed cache for boundary code, individual, and service code validation
- **`SecurityConfig`** — OAuth2 JWT resource server filter chain (Keycloak)
- **`CacheConfig`** — Redis cache manager with per-cache TTLs
- **JWT-based auth** — `userId`, `tenantId`, `roles` extracted from Keycloak JWT in every controller

---

## API Changes

The endpoints and their paths are unchanged. Only the request/response structure changes:

| What | Before | After |
|---|---|---|
| Request body (create/update) | `{ RequestInfo, service, workflow }` | `{ service, workflow }` — no RequestInfo |
| Auth | `RequestInfo.userInfo` in body | Bearer JWT token in `Authorization` header |
| Response | `{ ResponseInfo, ServiceWrappers[] }` | `{ ServiceWrappers[] }` — no ResponseInfo |
| Search body | `{ RequestInfo }` + query params | Query params only (or JSON body) |

**Endpoints (unchanged paths):**

| Method | Path | Description |
|---|---|---|
| POST | `/v2/request/_create` | Raise a complaint |
| POST | `/v2/request/_update` | Update / transition a complaint |
| POST | `/v2/request/_search` | Search complaints |
| POST | `/v2/request/_plainsearch` | Inter-service search (no auth enrichment) |
| POST | `/v2/request/_count` | Count complaints |
| GET | `/v2/dashboard` | Dashboard KPIs |
| POST | `/v2/analytics/_query` | Dynamic analytics queries |
| POST | `/v2/analytics/_schema` | Analytics catalog |

---

## Impact on Dependent Services

| Service | Impact |
|---|---|
| **Frontend / Citizen App** | Must send `Authorization: Bearer <JWT>` header; remove `RequestInfo` from request body |
| **Employee App** | Same as above; roles come from JWT `realm_access.roles` claim |
| **Inbox Service** | Plain search endpoint unchanged; no RequestInfo needed |
| **Notification Service** | SMS no longer dispatched via Kafka; dispatched via direct HTTP |
| **Escalation** | No longer reads SLA config from MDMS; uses `pgr.escalation.default.sla.ms` from config |
| **Dashboard** | Materialized views still work; refresh scheduler unchanged |
| **Analytics** | `RequestInfo` removed from `/_query` body; auth via JWT |

---

## Configuration Changes

### Removed properties
```
kafka.*                        (all Kafka config)
egov.mdms.*                    (MDMS)
egov.hrms.*                    (HRMS)
egov.user.*                    (egov-user service)
egov.localization.*            (localization service)
pgr.kafka.*.topic              (all Kafka topics)
egov.idgen.*                   (old idgen HTTP config)
egov.workflow.*                (old workflow HTTP config)
egov.boundary.*                (old boundary HTTP config)
```

### Added properties
```
spring.security.oauth2.resourceserver.jwt.issuer-uri
digit.services.*.base-url      (unified digit-client URLs)
digit.propagate.headers.*
idgen.templateCode
pgr.workflow.processCode
pgr.registry.schema-code
pgr.registry.pgr-storage.schema-code
spring.data.redis.*
complaints.domain.events.enabled
```

---

## Dependencies

### Infrastructure
- PostgreSQL (still required for dashboard MVs)
- Redis (new — for validation caching)
- Keycloak (new — JWT auth)

### DIGIT 3.0 Platform Services
- Registry service
- Workflow service (v3)
- IdGen service (v3)
- Boundary service (v3)
- Individual service (v3)
- Filestore service (v3)

### Removed Infrastructure
- Kafka / Zookeeper — no longer required
- Persister service — no longer required

---

## Known Limitations / TODOs

1. **Mobile number search** — `IndividualClient` does not expose a search-by-mobile API; current implementation fetches all individuals and filters in memory. Needs a proper indexed search once the API is available.

2. **Escalation supervisor lookup** — HRMS-based supervisor resolution is removed. The escalation scheduler currently re-assigns to the same assignee list; a proper supervisor lookup via HRMS/Individual needs to be wired.

3. **SMS notifications** — Old Kafka-based SMS dispatch is replaced with a direct HTTP stub. The actual DIGIT 3.0 notification endpoint URL needs to be confirmed and configured.

4. **Localization** — SMS message templates are now plain English. Proper localized templates via a DIGIT 3.0 localization service can be added once the integration is confirmed.

5. **Multi-tenancy** — `replaceSchemaPlaceholder` is a no-op in 3.0 (single schema). Multi-schema support should be revisited if multi-state deployment is needed.

---

## How to Run Locally

### Prerequisites
- Java 21
- PostgreSQL
- Redis
- Keycloak (or any OAuth2 server)
- DIGIT 3.0 services running (Registry, Workflow, IdGen, Boundary, Individual)

### Steps
1. Clone the repo and switch to branch `pgr-on-digit3`
2. Update `application.properties`:
   - Set `spring.datasource.*` to your local PostgreSQL
   - Set `spring.security.oauth2.resourceserver.jwt.issuer-uri` to your Keycloak realm
   - Set `digit.services.*.base-url` to your locally running DIGIT 3.0 services
   - Set `spring.data.redis.*` to your local Redis
3. Build and run:
   ```bash
   JAVA_HOME=<path-to-java-21> mvn spring-boot:run
   ```

### Local DIGIT 3.0 setup
Refer to [`/examples/local-setup`](../../../../digitnxt/examples/local-setup) for Docker Compose setup of all DIGIT 3.0 platform services.
