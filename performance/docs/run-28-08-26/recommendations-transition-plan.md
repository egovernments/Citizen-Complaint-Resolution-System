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
| 80 | 1,600–2,400 | **Highest verified level, zero errors** |
| 160 | 3,200–4,800 | Tested, but the result is not trustworthy — see below |
| 320 | 6,400–9,600 | Tested, but the result is not trustworthy — see below |

Treat the 20–30 ratio as a rule of thumb for conversation. Treat complaints per day as the number to sign up to.

---

## The Bottom Line

**The minimum supported machine is 16 vCPU / 32 GiB, and there is no smaller configuration.** The stack holds 26.8 GB of memory before it serves a single request, so a pilot and a large city need the same hardware. Sizing is not a menu.

That machine handles **694,000 complaints per day with zero errors** — 69x a 10,000/day target, and the number to plan and contract against.

Its upper limit is **not known**. Testing above that level was invalidated by a software configuration fault, not by the hardware running out. The practical read is that 694,000/day is a floor on what one machine can do, not a ceiling.

You do not need Kubernetes until you are past roughly 700,000 complaints/day, past 1M stored records, or you need the system to survive a machine failure.

---

## What One Server Handles

Measured on a live 16 vCPU / 30 GiB machine running the full 59-container stack, with no artificial limits applied.

This test machine sits marginally *below* the 32 GiB floor set out in the next section. It ran with 4.5 GB of memory to spare at rest and no swap configured — thinner headroom than a new deployment should be given, which makes the figures below conservative rather than optimistic.

| Load | Complaints/sec | **Complaints/day** | Response time | Failures |
|------|---------------|-------------------|--------------|----------|
| 20 test users | 2.081 | 179,798 | 0.34s | **0.000%** |
| 40 test users | 4.091 | 353,462 | 0.35s | **0.000%** |
| **80 test users** | **8.034** | **694,138** | **0.45s** | **0.000%** |
| 160 test users | 12.463 | 1,076,803 | 2.20s | 0.670% |
| 320 test users | 1.113 | 96,163 | 60s (timeout) | 41.12% |

The last two rows are shown for completeness but **should not be used for planning**. Both were measured while the complaints service was running out of Java memory because of a configuration limit that has nothing to do with the size of the machine. They record a misconfiguration, not capacity.

**Three numbers matter commercially:**

**Peak with zero errors — 694,138 complaints/day.** Every request succeeded, and response times stayed under half a second. This is the number to quote in a contract or an SLA.

**Under realistic arrival patterns, roughly half of complaints fail.** See [An Important Correction](#an-important-correction-real-traffic-behaves-differently) — the figures in this table were measured with test users who wait their turn, which real people do not.

**The upper limit is unknown, and that is the honest answer.** Above 80 test users the complaints service ran out of its allotted Java memory — a fixed 384 MB allowance, set in configuration, unrelated to the machine's 30 GB. Everything measured above that point describes a software fault rather than the capacity of the hardware, so no maximum can be quoted from this campaign.

**One finding from that fault is worth acting on regardless of scale.** When the service ran out of memory it did not slow down, return errors and recover. It stopped permanently: it kept accepting connections, answered none, and stayed that way for six hours until it was restarted by hand. It could not recover on its own, and nothing restarted it automatically. Any deployment should therefore assume that a memory-related failure needs human intervention, and should be monitored for "accepting requests but not answering" rather than only for crashes.

**Recommended before quoting any figure above 694,000/day:** have platform engineering raise the memory allowance and add a timeout to the message-queue call that caused the permanent hang, then re-run the ladder. Both are small changes. The full technical detail is in [When the heap gave out](./findings#when-the-heap-gave-out).

---

## Why the Same Machine Can Give Very Different Numbers

The same 16 vCPU host was tested twice: once with each service given a fixed slice of the processor, and once with the services free to share the whole machine.

| At the same load (80 test users) | Complaints/sec | Response time |
|---|---|---|
| Services capped at a fixed slice each | 1.331 | 15.31s |
| Services sharing the whole machine | **8.034** | **0.45s** |

**Six times the throughput, at one-thirty-fourth the response time — on identical hardware.**

The commercial takeaway is simple: **how the machine is configured matters more than how big the machine is.** A deployment that caps each service to a fixed allocation wastes most of the hardware it is paying for, because no service can use another's idle capacity. Confirm with the implementation team that per-service CPU limits are not set before sizing up hardware — it is free capacity.

It also means any older figure derived from a capped profile understates a real machine by roughly this factor, and none of those figures should be read as a machine size.

---

## The Hardware Floor: 16 vCPU / 32 GiB

**This is a requirement, not a recommendation.** There is no smaller supported configuration of DIGIT Complaints Management, and the docs deliberately no longer offer one.

Measured on the live deployment at rest, with no test load running at all:

| | |
|---|---|
| Memory held by the stack while idle | **26.8 GB** |
| Total machine memory | 30.6 GiB |
| Memory left available | 4.5 GB |
| Swap configured | **None** |
| Containers running | 57 |

The stack costs the same to keep running whether it serves ten complaints a day or seven hundred thousand. Below 32 GiB it does not fit in memory at all. It would have to swap, and a set of JVM services that swaps does not simply run slower — it thrashes, because the Java garbage collector periodically touches memory the operating system has paged out to disk. The system does not degrade gracefully in that state; it stops responding while consuming the whole machine.

**The commercial consequence is the important one:** a pilot needs the same hardware as a large city. The difference between a small deployment and a large one is stored data, support and operations — not machine size. Budget for the floor from day one; there is no cheaper entry point, and attempting one produces a deployment that cannot be made to work.

### Why the floor is 16 vCPU and not more

At the point where the system collapsed under test, the machine's CPU was **64% idle** at a load average of 32.6. It was not short of processor — its threads were blocked waiting on queues and database connections. Adding cores to a single machine does not lift that ceiling.

Below 16 vCPU, CPU is very much the binding constraint. The constrained-profile tests, which squeeze each service into a fixed share of the processor, show the stack failing to complete a single complaint end to end at the tightest settings. 16 vCPU is the point where processor stops being the limit, and past it more cores buy very little.

### Memory above the floor

32 GiB covers the application stack. It does **not** cover a database that has been allowed to grow on the same machine. Postgres needs memory in proportion to the data it holds, so either:

- move the database to its own server once stored complaints pass roughly 500,000, or
- add memory to the host in step with the data, and accept that the machine is now doing two jobs.

The first is strongly preferred, and is required in every configuration above one machine.

---

## Scaling Above the Floor

Because the floor is also the point at which a single machine stops being processor-bound, **scale out by adding machines of this size rather than by growing one machine.**

| Configuration | Complaints/day, zero errors | Absolute maximum | Platform |
|---|---|---|---|
| **1 × 16 vCPU / 32 GiB** | **694,000** (measured) | not established | Docker Compose |
| 2 × 16 vCPU / 32 GiB + managed database | ~1,390,000 (projected) | — | Kubernetes |
| ~15 × 16 vCPU / 32 GiB + managed database | ~10,000,000 (projected) | — | Kubernetes + re-architecture |

Only the first row is measured. Everything below it is arithmetic from that measurement, and is discussed in the next section.

### Growing one machine instead of adding machines

A single 32 vCPU / 64 GiB host is a reasonable choice when you want headroom to run **other DIGIT modules** alongside complaints, or to keep the database co-located for longer. It is **not** an effective way to buy more complaint throughput: the evidence above says the machine was queue-bound, not processor-bound, at its ceiling, so the extra cores would sit idle for the same reason the existing ones did.

If the goal is more complaints per day, the second machine is worth more than a bigger first machine.

---

## Scaling to 1 Million and 10 Million Complaints Per Day

Everything above comes from one machine. Everything in this section above one machine is **arithmetic projection, not measurement** — the node counts follow from measured per-machine throughput, but no multi-machine configuration was tested.

### 1 Million Complaints/Day

**Roughly 2 application servers at the 16 vCPU / 32 GiB floor, plus a separate database server.**

A single machine has been verified only to 694,000/day. It may well do more — its true limit was never established — but nothing above that figure has been measured cleanly, so two machines is the defensible plan for 1M/day. Running two at the verified zero-error rate covers 1M/day with capacity to spare, and lets you lose one machine without an outage.

| | |
|---|---|
| Required rate | 11.6 complaints/sec |
| Application servers | **2 × 16 vCPU / 32 GiB** |
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
| Application servers | **~15 × 16 vCPU / 32 GiB** (projected) |
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
│  Every option below starts at the same floor:
│  16 vCPU / 32 GiB. There is no smaller spec.
│
├─ Up to 694K/day ─────────► 1 × 16 vCPU / 32 GiB       ~$287–496/mo
│   │                         The same machine serves a pilot
│   │                         and a large city.
│   └─ Past 500K stored records? → move the database to its
│                                  own server, or add memory
│
├─ 694K – 1.4M/day ────────► Kubernetes, 2 app nodes    ~$900–1,400/mo
│                             of 16 vCPU / 32 GiB
│                             + managed database + archiving policy
│
└─ Beyond 1.4M/day ────────► Architecture programme, not a purchase
                              ~15 nodes at 10M/day, plus queue
                              repartitioning and data partitioning
```

---

## An Important Correction: Real Traffic Behaves Differently

Everything above was measured by holding a **fixed number of test users**, each of whom waits for their own previous complaint to finish before starting the next. That design has a hidden flaw: when the system slows down, the test automatically slows down with it. It can never overwhelm the system, because it politely waits.

Real people do not wait. They arrive when they arrive, regardless of how busy the system is.

We re-ran the same deployment with test traffic that **arrives on a fixed schedule** rather than waiting its turn. At an almost identical request rate, the results are not comparable:

| | Test users waiting their turn | Traffic arriving on schedule |
|---|---|---|
| Requests handled per second | 45.6 | 43.4 |
| Requests that failed | **0%** | **19.6%** |
| Complaints completed successfully | **100%** | **50.2%** |
| Work that never got started at all | not visible | **24%** |
| Response time | 0.9s | 6.6s |

**Half of all complaints failed, and a quarter never started**, on a system that looked flawless minutes earlier at the same request rate.

This does not mean the earlier numbers are wrong. It means they answer a narrower question — *how much work can this system get through* — and not the question that matters for a busy day, which is *what happens when people arrive faster than it can serve them.*

**Practical guidance:** treat the daily capacity figures above as an upper bound reached under ideal, evenly-paced conditions. For a deployment expecting bursts — a public announcement, a flood, a service outage generating complaints — plan on **considerably less**, and treat the response-time budget rather than the error rate as the thing that will break first.

## How Confident Are These Numbers?

Every figure in the main table came from a **single run**. Repeating the same test three times, on an identical database, shows how much a number moves purely by chance:

| Load level | Throughput varies by | Response time varies by |
|-----------|---------------------|------------------------|
| Light (40 test users) | ±1.3% | ±1.0% |
| Heavy (120 test users) | ±2.2% | **±19.2%** |

**Throughput is a reliable number. Response time near the system's limit is not** — it swings about twenty percent between identical runs. So a response-time difference of less than roughly 40% at heavy load should not be treated as real without repeating the test.

The Kubernetes deployment showed the same pattern (±20.1%) on completely different hardware, so this is a property of the software under strain rather than of any one machine.

## Before Buying Hardware, Know What the Limit Isn't

We enabled detailed database logging during a full load test. Across the entire run, **not a single complaint-related database query took longer than a tenth of a second.** The only slow operations were two periodic dashboard refreshes, unrelated to complaint traffic.

The same check on the Kubernetes deployment found processors 5-27% busy and 48 of 402 available database connections in use.

**Neither the database nor the hardware is the limit.** The constraint is inside the application. This matters commercially: **buying a bigger server or a bigger database will not raise these numbers.** The fixes identified elsewhere in this document — the configuration changes and the caching opportunities — are where the capacity is.

## Key Caveats

1. **These figures assume evenly-paced traffic.** Under a realistic arrival pattern the same deployment failed 19.6% of requests and completed only 50.2% of complaints. Treat the daily capacity figures as an upper bound, not a planning target.
2. **16 vCPU / 32 GiB is a floor, not a starting point in a range.** Earlier versions of this document offered 4 vCPU / 8 GB and 8 vCPU / 16 GB options. Those are withdrawn: the stack's resident memory footprint has roughly doubled as the platform has grown, and it no longer fits. Figures for those configurations came from capped CPU profiles rather than real machines of that size, and should not be quoted.
3. **The tested machine had 30.6 GiB, marginally under the 32 GiB floor**, and no swap. It worked, with 4.5 GB spare at rest. Treat 32 GiB as the number to provision and 30 GiB as the observed minimum that happened to hold.
4. **Everything above one machine is projection.** Node counts for 1M and 10M/day are arithmetic from measured single-machine throughput. No multi-machine configuration was tested.
5. **The tests ran against a nearly empty database** — about 2,300 stored complaints. Performance falls substantially as stored data grows, and earlier testing showed throughput dropping roughly six-fold between an empty database and 1M records. **Any deployment above 100,000 complaints/day needs an archiving policy from day one.**
6. **These numbers are complaints-only.** Running other DIGIT modules on the same machine reduces available capacity proportionally.
7. **The figures were measured without the three database fixes applied.** With them, earlier testing was 9.4x better at 100K records.
8. **The upper limit was never measured, because the software failed before the hardware did.** Above 80 test users the complaints service exhausted a fixed 384 MB Java memory allowance and stopped permanently — it kept accepting requests, answered none, and needed a manual restart six hours later. Figures above 80 test users in this document therefore describe that fault, not capacity. Size with headroom, and re-test after the configuration is corrected.
9. **Access-control filtering was introduced to complaint search between the two test rounds.** The searches in the error-based ladder carry a department and jurisdiction filter that the earlier ramp tests did not, so the two rounds are not identical conditions.
10. **Cost estimates use AWS on-demand pricing** in Mumbai (ap-south-1). Graviton (ARM) instances are around 42% cheaper than Intel equivalents. The 1M and 10M/day figures are rough order-of-magnitude only and need a proper quote.
11. **Response times include ~185ms of network round-trip** — the load generator ran over the public internet rather than on the machine itself.
