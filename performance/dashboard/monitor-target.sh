#!/usr/bin/env bash

set -euo pipefail

POSTGRES_CONTAINER="${1:-docker-postgres}"
DATABASE="${2:-egov}"
INTERVAL_SECONDS="${3:-2}"

[[ "${POSTGRES_CONTAINER}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || exit 2
[[ "${DATABASE}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || exit 2
[[ "${INTERVAL_SECONDS}" =~ ^[1-9][0-9]*$ ]] || exit 2
command -v jq >/dev/null

DOCKER=(docker)
if [[ "${DASHBOARD_DOCKER_SUDO:-}" == '1' ]]; then DOCKER=(sudo -n docker); fi
"${DOCKER[@]}" info >/dev/null

trap 'exit 0' INT TERM HUP

while true; do
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  load="$(cut -d' ' -f1-3 /proc/loadavg)"
  memory_available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
  memory_total_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  pgr_state="$("${DOCKER[@]}" inspect digit-pgr-services-1 --format '{{json .State}}')"
  pgr_restarts="$("${DOCKER[@]}" inspect digit-pgr-services-1 --format '{{.RestartCount}}')"
  containers="$("${DOCKER[@]}" stats --no-stream --format '{{json .}}' | jq -sc '
    map(select(
      (.Name | test("pgr-services|postgres|pgbouncer|kong|digit-ui|workflow|persister|kafka|redpanda"; "i"))
    ) | {
      name: .Name,
      cpu: .CPUPerc,
      memory: .MemUsage,
      memoryPercent: .MemPerc,
      pids: .PIDs,
      blockIO: .BlockIO,
      networkIO: .NetIO
    })
  ')"
  database_stats="$("${DOCKER[@]}" exec "${POSTGRES_CONTAINER}" psql -X -U egov -d "${DATABASE}" -Atc "
    SELECT json_build_object(
      'connections', (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()),
      'active', (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active'),
      'waiting', (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type IS NOT NULL),
      'xactCommit', xact_commit,
      'xactRollback', xact_rollback,
      'blocksRead', blks_read,
      'blocksHit', blks_hit,
      'tempFiles', temp_files,
      'tempBytes', temp_bytes,
      'deadlocks', deadlocks
    ) FROM pg_stat_database WHERE datname=current_database();
  ")"

  jq -cn \
    --arg timestamp "${timestamp}" \
    --arg load "${load}" \
    --argjson memoryAvailableKiB "${memory_available_kib}" \
    --argjson memoryTotalKiB "${memory_total_kib}" \
    --argjson pgr "${pgr_state}" \
    --argjson pgrRestarts "${pgr_restarts}" \
    --argjson containers "${containers}" \
    --argjson postgres "${database_stats}" \
    '{timestamp:$timestamp,host:{loadAverage:$load,memoryAvailableKiB:$memoryAvailableKiB,memoryTotalKiB:$memoryTotalKiB},pgr:{running:$pgr.Running,health:($pgr.Health.Status // null),oomKilled:$pgr.OOMKilled,restartCount:$pgrRestarts},postgres:$postgres,containers:$containers}'
  sleep "${INTERVAL_SECONDS}"
done
