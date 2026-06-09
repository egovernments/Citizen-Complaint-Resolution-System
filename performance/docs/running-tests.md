# Running Tests

How to run load tests and interpret results.

## Single Test

Use `run-test.sh` to run one scenario:

```bash
./scripts/run-test.sh <env> <profile> <scenario>
```

| Parameter | Values | Description |
|-----------|--------|-------------|
| `env` | `dev`, `prod` | Target environment (from `environments.js`) |
| `profile` | `baseline`, `cpu-2`, `cpu-4`, `cpu-8`, `cpu-16` | CPU profile label (informational — profile must be applied separately) |
| `scenario` | `smoke`, `ramp-2vu`, `ramp-10vu`, `ramp-50vu`, `burst`, `seed-1m`, `seed-calibrate` | k6 scenario file (without `.js`) |

Example:

```bash
./scripts/run-test.sh prod cpu-4 ramp-10vu
```

Results are saved to `results/<timestamp>_<env>_<profile>_<scenario>/` containing:
- `console.log` — k6 terminal output
- `summary.json` — k6 summary export (for automated analysis)
- `metrics.csv` — time-series metrics
- `k6-output.json` — full k6 output

**Note:** The `profile` parameter is a label for organizing results. It does not apply the CPU profile — use Ansible for that (see [CPU Profiles](#cpu-profiles) below).

## Full Test Matrix

`run-matrix.sh` runs all ramp scenarios across all profiles on both machines:

```bash
./scripts/run-matrix.sh
```

The matrix flow:
1. For each CPU profile (`cpu-2`, `cpu-4`, `cpu-8`, `cpu-16`):
   - Apply the profile to both machines via Ansible
   - Wait 30 seconds for services to stabilize
   - Run `ramp-2vu`, `ramp-10vu`, `ramp-50vu` on dev and prod in parallel
2. Generate summary with `collect-results.sh`

**Runtime estimate:** ~4 profiles x (10 min per scenario x 3 scenarios) = ~2 hours per environment. Since dev and prod run in parallel, total wall time is ~2 hours.

Dev runs profiles `cpu-2`, `cpu-4`, `cpu-8`. Prod runs all four including `cpu-16`.

## Scenario Reference

### smoke

**Purpose:** Validate that test scripts work against the target.
**When to use:** After any configuration change, before running real tests.

```bash
./scripts/run-test.sh dev baseline smoke
```

**Duration:** ~30 seconds. **VUs:** 1. **Iterations:** 1.

### ramp-2vu

**Purpose:** Steady-state performance at light load.
**When to use:** Baseline measurement, regression checks.

```bash
./scripts/run-test.sh dev baseline ramp-2vu
```

**Duration:** 10 minutes. 2 min warmup (1 VU), then 2 min ramp to 2 VUs, 5 min steady, 1 min ramp down.

### ramp-10vu

**Purpose:** Moderate concurrent load.
**When to use:** Standard performance measurement.

```bash
./scripts/run-test.sh prod cpu-4 ramp-10vu
```

**Duration:** 10 minutes. 2 min warmup (2 VUs), then 2 min ramp to 10 VUs, 5 min steady, 1 min ramp down.

### ramp-50vu

**Purpose:** Heavy concurrent load.
**When to use:** Stress testing, capacity planning.

```bash
./scripts/run-test.sh prod cpu-8 ramp-50vu
```

**Duration:** 12 minutes. 2 min warmup (5 VUs), then 3 min ramp to 50 VUs, 5 min steady, 2 min ramp down.

### burst

**Purpose:** Find the VU ceiling — where failures begin.
**When to use:** Capacity testing, finding breaking points.

```bash
k6 run --no-usage-report --env TARGET=prod --env VUS=200 --env DUR=2m k6/scenarios/burst.js
```

**Note:** `burst` uses environment variables (`VUS`, `DUR`) instead of `run-test.sh`. Run directly with k6.

Start at 20 VUs and double until failures appear. The ceiling is the last VU count with 100% success.

### seed-1m

**Purpose:** Populate the database with realistic record volumes.
**When to use:** Before testing performance at scale.

```bash
k6 run --no-usage-report --env TARGET=prod k6/scenarios/seed-1m.js
```

**Duration:** 12-16 hours (540,000 iterations at ~12/sec). **VUs:** 50.

Run this directly with k6 (not through `run-test.sh`) since it runs for hours. Consider using `nohup` or `tmux`:

```bash
nohup k6 run --no-usage-report --env TARGET=prod k6/scenarios/seed-1m.js > seed.log 2>&1 &
```

### seed-calibrate

**Purpose:** Quick throughput measurement before committing to a long seeding run.
**When to use:** After applying DB fixes, before running `seed-1m`.

```bash
k6 run --no-usage-report --env TARGET=prod k6/scenarios/seed-calibrate.js
```

**Duration:** 1-3 minutes (1,000 iterations). **VUs:** 50.

## CPU Profiles

### Apply a Profile

CPU profiles are applied to running containers via Ansible — no restart required:

```bash
ansible-playbook -i ansible/inventory.ini ansible/playbook-profile.yml -e cpu_profile=cpu-4
```

Available profiles: `cpu-2`, `cpu-4`, `cpu-8`, `cpu-16`, `baseline` (removes all limits).

### What Each Profile Allocates

See [`profiles/`](https://github.com/ChakshuGautam/PGR-load-tests/tree/main/profiles) for full per-service breakdowns. Key services:

| Service | cpu-2 | cpu-4 | cpu-8 | cpu-16 |
|---------|-------|-------|-------|--------|
| Postgres | 0.40 | 0.80 | 1.60 | 3.20 |
| Redpanda | 0.25 | 0.50 | 1.00 | 2.00 |
| PGR | 0.10 | 0.20 | 0.40 | 0.80 |
| Workflow | 0.08 | 0.16 | 0.32 | 0.64 |

### Remove All Limits

```bash
ansible-playbook -i ansible/inventory.ini ansible/playbook-profile.yml -e cpu_profile=baseline
```

## Interpreting Results

### Key Metrics

| Metric | What It Measures |
|--------|-----------------|
| `transaction_duration` | End-to-end time for one full lifecycle (includes think time) |
| `transaction_success` | Rate of fully completed lifecycles (CREATE through SEARCH) |
| `http_req_duration` | Individual HTTP request latency (actual server time) |
| `http_req_failed` | Rate of non-200 HTTP responses |

### Understanding Latency Numbers

- **p50** — Median. Half of transactions are faster than this.
- **p95** — 95th percentile. 1 in 20 transactions is slower.
- **p99** — 99th percentile. 1 in 100 transactions is slower.

`transaction_duration` includes think time (~8 seconds of random sleeps). To compare server performance, use `http_req_duration`.

### Throughput Calculation

From k6 output, throughput can be derived:

```
Throughput (lifecycles/sec) = http_reqs_count / (6 requests × duration_seconds)
```

Each lifecycle makes ~6 HTTP requests (auth + 4 PGR calls + possible retry). For daily capacity:

```
Daily capacity = throughput × 86,400
```

### Pass/Fail Determination

Ramp scenarios have built-in thresholds (see [architecture.md](architecture.md#passfail-thresholds)). k6 exits with code 99 if thresholds are violated. Check the final output for:

```
✓ transaction_duration.............: p(95)=1234ms < 15000ms
✗ transaction_success..............: rate=0.85 < 0.95
```

## Collecting Results

After running tests, generate a summary table:

```bash
./scripts/collect-results.sh
```

This reads `summary.json` from each result directory and produces `results/SUMMARY.md` — a markdown table with p50/p95/p99 latencies, error rates, throughput, and pass/fail for each test run.

## Troubleshooting

### Auth 401 Errors

Symptoms: `PGR Create failed: 401` in k6 output.

The test scripts automatically retry once on 401 by clearing the cached token and re-authenticating. If 401s persist:

1. Check the credentials in `environments.js`
2. Verify the user exists: `curl -X POST http://<IP>:18000/user/oauth/token -d 'username=ADMIN&password=eGov@123&grant_type=password&scope=read&tenantId=statea.citya&userType=EMPLOYEE' -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo='`
3. Keycloak may need a restart if it ran out of memory

### ASSIGN Failures After CREATE

Symptoms: `PGR ASSIGN failed: 500` with "record not found" errors.

The Kafka persister writes records asynchronously. Under high load, the record may not be in Postgres when ASSIGN runs. The `seed-1m.js` scenario handles this with a 1-second sleep between CREATE and ASSIGN. If failures persist, increase the sleep or reduce VU count.

### Kong DNS Cache

Symptoms: Requests fail after restarting services with `docker compose restart`.

Kong caches container IP addresses. A restart assigns new IPs but Kong keeps the old ones. Fix:

```bash
# Don't do this:
docker compose restart

# Do this instead:
docker compose down && docker compose up -d
```

### Disk Space

Symptoms: Tests slow down dramatically or containers crash.

Check disk usage: `df -h`

Common causes:
- **Container logs** — Can reach 37+ GB under sustained load. Configure log rotation (see [setup.md](setup.md#docker-log-rotation)).
- **Docker volumes** — Orphaned volumes accumulate. Run `docker volume prune` to reclaim space.
- **k6 output files** — `metrics.csv` and `k6-output.json` can be large. Clean up old results.

### Slow Performance at Scale

Symptoms: Latency increases as record count grows.

Ensure all SQL indexes from [setup.md](setup.md#database-preparation) are applied. Check with:

```bash
docker exec docker-postgres psql -U egov -d egov -c "\di+ idx_eg_pgr*"
docker exec docker-postgres psql -U egov -d egov -c "\di+ idx_wf_pi*"
docker exec docker-postgres psql -U egov -d egov -c "SHOW jit;"  # should be 'off'
```

See [findings.md](findings.md) for the root causes and fixes.
