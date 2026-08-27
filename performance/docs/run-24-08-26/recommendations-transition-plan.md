# DIGIT Complaints Management Capacity Planning: When to Scale from Docker Compose to Kubernetes

**Audience:** GTM / Solutions / Implementation teams
**Source:** Load test results from August 2026 against a live DIGIT Complaints Management deployment on Docker Compose (single machine)

---

## How to Read This Document

**Concurrent users** in this document refers to users actively filing or checking complaints at the same time — not just logged in. Our load tests simulate "Virtual Users" (VUs), where each VU files complaints back-to-back without pausing. Real users spend most of their time reading and navigating. The rough conversion:

> **1 test user ≈ 20–30 real users online simultaneously**

So when we say "125 concurrent test users," that translates to roughly **2,500–3,750 real people using the system at once**.

| Test Users | Real Users Online | Typical Deployment |
|------------|------------------|-------------------|
| 10 | 200–300 | Small ULB |
| 50 | 1,000–1,500 | Medium city |
| 75 | 1,500–2,250 | Large city |
| 125 | 2,500–3,750 | Measured ceiling (16 vCPU) |

**Complaints processed per second** is the core throughput metric. Each "lifecycle" = one complaint filed, assigned, resolved, and verified (4 API calls). Multiply by 86,400 to get daily capacity.

---

## The Bottom Line

A single machine running Docker Compose handles DIGIT PGR for most deployments. You don't need Kubernetes until you're processing **bursty traffic at 500K+ records** or need **high availability**. Here's where each tier tops out.

---

## Tier Map: Which Spec Handles What

### Tier 1 — Small City / Pilot (4 vCPU, 8 GB RAM)

| Metric | Limit |
|--------|-------|
| Max concurrent users before slowdowns | ~120 test users (~2,400–3,600 real) |
| Max concurrent users before errors | ~180 test users (~3,600–5,400 real) |
| Safe daily volume | Up to **~50K complaints/day** (empty to low database) |
| Database record ceiling | < 100K records |

**Good for:** Pilots, small ULBs, demos, proof-of-concept deployments.
**Watch for:** Response times exceed 15 seconds at ~120 concurrent test users. Errors spike to 80%+ by 200 test users.

**Estimated AWS cost (Mumbai region):** ~$72/month (c7g.xlarge Graviton) or ~$124/month (c6i.xlarge Intel).

---

### Tier 2 — Medium City (8 vCPU, 16 GB RAM)

| Metric | Limit |
|--------|-------|
| Max concurrent users (fresh database) | ~250 test users (~5,000–7,500 real) |
| Max concurrent users (1M records) | ~60–80 test users (~1,500–2,400 real) before slowdowns |
| Safe daily volume (under 100K records) | **~500K–3.2M complaints/day** |
| Safe daily volume (1M records) | **~100K–200K complaints/day** (with degradation) |
| Database record ceiling | **300K records** comfortably; up to 500K with tuning |

**Good for:** Mid-size cities, state-level pilots with moderate complaint volumes.
**Watch for:** At 1M records, errors begin at ~80 test users and reach 25% at 300 test users.

**Estimated AWS cost (Mumbai region):** ~$143/month (c7g.2xlarge Graviton) or ~$248/month (c6i.2xlarge Intel).

---

### Tier 3 — Large City / State (16 vCPU, 32 GB RAM)

| Metric | Limit |
|--------|-------|
| Max concurrent users (measured, live deployment) | **125 test users (~2,500–3,750 real)** |
| Peak throughput | **10.8 lifecycles/sec (43.3 API req/s)** |
| Safe daily volume | **~935K complaints/day** |
| Failure mode | Latency, not errors — 0% HTTP failures at every level |
| Database record ceiling | **1M+ records** (tested and validated) |

**Good for:** Large cities, state-level rollouts, high-volume deployments.
**Watch for:** Throughput flattens above 125 test users — going to 150 adds 0.6% throughput for 19% more latency. CPU is the binding constraint (2–3% idle from 100 users up); memory is not.

**Estimated AWS cost (Mumbai region):** ~$287/month (c7g.4xlarge Graviton) or ~$496/month (c6i.4xlarge Intel).

---

## When Docker Compose Is No Longer Enough — The Kubernetes Trigger Points

Switch to Kubernetes when **any** of these are true:

| Trigger | Why |
|---------|-----|
| **Database exceeds 1M records** and you can't archive | Throughput drops below 6.3 complaints/sec. Query costs grow with every record. |
| **Traffic is bursty, not gradual** (at 500K+ records) | Spike tests show 57% error rate at 1M records. Docker Compose has no auto-scaling. |
| **You need >300 concurrent test users** (~9,000 real) | The database connection pool is the hard ceiling on a single machine, regardless of CPU. |
| **You need high availability / zero-downtime deploys** | Docker Compose is single-machine. A host failure = full outage. |
| **You need to scale PGR/Workflow horizontally** | On Docker Compose, each service runs as a single instance. |
| **You're running multiple modules** (not just PGR) | Additional modules compete for the same CPU and memory budget. The measured Tier 3 figures above are from a machine running the full 59-container stack. |

**Planning horizon:** Start planning a Kubernetes migration **3–6 months before** you expect to hit these triggers.

**Estimated K8s cost (Mumbai region):** A minimal production-grade EKS cluster (3 × c7g.2xlarge Graviton nodes + EKS control plane fee) runs ~$500–600/month.

---

## Before Scaling: 3 Fixes That Buy 9.4x More Capacity (Free)

Before investing in bigger hardware or Kubernetes, platform engineering needs to apply three database fixes. These recovered **9.4x throughput** in testing — the equivalent of upgrading hardware several tiers for zero cost.

| Fixes needed | Impact | Effort |
|--------------------------|--------|--------|
| "Apply the database index fix from PR #248" | 200x faster address lookups | Minutes |
| "Disable fuzzy search in the Workflow service (PR #248)" | 769x faster workflow queries | Minutes |
| "Disable Postgres JIT compilation (PR #248)" | 4.3x faster across all queries | Minutes |

All three fixes are packaged in [PR #248](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/248). **Apply them on every deployment, regardless of scale.** The Tier 3 figures above were measured on a deployment running without them.

---

## Quick Decision Flowchart

```
Expected daily complaint volume?
│
├─ < 10K/day ──────────────────► Tier 1 (4 vCPU / 8 GB) — pilot / small ULB
│                                  ~$72/mo (Graviton) · ~$124/mo (Intel)
│
├─ 10K – 100K/day ─────────────► Tier 2 (8 vCPU / 16 GB) — medium city
│   │                              ~$143/mo (Graviton) · ~$248/mo (Intel)
│   └─ Database growing past 300K records? → Plan Tier 3 migration
│
├─ 100K – 900K/day ────────────► Tier 3 (16 vCPU / 32 GB) — large city / state
│   │                              ~$287/mo (Graviton) · ~$496/mo (Intel)
│   └─ Database past 1M records? → Archive old complaints OR plan K8s
│
└─ > 900K/day OR bursty traffic at scale
   OR need HA / zero-downtime ─► Kubernetes (~$500–1,200/mo)
```

---

## Key Caveats

1. **These numbers are PGR-only.** Running additional DIGIT modules on the same machine reduces available capacity proportionally.
2. **Tier 1 and Tier 2 figures assume the 3 database fixes are applied.** Without them, performance at 100K records is 9.4x worse. The Tier 3 figures were measured without them.
3. **Tier 3 ceiling is defined by latency, not errors.** 125 test users is where end-to-end p95 exceeds the 15s budget with 0% HTTP failures. The error ceiling was not probed and is higher.
4. **Bursty traffic is harder than steady load.** If your deployment sees unpredictable traffic surges, size up one tier or move to Kubernetes earlier.
5. **Database size is the biggest performance driver.** Archiving resolved complaints older than 6–12 months keeps the database small and throughput high.
6. **CPU and database query patterns are the bottleneck** — not network or disk. Adding RAM alone won't help.
7. **AWS cost estimates use on-demand pricing** in the Mumbai (ap-south-1) region. Graviton (ARM) instances are recommended — 42% cheaper than Intel equivalents.
8. **Latency figures include ~185ms network RTT** — the load generator ran over the public internet, not on-host.
