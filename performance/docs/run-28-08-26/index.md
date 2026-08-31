# Load Test Run — 28 August 2026

Load test results against a live DIGIT deployment (16 vCPU, 30 GB, full 59-container stack, ~2,300 existing complaints), run as an unthrottled concurrency ladder, an error-based burst ladder, and a constrained CPU-profile matrix.

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary) | Key numbers, capacity at scale, error-based ceiling, constrained profiles, test infrastructure |
| [Findings](./findings) | Methodology, baseline performance, constrained profiles, burst tests, degradation points, host behaviour |
| [Capacity Planning](./recommendations-transition-plan) | Business sizing guide — complaints/day per tier, test users vs real people, scaling to 1M and 10M/day, Kubernetes trigger points |

## Headline

**8.034 lifecycles/s · 694,138 complaints/day at 80 VU with 0.000% failures** — the comfortable ceiling of a single 16 vCPU machine.

**12.463 lifecycles/s · 1,076,803 complaints/day at 160 VU with 0.67% failures** — its absolute maximum before collapse.
