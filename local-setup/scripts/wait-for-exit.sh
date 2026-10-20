#!/usr/bin/env bash
# Block until a one-shot container has run to completion, and exit with its result.
#
# Usage: scripts/wait-for-exit.sh <container> [timeout-seconds]
#
# The Tiltfiles gate pgr-services on this. Tilt starts each service with
# `docker compose up --no-deps`, so compose's `service_completed_successfully`
# condition is never applied, and a Tilt resource_deps on the one-shot itself
# only waits for its container to start. Without this, PGR boots while its
# migrations are still running and loses complaints filed in that window.
set -u

name=${1:?usage: wait-for-exit.sh <container> [timeout-seconds]}
timeout=${2:-600}

waited=0
while [ "$waited" -lt "$timeout" ]; do
  # StartedAt stays at 0001-01-01 until the container has run once, so a container
  # that is only "created" is not mistaken for one that already exited.
  state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}} {{.State.StartedAt}}' "$name" 2>/dev/null)
  read -r status code started <<<"$state"
  if [ "${status:-}" = exited ] && [ "${started#0001-}" = "$started" ]; then
    if [ "$code" = 0 ]; then
      echo "$name completed successfully"
      exit 0
    fi
    echo "$name exited with code $code. Last log lines:" >&2
    docker logs --tail 40 "$name" >&2
    exit 1
  fi
  sleep 2
  waited=$((waited + 2))
done

echo "$name did not finish within ${timeout}s (state: ${state:-missing})" >&2
exit 1
