#!/bin/sh
# Ensures IDENTITY_SECRET and ONBOARDING_SECRET exist with every key, through
# the Kubernetes API as this Job's ServiceAccount. Generates only missing keys;
# a present key is never rewritten (a rotated client secret would desync
# Keycloak from the BFF, and a new DB password from the role that exists).
set -eu

api=https://kubernetes.default.svc
sa=/var/run/secrets/kubernetes.io/serviceaccount
ns=$(cat "$sa/namespace")
auth="Authorization: Bearer $(cat "$sa/token")"

hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# egov-user takes 8-15 characters with upper, lower, digit and special.
digit_password() { printf 'Aa1@%s' "$(hex 6 | head -c 11)"; }
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }

# get SECRET -> its .data JSON object on stdout, or nothing when absent
get() {
  code=$(curl -s -o /tmp/secret.json -w '%{http_code}' --cacert "$sa/ca.crt" -H "$auth" "$api/api/v1/namespaces/$ns/secrets/$1")
  case $code in
    200) tr -d '\n' < /tmp/secret.json | sed -n 's/.*"data": *\({[^}]*}\).*/\1/p' ;;
    404) ;;
    *) echo "reading secret $1: HTTP $code" >&2; exit 1 ;;
  esac
}
has() { printf '%s' "$1" | grep -q "\"$2\":"; }
value() { printf '%s' "$1" | sed -n "s/.*\"$2\": *\"\\([^\"]*\\)\".*/\\1/p" | base64 -d; }

# ensure SECRET "key=value-command" ...: create, or patch in the missing keys
ensure() {
  name=$1; shift
  data=$(get "$name")
  add=""
  for spec in "$@"; do
    key=${spec%%=*}; gen=${spec#*=}
    if [ -n "$data" ] && has "$data" "$key"; then continue; fi
    val=$(eval "$gen")
    add="$add${add:+,}\"$key\":\"$(b64 "$val")\""
    echo "$name: generated $key"
  done
  [ -z "$add" ] && { echo "$name: complete"; return; }
  if [ -z "$data" ]; then
    body="{\"apiVersion\":\"v1\",\"kind\":\"Secret\",\"metadata\":{\"name\":\"$name\",\"labels\":{\"app.kubernetes.io/managed-by\":\"identity-bootstrap\"}},\"type\":\"Opaque\",\"data\":{$add}}"
    method=POST; url="$api/api/v1/namespaces/$ns/secrets"; ctype=application/json
  else
    body="{\"data\":{$add}}"
    method=PATCH; url="$api/api/v1/namespaces/$ns/secrets/$name"; ctype=application/merge-patch+json
  fi
  code=$(curl -s -o /tmp/write.json -w '%{http_code}' --cacert "$sa/ca.crt" -H "$auth" -H "Content-Type: $ctype" -X "$method" --data "$body" "$url")
  case $code in 200|201) ;; *) echo "writing secret $name: HTTP $code" >&2; exit 1 ;; esac
}

ensure "$IDENTITY_SECRET" \
  "keycloak-db-password=hex 20" \
  "keycloak-admin-password=hex 20" \
  "keycloak-bff-client-secret=hex 32" \
  "keycloak-admin-client-secret=hex 32" \
  "keycloak-employee-client-secret=hex 32" \
  "keycloak-citizen-client-secret=hex 32" \
  "keycloak-magic-link-client-secret=hex 32" \
  "identity-control-plane-token=hex 32" \
  "identity-onboarding-token=hex 32" \
  "identity-citizen-otp-secret=hex 32" \
  "identity-session-introspection-token=hex 32" \
  "digit-admin-password=digit_password" \
  "digit-provisioner-password=digit_password"

identity=$(get "$IDENTITY_SECRET")
# Keys an operator supplies: they come from an outside account, so they cannot
# be generated. require KEY "WHY"
require() {
  has "$identity" "$1" && return
  echo "$IDENTITY_SECRET has no $1, which $2 needs. Add it:" >&2
  echo "  kubectl -n $ns patch secret $IDENTITY_SECRET --type merge -p '{\"stringData\":{\"$1\":\"...\"}}'" >&2
  exit 1
}
[ "$SMTP_AUTH" = "true" ] && require keycloak-smtp-password "SMTP auth"
[ "$GOOGLE_SIGNIN" = "true" ] && require keycloak-google-client-secret "Google sign-in (configure.googleClientId)"

# pgr-services presents the BFF's onboarding token and signs in as the
# provisioner: the same values, so copied rather than generated.
ensure "$ONBOARDING_SECRET" \
  "provisioner-password=value \"\$identity\" digit-provisioner-password" \
  "onboarding-token=value \"\$identity\" identity-onboarding-token" \
  "oauth-client-secret=printf ''"

# A pgr-onboarding that predates this Job (or was edited by hand) keeps its own
# values, and pgr-services reads those, not identity-secrets'. accounts.sh
# checks the provisioner against identity-secrets, so a mismatch would pass
# here and pause the onboarding runner with CREDENTIALS_REJECTED. Stop instead.
onboarding=$(get "$ONBOARDING_SECRET")
same() { [ "$(printf '%s' "$identity" | sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p")" = "$(printf '%s' "$onboarding" | sed -n "s/.*\"$2\": *\"\([^\"]*\)\".*/\1/p")" ]; }
for pair in "digit-provisioner-password provisioner-password" "identity-onboarding-token onboarding-token"; do
  set -- $pair
  if ! same "$1" "$2"; then
    echo "$ONBOARDING_SECRET's $2 differs from $IDENTITY_SECRET's $1; pgr-services and the BFF would disagree." >&2
    echo "Make them equal (copy $IDENTITY_SECRET's value into $ONBOARDING_SECRET), then rerun." >&2
    exit 1
  fi
done
