# Load Test Run — 1 September 2026 (Kubernetes)

Load test results against a DIGIT PGR deployment on AWS EKS (4 × m5a.xlarge, 36 pods in the application namespace, single replica per service, no CPU limits), run as an unthrottled concurrency ladder with a drain gate between levels.

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary.md) | Key numbers, capacity curve, where the limit is, stability |
| [Findings](./findings.md) | Methodology, the drain gate, degradation curve, deployment configuration, known limits |
| [Capacity Planning](./recommendations-transition-plan.md) | Business sizing — complaints/day, test users vs real people, what to fix first |

## Headline

**12.989 lifecycles/s · 53.49 API req/s · 1,122,250 complaints/day** — peak throughput, with **0.000% failed requests and 100.00% lifecycle success at every level tested**.

**Saturation at 160 VU.** Going to 200 VU adds 1.3% throughput — inside the 6.7% measurement noise — while latency rises 75%. Past that point the deployment gains nothing from more users.

**The limit is not the hardware.** `pgr-services` CPU stays flat at ~0.9 of a core across every level, on a 4-core node with no CPU limit set, while throughput stops climbing. The ceiling is a concurrency limit inside the application.

**Zero pod restarts** across the whole ladder, on the shipped configuration.

## Read This First

**Every level ran against an identical database** — exactly 3 complaints, restored by a gated cleanup between levels. That matters more than it sounds: the same 120 VU level returns 11.777 lifecycles/s at 3 records, 7.939 at 17,337, and 5.277 at ~27,000. **Stored data is the single largest influence on throughput measured anywhere in this campaign**, so the headline figures are an upper bound for an effectively empty database, not a forecast.

**These figures are from the shipped configuration.** No heap or probe changes were in place for the ladder.

**Closed-loop testing measures what the system will accept, not what real traffic does.** Under an open-loop test that holds the arrival rate regardless of server speed, roughly half the offered work never started. Both readings are accurate; they answer different questions.
