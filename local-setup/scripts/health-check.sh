#!/bin/bash
# Health check — validates DIGIT services through Kong routing.
#
# Routes through Kong (:18000 by default) to validate the full request
# chain (nginx → Kong routing config → upstream reachability), not just
# "is the JVM alive on its internal port."
#
# Usage:
#   health-check.sh [KONG_URL]            # default: http://localhost:18000
#   health-check.sh http://myserver:18000
#
# Infra services (Postgres, Redis, Redpanda) are checked via docker exec
# since they don't have Kong routes.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/telemetry.sh" 2>/dev/null || true

KONG_URL="${1:-http://localhost:18000}"

echo "=== DIGIT Core Services Health Check ==="
echo "Kong URL: $KONG_URL"
echo ""

# ── Infra services (docker exec — not routed through Kong) ───────────────
infra_checks=(
  "Postgres:docker exec docker-postgres pg_isready -U egov"
  "Redis:docker exec digit-redis redis-cli ping"
  "Redpanda:docker exec digit-redpanda rpk cluster health"
)

# ── HTTP services (routed through Kong) ──────────────────────────────────
# Each entry is "display_name:kong_path". The path must match a registered
# Kong route in kong/kong.yml with strip_path: false so the upstream
# service receives its full context path.
http_services=(
  "MDMS:/mdms-v2/health"
  "User:/user/health"
  "ENC Service:/egov-enc-service/actuator/health"
  "IDGEN:/egov-idgen/health"
  "Workflow:/egov-workflow-v2/health"
  "Localization:/localization/actuator/health"
  "Boundary-v2:/boundary-service/actuator/health"
  "AccessControl:/access/health"
  "Persister:/common-persist/actuator/health"
  "PGR-Services:/pgr-services/health"
)

total=0
healthy=0
failures=()

# ── Infra checks ─────────────────────────────────────────────────────────
for entry in "${infra_checks[@]}"; do
  name="${entry%%:*}"
  cmd="${entry#*:}"
  total=$((total + 1))
  if eval "$cmd" >/dev/null 2>&1; then
    echo -e "[ \033[32m OK \033[0m] $name"
    healthy=$((healthy + 1))
  else
    echo -e "[\033[31mFAIL\033[0m] $name"
    failures+=("$name")
  fi
done

# ── Kong-routed HTTP checks ───────────────────────────────────────────────
for entry in "${http_services[@]}"; do
  name="${entry%%:*}"
  path="${entry#*:}"
  total=$((total + 1))

  url="$KONG_URL$path"
  http_code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null)

  if [[ "$http_code" == "200" ]]; then
    echo -e "[ \033[32m OK \033[0m] $name  ($url)"
    healthy=$((healthy + 1))
  else
    echo -e "[\033[31mFAIL\033[0m] $name  ($url) — HTTP $http_code"
    failures+=("$name (HTTP $http_code via Kong)")
  fi
done

echo ""
echo "=== Summary: $healthy/$total services healthy ==="

if [[ ${#failures[@]} -gt 0 ]]; then
  echo ""
  echo "Failed services:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

send_event setup healthy all-services 2>/dev/null || true
exit 0
