#!/bin/bash
# Telemetry for DIGIT local-setup via Matomo HTTP Tracking API
# Usage: source scripts/telemetry.sh && send_event <category> <action> <name>
# Opt-out: export TELEMETRY=false

MATOMO_URL="https://unified-demo.digit.org/matomo/matomo.php"
MATOMO_SITE_ID="${MATOMO_SITE_ID:-1}"

_telemetry_visitor_id() {
  # Stable visitor ID: SHA256(hostname + first MAC address), truncated to 16 hex chars
  local raw
  raw="$(hostname)$(cat /sys/class/net/$(ip route show default 2>/dev/null | awk '/default/ {print $5}' | head -1)/address 2>/dev/null || echo 'no-mac')"
  echo -n "$raw" | sha256sum | cut -c1-16
}

send_event() {
  # Skip if opted out
  if [[ "${TELEMETRY:-true}" == "false" ]]; then
    return 0
  fi

  local category="${1:?usage: send_event <category> <action> [name]}"
  local action="${2:?usage: send_event <category> <action> [name]}"
  local name="${3:-}"
  local visitor_id
  visitor_id=$(_telemetry_visitor_id)

  # Fire-and-forget: don't block the caller, ignore errors
  curl -s -o /dev/null --max-time 5 \
    "${MATOMO_URL}" \
    -d "idsite=${MATOMO_SITE_ID}" \
    -d "rec=1" \
    -d "e_c=${category}" \
    -d "e_a=${action}" \
    -d "e_n=${name}" \
    -d "_id=${visitor_id}" \
    -d "url=app://local-setup/${category}/${action}" \
    -d "apiv=1" \
    2>/dev/null &
}
