# DIGIT Complaints Management on Kubernetes: What This Deployment Handles

**Audience:** GTM / Solutions / Implementation / Commercial teams
**Source:** Load test results from September 2026 against a DIGIT Complaints Management deployment on AWS EKS

---

## How to Read This Document

**One "complaint lifecycle"** is a complaint filed, routed to a department, resolved, and then checked by the citizen. It is the unit everything below is measured in.

**Plan on complaints per day.** It is measured directly, needs no translation, and is the number a city can forecast from its own population and service history.

**Concurrent users** means people actively filing or checking complaints at the same moment — not people logged in. Our tests use "test users", each working continuously with barely a pause. Real people spend most of their time reading and navigating. The working conversion:

> **1 test user ≈ 20–30 real people online at the same time**

| Test Users | Real People Online | What This Represents |
|------------|-------------------|---------------------|
| 40 | 800–1,200 | Small city |
| 80 | 1,600–2,400 | Medium city |
| 120 | 2,400–3,600 | Large city |
| 160 | 3,200–4,800 | **Best performance — the sweet spot** |
| 200 | 4,000–6,000 | Beyond the sweet spot: no faster, just slower |

---

## The Bottom Line

**This deployment handles roughly 1.1 million complaints a day, and nothing failed at any level we tested.**

Every single request succeeded — no errors, no crashes, no restarts — across every level from 800 to 6,000 simultaneous users. That is a strong reliability result and it should be stated plainly. It comes from tests where users pace themselves; under demand arriving on a fixed schedule the picture changes, and that belongs in the same conversation — see [What This Looks Like Under Real Traffic](#what-this-looks-like-under-real-traffic).

The system does have a limit, but it is a **speed limit, not a breaking point**. Past roughly 3,200–4,800 real users the system stops going faster and simply starts taking longer to answer. It never falls over.

**The most important thing in this document is not a capacity number.** It is that the amount of stored data matters more than anything else — see [What Slows It Down Most](#what-slows-it-down-most).

---

## What This Deployment Handles

Measured on a 4-machine Kubernetes cluster with one copy of each service running, on the standard shipped settings.

| Load | Real people (approx.) | **Complaints/day** | Response time | Failures |
|------|----------------------|-------------------|--------------|----------|
| 40 test users | 800–1,200 | 364,000 | 0.8s | **none** |
| 80 test users | 1,600–2,400 | 696,000 | 0.8s | **none** |
| 120 test users | 2,400–3,600 | 1,018,000 | 0.9s | **none** |
| **160 test users** | **3,200–4,800** | **1,114,000** | **1.8s** | **none** |
| 200 test users | 4,000–6,000 | 1,122,000 | 3.2s | **none** |

**Two numbers to carry into a conversation:**

**Comfortable operation — about 1 million complaints/day** at 120 test users, with responses under a second and no failures. This is the figure to quote where response time matters.

**Maximum — about 1.1 million complaints/day.** Going beyond 160 test users buys almost nothing: the last step added 1% more work while making people wait nearly twice as long.

---

## Where the Limit Actually Is

The deployment has no failure point in the range we tested. It has a **speed ceiling**, and it reaches it at around 160 test users.

| Going from | To | Extra work done | Response time |
|---|---|---|---|
| 40 users | 80 users | **+91%** | unchanged |
| 80 users | 120 users | **+46%** | unchanged |
| 120 users | 160 users | +10% | doubles |
| **160 users** | **200 users** | **+1%** | **+75%** |

Up to about 120 test users the system scales almost perfectly — double the users, nearly double the work. After 160 it stops scaling entirely.

**The ceiling is not a hardware shortage.** At full load the servers were only 5–27% busy, the database was using an eighth of its available connections, and no database query was slow. The limit is inside the application software, not in the machines it runs on — which means **buying bigger servers would not raise it**.

---

## What Slows It Down Most

Not the number of users. **The number of complaints already stored.**

We measured the same load against three different database sizes:

| Complaints already stored | Work completed | Change |
|---|---|---|
| Effectively empty | 11.8/sec | — |
| 17,000 | 7.9/sec | **−33%** |
| 27,000 | 5.3/sec | **−55%** |

Twenty-seven thousand complaints is a very small database — a busy city would pass that in weeks — and it had already **more than halved** throughput.

**This is the single most important planning point in this document.** The capacity figures above were measured on an empty database, so they are a best case. Any deployment expecting real volume needs a policy for archiving old complaints from day one. It costs nothing and does more than any hardware upgrade.

---

## Before Adding Hardware: Two Things to Fix

Both cost nothing in infrastructure.

**1. The services are told to use a quarter of the memory they already have.** Every service in the complaint path is configured with a memory allowance of roughly a quarter of what its container reserves. The memory is allocated and paid for regardless. It did not limit the results above, but it decided how the system behaved when deliberately overloaded — with it raised, the system slowed down; without it, the complaints service was restarted by its own health check. This is a configuration change, not a purchase — see [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934).

**2. A memory shortage currently takes a service offline silently.** When one of these services runs out of memory it does not crash and restart — it keeps accepting requests and answers none of them, while health checks continue reporting green. On another deployment this took complaint filing offline for six hours before anyone noticed. A one-line setting converts it into a clean restart that recovers in seconds — see [issue #1929](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1929).

**Neither is optional if this deployment is expected to carry real load.**

---

## One Defect Worth Knowing About

Under sustained load with a backlog already built up, the system can reject a complaint being closed with an error meaning *"that step isn't valid right now"* — because the previous step had not finished being recorded yet.

In our testing this was dramatic when it happened: one run failed 57% of requests. But it only occurred when the system had been pushed hard **without being allowed to catch up first**. Repeating the identical test from a settled start produced zero failures.

For a live deployment this means: after a sustained traffic spike, the system needs a little time to catch up, and complaints closed very quickly after being assigned may be rejected during that window. It is a real fault rather than a testing artefact, and the underlying cause is that the complaint history is written in the background rather than immediately.

---

## What This Looks Like Under Real Traffic

Every figure above comes from a test where each simulated user waits for their previous request to come back before starting the next one. The system therefore sets its own pace: it is never asked for more than it is already managing.

Real traffic does not work that way. People arrive when they arrive. We repeated the test with demand arriving on a fixed schedule regardless of how fast the system was answering, and the picture is considerably less comfortable:

| | Users wait their turn | Demand arrives on a schedule |
|---|---|---|
| Intended complaints that never got started | none | **48.6%** |
| Requests that failed | none | 3.8% |
| Complaints that completed successfully | 100% | 89.7% |
| Response time | 1.8 seconds (at 160 test users) | 15.6 seconds |
| Services restarted | none | 1 — restarted by its own health check |

**Roughly half the intended complaints never got started at all.**

Both readings are accurate and they answer different questions. The first measures what the system will accept when it is allowed to set the pace. The second measures what happens when it is not. For sizing a real deployment the second is the more honest number, and the capacity figures above should be read alongside it rather than on their own.

---

## Key Caveats

1. **The figures were measured on an effectively empty database**, and stored data is the biggest single factor — see [What Slows It Down Most](#what-slows-it-down-most). Treat them as a best case, not a forecast.
2. **One copy of each service was running.** The cluster has four machines but a single instance of each complaints service, so these numbers describe one instance. Running more copies is the obvious next step and was not tested.
3. **These numbers are complaints-only.** Running other DIGIT modules on the same cluster reduces available capacity.
4. **Under realistic arrival patterns, about half the work never started** — see [What This Looks Like Under Real Traffic](#what-this-looks-like-under-real-traffic). The capacity table is a closed-loop result and should not be quoted without it.
5. **Nothing failed at any level, so the failure point is unknown.** We never reached it.
6. **Measurements vary by about 7% between identical runs.** Any difference smaller than that is not meaningful. Response times vary far more — around 50% — so only large latency differences should be trusted.
7. **Response times include about 24 milliseconds of network round-trip.** The load generator ran in the same region as the cluster.
