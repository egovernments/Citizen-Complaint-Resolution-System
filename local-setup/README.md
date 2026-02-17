# DIGIT Core Services - Local Development Stack

Run a complete DIGIT development environment locally with all core services, PGR module, and the DIGIT UI.

## Prerequisites
Ensure you have the following tools installed on your machine:
1. `docker compose`
2. `tilt`
3. `npm` 
4. Postman and newman CLI

## Quick Start

```bash
# 1. Clone the CCRS repo and navigate to local-setup
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/local-setup

# 2. Start with Tilt (recommended)
tilt up

# 3. Open the Tilt dashboard and verify the health of services
open http://localhost:10350/

# 4. Access DIGIT UI
open http://localhost:18000/digit-ui/
```

## Remote Development (Recommended for Teams)

Run everything on a shared remote server. Developers edit code via SSH — local file changes trigger rebuilds of downstream services (PGR, digit-ui) on the remote.

```bash
# On the remote server
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git ~/code/ccrs
cd ~/code/ccrs/local-setup
tilt up

# From your machine — forward ports
ssh -L 10350:localhost:10350 -L 18000:localhost:18000 dev-server
# Then open http://localhost:10350 (Tilt) and http://localhost:18000/digit-ui/ (UI)
```

Edit code on the server via VS Code Remote SSH, and Tilt automatically rebuilds the changed services. Only PGR and digit-ui rebuild on code changes — core services stay running.

See [docs/REMOTE-DEV-SETUP.md](docs/REMOTE-DEV-SETUP.md) for full setup including file sync, multi-developer workflows, and port forwarding.

For hybrid setups (core on remote, dev services on your laptop), see [docs/HYBRID-SETUP.md](docs/HYBRID-SETUP.md).
### Verify your set up

```bash
# 1. Check all services are healthy
./scripts/health-check.sh

# 2. Run smoke tests
./scripts/smoke-tests.sh

# 3. Test ID generation
curl -X POST "http://localhost:18088/egov-idgen/id/_generate" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"digit","ver":"1.0"},"idRequests":[{"tenantId":"pg","idName":"pgr.servicerequestid"}]}'
```

## Postman Collections (Newman)

Run the Postman collections via `scripts/run-postman.sh`. Set these environment variables before running to target your environment:

**Core validation collection**
- `BASE_URL` (example: `http://localhost`)

**Complaints demo collection**
- `URL` (example: `http://localhost:18000`)
- `USERNAME` (example: `ADMIN`)
- `PASSWORD` (example: `eGov@123`)
- `CITY_TENANT` (example: `pg.citya`)
- `STATE_TENANT` (example: `pg`)
- `USER_TYPE` (example: `EMPLOYEE`)
- `AUTHORIZATION` (example: `Basic ZWdvdi11c2VyLWNsaWVudDo=`)

Example:
```bash
BASE_URL=http://localhost \
URL=http://localhost:18000 \
CITY_TENANT=pg.citya \
STATE_TENANT=pg \
USERNAME=GRO \
PASSWORD=eGov@123 \
scripts/run-postman.sh all
```

## End-to-End Testing

### Test Credentials

A default admin user is created by the `user-schema-seed` service:

| Username | Password | Type | Tenant |
|----------|----------|------|--------|
| `ADMIN` | `eGov@123` | EMPLOYEE | pg |

**Note:** The admin user has roles: SUPERUSER, EMPLOYEE (pg), PGR-ADMIN, GRO (pg.citya)

### Manual UI Test Flow

1. Open http://localhost:18000/digit-ui/
2. Select language → Select city (City A)
3. Login as Employee: `ADMIN@pg` / `eGov@123`
4. Navigate to Complaints → Create new complaint
5. Fill form and submit
6. Verify complaint appears in inbox

### API Test Flow

```bash
# 1. Get auth token
TOKEN=$(curl -s -X POST "http://localhost:18000/user/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "username=ADMIN@pg&password=eGov@123&tenantId=pg&grant_type=password&scope=read&userType=EMPLOYEE" | jq -r '.access_token')

# 2. Create a complaint
curl -X POST "http://localhost:18000/pgr-services/v2/request/_create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "RequestInfo": {"apiId": "Rainmaker", "authToken": "'$TOKEN'"},
    "service": {
      "tenantId": "pg.citya",
      "serviceCode": "StreetLightNotWorking",
      "description": "Test complaint from API",
      "source": "web",
      "address": {"city": "pg.citya", "locality": {"code": "SL001"}}
    }
  }'

# 3. Search complaints
curl -X POST "http://localhost:18000/pgr-services/v2/request/_search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"RequestInfo": {"apiId": "Rainmaker", "authToken": "'$TOKEN'"}, "tenantId": "pg.citya"}'
```

## API Access

All APIs are available through Kong gateway at `http://localhost:18000`:

```bash
# MDMS search
curl -X POST "http://localhost:18000/mdms-v2/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{"MdmsCriteria":{"tenantId":"pg","moduleDetails":[{"moduleName":"tenant","masterDetails":[{"name":"tenants"}]}]},"RequestInfo":{"apiId":"Rainmaker"}}'

# User login (after creating user - see Test Credentials section)
curl -X POST "http://localhost:18000/user/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "username=ADMIN&password=eGov@123&tenantId=pg&grant_type=password&scope=read&userType=EMPLOYEE"
```

## Database Access

```bash
# Connect to Postgres
docker exec -it docker-postgres psql -U egov -d egov

# Common queries
\dt                          # List tables
SELECT * FROM eg_user LIMIT 5;
```

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- **Patched Tilt** (see below) - required for proper health check handling
- 8+ GB RAM available for Docker

**For hot reload development (optional):**
- Maven 3.9+ (for PGR Java hot reload)
- Node.js 14+ and Yarn (for UI hot reload)

### Installing Patched Tilt

This project requires a patched version of Tilt that properly waits for Docker Compose health checks before marking services as ready. The upstream Tilt has a bug where it considers containers "ready" as soon as they're "running", ignoring health check status.

```bash
# Linux amd64
curl -fsSL https://github.com/ChakshuGautam/tilt/releases/download/v0.36.3-healthcheck/tilt-linux-amd64.gz | gunzip > /usr/local/bin/tilt
chmod +x /usr/local/bin/tilt

# Verify installation
tilt version
# Should show: v0.36.3-dev
```

**Why is this needed?**
- Services like HRMS require other services (egov-user, egov-enc-service) to be fully healthy before starting
- Docker Compose `depends_on: condition: service_healthy` handles this correctly
- But Tilt bypasses this by using `--no-deps` and only checking if containers are "running"
- The patched Tilt checks the `HealthStatus` field and waits for "healthy" before proceeding

**PR to upstream:** https://github.com/tilt-dev/tilt/pull/6682

## What's Included

### Infrastructure
| Service | Port | Description |
|---------|------|-------------|
| Postgres | 15432 | Database |
| Redis | 16379 | Cache |
| Redpanda | 19092 | Kafka-compatible messaging |
| Elasticsearch | 19200 | Search & indexing |

### Core Services
| Service | Port | Health Check |
|---------|------|--------------|
| MDMS v2 | 18094 | `/mdms-v2/health` |
| User | 18107 | `/user/health` |
| Workflow v2 | 18109 | `/egov-workflow-v2/health` |
| Localization | 18096 | `/localization/actuator/health` |
| Location | 18084 | `/egov-location/health` |
| Boundary v2 | 18081 | `/boundary-service/actuator/health` |
| Access Control | 18090 | `/access/health` |
| IDGEN | 18088 | `/egov-idgen/health` |
| ENC | 11234 | `/egov-enc-service/actuator/health` |
| Persister | 18091 | `/common-persist/actuator/health` |

### Application
| Service | Port | URL |
|---------|------|-----|
| Kong Gateway | 18000 | Main entry point |
| DIGIT UI | 18080 | Static assets only |
| PGR Services | 18083 | `/pgr-services/health` |

## Development with Tilt

Tilt provides a better development experience with:
- Dashboard at http://localhost:10350
- Live logs for all services
- One-click restarts
- Health status monitoring

```bash
# Start everything
tilt up

# Stop everything
tilt down
```

### Tilt Dashboard Features
- **Health Check** button - runs all health checks
- **Smoke Tests** button - validates API functionality
- **Nuke DB** button - reset database (destructive)
- **Start Jupyter** - launch Jupyter Lab for data exploration
- **Start Gatus** - launch health monitoring dashboard

## Alternative: Docker Compose Only

```bash
# Start
docker compose up -d

# Watch logs
docker compose logs -f

# Stop
docker compose down

# Reset (remove volumes)
docker compose down -v
```

## Hot Reload Development

### PGR Services (Java)

Requires Maven installed locally.

```bash
# Start Tilt - it will compile PGR with Maven
tilt up

# Make changes to Java code
vim ../backend/pgr-services/src/main/java/...

# Tilt detects changes, recompiles, and syncs to container automatically
```

The `pgr-compile` resource in Tilt runs `mvn package` when source files change.

### DIGIT UI (React)

Requires Node.js and Yarn installed locally.

```bash
# Start Tilt
tilt up

# In Tilt UI (http://localhost:10350), enable the "ui-watch" resource
# Or run webpack watch manually:
cd ../frontend/micro-ui/web
yarn install
yarn build:webpack --watch

# Make changes to React code - webpack rebuilds, Tilt syncs to container
```

### CI Mode (No Hot Reload)

If you don't have Maven/Node installed, run in CI mode:

```bash
TILT_CI=1 tilt up
```

This builds images using Docker (slower initial build, no hot reload).

### Configuration
- `globalConfigs.js` is mounted from `CCRS/configs/assets/globalConfigsPGR.js`
- Edit this file to change tenant ID, API keys, feature flags



## Troubleshooting

### Services not starting
```bash
# Check service logs
docker compose logs <service-name>

# Restart a specific service
docker compose restart <service-name>
```

### UI showing blank page
- Check browser console for errors
- Verify globalConfigs.js is loaded: `curl http://localhost:18000/digit-ui/globalConfigs.js`
- Ensure CCRS repo is cloned correctly

### API returning errors
- Check Kong is running: `curl http://localhost:18000/`
- Check backend service health: `curl http://localhost:18094/mdms-v2/health`

### Reset everything
```bash
docker compose down -v
docker compose up -d
```

## Resource Usage

Optimized for ~4GB RAM usage:

| Component | Memory |
|-----------|--------|
| Infrastructure (Postgres, Redis, ES, Redpanda) | ~1.5 GB |
| Core Services (Java) | ~2 GB |
| Kong + UI | ~0.3 GB |
| **Total** | **~3.8 GB** |

## Project Structure

```
digit-core/
├── docker-compose.yml    # Service definitions
├── Tiltfile              # Tilt configuration
├── docker/
│   └── pgr-services/     # PGR Dockerfile for CI builds
├── kong/
│   └── kong.yml          # API gateway routes
├── db/
│   ├── seed.sql          # Database seed data
│   ├── tenant-seed.sql   # Tenant master data
│   └── mdms-*.sql        # MDMS seed data
├── configs/
│   └── persister/        # Persister YAML configs
├── scripts/
│   ├── health-check.sh   # Service health verification
│   └── smoke-tests.sh    # API smoke tests
└── gatus/
    └── config.yaml       # Health dashboard config

../                          # CCRS repo root
├── frontend/micro-ui/    # DIGIT UI source
├── backend/pgr-services/ # PGR Java source
└── configs/assets/       # Runtime configs
```
