# Capacity Planning — Bomet, 24 August 2026

**Audience:** GTM / Solutions / Implementation teams
**Source:** Load test run against the live Bomet County DIGIT deployment, 24 August 2026

This document maps the [Bomet run](./findings) onto the same planning framework as the
[March 2026 capacity plan](/recommendations-transition-plan). Where the two disagree, the
reason is explained rather than averaged away.

---

## How to Read This Document

**Concurrent users** means users actively filing or checking complaints at the same time — not
just logged in. Load tests simulate "Virtual Users" (VUs), where each VU files complaints
back-to-back without pausing. Real users spend most of their time reading and navigating. The
conversion used throughout this site:

> **1 test user ≈ 20–30 real users online simultaneously**

Applied to what Bomet actually sustained:

| Test Users (VU) | Real Users Online | Bomet verdict |
|---|---|---|
| 75 | 1,500–2,250 | comfortable |
| 100 | 2,000–3,000 | comfortable |
| **125** | **2,500–3,750** | **last clean level** |
| 150 | 3,000–4,500 | latency budget exceeded |

**Complaints processed per second** is the core throughput metric. Each lifecycle = one complaint
filed, assigned, resolved and verified (4 API calls). Multiply by 86,400 for daily capacity.

---

## The Bottom Line for Bomet

Bomet handles roughly **2,500–3,750 simultaneous real users** and **~935,000 complaints/day** of
theoretical throughput. It currently receives **20–100 complaints/day**.

**There is no capacity problem, and there will not be one for years.** The action item from this
run is not hardware — it is the three database fixes, which Bomet is running without.

---

## Where Bomet Sits on the Tier Map

Bomet is **Tier 3 hardware** (16 vCPU / 30 GB, ≈ the 16 vCPU / 32 GB tier) but does not produce
Tier 3 numbers.

| | March Tier 3 (16 vCPU) | **Bomet (16 vCPU), measured** |
|---|---|---|
| Max concurrent test users | ~300–350 | **125** |
| Real users online | ~6,000–9,000 | **2,500–3,750** |
| Daily volume | ~3.2M/day (under 100K records) | **~935K/day** |
| Ceiling defined by | errors (connection exhaustion, PgBouncer timeouts) | **latency budget, zero errors** |
| Database fixes applied | **yes** (assumed throughout) | **no** |
| Services on the box | PGR-relevant only | **full 59-container DIGIT stack** |
| Machine | dedicated AWS EC2 | **shared KVM guest**, idle load 5.5–6.9 |

::: warning These two ceilings are not the same measurement.
March's ~300 marks where the system starts **returning errors**. Bomet's 125 marks where it
exceeds a **latency budget while still returning zero errors**. Bomet's error ceiling was never
probed — it is strictly higher than 125, and possibly much higher. Do not read "125 vs 300" as
Bomet being 2.4× weaker hardware.
:::

**Equivalent cloud cost** if this workload were moved to AWS Mumbai at the same spec: ~$287/month
(c7g.4xlarge Graviton) or ~$496/month (c6i.4xlarge Intel), per the March pricing.

---

## Before Scaling: The Three Fixes Bomet Is Missing

The March analysis found three database issues worth **9.4× throughput** combined. Verified
against this repository's deploy path, **none of the three are applied on Bomet**:

| Fix | Status on Bomet | Impact |
|---|---|---|
| FK index on the PGR address table (`idx_eg_pgr_address_v2_parentid`) | **missing** — only a `locality` index exists | 200× faster address lookups |
| Disable workflow fuzzy search (`EGOV_WF_FUZZYSEARCH_ISFUZZYENABLED=false`) | **unset** | 769× faster workflow queries |
| Disable Postgres JIT (`jit = off`) | **not set** | 4.3× faster across all queries |

All three are packaged in [PR #248](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/248)
and take minutes to apply.

**Why this is not urgent today, and why it will be:** these fixes matter as the database grows.
Bomet holds ~2,250 complaints, small enough that the missing indexes cost little. The March data
shows an unfixed deployment degrading roughly **9.4× by 100K records**. Apply them while it is a
five-minute change rather than an incident.

---

## When Bomet Would Need to Scale

At current volume, both scaling triggers are years away:

| Trigger | Threshold | Bomet's runway |
|---|---|---|
| **Concurrency** approaches the measured ceiling | ~2,500 real users online at once | Not plausible at 20–100 complaints/day |
| **Database size** enters the degradation zone | ~100K complaints | ~2.7 years at 100/day; ~13 years at 20/day (from ~2,250 today) |

The database trigger will arrive first. The correct response at that point is to apply the three
fixes (if still outstanding) and re-run this harness — not to buy hardware.

---

## The Kubernetes Question

Switch to Kubernetes when **any** of these become true. None are true for Bomet today:

| Trigger | Bomet status |
|---|---|
| Database exceeds 1M records and cannot be archived | ~2,250 complaints — no |
| Traffic is bursty rather than gradual, at 500K+ records | no |
| More than ~300 concurrent test users (~9,000 real) needed | no |
| **High availability / zero-downtime deploys required** | **This is the one to watch.** Bomet is a single machine; a host failure is a full outage. If Bomet becomes production-critical, HA — not capacity — is the reason to move. |
| Horizontal scaling of PGR/Workflow required | no |
| Running multiple DIGIT modules | **already true** — the full 59-container stack runs on one box, which is part of why the measured ceiling sits below the PGR-only tier figures |

---

## Quick Decision Flowchart

```
Expected daily complaint volume?
│
├─ < 10K/day ──────────────────► Current Bomet spec is far more than adequate
│                                  Measured ceiling ~935K/day · ~93× the 10K design target
│                                  ACTION: apply the 3 DB fixes, then leave it alone
│
├─ 10K – 100K/day ─────────────► Still within the measured ceiling
│   └─ Re-run the harness once the DB passes ~100K records
│
├─ 100K – 900K/day ────────────► Approaching the measured ceiling
│   └─ Apply DB fixes first (9.4× headroom), re-measure, then consider more vCPU
│
└─ > 900K/day OR HA required ──► Scale out — add vCPU for throughput,
                                  or Kubernetes if the driver is availability
```

---

## Key Caveats

1. **These numbers are for the Bomet deployment specifically** — a shared KVM guest running the
   full DIGIT stack with the three database fixes absent. They are not a general 16 vCPU figure,
   and they do not supersede the March tier table.
2. **The error ceiling is unmeasured.** 125 VU is where a latency budget breaks with zero errors.
   Bomet's true breaking point is higher and was deliberately not probed on a live system.
3. **The latency budget that broke includes ~8s of scripted think time.** By server latency alone
   (`http_req_duration` p95 = 2,326ms against a 5,000ms budget), nothing had broken at 150 VU.
4. **Daily-capacity figures assume flat-out operation** every second of the day. They are headroom
   indicators, not service commitments.
5. **CPU is the bottleneck, not memory.** CPU idle hit 2% while 28+ GB of RAM sat unused. Adding
   RAM would buy nothing.
6. **Load-test latency includes ~185ms of network RTT** — the harness ran over the public internet,
   not on-host. Server-side latency is lower than reported.
