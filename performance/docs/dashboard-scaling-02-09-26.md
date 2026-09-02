# Dashboard scaling on Bomet — 2 September 2026

## Result

The dashboard read path completed the full 20K and 50K fixture matrix through
150 virtual users without an HTTP failure, partial analytics response, PGR
restart, or OOM. Throughput remained pacing-limited at approximately one
dashboard visit per VU per 10 seconds. There is no observed saturation knee in
the measured range.

Increasing the fixture from 20K to 50K complaints did not produce a consistent
latency penalty. At matching concurrency, the 50K dashboard p95 ranged from 14%
lower to 14% higher than 20K; at 120, 125, and 150 VUs the differences were
-2.8%, +3.9%, and +3.0%. This spread is small enough to treat as run-to-run
variation until the high-concurrency cells are repeated.

## Test shape

- Target: the unthrottled Bomet deployment used for Dhruv's baseline (16 vCPU,
  30 GiB RAM).
- PGR image: `sha256:6af21d546f53258a0d92adb41e7094c08a24bfe89c3dddec0036d6c887503bb3`.
- Data: deterministic complaint lifecycle distributions at 20,000 and 50,000
  complaint facts, activated through an isolated database snapshot clone.
- Browser baseline: one VU, two warm-ups, then 20 measured cold-context
  dashboard navigations.
- API load: 30-second warm-up and two-minute main window at 2, 10, 50, 75, 100,
  120, 125, and 150 VUs. Each VU performs a pack read, catalog read, and one
  batched query containing every KPI in the selected nine-tile pack, then paces
  the visit to 10 seconds.
- Valid run IDs: `issue1109-scale3-20260902` (20K) and
  `issue1109-scale5-20260902-50k` (50K).

The VU levels deliberately match Dhruv's 2/10/50/75/100/125/150 ramp, with 120
added because that was his repeated fixed-dataset checkpoint. This dashboard
scenario is read-only and must not be compared as transaction throughput with
Dhruv's complaint-creation lifecycle scenario.

## API matrix

| Rows | VUs | Visits/s | Dashboard p50 | Dashboard p95 | HTTP p95 | Success | HTTP failures |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 20K | 2 | 0.160 | 0.864s | 2.463s | 0.490s | 100% | 0% |
| 20K | 10 | 0.800 | 1.073s | 2.664s | 1.843s | 100% | 0% |
| 20K | 50 | 3.999 | 1.923s | 3.529s | 2.288s | 100% | 0% |
| 20K | 75 | 5.735 | 2.332s | 4.475s | 2.825s | 100% | 0% |
| 20K | 100 | 7.579 | 2.691s | 4.371s | 3.415s | 100% | 0% |
| 20K | 120 | 9.597 | 3.186s | 4.812s | 3.776s | 100% | 0% |
| 20K | 125 | 9.997 | 2.970s | 4.694s | 3.696s | 100% | 0% |
| 20K | 150 | 11.771 | 3.643s | 5.527s | 4.359s | 100% | 0% |
| 50K | 2 | 0.160 | 0.895s | 1.815s | 0.897s | 100% | 0% |
| 50K | 10 | 0.800 | 1.012s | 3.046s | 1.905s | 100% | 0% |
| 50K | 50 | 3.999 | 1.859s | 3.731s | 2.233s | 100% | 0% |
| 50K | 75 | 5.999 | 2.140s | 3.845s | 2.609s | 100% | 0% |
| 50K | 100 | 7.998 | 2.762s | 4.197s | 3.322s | 100% | 0% |
| 50K | 120 | 9.597 | 3.006s | 4.677s | 3.658s | 100% | 0% |
| 50K | 125 | 9.998 | 3.346s | 4.879s | 3.846s | 100% | 0% |
| 50K | 150 | 11.996 | 3.671s | 5.692s | 4.458s | 100% | 0% |

All nine KPI results were present in every successful visit. The 20K run's
slightly lower realized throughput at 75, 100, and 150 VUs came from slow tail
iterations at the end of the fixed window, not failed requests.

## One-VU browser baseline

| Rows | Samples | Strict-ready median | Strict-ready p95 | TTFB p95 | All-widgets p95 | Failures |
|---:|---:|---:|---:|---:|---:|---:|
| 20K | 20 | 35.836s | 39.997s | 0.815s | 39.428s | 0 |
| 50K | 20 | 33.266s | 42.656s | 0.723s | 40.871s | 0 |

The browser metric is dominated by client-side cold-context loading and render
work: both tiers transferred about 15.66 MB, used two analytics round trips, and
had a median JS heap of about 47.4 MB. The API matrix is the more direct measure
of backend scaling.

## Runtime observations

| Fixture | Peak host load1 | Lowest available memory | Peak DB sessions | Peak active DB sessions | Peak PGR CPU | Peak PGR memory | Restarts/OOM |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 20K | 13.96 | 8,310 MiB | 11 | 5 | 275.62% | 1.98% | 0 / no |
| 50K | 17.19 | 8,405 MiB | 11 | 10 | 162.88% | 2.07% | 0 / no |

Postgres recorded at most one waiting session in either run. PGR remained
healthy with restart count zero at every health gate. The 50K diagnostic log
contained no Java heap/OOM, fatal, or panic signal.

## Cleanup verification

The 50K teardown removed exactly 50,000 seeded complaints with zero fixture rows
remaining, restored PGR to `jdbc:postgresql://postgres:5432/egov`, matched the
original configuration fingerprint, and dropped the clone. The post-run check
found no `dashboard_perf_*` databases, a free snapshot advisory lock, a healthy
PGR container, and about 83 GiB free disk. One real complaint arrived while the
isolated run was active, so the original database row count naturally changed
from 2,940 to 2,941; fixture data never touched it.

## Limits and next measurement

Each API cell is a single two-minute main window. The result supports the shape
of the curve and rules out an obvious failure knee through 150 VUs, but it does
not establish long-duration stability or tight error bars. Repeat 120 and 150
VUs three times per tier, then run a 30-minute soak at the selected operating
point before publishing a production capacity number.
