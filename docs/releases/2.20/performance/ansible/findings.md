# Findings

Performance results from complaint API load testing on the existing Bomet
deployment, 15–16 November 2026. The report covers a closed-loop ramp ladder and
controlled high-load repeats. No application fix or release-only regression is
claimed.

## Testing Methodology

### Tool

The tests used k6 from an external control machine over public HTTPS. HTTP
latencies include the measured request path over that connection; a separate
network RTT was not measured. The campaign used an existing authenticated test
account, so identity-provider login traffic is excluded.

### What Each Virtual User Does

```text
CREATE (file complaint) → ASSIGN (route) → RESOLVE (close) → SEARCH (verify)
```

Four random 1–3-second think periods were retained. The final search must report
`RESOLVED` for the lifecycle to pass. Existing `INVALID_UPDATE` backoff remained;
no additional `INVALID ACTION` retries, state polling, or longer pauses were
introduced to obtain a pass. The same existing PGR helpers were used by a Bomet
adapter with workspace-specific fixtures and an explicit assignee.

### Test Profiles

| Levels | Warmup | Main scenario | Total scheduled duration |
|---|---|---|---|
| 2 VU | 1 VU for 2 min | 2 min ramp, 5 min hold, 1 min down | 10 min |
| 10 VU | 2 VU for 2 min | 2 min ramp, 5 min hold, 1 min down | 10 min |
| 50 VU | 5 VU for 2 min | 3 min ramp, 5 min hold, 2 min down | 12 min |
| 75, 100, 125, 150 VU | floor(peak/10) VUs for 2 min | 3 min ramp, 5 min hold, 2 min down | 12 min |

The checked historical `ramp-nvu.js` uses floor(peak/10) warmup users and a
12-minute schedule. That script was followed where the historical prose differed.
Graceful iteration completion can extend wall-clock time slightly.

Only completed main phases are scored. Warmup and sleep-interrupted generator
attempts are excluded from the performance tables. Both controlled measurements
completed without a generator suspension or safety stop. An interruption during
post-125 cleanup was outside measurement; the original records were restored,
then the drain and fixed-baseline setup resumed before 150.

### Test Machines

| Component | Recorded configuration |
|---|---|
| Server | Bomet, existing shared single-machine Docker Compose stack |
| CPU | 16 logical CPUs |
| Memory | Approximately 30.6 GiB RAM |
| Core service CPU and memory cgroups | No captured CPU quota or memory cap |
| Java maximum heaps | PGR 384 MiB; workflow 768 MiB; persister 512 MiB; user 384 MiB |
| Load generator | External k6 client over HTTPS |

No provisioning, redeployment, heap tuning, CPU-profile change or service restart
was performed as part of these measurements. Captured complaint-path image tags
matched v2.20 manifest defaults. This is not a digest/configuration audit of every
deployed component, and historical CPU model, disk, OS and RTT values are not
substituted for unrecorded current measurements.

### Dataset and Queue Preparation

The initial ladder accumulated synthetic data between levels. Monitoring later
showed unfinished notification work before the initial 125 run, so that series
is retained separately from the controlled repeats.

Before each controlled repeat:

1. Verify critical-service health and the test-workspace SMS/WhatsApp-off guards.
2. Drain persister queues. Before deleting test records, allow notification
   consumers to pass the captured offsets for events that still need those rows.
3. Back up only exact, marked synthetic records and prepare **2,525 global PGR
   complaint rows**. Test-workspace PGR/workflow/related child/daily-state row
   fingerprints matched between 125 and 150.
4. Let normal PostgreSQL autovacuum settle, then verify the count and queues again.

The 2,525 starting count follows the 2.12 fixed-dataset follow-up; the original
2.12 ramp was documented at approximately 2,300 complaints. These are therefore
not identical database snapshots. Notification history, search indexes, other
platform databases and ID sequences were not reset.

## Executive Summary

| Metric | Recorded result |
|---|---|
| Initial error-free levels | 2, 10, 50, 75 and 100 VU |
| Initial 125 VU | Numeric budgets passed; 64 failed journeys and 146 HTTP errors |
| Controlled 125 VU | 5,937/5,937 journeys; zero HTTP errors; all thresholds passed |
| Controlled 150 VU | 6,579/6,913 journeys; 1.965% HTTP errors; failed error-rate threshold |
| Highest observed error-free controlled level | 125 VU, one sample |
| Sustainable capacity ceiling | Not established |

## Baseline Performance

### Initial Ramp Tests with Growing Dataset

| VU | Lifecycles/s | API req/s | HTTP p95 | HTTP p99 | Journey p95 | Journey p99 | Lifecycle success | Request fail |
|---|---|---|---|---|---|---|---|---|
| 2 | 0.211 | 0.845 | 460 ms | 497 ms | 11.71 s | 11.94 s | 100.00% | 0.000% |
| 10 | 1.051 | 4.220 | 431 ms | 545 ms | 11.29 s | 11.90 s | 100.00% | 0.000% |
| 50 | 5.333 | 21.346 | 389 ms | 429 ms | 11.20 s | 11.84 s | 100.00% | 0.000% |
| 75 | 7.962 | 31.881 | 425 ms | 483 ms | 11.35 s | 12.08 s | 100.00% | 0.000% |
| 100 | 10.386 | 41.557 | 497 ms | 566 ms | 11.49 s | 12.27 s | 100.00% | 0.000% |
| 125 | 12.336 | 49.387 | 736 ms | 1003 ms | 12.09 s | 12.93 s | 98.88% | 0.640% |

### Controlled High-Load Repeats

| VU | Lifecycles/s | API req/s | HTTP p95 | HTTP p99 | Journey p95 | Journey p99 | Lifecycle success | Request fail |
|---|---|---|---|---|---|---|---|---|
| 125 | 12.990 | 52.030 | 514 ms | 669 ms | 11.52 s | 12.24 s | 100.00% | 0.000% |
| 150 | 13.975 | 60.141 | 688 ms | 860 ms | 12.04 s | 12.83 s | 95.17% | 1.965% |

Throughput counts main-phase successful lifecycles and actual HTTP requests in
the longest sampled interval with active VUs at least 95% of the observed peak.
The controlled intervals were about 319 seconds. Percentiles, lifecycle success
and request failures cover the entire main phase, excluding warmup. Each run's
exact window and denominators are in [Recorded Results](results/2026-11-bomet.json).

### Reading the Two Percentage Columns

Lifecycle success and request failure have different denominators and do not sum
to 100. A journey can stop before issuing all four requests, retry a request, or
fail its final status check even when every HTTP response is 200. API requests/s
is counted directly, not derived as four times successful lifecycles/s.

At 150 VUs, 334/6,913 journeys failed (4.832%), whereas 544/27,683 HTTP requests
failed (1.965%). There were 82 final-check failures beyond the 252 terminal
workflow errors.

### Threshold Verdicts

| Criterion | Original threshold | 125 VU controlled | 150 VU controlled |
|---|---|---|---|
| Lifecycle success | >95% | 100% — PASS | 95.17% — PASS |
| HTTP request failure | <1% | 0% — PASS | 1.97% — **FAIL** |
| HTTP p95 | <5 s | 0.514 s — PASS | 0.688 s — PASS |
| HTTP p99 | <10 s | 0.669 s — PASS | 0.860 s — PASS |
| Journey p95 | <15 s | 11.52 s — PASS | 12.04 s — PASS |
| Journey p99 | <25 s | 12.24 s — PASS | 12.83 s — PASS |

Every criterion must pass. The initial 125 run also met numeric budgets despite
errors; meeting those budgets is different from an error-free run. Progression
from the controlled 125 repeat to 150 required both the original SLOs and no
failed journeys or HTTP requests. The initial series never measured 150.

## Degradation Points

### Initial 125 VUs and the Controlled Repeat

The initial run completed 5,626/5,690 journeys, with 146/22,804 HTTP errors.
The immediate database check found 51 pending complaints, while 13 further
journeys failed their final status check. Prior investigation supported delayed
state visibility, without measuring exact commit delay. Existing queued
notification work and the accumulating dataset were additional uncontrolled
starting conditions.

After draining queues and preparing the fixed starting dataset, all 5,937
controlled journeys passed. Those preparation changes were applied together;
one successful repeat does not isolate which change mattered or demonstrate a fix.

### Controlled 150 VUs

All 6,913 main-phase CREATE calls succeeded. The failures were:

| Outcome | Count | Evidence |
|---|---|---|
| Assignment ended in `INVALID ACTION` | 9 | Complaints remained pending assignment |
| Resolution ended in `INVALID ACTION` | 243 | Complaints remained pending resolution |
| Final `RESOLVED` check failed | 82 | Successful HTTP calls; later aggregate resolved total was higher |
| Failed main journeys | 334 | 6,579 successful out of 6,913 attempted |

The **252 terminal request IDs exactly matched the 252 pending records** at
audit. Another 292 assignment `INVALID_UPDATE` HTTP400 attempts were retryable
under the original helper. Individual retries were not mapped to eventual
journey outcomes. In total, 301 assignment plus 243 resolution HTTP400 responses
account for all 544 HTTP errors.

The 82 final-check failures are inferred from the client branch/response counts:
each successful RESOLVE was followed by one HTTP200 SEARCH, yet 82 fewer main
journeys validated `RESOLVED`. The later database resolved total exceeded the
client-validated count by the same 82. Those records were not individually mapped.

The first and last HTTP400 responses were recorded at **08:12:08 and 08:17:08
UTC on 16 November 2026**. These bounds include the gaps between error bursts;
they do not imply continuous failures throughout that interval.

## Host Behaviour and Background Processing

Persister lag reached **365 events in 45-second monitoring samples** around the
150-user error bursts. That supports an asynchronous state-visibility explanation:
a later step may read the workflow before an earlier step has finished saving.
Exact write-commit timing and the cause of the queue growth remain unconfirmed.

No critical-service restart or OOM event was observed. Minimum sampled available
host memory during 150 was approximately **6.89 GiB**. These observations do not
support memory exhaustion as the explanation for this run; they are not a
complete heap/GC or resource-causality trace.

Notification processing was a separate bottleneck. Approximately **17,500
captured notification events** remained at the first post-150 check. API latency
meeting target does not establish that notification delivery is keeping up;
advancing consumer offsets is not proof of successful delivery.

## Deployment Configuration and Comparison Limits

The adapter used one preauthenticated administrative account with the required
workflow roles, one synthetic citizen identity, one complaint category, three
wards, and one explicit assignee. The historical harness supports a 100-citizen
pool, category rotation and an employee-authentication path. Those remaining
fixture/auth differences and shared-server background activity must be aligned
before attributing changes solely to the release version. These tests are not
measurements of identity-provider performance.

The reset matched a PGR starting count and scoped row fingerprints, not all
platform state. The current 2.20 measurements did not repeat the historical
Kubernetes campaign, CPU-profile matrix, burst ladder, open-loop arrival test,
dashboard data-scaling matrix, or multi-run variance study. No real-user mapping,
daily-capacity figure, or deployment-size ceiling is inferred from this ladder.

## Data Preservation and Evidence

The original 17,689 synthetic complaints and scoped related rows were restored
with verified fingerprints. The 6,096 records from the controlled 125 run were
backed up and removed before 150. The final 7,110 marked records were retained
for inspection and safe asynchronous processing: 6,858 resolved, 9 pending
assignment and 243 pending resolution at audit. No recovery calls converted
failed measurements into successes. Test operations did not modify other tenants;
SMS and WhatsApp stayed disabled only in the test workspace.

[Recorded Results](results/2026-11-bomet.json) contains sanitized main metrics,
response counts, exact hold windows, source SHA-256 hashes, and aggregate
diagnostics. It is a derived evidence extract, not the raw request stream or a
standalone reproduction harness. Raw metrics and per-record audits are retained
with the campaign artifacts; identities, tokens, request bodies, private paths
and individual complaint IDs are not published here.

Historical references:

- [2.12 Ansible findings](../../../2.12/performance/ansible/findings.md),
  recorded blob `18ce9df5abe954ae450123d6036e78446d1a5601`.
- [2.12 ramp source](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/2.12/performance/k6/scenarios/ramp-nvu.js),
  recorded blob `a8a7f520b387372af639e5970e5d2574afe2f2db`.
- [2.20 deployment manifest](https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/v2.20/local-setup/docker-compose.egov-digit.yaml),
  recorded blob `0de1e6a3a2935e605cab99d7fe2ef7dc0c88bc49`.

## Comparison with 2.12

For 2–100 VUs, the 2.20 columns use the initial ladder; for 125 and 150 they use
the controlled fixed-baseline repeats. This combines series with different
preparation policies. The published 2.12 ladder reported 100% lifecycle success
and zero HTTP errors at every listed level.

The observed 2.20 high-load latencies are lower, but 150-user reliability is worse.
Historical 2.12 at 150 exceeded the 15-second journey-p95 target (16.38 s) while
completing every journey. This is contextual comparison, not an isolated
release-version benchmark; each controlled 2.20 level has only one sample.

| VU | 2.12 lifecycles/s | 2.20 lifecycles/s | 2.12 HTTP p95 | 2.20 HTTP p95 | 2.12 journey p95 | 2.20 journey p95 | 2.20 lifecycle success | 2.20 request fail | 2.20 verdict |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 0.214 | 0.211 | 416 ms | 460 ms | 11.40 s | 11.71 s | 100.00% | 0.000% | PASS |
| 10 | 1.054 | 1.051 | 407 ms | 431 ms | 11.44 s | 11.29 s | 100.00% | 0.000% | PASS |
| 50 | 5.165 | 5.333 | 517 ms | 389 ms | 11.74 s | 11.20 s | 100.00% | 0.000% | PASS |
| 75 | 7.947 | 7.962 | 456 ms | 425 ms | 11.32 s | 11.35 s | 100.00% | 0.000% | PASS |
| 100 | 9.798 | 10.386 | 794 ms | 497 ms | 12.13 s | 11.49 s | 100.00% | 0.000% | PASS |
| 125 | 10.785 | 12.990 | 1,413 ms | 514 ms | 13.73 s | 11.52 s | 100.00% | 0.000% | PASS |
| 150 | 10.851 | 13.975 | 2,477 ms | 688 ms | 16.38 s | 12.04 s | 95.17% | 1.965% | FAIL: HTTP errors |
