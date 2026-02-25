#!/bin/sh
# Telemetry sidecar — monitors Docker Compose lifecycle via the Docker socket
# and sends events to Matomo. Automatically detects which compose file(s) were
# used to start the stack, tracks container start/stop/health transitions, and
# sends a final stop event on "docker compose down" (SIGTERM).
#
# Opt-out: TELEMETRY=false  (same env var as telemetry.sh / telemetry.py)

set -e

# ── Configuration ─────────────────────────────────────────────────
MATOMO_URL="https://unified-demo.digit.org/matomo/matomo.php"
MATOMO_SITE_ID="${MATOMO_SITE_ID:-5}"
DOCKER_SOCKET="/var/run/docker.sock"

# Install curl + jq if missing (alpine base image)
for cmd in curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || apk add --no-cache "$cmd" >/dev/null 2>&1
done

# ── Stable visitor ID (matches telemetry.sh algorithm) ────────────
VISITOR_ID=$(printf '%s%s' \
  "$(cat /etc/hostname 2>/dev/null || hostname)" \
  "$(cat /sys/class/net/eth0/address 2>/dev/null || echo none)" \
  | sha256sum | cut -c1-16)

# ── Telemetry sender (fire-and-forget) ────────────────────────────
send_event() {
  [ "${TELEMETRY:-true}" = "false" ] && return 0
  local category="$1" action="$2" name="$3"
  curl -s -o /dev/null --max-time 5 "$MATOMO_URL" \
    -d "idsite=$MATOMO_SITE_ID" -d "rec=1" \
    -d "e_c=${category}" -d "e_a=${action}" -d "e_n=${name}" \
    -d "_id=$VISITOR_ID" \
    -d "url=app://local-setup/${category}/${action}" \
    -d "apiv=1" 2>/dev/null &
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

# Mark healthy for Docker healthcheck
touch /tmp/healthy

# ── Send start event ──────────────────────────────────────────────
send_event "setup" "start" "docker-compose|files=${COMPOSE_FILES}|containers=${CONTAINER_COUNT}"

# ── Shutdown handler (docker compose down → SIGTERM) ──────────────
shutdown() {
  echo "[telemetry] Shutting down — sending stop event"
  send_event "setup" "stop" "docker-compose|files=${COMPOSE_FILES}"
  sleep 1  # give curl a moment to fire
  exit 0
}
trap shutdown TERM INT

# ── Monitor Docker events for this compose project ────────────────
FILTER=$(printf '{"label":["com.docker.compose.project=%s"],"type":["container"]}' \
  "$COMPOSE_PROJECT" | jq -sRr @uri)

echo "[telemetry] Monitoring container events..."

docker_api "/events?filters=${FILTER}" | while IFS= read -r line; do
  STATUS=$(echo "$line" | jq -r '.status // empty' 2>/dev/null)
  SERVICE=$(echo "$line" | jq -r '.Actor.Attributes["com.docker.compose.service"] // empty' 2>/dev/null)
  [ -z "$SERVICE" ] && continue

  case "$STATUS" in
    start)
      echo "[telemetry] + $SERVICE started"
      send_event "container" "start" "$SERVICE"
      ;;
    die)
      CODE=$(echo "$line" | jq -r '.Actor.Attributes.exitCode // "?"' 2>/dev/null)
      echo "[telemetry] - $SERVICE died (exit=$CODE)"
      send_event "container" "die" "$SERVICE|exit=$CODE"
      ;;
    health_status:unhealthy)
      echo "[telemetry] ! $SERVICE unhealthy"
      send_event "container" "unhealthy" "$SERVICE"
      ;;
    health_status:healthy)
      echo "[telemetry] . $SERVICE healthy"
      ;;
  esac
done &

# Wait for signal (sleep in a loop so trap can fire)
while true; do
  sleep 30 &
  wait $! 2>/dev/null || true
done
