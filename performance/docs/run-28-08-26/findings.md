# Findings

Performance results from load testing DIGIT PGR against a live deployment carrying real data and daily usage (August 2026), run as an unthrottled concurrency ladder plus a constrained CPU-profile matrix and a burst ladder.

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

When we say "125 VUs", the equivalent real-world concurrency is roughly **2,500-3,750 users online simultaneously**, each occasionally filing or checking complaints.

For a more precise mapping, use TPS as the common unit:
- Throughput is reported in lifecycles/sec (each lifecycle = 4 API calls)
- Multiply by 4 to get TPS across all APIs
- Compare against your expected TPS from real user analytics

### Test Profiles

| Scenario | Duration | Ramp Pattern | Purpose |
|----------|----------|-------------|---------|
| `ramp-2vu` | 10 min | 1 VU warmup (2m), ramp to 2 over 2m, 5 min hold, 1m down | Baseline low level |
| `ramp-10vu` | 10 min | 2 VU warmup (2m), ramp to 10 over 2m, 5 min hold, 1m down | Baseline mid level |
| `ramp-50vu` | 12 min | 5 VU warmup (2m), ramp to 50 over 3m, 5 min hold, 2m down | Baseline top level |
| `ramp-nvu` | 13 min | 5 VU warmup (2m), ramp to N over 3m, 5 min hold, 2m down (N = 75, 100, 125, 150) | Find sustainable ceiling |
| `burst` | configurable | Instant jump to N VUs, hold (N = 20, 40, 80, 160, 320) | Find VU ceiling by error rate |

Only the `main` scenario is measured; warmup is excluded from all thresholds and figures. Throughput is steady-state over the 5-minute hold (samples where `vus >= 0.95 × peak`), not averaged across the run.

### Test Machines

| Machine | Spec | Purpose |
|---------|-------|------|
| Live deployment | 16 vCPU, 30 GB RAM (KVM guest) | Full-stack validation, 59 containers, real usage |

Idle baseline before any test load: load average 5.5-6.9, and 26.8 GB of the 30.6 GiB held by the stack at rest leaving 4.5 GB available, with **no swap configured**. All figures sit on top of that existing load.

That resting footprint is the reason the minimum deployment spec is **16 vCPU / 32 GiB**. The stack costs the same to keep running regardless of the volume it serves, and below 32 GiB it does not fit in memory — it would have to swap, and a set of JVM services that swaps thrashes rather than slows, because the garbage collector touches memory the operating system has paged to disk. The machine tested here is marginally under that floor, which makes its figures conservative.

## Executive Summary

| Metric | Value |
|--------|-------|
| Peak throughput, ramp ladder | 10.785 lifecycles/sec (43.15 API req/s) at 125 VU |
| Daily capacity, ramp ladder | **931,824 transactions/day** |
| Max sustainable concurrent users, ramp ladder | **125 VU** |
| Breaking point, ramp ladder | 150 VU (end-to-end p95 16.38s vs 15s budget) |
| HTTP failures across the ramp ladder | 0.000% |
| Highest clean level, burst ladder | **80 VU — 8.034 lifecycles/sec, 694,138/day, 0.000% failures** |
| Records in database | ~2,300 complaints |

**Two ladders, two numbers — read them as such.** The *ramp* ladder stops on a latency budget and reached 125 VU / 931,824 per day with no HTTP failure at any level. The *burst* ladder, run three days later to find the failure point by error rate instead, is clean only to 80 VU / 694,138 per day; its 160 and 320 VU levels were invalidated by a JVM heap exhaustion and are withdrawn — see [When the heap gave out](#when-the-heap-gave-out). The two ladders used different scenarios, different stopping rules and different access-control conditions, so neither number supersedes the other. **694,138/day is the figure to plan against**, because it is the one measured with zero failures under the stricter test.

The deployment exceeds a 10,000 txn/day target by at least 69x. Throughput rises linearly to 125 VU on the ramp ladder and flattens above it; latency is the first budget to give there, and no level of that ladder returned a single HTTP failure.

## Baseline Performance

### Ramp Tests (No CPU Limits)

Steady-state over the 5-minute hold (samples where `vus >= 0.95 × peak`), counting only lifecycles that reach RESOLVED. One lifecycle = 4 API calls.

| VU | Lifecycles/s | API req/s | http p95* | http p99* | txn p95† | txn p99† | Lifecycle success‡ | Request fail‡ |
|----|-------------|-----------|----------|----------|---------|---------|---------|-----------|
| 2 | 0.214 | 0.86 | 416ms | 439ms | 11.40s | 11.77s | 100% | 0.000% |
| 10 | 1.054 | 4.20 | 407ms | 429ms | 11.44s | 12.19s | 100% | 0.000% |
| 50 | 5.165 | 20.66 | 517ms | 572ms | 11.74s | 12.39s | 100% | 0.000% |
| 75 | 7.947 | 31.78 | 456ms | 513ms | 11.32s | 12.06s | 100% | 0.000% |
| 100 | 9.798 | 39.20 | 794ms | 954ms | 12.13s | 12.88s | 100% | 0.000% |
| **125** | **10.785** | **43.15** | 1,413ms | 1,835ms | 13.73s | 14.51s | **100%** | **0.000%** |
| 150 | 10.851 | 43.37 | 2,477ms | 3,063ms | 16.38s | 17.42s | 100% | 0.000% |

\* `http_req_duration`, includes ~185ms network RTT.
† `transaction_duration`, the full 4-call lifecycle including ~8s of think time.
‡ Different denominators — see [Reading the two percentage columns](#reading-the-two-percentage-columns).

### Reading the Two Percentage Columns

**The two percentage columns are not complements and will not sum to 100.** They count different things over different denominators:

- **Lifecycle success** (`transaction_success`) — the share of *lifecycles* that completed all four steps and ended in `RESOLVED`. Denominator: lifecycles.
- **Request fail** (`http_req_failed`) — the share of individual *HTTP requests* that returned an error. Denominator: requests, about 4 per lifecycle when healthy.

One failed request anywhere in the chain fails the whole lifecycle, so the lifecycle failure rate runs several times the request failure rate. Worked through on `cpu-4` at 50 VU, using whole-run counters — the tables report the 5-minute hold window instead, so these figures differ from the row above and illustrate the relationship rather than restate it: 225 of 672 requests failed (33.5%), and that killed 108 of 163 lifecycles, leaving 33.7% success. The two percentages sum to 67%, and nothing is unaccounted for.

A lifecycle can also fail with **no** failed request at all — if all four calls return 200 but the final SEARCH does not report `RESOLVED`, or if the run ends mid-lifecycle. And the denominators drift further apart the worse things get, because dying lifecycles bail early and never issue their remaining calls: `cpu-2` at 50 VU averaged 1.66 requests per lifecycle against 4.04 when healthy. The columns coincide at 100% only in the trivial case where nothing failed.


### Threshold Verdicts

Declared thresholds: `transaction_duration` p95 < 15s and p99 < 25s, `transaction_success` rate > 0.95, `http_req_failed` rate < 0.01, `http_req_duration` p95 < 5s and p99 < 10s.

| VU | Verdict |
|----|---------|
| 2 | **All thresholds passed** |
| 10 | **All thresholds passed** |
| 50 | **All thresholds passed** |
| 75 | **All thresholds passed** |
| 100 | **All thresholds passed** |
| 125 | **All thresholds passed** |
| 150 | `transaction_duration` p95 crossed (16.38s vs 15s) |

Six of the seven levels pass every threshold. Only 150 VU crosses, and it crosses on end-to-end latency alone — server latency, failure rate and success rate all stay well inside budget.

## Constrained CPU Profiles

A second campaign applied per-service CPU limits via `docker update` (no restart needed) to measure the same stack under smaller budgets. Each profile file names a per-service CPU share summing to the profile budget; about 20 of the 59 running containers match a named service, and the remainder stay unlimited.

| Profile | Total CPU budget | `pgr-services` slice | Applied to |
|---------|-----------------|---------------------|-----------|
| `cpu-2` | 2 vCPU | **0.10 vCPU** | 30 of 57 containers |
| `cpu-4` | 4 vCPU | **0.20 vCPU** | 30 of 57 containers |
| `cpu-8` | 8 vCPU | **0.40 vCPU** | 30 of 57 containers |
| `cpu-16` | 16 vCPU | **0.80 vCPU** | 30 of 57 containers |

The third column is the one that explains the results. Under the profile named for 16 vCPU, the service that actually files and updates complaints is pinned to eight tenths of one core.

**A profile is not equivalent to a machine of that size, and none of them is a deployable configuration.** A profile pins each service to a fixed slice of the CPU budget, whereas an unthrottled machine lets services burst into each other's idle headroom. It also constrains CPU only — the host still has its full 30 GiB of memory throughout, where a real machine of the same nominal size would have proportionally less and could not hold the stack at all. These profiles locate the point at which CPU becomes the binding constraint; they are not smaller sizing options. The two were measured on the same host with the same `ramp-50vu` scenario roughly 30 minutes apart:

| ramp-50vu | `cpu-16` profile | Unthrottled |
|-----------|-----------------|-------------|
| Iterations | 1,299 | 2,446 |
| API req/s | 7.26 | 13.50 |
| Server p95 | 6,621ms | 360ms |

Profile figures should therefore be read as profile names, not as vCPU-equivalent machine sizes.

### Why `cpu-16` Is Not a 16 vCPU Machine

The gap above is large enough to be worth explaining, because "16 vCPU throttled" and "16 vCPU unthrottled" sound like they should be the same machine.

`cpu-16` does not give the stack 16 vCPU. It divides a 16 vCPU budget across 31 named services and pins each one independently:

| Service | vCPU |
|---------|------|
| postgres-db | 3.20 |
| redpanda | 2.00 |
| elasticsearch | 2.00 |
| kong | 1.20 |
| keycloak | 0.80 |
| **pgr-services** | **0.80** |
| egov-workflow-v2 | 0.64 |
| egov-user | 0.64 |
| egov-persister | 0.64 |
| *(22 further services)* | *3.60* |
| **Total** | **16.56** |

Three consequences follow from pinning rather than sharing.

**A request chain is sequential.** A single CREATE walks Kong → pgr-services → workflow → user → idgen → Postgres, one hop at a time. At any instant one service is working and the rest are idle. Unthrottled, whichever service is busy can use the whole machine. Partitioned, `pgr-services` cannot exceed 0.8 even while 15 vCPU sit idle beside it. The partition forbids precisely the borrowing that makes the machine fast.

**CFS quota is bursty, not smooth.** `--cpus 0.8` grants 80ms of CPU per 100ms scheduling period. Once a container exhausts its slice it is stopped outright until the next period begins, so latency arrives in discrete chunks even on an otherwise idle host. This is why **latency degrades far more than throughput does**: at 50 VU throughput differs by 2.3x (2.204 against 5.165 lifecycles/sec) while server p95 differs by 14x (7.31s against 517ms).

**The partition is partial.** 30 of the 57 running containers matched a named service and were capped; the remaining 27 stayed unlimited, so the profile is not even a uniform 16 vCPU allocation.

The practical reading: a per-service CPU allocation is a much harsher constraint than a machine of the same total size, and the difference grows with how many services a request touches. A profile named `cpu-16` behaves like far less than 16 vCPU.

### Matrix Results

| Profile | VU | Lifecycles/s | API req/s | http p95 | http p99 | txn p95 | Lifecycle success | Request fail |
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
| cpu-16 | 50 | 2.204 | 8.80 | 7.31s | 8.68s | 29.5s | 100% | 0% |

Three of the twelve cells pass every threshold — `cpu-8` at 2 VU, and `cpu-16` at 2 and 10 VU. Everywhere else at least the latency budget is crossed; only `cpu-2` at 10 and 50 VU and `cpu-4` at 50 VU also cross the failure and success-rate budgets.

### Burst Tests Under `cpu-16`

`burst.js` (`constant-vus`, no thresholds declared) run under the `cpu-16` profile:

| VUs | Lifecycles/s | API req/s | http p95 | Lifecycle success | Request fail |
|-----|-------------|-----------|----------|---------|------------------|
| 20 | 1.840 | 7.81 | 1.65s | 100% | 0.000% |
| **40** | **2.208** | **9.68** | 4.59s | 99.6% | 0.086% |
| 80 | 1.331 | 6.97 | 15.31s | 100% | 0.000% |
| 160 | 0.567 | 6.41 | 36.64s | 93.2% | 3.34% |
| 320 | 0.000 | 9.26 | 60.00s | 0% | 67.4% |

Under the `cpu-16` profile the ceiling is 80 VU — the last level below 1% HTTP failures. The 5% error rate is crossed at 320 VU. This is the throttled ceiling, not the machine's; the unthrottled ladder below is clean to 80 VU, and its higher levels were invalidated by the heap exhaustion described in [When the heap gave out](#when-the-heap-gave-out).

### Burst Tests Unthrottled

The same `burst.js` ladder run with no CPU limits applied, each level held at a constant VU count for 2 minutes. Container quotas were confirmed absent by reading `/sys/fs/cgroup/cpu.max` on all 59 container scopes, which returned `max` in every case; `HostConfig.NanoCpus` was not trusted, as it retains stale values after a quota is cleared.

This ladder ran three days after the ramp tests, and attribute-based access control was introduced to PGR search in the interval. The SEARCH step therefore evaluates a department and jurisdiction filter here that did not exist in the ramp figures, so the two sets are not identical conditions and the ceiling should not be read as a direct extension of the ramp curve. The employee driving the ladder was temporarily granted the three departments and seven wards corresponding to the complaints the harness files, so the filter resolves to a non-empty result set rather than rejecting every row; that grant was reverted after the run.

| VUs | Lifecycles/s | API req/s | http p95 | Lifecycle success | Request fail |
|-----|-------------|-----------|----------|---------|------------------|
| 20 | 2.081 | 8.48 | 0.34s | 100% | 0.000% |
| 40 | 4.091 | 16.67 | 0.35s | 100% | 0.000% |
| 80 | 8.034 | 32.75 | 0.45s | 100% | 0.000% |
| **160** | **12.463** | **51.24** | 2.20s | 98.83% | **0.670%** |
| 320 | 1.113 | 7.25 | 60.00s | 0% | 41.12% |

The 160 and 320 VU rows are **not capacity measurements**. Both were taken while `pgr-services` was running out of Java heap, for reasons unrelated to the size of the machine. This was found on 31 August 2026 while investigating a separate question, and is set out in [When the heap gave out](#when-the-heap-gave-out) below. The rows are kept because the throughput figures are real, but they do not locate the deployment's ceiling.

The highest level that is a clean measurement is **80 VU** — 8.034 lifecycles/sec, 694,138 transactions/day, 0.000% failures, 449ms server p95. Everything at or below it completed before the first heap error.

Up to 80 VU the deployment is bound by client think time, not by the server. Measured throughput tracks the theoretical `VU ÷ 9.68s` almost exactly — 2.066 predicted against 2.081 measured at 20 VU, 8.264 against 8.034 at 80 VU — and server p95 rises only from 341ms to 449ms across a fourfold concurrency increase. Host load average reached 12.93 at 40 VU and 24.86 at 80 VU on 16 vCPU.

At 160 VU throughput falls short of the think-time model for the first time (12.463 measured against 16.529 predicted) and the first HTTP failures appear. At 320 VU throughput drops below what 20 VU achieved and p95 pins at the 60s client timeout. That reads like classic congestive collapse, and it was originally recorded as such — but the cause was a heap exhaustion that began during the 160 VU level, not saturation of the machine.

### When the Heap Gave Out

`pgr-services` runs with `JAVA_OPTS=-Xmx384m` — a 384 MB heap, fixed, on a 30.6 GiB host with no container memory limit set. During the 160 VU level the JVM exhausted it. At 01:55:38 UTC it threw `java.lang.OutOfMemoryError: Java heap space`, and did so 421 times over the following four and a half minutes. There were none in the preceding 16 hours of container uptime, which attributes them to this ladder.

The failure did not stop there. The `OutOfMemoryError` stopped Spring's `KafkaMessageListenerContainer` and took the Kafka producer's sender thread with it. `org.egov.tracer.kafka.CustomKafkaTemplate.send` waits on `CompletableFuture.get()` **with no timeout**, so with no sender thread no send can ever complete. Every subsequent complaint create or update parked permanently. A thread dump taken six hours later showed:

| | |
|---|---|
| Tomcat workers, total | 130 |
| In state `WAITING` on `CompletableFuture.get()` | **130** |
| — inside `PGRService.create` | 113 |
| — inside `PGRService.update` | 17 |
| `kafka-producer-network-thread` present | **0** |
| Container CPU | 0.15% |

The service accepted connections and answered none. Its healthcheck had failed 512 consecutive times. Because the `OutOfMemoryError` killed a listener thread rather than the main thread, the JVM never exited and Docker never restarted the container, so the deployment stayed wedged until it was restarted by hand. **It cannot recover on its own.**

What this means for the two affected rows:

- **320 VU** ran against a service whose Kafka producer was already dead — the first OOM preceded it. Its 372 `CREATE` 504s measure a broken service, not a saturated one. It is not a valid data point.
- **160 VU** carries 12 `RESOLVE` rejections with `INVALID ACTION`, logged between 01:54:27 and 01:54:48 — 50 seconds before the first OOM. These are best read as the same heap exhaustion stalling workflow state commits past the harness's think time, not as an independent failure mode.

Two defects follow from this, independent of load testing:

1. **The heap is capped at 384 MB** on a machine with 30.6 GiB and no container memory limit. Nothing is gained by the cap.
2. **`CustomKafkaTemplate.send` blocks on an untimed `CompletableFuture.get()`**, which converts any Kafka producer failure into permanent, total, self-sustaining unavailability. The OOM was survivable; the untimed wait is what made it terminal.

**The deployment's actual ceiling above 80 VU is unmeasured.** The software gave out before the hardware did, and the ladder needs re-running with a realistic heap before any figure above 80 VU is quoted.

Comparing like for like at the same concurrency, the `cpu-16` profile returned 1.331 lifecycles/sec at 15.31s p95 where the unthrottled machine returned 8.034 lifecycles/sec at 0.45s — six times the throughput at a thirty-fourth of the latency. This is the clearest measure of how far a per-service CPU profile sits from the machine it is named after.

## Degradation Points by Profile

| Profile | Peak throughput | Saturation | All thresholds pass at | Errors > 5% | Max HTTP failure rate |
|---------|----------------|-----------|----------------------|-------------|----------------------|
| Unthrottled (ramp) | 10.851/s (150 VU) | 125 VU | 2-125 VU | never | 0.000% |
| cpu-2 | 0.066/s (2 VU) | Below 2 VU | never | 10 VU | 91.84% |
| cpu-4 | 0.216/s (10 VU) | 10 VU | never | 50 VU | 53.61% |
| cpu-8 | 0.693/s (50 VU) | Plateau from 10 VU | 2 VU | never | 0% |
| cpu-16 | 2.204/s (50 VU) | Not saturated at 50 VU | 2 and 10 VU | 320 VU (burst) | 0% in matrix, 67.4% at 320 VU |

**Key observations:**

- **Unthrottled**, throughput scales linearly from 2 to 125 VU and flattens above it. Server p95 stays under 1.5s through 125 VU. The only budget breached anywhere in the ladder is end-to-end latency at 150 VU.
- **cpu-2** is saturated below the lowest level tested. At 2 VU it still completes every lifecycle, but at 11.19s http p95. At 10 VU success drops to 68.0%, and at 50 VU no lifecycle reaches RESOLVED at all.
- **cpu-4** peaks at 10 VU (0.216 lifecycles/sec) and collapses at 50 VU — throughput falls to 0.049/s, with 15.2% of *lifecycles* succeeding while 53.61% of *requests* failed. The two figures have different denominators and are not meant to be complementary; see [Reading the two percentage columns](#reading-the-two-percentage-columns).
- **cpu-8** returns the same throughput at 10 and 50 VU (0.683 vs 0.693 lifecycles/sec) at 100% success. The extra load is absorbed entirely as latency: http p95 rises from 4.26s to 24.13s.
- **Latency, not errors, is the first thing to give.** Every profile crosses its latency budget before it crosses its failure budget, and the unthrottled *ramp* ladder never crosses the failure budget at all. The unthrottled *burst* ladder does show failures, but only at levels invalidated by the heap exhaustion, so it does not contradict this.

## Host Behaviour

| Profile | Min CPU idle | Where the limit binds |
|---------|-------------|----------------------|
| cpu-2 | 60-90% | Container CPU quota |
| cpu-4 | 60-90% | Container CPU quota |
| cpu-8 | 1.9% (at 50 VU) | Host CPU |
| cpu-16 | 5.6% (at 50 VU) | Host CPU |

Under `cpu-2` and `cpu-4` the host was never the bottleneck — CPU idle stayed between 60% and 90% while the stack collapsed, so the cgroup caps bind rather than the machine. Host pressure appears only from `cpu-8` up.

In the burst ladder, 320 VU drove load average to 32.6 while CPU idle stayed at 64% — threads blocked on queues rather than burning CPU.

Available memory stayed between 800 MB and 4.4 GB of 30.6 GiB across the whole campaign, against a resting footprint of 26.8 GB and no swap. The margin never exceeded about 15% of the machine, which is the practical argument for provisioning 32 GiB rather than 30.

The **host** never ran out of memory and the kernel OOM killer never fired. `pgr-services` nonetheless exhausted its own JVM heap, which is capped at 384 MB regardless of how much memory the machine has — see [When the heap gave out](#when-the-heap-gave-out). Kong returned 200 at every check, and Docker restarted no container during the campaign; in this case that was the problem rather than a reassurance, because it left the wedged service running.

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
