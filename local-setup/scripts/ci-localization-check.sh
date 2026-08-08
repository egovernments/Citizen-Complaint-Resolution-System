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
# These are the modules actually seeded by the full-dump.sql load.
#
# `egov-user` was listed here from the start (22a1457c) and has never passed:
# full-dump.sql contains NO egov-user rows, and never has -- checked back
# through every revision of the dump. The module distribution it does carry is
# rainmaker-pgr (852), rainmaker-common (734), rainmaker-hr (244),
# rainmaker-workbench (228), digit-privacy-policy (5), egov-hrms (2).
#
# So this check has failed on every PR in the repo since it landed, which is
# worse than not having it: a check that is always red is one nobody reads, and
# it masked the real signal on ~37 monitoring PRs.
#
# Removed rather than "fixed" by seeding, because nothing appears to want it --
# the SPA requests rainmaker-common, rainmaker-pgr, rainmaker-dashboard,
# rainmaker-boundary-admin, egov-hrms and egov-mdms-service, not egov-user.
# If those messages ARE required, seeding them is a dump change and belongs in
# its own PR; this list is documented as "modules actually seeded", so it should
# describe reality either way.
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
