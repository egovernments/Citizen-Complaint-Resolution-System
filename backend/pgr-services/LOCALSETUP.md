# Local Setup

> This guide covers running `pgr-services` on **DIGIT 3.0** (branch `pgr-on-digit3`).  
> For the DIGIT 2.x setup, refer to the `develop` branch version of this file.

---

## Prerequisites

| Tool | Version |
|---|---|
| Java | 21 |
| Maven | 3.8+ |
| PostgreSQL | 13+ |
| Redis | 6+ |
| Keycloak | 22+ |

---

## DIGIT 3.0 Platform Services Required

All of the following must be running before starting pgr-services. Use the Docker Compose setup at `examples/local-setup`:

```bash
cd /path/to/digitnxt/examples/local-setup
docker compose up -d
```

Services started by Docker Compose:

| Service | Default Port |
|---|---|
| Registry | 8104 |
| Workflow | 8085 |
| IdGen | 8100 |
| Boundary | 8093 |
| Individual | 8105 |
| Filestore | 8102 |
| Keycloak | 8080 |
| Redis | 6380 |
| PostgreSQL | 5432 |

---

## application.properties — Key Values to Set

```ini
# Database
spring.datasource.url=jdbc:postgresql://localhost:5432/pgr
spring.datasource.username=postgres
spring.datasource.password=postgres

# Keycloak JWT
spring.security.oauth2.resourceserver.jwt.issuer-uri=http://localhost:8080/realms/<your-realm>

# Redis
spring.data.redis.host=localhost
spring.data.redis.port=6380

# DIGIT 3.0 service URLs
digit.services.registry.base-url=http://localhost:8104
digit.services.workflow.base-url=http://localhost:8085
digit.services.idgen.base-url=http://localhost:8100
digit.services.boundary.base-url=http://localhost:8093
digit.services.individual.base-url=http://localhost:8105
digit.services.filestore.base-url=http://localhost:8102

# Registry schema codes (must match what is seeded in Registry)
pgr.registry.schema-code=PGR.ServiceCategory
pgr.registry.pgr-storage.schema-code=pgr2

# Workflow process code (must match what is configured in Workflow service)
pgr.workflow.processCode=PGR100
pgr.tenant-id=<your-tenant-id>
```

---

## Build and Run

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/backend/pgr-services
git checkout pgr-on-digit3

# Build
JAVA_HOME=/path/to/java-21 mvn clean package -DskipTests

# Run
JAVA_HOME=/path/to/java-21 mvn spring-boot:run
```

Service starts on port `8280` at context path `/pgr-services`.

---

## Authentication

All endpoints (except `/pgr-services/health`) require a valid Keycloak JWT:

```
Authorization: Bearer <access_token>
```

Obtain a token from Keycloak:
```bash
curl -X POST http://localhost:8080/realms/<realm>/protocol/openid-connect/token \
  -d "client_id=<client>&grant_type=password&username=<user>&password=<pass>" \
  | jq .access_token
```

---

## Quick Smoke Test

```bash
# Create a complaint
curl -X POST http://localhost:8280/pgr-services/v2/request/_create \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "service": {
      "tenantId": "<tenant>",
      "serviceCode": "NoStreetLight",
      "description": "Street light not working",
      "source": "mobile",
      "address": { "locality": { "code": "LOC001" } }
    },
    "workflow": { "action": "APPLY" }
  }'

# Search
curl -X POST http://localhost:8280/pgr-services/v2/request/_search \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "tenantId": "<tenant>" }'
```

---

## Infrastructure Checklist

- [x] PostgreSQL
- [x] Redis
- [x] Keycloak
- [x] Registry service
- [x] Workflow service
- [x] IdGen service
- [x] Boundary service
- [x] Individual service
- [ ] Kafka — **not required** in DIGIT 3.0
