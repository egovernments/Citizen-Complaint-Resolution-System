#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SSH_TARGET="${BOMET_SNAPSHOT_SSH:-bomet}"
RUN_ID=''
TIER='3k'
PRINCIPAL='full'
RUNNER_ARGS=()
DRY_RUN=false
PROBE_ONLY=false
LOAD_VUS_LIST=''

die() { echo "bomet snapshot runner: $*" >&2; exit 2; }

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-id)
      [[ "$#" -ge 2 ]] || die '--run-id requires a value'
      RUN_ID="$2"; RUNNER_ARGS+=("$1" "$2"); shift 2 ;;
    --tier)
      [[ "$#" -ge 2 ]] || die '--tier requires a value'
      TIER="$2"; RUNNER_ARGS+=("$1" "$2"); shift 2 ;;
    --principal)
      [[ "$#" -ge 2 ]] || die '--principal requires a value'
      PRINCIPAL="$2"; RUNNER_ARGS+=("$1" "$2"); shift 2 ;;
    --target|--fixture|--base-url|--tenant)
      die "$1 is controlled by the Bomet snapshot wrapper" ;;
    --dry-run) DRY_RUN=true; RUNNER_ARGS+=("$1"); shift ;;
    --probe-only) PROBE_ONLY=true; shift ;;
    --load-vus)
      [[ "$#" -ge 2 ]] || die '--load-vus requires a comma-separated list'
      LOAD_VUS_LIST="$2"; shift 2 ;;
    *) RUNNER_ARGS+=("$1"); shift ;;
  esac
done

[[ "${RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$ ]] || die '--run-id is required and must be 3-40 safe characters'
[[ "${BOMET_SNAPSHOT_ALLOW_MUTATION:-}" == 'yes' ]] || die 'set BOMET_SNAPSHOT_ALLOW_MUTATION=yes'
[[ "${BOMET_MAINTENANCE_CONFIRMED:-}" == 'yes' ]] || die 'set BOMET_MAINTENANCE_CONFIRMED=yes after blocking real PGR submissions'
[[ "${DASHBOARD_FIXTURE_ALLOW_MUTATION:-}" == 'yes' ]] || die 'set DASHBOARD_FIXTURE_ALLOW_MUTATION=yes'
[[ "${DASHBOARD_SCHEDULED_REFRESH_DISABLED:-}" == 'yes' ]] || die 'set DASHBOARD_SCHEDULED_REFRESH_DISABLED=yes'
[[ "${DASHBOARD_ESCALATION_DISABLED:-}" == 'yes' ]] || die 'set DASHBOARD_ESCALATION_DISABLED=yes'

case "${TIER}" in
  3k) EXPECTED_ROWS=3000 ;;
  20k) EXPECTED_ROWS=20000 ;;
  50k) EXPECTED_ROWS=50000 ;;
  100k) EXPECTED_ROWS=100000 ;;
  *) die '--tier must be 3k, 20k, 50k, or 100k' ;;
esac

LOAD_VUS=()
if [[ -n "${LOAD_VUS_LIST}" ]]; then
  IFS=',' read -r -a LOAD_VUS <<< "${LOAD_VUS_LIST}"
  [[ "${#LOAD_VUS[@]}" -gt 0 ]] || die '--load-vus cannot be empty'
  for vus in "${LOAD_VUS[@]}"; do
    [[ "${vus}" =~ ^[1-9][0-9]*$ ]] || die "invalid VU level: ${vus}"
  done
  command -v k6 >/dev/null 2>&1 || die 'k6 is required for --load-vus'
fi

DB_SUFFIX="$(printf '%s' "${RUN_ID}" | tr '-' '_' | tr '[:upper:]' '[:lower:]')"
CLONE_DB="dashboard_perf_${DB_SUFFIX}"
LIFECYCLE_DIR="${REPO_DIR}/performance/results/dashboard-runs/${RUN_ID}-bomet-snapshot-lifecycle"
mkdir -p "${LIFECYCLE_DIR}"
if [[ "${DRY_RUN}" == true ]]; then
  ssh "${SSH_TARGET}" 'bash -s -- preflight '"${RUN_ID}"' '"${CLONE_DB}" \
    < "${SCRIPT_DIR}/bomet-snapshot-remote.sh" > "${LIFECYCLE_DIR}/preflight.json"
  jq . "${LIFECYCLE_DIR}/preflight.json"
  BOMET_SNAPSHOT_ACTIVE=yes \
  DASHBOARD_DATASET_VERIFIED=yes \
  DASHBOARD_DB_SSH="${SSH_TARGET}" \
  DASHBOARD_DB_NAME="${CLONE_DB}" \
    "${SCRIPT_DIR}/run-playwright.sh" --target bomet-snapshot --fixture off "${RUNNER_ARGS[@]}"
  exit 0
fi
snapshot_started=false
fixture_active=false

cleanup_snapshot() {
  local cleanup_exit=0
  if [[ "${fixture_active}" == true ]]; then
    fixture_active=false
    if ! "${SCRIPT_DIR}/fixture.sh" teardown --run-id "${RUN_ID}" --tier "${TIER}" --tenant ke; then
      echo 'bomet snapshot runner: automatic fixture teardown failed' >&2
      cleanup_exit=1
    fi
    teardown_status="${REPO_DIR}/performance/results/dashboard-fixtures/${RUN_ID}-teardown.json"
    [[ ! -f "${teardown_status}" ]] || cp "${teardown_status}" "${LIFECYCLE_DIR}/fixture-teardown.json"
  fi
  if [[ "${snapshot_started}" == true ]]; then
    ssh "${SSH_TARGET}" 'bash -s -- diagnose '"${RUN_ID}"' '"${CLONE_DB}" \
      < "${SCRIPT_DIR}/bomet-snapshot-remote.sh" > "${LIFECYCLE_DIR}/pre-restore-diagnostics.json" || true
    snapshot_started=false
    if ! ssh "${SSH_TARGET}" 'bash -s -- restore '"${RUN_ID}"' '"${CLONE_DB}" \
      < "${SCRIPT_DIR}/bomet-snapshot-remote.sh" > "${LIFECYCLE_DIR}/restore.json"; then
      echo 'bomet snapshot runner: automatic restore failed; keep the maintenance window active and run restore manually' >&2
      cleanup_exit=1
    fi
  fi
  return "${cleanup_exit}"
}
trap 'cleanup_snapshot' EXIT
trap 'exit 130' INT TERM

export BASE_URL='https://bometfeedbackhub.digit.org'
export DIGIT_TENANT=ke
export BOMET_SNAPSHOT_ACTIVE=yes
export DASHBOARD_EXTERNAL_FIXTURE=yes
export DASHBOARD_TARGET_SSH="${SSH_TARGET}"
export DASHBOARD_TARGET_DOCKER_SUDO=1
export DASHBOARD_DB_SSH="${SSH_TARGET}"
export DASHBOARD_DB_SSH_DOCKER_SUDO=1
export DASHBOARD_DB_CONTAINER=docker-postgres
export DASHBOARD_DB_USER=egov
export DASHBOARD_DB_NAME="${CLONE_DB}"

ssh "${SSH_TARGET}" 'bash -s -- preflight '"${RUN_ID}"' '"${CLONE_DB}" \
  < "${SCRIPT_DIR}/bomet-snapshot-remote.sh" > "${LIFECYCLE_DIR}/preflight.json"

snapshot_started=true
ssh "${SSH_TARGET}" 'bash -s -- setup '"${RUN_ID}"' '"${CLONE_DB}" \
  < "${SCRIPT_DIR}/bomet-snapshot-remote.sh" > "${LIFECYCLE_DIR}/setup.json"

ssh "${SSH_TARGET}" sudo -n docker exec -i docker-postgres psql -X -q \
  -U egov -d "${CLONE_DB}" -v ON_ERROR_STOP=1 \
  < "${SCRIPT_DIR}/sql/empty-pgr-clone.sql"

"${SCRIPT_DIR}/fixture.sh" setup --run-id "${RUN_ID}" --tier "${TIER}" --tenant ke
fixture_active=true
fixture_status="${REPO_DIR}/performance/results/dashboard-fixtures/${RUN_ID}-setup.json"
[[ ! -f "${fixture_status}" ]] || cp "${fixture_status}" "${LIFECYCLE_DIR}/fixture-setup.json"

ssh "${SSH_TARGET}" 'bash -s -- activate '"${RUN_ID}"' '"${CLONE_DB}"' '"${EXPECTED_ROWS}" \
  < "${SCRIPT_DIR}/bomet-snapshot-remote.sh" > "${LIFECYCLE_DIR}/activate.json"

node "${SCRIPT_DIR}/probe-analytics.mjs" "${EXPECTED_ROWS}" > "${LIFECYCLE_DIR}/analytics-probe.json"

ssh "${SSH_TARGET}" 'bash -s -- diagnose '"${RUN_ID}"' '"${CLONE_DB}" \
  < "${SCRIPT_DIR}/bomet-snapshot-remote.sh" > "${LIFECYCLE_DIR}/pre-load-diagnostics.json"
baseline_restart_count="$(jq -r '.container.restartCount' "${LIFECYCLE_DIR}/pre-load-diagnostics.json")"

run_exit=0
if [[ "${PROBE_ONLY}" == false ]]; then
  export DASHBOARD_DATASET_VERIFIED=yes
  set +e
  "${SCRIPT_DIR}/run-playwright.sh" --target bomet-snapshot --fixture off \
    "${RUNNER_ARGS[@]}"
  run_exit=$?
  set -e

  for vus in "${LOAD_VUS[@]}"; do
    echo "Running dashboard API load at ${TIER} / ${vus} VUs"
    set +e
    "${SCRIPT_DIR}/run-dashboard-k6.sh" \
      --run-id "${RUN_ID}" --tier "${TIER}" --vus "${vus}" --expected-rows "${EXPECTED_ROWS}"
    level_exit=$?
    set -e
    if [[ "${level_exit}" -ne 0 && "${run_exit}" -eq 0 ]]; then run_exit="${level_exit}"; fi

    diagnostic_path="${LIFECYCLE_DIR}/post-${vus}vu-diagnostics.json"
    ssh "${SSH_TARGET}" 'bash -s -- diagnose '"${RUN_ID}"' '"${CLONE_DB}" \
      < "${SCRIPT_DIR}/bomet-snapshot-remote.sh" > "${diagnostic_path}"
    if ! jq -e --argjson baselineRestarts "${baseline_restart_count}" '
      .container.running == true and
      .container.health == "healthy" and
      .container.oomKilled == false and
      .container.restartCount == $baselineRestarts and
      (.postgres.totalSessions < (.postgres.maxConnections * 0.9))
    ' "${diagnostic_path}" >/dev/null; then
      echo "bomet snapshot runner: health gate failed after ${vus} VUs; refusing higher load" >&2
      run_exit=1
      break
    fi
  done
fi

restore_exit=0
cleanup_snapshot || restore_exit=$?
trap - EXIT INT TERM
if [[ "${restore_exit}" -ne 0 ]]; then exit "${restore_exit}"; fi
exit "${run_exit}"
