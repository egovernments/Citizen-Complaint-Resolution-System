#!/bin/sh
# Telemetry sidecar — monitors Docker Compose lifecycle via the Docker socket
# and sends events to Matomo. Automatically detects which compose file(s) were
# used to start the stack, tracks container start/stop/health transitions, and
# sends a final stop event on "docker compose down" (SIGTERM).
#
# Opt-out: TELEMETRY=false  (same env var as telemetry.sh / telemetry.py)

# ── Configuration ─────────────────────────────────────────────────
MATOMO_URL="https://unified-demo.digit.org/matomo/matomo.php"
MATOMO_SITE_ID="${MATOMO_SITE_ID:-5}"
DOCKER_SOCKET="/var/run/docker.sock"

# Record start time before package install so events during apk install are not missed
START_SINCE=$(date +%s)

# Install curl + jq if missing (alpine base image)
for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    if ! apk add --no-cache "$cmd" >/dev/null 2>&1; then
      echo "[telemetry] FATAL: failed to install $cmd"
      exit 1
    fi
  fi
done

# Verify Docker socket is accessible
if [ ! -S "$DOCKER_SOCKET" ]; then
  echo "[telemetry] FATAL: Docker socket not found at $DOCKER_SOCKET"
  exit 1
fi

# ── Stable visitor ID (matches telemetry.sh algorithm) ────────────
VISITOR_ID=$(printf '%s%s' \
  "$(cat /etc/hostname 2>/dev/null || hostname)" \
  "$(cat /sys/class/net/eth0/address 2>/dev/null || echo none)" \
  | sha256sum | cut -c1-16)

# ── Telemetry sender (fire-and-forget, backgrounded) ─────────────
# Uses a real user-agent so Matomo doesn't filter it as bot traffic.
UA="Mozilla/5.0 (DIGIT-LocalSetup/1.0; Linux) AppleWebKit/537.36"

send_event() {
  [ "${TELEMETRY:-true}" = "false" ] && return 0
  local category="$1" action="$2" name="$3"
  curl -s -o /dev/null --max-time 5 -A "$UA" "$MATOMO_URL" \
    -d "idsite=$MATOMO_SITE_ID" -d "rec=1" \
    -d "e_c=${category}" -d "e_a=${action}" -d "e_n=${name}" \
    -d "_id=$VISITOR_ID" \
    -d "url=https://local-setup.digit.org/${category}/${action}" \
    -d "apiv=1" 2>/dev/null &
}

# ── Telemetry sender (blocking — used in shutdown handler) ────────
send_event_sync() {
  [ "${TELEMETRY:-true}" = "false" ] && return 0
  local category="$1" action="$2" name="$3"
  curl -s -o /dev/null --max-time 5 -A "$UA" "$MATOMO_URL" \
    -d "idsite=$MATOMO_SITE_ID" -d "rec=1" \
    -d "e_c=${category}" -d "e_a=${action}" -d "e_n=${name}" \
    -d "_id=$VISITOR_ID" \
    -d "url=https://local-setup.digit.org/${category}/${action}" \
    -d "apiv=1" 2>/dev/null || true
}

# ── Docker Engine API helper (via unix socket) ───────────────────
docker_api() {
  curl -s -N --unix-socket "$DOCKER_SOCKET" "http://localhost$1" 2>/dev/null
}

# ── Gather compose metadata from own container labels ─────────────
SELF=$(cat /etc/hostname 2>/dev/null || hostname)
SELF_JSON=$(docker_api "/containers/$SELF/json" || echo '{}')
COMPOSE_FILES=$(echo "$SELF_JSON" | jq -r '.Config.Labels["com.docker.compose.project.config_files"] // "docker-compose.yml"')
COMPOSE_PROJECT=$(echo "$SELF_JSON" | jq -r '.Config.Labels["com.docker.compose.project"] // "local-setup"')
CONTAINER_COUNT=$(docker_api "/containers/json" \
  | jq "[.[] | select(.Labels[\"com.docker.compose.project\"]==\"$COMPOSE_PROJECT\")] | length" 2>/dev/null || echo "?")

echo "[telemetry] project=$COMPOSE_PROJECT"
echo "[telemetry] files=$COMPOSE_FILES"
echo "[telemetry] running=$CONTAINER_COUNT containers"

# Verify we could actually talk to the Docker socket
if [ "$CONTAINER_COUNT" = "?" ] || [ -z "$CONTAINER_COUNT" ]; then
  echo "[telemetry] FATAL: could not query Docker API via socket"
  exit 1
fi

# Mark healthy for Docker healthcheck (only after successful setup)
touch /tmp/healthy

# ── Send start event ──────────────────────────────────────────────
send_event "setup" "start" "docker-compose|files=${COMPOSE_FILES}|containers=${CONTAINER_COUNT}"

# ── Shutdown handler (docker compose down → SIGTERM) ──────────────
# On SIGTERM, keep listening for die events from other containers for
# a few seconds so we capture them, then send the stop summary and exit.
EVENTS_PID=""
SHUTTING_DOWN=""
shutdown() {
  SHUTTING_DOWN=1
  echo "[telemetry] Shutting down — waiting for container die events..."
  # Let the events stream keep running to capture die events from other
  # containers being stopped by "docker compose down". Sleep up to the
  # stop_grace_period minus a small margin.
  sleep 3
  # Kill the events monitor
  [ -n "$EVENTS_PID" ] && kill "$EVENTS_PID" 2>/dev/null
  wait "$EVENTS_PID" 2>/dev/null
  # Count containers still running at shutdown time
  STOP_COUNT=$(docker_api "/containers/json" \
    | jq "[.[] | select(.Labels[\"com.docker.compose.project\"]==\"$COMPOSE_PROJECT\")] | length" 2>/dev/null || echo "?")
  # Synchronous send — blocks until curl completes (max 5s)
  send_event_sync "setup" "stop" "docker-compose|files=${COMPOSE_FILES}|containers=${STOP_COUNT}"
  echo "[telemetry] Stop event sent"
  exit 0
}
trap shutdown TERM INT

# ── Monitor Docker events for this compose project ────────────────
FILTER=$(printf '{"label":["com.docker.compose.project=%s"],"type":["container"]}' \
  "$COMPOSE_PROJECT" | jq -sRr @uri)

# ── Backfill containers already running before the sidecar started ─
# The event stream below only reports events at/after $START_SINCE. Under
# `tilt ci` (and any orchestrator that starts this sidecar after the app
# containers) their "start" events predate that window and would be missed,
# leaving the run with zero start events. Enumerate the already-running
# project containers up front and count each one. Records are keyed by the
# stable container ID (not the service name) so the same container is never
# counted twice across the backfill and the live stream, while distinct
# containers of a scaled service are each counted. The Docker socket/API was
# already validated above (CONTAINER_COUNT), so this enumeration is
# best-effort — an empty result just means no peers are up yet and the live
# stream will catch them.
STARTED_FILE=$(mktemp) || {
  echo "[telemetry] FATAL: could not create temp file for start-event de-dup"
  exit 1
}
TAB=$(printf '\t')

emit_start() {
  _id="$1" _svc="$2"
  [ -z "$_svc" ] && return 0
  # De-dup on the container ID, falling back to the service name if an event
  # carries no ID.
  _key="${_id:-$_svc}"
  if grep -qxF "$_key" "$STARTED_FILE" 2>/dev/null; then
    return 0
  fi
  echo "$_key" >> "$STARTED_FILE"
  echo "[telemetry] + $_svc started"
  send_event "container" "start" "$_svc"
}

# One-shot, time-bounded query (the shared docker_api helper is intentionally
# unbounded for the long-lived events stream below, so use an explicit timeout
# here to guarantee startup cannot block indefinitely).
curl -s --max-time 10 --unix-socket "$DOCKER_SOCKET" "http://localhost/containers/json" 2>/dev/null \
  | jq -r ".[] | select(.Labels[\"com.docker.compose.project\"]==\"$COMPOSE_PROJECT\") | \"\(.Id)\t\(.Labels[\"com.docker.compose.service\"] // \"\")\"" 2>/dev/null \
  | while IFS="$TAB" read -r cid svc; do
      emit_start "$cid" "$svc"
    done

echo "[telemetry] Monitoring container events..."

docker_api "/events?since=${START_SINCE}&filters=${FILTER}" | while IFS= read -r line; do
  ACTION=$(echo "$line" | jq -r '.Action // empty' 2>/dev/null)
  SERVICE=$(echo "$line" | jq -r '.Actor.Attributes["com.docker.compose.service"] // empty' 2>/dev/null)
  [ -z "$SERVICE" ] && continue

  case "$ACTION" in
    start)
      CID=$(echo "$line" | jq -r '.Actor.ID // .id // empty' 2>/dev/null)
      emit_start "$CID" "$SERVICE"
      ;;
    die)
      CODE=$(echo "$line" | jq -r '.Actor.Attributes.exitCode // "?"' 2>/dev/null)
      echo "[telemetry] - $SERVICE died (exit=$CODE)"
      send_event "container" "die" "$SERVICE|exit=$CODE"
      ;;
    "health_status: unhealthy")
      echo "[telemetry] ! $SERVICE unhealthy"
      send_event "container" "unhealthy" "$SERVICE"
      ;;
    "health_status: healthy")
      echo "[telemetry] . $SERVICE healthy"
      send_event "container" "healthy" "$SERVICE"
      ;;
  esac
done &
EVENTS_PID=$!

# Wait for signal (sleep in a loop so trap can fire)
while true; do
  sleep 30 &
  wait $! 2>/dev/null || true
done
