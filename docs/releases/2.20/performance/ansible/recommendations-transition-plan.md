# Recommendations and Follow-Up

## What These Runs Support

The controlled 125-VU run is an error-free observed point under the recorded
fixture and starting conditions. The 150-VU run failed the HTTP error budget
despite meeting latency targets. Neither result establishes a repeatable
production capacity ceiling, a real-user conversion, or daily complaint capacity.

Use [Findings](findings.md) for the complete result and
[Recorded Results](results/2026-11-bomet.json) for denominators and measurement
windows. Do not treat the initial 125 numeric-budget pass as an error-free run.

## First Priority: Workflow State Visibility

Trace accepted ASSIGN/RESOLVE calls, Kafka publication/consumption, workflow and
PGR database commit times, and the following SEARCH for the same request IDs.
The 150-user audit links 252 terminal workflow errors to pending records, while
82 final checks are supported only by aggregate evidence. Record commit timing
before choosing a fix or attributing the issue to database, CPU, JVM, or queue
configuration. The queue-lag samples alone do not settle that cause.

Do not add waits, state polling or extra retries to the existing benchmark and
then present the outcome as the same test. Evaluate any mitigation in a separately
labeled experiment while retaining the original failure results.

## Align the Remaining Comparison Conditions

Before making a release-only 2.12-to-2.20 claim, match the citizen distribution,
category/ward coverage, employee authentication and assignee behavior. Document
the retained runtime/configuration differences and concurrent shared-server load.
Keep the same starting dataset and define which databases and derived state are
reset, rather than equating a complaint count with a complete snapshot.

## Additional Coverage Needed

| Measurement | Why it is needed | Status in this Bomet report |
|---|---|---|
| Repeated fixed-fixture high-load runs | Quantify variance and confirm repeatability | One controlled sample at each of 125 and 150 |
| Arrival-rate traffic | Measure offered-load pressure independently of client slowdown | Not measured |
| Burst and longer soak tests | Exercise abrupt arrivals, backlog recovery, and long-duration stability | Not measured |
| Notification processing and delivery | API success does not measure delivery delay or recovery | Backlog observed; delivery not validated |
| Dashboard read/data-scaling matrix | Complaint API results do not establish dashboard capacity | Not measured |
| Kubernetes or CPU-profile comparisons | Different deployment/resource conditions need their own evidence | Not measured |

## Data Handling

Retain the marked final-run records until their asynchronous consumers no longer
need them and inspection is complete. Any later cleanup should preserve the
recorded failure evidence and verified original records. Keep changes confined
to the test workspace; its SMS/WhatsApp-off policy is not a global notification
setting.

The [2.12 recommendations](../../../2.12/performance/ansible/recommendations-transition-plan.md)
remain a historical reference. Their daily-capacity, repeatability and sizing
claims are not revalidated by this campaign.
