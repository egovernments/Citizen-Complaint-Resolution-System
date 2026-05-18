#!/usr/bin/env bash
# mac-stack-up.sh — bring the DIGIT stack up on macOS/Rosetta.
#
# Why this exists: under Rosetta the JVM services cold-start slower than
# compose's `depends_on: condition: service_healthy` timeouts, so the
# first `docker compose up -d` aborts ("dependency failed to start")
# even though the containers it created keep warming and DO go healthy
# moments later. A plain retry then fails differently: the aborted up
# leaves leaked network endpoints, so the next up collides with
# "endpoint <svc> already exists in network".
#
# Recovery (preserves accumulated JVM warmth — does NOT `down`):
#   loop:
#     - disconnect ONLY non-running containers' leaked endpoints from
#       the project network (running containers are left untouched)
#     - `up -d` (no-op for healthy ones; starts any "Created" ones whose
#       deps are now healthy)
#     - exit 0 the moment up -d returns 0 (all deps satisfied)
# Converges as JVMs warm. Linux never needs this (handled by the
# playbook's plain up -d on non-Darwin).
#
# Usage: mac-stack-up.sh <digit_dir> <net_name> <compose_profiles> <compose_files...>
set -uo pipefail

DIGIT_DIR="$1"; NET="$2"; PROFILES="$3"; shift 3
COMPOSE_ARGS="$*"             # e.g. "-f docker-compose.egov-digit.yaml -f docker-compose.fast-path.yml"
MAX="${MAC_STACK_UP_MAX:-10}"
DELAY="${MAC_STACK_UP_DELAY:-35}"

cd "$DIGIT_DIR" || { echo "cannot cd $DIGIT_DIR"; exit 2; }

for i in $(seq 1 "$MAX"); do
  # Clear leaked endpoints belonging to containers that are NOT running
  # (a leaked endpoint blocks recreation of that service on the next up).
  for ep in $(docker network inspect "$NET" \
        --format '{{range $k,$v := .Containers}}{{$v.Name}} {{end}}' 2>/dev/null); do
    st="$(docker inspect "$ep" --format '{{.State.Status}}' 2>/dev/null || echo gone)"
    if [ "$st" != "running" ]; then
      docker network disconnect -f "$NET" "$ep" >/dev/null 2>&1 || true
    fi
  done

  if COMPOSE_PROFILES="$PROFILES" docker compose $COMPOSE_ARGS up -d >/tmp/mac-stack-up.$i.log 2>&1; then
    echo "mac-stack-up: converged on attempt $i/$MAX"
    exit 0
  fi
  reason="$(grep -oE 'dependency failed to start[^"]*|endpoint with name [^ ]* already exists|exited \([0-9]+\)' \
            /tmp/mac-stack-up.$i.log | tail -1)"
  echo "mac-stack-up: attempt $i/$MAX not yet converged${reason:+ — $reason}; warming ${DELAY}s…"
  sleep "$DELAY"
done

echo "mac-stack-up: did NOT converge after $MAX attempts" >&2
exit 1
