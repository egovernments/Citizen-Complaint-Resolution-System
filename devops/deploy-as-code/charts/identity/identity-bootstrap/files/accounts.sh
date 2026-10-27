#!/bin/sh
# Creates the BFF's ACCOUNT_ADMIN employee and the PGR onboarding provisioner on
# the state tenant through egov-user (in-cluster, never through the gateway),
# the way playbook-deploy.yml's "onboarding provisioner — ensure the account
# exists" does. An existing account is left alone; the sign-in check then proves
# it is usable with the password identity-secrets holds.
set -eu

for i in $(seq 1 120); do
  curl -sf "$EGOV_USER_HOST/user/health" >/dev/null 2>&1 && break
  [ "$i" = 120 ] && { echo "egov-user is not healthy at $EGOV_USER_HOST" >&2; exit 1; }
  sleep 5
done

role() { printf '{"code":"%s","name":"%s","tenantId":"%s"}' "$1" "$1" "$TENANT"; }

# account TENANT USER MOBILE PASSWORD ROLE...
account() {
  TENANT=$1; user=$2; mobile=$3; password=$4; shift 4
  roles=""; for r in "$@"; do roles="$roles${roles:+,}$(role "$r")"; done
  body=$(printf '{"RequestInfo":{"apiId":"digit","ver":"1.0"},"User":{"userName":"%s","name":"%s","mobileNumber":"%s","gender":"MALE","active":true,"type":"EMPLOYEE","tenantId":"%s","password":"%s","roles":[%s]}}' \
    "$user" "$user" "$mobile" "$TENANT" "$password" "$roles")
  out=$(curl -s -w '\n%{http_code}' -X POST "$EGOV_USER_HOST/user/users/_createnovalidate" -H 'Content-Type: application/json' -d "$body")
  code=$(printf '%s' "$out" | tail -n1)
  if [ "$code" = 200 ]; then echo "$user: created on $TENANT"
  elif printf '%s' "$out" | grep -q DuplicateUserName; then echo "$user: already on $TENANT"
  else echo "$user: create failed (HTTP $code): $(printf '%s' "$out" | head -n1 | head -c 300)" >&2; exit 1
  fi

  token=$(curl -s -X POST "$EGOV_USER_HOST/user/oauth/token" -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
    --data-urlencode grant_type=password --data-urlencode scope=read --data-urlencode "username=$user" \
    --data-urlencode "password=$password" --data-urlencode "tenantId=$TENANT" --data-urlencode userType=EMPLOYEE)
  for r in "$@"; do
    printf '%s' "$token" | grep -q "\"code\":\"$r\"" || {
      echo "$user cannot sign in with role $r on $TENANT. An account that predates this Job has another password or roles; fix it or delete it." >&2
      exit 1
    }
  done
  echo "$user: signs in with $*"
}

# Each on the tenant its service signs in on; empty = the state tenant, which is
# also what the BFF and pgr-services fall back to.
account "${ADMIN_TENANT:-$STATE_TENANT}" "$ADMIN_USERNAME" "$ADMIN_MOBILE" "$ADMIN_PASSWORD" ACCOUNT_ADMIN
account "${PROVISIONER_TENANT:-$STATE_TENANT}" "$PROVISIONER_USERNAME" "$PROVISIONER_MOBILE" "$PROVISIONER_PASSWORD" \
  MDMS_ADMIN ACCOUNT_ADMIN LOC_ADMIN HRMS_ADMIN EMPLOYEE
