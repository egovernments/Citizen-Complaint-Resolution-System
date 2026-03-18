#!/bin/bash
# Quick health check for all DIGIT core services

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/telemetry.sh" 2>/dev/null || true

BASE_URL="${1:-http://0.0.0.0}"

echo "=== DIGIT Core Services Health Check ==="
echo "Base URL: $BASE_URL"
echo ""

# Skip DIGIT-UI - not required for API tests and has slow startup
services=(
  "Postgres:15432:SELECT 1"
  "Redis:16379:PING"
  "Redpanda:19092:broker"
  "MDMS:18094:/mdms-v2/health"
  "ENC Service:11234:/egov-enc-service/actuator/health"
  "IDGEN:18088:/egov-idgen/health"
  "User:18107:/user/health"
  "Workflow:18109:/egov-workflow-v2/health"
  "Localization:18096:/localization/actuator/health"
  "Boundary-v2:18081:/boundary-service/actuator/health"
  "AccessControl:18090:/access/health"
  "Persister:18091:/common-persist/actuator/health"
  "PGR-Services:18083:/pgr-services/health"
)

total=0
healthy=0

for service in "${services[@]}"; do
  IFS=':' read -r name port path <<< "$service"
  total=$((total + 1))

  # Special handling for non-HTTP services
  if [[ "$name" == "Postgres" ]]; then
    if docker exec docker-postgres pg_isready -U egov >/dev/null 2>&1; then
      echo -e "[\033[32m OK \033[0m] $name (port $port)"
      healthy=$((healthy + 1))
    else
      echo -e "[\033[31mFAIL\033[0m] $name (port $port)"
    fi
  elif [[ "$name" == "Redis" ]]; then
    if docker exec digit-redis redis-cli ping >/dev/null 2>&1; then
      echo -e "[\033[32m OK \033[0m] $name (port $port)"
      healthy=$((healthy + 1))
    else
      echo -e "[\033[31mFAIL\033[0m] $name (port $port)"
    fi
  elif [[ "$name" == "Redpanda" ]]; then
    if docker exec digit-redpanda rpk cluster health >/dev/null 2>&1; then
      echo -e "[\033[32m OK \033[0m] $name (port $port)"
      healthy=$((healthy + 1))
    else
      echo -e "[\033[31mFAIL\033[0m] $name (port $port)"
    fi
  else
    # HTTP services
    response=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL:$port$path" 2>/dev/null)
    if [[ "$response" == "200" ]]; then
      echo -e "[\033[32m OK \033[0m] $name (port $port)"
      healthy=$((healthy + 1))
    else
      echo -e "[\033[31mFAIL\033[0m] $name (port $port) - HTTP $response"
    fi
  fi
done

echo ""
echo "=== Summary: $healthy/$total services healthy ==="

if [[ $healthy -eq $total ]]; then
  send_event setup healthy all-services
  exit 0
else
  exit 1
fi
