# DIGIT Core Services - Startup Sequence

This document describes the startup sequence and dependencies for DIGIT core services.
<!-- CI: tilt-ci workflow added -->

## Dependency Graph

```
                    ┌─────────────────────────────────────────────────┐
                    │            INFRASTRUCTURE LAYER                  │
                    │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │
                    │  │Postgres │  │  Redis  │  │    Redpanda     │  │
                    │  └────┬────┘  └────┬────┘  └────────┬────────┘  │
                    │       │            │                │           │
                    └───────┼────────────┼────────────────┼───────────┘
                            │            │                │
                            ▼            ▼                ▼
                    ┌─────────────────────────────────────────────────┐
                    │              CORE SERVICES (Tier 1)              │
                    │                                                  │
                    │  ┌────────────────────┐  ┌───────────────────┐  │
                    │  │  egov-mdms-service │  │  egov-localization│  │
                    │  │  (Flyway creates   │  │  (Independent)    │  │
                    │  │   MDMS tables)     │  │                   │  │
                    │  └─────────┬──────────┘  └───────────────────┘  │
                    │            │                                     │
                    └────────────┼─────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────────────────────┐
                    │                 SEED JOBS (Tier 2)               │
                    │                                                  │
                    │  ┌──────────────────┐                           │
                    │  │ mdms-tenant-seed │ ← Waits for MDMS tables   │
                    │  │ (Seeds: tenant)  │                           │
                    │  └────────┬─────────┘                           │
                    │           │                                      │
                    │           ▼                                      │
                    │  ┌───────────────────────┐                      │
                    │  │  mdms-workflow-seed   │                      │
                    │  │  (Seeds: Workflow)    │                      │
                    │  └───────────────────────┘                      │
                    │                                                  │
                    │  ┌───────────────────────┐                      │
                    │  │  localization-seed    │ ← After localization │
                    │  └───────────────────────┘                      │
                    └─────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────────────────────┐
                    │           DEPENDENT SERVICES (Tier 3)            │
                    │                                                  │
                    │  ┌───────────────────┐  ┌───────────────────┐   │
                    │  │  egov-enc-service │  │    egov-idgen     │   │
                    │  │  (Needs: tenant)  │  │  (Needs: MDMS)    │   │
                    │  └─────────┬─────────┘  └───────────────────┘   │
                    │            │                                     │
                    │            ▼                                     │
                    │  ┌───────────────────┐  ┌───────────────────┐   │
                    │  │    egov-user      │  │ egov-workflow-v2  │   │
                    │  │  (Needs: enc,     │  │  (Needs: Workflow │   │
                    │  │   tenant-seed)    │  │   MDMS seed)      │   │
                    │  └───────────────────┘  └───────────────────┘   │
                    │                                                  │
                    │  ┌───────────────────┐  ┌───────────────────┐   │
                    │  │  egov-location    │  │ egov-accesscontrol│   │
                    │  │  boundary-service │  │   egov-persister  │   │
                    │  └───────────────────┘  └───────────────────┘   │
                    └─────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────────────────────────────┐
                    │            FINAL SEED & APPS (Tier 4)            │
                    │                                                  │
                    │  ┌─────────────────────────────────────────┐    │
                    │  │                db-seed                   │    │
                    │  │  (Final seed after all services ready)   │    │
                    │  └─────────────────────────────────────────┘    │
                    │                                                  │
                    │  ┌───────────────────┐  ┌───────────────────┐   │
                    │  │   pgr-services    │  │     digit-ui      │   │
                    │  │  (Full stack)     │  │   (Frontend)      │   │
                    │  └───────────────────┘  └───────────────────┘   │
                    │                                                  │
                    │  ┌───────────────────────────────────────────┐  │
                    │  │                   Kong                     │  │
                    │  │              (API Gateway)                 │  │
                    │  └───────────────────────────────────────────┘  │
                    └─────────────────────────────────────────────────┘
```

## Startup Order (Detailed)

### Phase 1: Infrastructure
| Service | Port | Health Check | Notes |
|---------|------|--------------|-------|
| postgres | 15432 | `pg_isready` | Creates `egov` database |
| redis | 16379 | `redis-cli ping` | Session/cache store |
| redpanda | 19092 | `rpk cluster health` | Kafka-compatible broker |

### Phase 2: Core Services (No MDMS dependencies)
| Service | Port | Depends On | Flyway Table |
|---------|------|------------|--------------|
| egov-mdms-service | 18094 | postgres, redpanda | `mdms_schema_version` |
| egov-localization | 18096 | postgres, redpanda, redis | `localization_schema_version` |
| egov-accesscontrol | 18090 | postgres, redpanda | `accesscontrol_schema_version` |
| egov-persister | 18091 | postgres, redpanda | N/A (config-driven) |

### Phase 3: MDMS Seeds
| Seed | Depends On | Seeds |
|------|------------|-------|
| mdms-tenant-seed | MDMS healthy + tables exist | `tenant.tenants` |
| mdms-workflow-seed | mdms-tenant-seed completed | `Workflow.BusinessServiceMasterConfig` |
| localization-seed | egov-localization healthy | localization messages |

### Phase 4: Services needing MDMS data
| Service | Port | MDMS Requirements | Other Dependencies |
|---------|------|-------------------|-------------------|
| egov-enc-service | 11234 | `tenant.tenants` | mdms-tenant-seed |
| egov-idgen | 18088 | MDMS host config | MDMS healthy |
| egov-user | 18107 | `Security.*`, tenant | enc-service, mdms-tenant-seed |
| egov-workflow-v2 | 18109 | `Workflow.*` | mdms-workflow-seed |
| egov-location | 18084 | - | postgres, redpanda |
| boundary-service | 18081 | - | MDMS healthy |

### Phase 5: Application Services
| Service | Port | Depends On |
|---------|------|------------|
| pgr-services | 18083 | idgen, user, workflow, localization |
| digit-ui | 18080 | None (static frontend) |
| kong | 18000 | MDMS, user |

### Phase 6: Final Seeds
| Seed | Depends On | Seeds |
|------|------------|-------|
| db-seed | All core services healthy | idgen formats, roles, etc. |

## MDMS Data Dependencies

### Required MDMS Schemas
```
tenant.tenants          → Used by: enc-service, user
Workflow.BusinessServiceMasterConfig → Used by: workflow-v2
Security.EncryptionPolicy           → Used by: user (encryption lib)
common-masters.IdFormat             → Used by: idgen
```

### Critical Timing Issue
The MDMS service reports "healthy" as soon as its HTTP endpoint responds, but Flyway migrations may still be running. Seeds must wait for tables to exist:

```bash
# Wait pattern used in seed entrypoints
until psql ... -c 'SELECT 1 FROM eg_mdms_schema_definition LIMIT 1'; do
  sleep 2;
done;
```

## Ports Summary

| Range | Purpose |
|-------|---------|
| 15432 | Postgres |
| 16379 | Redis |
| 19092 | Redpanda (Kafka) |
| 18000-18002 | Kong Gateway |
| 18080 | DIGIT UI |
| 18081-18109 | Core Services |
| 11234 | Encryption Service |

## Troubleshooting

### Service won't start - MDMS errors
Check if MDMS seeds completed:
```bash
docker exec docker-postgres psql -U egov -d egov -c "SELECT schemacode FROM eg_mdms_data;"
```

### Flyway migration conflicts
Each service uses unique `SPRING_FLYWAY_TABLE`:
- mdms_schema_version
- idgen_schema_version
- workflow_schema_version
- etc.

### Check service logs
```bash
docker logs <service-name> 2>&1 | tail -50
```

### Restart a specific service
```bash
docker compose restart <service-name>
```

### idgen "No Format is available" error
Ensure MDMS IdFormat is seeded:
```bash
docker exec docker-postgres psql -U egov -d egov -c "SELECT data FROM eg_mdms_data WHERE schemacode = 'common-masters.IdFormat';"
```

### idgen "Error retrieving seq number" / sequence not found
1. Check if required sequence exists:
```bash
docker exec docker-postgres psql -U egov -d egov -c "\ds seq_eg_pgr_id"
```

2. Create missing sequence:
```bash
docker exec docker-postgres psql -U egov -d egov -c "CREATE SEQUENCE IF NOT EXISTS seq_eg_pgr_id START 1;"
```

3. Enable auto-creation via environment:
```yaml
AUTOCREATE_NEW_SEQ: 'true'
```

### idgen "Missing property city" error
Tenant data must include `city.code` for idgen. Update tenant records:
```sql
UPDATE eg_mdms_data
SET data = data || '{"city":{"code":"PB","name":"Punjab"}}'::jsonb
WHERE schemacode = 'tenant.tenants' AND (data->>'code') = 'pg' AND (data->'city') IS NULL;
```

### OpenTelemetry JDBC driver issues
If you see "Driver io.opentelemetry.instrumentation.jdbc.OpenTelemetryDriver claims to not accept jdbcUrl", add:
```yaml
SPRING_DATASOURCE_DRIVER_CLASS_NAME: org.postgresql.Driver
```

## Using Tilt for Local Development

### Starting with Tilt
```bash
cd /root/code/digit-2.9lts-core-storm
tilt up
```

Access Tilt UI at: http://localhost:10350

### Tilt Resources

| Label | Resources |
|-------|-----------|
| infrastructure | postgres, redis, redpanda |
| core-services | egov-mdms-service, egov-enc-service, egov-idgen, egov-user, egov-workflow-v2, egov-localization, egov-location, boundary-service, egov-accesscontrol, egov-persister |
| gateway | kong |
| pgr | pgr-services |
| frontend | digit-ui |
| seeds | db-seed, mdms-tenant-seed, mdms-security-seed, mdms-workflow-seed, localization-seed |
| maintenance | nuke-db |

### Tilt Navigation Buttons

| Button | Description |
|--------|-------------|
| Health Check | Runs `scripts/health-check.sh` |
| Smoke Tests | Runs `scripts/smoke-tests.sh` |
| Test idgen | Tests ID generation via API call |
| Kong Test | Tests Kong API gateway |
| Nuke DB | Destroys all data and restarts infrastructure |
| Re-seed MDMS | Re-runs the MDMS seed SQL |

### Checking Resource Status
```bash
# List all resources with status
tilt get uiresource -o json | jq -r '.items[] | "\(.metadata.name): \(.status.runtimeStatus // "n/a")"'

# Trigger a specific resource
tilt trigger <resource-name>

# View logs for a resource
tilt logs <resource-name>
```

### Using a Different Port
If port 10350 is in use:
```bash
TILT_PORT=10351 tilt up
```

## CI/CD Pipeline

### GitHub Actions Workflow

The CI workflow (`.github/workflows/ci.yaml`) runs two jobs:

1. **test** - Uses docker-compose directly
   - Starts all services
   - Waits for health checks
   - Verifies seed data
   - Runs health checks and smoke tests
   - Tests idgen service

2. **tilt-test** - Uses Tilt orchestration
   - Validates Tiltfile
   - Starts services via `tilt ci`
   - Runs same health/smoke tests
   - Tests idgen service

### Running CI Tests Locally
```bash
# Run health checks
./scripts/health-check.sh

# Run smoke tests
./scripts/smoke-tests.sh

# Test idgen
curl -X POST 'http://localhost:18088/egov-idgen/id/_generate' \
  -H 'Content-Type: application/json' \
  -d '{"RequestInfo":{"apiId":"digit","ver":"1.0"},"idRequests":[{"tenantId":"pg","idName":"pgr.servicerequestid"}]}'
```

### Seeds Order in CI
Seeds run in dependency order:
1. `mdms-tenant-seed` - Base tenant data
2. `mdms-security-seed` - DataSecurity for enc-client
3. `mdms-workflow-seed` - Workflow configuration
4. `localization-seed` - UI messages
5. `db-seed` - Final seed after all services ready

## Loading PGR configuration and master data

There is no container for this — the DataLoader is a Python library you run from the
repo. (The Jupyter Lab service that used to host it as a notebook was removed in #1743;
the library itself moved to `local-setup/dataloader/` and is unchanged.)

### Running it

```bash
cd local-setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r dataloader/requirements.txt

# One command, all phases, from a county spreadsheet:
DIGIT_URL=http://localhost:18000 BOOT_TENANT=pg.mycity \
INPUT_XLSX="data/Bomet county health common complains items - R.xlsx" \
python3 scripts/ci-dataloader-xlsx.py
```

`INPUT_XLSX` is your own county spreadsheet — the Bomet file above is the only
one bundled, and there is no `county-data.xlsx` in the repo.

For per-phase control, import `crs_loader` directly — see
[ONBOARDING-AND-ADDONS.md § B](ONBOARDING-AND-ADDONS.md#b-python-dataloader-scripted).

### What it does

1. **Load tenant configuration** - Set up tenant branding and logos
2. **Create boundaries** - Administrative divisions (districts, wards, localities)
3. **Configure complaint types** - ServiceDefs for PGR
4. **Create test employees** - Users who can handle complaints

### Template files

Templates are in `dataloader/templates/`:
- `Tenant And Branding Master.xlsx` - Tenant configuration
- `Boundary_Master.xlsx` - Administrative boundaries
- `Common and Complaint Master.xlsx` - Departments, designations, complaint types

### Environment variables

The scripts read these; the defaults suit a local Compose stack:
```
DIGIT_URL=http://localhost:18000     # Kong gateway
DIGIT_USERNAME=ADMIN
DIGIT_PASSWORD=eGov@123
ROOT_TENANT=pg                       # tenant you authenticate against
```
The tenant being *created* is named per script, not by a shared variable:
`ci-dataloader-xlsx.py` reads `BOOT_TENANT` (default `ke.bomet`) plus
`INPUT_XLSX`, and `ci-dataloader.py` reads `TARGET_TENANT` (default
`pg.citest`). There is no `DIGIT_TENANT` — nothing reads it.

## Gatus Health Monitoring Dashboard

### Starting Gatus
```bash
# Via docker compose
docker compose --profile tools up -d gatus

# Or via Tilt button
# Click "Start Gatus" in Tilt UI
```

Access Gatus Dashboard at: **http://localhost:18889**

### What Gatus Monitors

| Group | Services |
|-------|----------|
| Infrastructure | PostgreSQL, Redis, Redpanda |
| Core Services | MDMS, Encryption, IDGen, User, Workflow, Localization, Location, Boundary, Access Control, Persister |
| API Gateway | Kong Proxy, Admin API, Status |
| Application | PGR Services, DIGIT UI |
| API Tests | MDMS Tenant Search, IDGen Generate, Localization Search |

### Features
- Real-time health status for all services
- Historical uptime tracking
- Automatic alerting (configurable)
- API response time monitoring

### Configuration
Gatus config is at `gatus/config.yaml`. Add new endpoints:
```yaml
endpoints:
  - name: My New Service
    group: Custom
    url: "http://my-service:8080/health"
    interval: 30s
    conditions:
      - "[STATUS] == 200"
```
