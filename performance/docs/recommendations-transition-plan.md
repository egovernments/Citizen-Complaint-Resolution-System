# DIGIT Complaints Management Capacity Planning: When to Scale from Docker Compose to Kubernetes

**Audience:** GTM / Solutions / Implementation teams
**Source:** Load test results from March 2026 against DIGIT Complaints Management on Docker Compose (single-machine deployments)

**Superseded sizing.** The hardware tiers in the March 2026 version of this page have been withdrawn. The minimum supported machine is now **16 vCPU / 32 GiB** and there is no smaller configuration — see [The Hardware Floor](#the-hardware-floor-16-vcpu-32-gib) below. The August 2026 results measured against a live deployment are in [Run 28-08-26](./run-28-08-26/).

---

## How to Read This Document

**Concurrent users** in this document refers to users actively filing or checking complaints at the same time — not just logged in. Our load tests simulate "Virtual Users" (VUs), where each VU files complaints back-to-back without pausing. Real users spend most of their time reading and navigating. The rough conversion:

> **1 test user ≈ 20–30 real users online simultaneously**

So when we say "120 concurrent test users," that translates to roughly **2,400–3,600 real people using the system at once**.

| Test Users | Real Users Online | Typical Deployment |
|------------|------------------|-------------------|
| 10 | 200–300 | Small ULB |
| 50 | 1,000–1,500 | Medium city |
| 120 | 2,400–3,600 | Large city |
| 250 | 5,000–7,500 | State rollout |
| 300 | 6,000–9,000 | Single-machine ceiling |

**Complaints processed per second** is the core throughput metric. Each "lifecycle" = one complaint filed, assigned, resolved, and verified (4 API calls). Multiply by 86,400 to get daily capacity.

---

## The Bottom Line

A single machine running Docker Compose can handle DIGIT PGR for most deployments — but that machine has a hard minimum spec of **16 vCPU / 32 GiB**, because the stack holds roughly 26.8 GB of memory before serving a single request. There is no smaller configuration, so a pilot and a large city are provisioned identically.

You don't need Kubernetes until you're processing **bursty traffic at 500K+ records** or need **high availability**.

---

## The Hardware Floor: 16 vCPU / 32 GiB

**This is a requirement, not a recommendation.** Every deployment starts here.

Measured on a live deployment at rest, with no load applied:

| | |
|---|---|
| Memory held by the stack while idle | **26.8 GB** |
| Total machine memory | 30.6 GiB |
| Memory left available | 4.5 GB |
| Swap configured | **None** |
| Containers running | 57 |

Below 32 GiB the stack does not fit in memory. It would have to swap, and a set of JVM services that swaps does not run slowly — it thrashes, because the garbage collector periodically touches memory the operating system has paged to disk. The system does not degrade gracefully in that state; it stops responding while consuming the whole machine.

**Why the smaller tiers were withdrawn.** The March 2026 tests ran a stack of roughly 30 containers, which fitted into 16 GB. The platform now runs 57–59, and its resident footprint has roughly doubled. The 4 vCPU / 8 GB and 8 vCPU / 16 GB tiers previously published here are no longer deployable, and their throughput figures should not be quoted.

**The commercial consequence.** A pilot costs the same hardware as a large city — roughly $287/month on Graviton, $496/month on Intel. The difference between a small deployment and a large one is stored data, support and operations, not machine size. Budget for the floor from day one.

### Why 16 vCPU and not more

At the point where the system collapsed in the August 2026 tests, CPU was **64% idle** at a load average of 32.6 — threads blocked on queues and database connections, not short of processor. Adding cores to a single machine does not lift that ceiling. That level was later invalidated by a fixed 384 MB Java heap, so read it as an indication rather than a measurement; slow-query logging on the same deployment found no complaint query over 100ms, which points the same way. Below 16 vCPU, however, CPU is very much the binding constraint. 16 vCPU is where processor stops being the limit.

---

## What the Floor Machine Handles (16 vCPU / 32 GiB)

| Metric | Limit |
|--------|-------|
| Complaints/day, zero errors | **~966,000** (September 2026, live deployment, ~2,500 records) |
| Complaints/day, absolute maximum | **not established** — the levels above were invalidated by a fixed 384 MB Java heap, not by the hardware running out |
| Max concurrent test users, no errors | ~120 (~2,400–3,600 real people) |
| Max concurrent test users before failure | **not established** |
| Safe daily volume at 1M records | **~544K complaints/day** (March 2026) |
| Database record ceiling | **1M+ records** (tested and validated) |

**Watch for:** under bursty traffic — sudden surges rather than gradual increase — the system struggles at 1M records, with error rates reaching 57% when traffic spikes and drops repeatedly. It does not recover between bursts.

**Estimated AWS cost (Mumbai region):** ~$287/month (c7g.4xlarge Graviton) or ~$496/month (c6i.4xlarge Intel). Graviton is recommended — 42% cheaper, and the DIGIT stack (Java, Postgres, Kafka) runs well on ARM.

### Above one machine

Scale out by adding machines of the same size, not by growing one machine — the ceiling is queue and connection contention, which extra cores on a single host do not relieve. Roughly 2 nodes cover 1M complaints/day and roughly 11 cover 10M/day, both on Kubernetes with a managed database. These are projections from single-machine measurements; no multi-machine configuration has been tested. See [Run 28-08-26](./run-28-08-26/recommendations-transition-plan) for the detail.

A single 32 vCPU / 64 GiB host remains a reasonable choice when you want headroom for **other DIGIT modules** or a co-located database, but it buys little additional complaint throughput.

### Memory above the floor

32 GiB covers the application stack, not a growing co-located database. Once stored complaints pass roughly 500,000, either move the database to its own server (strongly preferred) or add memory in step with the data.

### Dashboard read capacity at 500K stored complaints

The 2–3 September dashboard campaign adds a measured read-path boundary at
exactly 500,000 complaints. It ran on Bomet's full 16 vCPU / 30.6 GiB stack,
using a separate load generator and a guarded disposable snapshot clone. The
complete method and percentiles are in the
[dashboard scaling report](./dashboard-scaling-02-09-26).

| Dashboard VUs | Offered loads/s | Realized loads/s | HTTP RPS | Dashboard p95 | Result |
|---:|---:|---:|---:|---:|---|
| 50 | 5.0 | 5.000 | 15.375 | 4.484s | Below a five-second p95 |
| 100 | 10.0 | 10.000 | 30.750 | 7.152s | Recommended interim operating point |
| 125 | 12.5 | 12.500 | 38.442 | 9.936s | Near a ten-second p95 budget |
| 150 | 15.0 | 15.000 | 46.125 | 10.837s | Functional, limited tail headroom |
| 175 | 17.5 | 16.417 | 50.567 | 14.378s | First offered-load shortfall |
| 200 | 20.0 | 16.092 | 49.775 | 17.562s | Throughput falls; saturated |

The read-path ceiling is approximately **16.1–16.4 dashboard loads/s or 50 HTTP
RPS**. It is a latency/queueing ceiling, not a crash: every completed stage had
100% dashboard success, no HTTP failure or partial response, and no PGR
restart/OOM. At 200 VUs more concurrency completed less work than at 175 while
p95 increased by 22%.

PostgreSQL reached all 18 observed connections with waiting sessions, and spot
samples showed `DataFileRead`, `BufferMapping`, and `SpinDelay` waits. This is
the first direct evidence behind the 500K recommendation above: **separate and
measure the database before assuming that more application CPU or replicas will
help.** Kubernetes application replicas alone can increase pressure on the same
database.

#### Dashboard users are not complaint-lifecycle users

Do not apply the complaint-lifecycle estimate of one test VU to 20–30 real
people to this workload. A dashboard VU performs a complete load every 10
seconds. Translate it using the expected interval between real dashboard loads:

| Average interval per active dashboard user | Users at 10 loads/s | Users at the 16.1 loads/s ceiling |
|---:|---:|---:|
| 10 seconds | 100 | ~161 |
| 30 seconds | 300 | ~483 |
| 60 seconds | 600 | ~966 |
| 5 minutes | 3,000 | ~4,830 |

These represent actively refreshing/filtering users, not total accounts or
logged-in sessions. Replace the assumed interval with production telemetry when
available.

#### Recommendation at 500K

- Until three repeats and a soak are available, plan around **10 dashboard
  loads/s / 30.75 HTTP RPS**, which leaves about 38% throughput headroom. Use
  the 5-load/s point if product requires dashboard p95 below five seconds.
- Benchmark a dedicated PostgreSQL host against the co-located baseline. Tune
  PgBouncer and JDBC pool sizes as a single connection budget rather than
  independently.
- Profile every shipped KPI at 500K and 1M with `pg_stat_statements`, wait
  events, and `EXPLAIN (ANALYZE, BUFFERS)`; test materialized-view refresh
  interference separately.
- Add an open-loop arrival/burst scenario and a 30-minute soak before publishing
  a production concurrency number.
- Use Kubernetes for high availability and horizontal application scaling, but
  pair it with a dedicated database, bounded pools, query/index work, and data
  retention. Kubernetes by itself is not a remedy for a database queue.

The dedicated PostgreSQL measurement and Ansible deployment work is tracked in
[#1971](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1971).

---


## When Docker Compose Is No Longer Enough — The Kubernetes Trigger Points

Switch to Kubernetes when **any** of these are true:

| Trigger | Why |
|---------|-----|
| **Database exceeds 1M records** and you can't archive | Throughput drops below 6.3 complaints/sec. Query costs grow with every record. |
| **Traffic is bursty, not gradual** (at 500K+ records) | Spike tests show 57% error rate at 1M records. The system can't clear its backlog between surges. Docker Compose has no auto-scaling. |
| **You need >120 concurrent test users** (~3,600 real) | The highest level verified clean on a 16 vCPU host in 2026 testing; nothing above it has been measured cleanly. The database connection pool and queue depth are the hard ceiling on a single machine, regardless of CPU. |
| **You need high availability / zero-downtime deploys** | Docker Compose is single-machine. A host failure = full outage. Kubernetes gives you redundancy, rolling deploys, and automatic restarts. |
| **You need to scale PGR/Workflow horizontally** | On Docker Compose, each service runs as a single instance. Kubernetes lets you run multiple copies behind a load balancer. |
| **You're running multiple modules** (not just PGR) | These tests only cover PGR. Adding Property Tax, Trade License, Water & Sewerage, etc. competes for the same CPU and memory budget on the machine. |

**Planning horizon:** Start planning a Kubernetes migration **3–6 months before** you expect to hit these triggers. Migration involves infrastructure setup, testing, and data migration — it's not a weekend project.

**Estimated K8s cost (Mumbai region):** A minimal production-grade EKS cluster (3 × c7g.2xlarge Graviton nodes + EKS control plane fee) runs ~$500–600/month. With Intel nodes (c6i) or larger node sizes, expect ~$800–1,200/month.

---

## Before Scaling: 3 Fixes That Buy 9.4x More Capacity (Free)

Before investing in bigger hardware or Kubernetes, platform engineering team needs to apply three database fixes. These recovered **9.4x throughput** in our tests — the equivalent of upgrading hardware several tiers for zero cost.

| Fixes needed | Impact | Effort |
|--------------------------|--------|--------|
| "Apply the database index fix from PR #248" | 200x faster address lookups | Minutes |
| "Disable fuzzy search in the Workflow service (PR #248)" | 769x faster workflow queries | Minutes |
| "Disable Postgres JIT compilation (PR #248)" | 4.3x faster across all queries | Minutes |

All three fixes are packaged in [PR #248](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/248). **Apply them on every deployment, regardless of scale.** Without these fixes, even a machine at the 16 vCPU / 32 GiB floor degrades badly at just 100K records.

---

## Quick Decision Flowchart

```
Expected daily complaint volume?
│
│  Every option below starts at the same floor:
│  16 vCPU / 32 GiB. There is no smaller spec.
│
├─ Up to ~966K/day ────────────► 1 × 16 vCPU / 32 GiB
│   │                              ~$287/mo (Graviton) · ~$496/mo (Intel)
│   │                              The same machine serves a pilot
│   │                              and a large city.
│   └─ Database past 500K records? → Move the database to its own
│                                     server, or add memory
│
├─ ~966K – 1.9M/day ───────────► Kubernetes, 2 app nodes
│                                  of 16 vCPU / 32 GiB (~$900–1,400/mo)
│                                  + managed database + archiving policy
│
└─ Beyond 1.9M/day OR bursty traffic at scale
   OR need HA / zero-downtime ─► Kubernetes, sized per volume
                                  (~11 nodes at 10M/day, plus queue
                                   repartitioning and data partitioning)
```

---

## Key Caveats

1. **These numbers are PGR-only.** Running additional DIGIT modules (Property Tax, Trade License, Water & Sewerage, etc.) on the same machine reduces available capacity proportionally.
2. **All tests assume the 3 database fixes are applied.** Without them, performance at 100K records is 9.4x worse — inadequate at any machine size.
3. **Bursty traffic is harder than steady load.** The gradual-ramp tests show much better numbers than the spike tests. If your deployment sees unpredictable traffic surges (e.g., after a public announcement or natural disaster), size up one tier or move to Kubernetes earlier.
4. **Database size is the biggest performance driver.** Archiving resolved complaints older than 6–12 months keeps the database small and throughput high. This is cheaper than scaling hardware. Note: archiving requires a data retention policy and potentially custom tooling — DIGIT does not include a built-in archival feature out of the box. Archived complaints would no longer be searchable in the UI unless a separate read-only archive is maintained.
5. **Above the memory floor, CPU and database query patterns are the bottleneck** — not network or disk. Adding RAM beyond 32 GiB won't buy throughput on its own; the database fixes above will. Below 32 GiB, however, memory is an absolute blocker, not a tuning parameter — the stack cannot run there at all.
6. **AWS cost estimates use on-demand pricing** in the Mumbai (ap-south-1) region as of March 2026. Graviton (ARM) instances are recommended — they're 42% cheaper than Intel equivalents and run the DIGIT stack without issues. Reserved instances or savings plans can reduce costs a further 30–60%.
