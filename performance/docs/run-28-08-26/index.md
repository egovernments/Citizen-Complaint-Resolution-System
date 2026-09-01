# Load Test Run — 28 August 2026

Load test results against a live DIGIT deployment (16 vCPU, 30 GB, full 59-container stack, ~2,300 existing complaints), run as an unthrottled concurrency ladder, an error-based burst ladder, and a constrained CPU-profile matrix.

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary) | Key numbers, capacity at scale, error-based ceiling, constrained profiles, test infrastructure |
| [Findings](./findings) | Methodology, baseline performance, constrained profiles, burst tests, degradation points, host behaviour |
| [Capacity Planning](./recommendations-transition-plan) | Business sizing guide — the 16 vCPU / 32 GiB floor, complaints/day, test users vs real people, scaling to 1M and 10M/day, Kubernetes trigger points |

## Headline

**11.182 lifecycles/s · 966,091 complaints/day at 120 VU with 0.000% failures** — the highest level verified clean on a single 16 vCPU machine, measured three times against a fixed dataset in the 1 September follow-up, and the figure to plan against. The 28 August ramp ladder reached 125 VU / 931,824 per day before crossing its end-to-end latency budget at 150 VU, and the 31 August burst ladder is clean to 80 VU / 694,138 per day.

**The ceiling above that is unmeasured.** The 160 and 320 VU levels were measured while `pgr-services` was running out of a 384 MB JVM heap — a fixed cap unrelated to the machine's 30.6 GiB — so the higher figures previously headlined here (1,076,803/day at 160 VU, collapse at 320 VU) record a misconfiguration rather than the capacity of the hardware. See [When the heap gave out](./findings#when-the-heap-gave-out). Nothing between 120 and 320 VU has been measured cleanly.

**Minimum deployment spec: 16 vCPU / 32 GiB.** The stack holds 26.8 GB of memory at rest with no load applied, so nothing smaller can run it. A pilot and a large city are provisioned identically — see [Capacity Planning](./recommendations-transition-plan#the-hardware-floor-16-vcpu-32-gib).

## Follow-Up, 1 September 2026

Three method gaps were closed on the same deployment — see [Findings](./findings#follow-up-measurements-1-september-2026).

**Under a realistic arrival pattern this deployment fails half of all complaints.** Every figure above comes from a closed-loop test, which cannot overload a system because the load slows down when the server does. Re-run with a ramping arrival rate at a near-identical request rate: **19.57% of requests failed, 50.23% of lifecycles completed, and 24% of the intended work never started** — against 0.000% and 100.00% closed-loop.

**Tail latency near saturation carries ±20% run-to-run variance**, so single-run p95 differences below about 40% at that level are not readable. Throughput is stable at ~2%.

**The database is not the limit.** Slow-query logging during a full load run surfaced no PGR write-path query over 100ms; the only slow statements were periodic dashboard view refreshes.
