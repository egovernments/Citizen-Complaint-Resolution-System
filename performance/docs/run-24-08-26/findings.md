# Findings — Bomet, 24 August 2026

Results from running the PGR load-test harness against the **Bomet County deployment**: a
shared development environment that carries real data (~2,250 existing complaints) and real
daily usage (20–100 new complaints/day). This is the first run of this harness against a
real DIGIT installation rather than a purpose-built test rig.

## Machine

| | |
|---|---|
| CPU | AMD EPYC-Rome, **16 vCPU** |
| Memory | **30 GiB** |
| Disk | 305 GB SSD (non-rotational) |
| OS / runtime | Ubuntu 24.04.4 LTS, Docker 29.4.0 |
| Virtualisation | **KVM guest** (not bare metal) |
| Services | 59 containers — the full DIGIT stack, including Postgres, Redpanda, Elasticsearch, Keycloak and Novu |

**Idle baseline before any test load: load average 5.5–6.9, 4–7 GB memory available.**
This box is not quiet at rest. Every figure below sits on top of that existing load, and the
whole DIGIT stack shares the same 16 vCPU — not just the PGR hot path.

## Test Shape

All ramps share one structure: a `warmup` scenario at a tenth of peak, then a measured `main`
scenario that ramps up, holds, and ramps down. Only `main` is measured; warmup is excluded
from every threshold and every figure on this page.

| Scenario | Warmup | Ramp-up | **Sustained at peak** | Ramp-down | Peak VU |
|---|---|---|---|---|---|
| ramp-2vu | 1 VU / 2m | 2m | **5m** | 1m | 2 |
| ramp-10vu | 2 VU / 2m | 2m | **5m** | 1m | 10 |
| ramp-50vu | 5 VU / 2m | 3m | **5m** | 2m | 50 |
| ramp-nvu (75–150) | VU/10 / 2m | 3m | **5m** | 2m | 75–150 |

Maximum concurrency tested: **150 concurrent VUs**, each peak sustained for **5 minutes**.

## Three Terms Used Below

**One lifecycle is not one API call.** Each virtual user runs CREATE → ASSIGN → RESOLVE →
SEARCH, and the harness sleeps between steps to imitate a human reading the screen. The sleeps
sit *inside* the timed window:

```
4 × sleep(1–3s)   ≈ 8.0s   ← scripted think time, not server work
4 × API calls     ≈ 1.5s   ← actual server work
                  ≈ 9.5s   ← one nominal lifecycle
```

So an 11.5s `transaction_duration` is roughly 8s of deliberate sleeping plus 3.5s of real work.
It is not 11.5s of server latency.

**Steady-state, not run-average.** Throughput below is measured over the 5-minute hold at peak
VU only. A run average dilutes the peak with warmup and ramp phases and understates real
capacity by 40–55%.

**The harness is closed-loop.** Each VU finishes one lifecycle then immediately starts the next,
so throughput is capped at `VU ÷ cycle_time` by arithmetic alone (Little's Law), regardless of
how fast the server is. This matters for reading the low-VU rows.

## Methodology Notes

Three things must be read alongside the numbers:

1. **k6 ran from a remote control machine over the public internet**, not on-host over an SSH
   tunnel. Measured RTT was **~185ms**, included in every `http_req_duration` figure below.
   Server-side latency is roughly the reported value minus that offset. Throughput and error
   rates are unaffected.
2. **The database was not empty and real users were active.** Test complaints were removed
   afterwards via a gated transaction that preserved every non-test row.
3. **The runs were not taken under identical conditions.** The 2/10/50 VU runs ran overnight
   (00:47–01:15 EAT, idle load ~5.5, 7 GB free); the 75–150 VU ceiling runs ran during working
   hours (12:47–13:40 EAT, idle load ~6.9, 4 GB free) back-to-back, so the box never fully
   recovered between steps. The ceiling figures are therefore **conservative** relative to an
   idle box.

## Capacity Curve

Throughput is steady-state over the 5-minute hold. Latency is the `{scenario:main}` percentile
that the thresholds actually evaluate. One lifecycle = 4 API calls.

| Peak VU | Lifecycles/s | **API req/s** | http p95* | txn p95 | Lifecycles | Success | HTTP failures | Verdict |
|---|---|---|---|---|---|---|---|---|
| 2 | 0.215 | 0.86 | 420ms | 11.47s | 81 | 100% | 0% | pass |
| 10 | 1.058 | 4.22 | 407ms | 11.47s | 412 | 100% | 0% | pass |
| 50 | 5.181 | 20.72 | 511ms | 11.71s | 2,356 | 100% | 0% | pass |
| 75 | 7.972 | 31.88 | 447ms | 11.31s | 3,621 | 100% | 0% | pass |
| 100 | 9.829 | 39.33 | 756ms | 12.00s | 4,540 | 100% | 0% | pass |
| **125** | **10.819** | **43.28** | 1,321ms | 13.53s | 5,122 | 100% | 0% | **pass (last clean level)** |
| 150 | 10.885 | 43.50 | 2,326ms | **16.14s** | 5,363 | 100% | 0% | **BREACH** — `transaction_duration p(95)<15000` |

\* includes ~185ms of network RTT; subtract for server-side latency.

::: warning Do not read the low-VU rows as Bomet's capacity.
At 2–75 VU the harness is **think-time-bound, not server-bound** — the numbers measure the
harness's own `sleep()` calls, not the server. Only the 100 VU row and above say anything
about what Bomet can do.
:::

## Where the Server Actually Becomes the Constraint

Because the harness is closed-loop, the real cycle time is `VU ÷ measured rate`. Subtracting the
~8s of scripted sleep leaves the time the server actually took per lifecycle — a directly
meaningful quantity, with no ratio to a nominal constant involved:

| Peak VU | Real cycle time | **Server time per lifecycle** | vs. baseline |
|---|---|---|---|
| 2 | 9.30s | 1.30s | — |
| 10 | 9.45s | 1.45s | 1.0× |
| 50 | 9.65s | 1.65s | 1.1× |
| 75 | 9.41s | 1.41s | 1.0× |
| 100 | 10.17s | 2.17s | 1.5× |
| 125 | 11.55s | 3.55s | 2.4× |
| 150 | 13.78s | **5.78s** | **4.0×** |

Up to 75 VU the server's contribution is flat at ~1.5s — it keeps up completely, and throughput
is set entirely by the harness's sleeps. From 100 VU the server's share climbs, and by 150 VU it
has quadrupled. Adding 25 VUs beyond 125 buys **+0.6% throughput** (10.819 → 10.885/s) while p95
latency grows 19%. That is a saturated system.

## How It Degrades

The failure mode is the important part: **at no point did any request fail.** Across all seven
levels, `http_req_failed` stayed at **0.000%** and `transaction_success` at **100%**, including
at the breach. The system does not shed load or return errors under saturation — it queues, and
users wait longer.

Note also *which* budget broke. The breach is on end-to-end `transaction_duration`, which includes
the ~8s of scripted think time. `http_req_duration` p95 — actual server latency — was 2,326ms at
150 VU, less than half its own 5,000ms threshold. By the metric that measures the server directly,
Bomet had not yet breached anything at 150 VU.

Host behaviour across the ceiling steps:

| Peak VU | Peak load (16 vCPU) | Min CPU idle | Min memory available |
|---|---|---|---|
| 75 | 32.1 | 12% | 3,006 MB |
| 100 | 45.5 | 3% | 2,427 MB |
| 125 | 63.6 | 2% | 1,655 MB |
| 150 | 61.1 | 2% | 1,315 MB |

**CPU is the binding constraint.** Idle time hits 2–3% from 100 VU onward, while memory never
falls below 1.3 GB of 30 GB and no container was OOM-killed or restarted. Adding CPU should move
the ceiling; adding RAM would not.

## What Was Not Measured

Two honest gaps:

- **The error ceiling is unknown.** Nothing was run past 150 VU, by design — this is a live
  deployment. Bomet's *latency* ceiling is 125 VU; the point at which it starts returning errors
  was never reached and is strictly higher.
- **Host metric sampling was not retained.** The load/CPU/memory table above is carried forward
  from the run-time analysis; the raw per-sample logs were not preserved and cannot be re-derived.

## Why This Does Not Match the March Tier Table

The March 2026 results put a 16 vCPU machine at ~300 VU. Bomet is 16 vCPU and reached 125. The
gap is real but it is not a contradiction — four things differ, and each one moves the number the
same direction:

| Difference | Effect |
|---|---|
| **Different breach criterion.** March ceilings mark where *errors* appear (connection exhaustion, PgBouncer timeouts). Bomet's 125 marks where a *latency* budget is exceeded, with zero errors. | Not the same measurement. Bomet's error ceiling is higher than 125 and was never probed. |
| **Full stack, not PGR-only.** 59 containers share the 16 vCPU — Elasticsearch, Keycloak, Novu, Redpanda. The box idles at load 5.5–6.9 before any test traffic. | Matches the existing caveat that non-PGR modules reduce capacity proportionally. |
| **None of the three database fixes are applied.** Verified against this repository's deploy path: no `idx_eg_pgr_address_v2_parentid`, no composite workflow indexes, no GIN trigram index, no `jit = off`, and `EGOV_WF_FUZZYSEARCH_ISFUZZYENABLED` is unset. | The March tier figures explicitly assume all three are applied. Bomet sits outside that assumption. |
| **Shared KVM guest**, not a dedicated EC2 instance. | Noisy-neighbour and virtualisation overhead are not controlled for. |

The database-fixes point is the one worth acting on. Bomet's database is small today (~2,250
complaints), which is why an untuned deployment still performs well. The March data shows an
unfixed deployment degrading roughly **9.4×** by 100K records. Bomet has the headroom to absorb
that today, but the fixes are the cheapest capacity available and should be applied before the
database grows.

## Deployment-Specific Configuration

Pointing the harness at a real deployment required configuration the harness previously hardcoded.
These are now overridable via `k6/config/environments.js` (see `environments.js.example`):

| Assumption | Stock value | Why it fails elsewhere |
|---|---|---|
| Locality code | `JLC477` | Only exists in `full-dump.sql` seed data. PGR validates locality against the boundary service, so every CREATE fails without a real code. |
| City / district / region | `City A` | Same — seed-only value. |
| Tenant | `statea.citya` | PGR workflow and `RAINMAKER-PGR.ComplaintHierarchy` may both resolve at the **state** tenant, not the city. |
| Service codes | 33 defaults | Must be restricted to codes whose department has active employees, or ASSIGN auto-routing has nobody to route to. |
| Citizen identity | 100 fabricated users | Creates junk user records on shared environments. |

One further prerequisite: the test employee must hold roles for **every** transition the lifecycle
drives. On stock PGR, `ASSIGN` requires `GRO` or `PGR_VIEWER` and `RESOLVE` requires `PGR_LME` or
`PGR_VIEWER` — so `PGR_VIEWER` alone covers both, while an account holding only `GRO` and
`SUPERVISOR` cannot complete the lifecycle.

## Reproducing These Numbers

Steady-state throughput and hold-window percentiles are computed from each run's `metrics.csv` by
taking the window where `vus >= 0.95 × peak`, counting `transaction_duration` samples tagged
`scenario:main` inside it, and dividing by the window length. Threshold verdicts and
`http_req_duration` percentiles are read from each run's `summary.json`, which is what k6 itself
evaluates the thresholds against.
