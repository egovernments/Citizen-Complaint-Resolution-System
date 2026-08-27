# Bomet Run — 24 August 2026

First run of the PGR load-test harness against a **real DIGIT installation** rather than a
purpose-built test rig.

Every earlier result in this site (March 2026) was produced on dedicated AWS EC2 machines
against a synthetic `statea.citya` dataset, with the [three database fixes](/findings#recommended-sql-indexes)
applied and only PGR-relevant services running. Bomet is the opposite on all three counts:
a shared KVM guest, the full 59-container DIGIT stack, real users, and **none of the three
fixes applied**. Read the numbers here as "what an untuned real deployment does", not as a
correction to the March tiers.

## Start here

| Document | What it answers |
|---|---|
| [Executive Summary](./executive-summary) | The headline numbers and what they mean |
| [Findings](./findings) | Machine, methodology, capacity curve, degradation behaviour |
| [Capacity Planning](./recommendations-transition-plan) | Sizing and scaling in business terms |

## The one-line result

Bomet sustained **125 concurrent virtual users** and **~43 API requests/second** with
**zero failed requests**, breaching only an end-to-end latency budget at 150 VU. That is
roughly **935,000 complaint lifecycles/day** of theoretical capacity against a deployment
that currently receives **20–100 complaints/day**.

## Raw data

The k6 result files for this run (`metrics.csv`, `k6-output.json`, `summary.json` — ~22 MB)
are **not committed**. They are kept out of the repository deliberately; the tables in these
documents are derived from them and every figure states how it was computed.
