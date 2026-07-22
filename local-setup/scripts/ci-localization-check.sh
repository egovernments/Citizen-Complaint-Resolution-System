#!/bin/bash
# Validates that PGR-critical localization modules have messages loaded.
# Calls the localization search API through Kong and asserts each module
# has at least one message in the default locale (en_IN, tenant pg).
#
# Usage:
#   ci-localization-check.sh [KONG_URL]   # default: http://localhost:18000

set -o pipefail

KONG_URL="${1:-http://localhost:18000}"
LOC_API="$KONG_URL/localization/messages/v1/_search"

echo "=== Localization Module Check ==="
echo "Localization API: $LOC_API"
echo ""

# Core modules that must have messages for PGR to function.
# These are the modules actually seeded into public.message by full-dump.sql.
# NOTE: egov-user was previously listed here but has never been present in the
# dump — the message table only ships rainmaker-common / rainmaker-pgr /
# rainmaker-workbench — so the assertion failed on every run (see #1308).
MODULES=(
  "rainmaker-common"
  "rainmaker-pgr"
)

LOCALE="en_IN"
TENANT="pg"

total=0
passed=0
failures=()

for module in "${MODULES[@]}"; do
  total=$((total + 1))

  response=$(curl -sf --max-time 15 \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"RequestInfo":{"apiId":"Rainmaker"}}' \
    "$LOC_API?locale=$LOCALE&tenantId=$TENANT&module=$module" 2>/dev/null)

  if [ -z "$response" ]; then
    echo -e "[\033[31mFAIL\033[0m] $module — API did not respond"
    failures+=("$module (no response from localization API)")
    continue
  fi

  count=$(echo "$response" | jq 'if .messages then (.messages | length) else 0 end' 2>/dev/null)

  if [ -z "$count" ] || ! [[ "$count" =~ ^[0-9]+$ ]]; then
    echo -e "[\033[31mFAIL\033[0m] $module — unexpected response format"
    echo "  Response: $(echo "$response" | head -c 200)"
    failures+=("$module (unexpected response format)")
    continue
  fi

  if [ "$count" -gt 0 ]; then
    echo -e "[ \033[32m OK \033[0m] $module — $count messages loaded"
    passed=$((passed + 1))
  else
    echo -e "[\033[31mFAIL\033[0m] $module — 0 messages (module not seeded)"
    failures+=("$module (0 messages loaded)")
  fi
done

echo ""
echo "=== Summary: $passed/$total modules have messages ==="

if [ ${#failures[@]} -gt 0 ]; then
  echo ""
  echo "Modules with missing or empty localization:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
