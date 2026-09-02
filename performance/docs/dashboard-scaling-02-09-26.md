# Dashboard scaling on Bomet — 2 September 2026

## Result

The dashboard read path completed the 20K, 50K, 100K, and 500K complaint
matrices through 150 virtual users without an HTTP failure, partial analytics
response, PGR restart, or OOM. At every level the harness offered one dashboard
visit per VU per 10 seconds. A visit makes a pack request, a catalog request,
and one batched analytics request, so 150 VUs produced 15 dashboard visits/s
and 46.125 HTTP requests/s.

There is no throughput failure cliff through 150 VUs, but 500K complaints
produce a clear latency and database-contention knee. Its dashboard p95 grows
from 1.20 s at 10 VUs to 4.48 s at 50, 7.15 s at 100, and 10.84 s at 150.
At 150 VUs its p99 is 16.04 s. PostgreSQL reaches all 18 observed connections
and records waiting sessions from 10 VUs onward. The 100K fixture remains below
5.1 s at p95 through 150 VUs.

## Test shape

- Target: the existing Bomet deployment used for Dhruv's baseline: 16 vCPU,
  30.6 GiB RAM, with the rest of the stack running.
- Load generator: separate `ovh-8c24g` host: 8 vCPU and 24 GiB RAM, using the
  pinned k6 image digest recorded by the harness.
- PGR image under test:
  `sha256:6af21d546f53258a0d92adb41e7094c08a24bfe89c3dddec0036d6c887503bb3`.
- Data: deterministic complaint lifecycle distributions activated through a
  disposable database snapshot clone. The 500K fixture contained 500,000
  complaints, 1,355,000 workflow events, 500,000 materialized facts, and
  175,000 daily snapshot rows.
- API load: 30-second warm-up and two-minute main window at 2, 10, 50, 75, 100,
  120, 125, and 150 VUs. Each VU reads the pack, catalog, and all nine selected
  KPI results, then paces the visit to 10 seconds.
- Valid run IDs: `issue1109-scale3-20260902` (20K),
  `issue1109-scale5-20260902-50k` (50K),
  `issue1109-scale10-20260902-100k-api` (100K), and
  `issue1109-scale11-20260902-500k-api` (500K).

The VU levels match Dhruv's clean Bomet 2/10/50/75/100/125/150 ladder, with
120 added because it was his repeated fixed-dataset checkpoint. Dhruv's test
performed complaint create/assign/resolve/search writes and used think time;
this dashboard scenario is read-only, so transaction latency is not directly
comparable. Offered HTTP throughput is comparable context: this test reaches
46.125 HTTP RPS at 150 VUs versus approximately 43.37 RPS in Dhruv's clean
150-VU Bomet run.

## API matrix

`Loads/s` and `HTTP RPS` below cover only the two-minute main window. An earlier
summary divided by the full 150-second scenario, including warm-up, and
underreported 20K/50K throughput by 20%; these are the corrected values.

| Complaints | VUs | Loads/s | HTTP RPS | Dashboard p50 | p80 | p90 | p95 | p99 | Success | HTTP failures |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20K | 2 | 0.2 | 0.608 | 0.864s | 0.942s | 1.422s | 2.463s | 2.622s | 100% | 0% |
| 20K | 10 | 1.0 | 3.075 | 1.073s | 1.840s | 2.161s | 2.664s | 2.893s | 100% | 0% |
| 20K | 50 | 5.0 | 15.375 | 1.923s | 2.577s | 3.137s | 3.529s | 4.779s | 100% | 0% |
| 20K | 75 | 7.5 | 23.067 | 2.332s | 3.166s | 3.681s | 4.475s | 6.356s | 100% | 0% |
| 20K | 100 | 10.0 | 30.750 | 2.691s | 3.676s | 4.011s | 4.371s | 7.156s | 100% | 0% |
| 20K | 120 | 12.0 | 36.900 | 3.186s | 4.101s | 4.443s | 4.812s | 5.489s | 100% | 0% |
| 20K | 125 | 12.5 | 38.442 | 2.970s | 3.878s | 4.291s | 4.694s | 5.429s | 100% | 0% |
| 20K | 150 | 15.0 | 46.125 | 3.643s | 4.645s | 5.039s | 5.527s | 6.621s | 100% | 0% |
| 50K | 2 | 0.2 | 0.608 | 0.895s | 1.023s | 1.356s | 1.815s | 1.953s | 100% | 0% |
| 50K | 10 | 1.0 | 3.075 | 1.012s | 1.882s | 2.544s | 3.046s | 5.041s | 100% | 0% |
| 50K | 50 | 5.0 | 15.375 | 1.859s | 2.490s | 3.176s | 3.731s | 4.982s | 100% | 0% |
| 50K | 75 | 7.5 | 23.067 | 2.140s | 2.915s | 3.268s | 3.845s | 4.821s | 100% | 0% |
| 50K | 100 | 10.0 | 30.750 | 2.762s | 3.608s | 3.978s | 4.197s | 4.865s | 100% | 0% |
| 50K | 120 | 12.0 | 36.900 | 3.006s | 3.912s | 4.286s | 4.678s | 5.508s | 100% | 0% |
| 50K | 125 | 12.5 | 38.442 | 3.346s | 4.175s | 4.524s | 4.879s | 5.483s | 100% | 0% |
| 50K | 150 | 15.0 | 46.125 | 3.671s | 4.767s | 5.233s | 5.692s | 6.571s | 100% | 0% |
| 100K | 2 | 0.2 | 0.608 | 0.442s | 0.461s | 0.489s | 0.490s | 0.696s | 100% | 0% |
| 100K | 10 | 1.0 | 3.075 | 0.477s | 0.529s | 0.590s | 0.683s | 0.769s | 100% | 0% |
| 100K | 50 | 5.0 | 15.375 | 1.414s | 1.485s | 1.519s | 1.894s | 1.981s | 100% | 0% |
| 100K | 75 | 7.5 | 23.067 | 2.028s | 2.105s | 2.147s | 2.598s | 2.667s | 100% | 0% |
| 100K | 100 | 10.0 | 30.750 | 2.431s | 2.617s | 2.695s | 2.934s | 3.021s | 100% | 0% |
| 100K | 120 | 12.0 | 36.900 | 2.842s | 3.054s | 3.162s | 3.751s | 3.894s | 100% | 0% |
| 100K | 125 | 12.5 | 38.442 | 3.038s | 3.196s | 3.389s | 3.862s | 3.971s | 100% | 0% |
| 100K | 150 | 15.0 | 46.125 | 3.744s | 3.931s | 4.896s | 5.041s | 5.156s | 100% | 0% |
| 500K | 2 | 0.2 | 0.608 | 0.490s | 0.502s | 0.518s | 0.522s | 0.671s | 100% | 0% |
| 500K | 10 | 1.0 | 3.075 | 0.849s | 0.932s | 0.973s | 1.199s | 1.233s | 100% | 0% |
| 500K | 50 | 5.0 | 15.375 | 3.063s | 3.512s | 4.102s | 4.484s | 4.586s | 100% | 0% |
| 500K | 75 | 7.5 | 23.067 | 4.559s | 4.804s | 4.989s | 5.146s | 5.216s | 100% | 0% |
| 500K | 100 | 10.0 | 30.750 | 6.053s | 6.784s | 7.081s | 7.152s | 7.209s | 100% | 0% |
| 500K | 120 | 12.0 | 36.900 | 7.150s | 7.752s | 8.118s | 8.835s | 9.000s | 100% | 0% |
| 500K | 125 | 12.5 | 38.442 | 7.450s | 8.276s | 8.665s | 9.936s | 10.042s | 100% | 0% |
| 500K | 150 | 15.0 | 46.125 | 8.213s | 9.376s | 9.766s | 10.837s | 16.037s | 100% | 0% |

All nine KPI results were present in every successful visit. Throughput remains
pacing-limited at all four data sizes; the 500K result is a latency limit before
it is an error-rate or throughput limit.

The 100K run was made after the setup began running `ANALYZE` on the seeded base
tables and materialized views. Its unexpectedly lower latency than the older
20K/50K cells should not be interpreted as data making queries faster; repeat
those smaller tiers with the same setup before using cross-tier deltas as a
formal comparison. The 100K-to-500K comparison does use the same setup.

## Browser baseline

| Complaints | Valid samples | Strict-ready p50 | p80 | p90 | p95/p99 | TTFB p95 | Transfer | Failures |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20K | 20 | 35.836s | — | — | 39.997s | 0.815s | ~15.66 MB | 0 |
| 50K | 20 | 33.266s | — | — | 42.656s | 0.723s | ~15.66 MB | 0 |
| 100K | 17 | 35.332s | 40.026s | 41.913s | 42.908s | 0.798s | ~15.66 MB | 0 valid-sample failures |

The 100K browser cycle obtained 17 of the intended 20 measured samples before
the load-controller network changed. The three later authentication/DNS
attempts are excluded because they never reached Bomet. No 500K browser cycle
was run; the complete 500K result here is the backend/API matrix.

Browser strict-ready time is dominated by client-side cold-context loading and
rendering. The near-constant transfer size and sub-second TTFB reinforce that
the API matrix is the direct backend-scaling measurement.

## Runtime observations

| Fixture | Peak host load1 | Lowest available memory | Peak DB sessions | Peak active | Peak waiting | Peak PGR CPU | Peak PGR memory | Restarts/OOM |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20K | 13.96 | 8,310 MiB | 11 | 5 | 1 | 275.62% | 1.98% | 0 / no |
| 50K | 17.19 | 8,405 MiB | 11 | 10 | 1 | 162.88% | 2.07% | 0 / no |
| 100K | 23.63 | 7,802 MiB | 11 | 11 | 1 | 275.41% | 2.17% | 0 / no |
| 500K | 38.10 | 8,058 MiB | 18 | 18 | 17 | 253.25% | 2.26% | 0 / no |

Spot sampling during the 500K run showed periodic `DataFileRead`,
`BufferMapping`, and `SpinDelay` waits rather than a blocking transaction or
advisory-lock queue. This is consistent with database I/O/buffer contention.
The service and host stayed available throughout the matrix.

## 500K saturation extension

A follow-up run (`issue1109-scale12-20260903-500k-high`) extended only the 500K
fixture beyond 150 VUs. It located the throughput plateau without taking PGR
down:

| VUs | Offered loads/s | Realized loads/s | HTTP RPS | Dashboard p50 | p95 | p99 | Success/failures |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 150 | 15.0 | 15.00 | 46.125 | 8.213s | 10.837s | 16.037s | 100% / 0% |
| 175 | 17.5 | 16.42 | 50.567 | 10.164s | 14.378s | 17.959s | 100% / 0% |
| 200 | 20.0 | 16.09 | 49.775 | 12.468s | 17.562s | 22.376s | 100% / 0% |

At 175 VUs the closed-loop generator falls 6.2% below the pacing target. At
200 VUs it falls 19.5% below target and produces 1.6% less HTTP throughput than
175 VUs despite 14.3% more concurrency. This is the observed saturation point:
the service remains functionally successful, but extra concurrency adds queue
time and reduces throughput. The 200-VU cell also fails the harness interactive
latency threshold of dashboard p95 below 15 seconds.

At 175/200 VUs, peak host load1 was 31.30/30.22, PostgreSQL reached all 18
observed connections with up to 15/13 waiting, and lowest available memory was
8,138/7,861 MiB. PGR remained healthy with zero restarts and no OOM. A 225-VU
stage was stopped early once the plateau was established; its partial artifacts
are retained but explicitly excluded from the matrix.

## Cleanup verification

The 100K and 500K teardown passes removed exactly their seeded complaint counts
with zero fixture rows remaining. After the final run, PGR was restored to
`jdbc:postgresql://postgres:5432/egov`, the disposable database was dropped,
the original database still contained 2,945 complaints, the advisory lock was
free, and PGR was healthy with zero restarts/OOM. Bomet had about 80 GiB free.

## Capacity interpretation and next measurement

- Through 100K complaints, 150 VUs / 15 dashboard loads/s stays near a 5-second
  dashboard p95 with no errors.
- At 500K, 10 VUs is still near 1.2 seconds p95, but 50 VUs reaches 4.5 seconds
  and database waits appear. Treat 50 VUs as the start of the degradation band,
  not a recommended capacity target.
- At 500K and 150 VUs the system remains functional, but 10.84-second p95 and
  16.04-second p99 are too slow for an interactive dashboard SLO.
- The 500K throughput ceiling in this configuration is approximately 50 HTTP
  RPS (16.1–16.4 dashboard loads/s); 200 VUs adds latency without capacity.

Each cell is one two-minute main window. Repeat the intended operating point at
least three times, then run a 30-minute soak before publishing a production
capacity number. Add a 500K Playwright baseline only if client-render behavior
at that data size is required; it is not needed to locate the backend knee.
