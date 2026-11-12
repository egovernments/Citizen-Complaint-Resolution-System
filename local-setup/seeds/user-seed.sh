#!/bin/bash
# User Seed Script - Creates default admin users via egov-user API
# This ensures passwords are properly encrypted via egov-enc-service.
#
# Creates ADMIN/GRO on every city tenant in SEED_TENANTS so the Postman
# tests can auth at any city tenant (pg.citya, pg.cityb) without
# extra setup. The full-dump.sql only has users on `pg`, but the demo
# tenants pg.citya and pg.cityb are real MDMS tenants — tests expect
# auth to work there too.

set -e

EGOV_USER_HOST="${EGOV_USER_HOST:-http://egov-user:8107}"
MAX_RETRIES=120   # ~10min: a fresh deploy egov-user needs Flyway + JVM start + scheduling
RETRY_INTERVAL=5

# Tenants to seed ADMIN/GRO into. Override via env when adding new cities.
# Each tenant gets its own ADMIN + GRO user (city-scoped). INTERNAL_USER is
# state-level (pg only) — HRMS looks it up there.
# `pg.cietee` is the throwaway tenant used by test_crs_loader_e2e.py —
# the test logs in there with ADMIN, then creates + deletes its own
# MDMS data. Cleanup nukes MDMS rows on this tenant but NOT eg_user, so
# ADMIN survives across runs.
# (Name has no digits because egov-user validates tenantId against
# `^[a-zA-Z. ]*$` on create — letters and dots only.)
SEED_TENANTS="${SEED_TENANTS:-pg pg.citya pg.cityb pg.cietee}"

# The bootstrap admin the deploy authenticates as. The Ansible tier overrides
# these from host_vars `bootstrap_user`/`bootstrap_password` (rendered into
# .env → passed in via the compose `environment:` block) so a deploy that
# moved off the well-known ADMIN/eGov@123 defaults gets a loginable admin
# BEFORE the playbook's "auth flow" validate mints its first token — nothing
# else creates that user this early (see issue: custom bootstrap_user used to
# 400 "Invalid login credentials" and abort every fresh deploy).
# When SEED_ADMIN_USER != ADMIN the stock ADMIN is still seeded too: the
# CI-gated tasks and Postman collections hardcode ADMIN/eGov@123.
SEED_ADMIN_USER="${SEED_ADMIN_USER:-ADMIN}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-eGov@123}"

# SEED_STOCK_USERS=false (host_vars `seed_stock_users: false`) skips the stock
# ADMIN / GRO accounts with the published eGov@123 password. Only sensible on a
# box that has its own bootstrap_user AND does not run the CI collections or
# the notification seeder with their defaults (preflight.py checks that).
# Users that already exist — including the ones db/full-dump.sql ships on the
# pg* tenants — are never touched by this script either way.
SEED_STOCK_USERS="${SEED_STOCK_USERS:-true}"

# INTERNAL_USER is a SYSTEM account that services look up by role; nothing signs
# in with its password, but it must still not be a published value on a box
# that rotated everything else (host_vars `internal_user_password`).
INTERNAL_USER_PASSWORD="${INTERNAL_USER_PASSWORD:-System@123}"

# Every failed create is counted and the script exits 1 at the end: a one-shot
# compose service that "succeeds" with the bootstrap user missing only moves the
# failure to the playbook's auth validate 20 minutes later, with a message about
# a password MISMATCH that is wrong for a fresh box (issue #2783).
SEED_FAILED=0

echo "=== DIGIT User Seed ==="
echo "EGOV_USER_HOST:  $EGOV_USER_HOST"
echo "SEED_TENANTS:    $SEED_TENANTS"
echo "SEED_ADMIN_USER: $SEED_ADMIN_USER"
echo "SEED_STOCK_USERS: $SEED_STOCK_USERS"

# Escape a value for embedding inside a JSON double-quoted string.
json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# Wait for egov-user to be healthy
echo "Waiting for egov-user service..."
for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf "$EGOV_USER_HOST/user/health" >/dev/null 2>&1; then
    echo "egov-user is healthy!"
    break
  fi
  echo "Attempt $i/$MAX_RETRIES - egov-user not ready, waiting ${RETRY_INTERVAL}s..."
  sleep $RETRY_INTERVAL
done
if ! curl -sf "$EGOV_USER_HOST/user/health" >/dev/null 2>&1; then
  echo "ERROR: egov-user never became healthy at $EGOV_USER_HOST; nothing was seeded." >&2
  exit 1
fi

# Function to create user on a specific tenant.
create_user() {
  local USERNAME=$1
  local NAME=$2
  local MOBILE=$3
  local EMAIL=$4
  local TENANT=$5
  local ROLES=$6
  local PASSWORD="${7:-eGov@123}"

  echo "  Creating user: $USERNAME on '$TENANT'"

  RESPONSE=$(curl -s -X POST "$EGOV_USER_HOST/user/users/_createnovalidate" \
    -H 'Content-Type: application/json' \
    -d "{
      \"RequestInfo\": {\"apiId\": \"digit\", \"ver\": \"1.0\"},
      \"User\": {
        \"userName\": \"$USERNAME\",
        \"name\": \"$NAME\",
        \"mobileNumber\": \"$MOBILE\",
        \"emailId\": \"$EMAIL\",
        \"gender\": \"MALE\",
        \"active\": true,
        \"type\": \"EMPLOYEE\",
        \"tenantId\": \"$TENANT\",
        \"password\": \"$(json_escape "$PASSWORD")\",
        \"roles\": $ROLES
      }
    }")

  if echo "$RESPONSE" | grep -q '"userName"'; then
    echo "    SUCCESS"
  elif echo "$RESPONSE" | grep -q 'DuplicateUserName'; then
    echo "    SKIPPED (already exists)"
  else
    echo "    ERROR — Response: $RESPONSE"
    if echo "$RESPONSE" | grep -qE 'INVALID_PWD_LENGTH|INVALID_PASSWORD'; then
      echo "    egov-user's password rule: 8-15 characters with a digit, a lower-case and an upper-case letter and one of @#\$%."
    fi
    SEED_FAILED=$((SEED_FAILED + 1))
  fi
}

# Roles are tenant-scoped; build the JSON per-tenant.
# ADMIN gets EVERY role the PGR workflow gates on, so a single ADMIN
# user can drive a complaint through every state in the test suite:
#   APPLY                 → CITIZEN, CSR
#   ASSIGN, REJECT        → GRO, PGR_VIEWER
#   REASSIGN, RESOLVE     → PGR_LME, PGR_VIEWER
#   REOPEN                → CFC, CITIZEN, CSR, PGR_VIEWER
#   RATE                  → CFC, CITIZEN
#   ESCALATE              → PGR_LME, PGR_VIEWER (SYSTEM for the scheduler)
# Plus generic/bootstrap roles for completeness. SUPERVISOR and AUTO_ESCALATE
# remain for independent access-control and notification compatibility; neither
# has special meaning in the active PGR escalation workflow.
#
# ACCOUNT_ADMIN: Kong gateway RBAC (ENFORCE_RBAC, since #1837) maps the
# tenant-bootstrap write endpoints (ACCESSCONTROL-ROLEACTIONS/-ACTIONS-TEST
# and dss.* creates) to this role ONLY. The MCP tenant bootstrap runs as
# THIS seeded ADMIN, so without the role every fresh non-pg deploy dies at
# the mcp-bootstrap gate with a wall of AccessDeniedException. The playbook's
# post-bootstrap ensure-ADMIN task and MCP's own provisioning already grant
# it — this seed was the one place left out.
roles_admin() {
  local T=$1
  echo "[
    {\"code\": \"SUPERUSER\",    \"name\": \"Super User\",            \"tenantId\": \"$T\"},
    {\"code\": \"ACCOUNT_ADMIN\",\"name\": \"Account Admin\",         \"tenantId\": \"$T\"},
    {\"code\": \"LOC_ADMIN\",    \"name\": \"Localisation Admin\",    \"tenantId\": \"$T\"},
    {\"code\": \"MDMS_ADMIN\",   \"name\": \"MDMS Admin\",            \"tenantId\": \"$T\"},
    {\"code\": \"EMPLOYEE\",     \"name\": \"Employee\",              \"tenantId\": \"$T\"},
    {\"code\": \"CITIZEN\",      \"name\": \"Citizen\",               \"tenantId\": \"$T\"},
    {\"code\": \"CSR\",          \"name\": \"Customer Service Rep\",  \"tenantId\": \"$T\"},
    {\"code\": \"GRO\",          \"name\": \"Grievance Routing Officer\", \"tenantId\": \"$T\"},
    {\"code\": \"DGRO\",         \"name\": \"Department GRO\",        \"tenantId\": \"$T\"},
    {\"code\": \"PGR_VIEWER\",   \"name\": \"PGR Viewer\",            \"tenantId\": \"$T\"},
    {\"code\": \"PGR_LME\",      \"name\": \"PGR Last-Mile Employee\", \"tenantId\": \"$T\"},
    {\"code\": \"SUPERVISOR\",   \"name\": \"Supervisor\",            \"tenantId\": \"$T\"},
    {\"code\": \"AUTO_ESCALATE\",\"name\": \"Auto Escalate\",         \"tenantId\": \"$T\"}
  ]"
}

roles_gro() {
  local T=$1
  echo "[
    {\"code\": \"EMPLOYEE\", \"name\": \"Employee\", \"tenantId\": \"$T\"},
    {\"code\": \"GRO\", \"name\": \"Grievance Routing Officer\", \"tenantId\": \"$T\"},
    {\"code\": \"DGRO\", \"name\": \"Department GRO\", \"tenantId\": \"$T\"}
  ]"
}

# Seed the bootstrap admin (+ stock ADMIN when they differ) + GRO on every
# SEED_TENANT. The bootstrap admin gets a distinct mobile number from stock
# ADMIN so the two EMPLOYEE users never collide on it.
for TENANT in $SEED_TENANTS; do
  echo ""
  echo "── Seeding tenant: $TENANT ──"
  if [ "$SEED_ADMIN_USER" != "ADMIN" ]; then
    create_user "$SEED_ADMIN_USER" "Bootstrap Administrator" "9777777777" "bootstrap-admin@digit.org" "$TENANT" "$(roles_admin "$TENANT")" "$SEED_ADMIN_PASSWORD"
    if [ "$SEED_STOCK_USERS" = "true" ]; then
      create_user "ADMIN" "System Administrator" "9999999999" "admin@digit.org" "$TENANT" "$(roles_admin "$TENANT")"
    else
      echo "  Skipping stock ADMIN (SEED_STOCK_USERS=$SEED_STOCK_USERS)"
    fi
  else
    create_user "ADMIN" "System Administrator" "9999999999" "admin@digit.org" "$TENANT" "$(roles_admin "$TENANT")" "$SEED_ADMIN_PASSWORD"
  fi
  if [ "$SEED_STOCK_USERS" = "true" ]; then
    create_user "GRO"   "Grievance Officer"    "9888888888" "gro@digit.org"   "$TENANT" "$(roles_gro "$TENANT")"
  else
    echo "  Skipping stock GRO (SEED_STOCK_USERS=$SEED_STOCK_USERS)"
  fi
done

# INTERNAL_USER is a state-level SYSTEM user (only on the root tenant).
# HRMS searches for this user by roleCodes=INTERNAL_MICROSERVICE_ROLE on startup.
echo ""
echo "── Seeding state-level SYSTEM user: INTERNAL_USER (on pg) ──"
INTERNAL_USER_RESPONSE=$(curl -s -X POST "$EGOV_USER_HOST/user/users/_createnovalidate" \
  -H 'Content-Type: application/json' \
  -d '{
    "RequestInfo": {"apiId": "digit", "ver": "1.0"},
    "User": {
      "userName": "INTERNAL_USER",
      "name": "Internal Microservice User",
      "mobileNumber": "9999999999",
      "gender": "MALE",
      "active": true,
      "type": "SYSTEM",
      "tenantId": "pg",
      "password": "'"$(json_escape "$INTERNAL_USER_PASSWORD")"'",
      "roles": [{"code": "INTERNAL_MICROSERVICE_ROLE", "name": "Internal Microservice Role", "tenantId": "pg"}]
    }
  }')

if echo "$INTERNAL_USER_RESPONSE" | grep -q '"userName"'; then
  echo "  SUCCESS: Internal Microservice user created"
elif echo "$INTERNAL_USER_RESPONSE" | grep -q 'DuplicateUserName'; then
  echo "  SKIPPED: Internal Microservice user already exists"
else
  echo "  ERROR — Response: $INTERNAL_USER_RESPONSE"
  SEED_FAILED=$((SEED_FAILED + 1))
fi

echo ""
if [ "$SEED_FAILED" -gt 0 ]; then
  echo "=== User seed FAILED: $SEED_FAILED create(s) were rejected (see ERROR lines above) ==="
  exit 1
fi
echo "=== User seed completed ==="
if [ "$SEED_ADMIN_USER" != "ADMIN" ]; then
  echo "Bootstrap admin: $SEED_ADMIN_USER (password from SEED_ADMIN_PASSWORD) on every tenant in SEED_TENANTS."
  if [ "$SEED_STOCK_USERS" = "true" ]; then
    echo "Stock credentials: ADMIN / eGov@123 (and GRO / eGov@123) also seeded for CI/tests."
  else
    echo "Stock ADMIN / GRO were NOT seeded (SEED_STOCK_USERS=false)."
  fi
elif [ "$SEED_STOCK_USERS" = "true" ]; then
  echo "Default credentials: ADMIN (password from SEED_ADMIN_PASSWORD, default eGov@123) and GRO / eGov@123 on every tenant in SEED_TENANTS."
else
  echo "Default credentials: ADMIN (password from SEED_ADMIN_PASSWORD, default eGov@123); stock GRO was NOT seeded (SEED_STOCK_USERS=false)."
fi
