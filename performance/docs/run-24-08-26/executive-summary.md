# Executive Summary — Bomet, 24 August 2026

The Bomet County DIGIT deployment sustains **125 concurrent virtual users** and **~43 API
requests/second** with **zero failed requests** — roughly **935,000 complaint lifecycles/day**
of capacity against a deployment that currently receives **20–100 complaints/day**. Capacity is
not a constraint for this deployment at any plausible near-term load.

This is the first run of the load-test harness against a real DIGIT installation rather than a
purpose-built test rig.

## Key Numbers

| | Value |
|-|-------|
| **Max sustainable concurrent users** | **125 VU** (≈ 2,500–3,750 real users online) |
| **Max sustained throughput** | **43.3 API req/s** (10.8 complaint lifecycles/s) |
| Theoretical daily capacity | **~935,000 lifecycles/day** |
| Breaking point | **150 VU** — end-to-end p95 reaches 16.14s against a 15s budget |
| **Failure mode** | **Latency, not errors** |
| Failed requests, all seven levels | **0.000%** |
| Binding resource | **CPU** (2–3% idle from 100 VU up; memory never below 1.3 GB of 30 GB) |
| Headroom vs. current demand | **~9,000×** |
| Headroom vs. the 10,000/day design target | **~93×** |

::: tip What "935,000/day" means
It is the measured ceiling — 10.8 lifecycles/s — multiplied by the 86,400 seconds in a day,
following the same convention as the [March capacity planning doc](/recommendations-transition-plan).
It is the arithmetic maximum if the system ran flat-out at its ceiling every second of the day.
No real deployment does that, so treat it as a headroom indicator, not a service commitment.
:::

## What Was Tested

Every iteration runs one complete PGR complaint lifecycle — **4 API calls** through the full stack:

**CREATE** (file complaint) → **ASSIGN** (route to department) → **RESOLVE** (close it) → **SEARCH** (verify status)

Seven concurrency levels — 2, 10, 50, 75, 100, 125 and 150 VU — each held at peak for **5 minutes**.
This exercises Kong, PGR Services, Workflow, Persister, Kafka and Postgres.

## The Result in One Curve

Throughput rises linearly to 125 VU, then stops:

| Peak VU | Lifecycles/s | API req/s | Server time per lifecycle |
|---|---|---|---|
| 75 | 7.972 | 31.88 | 1.41s |
| 100 | 9.829 | 39.33 | 2.17s |
| **125** | **10.819** | **43.28** | 3.55s |
| 150 | 10.885 | 43.50 | **5.78s** |

Going from 125 to 150 VU buys **+0.6% throughput** while the server's own time per lifecycle grows
**63%**. That is the definition of saturation: more concurrency, no more work done, everyone waits
longer.

## How It Fails

**It does not fail — it slows down.** Across ~21,500 lifecycles and ~86,000 HTTP requests, not one
request returned an error. Under saturation the system queues rather than shedding load.

The 150 VU breach is on `transaction_duration`, an end-to-end measure that includes ~8s of
*scripted think time* the harness deliberately inserts to imitate a human. Measured against
`http_req_duration` — actual server latency — Bomet was at 2,326ms p95, less than half its 5,000ms
budget. **By the metric that measures the server directly, nothing had broken at 150 VU.**

## Three Things This Run Surfaced

### 1. None of the three database fixes are applied

Verified against this repository's deploy path: no `idx_eg_pgr_address_v2_parentid`, no composite
workflow indexes, no GIN trigram index, no `jit = off`, and `EGOV_WF_FUZZYSEARCH_ISFUZZYENABLED`
is unset. The March tier figures explicitly assume all three are applied.

Bomet's database is small (~2,250 complaints), so this costs little today. The March data shows an
unfixed deployment degrading roughly **9.4× by 100K records**. These fixes are minutes of work and
the cheapest capacity available — apply them before the database grows, not after.

### 2. The harness assumed seed data that only exists in `full-dump.sql`

Locality codes, city names, tenant IDs and service codes were all hardcoded to values that exist
only in the synthetic test dataset. Every one of them had to become configurable before the harness
would run anywhere real. These are now overridable via `k6/config/environments.js`.

### 3. The error ceiling was never measured

Nothing ran past 150 VU, by design — this is a live deployment carrying real usage. Bomet's
*latency* ceiling is 125 VU; the point at which it starts returning errors is strictly higher and
remains unknown.

## What To Do

| Priority | Action |
|---|---|
| **Now** | Apply the three database fixes. They are configuration and index changes, not code, and Bomet is currently running without them. |
| **Now** | Nothing else. At 20–100 complaints/day against a ~935,000/day ceiling, Bomet has about four orders of magnitude of headroom. |
| **Before the DB passes ~100K complaints** | Re-run this harness. That is where the unfixed degradation curve turns sharply. |
| **If CPU is ever the complaint** | Add vCPU, not RAM. CPU idle hit 2% while 28+ GB of memory sat unused. |
