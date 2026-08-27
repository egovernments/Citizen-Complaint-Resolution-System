# Load Test Run — 24 August 2026

Load test results against a live DIGIT deployment (16 vCPU, 30 GB, full 59-container stack, 2,250 existing complaints).

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary) | Key numbers, capacity at scale, test infrastructure |
| [Findings](./findings) | Methodology, baseline performance, degradation curve, host behaviour |
| [Capacity Planning](./recommendations-transition-plan) | Tier map, Kubernetes trigger points, decision flowchart |

## Headline

**125 concurrent users · 43.3 API req/s · 934,762 transactions/day · 0.000% HTTP failures.**
