#!/usr/bin/env bash
# Run a single k6 load test
# Usage: ./scripts/run-test.sh <env> <profile> <scenario>
# Example: ./scripts/run-test.sh dev cpu-2 ramp-2vu

set -euo pipefail

TARGET_ENV="${1:?Usage: $0 <env> <profile> <scenario>}"
CPU_PROFILE="${2:?Usage: $0 <env> <profile> <scenario>}"
SCENARIO="${3:?Usage: $0 <env> <profile> <scenario>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RESULT_DIR="${ROOT_DIR}/results/${TIMESTAMP}_${TARGET_ENV}_${CPU_PROFILE}_${SCENARIO}"
RUN_IDENTIFIER="${RUN_ID:-${TIMESTAMP}_${TARGET_ENV}_${SCENARIO}}"
WORKLOAD="${WORKLOAD_PROFILE:-pgr-lifecycle}"
WORKLOAD_STEPS="${PGR_STEPS:-}"
RUN_PRINCIPAL="${PRINCIPAL:-employee}"
RUN_DATASET_TIER="${DATASET_TIER:-unspecified}"
GIT_SHA="$(git -C "${ROOT_DIR}/.." rev-parse --verify HEAD 2>/dev/null || printf 'unknown')"

mkdir -p "$RESULT_DIR"

echo "=== Load Test ==="
echo "Environment: ${TARGET_ENV}"
echo "CPU Profile: ${CPU_PROFILE}"
echo "Scenario:    ${SCENARIO}"
echo "Workload:    ${WORKLOAD} (${WORKLOAD_STEPS:-profile default})"
echo "Run ID:      ${RUN_IDENTIFIER}"
echo "Results:     ${RESULT_DIR}"
echo "================="

{
  printf 'run_id=%q\n' "${RUN_IDENTIFIER}"
  printf 'target=%q\n' "${TARGET_ENV}"
  printf 'cpu_profile=%q\n' "${CPU_PROFILE}"
  printf 'scenario=%q\n' "${SCENARIO}"
  printf 'workload_profile=%q\n' "${WORKLOAD}"
  printf 'pgr_steps=%q\n' "${WORKLOAD_STEPS:-profile-default}"
  printf 'principal=%q\n' "${RUN_PRINCIPAL}"
  printf 'dataset_tier=%q\n' "${RUN_DATASET_TIER}"
  printf 'git_sha=%q\n' "${GIT_SHA}"
  printf 'started_at_utc=%q\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "${RESULT_DIR}/run-manifest.env"

# Run k6
k6 run \
  --no-usage-report \
  --env TARGET="${TARGET_ENV}" \
  --env RUN_ID="${RUN_IDENTIFIER}" \
  --env WORKLOAD_PROFILE="${WORKLOAD}" \
  --env PGR_STEPS="${WORKLOAD_STEPS}" \
  --env PRINCIPAL="${RUN_PRINCIPAL}" \
  --env DATASET_TIER="${RUN_DATASET_TIER}" \
  --out csv="${RESULT_DIR}/metrics.csv" \
  --out json="${RESULT_DIR}/k6-output.json" \
  --summary-export="${RESULT_DIR}/summary.json" \
  "${ROOT_DIR}/k6/scenarios/${SCENARIO}.js" \
  2>&1 | tee "${RESULT_DIR}/console.log"

echo ""
echo "Results saved to: ${RESULT_DIR}"
