# Executive Summary

A single-machine DIGIT deployment sustains **2.204 complaint lifecycles per second** — **190,426 transactions/day** — at the 16 vCPU profile, **19x the 10,000/day target**. Four CPU profiles were measured against a live installation carrying real data and daily usage.

## Key Numbers

| | Value |
|-|-------|
| Peak sustained throughput | **2.204 lifecycles/sec** (8.80 API req/s) |
| Daily capacity at peak | **190,426 transactions/day** |
| Measured at | 16 vCPU profile, 50 VU |
| VU ceiling (last level under 1% errors) | **80 VU** |
| Peak burst throughput | 2.208 lifecycles/sec at 40 VU |
| 5% error rate crossed at | 320 VU |
| Matrix cells passing all thresholds | 3 of 12 |
| Binding constraint below 8 vCPU | Container CPU quota (host idle 60-90%) |
| Records in database | ~2,300 complaints |

## What We Tested

Every test iteration runs one complete PGR complaint lifecycle — **4 API calls** through the full stack:

**CREATE** (file complaint) → **ASSIGN** (route to department) → **RESOLVE** (close it) → **SEARCH** (verify status)

This exercises Kong, PGR Services, Workflow, Persister, Kafka, and Postgres — the entire hot path.

The campaign has two parts. A **capacity matrix** applies four CPU profiles (2, 4, 8 and 16 vCPU) and runs three concurrency levels under each — 2, 10 and 50 VUs — with throughput measured over the 5-minute hold. A **burst ladder** then runs 20, 40, 80, 160 and 320 VUs under the 16 vCPU profile to locate the VU ceiling by error rate.

## Capacity at Scale

Peak sustained throughput per profile:

| Profile | Peak at | Throughput | API req/s | Daily Capacity | Success |
|---------|---------|-----------|-----------|---------------|---------|
| cpu-2 | 2 VU | 0.066/s | 0.27 | 5,702/day | 100% |
| cpu-4 | 10 VU | 0.216/s | 0.88 | 18,662/day | 100% |
| cpu-8 | 50 VU | 0.693/s | 2.80 | 59,875/day | 100% |
| **cpu-16** | **50 VU** | **2.204/s** | **8.80** | **190,426/day** | **100%** |

Only the 16 vCPU profile is still climbing at the top of the matrix — at 50 VU it is bound by client think time, not by the server. The 8 vCPU profile plateaus at ~0.69 lifecycles/sec from 10 VU up, absorbing further load as latency rather than throughput. The 4 vCPU profile peaks at 10 VU and collapses at 50 VU (15.2% success). The 2 vCPU profile is already saturated below 2 VU.

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
