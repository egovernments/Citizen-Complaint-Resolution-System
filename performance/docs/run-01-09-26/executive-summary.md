# Executive Summary

A Kubernetes deployment of DIGIT PGR on AWS EKS sustained **320 concurrent test users with zero failed requests**. No error ceiling was found at any level tested. Load is absorbed as latency rather than as failure.

## Key Numbers

| | Value |
|-|-------|
| Highest level tested | **320 VU** |
| HTTP failures at 240, 280 and 320 VU | **0.000%** |
| Lifecycle success at 240, 280 and 320 VU | **100.00%** |
| Error-based ceiling | **Not found** |
| Peak throughput observed | 16.259 lifecycles/sec (66.33 API req/s) at 160 VU, against ~7,000 records |
| Saturation point | **At or below 120 VU** |
| Response time at 320 VU | 11.5s p95 |
| Pod restarts, closed-loop levels | **0** |
| Pod restarts, open-loop on shipped heap | **1** (liveness probe, not OOM) |
| Run-to-run variance at a fixed level | **6.9%** throughput, **20.1%** p95 |
| Records in database | 195 at start, 19,433 at end |

## What We Tested

Every test iteration runs one complete PGR complaint lifecycle — **4 API calls** through the full stack:

**CREATE** (file complaint) → **ASSIGN** (route to department) → **RESOLVE** (close it) → **SEARCH** (verify status)

This exercises the gateway, PGR Services, Workflow, Persister, Kafka and PostgreSQL — the entire hot path. Eight concurrency levels were tested — 20, 40, 80, 160, 200, 240, 280 and 320 VUs — each held at a constant VU count for 2 minutes.

**No CPU limits are set on any service in this deployment**, so every level is unthrottled by construction. There is no throttled comparison in this run because there is nothing to throttle.

Throughout this document, **lifecycle success** is the share of lifecycles that completed all four steps and ended in `RESOLVED`, while **request fail** is the share of individual HTTP requests that errored. They have different denominators — roughly four requests per lifecycle — so they do not sum to 100.

## Capacity

| VU | Throughput | API req/s | Daily capacity | Server p95 | Lifecycle success | Request fail |
|-----|-----------|-----------|---------------|-----------|---------|--------------|
| 20 | 2.218/s | 9.03 | 191,635/day | 357ms | 100.00% | 0.000% |
| 40 | 4.532/s | 18.44 | 391,565/day | 164ms | 100.00% | 0.000% |
| 80 | 8.810/s | 35.85 | 761,184/day | 203ms | 100.00% | 0.000% |
| **160** | **16.259/s** | **66.33** | **1,404,778/day** | 669ms | 99.57% | 0.268% |
| 120 | 7.939/s | 32.67 | 685,930/day | 3,188ms | **100.00%** | **0.000%** |
| 160 | 7.842/s | 32.56 | 677,549/day | 5,254ms | **100.00%** | **0.000%** |
| 200 | 10.549/s | 43.69 | 911,434/day | 4,667ms | 99.93% | 0.017% |
| 240 | 9.714/s | 40.63 | 839,290/day | 7,405ms | **100.00%** | **0.000%** |
| 280 | 8.983/s | 37.97 | 776,131/day | 9,589ms | **100.00%** | **0.000%** |
| 320 | 7.948/s | 34.00 | 686,707/day | 11,454ms | **100.00%** | **0.000%** |

**No two levels here ran against the same database.** The campaign grew stored records from 195 to 19,433, monotonically in run order — and the 120 and 160 VU levels were run *last*, against 17,337 and 18,381 records respectively. That is why the series is not monotonic in VU order. Only levels run adjacent in time are comparable; the full curve with per-level record counts is in [Findings](./findings#results).

## Where the Limit Is

**There is no error-based limit below 320 VU.** Across 240, 280 and 320 VU — 15,636 requests — not one returned an error and every lifecycle reached `RESOLVED`. Adding the 120 and 160 VU levels brings that to 24,300 requests with zero failures.

The limit that does exist is a **throughput limit**, and the deployment is past it at every level in the gated series. Comparing levels run adjacent in time — the only fair comparison available — additional concurrency always costs throughput and adds latency:

| Pair | Throughput | Response time |
|------|-----------|---------------|
| 120 → 160 VU | **−0.3%** | **+65%** |
| 200 → 240 VU | −7.0% | +59% |
| 240 → 280 VU | −6.5% | +29% |
| 280 → 320 VU | −10.5% | +19% |

The 120 → 160 pair is the clearest: throughput flat to within 0.3%, latency up two-thirds. **The deployment is already saturated at 120 VU**, the lowest level tested with the gate, so its peak sits below that and was not measured.

**One correction from the variance data.** Three repeats of an identical level show a 12.1% peak-to-trough spread in throughput. Every throughput figure in the table above is a smaller change than that, so the throughput column carries no signal — an earlier version of this document described those steps as costing "8-11% of throughput" each, and that reading is withdrawn. The saturation conclusion rests on the latency rises of +65% and +59%, which exceed the 36.6% spread in p95; the +29% and +19% do not.

Which limit matters depends on what you are protecting. If the requirement is that requests succeed, this deployment has headroom beyond anything tested. If the requirement is a response-time budget, it is exceeded well before any error appears — 320 VU answers every request, but takes 11.5 seconds at p95 to do it.

## Stability

**Zero pod restarts across fourteen load levels and 19,238 complaints.**

That result depends on a change made for the test. Every service in the complaint path ships with a JVM heap of `-Xmx192m` inside a container reserving 768Mi — roughly a quarter of the memory already allocated to it. The heap was raised to ~58% of each container's limit for this campaign, and `-XX:+ExitOnOutOfMemoryError` added, before any load was applied.

**On the shipped configuration these results would not hold.** The durable fix belongs in the deployment charts — see [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934).

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
