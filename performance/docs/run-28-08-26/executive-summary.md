# Executive Summary

A single-machine DIGIT deployment sustains **125 concurrent users** and **931,824 complaint transactions per day** — **93x the 10,000/day target**. Validated against a live installation carrying real data and daily usage. A separate CPU-profile matrix measured the same stack under constrained per-service CPU budgets.

## Key Numbers

| | Value |
|-|-------|
| Max sustainable concurrent users | **125 VU** |
| Peak throughput | **43.15 API req/s** (10.785 lifecycles/sec) |
| Daily capacity | **931,824 transactions/day** |
| Breaking point | 150 VU (end-to-end p95 16.38s vs 15s budget) |
| HTTP failures, all levels | **0.000%** |
| Success rate, all levels | **100%** |
| Records in database | ~2,300 complaints |

## What We Tested

Every test iteration runs one complete PGR complaint lifecycle — **4 API calls** through the full stack:

**CREATE** (file complaint) → **ASSIGN** (route to department) → **RESOLVE** (close it) → **SEARCH** (verify status)

This exercises Kong, PGR Services, Workflow, Persister, Kafka, and Postgres — the entire hot path. Seven concurrency levels were tested — 2, 10, 50, 75, 100, 125 and 150 VUs — each held at peak for 5 minutes, with no CPU limits applied.

## Capacity at Scale

Throughput rises linearly to 125 VUs, then flattens:

| VUs | Throughput | API req/s | Daily Capacity | p95 Latency |
|-----|-----------|-----------|---------------|-------------|
| 2 | 0.214/s | 0.86 | 18,490/day | 416ms |
| 10 | 1.054/s | 4.20 | 91,066/day | 407ms |
| 50 | 5.165/s | 20.66 | 446,256/day | 517ms |
| 75 | 7.947/s | 31.78 | 686,621/day | 456ms |
| 100 | 9.798/s | 39.20 | 846,547/day | 794ms |
| **125** | **10.785/s** | **43.15** | **931,824/day** | 1,413ms |
| 150 | 10.851/s | 43.37 | 937,526/day | 2,477ms |

Going from 125 to 150 VUs adds **0.6% throughput** while server p95 latency grows 75% and the end-to-end budget is breached.

## Constrained CPU Profiles

A second campaign capped the DIGIT services with `docker update` to measure smaller budgets on the same host. These figures are **not** equivalent to machines of that size — a profile pins each service to a fixed slice, whereas an unthrottled machine lets services burst into each other's idle headroom.

| Profile | Peak at | Throughput | API req/s | Daily Capacity | Success |
|---------|---------|-----------|-----------|---------------|---------|
| cpu-2 | 2 VU | 0.066/s | 0.27 | 5,702/day | 100% |
| cpu-4 | 10 VU | 0.216/s | 0.88 | 18,662/day | 100% |
| cpu-8 | 50 VU | 0.693/s | 2.80 | 59,875/day | 100% |
| cpu-16 | 50 VU | 2.204/s | 8.80 | 190,426/day | 100% |

Measured on the same host at 50 VU, `cpu-16` returned 2.204 lifecycles/sec at 6,621ms server p95 while the unthrottled machine returned 5.165 lifecycles/sec at 517ms. Treat the profile figures as conservative floors, not as vCPU-equivalent machine sizes.

## Test Infrastructure

| Component | Spec |
|-----------|------|
| CPU | AMD EPYC-Rome, 16 vCPU |
| Memory | 30 GiB |
| Disk | 305 GB SSD (non-rotational) |
| OS / runtime | Ubuntu 24.04.4 LTS, Docker 29.4.0 |
| Virtualisation | KVM guest |
| Services | 59 containers (full DIGIT stack) |
| Load generator | k6, remote control machine, ~185ms RTT |
