#!/bin/bash
# Validates the Gatus health dashboard API.
# Calls the Gatus status API and asserts every monitored endpoint's latest
# result is successful. Fails with the list of unhealthy endpoints.
#
# Usage:
#   ci-gatus-check.sh [GATUS_URL]   # default: http://localhost:18889

set -o pipefail

GATUS_URL="${1:-http://localhost:18889}"
API="$GATUS_URL/api/v1/endpoints/statuses"

echo "=== Gatus Health Dashboard Check ==="
echo "API: $API"
echo ""

# Wait up to 60s for the Gatus API to respond (it may still be starting).
for i in $(seq 1 12); do
  if curl -sf --max-time 5 "$API" -o /dev/null 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 12 ]; then
    echo "FAIL: Gatus API not reachable at $API after 60s"
    exit 1
  fi
  echo "  Waiting for Gatus API... ($((i * 5))s)"
  sleep 5
done

response=$(curl -sf --max-time 15 "$API" 2>/dev/null)
if [ -z "$response" ]; then
  echo "FAIL: Gatus API returned empty response"
  exit 1
fi

total=0
passed=0
failures=()

while IFS= read -r endpoint; do
  name=$(echo "$endpoint" | jq -r '.name')
  group=$(echo "$endpoint" | jq -r '.group')
  # results[0] is the most recent check result
  success=$(echo "$endpoint" | jq -r 'if (.results | length) > 0 then .results[0].success else false end')
  total=$((total + 1))

  if [ "$success" = "true" ]; then
    echo -e "[ \033[32m OK \033[0m] [$group] $name"
    passed=$((passed + 1))
  else
    echo -e "[\033[31mFAIL\033[0m] [$group] $name"
    failures+=("[$group] $name")
  fi
done < <(echo "$response" | jq -c '.[]')

echo ""
echo "=== Summary: $passed/$total endpoints healthy ==="

if [ ${#failures[@]} -gt 0 ]; then
  echo ""
  echo "Unhealthy endpoints:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
