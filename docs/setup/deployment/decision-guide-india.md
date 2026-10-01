# Deployment Decision Guide: Single Server vs Kubernetes — Indian Deployments

**Audience:** State programme directors, Mission Directors (Smart City / AMRUT / State Urban Mission), city commissioners, and IT procurement teams.

**Purpose:** This document presents the criteria for choosing between a single-server and Kubernetes deployment of the Citizen Complaint Resolution System, based on load testing conducted in August–September 2026, and adapted for the complaint volumes, institutional structures, and cost profile specific to Indian urban deployments.

---

## India Deployment Considerations

Three characteristics of the Indian context meaningfully change how the infrastructure question should be framed, compared with other geographies:

**Complaint volumes are substantially higher.** Based on mature DIGIT deployments in Punjab, Odisha, and Andhra Pradesh, an established Indian ULB generates 10–30 complaints per 1,000 residents per day. This is 5–10 times the rate assumed for early-stage deployments in lesser populated geographies, and it compresses all data accumulation and capacity timelines significantly.

**The state-wide platform is the standard deployment model.** In India, infrastructure is typically provisioned at the state level, with individual ULBs accessing the platform as tenants. The relevant sizing question is not a single city's volume but the aggregate across all ULBs in the state. A state with 10 million urban residents at Indian adoption rates will generate volumes that exceed the tested configuration within months.

**Notification costs represent a separate and significant budget item.** Each complaint lifecycle generates approximately 12 notification events (SMS, WhatsApp, in-app, email). At state scale, the annual cost of these notifications frequently exceeds the total infrastructure budget. This warrants a separate Finance approval process, distinct from the IT procurement, and should be worked out before hardware is ordered.

---

## Volume Assumptions

The planning baseline used throughout this document is **20 complaints per 1,000 residents per day** — conservative for a mature deployment in year 2–3 of operation.


| Maturity Stage                                               | Complaints per 1,000 Residents/Day |
| ------------------------------------------------------------ | ---------------------------------- |
| Year 1 — limited awareness, early adopters                   | 5–10                               |
| Year 2–3 — ward-level drives, growing app awareness          | 10–20                              |
| Year 3+ — sustained or mandated use                          | 20–40                              |
| Peak event day (post-monsoon, power outage, election period) | 3–5× normal                        |


---



## Decision Framework

```
START HERE
│
▼
Is this a state government platform?
(the standard model for DIGIT deployments in India)
│
├── YES
│   │
│   ▼
│   State urban population?
│   │
│   ├─ Under 5M
│   │   (Goa, Himachal Pradesh, Tripura, NE states)
│   │   Kubernetes, 3–4 nodes + managed database
│   │   ~$900–1,400/month infrastructure (all-in)
│   │   Notification budget: ~$50–100k/year
│   │   (Finance approval advisable before procurement)
│   │
│   ├─ 5M to 20M
│   │   (Punjab, Odisha, Telangana, AP, Rajasthan urban)
│   │   Kubernetes, 4–6 nodes + managed DB + 8 Kafka lanes min.
│   │   Phased ULB activation in cohorts of 20–30
│   │   ~$1,800–3,000/month infrastructure
│   │   Notification budget: ~$400–800k/year
│   │   (separate Finance programme advisable)
│   │
│   └─ Over 20M
│       (Tamil Nadu, Maharashtra, UP, West Bengal,
│        Karnataka, Gujarat, Bihar, Delhi NCR)
│       Multi-cluster architecture, sharded database,
│       16+ Kafka partitions, dedicated platform team
│       Notification budget: $1–10M/year
│       Scope and procurement warrant review at
│       Secretary / Mission Director level
│
└── NO — standalone city deployment
    (Smart City Mission, AMRUT, state capital,
     donor-funded programme)
    │
    ▼
    City population?
    │
    ├─ Under 50,000 (Nagar Panchayat / small pilot)
    │   Single server (16 vCPU / 32 GB)
    │   Integration with state platform within 12–18 months
    │   Archiving at launch — data accumulates within weeks
    │
    ├─ 50,000–300,000 (Municipal Council)
    │   Single server viable for throughput
    │   Archiving is a launch prerequisite — threshold
    │   reached in approximately 9 days
    │   State platform migration at 12–18 months
    │
    ├─ 300,000–1,000,000 (Class I city / small corporation)
    │   Kubernetes, 3–4 nodes, from day one
    │   Notification costs are a real budget line (~$27k/year)
    │
    └─ Over 1,000,000 (large corporation, metro)
        Kubernetes, 3+ nodes, Kafka reconfigured, managed DB
        Notification costs at this scale typically exceed
        infrastructure costs — budget accordingly
        Configuration benchmarking advisable before launch
```

---

## Tier-by-Tier Analysis

### Nagar Panchayat / Census Town (under 50,000 people)

At 20 complaints/1,000/day on 20,000 residents: approximately 400 complaints/day. The tested single-server ceiling (694,000/day) provides over 1,700 times the expected volume. No throughput concern exists at this tier.

In practice, a Nagar Panchayat is a tenant on the state platform rather than an independent deployer. The infrastructure decision is made at the state level; the relevant local question is whether this ULB's archiving cadence aligns with the state platform's data management policy.

At 400/day, contribution to a 200,000/day state deployment is approximately 0.2% — negligible for platform-level planning purposes.

---

### Municipal Council / Nagar Palika (50,000–300,000 people)

At 20/1,000/day on 150,000 residents: approximately **3,000 complaints/day**. The active dataset reaches the 27,000-record throughput degradation threshold in approximately 9 days, and 1 million records in roughly 11 months.

On a shared state platform without per-ULB archiving, a Municipal Council at this complaint rate will measurably affect platform-wide throughput within a fortnight of launch. A per-tenant archiving policy is the appropriate mitigation.

**For standalone deployments (donor-funded pilot, non-state programme):**

- Single server (16 vCPU / 32 GB), with archiving operational before go-live
- A pathway to integration with the state platform within 12–18 months is worth including in programme planning

**Estimated notification cost:** ~$7,000/year at negotiated bulk SMS/WhatsApp rates. Meaningful but manageable at this tier.

---

### Small Municipal Corporation (300,000–1,000,000 people)

*Examples: Bhubaneswar (837k), Mysuru (900k), Guwahati (957k)*

At 20/1,000/day on 600,000 residents: approximately **12,000 complaints/day**. The active dataset reaches the throughput degradation threshold in 54 hours — performance effects are present from the first days of operation without an archiving policy.

From a raw throughput perspective, a single server is not the binding constraint: 12,000/day represents 1.7% of the tested single-server ceiling. The constraint is query cost accumulating in the active dataset, which archiving must control.

For a city operating under a formal programme (Smart City Mission, AMRUT, state capital), a Kubernetes deployment with 3–4 nodes and a managed database provides high availability and rolling deployment capability alongside the throughput headroom. This is the more appropriate configuration for a standalone deployment at this tier.

**Estimated infrastructure cost:** ~$900–1,400/month.
**Estimated notification cost:** ~$27,000/year — a budget line that warrants inclusion in IT procurement planning, separate from infrastructure.

During the first month of operation, monitoring the active complaint record count is advisable to verify that archiving cadence is keeping the dataset within the target range.

---



### Large Municipal Corporation (1,000,000–5,000,000 people)

*Examples: Patna (2.1M), Jaipur (3.1M), Lucknow (3.2M), Nagpur (2.5M), Indore (2.2M)*

At 20/1,000/day on 2 million residents: approximately **40,000 complaints/day**. The active dataset reaches the throughput degradation threshold within 16 hours of launch. There is no period of clean-state operation.

Three planning considerations are material at this tier:

**Notification expenditure.** At 40,000 complaints/day with 4 external notifications per complaint: 160,000 SMS/WhatsApp messages per day. At Rs 0.13/message (bulk rate), this amounts to approximately Rs 76 lakh/year (~$90,000/year). This figure is independent of infrastructure cost and warrants a separate Finance approval before procurement begins.

**Service continuity.** The default shipped configuration for the JVM heap has been observed to produce sustained outages under load at this complaint rate. Configuration corrections are a prerequisite to go-live, not a post-launch activity.

**Archiving as an operational metric.** If archiving lapses for a month, 1.2 million records accumulate and throughput halves. Active record count is appropriately treated as an operational metric monitored alongside CPU and service uptime, not a database administration task.

**Reference launch configuration:**


| Component              | Specification                                                    | Purpose                                                                        |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Application nodes      | 4 nodes × (4 vCPU / 16 GB each) — matches the tested configuration; 3 nodes is the functional minimum | High availability — loss of one node does not cause an outage |
| Database               | Managed PostgreSQL on a separate instance                        | Required at this volume; co-location with application nodes is inadvisable     |
| Kafka processing lanes | Minimum 5 partitions on all PGR topics                           | Single-lane configuration is a hard ceiling that additional nodes cannot raise |
| Archiving              | Automated, daily; archive resolved complaints older than 90 days | Active dataset target: under 100,000 records                                   |


**Estimated infrastructure cost:** ~$1,200–1,800/month.
**Estimated notification cost:** ~$7,500/month (~$90,000/year).

At this tier, notification expenditure typically exceeds infrastructure expenditure. Negotiating bulk rates (Rs 0.05–0.08/message is achievable at volume) and routing as many notifications as possible through in-app channels (at no per-message cost) materially reduces this figure.

---



### Mega Metro (5,000,000+ people)

*Examples: Bengaluru (12M), Hyderabad (10M), Chennai (10M), Kolkata (15M), Mumbai (21M), Delhi (32M)*

At 20/1,000/day, Delhi (32M) generates 640,000 complaints/day. At 30/1,000/day: 960,000/day. Both figures approach or exceed the tested Kubernetes ceiling once real data volumes are factored in.


| City                | Population | Complaints/Day (at 20/1k) | Available Headroom Against Degraded K8s Ceiling (~560k/day) |
| ------------------- | ---------- | ------------------------- | ----------------------------------------------------------- |
| Hyderabad / Chennai | 10M        | 200,000                   | ~2.8× — manageable with monitoring                          |
| Bengaluru           | 12M        | 300,000                   | ~1.9× — warrants pre-launch tuning                          |
| Mumbai              | 21M        | 420,000                   | ~1.3× — multi-replica configuration required                |
| Delhi               | 32M        | 640,000                   | Exceeds the tested configuration at real data volumes       |


A deployment at this scale is more appropriately framed as an architecture programme than an infrastructure procurement. Key elements not present in the tested configuration, and required at mega-metro scale:

- Kafka: 8–16 processing lanes before launch
- Application services: 2–4 replicas per bottleneck service
- Database: Aurora PostgreSQL with read replicas; partitioning strategy defined before go-live
- Archiving: intra-day processing — at 300,000 complaints/day, a nightly archiving batch cannot maintain steady active-dataset size
- Observability: distributed tracing and Kafka consumer lag monitoring per lane as baseline operational tooling
- Platform engineering capacity: 2–3 engineers permanently allocated (not shared with application development)

**Estimated infrastructure cost:** $5,000–15,000/month.
**Estimated notification cost:** $500,000–$2,000,000/year.

For cities of this scale, benchmarking the specific multi-replica, multi-lane configuration before launch is advisable — the figures from the tested configuration are not directly applicable.

---



### State-Wide Rollout

State-wide deployments in India are uniformly above the threshold at which a single server is a viable option. The planning question is which Kubernetes configuration is appropriate for the state's urban population.


| State                          | Urban Population | Est. Complaints/Day (at 20/1k) | Indicative Infrastructure Tier         |
| ------------------------------ | ---------------- | ------------------------------ | -------------------------------------- |
| Goa, Himachal Pradesh, Tripura | <5M              | <100,000                       | Kubernetes, 3–4 nodes                  |
| Punjab, Odisha                 | ~10M             | 200,000                        | Kubernetes, 4–6 nodes, 8 Kafka lanes   |
| Telangana, AP                  | 14–18M           | 280,000–360,000                | Kubernetes, 4–6 nodes, 8 Kafka lanes   |
| Rajasthan, Karnataka           | 20–25M           | 400,000–500,000                | Kubernetes, 6–10 nodes, phased rollout |
| Tamil Nadu                     | 34M              | 680,000                        | Multi-cluster architecture             |
| Maharashtra                    | 55M              | 1,100,000                      | Multi-cluster architecture             |
| Uttar Pradesh                  | 45M              | 900,000                        | Multi-cluster architecture             |


**For states in the 5–20M urban population range (Punjab, Odisha, Telangana, AP):**

- 4–6 nodes, managed database, minimum 8 Kafka partitions
- A phased ULB activation approach — activating cohorts of 20–30 ULBs, measuring actual complaint rates against projections, and adjusting before expanding — reduces the risk of underestimating aggregate load
- The active dataset reaches the throughput degradation threshold within 3–5 hours at these volumes; the archiving policy and its SLA should be defined before the first ULB goes live

**For states in the over-20M urban population range (Tamil Nadu, Maharashtra, UP, West Bengal, Karnataka, Gujarat, Bihar):**

- Multi-cluster or multi-namespace architecture, with workloads separated by division or ULB tier
- Database sharding aligned with DIGIT's multi-tenant model
- 16+ Kafka partitions
- A dedicated platform engineering team
- Rollout measured in cohorts rather than a single activation event

Deployments at Maharashtra, UP, and Tamil Nadu scale are appropriately reviewed at Secretary or Mission Director level before procurement proceeds, given the financial, architectural, and operational commitments involved.

---



## Notification Cost Planning

This budget item is often underestimated or omitted from initial programme plans. At Rs 0.13/message (bulk rate for SMS/WhatsApp), with 4 external notifications per complaint lifecycle:


| Deployment                          | Complaints/Day | External Notifications/Day | Estimated Annual Cost    |
| ----------------------------------- | -------------- | -------------------------- | ------------------------ |
| Municipal Council (150k pop)        | 3,000          | 12,000                     | ~Rs 5.7 lakh (~$7k)      |
| Small Corp (600k pop)               | 12,000         | 48,000                     | ~Rs 23 lakh (~$27k)      |
| Large Corp (2M pop)                 | 40,000         | 160,000                    | ~Rs 76 lakh (~$90k)      |
| Large Metro (10M pop)               | 200,000        | 800,000                    | ~Rs 3.8 crore (~$455k)   |
| State — Punjab / Odisha (10M urban) | 200,000        | 800,000                    | ~Rs 3.8 crore (~$455k)   |
| State — Telangana (18M urban)       | 360,000        | 1,440,000                  | ~Rs 6.8 crore (~$820k)   |
| State — Tamil Nadu (34M urban)      | 680,000        | 2,720,000                  | ~Rs 12.9 crore (~$1.55M) |


**Planning considerations:**

- Negotiated bulk rates of Rs 0.05–0.08/message are achievable at volume, which roughly halves the estimates above
- Routing notifications through in-app channels (no per-message cost) wherever technically feasible reduces the SMS/WhatsApp volume meaningfully
- Finance approval for the notification budget is most effectively sought separately from IT infrastructure procurement, as they sit in different budget heads and differ in magnitude

---



## Infrastructure Cost Reference (AWS Mumbai, on-demand, September 2026)


| Configuration                          | Monthly Cost            | Indicative Capacity                                              |
| -------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| Single server — Graviton (c7g.4xlarge) | ~$287                   | ~694,000 complaints/day (clean dataset); Nagar Panchayat pilots  |
| Single server — Intel (c6i.4xlarge)    | ~$496                   | Comparable; Graviton is 42% cheaper for equivalent spec          |
| Kubernetes, 3–4 nodes + managed DB     | ~$900–1,400             | ~1.12M complaints/day (clean dataset); small corps, small states. Includes EKS control plane, managed DB, NAT gateways, and load balancer — compute alone is ~$400–500/month |
| Kubernetes, 4–6 nodes + managed DB     | ~$1,800–3,000           | State deployments, 5–20M urban population                        |
| Kubernetes, 10–15 nodes + Aurora DB    | ~$5,000–9,000           | Large metros, large states — requires multi-replica tuning       |
| Multi-cluster architecture             | Separate quote required | Maharashtra, UP, Tamil Nadu, Delhi scale                         |


Reserved instances or savings plans reduce all figures by 30–60% for committed multi-year deployments.

---



## Data Accumulation: Planning Timelines

At Indian complaint rates, data accumulation is the fastest-acting performance constraint. Measured throughput declines by approximately 55% when the active dataset reaches 27,000 records. The following table shows how quickly each tier reaches that threshold:


| Deployment                     | Complaints/Day | Time to 27,000-Record Threshold |
| ------------------------------ | -------------- | ------------------------------- |
| Nagar Panchayat (20k pop)      | 400            | ~68 days                        |
| Municipal Council (150k pop)   | 3,000          | ~9 days                         |
| Small Corp (600k pop)          | 12,000         | ~54 hours                       |
| Large Corp (2M pop)            | 40,000         | ~16 hours                       |
| Mega Metro (10M pop)           | 200,000        | ~3 hours                        |
| State — Tamil Nadu (34M urban) | 680,000        | ~1 hour                         |


For any deployment above a Municipal Council, the archiving policy — and the tooling to execute it — should be in place and validated before the first ULB goes live. At Indian complaint rates, this is a planning prerequisite rather than a post-launch operational activity.

---



## Summary


| Tier                    | Population | Est. Complaints/Day | Indicative Option             | Notes                                                         |
| ----------------------- | ---------- | ------------------- | ----------------------------- | ------------------------------------------------------------- |
| Nagar Panchayat         | <50k       | ~400                | Single server (state tenant)  | Infrastructure decided at state level                         |
| Municipal Council       | 50k–300k   | ~3,000              | Single server                 | Archiving at launch; state platform migration at 12–18 months |
| Small Corp (standalone) | 300k–1M    | ~12,000             | Kubernetes, 3–4 nodes         | Notification costs a real budget line                         |
| Large Corp              | 1M–5M      | ~40,000             | Kubernetes, 4 nodes           | Notification costs exceed infrastructure costs                |
| Mega Metro              | 5M+        | 200,000+            | Architecture programme        | Configuration benchmarking before launch                      |
| State <5M urban         | —          | <100,000            | Kubernetes, 3–4 nodes         | —                                                             |
| State 5–20M urban       | —          | 100k–400k           | Kubernetes, 4–6 nodes, phased | Phased ULB activation advisable                               |
| State >20M urban        | —          | 400k–1M+            | Architecture programme        | Secretary / Mission Director level review                     |


For Indian deployments, the single-server option is well-suited to Nagar Panchayat-scale pilots. Above that threshold, infrastructure decisions are principally made at the state platform level, and the notification budget is typically a larger financial commitment than the infrastructure itself.

---



## Known Limitations of the Underlying Test Data


| Gap                                         | Implication for Indian Deployments                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-tenant (multi-ULB) performance        | All state deployments serve hundreds of tenants; per-request authorisation overhead at this scale was not measured                      |
| Multi-module performance                    | Indian cities typically run PGR alongside Property Tax, Trade Licence, Water & Sewerage; shared Kafka/Postgres/MDMS load was not tested |
| Kubernetes throughput at 1M+ stored records | The Kubernetes test used a 3-record dataset; throughput will degrade in line with the single-server degradation curve                   |
| Multiple replicas per service               | Tested at 1 replica per service; Kafka partition count binds before replica scaling takes effect                                        |
| 8+ Kafka partition behaviour                | Single-partition limit is confirmed; performance with 8–16 partitions has not been measured                                             |
| Negotiated notification rates               | Cost estimates above use Rs 0.13/message; negotiated bulk rates materially change the economics at scale                                |


