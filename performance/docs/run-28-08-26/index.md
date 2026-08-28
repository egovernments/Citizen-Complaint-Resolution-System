# Load Test Run — 28 August 2026

Load test results against a live DIGIT deployment (16 vCPU, 30 GB, full 59-container stack, ~2,300 existing complaints), run as a CPU-profile matrix plus a burst ladder.

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary) | Key numbers, capacity by profile, test infrastructure |
| [Findings](./findings) | Methodology, resource profiles, baseline performance, burst tests, degradation points, host behaviour |
| [Capacity Planning](./recommendations-transition-plan) | Tier map, Kubernetes trigger points, decision flowchart |

## Headline

**2.204 lifecycles/s · 8.80 API req/s · 190,426 transactions/day at the 16 vCPU profile · 80 VU ceiling.**
