# Executive Summary

A single-machine DIGIT deployment sustains **125 concurrent users** and **~935,000 complaint lifecycles per day** — **93x the 10,000/day target**. Validated against a live installation carrying real data and daily usage.

## Key Numbers

| | Value |
|-|-------|
| Max sustainable concurrent users | **125 VU** |
| Peak throughput | **43.3 API req/s** (10.8 lifecycles/sec) |
| Daily capacity | **934,762 transactions/day** |
| Breaking point | 150 VU (end-to-end p95 16.14s vs 15s budget) |
| HTTP failures, all levels | **0.000%** |
| Success rate, all levels | **100%** |
| Binding resource | CPU (2-3% idle from 100 VU) |
| Records in database | 2,250 complaints |

## What We Tested

Every test iteration runs one complete PGR complaint lifecycle — **4 API calls** through the full stack:

**CREATE** (file complaint) → **ASSIGN** (route to department) → **RESOLVE** (close it) → **SEARCH** (verify status)

This exercises Kong, PGR Services, Workflow, Persister, Kafka, and Postgres — the entire hot path. Seven concurrency levels were tested — 2, 10, 50, 75, 100, 125 and 150 VUs — each held at peak for 5 minutes.

## Capacity at Scale

Throughput rises linearly to 125 VUs, then flattens:

| VUs | Throughput | API req/s | Daily Capacity |
|-----|-----------|-----------|---------------|
| 50 | 5.2/s | 20.7 | 448K/day |
| 75 | 8.0/s | 31.9 | 689K/day |
| 100 | 9.8/s | 39.3 | 849K/day |
| **125** | **10.8/s** | **43.3** | **935K/day** |
| 150 | 10.9/s | 43.5 | 940K/day |

Going from 125 to 150 VUs adds **0.6% throughput** while p95 latency grows 19%.

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
