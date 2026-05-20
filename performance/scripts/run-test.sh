#!/usr/bin/env bash
# Run a single k6 load test
# Usage: ./scripts/run-test.sh <env> <profile> <scenario>
# Example: ./scripts/run-test.sh dev cpu-2 ramp-2vu

set -euo pipefail

ENV="${1:?Usage: $0 <env> <profile> <scenario>}"
PROFILE="${2:?Usage: $0 <env> <profile> <scenario>}"
SCENARIO="${3:?Usage: $0 <env> <profile> <scenario>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RESULT_DIR="${ROOT_DIR}/results/${TIMESTAMP}_${ENV}_${PROFILE}_${SCENARIO}"

mkdir -p "$RESULT_DIR"

echo "=== Load Test ==="
echo "Environment: ${ENV}"
echo "CPU Profile: ${PROFILE}"
echo "Scenario:    ${SCENARIO}"
echo "Results:     ${RESULT_DIR}"
echo "================="

# Run k6
k6 run \
  --no-usage-report \
  --env TARGET="${ENV}" \
  --out csv="${RESULT_DIR}/metrics.csv" \
  --out json="${RESULT_DIR}/k6-output.json" \
  --summary-export="${RESULT_DIR}/summary.json" \
  "${ROOT_DIR}/k6/scenarios/${SCENARIO}.js" \
  2>&1 | tee "${RESULT_DIR}/console.log"

echo ""
echo "Results saved to: ${RESULT_DIR}"
