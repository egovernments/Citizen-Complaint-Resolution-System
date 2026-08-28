# DIGIT Complaints Management Capacity Planning: When to Scale from Docker Compose to Kubernetes

**Audience:** GTM / Solutions / Implementation teams
**Source:** Load test results from August 2026 against a live DIGIT Complaints Management deployment on Docker Compose (single machine), measured as a CPU-profile matrix

---

## How to Read This Document

**Concurrent users** in this document refers to users actively filing or checking complaints at the same time — not just logged in. Our load tests simulate "Virtual Users" (VUs), where each VU files complaints back-to-back without pausing. Real users spend most of their time reading and navigating. The rough conversion:

> **1 test user ≈ 20–30 real users online simultaneously**

So when we say "80 concurrent test users," that translates to roughly **1,600–2,400 real people using the system at once**.

| Test Users | Real Users Online | Typical Deployment |
|------------|------------------|-------------------|
| 2 | 40–60 | Pilot / demo |
| 10 | 200–300 | Small ULB |
| 50 | 1,000–1,500 | Medium city |
| 80 | 1,600–2,400 | Measured ceiling (16 vCPU profile) |

**Complaints processed per second** is the core throughput metric. Each "lifecycle" = one complaint filed, assigned, resolved, and verified (4 API calls). Multiply by 86,400 to get daily capacity.

---

## The Bottom Line

A single machine running Docker Compose handles DIGIT PGR for most deployments. The 16 vCPU profile carried **190,426 complaints/day at 100% success** and stayed under 1% errors up to **80 concurrent test users**. You don't need Kubernetes until you're past that, past **1M records**, or you need **high availability**. Below 4 vCPU there is no usable tier — the 2 vCPU profile is already saturated below 2 test users.

---

## Tier Map: Which Spec Handles What

### Tier 1 — Small City / Pilot (4 vCPU, 8 GB RAM)

| Metric | Limit |
|--------|-------|
| Max concurrent users before slowdowns | Below 2 test users (end-to-end p95 21.8s at 2) |
| Max concurrent users before errors | ~10 test users (~200–300 real) |
| Peak throughput | 0.216 lifecycles/sec at 10 test users |
| Safe daily volume | Up to **~18,600 complaints/day** |
| Database record ceiling | < 100K records |

**Good for:** Pilots, small ULBs, demos, proof-of-concept deployments.
**Watch for:** Response times exceed the 15-second budget at every level tested. At 50 test users throughput collapses to 0.049 lifecycles/sec with 15.2% success and 53.6% HTTP failures.

**Estimated AWS cost (Mumbai region):** ~$72/month (c7g.xlarge Graviton) or ~$124/month (c6i.xlarge Intel).

---

### Tier 2 — Medium City (8 vCPU, 16 GB RAM)

| Metric | Limit |
|--------|-------|
| Max concurrent users before slowdowns | ~2 test users (~40–60 real) |
| Max concurrent users tested without errors | 50 test users (~1,000–1,500 real), 100% success |
| Peak throughput | 0.693 lifecycles/sec (2.80 API req/s) |
| Safe daily volume | **~59,900 complaints/day** |
| Database record ceiling | **300K records** comfortably; up to 500K with tuning |

**Good for:** Mid-size cities, state-level pilots with moderate complaint volumes.
**Watch for:** Throughput plateaus from 10 test users up — 10 and 50 test users return the same 0.69 lifecycles/sec. The extra load appears purely as latency (server p95 rises from 4.26s to 24.13s) with no errors at any level.

**Estimated AWS cost (Mumbai region):** ~$143/month (c7g.2xlarge Graviton) or ~$248/month (c6i.2xlarge Intel).

---

### Tier 3 — Large City / State (16 vCPU, 32 GB RAM)

| Metric | Limit |
|--------|-------|
| Max concurrent users within all thresholds | 10 test users (~200–300 real) |
| Max concurrent users under 1% errors | **80 test users (~1,600–2,400 real)** |
| Peak throughput | **2.204 lifecycles/sec (8.80 API req/s)** at 50 test users |
| Safe daily volume | **~190,400 complaints/day** |
| Failure mode | Latency first — 0% HTTP failures through 50 test users |
| Database record ceiling | **1M+ records** (tested and validated, March 2026) |

**Good for:** Large cities, state-level rollouts, high-volume deployments.
**Watch for:** Burst throughput peaks at 40 test users (2.208 lifecycles/sec) and falls away above it — 80 gives 1.331/s, 160 gives 0.567/s with 3.34% failures, and 320 completes nothing. In the ramp matrix the profile is still climbing at 50 test users and is not saturated there.

**Estimated AWS cost (Mumbai region):** ~$287/month (c7g.4xlarge Graviton) or ~$496/month (c6i.4xlarge Intel).

---

## When Docker Compose Is No Longer Enough — The Kubernetes Trigger Points

Switch to Kubernetes when **any** of these are true:

| Trigger | Why |
|---------|-----|
| **Database exceeds 1M records** and you can't archive | Throughput drops below 6.3 complaints/sec. Query costs grow with every record. |
| **Traffic is bursty, not gradual** (at 500K+ records) | Spike tests show 57% error rate at 1M records. Docker Compose has no auto-scaling. |
| **You need >80 concurrent test users** (~2,400 real) | 80 is the last burst level under 1% errors on the 16 vCPU profile. Above it throughput falls and error rates climb, reaching 67% at 320 test users. |
| **You need high availability / zero-downtime deploys** | Docker Compose is single-machine. A host failure = full outage. |
| **You need to scale PGR/Workflow horizontally** | On Docker Compose, each service runs as a single instance. |
| **You're running multiple modules** (not just PGR) | Additional modules compete for the same CPU and memory budget. The figures above are from a machine running the full 59-container stack. |

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

All three fixes are packaged in [PR #248](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/248). **Apply them on every deployment, regardless of scale.** The tier figures above were measured on a deployment running without them.

---

## Quick Decision Flowchart

```
Expected daily complaint volume?
│
├─ < 18K/day ──────────────────► Tier 1 (4 vCPU / 8 GB) — pilot / small ULB
│                                  ~$72/mo (Graviton) · ~$124/mo (Intel)
│
├─ 18K – 60K/day ──────────────► Tier 2 (8 vCPU / 16 GB) — medium city
│   │                              ~$143/mo (Graviton) · ~$248/mo (Intel)
│   └─ Database growing past 300K records? → Plan Tier 3 migration
│
├─ 60K – 190K/day ─────────────► Tier 3 (16 vCPU / 32 GB) — large city / state
│   │                              ~$287/mo (Graviton) · ~$496/mo (Intel)
│   └─ Database past 1M records? → Archive old complaints OR plan K8s
│
└─ > 190K/day OR > 80 concurrent test users
   OR need HA / zero-downtime ─► Kubernetes (~$500–1,200/mo)
```

---

## Key Caveats

1. **Tier figures come from CPU profiles, not from separate machines.** Each tier was measured by capping the DIGIT services on one 16 vCPU host with `docker update`. A profile pins each service to a fixed slice of the budget, whereas a real machine of that size lets services burst into each other's idle headroom — at 50 test users the 16 vCPU profile returned 2.204 lifecycles/sec against ~5.4 unthrottled on the same host. Treat the tier numbers as conservative.
2. **These numbers are PGR-only.** Running additional DIGIT modules on the same machine reduces available capacity proportionally.
3. **The figures were measured without the 3 database fixes applied.** With them, performance at 100K records was 9.4x better in the March 2026 tests.
4. **Latency gives way before errors.** Every tier crosses its 15-second end-to-end budget well before it starts returning failures. Tiers 2 and 3 returned 0% HTTP failures at every level in the matrix.
5. **Bursty traffic is harder than steady load.** If your deployment sees unpredictable traffic surges, size up one tier or move to Kubernetes earlier.
6. **Database size is the biggest performance driver.** Archiving resolved complaints older than 6–12 months keeps the database small and throughput high.
7. **AWS cost estimates use on-demand pricing** in the Mumbai (ap-south-1) region. Graviton (ARM) instances are recommended — 42% cheaper than Intel equivalents.
8. **Latency figures include ~185ms network RTT** — the load generator ran over the public internet, not on-host.
