# Findings

Performance results from load testing DIGIT PGR against a live deployment carrying real data and daily usage (August 2026).

## Testing Methodology

### Tool

All tests use [k6](https://k6.io/) (Grafana), an open-source load testing tool. k6 runs from a control machine and drives HTTP traffic against the DIGIT stack over the public internet (~185ms RTT, included in all latency figures below).

### What Each Virtual User Does

Each k6 **virtual user (VU)** runs a complete PGR complaint lifecycle — 4 sequential API calls through the full stack:

```
CREATE (file complaint) → ASSIGN (route to dept) → RESOLVE (close) → SEARCH (verify)
```

Between each API call, the VU waits 1-3 seconds (random think time) to simulate realistic user pacing. One full lifecycle takes ~9.5-14 seconds depending on server load.

### How to Read "Concurrent Users"

A VU is **not** the same as "users online". A real user might make one complaint every few minutes. A VU makes one every ~10 seconds. So **1 VU ≈ 20-30 real concurrent users** in terms of API load.

When we say "125 VUs", the equivalent real-world concurrency is roughly **2,500-3,750 users online simultaneously**, each occasionally filing or checking complaints.

For a more precise mapping, use TPS as the common unit:
- Throughput is reported in lifecycles/sec (each lifecycle = 4 API calls)
- Multiply by 4 to get TPS across all APIs
- Compare against your expected TPS from real user analytics

### Test Profiles

| Scenario | Duration | Ramp Pattern | Purpose |
|----------|----------|-------------|---------|
| `ramp-2vu` | 10 min | 1 VU warmup (2m), ramp to 2 over 2m, 5 min hold, 1m down | Baseline |
| `ramp-10vu` | 10 min | 2 VU warmup (2m), ramp to 10 over 2m, 5 min hold, 1m down | Baseline |
| `ramp-50vu` | 12 min | 5 VU warmup (2m), ramp to 50 over 3m, 5 min hold, 2m down | Steady-state performance |
| `ramp-nvu` | 12 min | VU/10 warmup (2m), ramp to N over 3m, 5 min hold, 2m down | Find degradation point (N = 75-150) |

Only the `main` scenario is measured; warmup is excluded from all thresholds and figures. Throughput is steady-state over the 5-minute hold, not averaged across the run.

### Test Machines

| Machine | Spec | Purpose |
|---------|-------|------|
| Live deployment | 16 vCPU, 30 GB RAM (KVM guest) | Full-stack validation, 59 containers, real usage |

Idle baseline before any test load: load average 5.5-6.9, 4-7 GB memory available. All figures sit on top of that existing load.

## Executive Summary

| Metric | Value |
|--------|-------|
| Peak throughput | 10.8 lifecycles/sec (43.3 API req/s) |
| Daily capacity | **934,762 transactions/day** |
| VU ceiling | **125 concurrent users** |
| Breaking point | 150 VUs |
| HTTP failures | 0.000% at every level |
| Records in database | 2,250 complaints |

The system exceeds a 10,000 txn/day target by 93x. Failures at the ceiling are caused by latency, not errors — the system queues under saturation rather than shedding load.

## Baseline Performance

### Ramp Tests (Live Deployment)

| Test | Lifecycles | Success | p95 Latency* |
|------|-------------|---------|-------------|
| ramp-2vu | 81 | 100% | 420ms |
| ramp-10vu | 412 | 100% | 407ms |
| ramp-50vu | 2,356 | 100% | 511ms |

\* `http_req_duration`, includes ~185ms network RTT.

### Ramp Tests (VU Ceiling)

| VUs | Result |
|-----|---------------|
| 75 | 100% pass, p95=447ms |
| 100 | 100% pass, p95=756ms |
| 125 | 100% pass, p95=1,321ms |
| 150 | threshold breach, p95=2,326ms |

**VU ceiling: 125.** The breach at 150 VUs is on `transaction_duration` p95 (16.14s against a 15s budget). `http_req_duration` p95 stayed at 2,326ms against its own 5,000ms budget, and HTTP failures remained at 0.000%.

## Degradation Curve

Throughput and latency as a function of concurrency:

| VUs | Throughput | API req/s | p95 Latency | Lifecycles |
|-----|-----------|-----------|-------------|-----------|
| 2 | 0.2/s | 0.9 | 420ms | 81 |
| 10 | 1.1/s | 4.2 | 407ms | 412 |
| 50 | 5.2/s | 20.7 | 511ms | 2,356 |
| 75 | 8.0/s | 31.9 | 447ms | 3,621 |
| 100 | 9.8/s | 39.3 | 756ms | 4,540 |
| **125** | **10.8/s** | **43.3** | 1,321ms | 5,122 |
| 150 | 10.9/s | 43.5 | 2,326ms | 5,363 |

Below 75 VUs throughput tracks the client-side think time almost exactly (`VU / 9.5`), so the server contributes no measurable limit. Divergence begins at 100 VUs. By 150 VUs, adding 25 more VUs yields 0.6% more throughput for 19% more latency.

## Host Behaviour

| VUs | Peak load (16 vCPU) | Min CPU idle | Min memory available |
|-----|--------------------|--------------|---------------------|
| 75 | 32.1 | 12% | 3,006 MB |
| 100 | 45.5 | 3% | 2,427 MB |
| 125 | 63.6 | 2% | 1,655 MB |
| 150 | 61.1 | 2% | 1,315 MB |

CPU is the binding constraint. Memory never falls below 1.3 GB of 30 GB and no container was OOM-killed or restarted.

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
