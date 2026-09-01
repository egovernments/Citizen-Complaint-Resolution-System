# Executive Summary

A Kubernetes deployment of DIGIT PGR on AWS EKS sustained **200 concurrent test users with zero failed requests**, peaking at **1.12 million complaints per day**. No error ceiling was found. The limit is a throughput plateau, and it is reached while the service doing the work stays well below one of its four available cores.

## Key Numbers

| | Value |
|-|-------|
| **Peak throughput** | **12.989 lifecycles/sec (53.49 API req/s)** |
| **Daily capacity at peak** | **1,122,250 complaints/day** |
| **Saturation point** | **160 VU** |
| Request failures, every level | **0.000%** |
| Lifecycle success, every level | **100.00%** |
| **Intended work never started, open-loop** | **48.6%** |
| Response time at peak | 1.8s p95 at 160 VU, 3.2s at 200 VU |
| Pod restarts | **0** across the whole ladder |
| Run-to-run variance | 6.7% throughput, 51% p95 |
| Peak CPU, five sampled services | 3,383m of 16,000m (~3.4 of 16 cores) |
| Dataset | fixed at 3 complaints for every level |

The 0.000% failure rate is a closed-loop result. Under an open-loop test that holds the arrival rate regardless of server speed, **48.6% of the offered work could not be started** — see [Open-Loop Testing Changes the Picture](#open-loop-testing-changes-the-picture). That is the figure to use for capacity planning.

## What We Tested

Every test iteration runs one complete PGR complaint lifecycle — **4 API calls** through the full stack:

**CREATE** (file complaint) → **ASSIGN** (route to department) → **RESOLVE** (close it) → **SEARCH** (verify status)

This exercises the gateway, PGR Services, Workflow, Persister, Kafka and PostgreSQL — the entire hot path. Five concurrency levels were tested — 40, 80, 120, 160 and 200 VUs — each held at a constant VU count for 2 minutes, on the **shipped configuration**.

**No CPU limits are set on any service in this deployment**, so every level is unthrottled by construction.

**Every level ran against an identical database.** A gated cleanup between levels restored the dataset to exactly 3 complaints, so no level inherited the previous one's rows. This matters: stored data turned out to be the largest single influence on throughput measured anywhere in the campaign.

Throughout this document, **lifecycle success** is the share of lifecycles that completed all four steps and ended in `RESOLVED`, while **request fail** is the share of individual HTTP requests that errored. They have different denominators — roughly four requests per lifecycle — so they do not sum to 100.

## Capacity

| VU | Throughput | API req/s | Daily capacity | Server p95 | Lifecycle success | Request fail |
|-----|-----------|-----------|---------------|-----------|---------|--------------|
| 40 | 4.213/s | 17.16 | 364,003/day | 787ms | 100.00% | 0.000% |
| 80 | 8.050/s | 32.82 | 695,520/day | 828ms | 100.00% | 0.000% |
| 120 | 11.777/s | 48.03 | 1,017,533/day | 855ms | 100.00% | 0.000% |
| **160** | **12.894/s** | **52.79** | **1,114,042/day** | 1,816ms | **100.00%** | **0.000%** |
| 200 | 12.989/s | 53.49 | 1,122,250/day | 3,170ms | 100.00% | 0.000% |

The 120 VU row is the mean of three repeats.

## Where the Limit Is

**There is no error-based limit.** Not one request failed at any level, and every lifecycle completed.

The limit is a **throughput plateau at ~53 API req/s**, reached at 160 VU:

| Step | Throughput gain | Verdict |
|------|----------------|---------|
| 40 → 80 | +91.3% | near-linear |
| 80 → 120 | +46.3% | linear |
| 120 → 160 | +9.9% | bending |
| **160 → 200** | **+1.3%** | **flat — inside the 6.7% noise floor** |

Past 160 VU the deployment gains nothing from additional users, while latency rises 75%.

**The plateau is not an infrastructure limit.** `pgr-services` CPU stayed flat at ~0.9 of a core across every level on a 4-core node with no limit set — a service that is CPU-bound climbs, and this one does not. The ceiling is a concurrency limit inside the application, not a shortage of hardware.

## Stability

**Zero pod restarts across the whole ladder, on the shipped configuration.**

The one restart in the campaign came from open-loop testing, not from this ladder — see below.

Separately worth knowing: every service in the complaint path ships with a JVM heap of `-Xmx192m` inside a container reserving 768Mi — roughly a quarter of the memory already allocated to it. That did not limit the closed-loop results, but it decided how the deployment behaved under open-loop overload. See [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934).

## Open-Loop Testing Changes the Picture

Every closed-loop figure above comes from a test where virtual users cannot start new work until their previous work finishes — so the offered load is whatever the server allows. Running the same cluster with a `ramping-arrival-rate` executor, which holds the arrival rate regardless of server speed, gives a very different reading:

| | Shipped heap | Raised heap |
|---|---|---|
| **Intended work never started** | **48.6%** (3,899 dropped) | **55.2%** (4,390 dropped) |
| Request fail | **3.79%** | **0.000%** |
| Lifecycle success | **89.71%** | **100.00%** |
| Pod restarts | **1 — liveness probe** | **0** |

**Roughly half the offered work never started.** The closed-loop ladder reported 0.000% failures at every level; both statements are accurate, and they answer different questions. Closed-loop measures what the system will accept. Open-loop measures what happens when demand does not wait its turn — which is how real traffic arrives.

The heap setting did not change throughput (3.9% apart, inside the noise floor). It changed **how overload fails**: on shipped settings the deployment was restarted by its own liveness probe after `/health` exceeded the 3-second timeout six times running; on raised settings it queued and stayed up.

## Stored Data Is the Biggest Single Factor

Because the ladder holds the dataset fixed, the cost of stored data can be read separately. The same 120 VU level, measured at three database sizes during this campaign:

| Records | Lifecycles/s | Relative |
|---|---|---|
| 3 | **11.777** | baseline |
| 17,337 | 7.939 | **−33%** |
| ~27,000 | 5.277 | **−55%** |

Twenty-seven thousand complaints is a trivial database by production standards, and it had already more than halved throughput — an effect roughly eight times the 6.7% measurement noise. **The headline capacity figures are for an effectively empty database and should be read as an upper bound.** Any deployment expecting sustained volume needs an archiving policy from the start; it is cheaper than hardware and has a larger effect.

## The Most Useful Finding

An earlier pass ran the same levels back to back without waiting for the system to drain. At 320 VU it recorded **56.95% request failures and 1.14% lifecycle success**. The gated pass at the identical level recorded **0.000% and 100.00%**.

Every one of those failures was `INVALID ACTION` — the workflow service refusing a `RESOLVE` because the preceding `ASSIGN` had not yet been committed. PGR writes workflow transitions asynchronously, so a `200` on `ASSIGN` means *accepted and queued*, not *committed*. On a deployment already carrying a backlog, that window widens past the client's own pacing and `RESOLVE` overtakes its own `ASSIGN`.

Two conclusions follow. For operators, this is a real defect that any client issuing two rapid workflow transitions can hit on a backlogged deployment. For anyone running these tests, a ladder without a drain gate measures the accumulated state of its earlier levels, and its numbers will not reproduce.

## Test Infrastructure

| Component | Spec |
|-----------|------|
| Platform | AWS EKS v1.35.6, 4 × m5a.xlarge |
| Cluster total | 16 vCPU, 64 GB RAM, shared across all namespaces |
| Application namespace | `egov`, 36 pods |
| Replicas, complaint path | 1 per service |
| CPU limits | **None set** |
| Database | Amazon RDS PostgreSQL, separate from the application nodes |
| Message broker | Kafka (KRaft), 3 controllers, all PGR topics single-partition |
| Load generator | k6, remote control machine, ~24ms RTT |

See [Detailed Findings](./findings) for methodology, the drain gate, and the full degradation curve.
