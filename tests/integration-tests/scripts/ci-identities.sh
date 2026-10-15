#!/usr/bin/env bash
# ci-identities.sh — give a freshly deployed CI stack the accounts this suite
# signs in with, then print the suite's identity env on stdout (KEY=value
# lines; progress goes to stderr).
#
# Run by .github/workflows/integration-tests.yml on the runner, after
# `deploy.sh ci`. Only for that throwaway stack: it creates accounts with the
# stock development password and binds them through the identity BFF's
# internal onboarding routes, the way pgr-services provisions a self-service
# signup.
#
# Why it is needed: every staff sign-in on develop goes through Keycloak and
# the identity BFF (#2270), and a fresh deploy creates no Keycloak people, no
# workspace and no URL slug. The dump-seeded `pg` tenant has the data the
# suite needs (boundaries, complaint types, HRMS employees) but nobody who can
# sign in to it. This script adds:
#   - workspace (Keycloak Organization) for tenant pg with URL slug pg, ACTIVE;
#   - CI_SUITE_ADMIN, a DIGIT employee at pg with the configurator/admin roles,
#     and Keycloak user ci-suite-admin bound to it. NOT the seeded ADMIN: the
#     BFF itself signs in to DIGIT as ADMIN, and binding an account makes every
#     hosted sign-in rotate its DIGIT password (identity_staff_credential_mode
#     rotate), which would lock the BFF out;
#   - a Keycloak user per active HRMS employee at pg (PGGRO1, PGLME2, ...),
#     username = employee code, bound to that employee, so the suite's
#     persona discovery (tests/utils/personas.ts) can sign them in.
# Citizens need nothing: identity_dev_fixed_otp + phone_otp in
# host_vars/ci.yml.example make the BFF accept the fixed code 123456.
#
# Idempotent enough for a re-run on the same stack (existing users and
# memberships are kept), but it is written for one run on a fresh one.
set -euo pipefail

DIGIT_DIR=${DIGIT_DIR:-/opt/digit}
TENANT=${CI_TENANT:-pg}
SLUG=${CI_SLUG:-pg}
PASSWORD=${CI_PASSWORD:-eGov@123}
DIGIT_ADMIN=CI_SUITE_ADMIN   # DIGIT userName
ADMIN_LOGIN=ci-suite-admin   # Keycloak username
BFF=http://127.0.0.1:18400/internal/identity/v1
# Any UUID: the onboarding routes fence a provisioning attempt by operation id.
OPERATION=00000000-0000-4000-8000-00000000c1c1
NETWORK="$(basename "$DIGIT_DIR")_egov-network"

log() { echo "[ci-identities] $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# The onboarding token the BFF actually runs with (not .env, which root owns).
TOKEN=$(docker exec identity-bff printenv IDENTITY_ONBOARDING_TOKEN) || die "identity-bff is not running"
[ -n "$TOKEN" ] || die "identity-bff has no IDENTITY_ONBOARDING_TOKEN"

wait_for() { # <what> <command...>
  local what=$1; shift
  for _ in $(seq 1 60); do "$@" >/dev/null 2>&1 && return 0; sleep 5; done
  die "$what not ready after 5 minutes"
}
wait_for "identity BFF" curl -fsS http://127.0.0.1:18400/livez
wait_for "Keycloak" curl -fsS http://localhost/auth/realms/digit/.well-known/openid-configuration

# POST to a BFF onboarding route; prints the response, fails on an HTTP error.
bff() {
  local out code
  out=$(curl -sS -w '\n%{http_code}' -X POST "$BFF/$1" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$2")
  code=$(tail -n1 <<<"$out")
  [[ "$code" == 2* ]] || die "BFF $1 → HTTP $code: $(sed '$d' <<<"$out" | head -c 300)"
  sed '$d' <<<"$out"
}

# egov-user, straight on the compose network: _createnovalidate must never be
# reachable through Kong (same call the playbook makes for ADMIN).
egov_user() {
  docker run --rm --network "$NETWORK" egovio/curl:latest \
    curl -sS -X POST "http://egov-user-proxy:8107/user/$1" -H 'Content-Type: application/json' -d "$2"
}

# kcadm inside the Keycloak container, signed in with the container's own
# bootstrap admin (the password never leaves the container).
docker exec keycloak sh -c '/opt/keycloak/bin/kcadm.sh config credentials --config /tmp/ci-kcadm.config \
  --server http://127.0.0.1:8180 --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"' >/dev/null || die "kcadm could not sign in"
kc() { docker exec keycloak /opt/keycloak/bin/kcadm.sh "$@" --config /tmp/ci-kcadm.config; }

# Keycloak user <username> with the stock password; prints its id.
kc_user() {
  local id
  id=$(kc get users -r digit -q "username=$1" -q exact=true --fields id --format csv --noquotes | head -n1)
  if [ -z "$id" ]; then
    id=$(kc create users -r digit -i -s "username=$1" -s "email=$1@ci.example.org" -s emailVerified=true \
      -s enabled=true -s "firstName=$1" -s lastName=CI)
  fi
  kc set-password -r digit --userid "$id" --new-password "$PASSWORD" >/dev/null
  echo "$id"
}

# 1. The admin the suite signs in as.
# Every role the seeded ADMIN@pg holds, plus the admin roles the deploy grants
# it (MDMS_ADMIN, LOC_ADMIN, HRMS_ADMIN), so the configurator shows it the same.
roles=$(for r in SUPERUSER EMPLOYEE CITIZEN MDMS_ADMIN LOC_ADMIN ACCOUNT_ADMIN HRMS_ADMIN GRO DGRO CSR PGR_LME \
                 PGR_VIEWER SUPERVISOR AUTO_ESCALATE; do
  printf '{"code":"%s","name":"%s","tenantId":"%s"},' "$r" "$r" "$TENANT"; done)
body=$(jq -nc --arg u "$DIGIT_ADMIN" --arg t "$TENANT" --arg p "$PASSWORD" --argjson roles "[${roles%,}]" \
  '{RequestInfo:{apiId:"digit",ver:"1.0"},User:{userName:$u,name:"CI Suite Admin",mobileNumber:"9000000101",
    gender:"MALE",active:true,type:"EMPLOYEE",tenantId:$t,password:$p,roles:$roles}}')
admin_uuid=""
for i in $(seq 1 6); do
  resp=$(egov_user users/_createnovalidate "$body" || true)
  admin_uuid=$(jq -r '.user[0].uuid // empty' <<<"$resp" 2>/dev/null || true)
  [ -n "$admin_uuid" ] && break
  if grep -q DuplicateUserName <<<"$resp"; then
    admin_uuid=$(egov_user _search "$(jq -nc --arg u "$DIGIT_ADMIN" --arg t "$TENANT" \
      '{RequestInfo:{apiId:"digit"},userName:$u,tenantId:$t}')" | jq -r '.user[0].uuid // empty')
    break
  fi
  log "egov-user not ready (attempt $i/6): $(head -c 160 <<<"$resp")"; sleep 10
done
[ -n "$admin_uuid" ] || die "could not create $DIGIT_ADMIN at $TENANT"
log "DIGIT $DIGIT_ADMIN@$TENANT = $admin_uuid"

# 2. The workspace: tenant pg, slug pg, still PROVISIONING until step 4.
bff organizations/_ensure "$(jq -nc --arg op "$OPERATION" --arg t "$TENANT" --arg s "$SLUG" \
  '{operationId:$op,restartNo:0,tenantId:$t,slug:$s,name:"CI workspace"}')" >/dev/null
log "workspace $SLUG → $TENANT"

# 3. Members, each bound to their DIGIT account.
bind() { # <keycloak user id> <digit uuid> <label>
  local payload
  payload=$(jq -nc --arg op "$OPERATION" --arg t "$TENANT" --arg sub "$1" --arg uuid "$2" \
    '{operationId:$op,restartNo:0,tenantId:$t,subject:$sub,digitUuid:$uuid}')
  bff memberships/_ensure "$payload" >/dev/null
  bff bindings/_ensure "$payload" >/dev/null
  log "bound $3"
}
bind "$(kc_user "$ADMIN_LOGIN")" "$admin_uuid" "$ADMIN_LOGIN → $DIGIT_ADMIN"

employees=$(docker exec docker-postgres psql -U egov -d egov -Atc \
  "select code, uuid from eg_hrms_employee where tenantid = '$TENANT' and active order by code")
[ -n "$employees" ] || log "WARNING: no active HRMS employees at $TENANT; persona specs will skip"
while IFS='|' read -r code uuid; do
  [ -n "$code" ] || continue
  bind "$(kc_user "$code")" "$uuid" "$code"
done <<<"$employees"

# 4. Open the workspace for sign-in (PROVISIONING refuses context selection).
bff organizations/_lifecycle "$(jq -nc --arg op "$OPERATION" '{operationId:$op,restartNo:0,state:"ACTIVE"}')" >/dev/null
route=$(curl -fsS "http://localhost/identity/v1/tenant-contexts/$SLUG") || die "slug $SLUG does not resolve"
log "tenant context: $route"

cat <<EOF
ADMIN_USER=$ADMIN_LOGIN
ADMIN_PASSWORD=$PASSWORD
IDENTITY_TEST_TENANT_SLUG=$SLUG
IDENTITY_TEST_OTP_CODE=123456
KC_REALM=digit
PERSONA_PASSWORD_GUESSES=$PASSWORD
EOF
