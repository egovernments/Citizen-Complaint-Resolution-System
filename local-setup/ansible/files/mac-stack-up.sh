#!/usr/bin/env bash
# mac-stack-up.sh — bring the DIGIT stack up on macOS/Rosetta.
#
# Why this exists: under Rosetta the JVM services cold-start slower than
# compose's `depends_on: condition: service_healthy` timeouts, so a
# `docker compose up -d` aborts ("dependency failed to start") even
# though the containers it created keep warming and DO go healthy
# moments later. A plain retry loop (no teardown between attempts) lets
# JVM warmth accumulate until it converges.
#
# Two call sites:
#   converge#1 (initial Start DIGIT stack): a one-time clean
#     `down --remove-orphans` (volumes KEPT → db_fast_path dump
#     persists) guarantees a single consistent project network with no
#     leaked endpoints from a prior partial run, THEN the retry loop.
#   converge#2 (post-OpenBao "Recreate services with new env"): set
#     MAC_STACK_UP_SKIP_DOWN=1. The network is already consistent from
#     converge#1 and only .env changed, so we must NOT down — a plain
#     retried `up -d` recreates just the env-changed (JVM) containers,
#     leaves infra + openbao running. This ~halves total deploy time
#     AND avoids recreating/re-sealing openbao (so the post-converge#2
#     OpenBao re-unseal becomes a no-op safety net rather than required).
#
# Do NOT reintroduce per-endpoint `docker network disconnect` between
# attempts: an earlier version did and re-orphaned the still-running
# Postgres from the recreated network → every JVM died with
# `UnknownHostException: postgres`. The single up-front down (converge#1
# only) is what makes the network correct.
#
# Linux never needs this (the playbook runs a plain `up -d` there).
#
# Usage: mac-stack-up.sh <digit_dir> <compose_profiles> <compose_files...>
#   env: MAC_STACK_UP_SKIP_DOWN=1  → skip the clean-baseline down (converge#2)
#        MAC_STACK_UP_MAX (14), MAC_STACK_UP_DELAY (40)
set -uo pipefail

DIGIT_DIR="$1"; NET="$2"; PROFILES="$3"; shift 3
COMPOSE_ARGS="$*"             # e.g. "-f docker-compose.egov-digit.yaml -f docker-compose.fast-path.yml"
MAX="${MAC_STACK_UP_MAX:-10}"
DELAY="${MAC_STACK_UP_DELAY:-35}"

cd "$DIGIT_DIR" || { echo "cannot cd $DIGIT_DIR"; exit 2; }

# 0) Already-converged short-circuit. If every container of this compose
#    project is already running + healthy (containers without a healthcheck
#    just need to be running; one-shot exited-0 jobs are fine), do NOTHING:
#    no down, no up-loop. This makes a *re-run* into a working stack a no-op
#    instead of cold-restarting it via the converge#1 down (~20-45min on
#    Rosetta) or needlessly churning it. The downstream playbook gates
#    (Kong/HRMS health) still run and will catch a genuinely-bad stack, so a
#    false "healthy" is self-correcting. Force a real converge with
#    MAC_STACK_UP_FORCE=1 (e.g. to deliberately rebuild from a clean down).
if [ -z "${MAC_STACK_UP_FORCE:-}" ]; then
  ids="$(COMPOSE_PROFILES="$PROFILES" docker compose $COMPOSE_ARGS ps -q 2>/dev/null || true)"
  if [ -n "$ids" ]; then
    converged=1
    for cid in $ids; do
      info="$(docker inspect -f '{{.State.Status}}|{{.State.ExitCode}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo 'unknown|1|none')"
      st="${info%%|*}"; rest="${info#*|}"; ec="${rest%%|*}"; hh="${rest#*|}"
      case "$st" in
        running)  case "$hh" in healthy|none) : ;; *) converged=0 ;; esac ;;  # 'starting'/'unhealthy' ⇒ not converged
        exited)   [ "$ec" = "0" ] || converged=0 ;;                            # one-shot jobs may exit 0
        *)        converged=0 ;;                                               # restarting/created/dead/...
      esac
      [ "$converged" = 0 ] && break
    done
    if [ "$converged" = 1 ]; then
      echo "mac-stack-up: stack already up & healthy ($(echo "$ids" | wc -w | tr -d ' ') containers) — skipping down + up-loop (no-op; set MAC_STACK_UP_FORCE=1 to override)"
      exit 0
    fi
  fi
fi

# 1) One clean baseline (converge#1 only). Volumes kept → pg dump persists.
#    Skipped for converge#2 (MAC_STACK_UP_SKIP_DOWN=1): network already
#    consistent, only .env changed; a down here would needlessly cold-
#    restart the whole stack (incl. openbao → re-sealed) and ~double the
#    deploy time.
if [ -z "${MAC_STACK_UP_SKIP_DOWN:-}" ]; then
  echo "mac-stack-up: clean baseline (down --remove-orphans, volumes kept)…"
  COMPOSE_PROFILES="$PROFILES" docker compose $COMPOSE_ARGS down --remove-orphans >/dev/null 2>&1 || true
else
  echo "mac-stack-up: SKIP_DOWN set — plain up -d retry (converge#2; preserve infra+openbao)…"
fi

# 2) Plain up -d retry loop; no network surgery, warmth accumulates.
#
# OBSERVABILITY: this runs as an `ansible.builtin.command`, and ansible
# buffers a task's stdout until the task ENDS — so the per-attempt echoes
# below are invisible for the whole 10-40min converge and the operator
# can't tell progress from hang. Fix: append a timestamped, tail-able
# progress line (attempt, reason, live healthy-count) to a STABLE path
# every attempt. While the deploy runs, in another terminal:
#     tail -f /tmp/mac-stack-up.progress
PROG=/tmp/mac-stack-up.progress
ts(){ date '+%H:%M:%S'; }
# up-or-healthy / total for this compose project (reuses the robust
# inspect approach from the already-healthy short-circuit above).
health_summary(){
  local cid s n=0 h=0
  for cid in $(COMPOSE_PROFILES="$PROFILES" docker compose $COMPOSE_ARGS ps -q 2>/dev/null); do
    n=$((n+1))
    s="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo '?')"
    case "$s" in healthy|running) h=$((h+1)) ;; esac
  done
  echo "${h}/${n} up-or-healthy"
}
echo "$(ts) mac-stack-up: START — max ${MAX} attempts, ${DELAY}s apart. tail -f $PROG for live progress." > "$PROG"
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
    msg="$(ts) mac-stack-up: CONVERGED on attempt $i/$MAX — $(health_summary)"
    echo "$msg"; echo "$msg" >> "$PROG"
    exit 0
  fi
  # Leaked-endpoint state is UNRECOVERABLE by retrying — every attempt fails
  # identically until the daemon's network state is rebuilt. Detecting it and
  # looping 14×40s is ~10min of invisible doomed waiting (this cost ~3h once).
  # Fail FAST and loud with the exact remedy instead.
  if grep -qE 'endpoint with name .* already exists' /tmp/mac-stack-up.$i.log; then
    stale="$(grep -oE 'endpoint with name [^ ]+ already exists in network [^ ".]+' /tmp/mac-stack-up.$i.log | tail -1)"
    {
      echo "$(ts) mac-stack-up: ABORT — LEAKED NETWORK ENDPOINT (unrecoverable by retry): ${stale:-endpoint already exists}"
      echo "  Cause: orphaned libnetwork endpoint from a prior/interrupted run. Retrying will NEVER clear it."
      echo "  FIX (zero data loss — volumes/images persist):"
      echo "    1) stop this deploy"
      echo "    2) docker ps -aq | xargs -r docker rm -f"
      echo "    3) restart the engine:  orb stop && orb start   (Docker Desktop: quit & reopen Docker)"
      echo "    4) docker network rm \$(docker network ls --format '{{.Name}}' | grep _egov-network)"
      echo "    5) re-run deploy.sh  PLAIN  (never MAC_STACK_UP_SKIP_DOWN=1 — it skips the down that prevents this)"
    } | tee -a "$PROG" >&2
    exit 3
  fi
  reason="$(grep -oE 'dependency failed to start[^"]*|exited \([0-9]+\)|UnknownHostException: [a-z]+|no space left on device' \
            /tmp/mac-stack-up.$i.log | tail -1)"
  msg="$(ts) mac-stack-up: attempt $i/$MAX not yet converged${reason:+ — $reason} — $(health_summary); JVMs warming ${DELAY}s…"
  echo "$msg"; echo "$msg" >> "$PROG"
  sleep "$DELAY"
done

msg="$(ts) mac-stack-up: did NOT converge after $MAX attempts — $(health_summary)"
echo "$msg" >&2; echo "$msg" >> "$PROG"
exit 1
