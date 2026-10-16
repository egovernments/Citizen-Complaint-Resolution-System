# Deployment Decision Guide: Single VM vs Kubernetes — African Cities

**Who this is for:** Programme directors, city managers, government IT leads, and procurement teams evaluating how to deploy the Citizen Complaint Resolution System.

**What this covers:** When a single server is the right choice, when to move to Kubernetes (K8s), and what drives the decision in African cities.

---

## The Short Answer

Most African cities can **start on a single server and stay there** for 3–10 years. Kubernetes is an upgrade to do when there is a specific uptime requirement or when the deployment grows to metro scale and complaints become very high-volume.

---

## Volume Assumptions by City Tier

These figures assume **5 complaints per 1,000 residents per day** — a realistic rate for an early-to-growing rollout. Mature deployments may reach 10/1,000/day; adjust headroom accordingly.


| City Type          | Population          | Example Cities                                                                          | Complaints/Day |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------- | -------------- |
| **Small ULB**      | 10,000–100,000      | Chókwè (MZ), Inhambane (MZ), Narok (KE), Bomet (KE)                                     | 50–500         |
| **Mid-sized City** | 100,000–1,000,000   | Nampula (MZ), Quelimane (MZ), Kisumu (KE), Blantyre (MW), Tamale (GH)                   | 500–5,000      |
| **Large Metro**    | 1,000,000–5,000,000 | Nairobi (KE), Accra (GH), Lusaka (ZM), Harare (ZW), Maputo metro (MZ), Addis Ababa (ET) | 5,000–25,000   |
| **Major Metro**    | 5,000,000+          | Lagos (NG), Kinshasa (CD), Johannesburg (ZA)                                            | 25,000–75,000  |


---



## Decision Tree

```
START HERE
│
▼
Does the government mandate 99.9%+ uptime (e.g. formal SLA
with penalties, or 24/7 emergency services mandate)?
│
├── YES → Kubernetes from day one (2 nodes minimum, ~$900–1,400/month)
│
└── NO
    │
    ▼
    Is the city population above 3 million AND
    expected adoption above 5 complaints/1,000 residents/day?
    │
    ├── YES → Kubernetes from day one
    │
    └── NO → Single Server ($287–496/month)
               │
               Monitor monthly. Move to Kubernetes when ANY of these hit:
               │
               ├─ Active complaint records exceed 500,000 AND
               │  growing by more than 1,000 per day
               │
               ├─ Complaints per day exceed 400,000
               │
               ├─ More than 60 staff/citizens online simultaneously
               │  at peak (roughly 1,200–1,800 real users at once)
               │
               ├─ A second government module added (e.g. property tax,
               │  water billing) to the same system
               │
               └─ Spike events (floods, protests, outages) are causing
                  visible complaint failures or system slowdowns
```

**Start planning a Kubernetes migration 3–6 months before you expect to hit any trigger above.**

---

## City-by-City Guidance

### Small ULB — Stay on Single Server

**Who:** Any city below 100,000 people (Chókwè, Inhambane, Narok, Bomet, and similar)

**Why a single server is enough:** At 500 complaints/day, the server can handle ~1,000 times your daily load at steady traffic. The server reaches problematic data volumes (1 million stored records) only after roughly 5.5 years — and even then, archiving old resolved complaints keeps it running cleanly.

**What you pay:** ~$287/month (AWS Graviton) — the same machine serves a 10,000-person town and a 100,000-person town.

**What actually puts you at risk:**

- A power cut or disk failure takes the whole system offline (no backup machine)
- A software misconfiguration can crash the system and require manual restart

**When to reconsider:** Only government introduces a formal uptime SLA (e.g. penalties for being offline more than 4 hours/month). 

---

### Mid-sized City — Single Server, Plan for Database Separation

**Who:** Nampula, Quelimane, Kisumu, Blantyre, Tamale, and similar (100,000–1,000,000 people)

**Why a single server works initially:**
At 2,500 complaints/day (Nampula at 500,000 people), the server can handle roughly 200 times your peak demand. You are not constrained by processing power.

**The real issue:** Data accumulation. At this complaint rate, the system's database reaches a volume where queries slow down noticeably within 2–3 weeks of launch. This is managed by archiving old resolved complaints — not by upgrading hardware.

**Warning:** On a busy day following an incident or public announcement, roughly half of complaints may experience delays under realistic arrival patterns. This is the most important operational risk at this tier.

**Timeline:**


| When                   | What to do                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before go-live         | Single server, 16 vCPU / 32 GB RAM. Set up automated archiving of resolved complaints older than 12 months.                                                 |
| 2–3 weeks after launch | Check database query speeds. Verify archiving is running.                                                                                                   |
| 12–18 months           | Move the database to a separate managed server. Application server stays the same. This is also when to migrate to K8s if uptime requirements have changed. |
| 24–36 months           | Active dataset management: keep resolved old complaints archived so active records stay under 50,000.                                                       |


**Cost:** $287/month (server) + ~$150–300/month (managed database, from month 12).

**When to move to K8s:** A formal HA or uptime mandate is the most likely reason — not complaint volume.

---



### Large Metro — Start on Single Server, Plan K8s Migration

**Who:** Nairobi, Accra, Lusaka, Harare, Maputo metro area, Addis Ababa (1–5 million people)

**Why you start on a single server:**
If budget is the primary constraint at launch, the single server handles the load: 15,000 complaints/day on a Lusaka or Accra rollout is still well within single-server capacity. However, you are operating a degraded system almost immediately because data accumulates fast enough (27,000 stored records within 2 days) to slow query performance.

**Why you plan for K8s from the start:**

- A flood, protest, or government announcement creates complaint spikes where a single-server deployment shows visible failures
- By month 12–18, adoption growth and data volume make the K8s migration worthwhile
- The political cost of the system being unavailable in a city of 3 million people is high

**Timeline:**


| Phase                 | Timing      | What happens                                                                                         |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| Launch                | Month 0     | Single server (16 vCPU / 32 GB). Archiving live from week 2.                                         |
| Database separation   | Month 2–3   | Database moved to its own managed instance. Most important step before K8s.                          |
| Archiving operational | Month 3–6   | Resolved complaints older than 6 months archived automatically. Target: under 50,000 active records. |
| K8s preparation       | Month 6–9   | Technical team prepares Kubernetes manifests; Kafka topics reconfigured.                             |
| K8s migration         | Month 12–18 | 2-node cluster ($900–1,400/month). Old server runs in parallel for 2 weeks.                          |


**Cost:** ~$287/month at launch → ~$900–1,400/month after K8s migration.

---



### Major Metro — Kubernetes from Day One

**Who:** Lagos, Kinshasa, Johannesburg, Dar es Salaam (5 million+ people)

**Why there is no single-server phase:**
At even 2 complaints per 1,000 residents per day, a 10 million-person metro generates 20,000 complaints/day. The database degrades to 55% throughput within 32 hours of launch. A single server going offline in a city of this size has immediate reputational and political consequences.

**Starting configuration:**

- 2-node Kubernetes cluster (each node: 16 vCPU / 32 GB RAM)
- Separate managed database (never co-located with application servers at this scale)
- Kafka message broker configured with at least 3–5 processing lanes

**Non-negotiables before launch:**

1. Kafka configured with multiple processing lanes (default single-lane configuration is a hard ceiling that adding servers cannot overcome)
2. Database archiving policy designed and operational before go-live — not deferred
3. JVM memory settings corrected on all services (shipped default causes crashes under sustained load)
4. Liveness probes reconfigured (shipped 3-second timeout kills healthy servers under normal metro load)

**Cost:** ~$900–1,400/month. Scales as adoption grows.

---



## What Determines the Decision — Summary Table


| City Type      | Population | Complaints/Day | Start With           | Move to K8s When                                      |
| -------------- | ---------- | -------------- | -------------------- | ----------------------------------------------------- |
| Small ULB      | <100,000   | 50–500         | Single server        | Formal uptime SLA only                                |
| Mid-sized City | 100k–1M    | 500–5,000      | Single server        | Uptime mandate, or complaints approaching 400,000/day |
| Large Metro    | 1M–5M      | 5,000–25,000   | Single server        | Month 12–18, or uptime mandate, or spike failures     |
| Major Metro    | 5M+        | 25,000–75,000  | **K8s from day one** | Already on K8s                                        |


---



## Cost Reference (AWS, on-demand pricing, September 2026)


| Setup                                  | Monthly Cost   | Handles Up To                                         |
| -------------------------------------- | -------------- | ----------------------------------------------------- |
| Single server (Graviton — recommended) | ~$287          | Up to ~700,000 complaints/day, no redundancy          |
| Single server (Intel)                  | ~$496          | Same; Graviton preferred                              |
| K8s, 2-node cluster                    | ~$900–1,400    | Up to ~1.1M complaints/day, with redundancy           |
| K8s, ~15-node cluster                  | ~$8,000–15,000 | ~10M complaints/day (requires system re-architecture) |


**The single server costs the same for a 10,000-person pilot as for the largest city it can serve.** The Kubernetes investment is driven by uptime requirements and adoption growth, not by trying to save money at small scale.

---



## The One Thing That Affects Every Tier: Data Archiving

This is not a technical detail — it is the most important operational policy decision for any deployment above a small ULB.

The system slows down predictably as complaint records accumulate. At 27,000 stored records, performance drops by 55%. Here is how fast each city reaches that number:


| Complaints/Day                          | Days to Slowdown Threshold (27,000 records) |
| --------------------------------------- | ------------------------------------------- |
| 500/day (mid-city, low adoption)        | 54 days                                     |
| 2,500/day (mid-city, moderate adoption) | 11 days                                     |
| 10,000/day (large metro)                | 3 days                                      |
| 50,000/day (major metro)                | 13 hours                                    |


**The fix is simple:** Archive resolved complaints older than 6–12 months to a read-only store. This is cheaper and more effective than any hardware upgrade. For any city above a small ULB, this policy must be in place and operational before the system goes live.

---



## The Bottom Line

For the vast majority of African ULBs and cities, the **single server is not a temporary stepping stone — it is the right production platform for 3–10 years**. Kubernetes is the right choice for cities with formal uptime guarantees, major metros where a single server failure carries political risk, or cities that grow beyond 400,000 complaints/day.

The risks that actually affect small and mid-sized deployments are operational: correct memory settings, data archiving, and knowing what to do when the server restarts. Fix those, and the system will serve your city reliably without a Kubernetes migration.