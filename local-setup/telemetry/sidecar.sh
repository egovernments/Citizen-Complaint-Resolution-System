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

# Timestamp used for the live event stream (future events only).
# Already-running containers are handled by the startup scan below.
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
ALL_CONTAINERS=$(docker_api "/containers/json" || echo '[]')
CONTAINER_COUNT=$(echo "$ALL_CONTAINERS" \
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

echo "[telemetry] Monitoring container events..."

# ── Emit start/healthy events for containers already up at startup ──
# The sidecar starts after all peers (it is last in docker-compose.yml
# and Tilt deploys it last). The Docker event buffer may have evicted
# both start and health_status events by the time we open the stream.
# Scan the live container list so CI always sees at least one of each.
echo "$ALL_CONTAINERS" \
  | jq -r "[.[] | select(.Labels[\"com.docker.compose.project\"]==\"$COMPOSE_PROJECT\") | .Labels[\"com.docker.compose.service\"]] | unique | .[]" 2>/dev/null \
  | while IFS= read -r svc; do
      [ -z "$svc" ] && continue
      echo "[telemetry] + $svc started"
      send_event "container" "start" "$svc"
    done

# The container list Status field contains "(healthy)" when the container
# has passed its Docker healthcheck — use that instead of the Health
# sub-object which is only available in the inspect endpoint.
echo "$ALL_CONTAINERS" \
  | jq -r "[.[] | select(.Labels[\"com.docker.compose.project\"]==\"$COMPOSE_PROJECT\" and (.Status // \"\" | contains(\"(healthy)\"))) | .Labels[\"com.docker.compose.service\"]] | unique | .[]" 2>/dev/null \
  | while IFS= read -r svc; do
      [ -z "$svc" ] && continue
      echo "[telemetry] . $svc healthy"
      send_event "container" "healthy" "$svc"
    done

docker_api "/events?since=${START_SINCE}&filters=${FILTER}" | while IFS= read -r line; do
  ACTION=$(echo "$line" | jq -r '.Action // empty' 2>/dev/null)
  SERVICE=$(echo "$line" | jq -r '.Actor.Attributes["com.docker.compose.service"] // empty' 2>/dev/null)
  [ -z "$SERVICE" ] && continue

  case "$ACTION" in
    start)
      echo "[telemetry] + $SERVICE started"
      send_event "container" "start" "$SERVICE"
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
