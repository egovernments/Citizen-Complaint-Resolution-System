# Single-VM → Kubernetes Transition Plan: Indian Deployments

**Audience:** GTM / Solutions / Implementation / Commercial teams — state governments, Smart City / AMRUT programmes, large ULBs
**Source:** PR 1848 (Bomet single-VM run, 28 Aug + 1 Sep 2026) and PR 1937 (AWS EKS run, 1 Sep 2026)

---

## Why India Needs a Different Plan

Three structural differences make the Africa transition plan wrong for India:

**1. Complaint rates are 5–10× higher.** DIGIT was built for Indian cities and has years of deployment history. A well-adopted Indian ULB runs 10–30 complaints per 1,000 residents per day. The Africa plan's assumptions produce numbers that never stress a single VM; Indian rates produce numbers that stress a K8s cluster from the first week.

**2. The state-wide multi-tenant model changes the sizing question entirely.** Indian DIGIT deployments are not city-by-city — they are state-wide platforms where one K8s cluster serves all ULBs as separate tenants. The volume that matters for sizing is the sum across all ULBs in the state, not any individual city. A state with 10M urban population at Indian adoption rates exceeds the tested K8s ceiling within months without re-architecture.

**3. Notification costs dominate at scale.** Every PGR complaint lifecycle generates roughly 12 notification events (SMS, WhatsApp, in-app, email). At Indian adoption rates, this line item overtakes infrastructure cost at medium-sized state rollouts and dwarfs it at large ones. It must be in the budget before hardware is ordered.

---

## What the Two Tests Say

Same test evidence as the Africa plan — different interpretation at Indian volumes.

| | Single VM (PR 1848) | Kubernetes 4-node (PR 1937) |
|---|---|---|
| Clean ceiling, empty DB | **694,138 complaints/day** | **1,122,250 complaints/day** |
| Open-loop (realistic traffic) | 50% of lifecycles fail, 24% work never starts | 50% of offered work never started |
| At 1M stored records | ~544,000/day (March 2026, with DB fixes applied) | Not tested — expect similar degradation ratio |
| Hardware minimum | 16 vCPU / 32 GiB, no smaller config exists | 4 × m5a.xlarge (16 vCPU / 64 GB total) |
| Data degradation | −33% at 17k records, −55% at 27k records | Same pattern |
| Single Kafka partition | Hard ceiling — replicas cannot lift it | Same constraint — must fix before multi-replica scaling |

The open-loop finding is the most important one for Indian cities. The 50% failure rate under realistic arrival patterns means every capacity figure here is an upper bound under ideal conditions. **Plan on 40–50% of headline throughput for deployments that will face spikes** — ward announcements, monsoon season, an outage generating complaints, a public complaint drive.

---

## The Indian Urban Scale Model

India's municipal structure (Census 2011, the last complete published census):

| Category | Count | Typical population | Usual DIGIT deployment |
|---|---|---|---|
| Nagar Panchayat / Census Town | ~2,500 | 5,000–50,000 | Tenant on state platform |
| Nagar Palika / Municipal Council | ~1,800 | 50,000–300,000 | Tenant on state platform |
| Class I city / Small Municipal Corporation | ~70 | 300,000–1,000,000 | State platform tenant; sometimes standalone pilot |
| Large Municipal Corporation | ~50 | 1,000,000–5,000,000 | State platform, or own standalone K8s cluster |
| Mega Metro | ~10 | 5,000,000–35,000,000 | Own cluster; separate engineering programme |
| **State-wide rollout** | **~30 states** | **5M–100M urban population** | **The dominant model for DIGIT in India** |

**Complaint rate model** (based on mature DIGIT deployments in Punjab, Odisha, Andhra Pradesh):

| Maturity stage | Complaints per 1,000/day | Notes |
|---|---|---|
| Year 1 (launch) | 5–10 | Limited awareness, early adopters |
| Year 2–3 (growing) | 10–20 | Ward-level drives, app awareness spreading |
| Year 3+ (mature) | 20–40 | Sustained, mandated use, councillor tracking |
| Peak event day | 3–5× normal | Post-monsoon, power outage, election period |

All calculations below use **20 complaints/1,000/day** as the planning baseline — conservative for a mature deployment.

---

## Database Accumulation at Indian Rates

At Indian adoption rates, every tier above a Nagar Panchayat hits damaging data volumes within days to weeks, not months. This is the central planning constraint for India.

| City / deployment | Population | Complaints/day (20/1k) | Hours to 27k records (−55% throughput) | Days to 1M records |
|---|---|---|---|---|
| Nagar Panchayat | 20,000 | 400 | 68 days | 6.8 years |
| Municipal Council | 150,000 | 3,000 | 9 days | 333 days |
| Small Corp (e.g. Bhubaneswar, Mysuru) | 600,000 | 12,000 | **54 hours** | 83 days |
| Large Corp (e.g. Patna, Jaipur, Nagpur) | 2,000,000 | 40,000 | **16 hours** | 25 days |
| Mega Metro (e.g. Hyderabad, Chennai) | 10,000,000 | 200,000 | **3 hours** | 5 days |
| Small state urban pop (Punjab, Odisha) | 10,000,000 | 200,000 | **3 hours** | 5 days |
| Large state urban pop (Tamil Nadu) | 34,000,000 | 680,000 | **~1 hour** | 1.5 days |

**The practical consequence:** For any Indian deployment above a Nagar Palika, archiving is a launch prerequisite — the active dataset must be bounded by design. Without it, the capacity figures from the tests become irrelevant within the first working week.

---

## Tier-by-Tier Guidance

### Nagar Panchayat (5k–50k population)

**Single VM for the life of the deployment, as a state platform tenant.**

At 20/1k/day on 20k residents: 400 complaints/day. Database reaches 27k records in 68 days and 1M in 6.8 years. No scaling concern exists at this tier.

In practice a Nagar Panchayat never deploys standalone DIGIT — it is a tenant on the state platform, so the infrastructure question is answered at the state level. The relevant local question is: does this ULB's archiving cadence fit within the state-level policy?

**Contribution to state capacity budget:** at 400/day on a 200,000/day state deployment, this ULB contributes 0.2% of traffic. Negligible.

---

### Municipal Council / Nagar Palika (50k–300k population)

**State platform tenant. Infrastructure question answered at state level. Local planning question is archiving cadence.**

At 20/1k/day on 150k residents: 3,000 complaints/day. Database hits 27k records in 9 days and 1M in 333 days.

The throughput penalty at 27k records (−55%) arrives in the second week. On a shared state platform without per-tenant archiving, this ULB measurably degrades state-wide throughput within a fortnight of launch. Per-tenant archiving policies are the defence.

**Standalone deployment (exceptional — donor-funded pilot, non-state programme):** Single VM (16 vCPU / 32 GiB). Archiving operational before go-live. Plan to migrate to the state platform within 12–18 months.

---

### Small Municipal Corporation (300k–1M population; e.g. Bhubaneswar 837k, Mysuru 900k, Guwahati 957k)

**State platform tenant for throughput. Standalone K8s from day one if the city is running an independent programme (Smart City, AMRUT, state capital).**

At 20/1k/day on 600k residents: 12,000 complaints/day. Database hits 27k records in 54 hours and 1M records in 83 days. The throughput degradation is present essentially from launch.

**Throughput check:**
At 12,000/day you are at 1.7% of the single-VM clean ceiling (694k/day). The constraint is not throughput — it is query cost accumulating in the active dataset, which archiving must control.

**Standalone K8s configuration:** 2 nodes (16 vCPU / 32 GiB each) + managed RDS. ~$900–1,400/month infrastructure. Buys HA, rolling deploys, and 2× headroom beyond the tested single-machine ceiling. Right for a Smart City Mission city or a standalone state-capital deployment.

**Timeline:**

| Phase | Timing | Action |
|---|---|---|
| Launch | Day 0 | K8s, 2 nodes, managed DB, Kafka ≥3 partitions. All 3 DB fixes from PR #248. Heap fix (#1934) + Kafka hang fix (#1929). Archiving live from week 1. |
| Active dataset check | Month 1 | Verify active complaint count < 50k records. Tune archiving cadence if needed. |
| Scale review | Month 6 | If complaint rate has grown beyond 20/1k/day, re-run burst ladder against live deployment to re-establish the actual ceiling. |

---

### Large Municipal Corporation (1M–5M population; e.g. Patna 2.1M, Jaipur 3.1M, Lucknow 3.2M, Nagpur 2.5M, Indore 2.2M)

**K8s from day one. 2–3 nodes minimum. Kafka repartitioning before launch. Notification costs are a budget line, not a footnote.**

At 20/1k/day on 2M residents: 40,000 complaints/day. Database hits 27k records in 16 hours and 1M in 25 days. There is no clean-start period: data accumulation effects are present on day one.

**Throughput check against degraded K8s capacity (~50% of clean ceiling at live data):**

| Scenario | Demand | K8s capacity (degraded) | Headroom |
|---|---|---|---|
| Steady state, 40k/day | 0.46 complaints/sec | ~560k/day | ~1,200× — not the constraint |
| Peak event (5×), 200k/day | 2.31/sec | ~560k/day | ~180× — not the constraint |
| Future growth to 100k/day | 1.16/sec | ~560k/day | ~400× — not the constraint |

Throughput is not the concern at this tier. The concerns are:

**1. Notification cost.** 40,000 complaints/day × 4 external notifications = 160,000 SMS/WhatsApp/day. At Rs 0.13/message: Rs 20,800/day = Rs 76 lakh/year (~$90,000/year). This is real budget before any infrastructure cost.

**2. Availability.** A city of 2M with an active complaint mandate cannot accept a deployment that goes offline for 6 hours when the service runs out of JVM heap (which is what happened on the tested Bomet deployment on the current shipped configuration). The heap fix and restart policy are not optional.

**3. Archiving failure.** If archiving lapses for a month, 40k/day × 30 days = 1.2M records accumulate and throughput halves. Monitor active record count as a first-class operational metric alongside CPU and uptime.

**Launch configuration:**

| Component | Specification | Reason |
|---|---|---|
| Application nodes | 3 × m5a.xlarge (4 vCPU / 16 GB each) | K8s, HA, lose one node without outage |
| Database | Amazon RDS PostgreSQL db.r6g.large, separate from app nodes | DB separation required from day one at this volume |
| Kafka | ≥5 partitions on all PGR topics | Single partition is a hard ceiling replicas cannot lift |
| JVM heap | ~58% of container memory limit on all services | Fixes the heap exhaustion that caused a 6-hour outage on Bomet |
| Liveness probe | `timeoutSeconds: 10` (not 3) | 3s kills healthy-but-loaded pods at this complaint rate |
| Archiving | Automated, daily, archive resolved > 90 days | Active dataset target: <100k records |

**Infrastructure cost: ~$1,200–1,800/month. Notification cost: ~$7,500/month. Notifications cost more than the servers.**

---

### Mega Metro (5M+ population; Bengaluru 12M, Hyderabad 10M, Chennai 10M, Kolkata 15M, Mumbai 21M, Delhi 32M)

**This is an architecture programme, not an infrastructure purchase.**

At 20/1k/day, Delhi (32M) generates 640,000 complaints/day. At 30/1k/day: 960,000/day. Both exceed the tested K8s clean ceiling (1,122,250/day at empty DB) once data accumulation is factored in.

**Throughput check:**

| City | Population | Rate | Complaints/day | K8s headroom (degraded ~50%) |
|---|---|---|---|---|
| Hyderabad / Chennai | 10M | 20/1k | 200,000/day | ~2.8× |
| Bengaluru | 12M | 25/1k | 300,000/day | ~1.9× |
| Mumbai | 21M | 20/1k | 420,000/day | ~1.3× |
| Delhi | 32M | 20/1k | 640,000/day | **exceeds degraded K8s ceiling** |
| Delhi | 32M | 30/1k | 960,000/day | **exceeds clean K8s ceiling** |

The tested K8s configuration is 4 nodes with 1 replica per service. Adding replicas does not help until Kafka is repartitioned. Once Kafka carries 16 partitions and bottleneck services run 4 replicas, the ceiling rises proportionally — but neither has been tested.

**What a mega-metro deployment actually requires:**
- Kafka topics: 8–16 partitions minimum before launch
- Application replicas: 2–4 per bottleneck service (pgr-services, egov-workflow-v2, egov-persister)
- Database: Aurora PostgreSQL with read replicas; partitioning strategy before go-live
- Archiving: intra-day, not nightly — at 300k/day a nightly batch archives 300k rows per run but the dataset grows 300k rows per day; you need continuous archiving to hold steady
- Observability: full APM stack (Jaeger tracing is in the codebase); Kafka consumer lag monitoring per topic per partition
- Engineering team: 2–3 platform engineers permanently assigned

**Infrastructure cost: $5,000–15,000/month. Notification cost: $500,000–2,000,000/year. Operational cost dominates all other line items.**

Do not launch Delhi, Mumbai, or Bengaluru without benchmarking your specific multi-replica, multi-partition configuration first. The numbers in PR 1937 are not valid for this architecture.

---

### State-Wide Rollout (The Dominant Indian Model)

**Every mid-to-large state in India needs K8s from day one. The single-VM path does not exist at this scale.**

| State | Urban population | Complaints/day (20/1k) | Hours to 27k records | Days to 1M records |
|---|---|---|---|---|
| Punjab | ~10M | 200,000 | **3 hours** | 5 days |
| Odisha | ~7M | 140,000 | **5 hours** | 7 days |
| Telangana | ~18M | 360,000 | **<2 hours** | 3 days |
| Andhra Pradesh | ~14M | 280,000 | **~2 hours** | 3.5 days |
| Tamil Nadu | ~34M | 680,000 | **~1 hour** | 1.5 days |
| Maharashtra | ~55M | 1,100,000 | **<1 hour** | <1 day — exceeds K8s clean ceiling |
| Uttar Pradesh | ~45M | 900,000 | **<1 hour** | ~1 day — exceeds K8s clean ceiling |

**The Punjab / Odisha / Telangana / AP tier (~5–20M urban population):**

K8s, 4–6 nodes, Kafka with 8 partitions minimum, managed database separate from application nodes, PgBouncer connection pooling (already in the stack). Archiving from day one with a defined SLA — at 200,000 complaints/day, the database is throughput-impaired by week two without it.

Phased ULB activation is not optional at this tier: activate ULBs in batches of 20–30, measure actual complaint rates and database growth against projections, tune, then expand. Do not activate all ULBs simultaneously on day one.

**The Maharashtra / UP / Tamil Nadu tier (~30–55M urban population):**

At 1,100,000 complaints/day (Maharashtra), you are past the tested K8s configuration even at empty-DB capacity. This requires:
- Multi-cluster or multi-namespace architecture (separate K8s workloads by division or ULB tier)
- Database sharding by tenant/ULB, which aligns with DIGIT's existing multi-tenant model
- Kafka repartitioning to 16+ partitions
- A dedicated platform engineering team (not shared with application development)
- Staged rollout measured in cohorts, not a single cutover

**Treat Maharashtra-scale and UP-scale as architecture programmes reviewed at the Secretary/Mission Director level, not procurement exercises.**

---

## The Notification Cost Table

This is the budget item that determines whether a state can afford to run the platform. At Rs 0.13/message (bulk rate for SMS/WhatsApp), with 4 external notifications per complaint lifecycle:

| Deployment | Complaints/day | External notifications/day | Cost/day | Cost/year |
|---|---|---|---|---|
| Municipal Council (150k) | 3,000 | 12,000 | Rs 1,560 | **~Rs 5.7 lakh (~$7k)** |
| Small Corp (600k) | 12,000 | 48,000 | Rs 6,240 | **~Rs 23 lakh (~$27k)** |
| Large Corp (2M) | 40,000 | 160,000 | Rs 20,800 | **~Rs 76 lakh (~$90k)** |
| Large Metro (10M) | 200,000 | 800,000 | Rs 1,04,000 | **~Rs 3.8 crore (~$455k)** |
| Small state (10M urban, e.g. Punjab) | 200,000 | 800,000 | Rs 1,04,000 | **~Rs 3.8 crore (~$455k)** |
| Mid state (18M urban, e.g. Telangana) | 360,000 | 1,440,000 | Rs 1,87,200 | **~Rs 6.8 crore (~$820k)** |
| Large state (34M urban, e.g. Tamil Nadu) | 680,000 | 2,720,000 | Rs 3,53,600 | **~Rs 12.9 crore (~$1.55M)** |

**Practical actions before state-level launch:**
- Negotiate bulk SMS/WhatsApp rates: Rs 0.05–0.08/message is achievable at volume, roughly halving the estimates above.
- Shift every possible notification to in-app (free). Reserve SMS/WhatsApp for critical status updates only.
- Get a standalone Finance approval for the notification budget before the IT infrastructure approval — they are different magnitudes and different budget heads.
- The notification budget for a large state is a separate programme, not a line in an IT procurement.

---

## The Decision Framework

```
Is this a state government platform? (the common case in India)
│
YES ─────────────────────────────────────────────────────────────────┐
│                                                                     │
│  State urban population?                                            │
│  │                                                                  │
│  ├─ <5M (Goa, Himachal Pradesh, Tripura, NE states)                 │
│  │   K8s, 2 nodes, managed DB, 5 partitions                        │
│  │   ~$900–1,400/mo infra · Archiving from day 1                    │
│  │   Notification budget: ~$50–100k/year                            │
│  │                                                                  │
│  ├─ 5–20M (Punjab, Odisha, Telangana, AP, Rajasthan urban)          │
│  │   K8s, 4–6 nodes, managed DB, 8+ partitions                     │
│  │   Phased ULB activation (cohorts of 20–30)                      │
│  │   ~$1,800–3,000/mo infra                                         │
│  │   Notification budget: ~$400–800k/year — separate Finance item   │
│  │                                                                  │
│  └─ >20M (TN, MH, UP, WB, Karnataka, Gujarat, Bihar)                │
│      Architecture programme: multi-cluster, sharded DB,             │
│      16+ Kafka partitions, dedicated platform team                  │
│      Requires Secretary / Mission Director level review             │
│      Notification budget: $1–10M/year                              │
│                                                                     │
NO — standalone city deployment (Smart City, AMRUT, state capital)   │
│                                                                     │
│  Population?                                                        │
│  │                                                                  │
│  ├─ <50k (Nagar Panchayat / small pilot)                            │
│  │   Single VM (16 vCPU / 32 GiB)                                  │
│  │   Merge into state platform within 12–18 months                  │
│  │                                                                  │
│  ├─ 50k–300k (Municipal Council)                                    │
│  │   Single VM viable for throughput                                │
│  │   Archiving at launch — data fills in days, not months           │
│  │   Plan state platform migration at 12–18 months                  │
│  │                                                                  │
│  ├─ 300k–1M (Class I city / small corp)                             │
│  │   K8s, 2 nodes, from day 1                                       │
│  │   Notification cost now a real budget item (~$27k/year)          │
│  │                                                                  │
│  └─ >1M (large corp, metro)                                         │
│      K8s, 3+ nodes, Kafka repartitioned, managed DB                 │
│      Notification cost likely exceeds infrastructure cost            │
│      Benchmark your specific config before launch                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What to Fix Before Any Indian Launch

Everything below applies to both single-VM and K8s deployments. At Indian complaint rates, the consequences of not fixing these arrive in hours, not months.

| Fix | Indian consequence without it | Effort | Issue |
|---|---|---|---|
| Raise JVM heap to ~58% of container memory limit | At 40k complaints/day, OOM arrives in hours; 6-hour manual recovery is not acceptable | Config change, 5 min | #1934 |
| Add `-XX:+ExitOnOutOfMemoryError` | Service accepts connections, answers none, stays that way until manually restarted | Config change, 5 min | #1929 |
| Add timeout to `CustomKafkaTemplate.send()` | Kafka failure → permanent thread park → needs restart every time | Code change, PR needed | — |
| Raise liveness probe timeout 3s → 10s | Kubernetes kills loaded-but-healthy pods; at Indian complaint rates this happens under normal load | Config change, 5 min | — |
| Apply 3 DB fixes from PR #248 | 9.4× throughput loss begins at 100k records. A large corp hits 100k records in 2.5 days. | Minutes, already packaged | #248 |
| Repartition Kafka topics (≥5 for small city, ≥8 for state, ≥16 for metro) | Single partition is a hard ceiling; replicas cannot help until this is done | Kafka admin op, 30 min | — |
| **Archiving policy, live at launch** | At Indian rates, every deployment above a Nagar Palika hits damaging data volumes within days | Data policy + tooling | — |

---

## Infrastructure Cost Reference (AWS Mumbai, on-demand, Sep 2026)

| Configuration | Spec | Est. cost/month | Suitable for |
|---|---|---|---|
| Single VM | c7g.4xlarge Graviton (16 vCPU / 32 GiB) | ~$287 | Nagar Panchayat, small pilots only |
| Single VM | c6i.4xlarge Intel (16 vCPU / 32 GiB) | ~$496 | Same; Graviton preferred (42% cheaper) |
| K8s, 2 nodes | 2 × m5a.xlarge + managed RDS + LB | ~$900–1,400 | Small corp standalone; small state (<5M urban) |
| K8s, 4–6 nodes | 4–6 × m5a.xlarge + managed RDS | ~$1,800–3,000 | State deployments, 5–20M urban population |
| K8s, 10–15 nodes | 10–15 × m5a.xlarge + managed Aurora | ~$5,000–9,000 | Large metro, large state — requires multi-replica tuning |
| Architecture programme | Custom | Requires separate quote | Maharashtra, UP, Tamil Nadu, Delhi scale |

Reserved instances or savings plans can reduce all figures 30–60% for committed deployments.

---

## Summary

| Tier | Population | Start with | First migration | K8s trigger |
|---|---|---|---|---|
| Nagar Panchayat | <50k | Single VM (state tenant) | Never (unless standalone) | Availability SLA only |
| Municipal Council | 50k–300k | Single VM | State platform merger, 12–18 months | HA mandate, or complaint/day approaching 400k |
| Small Corp / standalone city | 300k–1M | K8s, 2 nodes | — | Already on K8s |
| Large Corp | 1M–5M | K8s, 3 nodes | — | Already on K8s |
| Mega Metro | 5M+ | K8s, purpose-designed | — | Architecture programme |
| State <5M urban | — | K8s, 2 nodes | — | Already on K8s |
| State 5–20M urban | — | K8s, 4–6 nodes, phased | — | Already on K8s |
| State >20M urban | — | Architecture programme | — | Requires Secretary-level review |

**For Indian deployments, the single VM is for Nagar Panchayat pilots only.** Everything above that is a state platform question. And for every tier above a Municipal Council, the notification budget is a larger budget conversation than the infrastructure.

---

## Known Unknowns That Matter More in India

| Question | Indian consequence | Status |
|---|---|---|
| Multi-tenant (multi-ULB) performance | All state deployments run hundreds of tenants on one cluster; ABAC per-request overhead was not measured at state scale | Unmeasured |
| Multi-module performance | Indian cities typically run PGR + Property Tax + Trade License + W&S together; shared Kafka/Postgres/MDMS means competing traffic changes every figure in this document | Unmeasured |
| K8s at 1M records | PR 1937 ran at 3 complaints; 1.12M/day is an empty-DB upper bound | Unmeasured — expected to degrade similarly to VM March 2026 data |
| Multi-replica per service | K8s tested at 1 replica per service; horizontal scaling behind a load balancer is not measured | Unmeasured — Kafka partition limit binds first |
| 8+ Kafka partition behaviour | Single partition identified as hard ceiling; performance with 8–16 partitions is unknown | Unmeasured |
| Bulk notification rates | Cost estimates above use Rs 0.13/message; negotiated bulk rates are achievable and materially change the economics | Deployment-specific |
