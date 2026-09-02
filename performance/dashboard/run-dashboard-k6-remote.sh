#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUN_ID=''
TIER=''
VUS=''
EXPECTED_ROWS=''
LOAD_SSH="${DASHBOARD_LOAD_SSH:-}"
TARGET_SSH="${DASHBOARD_TARGET_SSH:-}"
K6_IMAGE="${DASHBOARD_K6_IMAGE:-grafana/k6@sha256:5221b620a4f874faff6e32ba597aa667c058391fe4898b1c6f6377f062c6cdec}"
SSH_OPTIONS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

die() { echo "dashboard remote k6 runner: $*" >&2; exit 2; }

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
[[ "${LOAD_SSH}" =~ ^[A-Za-z0-9_.@-]+$ ]] || die 'DASHBOARD_LOAD_SSH must be a safe SSH host alias'
[[ "${TARGET_SSH}" =~ ^[A-Za-z0-9_.@-]+$ ]] || die 'DASHBOARD_TARGET_SSH must be a safe SSH host alias'
[[ "${DASHBOARD_DB_CONTAINER:-}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die 'invalid DASHBOARD_DB_CONTAINER'
[[ "${DASHBOARD_DB_NAME:-}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die 'invalid DASHBOARD_DB_NAME'
for name in BASE_URL DIGIT_TENANT DIGIT_USERNAME DIGIT_PASSWORD; do
  [[ -n "${!name:-}" ]] || die "${name} is required"
done

RESULTS_DIR="${REPO_DIR}/performance/results/dashboard-runs/${RUN_ID}-bomet-snapshot-${TIER}-full-${VUS}vu-k6"
REMOTE_DIR="/tmp/digit-dashboard-k6/${RUN_ID}-${VUS}vu"
MONITOR_DIR="/tmp/digit-dashboard-monitor/${RUN_ID}-${VUS}vu"
CONTAINER_NAME="dashboard-k6-${RUN_ID}-${VUS}vu"
mkdir -p "${RESULTS_DIR}"

ssh_retry() {
  local host="$1"
  local command="$2"
  local attempt
  for attempt in $(seq 1 30); do
    if ssh "${SSH_OPTIONS[@]}" "${host}" "${command}"; then return 0; fi
    echo "dashboard remote k6 runner: SSH retry ${attempt}/30 for ${host}" >&2
    sleep 5
  done
  return 1
}

scp_from_retry() {
  local host="$1"
  local remote_path="$2"
  local local_path="$3"
  local attempt
  for attempt in $(seq 1 12); do
    if scp "${SSH_OPTIONS[@]}" "${host}:${remote_path}" "${local_path}"; then return 0; fi
    echo "dashboard remote k6 runner: artifact retry ${attempt}/12 from ${host}" >&2
    sleep 5
  done
  return 1
}

monitor_pid=''
monitor_started=false
stop_monitor() {
  if [[ "${monitor_started}" == true ]]; then
    ssh_retry "${TARGET_SSH}" "sudo -n kill -TERM -- -${monitor_pid} 2>/dev/null || kill -TERM '${monitor_pid}' 2>/dev/null || true" || true
    scp_from_retry "${TARGET_SSH}" "${MONITOR_DIR}/runtime.ndjson" "${RESULTS_DIR}/runtime.ndjson" || true
    scp_from_retry "${TARGET_SSH}" "${MONITOR_DIR}/runtime-monitor.log" "${RESULTS_DIR}/runtime-monitor.log" || true
    ssh_retry "${TARGET_SSH}" "rm -rf -- '${MONITOR_DIR}'" || true
    monitor_started=false
  fi
}
trap stop_monitor EXIT INT TERM

ssh_retry "${LOAD_SSH}" "mkdir -p '${REMOTE_DIR}/scenarios' '${REMOTE_DIR}/helpers' && test ! -e '${REMOTE_DIR}/started'"
scp "${SSH_OPTIONS[@]}" "${REPO_DIR}/performance/k6/scenarios/dashboard-load.js" "${LOAD_SSH}:${REMOTE_DIR}/scenarios/dashboard-load.js"
scp "${SSH_OPTIONS[@]}" "${REPO_DIR}/performance/k6/helpers/auth.js" "${LOAD_SSH}:${REMOTE_DIR}/helpers/auth.js"
ssh_retry "${LOAD_SSH}" "touch '${REMOTE_DIR}/started' && sudo -n docker image inspect '${K6_IMAGE}' >/dev/null"

ssh_retry "${TARGET_SSH}" "mkdir -p '${MONITOR_DIR}'"
scp "${SSH_OPTIONS[@]}" "${SCRIPT_DIR}/monitor-target.sh" "${TARGET_SSH}:${MONITOR_DIR}/monitor-target.sh"
monitor_command="nohup setsid env DASHBOARD_DOCKER_SUDO=${DASHBOARD_TARGET_DOCKER_SUDO:-0} bash '${MONITOR_DIR}/monitor-target.sh' '${DASHBOARD_DB_CONTAINER}' '${DASHBOARD_DB_NAME}' '${DASHBOARD_MONITOR_INTERVAL_SECONDS:-2}' > '${MONITOR_DIR}/runtime.ndjson' 2> '${MONITOR_DIR}/runtime-monitor.log' < /dev/null & echo \$!"
monitor_pid="$(ssh_retry "${TARGET_SSH}" "${monitor_command}")"
[[ "${monitor_pid}" =~ ^[1-9][0-9]*$ ]] || die 'remote target monitor did not return a PID'
monitor_started=true

ssh_retry "${LOAD_SSH}" "uname -a; printf 'nproc='; nproc; free -b; sudo -n docker image inspect '${K6_IMAGE}' --format 'image={{.Id}} architecture={{.Architecture}} os={{.Os}}'" \
  > "${RESULTS_DIR}/load-generator.txt"

printf -v docker_command \
  "sudo -n docker run -d --name %q --network host --user \"\$(id -u):\$(id -g)\" -v %q:/work -w /work -e BASE_URL=%q -e DIGIT_TENANT=%q -e DIGIT_USERNAME=%q -e DIGIT_PASSWORD=%q -e DASHBOARD_AUTH_TENANT=%q -e RUN_ID=%q -e DATASET_TIER=%q -e VUS=%q -e EXPECTED_ROWS=%q -e WARMUP_DURATION=%q -e HOLD_DURATION=%q -e PACING_SECONDS=%q %q run --no-usage-report --summary-trend-stats %q --out csv=/work/metrics.csv --out json=/work/k6-output.json --summary-export=/work/summary.json /work/scenarios/dashboard-load.js" \
  "${CONTAINER_NAME}" "${REMOTE_DIR}" "${BASE_URL}" "${DIGIT_TENANT}" "${DIGIT_USERNAME}" "${DIGIT_PASSWORD}" "${DASHBOARD_AUTH_TENANT:-}" \
  "${RUN_ID}" "${TIER}" "${VUS}" "${EXPECTED_ROWS}" "${DASHBOARD_K6_WARMUP_DURATION:-30s}" "${DASHBOARD_K6_HOLD_DURATION:-2m}" "${DASHBOARD_K6_PACING_SECONDS:-10}" \
  "${K6_IMAGE}" 'avg,min,med,p(80),p(90),p(95),p(99),max'

ssh_retry "${LOAD_SSH}" "sudo -n docker inspect '${CONTAINER_NAME}' >/dev/null 2>&1 && exit 3 || true; ${docker_command}" \
  > "${RESULTS_DIR}/remote-container-id.txt"

state=''
while true; do
  state="$(ssh_retry "${LOAD_SSH}" "sudo -n docker inspect '${CONTAINER_NAME}' --format '{{.State.Running}} {{.State.ExitCode}}'")" || \
    die "lost the remote k6 container; artifacts remain at ${LOAD_SSH}:${REMOTE_DIR}"
  [[ "${state}" != true* ]] && break
  sleep 5
done
k6_exit="${state##* }"

ssh_retry "${LOAD_SSH}" "sudo -n docker logs '${CONTAINER_NAME}'" > "${RESULTS_DIR}/console.log" 2>&1 || true
for artifact in metrics.csv k6-output.json summary.json; do
  scp_from_retry "${LOAD_SSH}" "${REMOTE_DIR}/${artifact}" "${RESULTS_DIR}/${artifact}" || \
    die "failed to retain ${artifact}; remote copy remains at ${LOAD_SSH}:${REMOTE_DIR}"
done
stop_monitor
trap - EXIT INT TERM

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
  printf 'LOAD_GENERATOR_SSH=%q\n' "${LOAD_SSH}"
  printf 'K6_IMAGE=%q\n' "${K6_IMAGE}"
} > "${RESULTS_DIR}/run-manifest.env"

ssh_retry "${LOAD_SSH}" "sudo -n docker rm '${CONTAINER_NAME}' >/dev/null && rm -rf -- '${REMOTE_DIR}'" || \
  echo "dashboard remote k6 runner: retained remote recovery files at ${LOAD_SSH}:${REMOTE_DIR}" >&2

echo "Dashboard remote k6 results: ${RESULTS_DIR}"
exit "${k6_exit}"
