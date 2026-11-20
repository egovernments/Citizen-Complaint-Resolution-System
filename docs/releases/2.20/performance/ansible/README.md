# Load Test Run — 15–16 November 2026

Complaint API ramp tests on the existing Bomet Docker Compose deployment:
16 logical CPUs and approximately 30.6 GiB RAM. The initial ladder covered
2, 10, 50, 75, 100 and 125 virtual users; controlled repeats covered 125 and 150.

| Document | Contents |
|---|---|
| [Executive Summary](executive-summary.md) | Headline numbers, throughput, acceptance outcome, and remaining limits |
| [Findings](findings.md) | Methodology, full ramp results, error breakdown, monitoring, and 2.12 comparison |
| [Recommendations and Follow-Up](recommendations-transition-plan.md) | Capacity interpretation and the next measurements needed |
| [Recorded Results](results/2026-11-bomet.json) | Sanitized main-phase metrics, hold windows, response counts, and source hashes |

## Headline

**125 VUs passed cleanly in the controlled repeat:** 5,937/5,937 journeys,
zero HTTP errors, HTTP p95 514 ms and journey p95 11.52 s.

**150 VUs failed the HTTP error budget:** 6,579/6,913 journeys succeeded,
with 544/27,683 HTTP errors (1.97%, against a target below 1%). Journey success
was 95.17%, and all latency targets passed. Those passes do not cancel the
failed request-error threshold.

The controlled repeats started at the same verified 2,525 global PGR rows with
drained queues. This removed test carryover as an uncontrolled starting condition,
but workflow errors still appeared at 150. The exact cause of the persistence
lag remains unconfirmed. One sample per level does not establish a sustainable
production ceiling.

## Comparison with 2.12

The [comparison table](findings.md#comparison-with-212) is at the end of the
findings. The historical 2.12 ramp had no HTTP errors, including at 150 VUs,
but its 150-VU journey p95 exceeded the 15-second target. Fixture, authentication,
and background-load differences prevent a release-only regression claim.
