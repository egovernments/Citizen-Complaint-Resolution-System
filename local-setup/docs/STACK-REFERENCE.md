# Local stack reference

Everything about the DIGIT CRS local stack that is not a step in a
walkthrough: what runs, on which port, using how much memory, how to reach the
API and the database directly, and what to do when something misbehaves.

The walkthroughs live in [`../README.md`](../README.md) — Docker Compose,
Tilt and Ansible. Start there if the stack is not running yet.

- [What's included](#whats-included)
- [API access](#api-access)
- [Database access](#database-access)
- [Running Postman API tests](#running-postman-api-tests)
- [Loading master data from a script](#loading-master-data-from-a-script)
- [What the Ansible playbook deploys](#what-the-ansible-playbook-deploys)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)

> Ports in this page are the **Docker Compose and Tilt** ports, where each
> container publishes its own `:18xxx` port on localhost. An Ansible
> deployment (Option C) puts nginx in front of everything on ports 80/443
> instead, and those `:18xxx` ports are bound to `127.0.0.1` on the
> deployment machine only.

---

## What's included

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

## API access

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

## Database access

```bash
docker exec -it docker-postgres psql -U egov -d egov
```

---

## Running Postman API tests

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

**Complaints demo** (requires an HRMS employee user — see [CI DataLoader](#automated-setup-with-the-ci-dataloader) below):

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

### Complaints demo variables

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

### Automated setup with the CI DataLoader

The CI dataloader script creates a complete tenant with an HRMS employee in one command. Use this before running the complaints demo:

```bash
# Install Python dependencies (one time), in a virtualenv — a bare pip install
# fails with PEP 668 error: externally-managed-environment on Ubuntu 24.04,
# Debian 12+, Fedora 38+ and Homebrew Python.
python3 -m venv .venv && source .venv/bin/activate
pip install -r dataloader/requirements.txt

# Run the dataloader
DIGIT_URL=http://localhost:18000 \
TARGET_TENANT=pg.citest \
python3 scripts/ci-dataloader.py
```

**Expected output**:
```text
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

---

## Loading master data from a script

The browser wizard in the
[Onboarding & Add-ons guide](ONBOARDING-AND-ADDONS.md) is the recommended way
to create a tenant and load its data. `CRSLoader` — the Python library in
`local-setup/dataloader/` — does the same thing from a script, and is what the
CI dataloaders use, so the two paths exercise the same code.

```bash
cd local-setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r dataloader/requirements.txt
```

The virtualenv is not optional on Ubuntu 24.04, Debian 12+, Fedora 38+ or
Homebrew Python — a bare `pip install` there fails with PEP 668
`error: externally-managed-environment`.

**One command, from a single spreadsheet** — templates, tenant, boundaries,
masters, employees, workflow and localisation, then a create → assign →
resolve check:

```bash
DIGIT_URL=http://localhost:18000 \
BOOT_TENANT=pg.myorg \
INPUT_XLSX="data/Bomet county health common complains items - R.xlsx" \
python3 scripts/ci-dataloader-xlsx.py
```

`INPUT_XLSX` is your own county spreadsheet. The Bomet sample above is the only
one in the repo — there is no `county-data.xlsx`.

**Phase by phase**, when you want control over each step:

```python
import sys
sys.path.insert(0, "dataloader")     # run from local-setup/
from crs_loader import CRSLoader

TARGET_TENANT = "pg.myorg"           # pattern: <root>.<city>

loader = CRSLoader("http://localhost:18000")
loader.login(username="ADMIN", password="eGov@123", tenant_id="pg")
loader.create_tenant(TARGET_TENANT, "My Org", users=[
    {"username": "ADMIN", "password": "eGov@123", "name": "Admin",
     "roles": ["SUPERUSER", "EMPLOYEE", "CSR", "GRO", "DGRO",
               "PGR_LME", "PGR_VIEWER", "CITIZEN"]}
])
loader.login(username="ADMIN", password="eGov@123", tenant_id=TARGET_TENANT)
```

Then boundaries → masters → employees → localisations → workflow, in that
order. The per-phase calls, the shape of each spreadsheet and the rollback
calls are in
[Onboarding & Add-ons § Python DataLoader](ONBOARDING-AND-ADDONS.md#b-python-dataloader-scripted).

## What the Ansible playbook deploys

The playbook deploys `docker-compose.egov-digit.yaml` plus overlays — **not**
`docker-compose.registry.yml`, which it never references. The exact stack is built in
`ansible/playbook-deploy.yml` ("Compute compose -f flags"):

```text
-f docker-compose.egov-digit.yaml
[-f docker-compose.fast-path.yml]          # when db_fast_path is set
-f docker-compose.migrations.yml
-f docker-compose.monitoring.yml
[-f docker-compose.<tenant>.yml]           # when a per-tenant overlay exists
```

Between them these include:

| Category | Services |
|----------|----------|
| **Observability** | Prometheus + node-exporter (metrics), Loki + Promtail (logs), OpenTelemetry Collector + Tempo (traces), Grafana (dashboards), Gatus (uptime). All of it deploys by default. Set **`observability_level`** in `host_vars` to deploy less — `metrics`, `logs` or `traces` (the default), each level including the ones before it. `gatus` and `otel-collector` are ungated and run at every level. See [Enabling monitoring](../../docs/observability/enabling-monitoring.md). |
| **Infrastructure** | PostgreSQL 16, PgBouncer, Redis, Redpanda (Kafka), MinIO, Elasticsearch |
| **Core DIGIT** | MDMS v2, User, Workflow v2, Localization, Boundary, Access Control, IDGEN, Encryption, Persister, Filestore, HRMS, Indexer, Inbox |
| **Application** | PGR Services, URL Shortening, Default Data Handler, Boundary Management |
| **Frontend** | DIGIT UI (React), Kong API Gateway |
| **Seeds** | Tenant data, security config, workflow config, localization, user accounts |

### Files and configuration

The Ansible tree, `host_vars` layout, templates, and runbooks are documented in
[`ansible/README.md`](../ansible/README.md). At a glance:

```text
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

## Troubleshooting

### Services not starting

```bash
docker compose logs <service-name>     # Check a specific service's logs
docker compose restart <service-name>  # Restart a single service
docker compose ps                      # See status of all services
```

### PGR Assign returns "DEPARTMENT_NOT_FOUND"

The assignee must be an **HRMS employee** (not just a user) with a department that matches the complaint type's ServiceDef. Users created via `_createnovalidate` don't have HRMS records.

**Fix**: create employees through the [onboarding wizard](ONBOARDING-AND-ADDONS.md) (Phase 4), the `CRSLoader` library, or `scripts/ci-dataloader.py` — all three write a real HRMS record with a department.

### PGR Rate & Close returns "INVALID_ASSIGNEE"

The RATE workflow action does not support assignees. If you're calling the API directly, set `"assignes": []` (empty array) in the Rate request body.

### UI showing blank page

```bash
# Check if the UI config is serving
curl http://localhost:18000/digit-ui/globalConfigs.js
# Should return JavaScript config. If empty/404, restart digit-ui:
docker compose restart digit-ui
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

## Project structure

```text
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
├── dataloader/                     # CRSLoader library — the single source of
│   │                               # truth for every dataloader path
│   ├── crs_loader.py               # Loader library (used by scripts/ + CI)
│   ├── unified_loader.py           # Low-level MDMS/HRMS API wrapper
│   └── templates/                  # Excel templates + bundled localisations
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
    ├── ONBOARDING-AND-ADDONS.md    # Enable a tenant + load master data + opt-in add-ons
    └── …                           # Local/hybrid/remote setup guides

../backend/pgr-services/            # PGR Java source (hot reload target)
../frontend/micro-ui/               # DIGIT UI React source (hot reload target)
../configs/assets/                  # Runtime configs (globalConfigs.js)
```
