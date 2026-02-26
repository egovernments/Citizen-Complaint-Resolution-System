# DIGIT User Preferences Service

A lightweight microservice for storing and managing user preferences including notification consent and language settings for the DIGIT platform.

## Overview

The User Preferences Service is part of the WhatsApp Bidirectional Notifications architecture. It provides:

- **Consent Management**: Track user consent for notification channels (WhatsApp, SMS, Email)
- **Language Preferences**: Store user's preferred language for notifications
- **Multi-tenant Support**: Preferences can be scoped globally or per-tenant
- **DIGIT Integration**: Follows DIGIT platform contracts (RequestInfo/ResponseInfo pattern)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Preferences Service                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────┐    │
│  │   Handler   │───▶│   Service   │───▶│   Repository     │    │
│  │  (Gin API)  │    │  (Business  │    │  (GORM/Postgres) │    │
│  │             │    │   Logic)    │    │                  │    │
│  └─────────────┘    └─────────────┘    └──────────────────┘    │
│         │                  │                    │               │
│         ▼                  ▼                    ▼               │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────┐    │
│  │   Routes    │    │ Validation  │    │   PostgreSQL     │    │
│  │             │    │ Enrichment  │    │                  │    │
│  └─────────────┘    └─────────────┘    └──────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Features

- **RESTful API** with DIGIT-compliant request/response contracts
- **Gin Framework** - High-performance HTTP framework
- **GORM** - ORM for database operations
- **Auto-Migration** - Database tables and indexes created automatically on startup
- **Idempotent Upsert** - Create or update preferences in a single operation
- **Flexible Payload** - JSONB storage for extensible preference data
- **Comprehensive Validation** - Dedicated validation layer with detailed error messages
- **Data Enrichment** - Automatic ID generation and audit trail population
- **Health Checks** - Database connectivity monitoring
- **Graceful Shutdown** - Clean connection handling on termination
- **Docker Ready** - Multi-stage Dockerfile and docker-compose for development
- **Kubernetes Ready** - Includes health probes and resource configurations

## API Reference

### Base URL
```
http://localhost:8080/user-preference
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/user-preference/v1/_upsert` | Create or update a preference |
| POST | `/user-preference/v1/_search` | Search preferences by criteria |
| GET | `/health` | Health check endpoint |

---

### POST /user-preference/v1/_upsert

Creates a new preference or updates an existing one (idempotent).

**Request:**
```json
{
  "requestInfo": {
    "apiId": "user-preferences",
    "ver": "1.0",
    "ts": 1699900000000,
    "action": "upsert",
    "msgId": "msg-123",
    "authToken": "Bearer <token>",
    "userInfo": {
      "uuid": "user-uuid-123",
      "tenantId": "pb.amritsar"
    }
  },
  "preference": {
    "userId": "user-uuid-123",
    "tenantId": "pb.amritsar",
    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
    "payload": {
      "preferredLanguage": "en_IN",
      "consent": {
        "WHATSAPP": {
          "status": "GRANTED",
          "scope": "GLOBAL"
        },
        "SMS": {
          "status": "GRANTED",
          "scope": "TENANT",
          "tenantId": "pb.amritsar"
        },
        "EMAIL": {
          "status": "REVOKED",
          "scope": "GLOBAL"
        }
      }
    }
  }
}
```

**Response (200 OK):**
```json
{
  "responseInfo": {
    "apiId": "user-preferences",
    "ver": "1.0",
    "ts": 1699900000100,
    "msgId": "msg-123",
    "status": "successful"
  },
  "preferences": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "user-uuid-123",
      "tenantId": "pb.amritsar",
      "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
      "payload": {
        "preferredLanguage": "en_IN",
        "consent": {
          "WHATSAPP": { "status": "GRANTED", "scope": "GLOBAL" },
          "SMS": { "status": "GRANTED", "scope": "TENANT", "tenantId": "pb.amritsar" },
          "EMAIL": { "status": "REVOKED", "scope": "GLOBAL" }
        }
      },
      "auditDetails": {
        "createdBy": "user-uuid-123",
        "createdTime": 1699900000100,
        "lastModifiedBy": "user-uuid-123",
        "lastModifiedTime": 1699900000100
      }
    }
  ]
}
```

---

### POST /user-preference/v1/_search

Search for preferences matching the given criteria.

**Request:**
```json
{
  "requestInfo": {
    "apiId": "user-preferences",
    "ver": "1.0",
    "msgId": "msg-456"
  },
  "criteria": {
    "userId": "user-uuid-123",
    "tenantId": "pb.amritsar",
    "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
    "limit": 10,
    "offset": 0
  }
}
```

**Response (200 OK):**
```json
{
  "responseInfo": {
    "apiId": "user-preferences",
    "ver": "1.0",
    "ts": 1699900000200,
    "msgId": "msg-456",
    "status": "successful"
  },
  "preferences": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "user-uuid-123",
      "tenantId": "pb.amritsar",
      "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
      "payload": { ... },
      "auditDetails": { ... }
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "totalCount": 1
  }
}
```

---

### GET /health

Health check endpoint for monitoring and load balancers.

**Response (200 OK):**
```json
{
  "status": "UP",
  "components": {
    "database": {
      "status": "UP"
    }
  }
}
```

---

### Error Response

All errors follow the DIGIT error response format:

```json
{
  "responseInfo": {
    "apiId": "user-preferences",
    "ver": "1.0",
    "ts": 1699900000300,
    "status": "failed"
  },
  "Errors": [
    {
      "code": "INVALID_USER_ID",
      "message": "userId is required"
    }
  ]
}
```

**Common Error Codes:**

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_REQUEST_INFO` | 400 | requestInfo is missing |
| `INVALID_USER_ID` | 400 | userId is missing or invalid |
| `INVALID_PREFERENCE_CODE` | 400 | preferenceCode is missing or invalid |
| `INVALID_PAYLOAD` | 400 | payload is missing or invalid JSON |
| `INVALID_CRITERIA` | 400 | No search criteria provided |
| `INVALID_LANGUAGE` | 400 | Invalid preferredLanguage value |
| `INVALID_CONSENT_STATUS` | 400 | Consent status must be GRANTED or REVOKED |
| `INVALID_CONSENT_SCOPE` | 400 | Consent scope must be GLOBAL or TENANT |
| `MISSING_TENANT_ID` | 400 | TENANT scope requires tenantId |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Data Model

### Preference Payload Schema

```json
{
  "preferredLanguage": "en_IN | hi_IN | ta_IN",
  "consent": {
    "WHATSAPP": {
      "status": "GRANTED | REVOKED",
      "scope": "GLOBAL | TENANT",
      "tenantId": "string (required if scope is TENANT)"
    },
    "SMS": { ... },
    "EMAIL": { ... }
  }
}
```

### Database Schema

```sql
CREATE TABLE user_preference (
    id UUID PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64),
    preference_code VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_by VARCHAR(64) NOT NULL,
    created_time BIGINT NOT NULL,
    last_modified_by VARCHAR(64) NOT NULL,
    last_modified_time BIGINT NOT NULL
);

-- Unique constraint ensures one preference per user/tenant/code
CREATE UNIQUE INDEX idx_user_preference_unique
    ON user_preference (user_id, COALESCE(tenant_id, ''), preference_code);
```

## Configuration

Configuration is loaded from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_PORT` | `8080` | HTTP server port |
| `SERVER_CONTEXT_PATH` | `/user-preference` | API context path |
| `SERVER_READ_TIMEOUT` | `15s` | Request read timeout |
| `SERVER_WRITE_TIMEOUT` | `15s` | Response write timeout |
| `SERVER_SHUTDOWN_TIMEOUT` | `30s` | Graceful shutdown timeout |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `` | Database password |
| `DB_NAME` | `user_preferences` | Database name |
| `DB_SSL_MODE` | `disable` | SSL mode (disable/require/verify-full) |
| `DB_MAX_CONNS` | `25` | Maximum pool connections |
| `DB_MIN_CONNS` | `5` | Minimum pool connections |
| `DB_MAX_CONN_LIFETIME` | `1h` | Maximum connection lifetime |
| `DB_MAX_CONN_IDLE_TIME` | `30m` | Maximum idle time |
| `GIN_MODE` | `release` | Gin mode (debug/release/test) |

## Getting Started

### Prerequisites

- Go 1.23+
- PostgreSQL 12+ (tested with 15)
- Docker & Docker Compose (optional)

### Quick Start with Docker

```bash
# Clone and navigate to the service
cd digit-user-preferences-service

# Start PostgreSQL and the service
docker-compose up -d

# Check health
curl http://localhost:8080/health
```

### Manual Setup

```bash
# 1. Setup PostgreSQL database (table is auto-created on startup)
createdb user_preferences

# 2. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 3. Download dependencies
go mod tidy

# 4. Run the service (tables are created automatically)
make run
# or
go run cmd/server/main.go
```

> **Note:** The service automatically creates the `user_preference` table and indexes on startup. No manual migration is required.

### Running Tests

```bash
# Run all tests
make test

# Run tests with coverage
make test-coverage

# View coverage report
open coverage.html
```

## Development

### Project Structure

```
.
├── cmd/
│   └── server/
│       └── main.go                  # Application entry point
├── db/
│   ├── postgres.go                  # Database connection
│   └── migrations/
│       └── V20260205120000__create_user_preference.sql
├── internal/
│   ├── config/
│   │   └── config.go                # Configuration loading
│   ├── enrichment/
│   │   └── preference_enricher.go   # Data enrichment
│   ├── handler/
│   │   └── preference_handler.go    # HTTP handlers (Gin)
│   ├── model/
│   │   └── models.go                # Domain models (API + GORM)
│   ├── repository/
│   │   └── preference_repository.go # Database operations (GORM)
│   ├── routes/
│   │   └── routes.go                # Route registration
│   ├── service/
│   │   └── preference_service.go    # Business logic
│   └── validation/
│       └── preference_validation.go # Input validation
├── pkg/
│   └── digit/
│       └── contracts.go             # DIGIT common contracts
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── go.mod
└── README.md
```

### Make Commands

```bash
make build          # Build binary
make test           # Run tests
make test-coverage  # Run tests with coverage
make run            # Run locally
make dev            # Run with hot reload (requires air)
make lint           # Run linter
make fmt            # Format code
make docker-build   # Build Docker image
make docker-up      # Start with Docker Compose
make docker-down    # Stop Docker Compose
make help           # Show all commands
```

## Integration

### With digit-novu-bridge

The novu-bridge service calls this service to:
1. Check user consent before sending notifications
2. Get preferred language for template localization

```go
// Example: Check WhatsApp consent
resp, _ := client.Search(ctx, &PreferenceSearchRequest{
    RequestInfo: reqInfo,
    Criteria: &PreferenceCriteria{
        UserId: recipientId,
        PreferenceCode: "USER_NOTIFICATION_PREFERENCES",
    },
})

if len(resp.Preferences) > 0 {
    payload, _ := resp.Preferences[0].GetPayload()
    if payload.Consent.WhatsApp.Status == "GRANTED" {
        // Proceed with notification
    }
}
```

### With DIGIT Platform

- Uses standard DIGIT RequestInfo/ResponseInfo contracts
- Compatible with DIGIT authentication (JWT tokens)
- Follows DIGIT multi-tenancy patterns

## Deployment

### Auto-Migration

The service **automatically creates** the database table and indexes on startup. No manual migration is required.

**What happens on startup:**
1. Service connects to PostgreSQL
2. Checks if `user_preference` table exists
3. Creates table and indexes if they don't exist
4. Service starts accepting requests

**Indexes created automatically:**
- `idx_user_id` - For user lookups
- `idx_tenant_id` - For tenant-scoped queries
- `idx_preference_code` - For preference type queries
- `idx_created_time` - For sorting by creation time

### Deployment Checklist

| Requirement | Details |
|-------------|---------|
| PostgreSQL | Version 12+ (managed or self-hosted) |
| Database | Create empty database (e.g., `user_preferences`) |
| Table | Auto-created by service |
| Indexes | Auto-created by service |
| Migrations | Not required (handled automatically) |

### Production Environment Variables

```bash
# Server Configuration
SERVER_PORT=8080
SERVER_CONTEXT_PATH=/user-preference
GIN_MODE=release

# Database Configuration
DB_HOST=<your-postgres-host>
DB_PORT=5432
DB_USER=<db-user>
DB_PASSWORD=<db-password>
DB_NAME=user_preferences
DB_SSL_MODE=require          # Use 'require' for production
DB_MAX_CONNS=25
DB_MIN_CONNS=5
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-preference-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: user-preference-service
  template:
    metadata:
      labels:
        app: user-preference-service
    spec:
      containers:
      - name: user-preference-service
        image: digit-user-preferences-service:latest
        ports:
        - containerPort: 8080
        env:
        - name: SERVER_PORT
          value: "8080"
        - name: SERVER_CONTEXT_PATH
          value: "/user-preference"
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: host
        - name: DB_USER
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: username
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: password
        - name: DB_NAME
          value: "user_preferences"
        - name: DB_SSL_MODE
          value: "require"
        - name: GIN_MODE
          value: "release"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: user-preference-service
spec:
  selector:
    app: user-preference-service
  ports:
  - port: 8080
    targetPort: 8080
  type: ClusterIP
```

### Docker Deployment

```bash
# Build the image
docker build -t digit-user-preferences-service:latest .

# Run with environment variables
docker run -d \
  --name user-preference-service \
  -p 8080:8080 \
  -e DB_HOST=<postgres-host> \
  -e DB_PORT=5432 \
  -e DB_USER=<db-user> \
  -e DB_PASSWORD=<db-password> \
  -e DB_NAME=user_preferences \
  -e DB_SSL_MODE=require \
  -e GIN_MODE=release \
  digit-user-preferences-service:latest
```

### Health Check

The `/health` endpoint returns database connectivity status:

```bash
curl http://localhost:8080/health
```

**Response when healthy:**
```json
{
  "status": "UP",
  "components": {
    "database": {
      "status": "UP"
    }
  }
}
```

**Response when unhealthy:**
```json
{
  "status": "DOWN",
  "components": {
    "database": {
      "status": "DOWN"
    }
  }
}
```

Use this endpoint for:
- Kubernetes liveness/readiness probes
- Load balancer health checks
- Monitoring and alerting

## License

This project is part of the DIGIT platform by eGovernments Foundation.
