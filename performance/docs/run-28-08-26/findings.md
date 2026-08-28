# Findings

Performance results from load testing DIGIT PGR against a live deployment carrying real data and daily usage (August 2026), run as a CPU-profile matrix plus a burst ladder.

## Testing Methodology

### Tool

All tests use [k6](https://k6.io/) (Grafana), an open-source load testing tool. k6 runs from a control machine and drives HTTP traffic against the DIGIT stack over the public internet (~185ms RTT, included in all latency figures below).

### What Each Virtual User Does

Each k6 **virtual user (VU)** runs a complete PGR complaint lifecycle — 4 sequential API calls through the full stack:

```
CREATE (file complaint) → ASSIGN (route to dept) → RESOLVE (close) → SEARCH (verify)
```

Between each API call, the VU waits 1-3 seconds (random think time) to simulate realistic user pacing. One full lifecycle takes ~9-10 seconds at low load, longer as the server slows down.

### How to Read "Concurrent Users"

A VU is **not** the same as "users online". A real user might make one complaint every few minutes. A VU makes one every ~10 seconds. So **1 VU ≈ 20-30 real concurrent users** in terms of API load.

When we say "80 VUs", the equivalent real-world concurrency is roughly **1,600-2,400 users online simultaneously**, each occasionally filing or checking complaints.

For a more precise mapping, use TPS as the common unit:
- Throughput is reported in lifecycles/sec (each lifecycle = 4 API calls)
- Multiply by 4 to get TPS across all APIs
- Compare against your expected TPS from real user analytics

### Test Profiles

| Scenario | Duration | Ramp Pattern | Purpose |
|----------|----------|-------------|---------|
| `ramp-2vu` | 10 min | 1 VU warmup (2m), ramp to 2 over 2m, 5 min hold, 1m down | Matrix low level |
| `ramp-10vu` | 10 min | 2 VU warmup (2m), ramp to 10 over 2m, 5 min hold, 1m down | Matrix mid level |
| `ramp-50vu` | 12 min | 5 VU warmup (2m), ramp to 50 over 3m, 5 min hold, 2m down | Matrix top level |
| `burst` | configurable | Instant jump to N VUs, hold (N = 20, 40, 80, 160, 320) | Find VU ceiling by error rate |

Only the `main` scenario is measured; warmup is excluded from all thresholds and figures. Throughput is steady-state over the 5-minute hold, not averaged across the run. `burst` declares no thresholds — its levels are judged on measured error rate.

### Resource Profiles

CPU limits are applied to running containers via `docker update` (no restart needed). Each profile file names a per-service CPU share summing to the profile budget; about 20 of the 59 running containers match a named service, and the remainder stay unlimited.

| Profile | Total CPU budget | Applied to |
|---------|-----------------|-----------|
| `cpu-2` | 2 vCPU | ~20 of 59 containers |
| `cpu-4` | 4 vCPU | ~20 of 59 containers |
| `cpu-8` | 8 vCPU | ~20 of 59 containers |
| `cpu-16` | 16 vCPU | ~20 of 59 containers |

A profile is not equivalent to a machine of that size: it pins each service to a fixed slice of the budget, whereas an unthrottled machine lets services burst into each other's idle headroom. Measured on the same host at 50 VU, `cpu-16` gives 2.204 lifecycles/sec while the machine unthrottled gives ~5.4 lifecycles/sec at 359ms p95; at 10 VU the two agree (1.054 vs 1.058 lifecycles/sec) because that level is think-time-bound. Profile figures should therefore be read as profile names, not as vCPU-equivalent machine sizes.

### Test Machines

| Machine | Spec | Purpose |
|---------|-------|------|
| Live deployment | 16 vCPU, 30 GB RAM (KVM guest) | Full-stack validation, 59 containers, real usage |

Idle baseline before any test load: load average 5.5-6.9, ~28 GB of the 30 GB already in use at rest. All figures sit on top of that existing load.

## Executive Summary

| Metric | Value |
|--------|-------|
| Peak throughput | 2.204 lifecycles/sec (8.80 API req/s), `cpu-16` at 50 VU |
| Daily capacity | **190,426 transactions/day** |
| VU ceiling | **80 concurrent users** (last burst level under 1% errors) |
| 5% error rate crossed at | 320 VU |
| Matrix cells passing all thresholds | 3 of 12 |
| Records in database | ~2,300 complaints |

The 16 vCPU profile exceeds a 10,000 txn/day target by 19x and is not saturated at the top of the matrix. Below 8 vCPU the container quota binds before the host does — CPU idle stayed at 60-90% while the stack collapsed.

## Baseline Performance

### Ramp Tests (CPU Profile Matrix)

Steady-state over the 5-minute hold (samples where `vus >= 0.95 × peak`), counting only lifecycles that reach RESOLVED. One lifecycle = 4 API calls.

| Profile | VU | Lifecycles/s | API req/s | http p95* | http p99* | txn p95† | Success | HTTP fail |
|---------|----|-------------|-----------|----------|----------|---------|---------|-----------|
| cpu-2 | 2 | 0.066 | 0.27 | 11.19s | 14.94s | 43.6s | 100% | 0% |
| cpu-2 | 10 | 0.051 | 0.27 | 60.29s | 60.57s | 188.8s | 68.0% | 13.33% |
| cpu-2 | 50 | 0.000 | 0.85 | 61.08s | 63.32s | 175.8s | 0% | 91.84% |
| cpu-4 | 2 | 0.111 | 0.45 | 5.85s | 7.43s | 21.8s | 100% | 0% |
| cpu-4 | 10 | 0.216 | 0.88 | 17.56s | 22.30s | 57.4s | 100% | 0% |
| cpu-4 | 50 | 0.049 | 1.05 | 60.31s | 60.71s | 199.7s | 15.2% | 53.61% |
| cpu-8 | 2 | 0.201 | 0.80 | 1.11s | 1.72s | 11.9s | 100% | 0% |
| cpu-8 | 10 | 0.683 | 2.73 | 4.26s | 5.68s | 21.3s | 100% | 0% |
| cpu-8 | 50 | 0.693 | 2.80 | 24.13s | 27.50s | 85.6s | 100% | 0% |
| cpu-16 | 2 | 0.204 | 0.83 | 0.83s | 1.24s | 11.5s | 100% | 0% |
| cpu-16 | 10 | 1.054 | 4.21 | 0.60s | 0.81s | 11.4s | 100% | 0% |
| **cpu-16** | **50** | **2.204** | **8.80** | 7.31s | 8.68s | 29.5s | **100%** | **0%** |

\* `http_req_duration`, includes ~185ms network RTT.
† `transaction_duration`, the full 4-call lifecycle including ~8s of think time.

### Threshold Verdicts

Declared thresholds: `transaction_duration` p95 < 15s and p99 < 25s, `transaction_success` rate > 0.95, `http_req_failed` rate < 0.01, `http_req_duration` p95 < 5s and p99 < 10s.

| Profile | VU | Verdict |
|---------|----|---------|
| cpu-2 | 2 | Latency thresholds crossed |
| cpu-2 | 10 | Latency, `http_req_failed` and `transaction_success` crossed |
| cpu-2 | 50 | Latency, `http_req_failed` and `transaction_success` crossed |
| cpu-4 | 2 | Latency thresholds crossed |
| cpu-4 | 10 | Latency thresholds crossed |
| cpu-4 | 50 | Latency, `http_req_failed` and `transaction_success` crossed |
| cpu-8 | 2 | **All thresholds passed** |
| cpu-8 | 10 | Latency thresholds crossed |
| cpu-8 | 50 | Latency thresholds crossed |
| cpu-16 | 2 | **All thresholds passed** |
| cpu-16 | 10 | **All thresholds passed** |
| cpu-16 | 50 | Latency thresholds crossed |

Three of the twelve cells pass every threshold. Everywhere else at least the latency budget is crossed; only `cpu-2` at 10 and 50 VU and `cpu-4` at 50 VU also cross the failure and success-rate budgets.

### Burst Tests (VU Ceiling)

`burst.js` (`constant-vus`, no thresholds declared) run under the `cpu-16` profile:

| VUs | Lifecycles/s | API req/s | http p95 | Success | `http_req_failed` |
|-----|-------------|-----------|----------|---------|------------------|
| 20 | 1.840 | 7.81 | 1.65s | 100% | 0.000% |
| **40** | **2.208** | **9.68** | 4.59s | 99.6% | 0.086% |
| 80 | 1.331 | 6.97 | 15.31s | 100% | 0.000% |
| 160 | 0.567 | 6.41 | 36.64s | 93.2% | 3.34% |
| 320 | 0.000 | 9.26 | 60.00s | 0% | 67.4% |

**VU ceiling: 80** — the last level below 1% HTTP failures. The 5% error rate is crossed at 320 VU; the ladder stopped there by design and 640 VU was not run. Peak throughput is at 40 VU; above it the added concurrency converts into latency first and errors after.

## Degradation Points by Profile

| Profile | Peak throughput | Saturation | All thresholds pass at | Errors > 5% | Max HTTP failure rate |
|---------|----------------|-----------|----------------------|-------------|----------------------|
| cpu-2 | 0.066/s (2 VU) | Below 2 VU | never | 10 VU | 91.84% |
| cpu-4 | 0.216/s (10 VU) | 10 VU | never | 50 VU | 53.61% |
| cpu-8 | 0.693/s (50 VU) | Plateau from 10 VU | 2 VU | never | 0% |
| cpu-16 | 2.204/s (50 VU) | Not saturated at 50 VU | 2 and 10 VU | 160 VU (burst) | 0% in matrix, 67.4% at 320 VU |

**Key observations:**

- **cpu-2** is saturated below the lowest level tested. At 2 VU it still completes every lifecycle, but at 11.19s http p95. At 10 VU success drops to 68.0%, and at 50 VU no lifecycle reaches RESOLVED at all.
- **cpu-4** peaks at 10 VU (0.216 lifecycles/sec) and collapses at 50 VU — throughput falls to 0.049/s at 15.2% success and 53.61% HTTP failures.
- **cpu-8** returns the same throughput at 10 and 50 VU (0.683 vs 0.693 lifecycles/sec) at 100% success. The extra load is absorbed entirely as latency: http p95 rises from 4.26s to 24.13s.
- **cpu-16** is not saturated at 50 VU — throughput is still rising with concurrency (0.204 → 1.054 → 2.204 lifecycles/sec) at 100% success and 0% failures, and sits below the think-time ceiling of 5.4 lifecycles/sec (50 VU ÷ 9.2s per iteration).
- **Latency, not errors, is the first thing to give.** Every profile crosses its latency budget before it crosses its failure budget, and cpu-8 and cpu-16 never cross the failure budget inside the matrix at all.

## Host Behaviour

| Profile | Min CPU idle | Where the limit binds |
|---------|-------------|----------------------|
| cpu-2 | 60-90% | Container CPU quota |
| cpu-4 | 60-90% | Container CPU quota |
| cpu-8 | 1.9% (at 50 VU) | Host CPU |
| cpu-16 | 5.6% (at 50 VU) | Host CPU |

Under `cpu-2` and `cpu-4` the host was never the bottleneck — CPU idle stayed between 60% and 90% while the stack collapsed, so the cgroup caps bind rather than the machine. Host pressure appears only from `cpu-8` up.

In the burst ladder, 320 VU drove load average to 32.6 while CPU idle stayed at 64% — threads blocked on queues rather than burning CPU.

Available memory stayed between 800 MB and 4.4 GB of 30 GB across the whole campaign. There were no OOM kills, no container restarts attributable to load, and Kong returned 200 at every check.

## Deployment Configuration

Pointing the harness at a live deployment requires configuration the harness previously hardcoded. These are overridable via `k6/config/environments.js` (see `environments.js.example`):

| Setting | Stock value | Why it must change |
|-----------|------------|----------------------|
| Locality code | `JLC477` | Seed-only value. PGR validates locality against the boundary service, so every CREATE fails without a real code. |
| City/district/region | `City A` | Seed-only value. |
| Tenant | `statea.citya` | PGR workflow and `RAINMAKER-PGR.ComplaintHierarchy` may resolve at the state tenant, not the city. |
| Service codes | 33 defaults | Must be restricted to codes whose department has active employees, or ASSIGN has nobody to route to. |
| Citizen identity | 100 fabricated users | Creates junk user records on shared environments. |

The test employee must hold roles for every transition the lifecycle drives. `ASSIGN` requires `GRO` or `PGR_VIEWER`; `RESOLVE` requires `PGR_LME` or `PGR_VIEWER`.
