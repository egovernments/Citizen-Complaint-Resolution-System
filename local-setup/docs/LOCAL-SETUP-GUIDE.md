# Local Setup Guide (Resource-Constrained)

Run the full DIGIT CRS stack on a single machine with ~4GB RAM. This guide covers Docker Compose setup, data loading via Jupyter notebook, and API testing via Postman.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker + Compose | v2+ | [docs.docker.com](https://docs.docker.com/engine/install/) |
| Python 3 | 3.8+ | System package manager |
| Node.js | 20+ | [nodejs.org](https://nodejs.org) (for newman) |

Optional (for hot reload):
- Maven 3.9+ (PGR Java hot reload)
- Node.js + Yarn (UI hot reload)

## Quick Start

```bash
# Clone and enter the project
git clone https://github.com/egovernments/Citizen-Complaint-Resolution-System.git
cd Citizen-Complaint-Resolution-System/local-setup

# Start all services
docker compose up -d

# Wait for healthy (~3-5 minutes for all Java services to start)
watch 'docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -v "Exited"'

# Verify health
bash scripts/health-check.sh http://localhost
```

All 24 services use memory limits totalling ~3.8GB:

| Component | Memory |
|-----------|--------|
| Infrastructure (Postgres, Redis, Redpanda, MinIO) | ~1.5 GB |
| Core Services (13 Java services) | ~2 GB |
| Kong + UI + Tools | ~0.3 GB |
| **Total** | **~3.8 GB** |

## Architecture

```
Browser / Postman
       │
   Kong Gateway (:18000) ─── routes all /service/* paths
       │
  ┌────┴─────────────────────────────────┐
  │ Core Services                        │
  │  mdms-v2, user, workflow, hrms,     │
  │  localization, idgen, enc, persister,│
  │  filestore, accesscontrol, boundary  │
  ├──────────────────────────────────────┤
  │ App Services                         │
  │  pgr-services, digit-ui              │
  ├──────────────────────────────────────┤
  │ Infrastructure                       │
  │  postgres ← pgbouncer               │
  │  redis, redpanda (kafka), minio     │
  └──────────────────────────────────────┘
```

Direct service ports are also exposed for debugging (e.g., `:18094` for MDMS, `:18107` for User). See the full port list in `docker-compose.yml`.

## Data Loading with Jupyter Notebook

The Jupyter notebook provides a guided, interactive workflow for setting up a new tenant with all required master data.

### Start Jupyter

```bash
# Jupyter is included in docker compose (disabled by default in Tilt)
# Access at http://localhost:18888
docker compose up -d jupyter
```

Or use Tilt's "Start Jupyter" button if running via `tilt up`.

### DataLoader_v2.ipynb — 6-Phase Workflow

Open `jupyter/dataloader/DataLoader_v2.ipynb` in Jupyter Lab. The notebook walks through:

| Phase | What It Does | Key Inputs |
|-------|-------------|------------|
| **1. Tenant & Branding** | Creates your organization tenant | Tenant ID (e.g., `pg.mycity`), org name, logo |
| **2a. Boundary Template** | Generates Excel template for admin hierarchy | Hierarchy type (State → District → Block) |
| **2b. Load Boundaries** | Uploads filled boundary data | Filled Excel from 2a |
| **3. Common Masters** | Loads departments, designations, complaint types | `templates/Common and Complaint Master.xlsx` |
| **4. Employees** | Creates staff with roles via HRMS | `templates/Employee Master.xlsx` |
| **5. Localizations** | (Optional) Bulk translations | Language Excel files |
| **6. Workflow** | Configures PGR state machine | `templates/PgrWorkflowConfig.json` |

### Configuration

Set these variables in the first notebook cell:

```python
URL = "http://kong:8000"          # Kong inside Docker network
USERNAME = "ADMIN"                 # Superuser
PASSWORD = "eGov@123"
TENANT_ID = "pg"                   # Root tenant (for login)
TARGET_TENANT = "pg.mycity"        # Your new tenant
```

### What Gets Created

After running all phases:
- New tenant visible in DIGIT UI city selector
- Departments and designations in MDMS
- Complaint types (ServiceDefs) with department mappings
- Employee users with roles (GRO, DGRO, PGR_LME, CSR, etc.)
- PGR workflow (APPLY → ASSIGN → RESOLVE → RATE → CLOSE)

### Rollback

The notebook includes rollback functions if something goes wrong:

```python
loader.rollback_common_masters(TARGET_TENANT)  # Remove masters
loader.rollback_tenant(TARGET_TENANT)           # Remove tenant
loader.full_reset(TARGET_TENANT)                # Complete reset
```

## API Testing with Postman

Two Postman collections are included for validating the stack.

### Collections

| Collection | Purpose | Requests |
|-----------|---------|----------|
| `digit-core-validation` | Validates core service health | 3 |
| `complaints-demo` | Full PGR lifecycle test | 7 (Auth → MDMS → Create → Assign → Resolve → Rate&Close → Search) |

### Running with Newman (CLI)

```bash
# Install newman
npm install -g newman

# 1. Core validation — checks MDMS, User, Workflow health
newman run postman/digit-core-validation.postman_collection.json \
  --env-var "baseUrl=http://localhost"

# 2. Complaints demo — full PGR lifecycle
newman run postman/complaints-demo.postman_collection.json \
  --env-var "url=http://localhost:18000" \
  --env-var "username=ADMIN" \
  --env-var "password=eGov@123" \
  --env-var "cityTenant=pg.citya" \
  --env-var "stateTenant=pg" \
  --env-var "userType=EMPLOYEE" \
  --env-var "authorization=Basic ZWdvdi11c2VyLWNsaWVudDo="
```

### Complaints Demo — What It Tests

The collection runs the full PGR complaint lifecycle:

1. **Employee Auth Token** — Logs in and stores the auth token
2. **MDMSv2 PGR Search** — Fetches ServiceDefs and picks a complaint type
3. **PGR Create** — Creates a new complaint
4. **PGR Update (Assign)** — Assigns the complaint to the logged-in employee
5. **PGR Update (Resolve)** — Marks the complaint as resolved
6. **PGR Update (Rate & Close)** — Rates and closes the complaint
7. **PGR Search** — Verifies final status is `CLOSEDAFTERRESOLUTION`

### Using a Specific ServiceCode

By default, the collection picks a random complaint type. To target a specific one:

```bash
newman run postman/complaints-demo.postman_collection.json \
  --env-var "url=http://localhost:18000" \
  --env-var "username=CI-ADMIN" \
  --env-var "password=eGov@123" \
  --env-var "cityTenant=pg.citest" \
  --env-var "stateTenant=pg" \
  --env-var "userType=EMPLOYEE" \
  --env-var "authorization=Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  --env-var "serviceCode=RequestSprayingOrFoggingOperation"
```

### Important: Employee Must Have HRMS Record

The Postman complaints demo requires the employee to have a proper **HRMS record** (not just a user account). PGR validates that the assignee's department matches the complaint type's department.

If you created users via `_createnovalidate` (user-only, no HRMS), PGR Assign will fail with `DEPARTMENT_NOT_FOUND`.

**Use the Jupyter notebook Phase 4 (Employees)** or the CI dataloader to create proper HRMS employees.

### Helper Script

```bash
# Run all collections with defaults
bash scripts/run-postman.sh all
```

## CI Dataloader (Automated Setup)

For CI or quick testing without the notebook, `scripts/ci-dataloader.py` automates the full setup:

```bash
# Install Python dependencies
pip install requests openpyxl pandas python-dotenv

# Run the dataloader
DIGIT_URL=http://localhost:18000 \
TARGET_TENANT=pg.mytest \
python3 scripts/ci-dataloader.py
```

This runs 6 steps automatically:
1. Login as superuser
2. Create tenant
3. Load common masters (departments, designations, complaint types)
4. Look up ServiceDef department
5. Create HRMS employee (CI-ADMIN) in the correct department
6. Load PGR workflow

Output includes `CI_SERVICE_CODE` which you can pass to newman.

## Default Credentials

| User | Password | Type | Tenant | Roles |
|------|----------|------|--------|-------|
| `ADMIN` | `eGov@123` | EMPLOYEE | pg | SUPERUSER, EMPLOYEE, PGR-ADMIN, GRO |

After running the dataloader or notebook, additional users are created per your configuration.

## Stopping and Resetting

```bash
# Stop (preserves data)
docker compose down

# Stop and remove all data
docker compose down -v

# Reset a single service
docker compose restart pgr-services
```

## Troubleshooting

### Services take too long to start
Java services need 1-3 minutes for JVM startup. Check progress:
```bash
docker compose logs -f pgr-services
```

### PGR Assign returns 400 (DEPARTMENT_NOT_FOUND)
The employee has no HRMS record. Create one via the notebook (Phase 4) or ci-dataloader.

### PGR Assign returns 400 (INVALID_ASSIGNMENT)
The employee's department doesn't match the complaint type's department. Check the ServiceDef's `department` field in MDMS and ensure the employee is assigned to that department.

### HRMS returns "Invalid department"
HRMS validates departments via MDMS v1 API which has no tenant inheritance. State-level departments aren't visible at city tenant level. The ci-dataloader handles this by creating the department at city level. For manual setup, create the department at the city tenant level via MDMS v2 API.

### Kong returns 503
The upstream service isn't healthy yet. Wait and retry, or check:
```bash
docker compose logs kong
```

### Database access
```bash
docker exec -it docker-postgres psql -U egov -d egov
```
