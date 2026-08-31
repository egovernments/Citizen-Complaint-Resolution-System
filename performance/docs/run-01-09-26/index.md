# Load Test Run — 1 September 2026 (Kubernetes)

Load test results against a DIGIT PGR deployment on AWS EKS (4 × m5a.xlarge, 36 pods in the application namespace, single replica per service, no CPU limits), run as an unthrottled concurrency ladder with a drain gate between levels.

| Document | Contents |
|---|---|
| [Executive Summary](./executive-summary) | Key numbers, capacity curve, where the limit is, stability |
| [Findings](./findings) | Methodology, the drain gate, degradation curve, deployment configuration, known limits |
| [Capacity Planning](./recommendations-transition-plan) | Business sizing — complaints/day, test users vs real people, what to fix first |

## Headline

**320 concurrent test users · 0.000% failed requests · 100.00% lifecycle success.** No error ceiling was found at any level tested.

**16.259 lifecycles/s · 66.33 API req/s at 160 VU** — the highest throughput observed, but against ~7,000 stored records, roughly a third of what the later levels faced. It is not a capacity figure.

**The deployment is saturated at 120 VU**, the lowest level tested with a drain gate: 120 and 160 VU return identical throughput (32.67 vs 32.56 API req/s) while latency rises 65%. Its actual peak sits below 120 VU and was not measured.

**Zero pod restarts** across twelve load levels and roughly 17,700 complaints.

## Read This First

**These figures are not from the shipped configuration.** Every service in the complaint path ships with a JVM heap of `-Xmx192m` inside a container reserving 768Mi. The heap was raised to ~58% of each container's limit before testing, and `-XX:+ExitOnOutOfMemoryError` added. On the shipped setting these results would not hold — see [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934).

**The system saturates well before it fails.** Above ~160-200 VU each additional 40 VUs costs 8-11% of completed work and adds 19-59% to response time, without producing a single error. At 320 VU every request succeeds — and takes 11.5 seconds at p95.

**No two levels ran against the same database.** The campaign grew stored records from 193 to roughly 21,000, monotonically in run order, and the 120 and 160 VU levels were run last against the largest dataset. The series is therefore not monotonic in VU order, and only levels run adjacent in time can be compared. This is the main thing to fix before repeating the run.
