# DIGIT Complaints Management Capacity Planning: Sizing, Scaling, and When to Move to Kubernetes

**Audience:** GTM / Solutions / Implementation / Commercial teams
**Source:** Load test results from August 2026 against a live DIGIT Complaints Management deployment on Docker Compose (single machine), measured as an unthrottled concurrency ladder, an error-based burst ladder, and a constrained CPU-profile matrix

---

## How to Read This Document

**One "complaint lifecycle"** is a complaint filed, routed to a department, resolved, and then checked by the citizen. It is the unit everything below is measured in. One lifecycle is four calls to the system.

**Plan on complaints per day.** It is measured directly, it needs no translation, and it is the number a city can forecast from its own population and service history. Every other figure in this document is derived from it.

**Concurrent users** means people actively filing or checking complaints at the same moment — not people logged in. Our tests use "test users" (VUs), each filing complaints back-to-back with no pause. Real people spend most of their session reading and navigating. The working conversion:

> **1 test user ≈ 20–30 real people online at the same time**

| Test Users | Real People Online | What This Represents |
|------------|-------------------|---------------------|
| 2 | 40–60 | Pilot / demo |
| 10 | 200–300 | Small ULB |
| 80 | 1,600–2,400 | **Comfortable ceiling, zero errors** |
| 160 | 3,200–4,800 | **Maximum before failure** |
| 320 | 6,400–9,600 | System collapses |

Treat the 20–30 ratio as a rule of thumb for conversation. Treat complaints per day as the number to sign up to.

---

## The Bottom Line

A single 16 vCPU machine running Docker Compose handles **694,000 complaints per day with zero errors**, and up to **1,076,000 per day** at its absolute limit. That is 69x and 108x a 10,000/day target.

You do not need Kubernetes until you are past roughly 700,000 complaints/day, past 1M stored records, or you need the system to survive a machine failure.

---

## What One Server Handles

Measured on a live 16 vCPU / 30 GB machine running the full 59-container stack, with no artificial limits applied.

| Load | Complaints/sec | **Complaints/day** | Response time | Failures |
|------|---------------|-------------------|--------------|----------|
| 20 test users | 2.081 | 179,798 | 0.34s | **0.000%** |
| 40 test users | 4.091 | 353,462 | 0.35s | **0.000%** |
| **80 test users** | **8.034** | **694,138** | **0.45s** | **0.000%** |
| 160 test users | 12.463 | 1,076,803 | 2.20s | 0.670% |
| 320 test users | 1.113 | 96,163 | 60s (timeout) | 41.12% |

**Three numbers matter commercially:**

**Peak with zero errors — 694,138 complaints/day.** Every request succeeded, and response times stayed under half a second. This is the number to quote in a contract or an SLA.

**Absolute maximum — 1,076,803 complaints/day.** Still 98.83% successful, but errors have appeared and responses have slowed roughly five-fold. Survivable in a surge; not somewhere to operate.

**Collapse — beyond that.** At 320 test users the system stops completing work entirely: 41% of requests fail and throughput falls below what 20 test users achieved. The edge is sharp, not gradual. There is no graceful degradation to rely on.

---

## Why the Same Machine Can Give Very Different Numbers

The same 16 vCPU host was tested twice: once with each service given a fixed slice of the processor, and once with the services free to share the whole machine.

| At the same load (80 test users) | Complaints/sec | Response time |
|---|---|---|
| Services capped at a fixed slice each | 1.331 | 15.31s |
| Services sharing the whole machine | **8.034** | **0.45s** |

**Six times the throughput, at one-thirty-fourth the response time — on identical hardware.**

The commercial takeaway is simple: **how the machine is configured matters more than how big the machine is.** A deployment that caps each service to a fixed allocation wastes most of the hardware it is paying for, because no service can use another's idle capacity. Confirm with the implementation team that per-service CPU limits are not set before sizing up hardware — it is free capacity.

This also means older tier figures based on capped profiles understate real machines. They are treated below as conservative floors.

---

## Tier Map: Which Spec Handles What

### Tier 1 — Pilot / Small ULB (4 vCPU, 8 GB RAM)

| | |
|---|---|
| Safe daily volume | **~18,600 complaints/day** |
| Concurrent users before errors | ~10 test users (200–300 real) |
| Database ceiling | Under 100K records |
| Estimated cost | ~$72/month (Graviton) · ~$124/month (Intel) |

**Good for:** pilots, demos, small ULBs.
**Watch for:** response times exceed the 15-second budget at every level tested. At 50 test users it collapses to 15% success.

### Tier 2 — Medium City (8 vCPU, 16 GB RAM)

| | |
|---|---|
| Safe daily volume | **~59,900 complaints/day** |
| Concurrent users without errors | 50 test users (1,000–1,500 real) |
| Database ceiling | 300K records comfortably, 500K with tuning |
| Estimated cost | ~$143/month (Graviton) · ~$248/month (Intel) |

**Good for:** mid-size cities, state pilots.
**Watch for:** throughput plateaus early — extra load turns into waiting, not more work done.

### Tier 3 — Large City / State (16 vCPU, 30 GB RAM)

| | |
|---|---|
| Safe daily volume | **~694,100 complaints/day, zero errors** |
| Absolute maximum | ~1,076,800 complaints/day at 0.67% errors |
| Concurrent users, zero errors | 80 test users (1,600–2,400 real) |
| Maximum before failure | 160 test users (3,200–4,800 real) |
| Database ceiling | 1M+ records |
| Estimated cost | ~$287/month (Graviton) · ~$496/month (Intel) |

**Good for:** large cities, state rollouts, high-volume deployments.
**This is the only tier measured on a real unthrottled machine.** Tiers 1 and 2 come from capped profiles and are conservative floors.

---

## Scaling to 1 Million and 10 Million Complaints Per Day

Everything above comes from one machine. Everything in this section above one machine is **arithmetic projection, not measurement** — the node counts follow from measured per-machine throughput, but no multi-machine configuration was tested.

### 1 Million Complaints/Day

**Roughly 2 application servers of Tier 3 spec, plus a separate database server.**

One machine can technically reach 1M/day, but only by running at its absolute limit with errors present and responses five times slower. Running two machines at the comfortable zero-error rate covers 1M/day with capacity to spare, and lets you lose one machine without an outage.

| | |
|---|---|
| Required rate | 11.6 complaints/sec |
| Application servers | **2 × 16 vCPU / 30 GB** |
| Database | Separate managed database, not on the app servers |
| Platform | Kubernetes — Docker Compose is single-machine and cannot spread load |
| Records accumulated | **365 million per year** |
| Rough infrastructure cost | ~$900–1,400/month |

**The hard part is not the servers.** At this volume the database grows by 365 million records a year, and stored data volume is the single biggest driver of performance in every test we have run. An archiving policy is mandatory, not optional.

### 10 Million Complaints/Day

**Roughly 15 application servers — but at this scale the application is no longer the constraint.**

| | |
|---|---|
| Required rate | 115.7 complaints/sec |
| Application servers | **~15 × 16 vCPU / 30 GB** (projected) |
| Records accumulated | **3.65 billion per year** |
| Rough infrastructure cost | Order of $8,000–15,000/month, requires a proper quote |

At this volume three things need engineering work before hardware is even ordered:

**The message queue must be repartitioned.** The complaint event stream on the tested deployment runs with a single partition, which means one consumer processes every complaint event in sequence regardless of how many servers you add. This is a hard ceiling that more hardware cannot lift. It is a configuration change, but it must be made deliberately.

**The database must be partitioned and archived.** 3.65 billion records a year is beyond what a single conventional database handles well. This is a data architecture project measured in months, not a sizing decision.

**Notification volume becomes its own system.** Each complaint generates around 12 notification events across SMS, WhatsApp, email and in-app. At 10M complaints/day that is 120M notification events daily, with direct per-message costs from external providers. This is frequently larger than the infrastructure bill and needs its own budget line.

**Recommendation:** treat 10M/day as an architecture programme rather than a procurement exercise. The realistic path is a staged rollout validated at 1M/day first.

---

## Before Scaling: Fixes That Buy 9.4x More Capacity for Free

Before buying bigger hardware, platform engineering should apply three database fixes that recovered **9.4x throughput** in testing — the equivalent of jumping several hardware tiers at zero cost.

| Fix | Impact | Effort |
|---|---|---|
| Apply the database index fix from PR #248 | 200x faster address lookups | Minutes |
| Disable fuzzy search in the Workflow service | 769x faster workflow queries | Minutes |
| Disable Postgres JIT compilation | 4.3x faster across all queries | Minutes |

All three are packaged in [PR #248](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/248). **Apply them on every deployment regardless of scale.** The figures in this document were measured without them.

Alongside these, confirm no per-service CPU caps are set — worth up to 6x on its own, as shown above.

---

## When Docker Compose Is No Longer Enough

Move to Kubernetes when **any** of these is true:

| Trigger | Why |
|---|---|
| More than ~700,000 complaints/day | The comfortable zero-error ceiling of one machine |
| Database past 1M records and you cannot archive | Throughput falls sharply as stored data grows |
| Traffic is bursty rather than steady | Docker Compose cannot auto-scale; surges hit the hard collapse point |
| More than 160 test users (~4,800 real people) | The measured failure point on a 16 vCPU host |
| You need high availability | Docker Compose is one machine — a host failure is a full outage |
| You run several DIGIT modules together | Other modules compete for the same machine |

**Planning horizon:** start planning a Kubernetes migration **3–6 months** before you expect to hit any of these.

---

## Quick Decision Guide

```
Expected daily complaint volume?
│
├─ < 18K/day ──────────────► Tier 1 (4 vCPU / 8 GB)      ~$72–124/mo
│
├─ 18K – 60K/day ──────────► Tier 2 (8 vCPU / 16 GB)     ~$143–248/mo
│   └─ Past 300K records? → plan Tier 3
│
├─ 60K – 694K/day ─────────► Tier 3 (16 vCPU / 30 GB)    ~$287–496/mo
│   └─ Past 1M records? → archive, or plan Kubernetes
│
├─ 694K – 1M/day ──────────► Kubernetes, 2 app nodes     ~$900–1,400/mo
│                             + managed database + archiving policy
│
└─ Beyond 1M/day ──────────► Architecture programme, not a purchase
                              ~15 nodes at 10M/day, plus queue
                              repartitioning and data partitioning
```

---

## Key Caveats

1. **Tier 3 comes from a real machine; Tiers 1 and 2 come from capped profiles.** A capped profile pins each service to a fixed slice, whereas a real machine lets services share idle capacity — worth roughly 6x. Treat Tiers 1 and 2 as conservative floors.
2. **Everything above one machine is projection.** Node counts for 1M and 10M/day are arithmetic from measured single-machine throughput. No multi-machine configuration was tested.
3. **The tests ran against a nearly empty database** — about 2,300 stored complaints. Performance falls substantially as stored data grows, and earlier testing showed throughput dropping roughly six-fold between an empty database and 1M records. **Any deployment above 100,000 complaints/day needs an archiving policy from day one.**
4. **These numbers are complaints-only.** Running other DIGIT modules on the same machine reduces available capacity proportionally.
5. **The figures were measured without the three database fixes applied.** With them, earlier testing was 9.4x better at 100K records.
6. **The failure edge is sharp.** The system does not degrade gracefully — it goes from 0.67% errors to 41% errors and no completed work between 160 and 320 test users. Size with headroom.
7. **Access-control filtering was introduced to complaint search between the two test rounds.** The searches in the error-based ladder carry a department and jurisdiction filter that the earlier ramp tests did not, so the two rounds are not identical conditions.
8. **Cost estimates use AWS on-demand pricing** in Mumbai (ap-south-1). Graviton (ARM) instances are around 42% cheaper than Intel equivalents. The 1M and 10M/day figures are rough order-of-magnitude only and need a proper quote.
9. **Response times include ~185ms of network round-trip** — the load generator ran over the public internet rather than on the machine itself.
