# Executive Summary

A single-machine DIGIT deployment sustains **120 concurrent users** and **966,091 complaint transactions per day** with no failed request — **96x the 10,000/day target** — under evenly-paced load. Validated against a live installation carrying real data and daily usage. A separate CPU-profile matrix measured the same stack under constrained per-service CPU budgets. Under a bursty arrival pattern at the same request rate the same deployment fails half of all complaints; see [Follow-Up Measurements](#follow-up-measurements-1-september-2026).

## Key Numbers

| | Value |
|-|-------|
| Highest level verified clean | **120 VU**, three repeats on a fixed dataset |
| Peak throughput | **45.64 API req/s** (11.182 lifecycles/sec) |
| Daily capacity | **966,091 transactions/day** |
| HTTP failures at that level | **0.000%** |
| Lifecycle success at that level | **100.00%** |
| Max sustainable concurrent users, ramp ladder | **125 VU** (43.15 API req/s, 931,824/day) |
| Breaking point, ramp ladder | 150 VU (end-to-end p95 16.38s vs 15s budget) |
| HTTP failures across the ramp ladder | **0.000%** |
| Highest clean level, burst ladder | **80 VU** (32.75 API req/s, 694,138/day, 0.000% failures) |
| Same request rate, open loop | 43.41 API req/s at **19.57% request failures, 50.23% lifecycle success** |
| Records in database | ~2,300 complaints (2,525 in the 1 September follow-up) |

## What We Tested

Every test iteration runs one complete PGR complaint lifecycle — **4 API calls** through the full stack:

**CREATE** (file complaint) → **ASSIGN** (route to department) → **RESOLVE** (close it) → **SEARCH** (verify status)

Throughout this document, **lifecycle success** is the share of lifecycles that completed all four steps and ended in `RESOLVED`, while **request fail** is the share of individual HTTP requests that errored. They have different denominators — roughly four requests per lifecycle — so they do not sum to 100. See [Reading the two percentage columns](./findings#reading-the-two-percentage-columns).

This exercises Kong, PGR Services, Workflow, Persister, Kafka, and Postgres — the entire hot path. Seven concurrency levels were tested — 2, 10, 50, 75, 100, 125 and 150 VUs — each held at peak for 5 minutes, with no CPU limits applied. A burst ladder at 20, 40, 80, 160 and 320 VUs, also unthrottled, was run separately to locate the failure point by error rate rather than by latency.

The ramp figures and the burst ladder were measured three days apart, and attribute-based access control was introduced to PGR search in between. The SEARCH step therefore carries a department and jurisdiction filter in the burst ladder that was absent from the ramp tests, and the two sets are not identical conditions. The employee driving the burst ladder was granted the departments and wards matching the complaints it files, so the filter resolves rather than rejecting every row.

## Capacity at Scale

Throughput rises linearly to 125 VUs, then flattens:

| VUs | Throughput | API req/s | Daily Capacity | p95 Latency |
|-----|-----------|-----------|---------------|-------------|
| 2 | 0.214/s | 0.86 | 18,490/day | 416ms |
| 10 | 1.054/s | 4.20 | 91,066/day | 407ms |
| 50 | 5.165/s | 20.66 | 446,256/day | 517ms |
| 75 | 7.947/s | 31.78 | 686,621/day | 456ms |
| 100 | 9.798/s | 39.20 | 846,547/day | 794ms |
| **125** | **10.785/s** | **43.15** | **931,824/day** | 1,413ms |
| 150 | 10.851/s | 43.37 | 937,526/day | 2,477ms |

Going from 125 to 150 VUs adds **0.6% throughput** while server p95 latency grows 75% and the end-to-end budget is breached.

## Error-Based Ceiling

The ramp tests above stop on a latency budget and record 0.000% HTTP failures at every level, so they never locate the point at which the deployment actually fails. A separate burst ladder pushed the unthrottled stack until errors appeared, holding each level at a constant VU count for 2 minutes.

| VUs | Throughput | API req/s | Server p95 | Lifecycle success | Request fail |
|-----|-----------|-----------|-----------|---------|--------------|
| 20 | 2.081/s | 8.48 | 341ms | 100% | 0.00% |
| 40 | 4.091/s | 16.67 | 348ms | 100% | 0.00% |
| 80 | 8.034/s | 32.75 | 449ms | 100% | 0.00% |
| **160** | **12.463/s** | **51.24** | 2,200ms | 98.83% | **0.67%** |
| 320 | 1.113/s | 7.25 | 60,000ms | 0% | 41.12% |

Up to 80 VU the deployment is bound by client think time rather than by the server: measured throughput tracks the theoretical `VU ÷ 9.68s` almost exactly and server p95 moves only 108ms across a fourfold concurrency increase. Those levels return 0.000% failures and are clean measurements.

**The 160 and 320 VU rows do not locate a ceiling.** Both were measured while `pgr-services` was exhausting a 384 MB JVM heap — a fixed cap unrelated to the machine's 30.6 GiB. The first `OutOfMemoryError` fired during the 160 VU level and killed the Kafka producer's sender thread; because `CustomKafkaTemplate.send` waits on an untimed `CompletableFuture.get()`, every later create and update parked forever and the service never recovered. The 320 VU level therefore ran against an already-broken service, and its 41% failure rate measures that rather than saturation. See [When the heap gave out](./findings#when-the-heap-gave-out).

**The deployment's ceiling is unmeasured.** 120 VU was measured clean three times four days later — see [Follow-Up Measurements](#follow-up-measurements-1-september-2026) — but nothing between 120 and 320 VU has been, and the ladder needs re-running with a realistic heap before any higher figure is quoted.

## Constrained CPU Profiles

A second campaign capped the DIGIT services with `docker update` to measure smaller budgets on the same host. These figures are **not** equivalent to machines of that size — a profile pins each service to a fixed slice, whereas an unthrottled machine lets services burst into each other's idle headroom.

| Profile | Peak at | Throughput | API req/s | Daily Capacity | Lifecycle success |
|---------|---------|-----------|-----------|---------------|---------|
| cpu-2 | 2 VU | 0.066/s | 0.27 | 5,702/day | 100% |
| cpu-4 | 10 VU | 0.216/s | 0.88 | 18,662/day | 100% |
| cpu-8 | 50 VU | 0.693/s | 2.80 | 59,875/day | 100% |
| cpu-16 | 50 VU | 2.204/s | 8.80 | 190,426/day | 100% |

`cpu-16` divides a 16 vCPU budget across 31 services rather than giving the stack 16 vCPU; `pgr-services` itself is pinned to **0.80 of a core**. Because a request chain is sequential, no service can borrow another's idle time, and CFS quota stops a container outright once its slice is spent — so latency suffers far more than throughput. Measured head to head on the same host 29 minutes apart with the same `ramp-50vu` scenario, on whole-run figures for both arms, `cpu-16` returned 1.798 lifecycles/sec at 6,621ms server p95 against the unthrottled machine's 3.367 lifecycles/sec at 360ms — 1.9x the throughput at one-eighteenth of the latency. (Those are whole-run numbers, so they differ from the steady-state figures tabulated above.) See [Why cpu-16 is not a 16 vCPU machine](./findings#why-cpu-16-is-not-a-16-vcpu-machine). Treat the profile figures as conservative floors, not as vCPU-equivalent machine sizes.

**None of these profiles describes a deployable machine.** They constrain CPU only, on a host that still has the full 30 GiB of memory. A real machine of the same nominal size would also have proportionally less memory, and below 32 GiB the stack does not fit at all. The minimum deployment spec is **16 vCPU / 32 GiB**; the profiles below the top one exist to show where CPU becomes the binding constraint, not to offer smaller options.

## Follow-Up Measurements, 1 September 2026

Three method gaps were closed by a follow-up campaign on the same deployment, against a fixed dataset of 2,525 stored complaints restored between every run. Full detail in [Findings](./findings#follow-up-measurements-1-september-2026).

**Every figure in the ladder above came from a single run.** Three repeats at each of two levels give the error bars they lacked:

| Level | Throughput CV | p95 CV |
|-------|--------------|--------|
| 40 VU | 1.32% | **1.10%** |
| 120 VU | 2.24% | **19.17%** |

**Tail latency near saturation is worth roughly ±20%**, so p95 differences below about 40% at those levels cannot be read from a single run. Throughput stays stable. The Kubernetes campaign measured 20.1% p95 variance at its own saturation point on unrelated infrastructure — two different stacks, the same answer.

The three 120 VU repeats returned 0.000% request failures and 100.00% lifecycle success, and are the source of the headline figure above. The three 40 VU repeats returned 0.000% request failures but **0.00% lifecycle success** — every verification SEARCH answered HTTP 200 with an empty result set — so their throughput and latency are not comparable with the 40 VU row of the burst ladder. See [Run-to-Run Variance](./findings#run-to-run-variance).

**The closed-loop design flatters the system.** Re-run with a ramping arrival rate, which holds the offered load independent of server speed:

| | Closed-loop, 120 VU | Open-loop |
|---|---|---|
| API req/s | 45.64 | 43.41 |
| Request failures | **0.000%** | **19.57%** |
| Lifecycle success | **100.00%** | **50.23%** |
| Work never started | not measurable | **24%** |

Throughput barely moves; **half of all complaints fail and a quarter of the work never starts.** 1,686 of those failures were `INVALID ACTION` — a `RESOLVE` refused because the preceding `ASSIGN` had not committed — with **zero OutOfMemoryErrors and zero restarts**. That confirms the failure is caused by arrival pressure on an asynchronous write path, not by the heap exhaustion described elsewhere in this run.

**The database is not the constraint.** With slow-query logging enabled for a full load run, only five statements exceeded 100ms and **not one was a PGR write-path query**. The two slowest were periodic dashboard view refreshes at about seven seconds each, unrelated to load. At 2,525 records the limit lies in the application, JVM or queue layer.

## Test Infrastructure

| Component | Spec |
|-----------|------|
| CPU | AMD EPYC-Rome, 16 vCPU |
| Memory | 30 GiB (26.8 GB held by the stack at rest, 4.5 GB available, **no swap**) |
| Disk | 305 GB SSD (non-rotational) |
| OS / runtime | Ubuntu 24.04.4 LTS, Docker 29.4.0 |
| Virtualisation | KVM guest |
| Services | 59 containers (full DIGIT stack) |
| Load generator | k6, remote control machine, ~185ms RTT |
