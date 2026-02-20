# DIGIT CRS - Local Development Stack

Run the DIGIT Citizen Complaint Resolution System locally with Docker Compose or Tilt. This stack includes all core DIGIT services, the PGR (Public Grievance Redressal) module, a web UI, and tools for loading master data.

## Choose Your Setup Path

There are **two independent ways** to run this stack. Pick one:

| Path | Best for | What you need |
|------|----------|---------------|
| **[Option A: Docker Compose](#option-a-docker-compose)** | Quick setup, no extra tools | Docker only |
| **[Option B: Tilt](#option-b-tilt)** | Dashboard, grouped services, dev buttons | Docker + Tilt |

Both options run the same services. Tilt adds a web dashboard on top of Docker Compose. **You do NOT need to follow both paths.**

---

## Prerequisites

### Required

| Tool | Version | Install Link | What it's for |
|------|---------|-------------|---------------|
| [Docker Desktop](https://docs.docker.com/get-docker/) | 24+ | [Mac](https://docs.docker.com/desktop/install/mac-install/) / [Windows](https://docs.docker.com/desktop/install/windows-install/) / [Linux](https://docs.docker.com/desktop/install/linux/) | Runs all services as containers |
| [Docker Compose](https://docs.docker.com/compose/install/) | v2+ | Included with Docker Desktop | Orchestrates multi-container setup |
| [Git](https://git-scm.com/downloads) | 2.x | [Download](https://git-scm.com/downloads) | Clone the repository |

> **Memory**: Allocate at least **8 GB RAM** to Docker. The stack runs in ~3.8 GB but needs headroom. In Docker Desktop: Settings > Resources > Memory > 8 GB.

### Optional

| Tool | Install Link | When you need it |
|------|-------------|------------------|
| [Tilt](https://docs.tilt.dev/install.html) | [See Tilt install section](#installing-tilt) | Only if using Option B |
| [Node.js 20+](https://nodejs.org/en/download/) | [Download](https://nodejs.org/) | Running Postman tests with Newman (`npx`) |
| [Python 3.8+](https://www.python.org/downloads/) | [Download](https://www.python.org/downloads/) | Running the CI dataloader script |
| [Maven 3.9+](https://maven.apache.org/download.cgi) | [Download](https://maven.apache.org/download.cgi) | Hot reload for PGR Java code (Tilt only) |
| [Yarn](https://yarnpkg.com/getting-started/install) | [Download](https://yarnpkg.com/) | Hot reload for DIGIT UI (Tilt only) |

---

## Option A: Docker Compose

### Step 1: Clone the repository

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/local-setup
```

### Step 2: Start all services

```bash
docker compose up -d
```

This pulls ~20 container images and starts them. First run takes 5-10 minutes to download images.

### Step 3: Wait for services to become healthy

```bash
# Watch containers until all show "healthy" (~3-5 minutes after images are pulled)
watch 'docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -v "Exited"'
```

**What to expect**: You'll see containers transition from `starting` to `healthy` one by one. All containers (except `digit-ui` which may show `unhealthy` initially) should show `(healthy)` within 5 minutes.

**How to know it's ready**: When you see all services show `(healthy)`, press `Ctrl+C` to exit the watch. Then verify:

```bash
# Run the health check script to confirm all services are up
bash scripts/health-check.sh http://localhost
```

Expected output: each service prints `OK` or `healthy`.

### Step 4: Access the application

| What | URL |
|------|-----|
| DIGIT UI (Employee login) | http://localhost:18000/digit-ui/employee |
| Jupyter Lab (DataLoader) | http://localhost:18000/jupyter/lab?token=digit-crs-local |
| Kong Gateway (API base) | http://localhost:18000 |
| Gatus Health Dashboard | http://localhost:18889 |

**Login to the UI**:
1. Open http://localhost:18000/digit-ui/employee
2. Select city: **City A**
3. Username: `ADMIN`
4. Password: `eGov@123`

### Step 5: Stop the stack

```bash
docker compose down                        # Stop (preserves data for next time)
docker compose down -v --remove-orphans    # Stop and delete ALL data (clean slate)
```

---

## Option B: Tilt

Tilt wraps Docker Compose with a web dashboard showing live logs, service health, and utility buttons.

### Step 1: Install Tilt

This project works best with a [patched version of Tilt](https://github.com/ChakshuGautam/tilt/releases/tag/v0.36.3-healthcheck) that waits for Docker Compose health checks. The upstream Tilt has a bug where it marks containers "ready" before they're healthy.

```bash
# Linux amd64
curl -fsSL https://github.com/ChakshuGautam/tilt/releases/download/v0.36.3-healthcheck/tilt-linux-amd64.gz \
  | gunzip > /usr/local/bin/tilt
chmod +x /usr/local/bin/tilt

# Verify
tilt version
```

> PR to upstream: https://github.com/tilt-dev/tilt/pull/6682.
> If using upstream Tilt, install from https://docs.tilt.dev/install.html.

### Step 2: Clone and start

```bash
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/local-setup

# Use the db-dump Tiltfile (recommended — no local builds needed)
tilt up -f Tiltfile.db-dump
```

**Available Tiltfiles**:

| File | Use the `-f` flag | What it does |
|------|-------------------|-------------|
| `Tiltfile.db-dump` | `tilt up -f Tiltfile.db-dump` | Pre-built images only. No Maven/Yarn needed. Best for getting started. |
| `Tiltfile` | `tilt up` (default) | Hot reload for PGR Java and UI code. Requires Maven + Yarn. |

### Step 3: Open the Tilt dashboard

Open http://localhost:10350 in your browser. You'll see:

- Services grouped by category: **infrastructure**, **core-services**, **pgr**, **frontend**, **gateway**, **tools**
- Health check links next to each service
- Utility buttons in the top nav: **Nuke DB**, **Health Check**, **Smoke Tests**
- Live streaming logs for each service

Wait for all services to turn green (healthy). This takes ~3-5 minutes.

### Step 4: Access the application

Same URLs as Docker Compose:

| What | URL |
|------|-----|
| DIGIT UI (Employee login) | http://localhost:18000/digit-ui/employee |
| Jupyter Lab (DataLoader) | http://localhost:18000/jupyter/lab?token=digit-crs-local |
| Tilt Dashboard | http://localhost:10350 |

### Step 5: Stop

```bash
# Must use the same -f flag you started with
tilt down -f Tiltfile.db-dump
```

### Hot Reload Development (Full Tiltfile)

If you're actively editing PGR Java or UI code, use the default `Tiltfile` instead:

```bash
tilt up    # uses the default Tiltfile with hot reload
```

**PGR Services (Java)** — requires Maven installed:
- Edit files in `backend/pgr-services/src/main/java/...`
- Tilt automatically recompiles with Maven and syncs the JAR

**DIGIT UI (React)** — requires Node.js + Yarn:
- Enable "ui-watch" in the Tilt dashboard, or:
  ```bash
  cd ../frontend/micro-ui/web && yarn install && yarn build:webpack --watch
  ```

---

## Setting Up a New Tenant (Jupyter DataLoader)

After the stack is running, you can create a new city/tenant with all the master data needed for PGR complaints. The DataLoader notebook guides you through this step by step.

### Step 1: Open Jupyter Lab

Open http://localhost:18000/jupyter/lab?token=digit-crs-local

The default token is `digit-crs-local` (configurable via the `JUPYTER_TOKEN` env var in `docker-compose.yml`).

### Step 2: Open the DataLoader notebook

In the Jupyter file browser on the left, click **DataLoader_v2.ipynb** to open it.

### Step 3: Configure variables

The first code cell contains configuration. Edit these values:

```python
URL = "http://kong:8000"          # Kong gateway (inside Docker network) - don't change
USERNAME = "ADMIN"                 # Superuser username - don't change
PASSWORD = "eGov@123"             # Superuser password - don't change
TENANT_ID = "pg"                   # Root tenant for login - don't change
TARGET_TENANT = "pg.myorg"         # <-- Change this to your new tenant name
```

> **Naming convention**: Tenant IDs follow the pattern `<state>.<city>`. For example: `pg.mumbai`, `pg.bangalore`, `pg.citya`.

### Step 4: Run each phase

Run the notebook cells in order. Each phase has a header cell explaining what it does, followed by one or more code cells to execute.

| Phase | What to do | What happens | Expected output |
|-------|-----------|-------------|-----------------|
| **Phase 1: Tenant & Branding** | Run the cell | Creates your new tenant in MDMS with UI branding config | `Tenant 'pg.myorg' created successfully!` |
| **Phase 2a: Boundary Template** | Run the cell | Downloads an Excel template for defining your admin hierarchy | An `.xlsx` file appears in the file browser |
| **Phase 2b: Load Boundaries** | Fill in the Excel template, then run the cell | Uploads your boundary hierarchy (State > District > Block > Ward) | `Boundaries loaded: X records` |
| **Phase 3: Common Masters** | Run the cell | Loads departments, designations, complaint types from the Excel template | Summary showing created/existing/failed counts |
| **Phase 4: Employees** | Run the cell | Creates employee accounts via HRMS with roles and department assignments | `Created: N employees` |
| **Phase 5: Localizations** | Run the cell (optional) | Loads translations for Hindi, Tamil, etc. | `Uploaded N messages` |
| **Phase 6: Workflow** | Run the cell | Configures the 11-state PGR complaint workflow | `Workflow already configured` or `Workflow updated` |

**After all phases complete**, your new tenant is ready. You can log into the UI, select your city, and create complaints.

### Rollback

If something goes wrong, each phase has a rollback function:

```python
loader.full_reset(TARGET_TENANT)              # Reset everything for this tenant
loader.rollback_common_masters(TARGET_TENANT)  # Just reset masters
loader.delete_boundaries(TARGET_TENANT)        # Just reset boundaries
```

---

## Running Postman API Tests

Two Postman collections validate the stack is working correctly.

| Collection | File | What it tests |
|-----------|------|--------------|
| Core Validation | `postman/digit-core-validation.postman_collection.json` | All core DIGIT service APIs respond correctly |
| Complaints Demo | `postman/complaints-demo.postman_collection.json` | Full PGR lifecycle: Create > Assign > Resolve > Rate & Close > Search |

### Running with Newman (CLI)

Install Newman (Postman's CLI runner) via npx (comes with Node.js):

**Core validation** (no auth needed):

```bash
npx newman run postman/digit-core-validation.postman_collection.json \
  --env-var "baseUrl=http://localhost"
```

**Expected output**: All requests show `200 OK`, no failures.

**Complaints demo** (requires an HRMS employee user — see [CI DataLoader](#automated-setup-with-ci-dataloader) below):

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

**Expected output**: 7 requests, 0 failures, 1 assertion passed. The final search should show status `CLOSEDAFTERRESOLUTION`.

### Complaints Demo Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `url` | Kong gateway URL | `http://localhost:18000` |
| `username` | HRMS employee username | `CI-ADMIN` |
| `password` | Employee password | `eGov@123` |
| `cityTenant` | City-level tenant ID | `pg.citest` |
| `stateTenant` | State-level tenant ID | `pg` |
| `userType` | Must be `EMPLOYEE` | `EMPLOYEE` |
| `authorization` | OAuth client credentials (base64) | `Basic ZWdvdi11c2VyLWNsaWVudDo=` |
| `serviceCode` | (Optional) Specific complaint type | `RequestSprayingOrFoggingOperation` |

If `serviceCode` is not set, the collection picks a random complaint type.

### Automated Setup with CI DataLoader

The CI dataloader script creates a complete tenant with an HRMS employee in one command. Use this before running the complaints demo:

```bash
# Install Python dependencies (one time)
pip install requests openpyxl pandas python-dotenv

# Run the dataloader
DIGIT_URL=http://localhost:18000 \
TARGET_TENANT=pg.citest \
python3 scripts/ci-dataloader.py
```

**Expected output**:
```
[1/6] Login
  Authentication successful!
[2/6] Create tenant
  Tenant 'pg.citest' created successfully!
[3/6] Load common masters
  Created: 4, Already existed: 0, Failed: 1
[4/6] Look up ServiceDef department
  Using: RequestSprayingOrFoggingOperation -> dept DEPT_3
[5/6] Create HRMS employee
  Creating HRMS employee 'CI-ADMIN' (dept=DEPT_3)
  Password set for 'CI-ADMIN'
[6/6] Load workflow
  Workflow already configured

CI_TENANT=pg.citest
CI_USER=CI-ADMIN
CI_SERVICE_CODE=RequestSprayingOrFoggingOperation
```

The last 3 lines are the values to pass to Newman.

---

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

### Tools

| Service | Port | Description |
|---------|------|-------------|
| Jupyter Lab | via Kong (:18000/jupyter) | DataLoader notebook for tenant setup |
| Gatus | 18889 | Health monitoring dashboard |

### Resource Usage

| Component | Memory |
|-----------|--------|
| Infrastructure (Postgres, Redis, Redpanda, MinIO) | ~1.5 GB |
| Core Services (11 Java/Node services) | ~3.0 GB |
| Application (PGR, UI, Kong) | ~0.7 GB |
| **Total** | **~3.8 GB** |

---

## API Access

All APIs go through Kong at `http://localhost:18000`:

```bash
# Authenticate
curl -X POST "http://localhost:18000/user/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "username=ADMIN&password=eGov@123&tenantId=pg&grant_type=password&scope=read&userType=EMPLOYEE"

# MDMS search
curl -X POST "http://localhost:18000/mdms-v2/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{"MdmsCriteria":{"tenantId":"pg","moduleDetails":[{"moduleName":"tenant","masterDetails":[{"name":"tenants"}]}]},"RequestInfo":{"apiId":"Rainmaker"}}'

# PGR search (replace YOUR_TOKEN with the authToken from the login response)
curl -X POST "http://localhost:18000/pgr-services/v2/request/_search" \
  -H "Content-Type: application/json" \
  -d '{"RequestInfo":{"apiId":"Rainmaker","authToken":"YOUR_TOKEN"},"tenantId":"pg.citya"}'
```

## Database Access

```bash
docker exec -it docker-postgres psql -U egov -d egov
```

---

## Troubleshooting

### Services not starting

```bash
docker compose logs <service-name>     # Check a specific service's logs
docker compose restart <service-name>  # Restart a single service
docker compose ps                      # See status of all services
```

### PGR Assign returns "DEPARTMENT_NOT_FOUND"

The assignee must be an **HRMS employee** (not just a user) with a department that matches the complaint type's ServiceDef. Users created via `_createnovalidate` don't have HRMS records.

**Fix**: Use the DataLoader notebook (Phase 4) or `ci-dataloader.py` to create proper HRMS employees with department assignments.

### PGR Rate & Close returns "INVALID_ASSIGNEE"

The RATE workflow action does not support assignees. If you're calling the API directly, set `"assignes": []` (empty array) in the Rate request body.

### UI showing blank page

```bash
# Check if the UI config is serving
curl http://localhost:18000/digit-ui/globalConfigs.js
# Should return JavaScript config. If empty/404, restart digit-ui:
docker compose restart digit-ui
```

### Jupyter not loading

```bash
# Check if Jupyter container is running
docker compose ps jupyter

# If it shows unhealthy or stopped:
docker compose restart jupyter

# Access directly (bypassing Kong) to test:
# http://localhost:18888/jupyter/lab?token=digit-crs-local
```

### Out of memory / containers keep restarting

Increase Docker's memory allocation to at least 8 GB. In Docker Desktop: Settings > Resources > Memory.

```bash
# Check which containers are using the most memory
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}" | sort -k2 -h -r
```

### Reset everything

```bash
docker compose down -v --remove-orphans    # Delete all data
docker compose up -d                       # Fresh start
```

---

## Project Structure

```
local-setup/
├── docker-compose.yml              # Main service definitions (~3.8GB RAM)
├── docker-compose.deploy.yaml      # Deploy variant (no resource limits)
├── docker-compose.db-migrations.yml # DB migrations variant
├── Tiltfile                        # Tilt with hot reload (requires Maven/Yarn)
├── Tiltfile.db-dump                # Tilt with pre-built images (recommended)
├── kong/
│   └── kong.yml                    # API gateway route config
├── db/
│   └── full-dump.sql               # Database seed (tenants, MDMS, users)
├── configs/
│   └── persister/                  # Persister YAML configs
├── jupyter/
│   ├── Dockerfile                  # Jupyter container build
│   └── dataloader/
│       ├── DataLoader_v2.ipynb     # Interactive data loader notebook
│       ├── crs_loader.py           # Loader library (used by notebook + CI)
│       ├── unified_loader.py       # Low-level MDMS/HRMS API wrapper
│       └── templates/              # Excel templates for master data
├── postman/
│   ├── complaints-demo.postman_collection.json    # PGR lifecycle tests
│   └── digit-core-validation.postman_collection.json  # Core API tests
├── scripts/
│   ├── ci-dataloader.py            # Automated tenant + employee setup
│   ├── health-check.sh             # Service health verification
│   ├── smoke-tests.sh              # API smoke tests
│   └── run-postman.sh              # Newman wrapper
├── nginx/                          # Nginx configs
├── gatus/                          # Health monitoring dashboard config
└── docs/                           # Additional documentation

../backend/pgr-services/            # PGR Java source (hot reload target)
../frontend/micro-ui/               # DIGIT UI React source (hot reload target)
../configs/assets/                  # Runtime configs (globalConfigs.js)
```
