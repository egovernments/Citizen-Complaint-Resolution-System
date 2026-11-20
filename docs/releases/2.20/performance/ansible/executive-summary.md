# Executive Summary

The controlled Bomet 2.20 repeat completed cleanly at **125 virtual users**.
At **150 virtual users**, workflow and final-status failures pushed HTTP errors
above the acceptance limit, even though response times stayed within budget.

## Key Numbers

| Metric | 125 VU controlled repeat | 150 VU controlled repeat |
|---|---|---|
| Main journeys successful / attempted | 5,937 / 5,937 | 6,579 / 6,913 |
| Lifecycle success | 100% | 95.17% |
| HTTP errors / requests | 0 / 23,748 | 544 / 27,683 |
| HTTP error rate | 0% | 1.97% |
| HTTP p95 / p99 | 514 / 669 ms | 688 / 860 ms |
| Journey p95 / p99, including pauses | 11.52 / 12.24 s | 12.04 / 12.83 s |
| Successful hold lifecycles/s | 12.990 | 13.975 |
| Actual hold HTTP requests/s | 52.030 | 60.141 |
| All acceptance criteria | **PASS** | **FAIL — HTTP errors must be below 1%** |

Warmup is excluded. Throughput counts main-phase completions and requests during
the observed peak hold; percentiles and success/error percentages cover the
complete main phase. The percentages have different denominators: journeys
versus HTTP requests. They are not complements.

## What Was Tested

Each simulated user repeatedly ran:

```text
CREATE → ASSIGN → RESOLVE → SEARCH for RESOLVED
```

The initial ladder used a growing dataset. Its 2–100 VU levels were error-free;
125 VUs met numeric budgets but had 64 failed journeys. A separate controlled
125 repeat and a 150 run started from identical test-workspace record fingerprints
and 2,525 global complaints. Queues were drained and normal database cleanup
settled before measurement. Pacing, retries, thresholds, deployment settings and
resource limits were unchanged.

## What Failed at 150 VUs

- 9 assignments and 243 resolutions ended with `INVALID ACTION`. Their 252
  request IDs exactly matched the 252 complaints still pending at audit.
- 82 additional journeys failed their final `RESOLVED` check despite successful
  HTTP calls. This is inferred from client branch counts and the later aggregate
  resolved total; those 82 records were not individually mapped.
- Another 292 assignment `INVALID_UPDATE` responses were retryable under the
  existing helper. Together, 301 assignment and 243 resolution HTTP400 responses
  accounted for all 544 HTTP errors.

Persister lag reached **365 events in monitoring samples** around the error
bursts. This supports an asynchronous state-visibility explanation, without
proving exact commit delay or why the queue grew. No critical-service restart or
OOM event was observed; minimum sampled available host memory was about 6.89 GiB.

## Interpretation

The clean 125 repeat is an observed result, not a guaranteed operating limit.
The 150 errors show that a clean starting state alone does not eliminate the
workflow problem. Notification processing also accumulated approximately 17,500
captured events at the first post-150 check, separately from the API score.

Do not extrapolate these short closed-loop runs into daily production capacity
or a number of real users online. A deployment-size recommendation or a pure
2.12-to-2.20 regression conclusion requires matched fixtures, repeat measurements,
and the additional workload coverage described in
[Recommendations and Follow-Up](recommendations-transition-plan.md).
