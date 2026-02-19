# DIGIT CRS - Local Development Stack

Run a complete DIGIT development environment locally with Docker Compose. Includes all core services, PGR (Public Grievance Redressal) module, DIGIT UI, and tools for loading master data and running API tests.

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose v2)
- 8 GB RAM available for Docker (runs in ~3.8 GB)
- `npm` (for running Postman tests with Newman)
- Python 3.8+ (for the DataLoader)

**Optional (for hot reload development):**
- [Patched Tilt](#installing-patched-tilt) (for the Tilt dashboard)
- Maven 3.9+ (for PGR Java hot reload)
- Node.js 14+ and Yarn (for UI hot reload)

## Quick Start (Docker Compose)

```bash
# 1. Clone and navigate to local-setup
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/local-setup

# 2. Start all services
docker compose up -d

# 3. Wait for services to become healthy (~3-5 minutes)
watch 'docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -v "Exited"'

# 4. Verify health
./scripts/health-check.sh

# 5. Access the UI
open http://localhost:18000/digit-ui/
```

### Default Credentials

| Username | Password | Type | Tenant | Roles |
|----------|----------|------|--------|-------|
| `ADMIN` | `eGov@123` | EMPLOYEE | pg | SUPERUSER, EMPLOYEE, PGR-ADMIN, GRO (pg.citya) |

Login at the UI as `ADMIN` with city "City A", or via API:

```bash
curl -X POST "http://localhost:18000/user/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "username=ADMIN&password=eGov@123&tenantId=pg&grant_type=password&scope=read&userType=EMPLOYEE"
```

### Stopping

```bash
docker compose down        # Stop (preserves data)
docker compose down -v     # Stop and delete all data
```

## Loading Master Data (Jupyter Notebook)

The DataLoader notebook (`jupyter/dataloader/DataLoader_v2.ipynb`) lets you set up a new tenant with all the master data needed for PGR. It runs inside a Jupyter Lab instance bundled with the stack.

### Starting Jupyter

```bash
# Start Jupyter Lab (already defined in docker-compose, just needs to be started)
docker compose up -d jupyter

# Access at http://localhost:18888
# Token: displayed in logs
docker compose logs jupyter | grep token
```

Or if using Tilt, click the "Start Jupyter" button in the dashboard.

### DataLoader Phases

The notebook walks through 6 phases. Run each cell in order:

| Phase | What it does | Required? |
|-------|-------------|-----------|
| **1. Tenant & Branding** | Creates a new tenant (e.g., `pg.myorg`) with UI customization | Yes |
| **2a. Boundary Template** | Generates an Excel template for administrative hierarchy | Yes |
| **2b. Load Boundaries** | Uploads the filled boundary hierarchy (State > District > Block) | Yes |
| **3. Common Masters** | Loads departments, designations, complaint types, and localizations | Yes |
| **4. Employees** | Creates staff accounts with roles and department assignments via HRMS | Yes |
| **5. Localizations** | Bulk loads translations for additional languages (Hindi, Tamil, etc.) | Optional |
| **6. Workflow** | Configures the PGR complaint state machine | Yes |

### Configuration

Edit these variables at the top of the notebook:

```python
URL = "http://kong:8000"          # Kong gateway (inside Docker network)
USERNAME = "ADMIN"                 # Superuser
PASSWORD = "eGov@123"
TENANT_ID = "pg"                   # Root tenant for login
TARGET_TENANT = "pg.myorg"         # New tenant to create
```

### Key Classes

- `CRSLoader` (in `crs_loader.py`) - Main loader. Handles auth, tenant creation, master data loading
- `CRSLoader.create_employee()` - Creates a single HRMS employee with proper department assignment
- `CRSLoader.load_common_masters()` - Loads departments, designations, complaint types from Excel
- `CRSLoader.load_workflow()` - Loads the PGR workflow state machine

### Rollback

Each phase has a rollback function in the notebook:

```python
loader.full_reset(TARGET_TENANT)              # Reset everything
loader.rollback_common_masters(TARGET_TENANT)  # Just masters
loader.delete_boundaries(TARGET_TENANT)        # Just boundaries
```

## Postman Collections

Two Postman collections are included for API testing:

| Collection | File | Purpose |
|-----------|------|---------|
| Core Validation | `postman/digit-core-validation.postman_collection.json` | Validates all core service APIs are responding |
| Complaints Demo | `postman/complaints-demo.postman_collection.json` | Full PGR lifecycle: Create > Assign > Resolve > Rate & Close |

### Running with Newman (CLI)

**Core validation** (no auth needed):

```bash
npx newman run postman/digit-core-validation.postman_collection.json \
  --env-var "baseUrl=http://localhost"
```

**Complaints demo** (requires an HRMS employee user):

```bash
npx newman run postman/complaints-demo.postman_collection.json \
  --env-var "url=http://localhost:18000" \
  --env-var "username=CI-ADMIN" \
  --env-var "password=eGov@123" \
  --env-var "cityTenant=pg.citest" \
  --env-var "stateTenant=pg" \
  --env-var "userType=EMPLOYEE" \
  --env-var "authorization=Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  --env-var "serviceCode=RequestSprayingOrFoggingOperation"
```

### Complaints Demo Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `url` | Kong gateway URL | `http://localhost:18000` |
| `username` | Employee username | `CI-ADMIN` |
| `password` | Employee password | `eGov@123` |
| `cityTenant` | City-level tenant | `pg.citest` |
| `stateTenant` | State-level tenant | `pg` |
| `userType` | Must be `EMPLOYEE` | `EMPLOYEE` |
| `authorization` | OAuth client credentials | `Basic ZWdvdi11c2VyLWNsaWVudDo=` |
| `serviceCode` | (Optional) Specific complaint type to test | `RequestSprayingOrFoggingOperation` |

If `serviceCode` is not set, the collection picks a random complaint type.

### CI DataLoader

For automated testing, use the CI dataloader script instead of the Jupyter notebook. It creates a tenant, loads masters, creates an HRMS employee in the correct department, and outputs the `serviceCode` for Newman:

```bash
pip install requests openpyxl pandas python-dotenv

DIGIT_URL=http://localhost:18000 \
TARGET_TENANT=pg.mytest \
python3 scripts/ci-dataloader.py

# Output:
# CI_TENANT=pg.mytest
# CI_USER=CI-ADMIN
# CI_SERVICE_CODE=RequestSprayingOrFoggingOperation
```

The script performs 6 steps:
1. Login as superuser
2. Create target tenant
3. Load common masters (departments, designations, complaint types)
4. Look up a ServiceDef to find which department handles it
5. Create an HRMS employee in that department (with all PGR roles)
6. Load the PGR workflow

## What's Included

### Infrastructure

| Service | Host Port | Memory | Description |
|---------|-----------|--------|-------------|
| Postgres | 15432 | 768 MB | Database (with PgBouncer at 5432 internally) |
| Redis | 16379 | 128 MB | Cache |
| Redpanda | 19092 | 300 MB | Kafka-compatible event streaming |
| MinIO | 19000 | 256 MB | S3-compatible file storage |

### Core Services

| Service | Host Port | Memory | Health Check |
|---------|-----------|--------|--------------|
| MDMS v2 | 18094 | 512 MB | `/mdms-v2/health` |
| User | 18107 | 512 MB | `/user/health` |
| Workflow v2 | 18109 | 320 MB | `/egov-workflow-v2/health` |
| Localization | 18096 | 320 MB | `/localization/actuator/health` |
| Boundary v2 | 18081 | 256 MB | `/boundary-service/actuator/health` |
| Access Control | 18090 | 256 MB | `/access/health` |
| IDGEN | 18088 | 256 MB | `/egov-idgen/health` |
| ENC | 11234 | 300 MB | `/egov-enc-service/actuator/health` |
| Persister | 18091 | 256 MB | `/common-persist/actuator/health` |
| Filestore | - | 384 MB | `/filestore/health` |
| HRMS | - | 256 MB | `/egov-hrms/health` |

### Application

| Service | Host Port | Memory | Description |
|---------|-----------|--------|-------------|
| PGR Services | 18083 | 300 MB | Complaint management API |
| DIGIT UI | 18080 | 128 MB | React frontend (static) |
| Kong Gateway | 18000 | 256 MB | API gateway (main entry point) |

### Tools (optional)

| Service | Port | Description |
|---------|------|-------------|
| Jupyter Lab | 18888 | DataLoader notebook |
| Gatus | 18181 | Health monitoring dashboard |

### Resource Usage

| Component | Memory |
|-----------|--------|
| Infrastructure (Postgres, Redis, Redpanda, MinIO) | ~1.5 GB |
| Core Services (11 Java/Node services) | ~3.0 GB |
| Application (PGR, UI, Kong) | ~0.7 GB |
| **Total** | **~3.8 GB** |

All services have memory limits set in `docker-compose.yml` to prevent runaway usage.

## Development with Tilt

Tilt provides a better development experience with a dashboard, live logs, and hot reload:

```bash
# Install patched Tilt (see below), then:
tilt up

# Dashboard: http://localhost:10350
```

### Installing Patched Tilt

This project requires a patched version of Tilt that waits for Docker Compose health checks. The upstream Tilt has a bug where it marks containers "ready" before health checks pass.

```bash
# Linux amd64
curl -fsSL https://github.com/ChakshuGautam/tilt/releases/download/v0.36.3-healthcheck/tilt-linux-amd64.gz \
  | gunzip > /usr/local/bin/tilt
chmod +x /usr/local/bin/tilt
```

PR to upstream: https://github.com/tilt-dev/tilt/pull/6682

### Hot Reload

**PGR Services (Java)** - requires Maven:
```bash
tilt up
# Edit backend/pgr-services/src/main/java/...
# Tilt recompiles with Maven and syncs the JAR to the container
```

**DIGIT UI (React)** - requires Node.js + Yarn:
```bash
tilt up
# Enable "ui-watch" in Tilt dashboard, or manually:
cd ../frontend/micro-ui/web && yarn install && yarn build:webpack --watch
```

**CI Mode** (no hot reload, builds Docker images instead):
```bash
TILT_CI=1 tilt up
```

## API Access

All APIs go through Kong at `http://localhost:18000`:

```bash
# MDMS search
curl -X POST "http://localhost:18000/mdms-v2/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{"MdmsCriteria":{"tenantId":"pg","moduleDetails":[{"moduleName":"tenant","masterDetails":[{"name":"tenants"}]}]},"RequestInfo":{"apiId":"Rainmaker"}}'

# PGR search
curl -X POST "http://localhost:18000/pgr-services/v2/request/_search" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","authToken":"YOUR_TOKEN"},"tenantId":"pg.citya"}'
```

## Database Access

```bash
docker exec -it docker-postgres psql -U egov -d egov
```

## Troubleshooting

### Services not starting
```bash
docker compose logs <service-name>     # Check logs
docker compose restart <service-name>  # Restart one service
```

### PGR Assign returns "DEPARTMENT_NOT_FOUND"
The assignee must be an HRMS employee (not just a user) with a department matching the complaint type's ServiceDef. Use the DataLoader notebook (Phase 4) or `ci-dataloader.py` to create proper HRMS employees.

### UI showing blank page
```bash
curl http://localhost:18000/digit-ui/globalConfigs.js  # Should return JS config
```

### Reset everything
```bash
docker compose down -v     # Delete all data
docker compose up -d       # Fresh start
```

## Project Structure

```
local-setup/
├── docker-compose.yml           # Main service definitions (~3.8GB RAM)
├── docker-compose.deploy.yaml   # Deploy variant (no resource limits)
├── Tiltfile                     # Tilt orchestration
├── kong/
│   └── kong.yml                 # API gateway route config
├── db/
│   └── full-dump.sql            # Database seed (tenants, MDMS, users)
├── configs/
│   └── persister/               # Persister YAML configs (9 files)
├── jupyter/
│   └── dataloader/
│       ├── DataLoader_v2.ipynb  # Interactive data loader notebook
│       ├── crs_loader.py        # Loader library (used by notebook + CI)
│       ├── unified_loader.py    # Low-level MDMS/HRMS API wrapper
│       └── templates/           # Excel templates for master data
├── postman/
│   ├── complaints-demo.postman_collection.json    # PGR lifecycle tests
│   └── digit-core-validation.postman_collection.json  # Core API tests
├── scripts/
│   ├── ci-dataloader.py         # Automated tenant + employee setup
│   ├── health-check.sh          # Service health verification
│   ├── smoke-tests.sh           # API smoke tests
│   └── run-postman.sh           # Newman wrapper
├── nginx/                       # Nginx configs for MDMS proxy, UI
├── gatus/                       # Health monitoring dashboard config
└── docs/                        # Additional documentation
    ├── REMOTE-DEV-SETUP.md
    └── HYBRID-SETUP.md

../backend/pgr-services/         # PGR Java source (hot reload target)
../frontend/micro-ui/            # DIGIT UI React source (hot reload target)
../configs/assets/               # Runtime configs (globalConfigs.js)
```
