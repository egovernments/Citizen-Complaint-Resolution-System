# Load Test Run — 28 August 2026

Load test results against a live DIGIT deployment (16 vCPU, 30 GB, full 59-container stack, ~2,300 existing complaints), run as an unthrottled concurrency ladder plus a constrained CPU-profile matrix.

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary) | Key numbers, capacity at scale, constrained profiles, test infrastructure |
| [Findings](./findings) | Methodology, baseline performance, constrained profiles, burst tests, degradation points, host behaviour |
| [Capacity Planning](./recommendations-transition-plan) | Tier map, Kubernetes trigger points, decision flowchart |

## Headline

**10.785 lifecycles/s · 43.15 API req/s · 931,824 transactions/day at 125 VU · 0.000% HTTP failures at every level tested.**
