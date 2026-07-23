# DIGIT CRS - Local Development Stack

Run the DIGIT Citizen Complaint Resolution System locally with Docker Compose or Tilt. This stack includes all core DIGIT services, the PGR (Public Grievance Redressal) module, a web UI, and tools for loading master data.

## Choose Your Setup Path

There are **two independent ways** to run this stack. Pick one:

| Path | Best for | What you need |
|------|----------|---------------|
| **[Option A: Docker Compose](#option-a-docker-compose)** | Quick setup, no extra tools | Docker only |
| **[Option B: Tilt](#option-b-tilt)** | Dashboard, grouped services, dev buttons | Docker + Tilt |
| **[Option C: Ansible (Remote Server)](#option-c-ansible-remote-server)** | Deploy to a remote Ubuntu machine | Ansible + SSH |

Options A and B run locally. Option C deploys a full per-tenant stack to a
remote Ubuntu machine with `./deploy.sh <tenant>`. **Pick one.**

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
| [Tilt](https://docs.tilt.dev/install.html) | [See Tilt install section](#step-1-install-tilt) | Only if using Option B |
| [Node.js 20+](https://nodejs.org/en/download/) | [Download](https://nodejs.org/) | Running Postman tests with Newman (`npx`) |
| [Python 3.8+](https://www.python.org/downloads/) | [Download](https://www.python.org/downloads/) | Running the CI dataloader script |
| **JDK 17 or 21** | [Temurin 17](https://adoptium.net/temurin/releases/?version=17) | Hot reload for PGR Java code (Tilt only) — see note below |
| [Maven 3.9+](https://maven.apache.org/download.cgi) | [Download](https://maven.apache.org/download.cgi) | Hot reload for PGR Java code (Tilt only) |
| [Yarn](https://yarnpkg.com/getting-started/install) | [Download](https://yarnpkg.com/) | Hot reload for DIGIT UI (Tilt only) |

> **JDK version matters.** `backend/pgr-services` sets `<java.version>17</java.version>` and builds only on
> **JDK 17 or 21**. JDK 23 and 25 fail: Lombok 1.18.30 (inherited from the Spring Boot 3.2.2 parent) cannot
> run on their compiler internals, so every `@Builder`-generated method silently disappears and the build
> dies with dozens of `cannot find symbol: method builder()` errors. The error never mentions Lombok or
> your JDK, so it is easy to misread as broken source.
>
> Ubuntu's `default-jdk` may be newer than 21. Check with `mvn -version` (it reports the JDK Maven actually
> uses, which is what matters — not `java -version`), and switch with
> `sudo update-alternatives --config java` if needed.

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

Install upstream Tilt from https://docs.tilt.dev/install.html.

```bash
# Linux amd64
curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash

# Verify
tilt version
```

> **Do not use the `v0.36.3-healthcheck` fork.** We previously recommended a
> [patched Tilt](https://github.com/ChakshuGautam/tilt/releases/tag/v0.36.3-healthcheck) that waits for
> Docker Compose health checks, because upstream Tilt marks containers "ready" before they are healthy
> (upstream PR: https://github.com/tilt-dev/tilt/pull/6682).
>
> That release is currently **broken and unusable**: the published binary ships without its web assets, so
> `tilt up` exits immediately with `Could not find Tilt web static files`. Its version string is
> `v0.36.3-dev`, and the `-dev` suffix makes Tilt serve the UI from the build machine's source tree
> (`/root/code/tilt-fork/web`) instead of embedded assets. `--web-mode=prod` fails too, so there is no
> workaround short of rebuilding and re-releasing the fork.
>
> Consequence of using upstream: Tilt may show a service as ready before its health check passes. The
> stack still comes up — `docker-compose.yml` enforces ordering via `depends_on: service_healthy` — but
> don't trust the dashboard's "ready" as "healthy". Check the `gatus` resource for real health.

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

## Option C: Ansible (Remote Server)

Deploy the full DIGIT stack to a remote Ubuntu machine with a single,
config-driven Ansible playbook. Each tenant is an independent stack (~35
containers) driven by its own `host_vars/<tenant>.yml`; one command —
`./deploy.sh <tenant>` — installs Docker, syncs configs, seeds secrets,
pulls/builds images, starts the stack, and runs smoke + lifecycle tests.

> **This is the quick-start.** The authoritative Ansible reference is
> [`ansible/README.md`](ansible/README.md) — it covers `host_vars`, OpenBao
> secrets, TLS/domain setup, per-tenant compose overlays, subset deploys, and
> the configurator/MCP build options.

### Prerequisites

On your **control machine** (laptop/CI server):

| Tool | Install |
|------|---------|
| [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/) | `pip3 install --user ansible`, then `ansible-galaxy install -r ansible/requirements.yml` |
| Node.js 20 | Required on the controller — the digit-ui and configurator builds run here |
| SSH access to the target | Key-based `root` login (no password) |

The **target machine** needs:
- Ubuntu (fresh install), 8 vCPU / 16 GB RAM / 50 GB disk
- Reachable over SSH as `root`

### Step 1: Create the tenant's host_vars

The only tracked host_vars file is `_example.yml`. Copy it into a file named
after your tenant (real tenant files are gitignored — they hold secrets):

```bash
cd local-setup/ansible
cp inventory/host_vars/_example.yml inventory/host_vars/<tenant>.yml
```

Edit `<tenant>.yml` — every field is commented. The non-negotiable ones:
- `ansible_host` — IP/hostname Ansible SSHes into
- `domain` — public hostname (nginx `server_name` + Grafana root URL)
- `state_tenant_id` / `boot_tenant` / `tenant_id` — DIGIT tenancy slugs
- `secrets_path` + `bootstrap_secrets.*` — OpenBao path + initial secrets
- keep `db_fast_path: true` (a fresh install needs it — no SQL slow path exists)

No inventory edit is needed: `deploy.sh` regenerates `inventory/hosts.yml` from
`host_vars/*.yml` on every run. To enable the browser onboarding wizard, also set:

```yaml
nginx_features: { configurator: true }
build_configurator: true
```

### Step 2: Deploy

```bash
./deploy.sh <tenant>                 # full deploy
./deploy.sh <tenant> --check --diff  # dry-run: no changes, show every diff
```

`deploy.sh` is tenant-agnostic — it forwards any extra flags to
`ansible-playbook` (`--tags`, `--limit`, `--start-at-task`, `-vvv`, …).

The first deploy installs Docker + Compose, creates `/opt/digit/`, syncs
configs, initialises + unseals OpenBao and seeds secrets, pulls/builds images,
starts the stack, waits on health gates, and (unless `run_ci_tests: false`)
runs the Postman + Playwright suites. Subsequent deploys are idempotent — only
changed configs trigger restarts.

### Step 3: Access the application

The host nginx serves everything on ports 80/443:

| What | URL |
|------|-----|
| DIGIT UI (employee) | `https://<domain>/digit-ui/employee` |
| DIGIT UI (citizen) | `https://<domain>/digit-ui/citizen` |
| Configurator wizard | `https://<domain>/configurator/` (if enabled) |
| Grafana (tracing) | `https://<domain>/grafana/` |
| Gatus health dashboard | `https://<domain>/status/` |

For a local/sandbox deploy (`domain: localhost`, `tls_enabled: false`), use
`http://localhost/...`.

### Next: onboard a tenant

Once the stack is up, create your city and load its master data — via the
browser **configurator wizard** or the Jupyter DataLoader. See the
[Tenant Onboarding guide](docs/TENANT-ONBOARDING.md).

### What the Ansible playbook deploys

The playbook deploys `docker-compose.egov-digit.yaml` plus overlays — **not**
`docker-compose.registry.yml`, which it never references. The exact stack is built in
`ansible/playbook-deploy.yml` ("Compute compose -f flags"):

```
-f docker-compose.egov-digit.yaml
[-f docker-compose.fast-path.yml]          # when db_fast_path is set
-f docker-compose.migrations.yml
-f docker-compose.migrations.ansible.yml
[-f docker-compose.<tenant>.yml]           # when a per-tenant overlay exists
```

Between them these include:

| Category | Services |
|----------|----------|
| **Tracing** | OpenTelemetry Collector, Tempo, Grafana |
| **Infrastructure** | PostgreSQL 16, PgBouncer, Redis, Redpanda (Kafka), MinIO, Elasticsearch |
| **Core DIGIT** | MDMS v2, User, Workflow v2, Localization, Boundary, Access Control, IDGEN, Encryption, Persister, Filestore, HRMS, Indexer, Inbox |
| **Application** | PGR Services, URL Shortening, Default Data Handler, Boundary Management |
| **Frontend** | DIGIT UI (React), Kong API Gateway |
| **Tools** | Jupyter Lab (DataLoader), Gatus (health monitoring) |
| **Seeds** | Tenant data, security config, workflow config, localization, user accounts |

### Files & configuration

The Ansible tree, `host_vars` layout, templates, and runbooks are documented in
[`ansible/README.md`](ansible/README.md). At a glance:

```
local-setup/ansible/
├── deploy.sh                  # Single entrypoint — ./deploy.sh <tenant> [flags]
├── playbook-deploy.yml        # The playbook
├── requirements.yml           # Ansible collections to install
├── inventory/
│   ├── group_vars/            # Defaults inherited by every tenant
│   └── host_vars/             # Per-tenant config (_example.yml is the template)
├── templates/                 # Jinja2 — globalConfigs.js, nginx-site.conf, digit.env, …
├── files/                     # Build scripts — configurator, digit-ui, mcp, …
└── runbooks/                  # OpenBao, tenant-onboarding status, Bomet walkthrough
```

---

## Setting Up a New Tenant & Loading Master Data

Once the stack is running, create a new city/tenant and load everything a PGR
complaint needs — the tenant record + branding, the boundary hierarchy, common
masters (departments, designations, complaint types), and employees.

**Full step-by-step instructions live in the
[Tenant Onboarding guide](docs/TENANT-ONBOARDING.md).** There are three paths,
all creating the same data:

| Path | Interface | Available on |
|------|-----------|--------------|
| **Configurator wizard** | Browser — upload one XLSX per phase | Ansible deploys with `nginx_features.configurator: true` |
| **Jupyter DataLoader** | `DataLoader_v2.ipynb` (Python) | Any stack (Docker Compose, Tilt, Ansible) |
| **MCP `city_setup_from_xlsx`** | REST / automation | Deploys with `enable_mcp: true` |

> **Order always matters:** Tenant → Boundaries → Masters → Employees. Each
> phase validates codes created by the previous one.

### Quick path — Jupyter DataLoader

For a local Docker Compose / Tilt stack, open Jupyter Lab at
http://localhost:18000/jupyter/lab?token=digit-crs-local (token configurable via
`JUPYTER_TOKEN`) and open **DataLoader_v2.ipynb**. The first configuration cell
both logs in **and** creates the tenant — edit and run it:

```python
URL          = "http://kong:8000"   # Kong gateway inside the Docker network — leave as-is
USERNAME     = "ADMIN"
PASSWORD     = "eGov@123"
TENANT_ID    = "pg"                  # root tenant you log in against
TARGET_TENANT = "pg.myorg"           # <-- your new tenant (pattern: <state>.<city>)

loader = CRSLoader(URL)
loader.login(username=USERNAME, password=PASSWORD, tenant_id=TENANT_ID)
loader.create_tenant(TARGET_TENANT, "My Org", users=[
    {"username": "ADMIN", "password": "eGov@123", "name": "Admin",
     "roles": ["SUPERUSER", "EMPLOYEE", "CSR", "GRO", "DGRO", "PGR_LME", "PGR_VIEWER", "CITIZEN"]}
])
loader.login(username="ADMIN", password="eGov@123", tenant_id=TARGET_TENANT)
```

Then run the remaining cells top to bottom: **2a** boundary template → **2b**
load boundaries → **3** common masters → **4** employees → **5** localizations
(optional) → **6** workflow. See the
[Tenant Onboarding guide](docs/TENANT-ONBOARDING.md#b-jupyter-dataloader-scripted)
for the per-phase details and template shapes.

### Rollback

Each phase has an inverse. Note `full_reset` takes the boundary **hierarchy
type first**, then the tenant:

```python
loader.delete_boundaries(TARGET_TENANT)          # Phase 2
loader.rollback_common_masters(TARGET_TENANT)    # Phase 3
loader.rollback_tenant(TARGET_TENANT)            # Phase 1 (tenant + branding)
loader.full_reset("REVENUE", TARGET_TENANT)      # everything (pass the hierarchy you used)
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
| Filestore | 18084 | 384 MB | `/filestore/health` |
| HRMS | 18092 | 256 MB | `/egov-hrms/health` |

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

### Disk usage: container logs

Container logs are **not** rotated by Compose. With Docker's default `json-file`
driver they grow without bound: measured on an idle stack 21 hours after start,
7.9 GB total — 4.3 GB from the MDMS backend and 2.6 GB from the OTel collector
alone, roughly 9 GB/day before any load.

This is not cosmetic. When the disk fills, Postgres hits
`PANIC: could not write to file ... No space left on device` and crash-loops,
because recovery must itself write a checkpoint. It does not return without
intervention, and every service then fails on connection acquisition.

The Ansible playbook (Option C) configures rotation for you, in
`/etc/docker/daemon.json`. **If you started the stack by hand with
`docker compose up`, you must configure it yourself** — it is a daemon-level
setting, not a Compose one:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "100m", "max-file": "10" }
}
```

Then `sudo systemctl restart docker`. The limits apply to containers **created
after** the restart — existing containers keep the settings they were created
with until recreated, so run `docker compose up -d --force-recreate` if the
stack is already running.

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
├── docker-compose.yml              # Main service definitions (~3.8GB RAM, registry images)
├── docker-compose.registry.yml     # All images from public registry (NOT the Ansible
│                                   # deploy — that uses docker-compose.egov-digit.yaml)
├── docker-compose.deploy.yaml      # Deploy variant (no resource limits)
├── docker-compose.db-migrations.yml # DB migrations variant
├── docker-compose.tilt.yml         # Overlay: points pgr-services/digit-ui at Tilt's locally built images
├── Tiltfile                        # Tilt with hot reload (requires Maven/Yarn)
├── Tiltfile.db-dump                # Tilt with pre-built images (recommended)
├── ansible/                        # Config-driven remote deploy — see ansible/README.md
│   ├── deploy.sh                   # Entrypoint: ./deploy.sh <tenant> [flags]
│   ├── playbook-deploy.yml         # The playbook
│   ├── inventory/host_vars/        # Per-tenant config (_example.yml is the template)
│   ├── templates/                  # globalConfigs.js, nginx-site.conf, digit.env, …
│   ├── files/                      # Build scripts (configurator, digit-ui, mcp, …)
│   └── runbooks/                   # OpenBao, tenant-onboarding, Bomet walkthrough
├── kong/
│   └── kong.yml                    # API gateway routes + OTEL + auth enrichment + RBAC (pre-function)
├── nginx/
│   ├── digit-ui.conf               # UI serving + API proxy to Kong
│   ├── globalConfigs.js            # Runtime UI config (auth provider, API endpoints)
│   ├── mdms-proxy.conf             # MDMS v1→v2 backward-compat proxy
│   ├── user-proxy.conf             # User service load balancer (scaled instances)
│   └── workflow-proxy.conf         # Workflow service load balancer
├── otel/
│   ├── download-agent.sh           # Downloads OpenTelemetry Java Agent (~21MB)
│   ├── otel-collector-config.yaml  # OTLP receiver → Tempo exporter pipeline
│   ├── tempo-config.yaml           # Trace storage (local backend, 24h retention)
│   └── grafana/provisioning/       # Grafana Tempo datasource auto-provisioning
├── seeds/
│   └── user-seed.sh                # Creates ADMIN, GRO, INTERNAL_USER via API
├── data/
│   └── Bomet county...xlsx         # Sample county data (47 types, 25 wards)
├── db/
│   ├── full-dump.sql               # Database seed (tenants, MDMS, users, localization)
│   ├── keycloak-init.sql           # Keycloak schema bootstrap
│   ├── flyway-history-map.yml      # Maps dump state -> flyway baseline
│   ├── normalize/                  # Flyway history normalisation job
│   └── notif-mdms-seed/            # Notification MDMS seed data
├── configs/
│   └── egov-persister/             # Persister YAML configs (9 files)
├── jupyter/
│   ├── Dockerfile                  # Jupyter container build
│   └── dataloader/
│       ├── DataLoader_v2.ipynb     # Interactive data loader notebook
│       ├── crs_loader.py           # Loader library (used by notebook + CI)
│       ├── unified_loader.py       # Low-level MDMS/HRMS API wrapper
│       └── templates/              # Excel templates + bundled localisations
├── scripts/
│   ├── ci-dataloader-xlsx.py       # XLSX-driven county E2E (Bomet)
│   ├── ci-dataloader-v2-regression.py  # DataLoader v2 regression tests
│   ├── ci-dataloader.py            # Simple automated tenant + employee setup
│   ├── health-check.sh             # Service health verification
│   ├── smoke-tests.sh              # API smoke tests
│   └── run-postman.sh              # Newman wrapper
├── tests/
│   ├── e2e/                        # Playwright E2E tests (login, PGR flow, citizen)
│   └── smoke/                      # Smoke tests (pgr-workflow, pgr-tenant)
├── postman/                        # Newman/Postman collections
├── gatus/                          # Health monitoring dashboard config
└── docs/
    ├── TENANT-ONBOARDING.md        # Enable a tenant + load master data (configurator / DataLoader)
    └── …                           # Local/hybrid/remote setup guides

../backend/pgr-services/            # PGR Java source (hot reload target)
../frontend/micro-ui/               # DIGIT UI React source (hot reload target)
../configs/assets/                  # Runtime configs (globalConfigs.js)
```
