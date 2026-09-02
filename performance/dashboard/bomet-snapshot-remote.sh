#!/usr/bin/env bash

set -euo pipefail

ACTION="${1:-}"
RUN_ID="${2:-}"
CLONE_DB="${3:-}"
ROOT_DIR='/opt/digit/performance-snapshots'
STATE_DIR="${ROOT_DIR}/${RUN_ID}"
LOCK_DIR="${ROOT_DIR}/active"
POSTGRES_CONTAINER='docker-postgres'
PGR_CONTAINER='digit-pgr-services-1'

note() { echo "bomet snapshot: $*" >&2; }
die() { note "$*"; exit 2; }

[[ "${ACTION}" == 'setup' || "${ACTION}" == 'activate' || "${ACTION}" == 'restore' || "${ACTION}" == 'preflight' ]] || die 'action must be preflight, setup, activate, or restore'
[[ "${RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$ ]] || die 'invalid run ID'
[[ "${CLONE_DB}" =~ ^dashboard_perf_[A-Za-z0-9_]+$ ]] || die 'invalid clone database name'
command -v jq >/dev/null || die 'jq is required'
command -v sha256sum >/dev/null || die 'sha256sum is required'
sudo -n docker info >/dev/null || die 'passwordless sudo Docker access is required'

config_fingerprint() {
  sudo -n docker inspect "$1" --format '{{json .Config}}' |
    jq -c '{Env: ((.Env // []) | sort), Cmd, Entrypoint, WorkingDir, User}' |
    sha256sum | awk '{print $1}'
}

image_id() {
  sudo -n docker inspect "$1" --format '{{.Image}}'
}

datasource_url() {
  sudo -n docker inspect "$1" --format '{{json .Config.Env}}' |
    jq -r '.[] | select(startswith("SPRING_DATASOURCE_URL=")) | split("=")[1:] | join("=")'
}

compose_command() {
  local compose_files_file="${STATE_DIR}/compose-files"
  local args=(sudo -n docker compose -p digit)
  while IFS= read -r compose_file; do
    [[ -n "${compose_file}" ]] && args+=(-f "${compose_file}")
  done < "${compose_files_file}"
  "${args[@]}" "$@"
}

wait_for_pgr() {
  local expected_db="$1"
  for _ in $(seq 1 60); do
    if [[ "$(sudo -n docker inspect "${PGR_CONTAINER}" --format '{{.State.Running}}' 2>/dev/null || true)" == 'true' ]] &&
       [[ "$(datasource_url "${PGR_CONTAINER}")" == "jdbc:postgresql://postgres:5432/${expected_db}" ]]; then
      return 0
    fi
    sleep 1
  done
  die "PGR did not start against ${expected_db}"
}

db_scalar() {
  local database="$1"
  local sql="$2"
  sudo -n docker exec "${POSTGRES_CONTAINER}" psql -X -U egov -d "${database}" -Atc "${sql}"
}

available_bytes() {
  df -PB1 /var/lib/docker | awk 'NR==2 {print $4}'
}

preflight_snapshot() {
  local free_bytes database_bytes pgr_rows active_sessions clone_exists source_url
  free_bytes="$(available_bytes)"
  database_bytes="$(db_scalar egov 'SELECT pg_database_size(current_database())')"
  pgr_rows="$(db_scalar egov 'SELECT count(*) FROM eg_pgr_service_v2')"
  active_sessions="$(db_scalar egov "SELECT count(*) FROM pg_stat_activity WHERE datname='egov' AND pid <> pg_backend_pid()")"
  clone_exists="$(db_scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${CLONE_DB}'")"
  source_url="$(datasource_url "${PGR_CONTAINER}")"
  [[ "${source_url}" == 'jdbc:postgresql://postgres:5432/egov' ]] || die "PGR is not connected to the original database: ${source_url}"
  [[ "${clone_exists}" == '0' ]] || die "clone database already exists: ${CLONE_DB}"
  [[ ! -e "${LOCK_DIR}" ]] || die "snapshot lock already exists: ${LOCK_DIR}"
  [[ "${free_bytes}" -ge 53687091200 ]] || die "at least 50 GiB free is required; found ${free_bytes} bytes"
  jq -n \
    --arg runId "${RUN_ID}" \
    --arg cloneDatabase "${CLONE_DB}" \
    --argjson freeBytes "${free_bytes}" \
    --argjson sourceDatabaseBytes "${database_bytes}" \
    --argjson sourcePgrRows "${pgr_rows}" \
    --argjson activeSessions "${active_sessions}" \
    '{phase:"preflight",runId:$runId,cloneDatabase:$cloneDatabase,freeBytes:$freeBytes,sourceDatabaseBytes:$sourceDatabaseBytes,sourcePgrRows:$sourcePgrRows,activeSessions:$activeSessions,pgrDatasource:"egov",snapshotLockFree:true}'
}

setup_snapshot() {
  sudo -n mkdir -p "${ROOT_DIR}"
  if ! sudo -n mkdir "${LOCK_DIR}" 2>/dev/null; then
    active_run="$(sudo -n cat "${LOCK_DIR}/run-id" 2>/dev/null || echo unknown)"
    die "another snapshot run is active: ${active_run}"
  fi
  sudo -n sh -c "printf '%s\n' '${RUN_ID}' > '${LOCK_DIR}/run-id'"
  sudo -n mkdir "${STATE_DIR}" || die "state directory already exists: ${STATE_DIR}"

  local original_url original_config original_image compose_files dump_path
  original_url="$(datasource_url "${PGR_CONTAINER}")"
  [[ "${original_url}" == 'jdbc:postgresql://postgres:5432/egov' ]] || die "unexpected original PGR datasource: ${original_url}"
  original_config="$(config_fingerprint "${PGR_CONTAINER}")"
  original_image="$(image_id "${PGR_CONTAINER}")"
  compose_files="$(sudo -n docker inspect "${PGR_CONTAINER}" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')"
  [[ -n "${compose_files}" ]] || die 'PGR Compose file labels are missing'
  printf '%s' "${compose_files}" | tr ',' '\n' | sudo -n tee "${STATE_DIR}/compose-files" >/dev/null
  sudo -n sh -c "printf '%s\n' '${original_config}' > '${STATE_DIR}/original-config-fingerprint'"
  sudo -n sh -c "printf '%s\n' '${original_image}' > '${STATE_DIR}/original-image-id'"
  sudo -n sh -c "printf '%s\n' '${CLONE_DB}' > '${STATE_DIR}/clone-database'"
  db_scalar egov "SELECT count(*) FROM eg_pgr_service_v2" | sudo -n tee "${STATE_DIR}/original-pgr-count" >/dev/null
  db_scalar egov "SELECT pg_database_size(current_database())" | sudo -n tee "${STATE_DIR}/original-db-size" >/dev/null

  [[ "$(db_scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${CLONE_DB}'")" == '0' ]] || die "clone database already exists: ${CLONE_DB}"
  dump_path="${STATE_DIR}/egov.dump"
  note 'creating transactionally consistent logical snapshot'
  sudo -n sh -c "docker exec '${POSTGRES_CONTAINER}' pg_dump -Fc -U egov -d egov > '${dump_path}'"
  sudo -n sha256sum "${dump_path}" | awk '{print $1}' | sudo -n tee "${STATE_DIR}/dump-sha256" >/dev/null

  note "restoring snapshot into disposable database ${CLONE_DB}"
  sudo -n docker exec "${POSTGRES_CONTAINER}" createdb -U egov -T template0 "${CLONE_DB}"
  sudo -n sh -c "docker exec -i '${POSTGRES_CONTAINER}' pg_restore -U egov -d '${CLONE_DB}' --exit-on-error < '${dump_path}'"
  clone_size="$(db_scalar "${CLONE_DB}" 'SELECT pg_database_size(current_database())')"
  free_after_restore="$(available_bytes)"
  sudo -n sh -c "printf '%s\n' '${clone_size}' > '${STATE_DIR}/clone-db-size'"
  [[ "${free_after_restore}" -ge 32212254720 ]] || die "less than 30 GiB remains after clone restore: ${free_after_restore} bytes"

  sudo -n tee "${STATE_DIR}/pgr-override.yml" >/dev/null <<EOF
services:
  pgr-services:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/${CLONE_DB}
      PGR_DASHBOARD_REFRESH_ENABLED: "false"
      PGR_ESCALATION_ENABLED: "false"
EOF

  jq -n \
    --arg runId "${RUN_ID}" \
    --arg cloneDatabase "${CLONE_DB}" \
    --arg dumpSha256 "$(sudo -n cat "${STATE_DIR}/dump-sha256")" \
    --argjson originalPgrRows "$(sudo -n cat "${STATE_DIR}/original-pgr-count")" \
    --argjson originalDatabaseBytes "$(sudo -n cat "${STATE_DIR}/original-db-size")" \
    --argjson cloneDatabaseBytes "$(sudo -n cat "${STATE_DIR}/clone-db-size")" \
    --argjson freeBytesAfterRestore "${free_after_restore}" \
    '{phase:"setup",runId:$runId,cloneDatabase:$cloneDatabase,dumpSha256:$dumpSha256,originalPgrRows:$originalPgrRows,originalDatabaseBytes:$originalDatabaseBytes,cloneDatabaseBytes:$cloneDatabaseBytes,freeBytesAfterRestore:$freeBytesAfterRestore,pgrDatasource:"egov",cloneReadyForReset:true,fixtureMutatedOriginalDatabase:false}'
}

activate_snapshot() {
  [[ -d "${STATE_DIR}" ]] || die "snapshot state does not exist: ${STATE_DIR}"
  [[ "$(sudo -n cat "${LOCK_DIR}/run-id" 2>/dev/null || true)" == "${RUN_ID}" ]] || die 'active snapshot lock belongs to another run'
  [[ "$(sudo -n cat "${STATE_DIR}/clone-database" 2>/dev/null || true)" == "${CLONE_DB}" ]] || die 'clone database does not match snapshot state'
  [[ "$(db_scalar "${CLONE_DB}" "SELECT count(*) FROM pg_trigger WHERE tgname='dashboard_perf_write_guard' AND tgenabled='O'")" == '1' ]] || die 'clone PGR write guard is not active'
  [[ "$(db_scalar "${CLONE_DB}" 'SELECT count(*) FROM eg_pgr_service_v2')" == '0' ]] || die 'clone must contain zero complaints before activation'
  note 'switching only pgr-services to the guarded disposable clone'
  compose_command -f "${STATE_DIR}/pgr-override.yml" up -d --no-deps --force-recreate pgr-services >&2
  wait_for_pgr "${CLONE_DB}"
  jq -n --arg runId "${RUN_ID}" --arg cloneDatabase "${CLONE_DB}" \
    '{phase:"activate",runId:$runId,cloneDatabase:$cloneDatabase,pgrDatasource:"clone",externalPgrWritesBlocked:true}'
}

restore_snapshot() {
  [[ -d "${STATE_DIR}" ]] || die "snapshot state does not exist: ${STATE_DIR}"
  [[ "$(sudo -n cat "${LOCK_DIR}/run-id" 2>/dev/null || true)" == "${RUN_ID}" ]] || die 'active snapshot lock belongs to another run'
  [[ "$(sudo -n cat "${STATE_DIR}/clone-database" 2>/dev/null || true)" == "${CLONE_DB}" ]] || die 'clone database does not match snapshot state'
  if [[ "$(datasource_url "${PGR_CONTAINER}")" != 'jdbc:postgresql://postgres:5432/egov' ]]; then
    note 'restoring pgr-services to the original database configuration'
    compose_command up -d --no-deps --force-recreate pgr-services >&2
    wait_for_pgr egov
  else
    note 'pgr-services is already on the original database'
  fi

  local restored_config restored_image original_config original_image original_count current_count clone_remaining
  restored_config="$(config_fingerprint "${PGR_CONTAINER}")"
  restored_image="$(image_id "${PGR_CONTAINER}")"
  original_config="$(sudo -n cat "${STATE_DIR}/original-config-fingerprint")"
  original_image="$(sudo -n cat "${STATE_DIR}/original-image-id")"
  [[ "${restored_config}" == "${original_config}" ]] || die 'restored PGR runtime configuration does not match the original fingerprint'
  [[ "${restored_image}" == "${original_image}" ]] || die 'restored PGR image does not match the original immutable image ID'

  original_count="$(sudo -n cat "${STATE_DIR}/original-pgr-count")"
  current_count="$(db_scalar egov 'SELECT count(*) FROM eg_pgr_service_v2')"
  [[ "${current_count}" == "${original_count}" ]] || die "original PGR row count changed during maintenance window: ${original_count} -> ${current_count}"
  clone_remaining="$(db_scalar "${CLONE_DB}" 'SELECT count(*) FROM eg_pgr_service_v2')"
  [[ "${clone_remaining}" == '0' ]] || die "fixture cleanup failed: ${clone_remaining} complaints remain in the clone"

  note "dropping disposable database ${CLONE_DB}"
  if [[ "$(db_scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${CLONE_DB}'")" == '1' ]]; then
    sudo -n docker exec "${POSTGRES_CONTAINER}" dropdb -U egov --force "${CLONE_DB}"
  fi
  jq -n \
    --arg runId "${RUN_ID}" \
    --arg cloneDatabase "${CLONE_DB}" \
    --argjson restoredPgrRows "${current_count}" \
    '{phase:"restore",runId:$runId,cloneDatabase:$cloneDatabase,fixtureMutatedOriginalDatabase:false,pgrDatasource:"egov",restoredPgrRows:$restoredPgrRows,cloneDropped:true,configurationRestored:true}'
  sudo -n rm -f -- \
    "${STATE_DIR}/compose-files" \
    "${STATE_DIR}/original-config-fingerprint" \
    "${STATE_DIR}/original-image-id" \
    "${STATE_DIR}/clone-database" \
    "${STATE_DIR}/original-pgr-count" \
    "${STATE_DIR}/original-db-size" \
    "${STATE_DIR}/clone-db-size" \
    "${STATE_DIR}/dump-sha256" \
    "${STATE_DIR}/egov.dump" \
    "${STATE_DIR}/pgr-override.yml"
  sudo -n rmdir -- "${STATE_DIR}"
  sudo -n rm -f -- "${LOCK_DIR}/run-id"
  sudo -n rmdir -- "${LOCK_DIR}"
}

case "${ACTION}" in
  preflight) preflight_snapshot ;;
  setup) setup_snapshot ;;
  activate) activate_snapshot ;;
  restore) restore_snapshot ;;
esac
