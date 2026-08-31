# DIGIT Complaints Management on Kubernetes: What This Deployment Handles

**Audience:** GTM / Solutions / Implementation / Commercial teams
**Source:** Load test results from September 2026 against a DIGIT Complaints Management deployment on AWS EKS

---

## How to Read This Document

**One "complaint lifecycle"** is a complaint filed, routed to a department, resolved, and then checked by the citizen. It is the unit everything below is measured in. One lifecycle is four calls to the system.

**Plan on complaints per day.** It is measured directly, it needs no translation, and it is the number a city can forecast from its own population and service history.

**Concurrent users** means people actively filing or checking complaints at the same moment — not people logged in. Our tests use "test users", each filing complaints back-to-back with barely a pause. Real people spend most of their session reading and navigating. The working conversion:

> **1 test user ≈ 20–30 real people online at the same time**

| Test Users | Real People Online | What This Represents |
|------------|-------------------|---------------------|
| 20 | 400–600 | Small ULB |
| 80 | 1,600–2,400 | Medium city |
| 160 | 3,200–4,800 | Large city |
| 320 | 6,400–9,600 | **Highest level tested — still zero failures** |

---

## The Bottom Line

**Nothing failed.** The deployment was pushed to 320 test users — the equivalent of six to nine thousand people using it simultaneously — and answered **every single request successfully**. We did not find its breaking point, because it did not break.

What it does instead is slow down. Past roughly 160–200 test users the system is at capacity, and further load turns into waiting rather than more work done. At the highest level tested, every complaint still went through, but responses took around 11 seconds.

So there are two different limits, and which one matters depends on the promise being made:

- **If the promise is "it works":** there is headroom beyond anything we tested.
- **If the promise is "it responds quickly":** that limit arrives much earlier, and long before any error appears.

---

## What This Deployment Handles

Measured on a 4-machine Kubernetes cluster with one copy of each service running.

| Load | Complaints/sec | **Complaints/day** | Response time | Failures |
|------|---------------|-------------------|--------------|----------|
| 20 test users | 2.218 | 191,635 | 0.36s | **0.000%** |
| 40 test users | 4.532 | 391,565 | 0.16s | **0.000%** |
| 80 test users | 8.810 | 761,184 | 0.20s | **0.000%** |
| **160 test users** | **16.259** | **1,404,778** | **0.67s** | 0.268% |
| 120 test users | 7.939 | 685,930 | 3.19s | **0.000%** |
| 160 test users | 7.842 | 677,549 | 5.25s | **0.000%** |
| 200 test users | 10.549 | 911,434 | 4.67s | 0.017% |
| 240 test users | 9.714 | 839,290 | 7.41s | **0.000%** |
| 280 test users | 8.983 | 776,131 | 9.59s | **0.000%** |
| 320 test users | 7.948 | 686,707 | 11.45s | **0.000%** |

**An important caveat on this table.** No two rows were measured against the same amount of stored data. The testing itself grew the database from about 200 complaints to roughly 21,000, and stored data is the single biggest influence on speed in every test we have run. The 120 and 160 user rows were measured *last*, against the most data, which is why they look slower than the 200 user row despite being a lighter load. Rows measured close together in time can be compared; rows far apart cannot.

**Two numbers worth carrying into a conversation:**

**Comfortable operation — around 760,000 complaints/day** at 80 test users, with responses under a quarter of a second and no failures. This is the figure to quote where response time matters.

**Everything succeeds, at any level we tested.** At 320 test users the deployment still completed every complaint. That is a strong reliability story and a weak speed story, and it should be presented as both.

---

## Where the Limit Actually Is

The deployment does not have a failure point in the range we tested. It has a **speed ceiling**, and it is already past that ceiling at every level we measured with the settling step in place.

Comparing levels tested close together — the only fair comparison, given the growing database — adding users always costs work and adds waiting:

| Going from | To | Work completed | Response time |
|---|---|---|---|
| 120 users | 160 users | **−0.3%** | **+65%** |
| 200 users | 240 users | −7.0% | +59% |
| 240 users | 280 users | −6.5% | +29% |
| 280 users | 320 users | −10.5% | +19% |

The first row is the clearest signal. Going from 120 to 160 users produced **no additional work at all** — throughput was flat to within a third of a percent — while people waited two-thirds longer. That is a system at capacity.

**This means the deployment is already saturated at 120 test users**, the lowest level we tested this way, and its best operating point is somewhere below that. We did not measure it.

The practical implication is that **capacity planning here should be driven by an acceptable response time, not by an error budget.** An error budget would never trigger.

---

## Before Adding Hardware: Two Things to Fix

Both cost nothing in infrastructure and both were necessary to get the results above.

**1. The services are told to use a quarter of the memory they already have.** Every service in the complaint path is configured with a memory allowance of roughly a quarter of what its container reserves. The memory is allocated and paid for regardless. We raised this before testing; without it the results above would not hold. This is a configuration change, not a purchase — see [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934).

**2. A memory shortage currently takes a service offline silently.** When one of these services runs out of memory it does not crash and restart — it keeps accepting requests and answers none of them, while health checks continue reporting green. On another deployment this took complaint filing offline for six hours before anyone noticed. A one-line setting converts it into a clean restart that recovers in seconds — see [issue #1929](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1929).

**Neither is optional if this deployment is expected to carry real load.**

---

## One Defect Worth Knowing About

Under sustained load with a backlog already built up, the system can reject a complaint being closed with an error meaning *"that step isn't valid right now"* — because the previous step had not finished being recorded yet.

In our testing this was dramatic when it happened: one run failed 57% of requests. But it only occurred when the system had been pushed hard **without being allowed to catch up first**. Repeating the identical test from a settled start produced zero failures.

For a live deployment this means: after a sustained traffic spike, the system needs a little time to catch up, and complaints closed very quickly after being assigned may be rejected during that window. It is a real fault rather than a testing artefact, and the underlying cause is that the complaint history is written in the background rather than immediately.

---

## Key Caveats

1. **These figures are not from the shipped configuration.** The memory settings described above were changed before testing and reverted afterwards. On the shipped settings the results would be worse, and a memory shortage would take services offline rather than restarting them.
2. **One copy of each service was running.** The cluster has four machines but a single instance of each complaints service, so these numbers describe one instance. Running more copies is the obvious next step and was not tested.
3. **Stored data grew ninety-fold during the campaign**, from about 200 complaints to nearly 18,000, which is why levels measured hours apart are not comparable.
4. **The database was small throughout.** Even 18,000 complaints is a small deployment. Earlier testing on other environments showed throughput falling substantially between an empty database and one million records, so any deployment expecting high volume needs an archiving policy from the start.
5. **These numbers are complaints-only.** Running other DIGIT modules on the same cluster reduces available capacity.
6. **The highest level tested was 320 test users, and nothing failed at any level.** The deployment's failure point is unknown because we never reached it. Its *best* operating point is also unknown, for the opposite reason — we never tested below 120 users with the settling step, and it was already saturated there.
7. **Response times include about 24 milliseconds of network round-trip.** The load generator ran in the same region as the cluster.
