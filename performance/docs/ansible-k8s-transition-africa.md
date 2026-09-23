# Single-VM → Kubernetes Transition Plan: African Deployments

**Audience:** GTM / Solutions / Implementation / Commercial teams
**Source:** PR 1848 (Bomet single-VM run, 28 Aug + 1 Sep 2026) and PR 1937 (AWS EKS run, 1 Sep 2026)

---

## What the Two Tests Actually Measured

Before using any numbers, understand what each run can and cannot say.

**Single VM — Bomet (PR 1848)**
16 vCPU / 30 GiB KVM guest, 59 containers, ~2,500 stored complaints, unthrottled. The burst ladder was partially invalidated by a 384 MB JVM heap exhaustion above 80 VU; the clean ceiling is 80 VU.

| Scenario | Complaints/day | Failures | Note |
|---|---|---|---|
| Burst ladder — clean ceiling | **694,138/day** | 0.000% | 80 VU; the number to plan against |
| Ramp ladder — sustainable peak | 931,824/day | 0.000% | 125 VU; latency budget not crossed |
| Open-loop (realistic traffic) | ~694k achieved | **19.57% requests fail / 50% lifecycles fail** | Same load, real arrival pattern |
| 1M stored records (March 2026, with DB fixes) | **544,000/day** | low | After applying the 3 fixes from PR #248 |

**Kubernetes — EKS (PR 1937)**
4 × m5a.xlarge (16 vCPU, 64 GB total), single replica per service, no CPU limits, fixed 3-complaint dataset, drain gate between VU steps.

| Scenario | Complaints/day | Failures | Note |
|---|---|---|---|
| Gated ladder — saturation point | **1,114,042/day** | 0.000% | 160 VU |
| Gated ladder — peak (within 6.7% noise floor) | 1,122,250/day | 0.000% | 200 VU; +1.3% over 160 VU — not distinguishable |
| Open-loop (realistic traffic) | ~50% of offered work dropped | — | Same pattern as VM |
| Any data volume | **not tested** | — | All runs on 3-complaint dataset — upper bound only |

**Shared constraints both runs expose:**

- Data degrades both platforms identically: −33% at 17k records, −55% at 27k records. The VM at 1M records (March 2026, optimised) delivered ~544k/day. K8s at 1M records is untested but will degrade at the same rate — project ~900k/day.
- Open-loop (realistic traffic) halves usable capacity on both platforms. The closed-loop numbers are upper bounds reached when the system controls its own pace.
- Single Kafka partition is a hard ceiling on both. Every PGR topic runs one partition. Adding K8s replicas does not lift it; repartitioning is required.

---

## The African City Population Model

Complaint rate assumption: **1–10 complaints per 1,000 residents per day** — low by Indian city standards, realistic for an early-stage African rollout.

**Conversion anchor from the tests:** 1 test user (VU) ≈ 20–30 real concurrent users.

| City tier | Population | Example cities | Complaints/day at 5/1,000/day | Days to 27k records (−55% throughput) | Days to 1M records |
|---|---|---|---|---|---|
| **Small ULB** | 10k–100k | Bomet (KE, 100k), Chókwè (MZ, 45k), Narok (KE, 50k), Inhambane (MZ, 70k) | 50–500 | 54–540 days | 5.5 years |
| **Mid-sized city** | 100k–1M | Nampula (MZ, 600k), Quelimane (MZ, 350k), Kisumu (KE, 600k), Blantyre (MW, 800k), Tamale (GH, 400k) | 500–5,000 | 5–54 days | 200–550 days |
| **Large metro** | 1M–5M | Nairobi (KE, 5M), Dar es Salaam (TZ, 7M), Accra (GH, 3.4M), Lusaka (ZM, 3.5M), Harare (ZW, 1.5M), Maputo (MZ metro, 1.1M), Addis Ababa (ET, 4M) | 5,000–25,000 | 1–5 days | 40–200 days |
| **Major metro** | 5M+ | Lagos (NG, 15M), Kinshasa (CD, 15M), Johannesburg (ZA, 6M) | 25,000–75,000 | <1 day | 13–40 days |

> The 27k-record column matters because that is the data volume at which the tests measured a 55% throughput loss. An archiving policy must prevent the active dataset from crossing this threshold.

---

## Tier-by-Tier Guidance

### Small ULB (10k–100k population)

**Stay on single VM. Indefinitely.**

At 5 complaints/1,000/day on a city of 100k: 500 complaints/day. The database reaches 27k records in about 54 days and 1M records in roughly 5.5 years without archiving. Peak concurrent load is 2–10 test users. Nothing about this workload approaches the single-VM ceiling of 694k/day.

Hardware cost is identical to a large city: $287–496/month (Graviton preferred). A pilot and a production deployment are the same machine — this means you can onboard with full production software and no migration to manage.

**Key risks are operational, not scaling:**
- The JVM heap misconfiguration (384 MB on a 30 GiB host) wedges the service permanently on OOM. Fix before go-live (#1934).
- The untimed Kafka `CompletableFuture.get()` converts any Kafka failure into a permanent hang that requires manual restart (#1929).
- No HA: a disk failure or power cut takes the whole deployment offline.

**Cutover trigger:** An explicit availability SLA (e.g. government mandate for 99.9% uptime), not volume. A small ULB almost never needs Kubernetes for throughput.

---

### Mid-sized City (100k–1M population)

**Start on single VM. Plan to separate the database within 18–36 months. Kubernetes is optional unless HA is required.**

At 5 complaints/1,000/day on 500k people (e.g. Nampula or Kisumu): 2,500 complaints/day. The database hits 27k records in about 11 days and 1M records in roughly 14 months. Throughput at 1M records (~544k/day with the March 2026 optimisations applied) still represents more than 200× the daily demand — you are not throughput-constrained. The pressure is query cost accumulating as data grows.

The open-loop result is the warning for this tier: on a busy day following an incident or announcement, roughly half of all complaints will fail under realistic arrival patterns. This is not a theoretical risk at mid-city scale.

**Timeline:**

| Milestone | Trigger | Action |
|---|---|---|
| Go-live | — | Single VM, 16 vCPU / 32 GiB. Apply all 3 DB fixes from PR #248. Heap fix (#1934) and Kafka hang fix (#1929). Design archiving policy — do not defer. |
| ~2–3 weeks | ~15k records | Enable Postgres slow-query logging for one week. Verify the address-lookup index from PR #248 is in use. |
| ~12–18 months | ~500k records | Move Postgres to a separate managed instance. Application VM keeps its 16 vCPU / 32 GiB. If HA is now required, this is the natural moment to migrate to K8s. |
| ~24–36 months | ~1M records | Archiving policy operational: move resolved complaints older than 12 months to cold storage. Keep active dataset under 50k records. |

**Cutover trigger to K8s:** An explicit HA mandate is the most likely reason — not volume. If HA is required from the start, deploy on K8s from day one with 2 nodes.

---

### Large Metro (1M–5M population)

**Start on single VM if cost is the primary constraint. Plan K8s migration actively from month 6. Expect to cut over within 12–24 months.**

At 5 complaints/1,000/day on 3M people (e.g. Lusaka or Accra): 15,000 complaints/day. The database hits 27k records in about 2 days. Throughput at 1M records (~544k/day) gives roughly 36× headroom — still not a throughput problem — but you are now running a degraded system as your baseline before the first month is out, and adoption growth erodes that headroom.

At 10 complaints/1,000/day (moderate adoption for a metro): 30,000/day. The VM ceiling (694k/day clean) gives roughly 23× headroom. Within 2–3 years of growth you approach the single-VM ceiling and will have accumulated tens of millions of records.

The open-loop finding is the operational warning for a large metro: on a busy day, half of all complaints will fail on single VM under realistic arrival patterns. A flood, a protest, or a government announcement will create exactly this scenario.

**Timeline:**

| Phase | Timing | Actions |
|---|---|---|
| **Launch** | Month 0 | Single VM (16 vCPU / 32 GiB). All 3 DB fixes. Heap fix + Kafka hang fix. Archiving policy designed before go-live and operational from week 2. |
| **Database separation** | Month 2–3 | Postgres onto its own managed instance. Application VM unchanged. This is the most important step before the K8s migration. |
| **Archiving live** | Month 3–6 | Resolved complaints older than 6 months archived to cold storage. Active dataset target: under 50k records. |
| **K8s readiness** | Month 6–9 | Kafka topics repartitioned to at least 3–5 partitions on `save-pgr-request`, `update-pgr-request`, `save-wf-transitions`. K8s manifests prepared and tested. |
| **K8s migration** | Month 12–18 | 2-node cluster (16 vCPU / 32 GiB per node), managed database, load balancer. Run old VM in parallel for 2 weeks during staged traffic cutover. |
| **K8s steady state** | Month 18+ | Tune replicas per bottleneck service. Monitor Kafka consumer lag per partition. Scale nodes as adoption grows. |

**Cutover trigger to K8s:** Any of:
- Database past 1M active records and archiving alone is not keeping pace
- Complaints/day approaching 400k (approaching VM ceiling with headroom for bursts)
- HA mandate from government or donor
- A second major DIGIT module added to the same deployment

---

### Major Metro (5M+ population)

**Deploy on Kubernetes from day one. Do not pass through single VM.**

At even 2 complaints/1,000/day on 10M people: 20,000 complaints/day. The database reaches 27k records in 32 hours. The single VM is a short-lived stepping stone rather than a viable operating platform, and the political/reputational cost of a single-machine failure at this scale rules out the single-VM HA posture.

**Starting configuration:** 2 nodes (16 vCPU / 32 GiB each) + managed database + Kafka with minimum 3–5 partitions per topic. This delivers ~1.12M complaints/day on the tested data (empty DB) with HA and rolling deploys, at roughly $900–1,400/month.

**Non-negotiables before launch:**
1. Kafka topic repartitioning — single partition is a hard ceiling regardless of node count
2. JVM heap raised on all services to ~58% of container memory limit
3. Liveness probe timeout raised from 3s to 10s — 3s kills healthy-but-loaded pods
4. Archiving policy designed before go-live and operational from week one
5. Separate database from day one — never co-locate with application nodes at this scale

---

## The Database Accumulation Problem

This is the most important planning point from both tests. The active dataset drives throughput on both platforms identically, and it must be explicitly controlled.

| Daily complaints | Days to 27k records (−55% throughput) | Days to 1M records |
|---|---|---|
| 500/day | 54 days | 5.5 years |
| 2,500/day | 11 days | 1.1 years |
| 10,000/day | 2.7 days | 100 days |
| 50,000/day | 13 hours | 20 days |

The −55% figure is what was measured at 27k records. A city running 10,000 complaints/day passes that threshold in under 3 days. **For any deployment above a small ULB, archiving is a launch prerequisite, not a later concern.**

The fix: archive resolved complaints older than 6–12 months to a read-only store. The tests show this is cheaper and more impactful than any hardware upgrade.

---

## The Cutover Decision

```
Is HA (99.9%+ uptime) required from day one?
│
YES → Kubernetes from day one (2 nodes minimum)
│
NO
│
Population > 3M AND likely adoption > 5/1,000/day?
│
YES → Kubernetes from day one
│
NO → Single VM (16 vCPU / 32 GiB)
        │
        Monitor — cut over when ANY of these hits:
        ├─ Active database records > 500k AND growing > 1k/day
        ├─ Complaints/day > 400k
        ├─ Peak concurrent users regularly > 60 VU (1,200–1,800 real)
        ├─ A second DIGIT module added to the deployment
        └─ Bursty traffic events causing visible complaint failures
```

**Start planning a K8s migration 3–6 months before you expect to hit any trigger.**

---

## What to Fix Regardless of Platform

Both test runs expose defects that apply independently of deployment model. These affect any deployment in production.

| Fix | Risk without it | Effort | Issue |
|---|---|---|---|
| Raise JVM heap to ~58% of container memory limit | OOM → permanent hang, no automatic recovery, hours of manual intervention | Config change, 5 min | #1934 |
| Add `-XX:+ExitOnOutOfMemoryError` | OOM leaves service accepting connections and answering none | Config change, 5 min | #1929 |
| Add timeout to `CustomKafkaTemplate.send()` | Any Kafka producer failure → all Tomcat threads park permanently | Code change, PR needed | — |
| Raise liveness probe timeout 3s → 10s | Kubernetes kills healthy-but-loaded pods mid-day | Config change, 5 min | — |
| Apply 3 DB fixes from PR #248 | 9.4× throughput loss; equivalent to running without a hardware upgrade | Minutes, already packaged | #248 |
| Repartition Kafka topics (min 3–5 partitions) | Hard ceiling that adding replicas cannot lift | Kafka admin, 30 min | — |
| Archiving policy, live at launch | Active dataset grows without bound; −55% throughput within 27k records | Data policy + tooling | — |

---

## Cost Reference (AWS Mumbai region, on-demand, Sep 2026)

| Configuration | Hardware | Est. cost/month | Suitable for |
|---|---|---|---|
| Single VM | c7g.4xlarge Graviton (16 vCPU / 32 GiB) | ~$287 | All volumes up to 694k complaints/day, no HA |
| Single VM | c6i.4xlarge Intel (16 vCPU / 32 GiB) | ~$496 | Same; Graviton preferred |
| K8s, 2 nodes | 2 × m5a.xlarge + managed RDS + load balancer | ~$900–1,400 | Up to ~1.4M complaints/day, HA |
| K8s, ~15 nodes | 15 × m5a.xlarge + managed RDS + repartitioned Kafka | ~$8,000–15,000 | ~10M complaints/day (requires re-architecture) |

The single VM costs the same for a pilot as for the largest city it can serve.

---

## Quick Reference: Which Tier, Which Platform

| City tier | Population | Start with | First migration | K8s trigger |
|---|---|---|---|---|
| Small ULB | <100k | Single VM | Never (unless HA mandate) | Availability SLA only |
| Mid-sized city | 100k–1M | Single VM | Separate Postgres at ~500k records | HA mandate, or complaints/day approaching 400k |
| Large metro | 1M–5M | Single VM | K8s by month 12–18 | 1M active records, or HA mandate, or bursty events |
| Major metro | 5M+ | Kubernetes from day 1 | — | From day 1 |

For the vast majority of African ULBs, the single VM is not a stepping stone — it is the production platform for 3–10 years. The Kubernetes migration is a real event with a real trigger, and the most reliable trigger in this data is stored data volume combined with an inability to archive fast enough, not concurrent user count.

---

## Known Unknowns

| Question | Why it matters | Status |
|---|---|---|
| Single VM ceiling above 80 VU | Burst ladder invalidated by heap exhaustion; real ceiling may be 150–250 VU | Unmeasured — needs re-run with fixed heap |
| K8s throughput at 1M records | PR 1937 ran at 3 records; 1.12M/day is an empty-DB upper bound | Unmeasured |
| K8s with multiple replicas per service | Tested at 1 replica per service; horizontal scaling impact is unknown | Unmeasured — Kafka partition limit binds before replicas help |
| Multi-module deployments | All tests cover PGR only | Unmeasured |
| African network latency | Bomet ran at ~185ms RTT; other African deployments may see 50–300ms | Not isolated in results |
