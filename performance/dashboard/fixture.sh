#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SQL_DIR="${SCRIPT_DIR}/sql"
ARTIFACT_DIR="${REPO_DIR}/performance/results/dashboard-fixtures"

usage() {
  sed -n '2,95p' "${SCRIPT_DIR}/README.md"
}

die() {
  echo "dashboard fixture: $*" >&2
  exit 2
}

ACTION="${1:-}"
if [[ -z "${ACTION}" ]]; then
  usage
  exit 2
fi
shift

RUN_ID="${DASHBOARD_FIXTURE_RUN_ID:-}"
TIER="${DASHBOARD_FIXTURE_TIER:-3k}"
TENANT_ID="${DASHBOARD_FIXTURE_TENANT:-}"
ANCHOR_TIME="${DASHBOARD_FIXTURE_ANCHOR_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
SERVICE_CODE="${DASHBOARD_FIXTURE_SERVICE_CODE:-}"
LOCALITY_CODE="${DASHBOARD_FIXTURE_LOCALITY:-}"
REFRESH_MODE="${DASHBOARD_FIXTURE_REFRESH_MODE:-blocking}"
ALLOW_EXISTING_CORPUS="${DASHBOARD_FIXTURE_ALLOW_EXISTING_CORPUS:-false}"
COMMAND=()

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-id)
      [[ "$#" -ge 2 ]] || die '--run-id requires a value'
      RUN_ID="$2"
      shift 2
      ;;
    --tier)
      [[ "$#" -ge 2 ]] || die '--tier requires a value'
      TIER="$2"
      shift 2
      ;;
    --tenant)
      [[ "$#" -ge 2 ]] || die '--tenant requires a value'
      TENANT_ID="$2"
      shift 2
      ;;
    --anchor-time)
      [[ "$#" -ge 2 ]] || die '--anchor-time requires a value'
      ANCHOR_TIME="$2"
      shift 2
      ;;
    --service-code)
      [[ "$#" -ge 2 ]] || die '--service-code requires a value'
      SERVICE_CODE="$2"
      shift 2
      ;;
    --locality)
      [[ "$#" -ge 2 ]] || die '--locality requires a value'
      LOCALITY_CODE="$2"
      shift 2
      ;;
    --refresh-mode)
      [[ "$#" -ge 2 ]] || die '--refresh-mode requires a value'
      REFRESH_MODE="$2"
      shift 2
      ;;
    --allow-existing-corpus)
      ALLOW_EXISTING_CORPUS=true
      shift
      ;;
    --)
      shift
      COMMAND=("$@")
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[[ "${RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$ ]] ||
  die 'set --run-id to 3-40 letters, numbers, underscores, or hyphens'

TIER_NORMALIZED="$(printf '%s' "${TIER}" | tr '[:upper:]' '[:lower:]')"
case "${TIER_NORMALIZED}" in
  3k|3000) ROW_COUNT=3000; TIER=3k ;;
  50k|50000) ROW_COUNT=50000; TIER=50k ;;
  100k|100000) ROW_COUNT=100000; TIER=100k ;;
  *) die '--tier must be 3k, 50k, or 100k' ;;
esac

case "${REFRESH_MODE}" in
  blocking) REFRESH_CONCURRENTLY=false ;;
  concurrent) REFRESH_CONCURRENTLY=true ;;
  *) die '--refresh-mode must be blocking or concurrent' ;;
esac

case "${ALLOW_EXISTING_CORPUS}" in
  true|false) ;;
  *) die 'DASHBOARD_FIXTURE_ALLOW_EXISTING_CORPUS must be true or false' ;;
esac

if [[ "${ACTION}" == 'setup' || "${ACTION}" == 'with-fixture' ]]; then
  [[ -n "${TENANT_ID}" ]] || die 'set --tenant or DASHBOARD_FIXTURE_TENANT'
fi

if [[ "${ACTION}" != 'status' && "${DASHBOARD_FIXTURE_ALLOW_MUTATION:-}" != 'yes' ]]; then
  die 'refusing database writes; set DASHBOARD_FIXTURE_ALLOW_MUTATION=yes for this dedicated performance target'
fi

PSQL_CMD=()
PSQL_USES_STDIN=false
if [[ -n "${DASHBOARD_DB_SSH:-}" ]]; then
  [[ -n "${DASHBOARD_DB_CONTAINER:-}" ]] || die 'DASHBOARD_DB_SSH requires DASHBOARD_DB_CONTAINER'
  [[ "${DASHBOARD_DB_CONTAINER}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die 'invalid DASHBOARD_DB_CONTAINER'
  [[ "${DASHBOARD_DB_NAME:-egov}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die 'invalid DASHBOARD_DB_NAME'
  [[ "${DASHBOARD_DB_USER:-egov}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die 'invalid DASHBOARD_DB_USER'
  [[ -z "${DASHBOARD_DB_PASSWORD:-}" ]] || die 'DASHBOARD_DB_PASSWORD is not supported with DASHBOARD_DB_SSH; use target-local PostgreSQL authentication'
  PSQL_CMD=(ssh "${DASHBOARD_DB_SSH}")
  if [[ "${DASHBOARD_DB_SSH_DOCKER_SUDO:-}" == '1' ]]; then PSQL_CMD+=(sudo -n); fi
  PSQL_CMD+=(docker exec -i "${DASHBOARD_DB_CONTAINER}" psql -X -q
    -U "${DASHBOARD_DB_USER:-egov}" -d "${DASHBOARD_DB_NAME:-egov}")
  PSQL_USES_STDIN=true
elif [[ -n "${DASHBOARD_DB_CONTAINER:-}" ]]; then
  command -v docker >/dev/null 2>&1 || die 'docker is required for DASHBOARD_DB_CONTAINER'
  PSQL_CMD=(docker exec -i)
  if [[ -n "${DASHBOARD_DB_PASSWORD:-}" ]]; then
    PSQL_CMD+=(-e "PGPASSWORD=${DASHBOARD_DB_PASSWORD}")
  fi
  PSQL_CMD+=("${DASHBOARD_DB_CONTAINER}" psql -X -q
    -U "${DASHBOARD_DB_USER:-egov}" -d "${DASHBOARD_DB_NAME:-egov}")
  PSQL_USES_STDIN=true
elif [[ -n "${DASHBOARD_DB_URL:-}" ]]; then
  command -v psql >/dev/null 2>&1 || die 'psql is required for DASHBOARD_DB_URL'
  PSQL_CMD=(psql -X -q "${DASHBOARD_DB_URL}")
else
  die 'set DASHBOARD_DB_URL or DASHBOARD_DB_CONTAINER'
fi

run_sql() {
  local sql_file="$1"
  local psql_args=(
    -v ON_ERROR_STOP=1
    -v run_id="${RUN_ID}"
    -v tenant_id="${TENANT_ID}"
    -v row_count="${ROW_COUNT}"
    -v anchor_time="${ANCHOR_TIME}"
    -v service_code="${SERVICE_CODE}"
    -v locality_code="${LOCALITY_CODE}"
    -v refresh_concurrently="${REFRESH_CONCURRENTLY}"
    -v allow_existing_corpus="${ALLOW_EXISTING_CORPUS}"
  )
  if [[ "${PSQL_USES_STDIN}" == true ]]; then
    "${PSQL_CMD[@]}" "${psql_args[@]}" < "${sql_file}"
  else
    "${PSQL_CMD[@]}" "${psql_args[@]}" -f "${sql_file}"
  fi
}

write_status_artifact() {
  local phase="$1"
  local artifact_path="${ARTIFACT_DIR}/${RUN_ID}-${phase}.json"
  local temporary_path="${artifact_path}.tmp"
  mkdir -p "${ARTIFACT_DIR}"
  run_sql "${SQL_DIR}/status.sql" > "${temporary_path}"
  mv "${temporary_path}" "${artifact_path}"
  echo "Fixture status: ${artifact_path}"
}

teardown_fixture() {
  run_sql "${SQL_DIR}/teardown.sql"
  write_status_artifact teardown
}

setup_fixture() {
  echo "Setting up deterministic ${TIER} dashboard fixture '${RUN_ID}' for ${TENANT_ID}"
  echo "Anchor: ${ANCHOR_TIME}; refresh mode: ${REFRESH_MODE}"
  if ! run_sql "${SQL_DIR}/setup.sql"; then
    echo 'Setup failed; attempting run-scoped cleanup.' >&2
    run_sql "${SQL_DIR}/teardown.sql" >/dev/null 2>&1 || true
    return 1
  fi
  write_status_artifact setup
}

case "${ACTION}" in
  setup)
    setup_fixture
    echo "Run teardown with: DASHBOARD_FIXTURE_ALLOW_MUTATION=yes $0 teardown --run-id ${RUN_ID}"
    ;;
  teardown)
    teardown_fixture
    ;;
  status)
    run_sql "${SQL_DIR}/status.sql"
    ;;
  with-fixture)
    [[ "${#COMMAND[@]}" -gt 0 ]] || die 'with-fixture requires -- followed by a command'
    setup_fixture
    fixture_is_active=true
    cleanup_on_exit() {
      if [[ "${fixture_is_active}" == true ]]; then
        fixture_is_active=false
        echo "Tearing down dashboard fixture '${RUN_ID}'"
        teardown_fixture
      fi
    }
    trap cleanup_on_exit EXIT
    trap 'exit 130' INT TERM
    set +e
    RUN_ID="${RUN_ID}" DATASET_TIER="${TIER}" "${COMMAND[@]}"
    command_exit=$?
    set -e
    cleanup_on_exit
    trap - EXIT INT TERM
    exit "${command_exit}"
    ;;
  *)
    die 'action must be setup, status, teardown, or with-fixture'
    ;;
esac
