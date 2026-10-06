#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUN_ID=''
TIER=''
VUS=''
EXPECTED_ROWS=''

die() { echo "dashboard k6 runner: $*" >&2; exit 2; }

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-id) [[ "$#" -ge 2 ]] || die '--run-id requires a value'; RUN_ID="$2"; shift 2 ;;
    --tier) [[ "$#" -ge 2 ]] || die '--tier requires a value'; TIER="$2"; shift 2 ;;
    --vus) [[ "$#" -ge 2 ]] || die '--vus requires a value'; VUS="$2"; shift 2 ;;
    --expected-rows) [[ "$#" -ge 2 ]] || die '--expected-rows requires a value'; EXPECTED_ROWS="$2"; shift 2 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ "${RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$ ]] || die 'invalid --run-id'
case "${TIER}" in 3k|20k|50k|100k|500k) ;; *) die 'invalid --tier' ;; esac
[[ "${VUS}" =~ ^[1-9][0-9]*$ ]] || die '--vus must be a positive integer'
[[ "${EXPECTED_ROWS}" =~ ^[1-9][0-9]*$ ]] || die '--expected-rows must be a positive integer'
for name in BASE_URL DIGIT_TENANT DIGIT_USERNAME DIGIT_PASSWORD; do
  [[ -n "${!name:-}" ]] || die "${name} is required"
done
if [[ -n "${DASHBOARD_LOAD_SSH:-}" ]]; then
  exec "${SCRIPT_DIR}/run-dashboard-k6-remote.sh" \
    --run-id "${RUN_ID}" --tier "${TIER}" --vus "${VUS}" --expected-rows "${EXPECTED_ROWS}"
fi
command -v k6 >/dev/null 2>&1 || die 'k6 is required'

RESULTS_DIR="${REPO_DIR}/performance/results/dashboard-runs/${RUN_ID}-bomet-snapshot-${TIER}-full-${VUS}vu-k6"
mkdir -p "${RESULTS_DIR}"
{
  printf 'RUN_ID=%q\n' "${RUN_ID}"
  printf 'TARGET=bomet-snapshot\n'
  printf 'TIER=%q\n' "${TIER}"
  printf 'VUS=%q\n' "${VUS}"
  printf 'EXPECTED_ROWS=%q\n' "${EXPECTED_ROWS}"
  printf 'WARMUP_DURATION=%q\n' "${DASHBOARD_K6_WARMUP_DURATION:-30s}"
  printf 'HOLD_DURATION=%q\n' "${DASHBOARD_K6_HOLD_DURATION:-2m}"
  printf 'PACING_SECONDS=%q\n' "${DASHBOARD_K6_PACING_SECONDS:-10}"
  printf 'TARGET_SHA=%q\n' "${DASHBOARD_TARGET_SHA:-unknown}"
  printf 'HARNESS_SHA=%q\n' "$(git -C "${REPO_DIR}" rev-parse HEAD)"
} > "${RESULTS_DIR}/run-manifest.env"

monitor_pid=''
stop_monitor() {
  if [[ -n "${monitor_pid}" ]] && kill -0 "${monitor_pid}" 2>/dev/null; then
    kill "${monitor_pid}" 2>/dev/null || true
    wait "${monitor_pid}" 2>/dev/null || true
  fi
}
trap stop_monitor EXIT INT TERM

if [[ -n "${DASHBOARD_TARGET_SSH:-}" ]]; then
  monitor_prefix=''
  if [[ "${DASHBOARD_TARGET_DOCKER_SUDO:-}" == '1' ]]; then monitor_prefix='DASHBOARD_DOCKER_SUDO=1 '; fi
  ssh "${DASHBOARD_TARGET_SSH}" \
    "${monitor_prefix}bash -s -- '${DASHBOARD_DB_CONTAINER:-docker-postgres}' '${DASHBOARD_DB_NAME:-egov}' '${DASHBOARD_MONITOR_INTERVAL_SECONDS:-2}'" \
    < "${SCRIPT_DIR}/monitor-target.sh" \
    > "${RESULTS_DIR}/runtime.ndjson" \
    2> "${RESULTS_DIR}/runtime-monitor.log" &
  monitor_pid=$!
  sleep 1
  kill -0 "${monitor_pid}" 2>/dev/null || die 'target runtime monitor failed to start'
fi

set +e
k6 run --no-usage-report \
  --summary-trend-stats 'avg,min,med,p(80),p(90),p(95),p(99),max' \
  --env BASE_URL="${BASE_URL}" \
  --env DIGIT_TENANT="${DIGIT_TENANT}" \
  --env DIGIT_USERNAME="${DIGIT_USERNAME}" \
  --env DIGIT_PASSWORD="${DIGIT_PASSWORD}" \
  --env DASHBOARD_AUTH_TENANT="${DASHBOARD_AUTH_TENANT:-}" \
  --env RUN_ID="${RUN_ID}" \
  --env DATASET_TIER="${TIER}" \
  --env VUS="${VUS}" \
  --env EXPECTED_ROWS="${EXPECTED_ROWS}" \
  --env WARMUP_DURATION="${DASHBOARD_K6_WARMUP_DURATION:-30s}" \
  --env HOLD_DURATION="${DASHBOARD_K6_HOLD_DURATION:-2m}" \
  --env PACING_SECONDS="${DASHBOARD_K6_PACING_SECONDS:-10}" \
  --out csv="${RESULTS_DIR}/metrics.csv" \
  --out json="${RESULTS_DIR}/k6-output.json" \
  --summary-export="${RESULTS_DIR}/summary.json" \
  "${REPO_DIR}/performance/k6/scenarios/dashboard-load.js" \
  2>&1 | tee "${RESULTS_DIR}/console.log"
k6_exit="${PIPESTATUS[0]}"
set -e
stop_monitor
trap - EXIT INT TERM

run_complete=no
case "${k6_exit}" in
  0|99) run_complete=yes ;;
esac
{
  printf 'K6_EXIT_CODE=%q\n' "${k6_exit}"
  printf 'RUN_COMPLETE=%q\n' "${run_complete}"
} >> "${RESULTS_DIR}/run-manifest.env"

echo "Dashboard k6 results: ${RESULTS_DIR}"
exit "${k6_exit}"
