# Architecture

How the load tests are designed and why.

## System Under Test

The target is a DIGIT platform running as a Docker Compose stack (the [CCRS local-setup](https://github.com/egovernments/Citizen-Complaint-Resolution-System)). The stack runs ~30 containers including:

- **Kong** — API gateway (port 18000)
- **PGR Services** — complaint management (Java/Spring Boot)
- **Workflow v2** — state machine for complaint lifecycle
- **Persister** — Kafka consumer that writes to Postgres
- **Postgres** — primary data store (via PgBouncer)
- **Redpanda** — Kafka-compatible message broker
- **Keycloak** — OAuth2 authentication
- **Elasticsearch** — search indexing (via Indexer service)

All API calls go through Kong. PGR and Workflow are the hot path — they handle every complaint operation. The Persister writes asynchronously via Kafka, which means there's a delay between an API response and the data being available in Postgres.

## PGR Complaint Lifecycle

Each load test iteration runs one full complaint lifecycle — 4 API calls:

```
CREATE  →  ASSIGN  →  RESOLVE  →  SEARCH
  │          │          │          │
  ▼          ▼          ▼          ▼
 POST       POST       POST       POST
 /pgr-services/v2/request/_create
             /pgr-services/v2/request/_update  (action: ASSIGN)
                         /pgr-services/v2/request/_update  (action: RESOLVE)
                                     /pgr-services/v2/request/_search
```

1. **CREATE** — File a new complaint with a service code, citizen info, and address
2. **ASSIGN** — Route the complaint to a department (empty assignees = auto-route)
3. **RESOLVE** — Mark the complaint as resolved
4. **SEARCH** — Verify the complaint reached `RESOLVED` status

Each step triggers workflow state transitions and Kafka events. The RATE step (citizen feedback) is skipped to keep the lifecycle deterministic.

## Test Design Decisions

### Complaint Diversity

All 33 PGR service codes from the DIGIT seed data are rotated across VUs and iterations. Each VU starts at a different offset (`vuId % 33`) and increments per iteration, ensuring even distribution across complaint types.

### Citizen Users

100 citizen users (`LoadTestCitizen_1` through `LoadTestCitizen_100`) are pre-created by the Ansible setup playbook. Each VU maps to a citizen (`vuId % 100 + 1`), so different VUs file complaints as different citizens.

### Authentication

OAuth tokens are cached per-VU for the lifetime of the test. If a 401 is received, the token is cleared and re-obtained on the next call. This avoids hammering the auth endpoint while still recovering from token expiry.

### Think Time

Ramp scenarios include random think time (1-3 seconds) between steps to simulate realistic user pacing. Seed scenarios have no think time — they run at maximum throughput for database population.

### Warmup

Ramp scenarios use a two-phase approach:

1. **Warmup** (2 min) — 1-2 VUs run the lifecycle to warm JVM JIT, fill caches, and establish connections
2. **Main** (7-10 min) — VUs ramp to target, hold steady, then ramp down

Thresholds are scoped to the `main` scenario so warmup data doesn't affect pass/fail.

### Pass/Fail Thresholds

Defined in [`k6/config/thresholds.js`](https://github.com/ChakshuGautam/PGR-load-tests/blob/main/k6/config/thresholds.js):

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| `transaction_duration` p95 | < 15s | Includes ~8s think time; actual work < 7s |
| `transaction_duration` p99 | < 25s | Generous tail for GC pauses |
| `transaction_success` rate | > 95% | Allow for occasional Kafka async failures |
| `http_req_failed` rate | < 1% | Individual HTTP calls should rarely fail |
| `http_req_duration` p95 | < 5s | Server latency without think time |
| `http_req_duration` p99 | < 10s | Tail latency under load |

## Scenario Types

### Smoke (`smoke.js`)

1 VU, 1 iteration. Validates the test scripts work against the target environment. Run this first after any configuration change.

### Ramp (`ramp-2vu.js`, `ramp-10vu.js`, `ramp-50vu.js`)

Gradual load increase with warmup. Used for steady-state performance measurement. Structure:

| Phase | Duration | VUs |
|-------|----------|-----|
| Warmup | 2 min | 1-5 (varies by scenario) |
| Ramp up | 2-3 min | 0 → target |
| Steady | 5 min | target |
| Ramp down | 1-2 min | target → 0 |

### Burst (`burst.js`)

Constant VU count for a fixed duration. Used to find the VU ceiling — the point where failures begin. Configurable via environment variables:

```bash
k6 run --env TARGET=prod --env VUS=200 --env DUR=2m k6/scenarios/burst.js
```

### Seed (`seed-1m.js`)

High-throughput seeding: 50 VUs sharing 540,000 iterations. No think time, no search step (CREATE → ASSIGN → RESOLVE only). Includes a 1-second delay between CREATE and ASSIGN for Kafka persister latency. Designed for populating the database with realistic data volumes.

### Calibrate (`seed-calibrate.js`)

Quick version of seed: 50 VUs, 1,000 iterations. Used to measure current throughput before committing to a long seeding run.

## CPU Profiling

CPU limits are applied to running containers using `docker update` — no container restart required. This avoids JVM cold-start penalties and lets you test the same warmed-up application under different resource constraints.

### Profiles

Four profiles in [`profiles/`](https://github.com/ChakshuGautam/PGR-load-tests/tree/main/profiles), each a Docker Compose override YAML:

| Profile | Total vCPUs | Postgres | Redpanda | PGR | Workflow |
|---------|-------------|----------|----------|-----|----------|
| `cpu-2` | 2.00 | 0.40 | 0.25 | 0.10 | 0.08 |
| `cpu-4` | 4.00 | 0.80 | 0.50 | 0.20 | 0.16 |
| `cpu-8` | 8.00 | 1.60 | 1.00 | 0.40 | 0.32 |
| `cpu-16` | 16.00 | 3.20 | 2.00 | 0.80 | 0.64 |

Profiles are applied remotely via Ansible:

```bash
ansible-playbook -i ansible/inventory.ini ansible/playbook-profile.yml -e cpu_profile=cpu-4
```

To remove all limits and return to baseline:

```bash
ansible-playbook -i ansible/inventory.ini ansible/playbook-profile.yml -e cpu_profile=baseline
```

### How It Works

The [`scripts/apply-cpu-profile.py`](https://github.com/ChakshuGautam/PGR-load-tests/blob/main/scripts/apply-cpu-profile.py) script:
1. Reads the profile YAML to get per-service CPU limits
2. Maps service names to running container IDs via `docker compose ps`
3. Calls `docker update --cpus <limit> <container>` for each service
4. To remove limits, sets `--cpus 0` (unlimited)

## Infrastructure

### Test Machines

Two AWS EC2 instances provisioned for testing:

| Role | Instance | vCPUs | RAM | Disk |
|------|----------|-------|-----|------|
| Dev | `13.200.249.14` | 8 | 16 GB | 96 GB |
| Prod | `13.201.42.73` | 16 | 32 GB | 96 GB |

Both run the identical DIGIT Docker Compose stack at `/opt/digit-ccrs/`.

### Network Access

k6 runs from a control machine (not the test targets) and connects to Kong on port 18000. Two options:

1. **Direct** — If the control machine can reach the AWS instances on port 18000
2. **SSH tunnel** — Forward a local port through SSH:

```bash
ssh -i keys/docker-compose.pem -L 28001:localhost:18000 ubuntu@13.200.249.14  # dev
ssh -i keys/docker-compose.pem -L 28002:localhost:18000 ubuntu@13.201.42.73   # prod
```

Then set `baseUrl: 'http://localhost:28001'` in your environments config.

### Ansible Automation

- **`playbook-setup.yml`** — Full machine provisioning: installs Docker, copies the compose stack, pulls images, starts services, waits for health, creates 100 citizen test users
- **`playbook-profile.yml`** — Applies CPU profiles to running containers without restart

### Platform Submodule

The [`platform/`](https://github.com/ChakshuGautam/PGR-load-tests/tree/main/platform) directory is a git submodule pointing to the [CCRS repository](https://github.com/egovernments/Citizen-Complaint-Resolution-System). It contains the Docker Compose file, service configurations, and database seeds used by the test machines. The submodule pins a specific commit to ensure reproducible test environments.
