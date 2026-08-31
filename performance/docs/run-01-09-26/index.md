# Load Test Run — 1 September 2026 (Kubernetes)

Load test results against a DIGIT PGR deployment on AWS EKS (4 × m5a.xlarge, 36 pods in the application namespace, single replica per service, no CPU limits), run as an unthrottled concurrency ladder with a drain gate between levels.

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary) | Key numbers, capacity curve, where the limit is, stability |
| [Findings](./findings) | Methodology, the drain gate, degradation curve, deployment configuration, known limits |
| [Capacity Planning](./recommendations-transition-plan) | Business sizing — complaints/day, test users vs real people, what to fix first |

## Headline

**320 concurrent test users · 0.000% failed requests · 100.00% lifecycle success.** No error ceiling was found at any level tested.

**16.259 lifecycles/s · 66.33 API req/s at 160 VU** — the highest throughput observed, though measured against a much smaller database than the later levels.

**Zero pod restarts** across twelve load levels and roughly 17,700 complaints.

## Read This First

**These figures are not from the shipped configuration.** Every service in the complaint path ships with a JVM heap of `-Xmx192m` inside a container reserving 768Mi. The heap was raised to ~58% of each container's limit before testing, and `-XX:+ExitOnOutOfMemoryError` added. On the shipped setting these results would not hold — see [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934).

**The system saturates well before it fails.** Above ~160-200 VU each additional 40 VUs costs 8-11% of completed work and adds 19-59% to response time, without producing a single error. At 320 VU every request succeeds — and takes 11.5 seconds at p95.

**Levels measured hours apart are not comparable.** The campaign grew the database from 193 records to ~17,700, and stored data volume drives throughput. The 20-160 VU group and the 200-320 VU group should be read separately.
