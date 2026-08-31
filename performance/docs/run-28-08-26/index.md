# Load Test Run — 28 August 2026

Load test results against a live DIGIT deployment (16 vCPU, 30 GB, full 59-container stack, ~2,300 existing complaints), run as an unthrottled concurrency ladder, an error-based burst ladder, and a constrained CPU-profile matrix.

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary) | Key numbers, capacity at scale, error-based ceiling, constrained profiles, test infrastructure |
| [Findings](./findings) | Methodology, baseline performance, constrained profiles, burst tests, degradation points, host behaviour |
| [Capacity Planning](./recommendations-transition-plan) | Business sizing guide — the 16 vCPU / 32 GiB floor, complaints/day, test users vs real people, scaling to 1M and 10M/day, Kubernetes trigger points |

## Headline

**8.034 lifecycles/s · 694,138 complaints/day at 80 VU with 0.000% failures** — the highest level verified clean on a single 16 vCPU machine, and the figure to plan against.

**The ceiling above that is unmeasured.** The 160 and 320 VU levels were measured while `pgr-services` was running out of a 384 MB JVM heap — a fixed cap unrelated to the machine's 30.6 GiB — so the higher figures previously headlined here (1,076,803/day at 160 VU, collapse at 320 VU) record a misconfiguration rather than the capacity of the hardware. See [When the heap gave out](./findings#when-the-heap-gave-out).

**Minimum deployment spec: 16 vCPU / 32 GiB.** The stack holds 26.8 GB of memory at rest with no load applied, so nothing smaller can run it. A pilot and a large city are provisioned identically — see [Capacity Planning](./recommendations-transition-plan#the-hardware-floor-16-vcpu-32-gib).
