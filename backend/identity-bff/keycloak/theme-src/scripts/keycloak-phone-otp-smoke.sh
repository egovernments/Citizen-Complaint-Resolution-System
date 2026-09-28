#!/usr/bin/env bash
# End-to-end smoke test of the citizen phone + SMS-OTP sign-in (CCRS #2167)
# on the identity-keycloak image, in its production start mode.
#
# Starts Postgres, Mailpit and the image with `start --optimized`, configures
# the realm with the real deploy/digit-compose/configure-keycloak.sh (twice, to
# prove it is idempotent), then drives the digit-ui-citizen authorization flow
# with curl: phone number -> OTP read back from Mailpit's /api/v1/search ->
# name for the new user -> authorization code -> tokens. A second sign-in with
# the same phone must reuse the user and skip the name step.
#
# Needs docker, curl, jq and openssl on the host. Keycloak and Mailpit publish
# loopback ports (SMOKE_KC_PORT, SMOKE_MAILPIT_PORT) because the flow is
# driven from the host.
#
# The citizen pages are rendered with KEYCLOAK_CITIZEN_LOGIN_THEME, default
# `digit-phone-base` (the FreeMarker fallback shipped in the extension jar),
# because the form actions are scraped from server-rendered HTML.
set -euo pipefail

cd "$(dirname "$0")/.."
identity_dir=$(cd ../.. && pwd)

image=${IDENTITY_KEYCLOAK_IMAGE:-identity-keycloak:smoke}
mailpit_image=${MAILPIT_IMAGE:-axllent/mailpit:v1.27}
kc_port=${SMOKE_KC_PORT:-18190}
mailpit_port=${SMOKE_MAILPIT_PORT:-18125}
theme=${KEYCLOAK_CITIZEN_LOGIN_THEME:-digit-phone-base}
realm=digit
tenant=bomet
suffix=$$
network=digit-otp-smoke-$suffix
kc=keycloak-otp-smoke-$suffix
pg=keycloak-pg-otp-smoke-$suffix
mailpit=mailpit-otp-smoke-$suffix
kc_url="http://127.0.0.1:$kc_port"
mailpit_url="http://127.0.0.1:$mailpit_port"
redirect_uri=http://localhost/identity/v1/callback
citizen_secret=$(openssl rand -hex 24)
work=$(mktemp -d)

cleanup() {
    if [ "${KEEP_SMOKE:-0}" != "1" ]; then
        docker rm -f "$kc" "$pg" "$mailpit" >/dev/null 2>&1 || true
        docker network rm "$network" >/dev/null 2>&1 || true
    fi
    rm -rf "$work"
}
trap cleanup EXIT

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    if [ "${SMOKE_DEBUG:-0}" = "1" ]; then docker logs --tail 80 "$kc" >&2 2>&1 || true; fi
    exit 1
}
pass() { printf 'ok   %s\n' "$*"; }

if [ "${SKIP_BUILD:-0}" != "1" ]; then
    docker build -f "$identity_dir/keycloak/Dockerfile.magic-link" -t "$image" "$identity_dir"
fi

docker network create "$network" >/dev/null
docker run -d --name "$pg" --network "$network" --network-alias keycloak-postgres \
    -e POSTGRES_USER=keycloak -e POSTGRES_PASSWORD=keycloak -e POSTGRES_DB=keycloak \
    postgres:16 >/dev/null
docker run -d --name "$mailpit" --network "$network" --network-alias mailpit \
    -p "127.0.0.1:$mailpit_port:8025" "$mailpit_image" >/dev/null

for _ in $(seq 1 30); do
    docker exec "$pg" pg_isready -U keycloak >/dev/null 2>&1 && break
    sleep 1
done

# The same runtime options the Compose stack sets (docker-compose.egov-digit.yaml).
# There is no BFF here, so the tenant lookup fails and the configured default
# (+254, ^[71][0-9]{8}$) applies: that is the fallback path under test.
docker run -d --name "$kc" --network "$network" -p "127.0.0.1:$kc_port:8180" \
    -e KC_DB=postgres -e KC_DB_URL=jdbc:postgresql://keycloak-postgres:5432/keycloak \
    -e KC_DB_USERNAME=keycloak -e KC_DB_PASSWORD=keycloak \
    -e KC_HTTP_ENABLED=true -e KC_HTTP_PORT=8180 -e KC_HOSTNAME="$kc_url" \
    -e KC_HEALTH_ENABLED=true \
    -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
    -e KC_SPI_DIGIT_SMS_SENDER_MODE=mailpit \
    -e KC_SPI_DIGIT_SMS_SENDER_ALLOW_DEV=true \
    -e KC_SPI_DIGIT_SMS_SENDER_MAILPIT_URL=http://mailpit:8025 \
    -e KC_SPI_DIGIT_SMS_SENDER_HTTP_URL= -e KC_SPI_DIGIT_SMS_SENDER_HTTP_TOKEN= \
    -e KC_SPI_DIGIT_PHONE_OTP_TENANT_CONTEXT_URL=http://identity-bff:3000 \
    -e KC_SPI_DIGIT_PHONE_OTP_DEFAULT_COUNTRY_CODE=+254 \
    -e 'KC_SPI_DIGIT_PHONE_OTP_DEFAULT_MOBILE_REGEX=^[71][0-9]{8}$' \
    -e KC_SPI_DIGIT_PHONE_OTP_RESEND_SECONDS=2 \
    "$image" start --optimized >/dev/null

echo "waiting for Keycloak..."
for _ in $(seq 1 90); do
    if curl -fsS "$kc_url/realms/master" >/dev/null 2>&1; then break; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$kc")" != true ]; then fail "keycloak exited"; fi
    sleep 2
done
curl -fsS "$kc_url/realms/master" >/dev/null || fail "keycloak did not become ready"
pass "keycloak started with --optimized and the digit-sms-sender runtime options"

configure() {
    IDENTITY_ENV_DIR="$work/none" KEYCLOAK_CONTAINER="$kc" \
    KEYCLOAK_ORGANIZATION_REALM=$realm KEYCLOAK_SSL_REQUIRED=none \
    KC_BOOTSTRAP_ADMIN_USERNAME=admin KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
    KEYCLOAK_BFF_CLIENT_SECRET=smoke-bff KEYCLOAK_ADMIN_CLIENT_SECRET=smoke-admin \
    KEYCLOAK_EMPLOYEE_CLIENT_SECRET=smoke-employee KEYCLOAK_CITIZEN_CLIENT_SECRET="$citizen_secret" \
    KEYCLOAK_EMPLOYEE_LOGIN_THEME="${KEYCLOAK_EMPLOYEE_LOGIN_THEME:-keycloak}" \
    KEYCLOAK_CITIZEN_LOGIN_THEME="$theme" \
    IDENTITY_REDIRECT_URI=$redirect_uri IDENTITY_ALLOWED_ORIGINS=http://localhost \
    KEYCLOAK_SMTP_HOST=mailpit KEYCLOAK_SMTP_PORT=1025 KEYCLOAK_SMTP_FROM=no-reply@example.org \
    KEYCLOAK_SMTP_AUTH=false KEYCLOAK_SMTP_STARTTLS=false \
        "$identity_dir/deploy/digit-compose/configure-keycloak.sh"
}
configure >/dev/null
configure | tail -1
pass "configure-keycloak.sh ran twice"

kcadm() {
    docker exec "$kc" /opt/keycloak/bin/kcadm.sh "$@" --config /tmp/smoke-kcadm.config
}
kcadm config credentials --server http://127.0.0.1:8180 --realm master --user admin --password admin >/dev/null

flows=$(kcadm get authentication/flows/digit-citizen-browser/executions -r $realm)
[ "$(printf '%s' "$flows" | jq -c '[.[] | .providerId // .displayName]')" = \
  '["digit-citizen-phone-otp","digit-phone-number-form","digit-sms-otp","digit-phone-profile-form"]' ] ||
    fail "unexpected citizen flow: $(printf '%s' "$flows" | jq -c '[.[] | .providerId // .displayName]')"
kcadm get authentication/flows/digit-employee-browser/executions -r $realm |
    jq -e '[.[].providerId] == ["auth-username-password-form"]' >/dev/null || fail "unexpected employee flow"
kcadm get users/profile -r $realm | jq -e '.unmanagedAttributePolicy == "ADMIN_EDIT"
    and any(.attributes[]; .name == "phoneNumber") and any(.attributes[]; .name == "phoneNumberVerified")' \
    >/dev/null || fail "user profile not configured"
citizen=$(kcadm get clients -r $realm -q clientId=digit-ui-citizen | jq '.[0]')
printf '%s' "$citizen" | jq -e --arg theme "$theme" '.attributes.login_theme == $theme
    and .attributes["digit.auth.surface"] == "citizen"
    and .attributes["digit.auth.signin.methods"] == "phone_otp"
    and ((.attributes | has("digit.auth.signup.methods")) | not)
    and (.authenticationFlowBindingOverrides.browser | length > 0)
    and (.defaultClientScopes | index("phone")) and ((.defaultClientScopes | index("email")) | not)' \
    >/dev/null || fail "citizen client misconfigured: $citizen"
kcadm get realms/$realm | jq -e '.bruteForceProtected == true' >/dev/null || fail "brute force protection off"
pass "flows, clients, user profile and realm invariants"

# ---- the browser flow -------------------------------------------------------
jar="$work/cookies"
page="$work/page.html"

form_action() { # <form id>
    grep -o "id=\"$1\"[^>]*action=\"[^\"]*\"" "$page" | sed -e 's/.*action="//' -e 's/"$//' -e 's/&amp;/\&/g' | head -1
}

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

mailpit_code() { # <digits> -> newest OTP sent to that number
    local id
    id=$(curl -fsS -G "$mailpit_url/api/v1/search" --data-urlencode "query=to:$1@sms.local" |
        jq -r '.messages[0].ID // empty')
    [ -n "$id" ] || return 1
    curl -fsS "$mailpit_url/api/v1/message/$id" | jq -r '.Subject + "\n" + .Text'
}

start_login() {
    rm -f "$jar"
    verifier=$(openssl rand -hex 32)
    challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | b64url)
    curl -fsS -c "$jar" -b "$jar" -o "$page" -G "$kc_url/realms/$realm/protocol/openid-connect/auth" \
        --data-urlencode client_id=digit-ui-citizen \
        --data-urlencode "redirect_uri=$redirect_uri" \
        --data-urlencode response_type=code \
        --data-urlencode 'scope=openid profile phone' \
        --data-urlencode "code_challenge=$challenge" \
        --data-urlencode code_challenge_method=S256 \
        --data-urlencode state=smoke --data-urlencode prompt=login \
        --data-urlencode "digit_tenant=$tenant"
}

post() { # <url> <curl args...>; follows nothing, writes the page, prints the redirect target
    local url=$1
    shift
    curl -sS -c "$jar" -b "$jar" -o "$page" -w '%{redirect_url}' "$url" "$@"
}

start_login
grep -q 'id="kc-digit-phone-form"' "$page" || fail "phone page not rendered"
grep -q "id=\"digit-tenant\" value=\"$tenant\"" "$page" || fail "digitTenant attribute missing"
grep -q '+254' "$page" || fail "countryCode attribute missing"
pass "phone page rendered with digitTenant=$tenant and countryCode"

post "$(form_action kc-digit-phone-form)" --data-urlencode phoneNumber=12345 >/dev/null
grep -q 'Enter a valid mobile number' "$page" || fail "invalid phone accepted"
pass "invalid phone rejected (digitInvalidPhone)"

post "$(form_action kc-digit-phone-form)" --data-urlencode 'phoneNumber=0712 345 678' >/dev/null
grep -q 'id="kc-digit-otp-form"' "$page" || fail "OTP page not rendered"
grep -q '678' "$page" || fail "masked phone missing"
pass "OTP page rendered for +254712345678"

sms=""
for _ in $(seq 1 10); do sms=$(mailpit_code 254712345678) && break; sleep 1; done
[ -n "$sms" ] || fail "no SMS in Mailpit"
printf '%s\n' "$sms" | head -1 | grep -qx 'SMS to +254712345678' || fail "unexpected subject: $sms"
code=$(printf '%s\n' "$sms" | tail -n +2 | grep -oE '\b[0-9]{6}\b' | head -1)
[ -n "$code" ] || fail "no code in SMS: $sms"
pass "SMS read back from Mailpit /api/v1/search"

wrong=$([ "$code" = 000000 ] && echo 111111 || echo 000000)
post "$(form_action kc-digit-otp-form)" --data-urlencode "otp=$wrong" >/dev/null
grep -q 'The code is not correct' "$page" || fail "wrong OTP accepted"
pass "wrong OTP rejected (digitInvalidOtp)"

post "$(form_action kc-digit-otp-form)" --data-urlencode "otp=$code" >/dev/null
grep -q 'id="kc-digit-profile-form"' "$page" || fail "new user was not asked for a name"
pass "new citizen asked for a name"

location=$(post "$(form_action kc-digit-profile-form)" --data-urlencode firstName=Asha)
case "$location" in
    "$redirect_uri"?*code=*) ;;
    *) fail "no authorization code redirect (got '$location')" ;;
esac
auth_code=$(printf '%s' "$location" | sed -E 's/.*[?&]code=([^&]+).*/\1/')
tokens=$(curl -fsS "$kc_url/realms/$realm/protocol/openid-connect/token" \
    -u "digit-ui-citizen:$citizen_secret" \
    --data-urlencode grant_type=authorization_code --data-urlencode "code=$auth_code" \
    --data-urlencode "redirect_uri=$redirect_uri" --data-urlencode "code_verifier=$verifier")
claims() {
    printf '%s' "$tokens" | jq -r ".$1" | cut -d. -f2 | tr '_-' '/+' |
        awk '{ while (length($0) % 4) $0 = $0 "="; print }' | openssl base64 -d -A
}
claims access_token | jq -e '.azp == "digit-ui-citizen"
    and ((.aud | if type == "array" then . else [.] end) | index("digit-identity-bff"))
    and .phone_number == "+254712345678" and .phone_number_verified == true' >/dev/null ||
    fail "access token claims: $(claims access_token)"
pass "token: azp=digit-ui-citizen, aud has digit-identity-bff, phone_number(_verified)"

sleep 3 # KC_SPI_DIGIT_PHONE_OTP_RESEND_SECONDS=2
start_login
post "$(form_action kc-digit-phone-form)" --data-urlencode phoneNumber=+254712345678 >/dev/null
grep -q 'id="kc-digit-otp-form"' "$page" || fail "second login: OTP page not rendered"
code2=""
for _ in $(seq 1 10); do
    code2=$(mailpit_code 254712345678 | tail -n +2 | grep -oE '\b[0-9]{6}\b' | head -1) || true
    [ -n "$code2" ] && [ "$(curl -fsS -G "$mailpit_url/api/v1/search" \
        --data-urlencode 'query=to:254712345678@sms.local' | jq '.messages_count')" -ge 2 ] && break
    sleep 1
done
location=$(post "$(form_action kc-digit-otp-form)" --data-urlencode "otp=$code2")
case "$location" in
    "$redirect_uri"?*code=*) ;;
    *) fail "returning citizen was not signed straight in (got '$location')" ;;
esac
[ "$(kcadm get users -r $realm -q 'q=phoneNumber:+254712345678' | jq length)" = 1 ] ||
    fail "expected exactly one user for the phone"
pass "returning citizen reused the same user and skipped the name step"

echo "PASS citizen phone OTP smoke"
