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
# `digit-phone-base` (the FreeMarker fallback shipped in the extension jar).
# With `digit-citizen` (the Keycloakify theme) the same flow is driven from
# the kcContext each page embeds (pageId, url.loginAction, SPI attributes and
# the message Keycloak resolved from the theme's own bundle), so the SPI <->
# theme names are checked against the real theme jar.
#
# SMOKE_BFF_STUB=1 (default) serves the BFF's public branding contract
# (GET /identity/v1/tenant-contexts/{slug}/branding) from a static stub on the
# network alias identity-bff, with Keycloak's own default rule set to
# something else (+91), so the tenant mobile-rule fetch is what makes +254
# work; an unknown slug must fall back to the default. SMOKE_BFF_STUB=0 has no
# BFF at all and exercises only the fallback.
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
bff=identity-bff-stub-otp-smoke-$suffix
bff_stub=${SMOKE_BFF_STUB:-1}
case "$theme" in
    digit-phone-base | keycloak) keycloakify=0 ;;
    *) keycloakify=1 ;;
esac
if [ "$keycloakify" = 1 ]; then
    # digit-citizen's bundle (keycloak/theme-src/src/login/i18n.ts).
    invalid_phone_text='Please enter a valid mobile number'
    invalid_otp_text='The OTP you entered is invalid.'
else
    # digit-phone-base's messages_en.properties.
    invalid_phone_text='Enter a valid mobile number'
    invalid_otp_text='The code is not correct'
fi
if [ "$bff_stub" = 1 ]; then
    default_cc=+91 default_regex='^[6-9][0-9]{9}$'
else
    default_cc=+254 default_regex='^[71][0-9]{8}$'
fi
kc_url="http://127.0.0.1:$kc_port"
mailpit_url="http://127.0.0.1:$mailpit_port"
redirect_uri=http://localhost/identity/v1/callback
citizen_secret=$(openssl rand -hex 24)
work=$(mktemp -d)

cleanup() {
    if [ "${KEEP_SMOKE:-0}" != "1" ]; then
        docker rm -f "$kc" "$pg" "$mailpit" "$bff" >/dev/null 2>&1 || true
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

if [ "$bff_stub" = 1 ]; then
    # The BFF contract's shape (backend/identity-bff branding route) with the
    # fields the SPI reads; everything else is what the real BFF would send.
    mkdir -p "$work/www/identity/v1/tenant-contexts/$tenant"
    cat >"$work/www/identity/v1/tenant-contexts/$tenant/branding" <<JSON
{"tenant":{"urlSlug":"$tenant","tenantId":"ke.bomet","name":"Bomet County"},
 "stateInfo":{"code":"ke","name":"Kenya","logoUrl":null,"logoUrlWhite":null,"bannerUrl":null,
              "languages":[{"label":"ENGLISH","value":"en_IN"}],"defaultLocale":"en_IN"},
 "themeConfig":null,
 "mobileValidation":{"countryCode":"+254","mobileNumberRegex":"^[71][0-9]{8}\$","errorMessage":"MOBILE_VALIDATION_KE"},
 "loginConfig":null,"privacyPolicy":null,
 "footer":{"digitFooter":"","digitFooterBw":"","digitHomeUrl":""},"messages":{}}
JSON
    jq -e '.mobileValidation.mobileNumberRegex == "^[71][0-9]{8}$"' \
        "$work/www/identity/v1/tenant-contexts/$tenant/branding" >/dev/null || fail "bad branding stub"
    docker create --name "$bff" --network "$network" --network-alias identity-bff \
        busybox:1.37 httpd -f -p 3000 -h /www >/dev/null
    docker cp "$work/www" "$bff:/" >/dev/null
    docker start "$bff" >/dev/null
fi

for _ in $(seq 1 30); do
    docker exec "$pg" pg_isready -U keycloak >/dev/null 2>&1 && break
    sleep 1
done

# The same runtime options the Compose stack sets (docker-compose.egov-digit.yaml).
# The default rule is what a tenant without a usable BFF answer gets.
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
    -e KC_SPI_DIGIT_PHONE_OTP_DEFAULT_COUNTRY_CODE="$default_cc" \
    -e KC_SPI_DIGIT_PHONE_OTP_DEFAULT_MOBILE_REGEX="$default_regex" \
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

form_action() { # <form id> (digit-phone-base) -- or kcContext url.loginAction (Keycloakify)
    if [ "$keycloakify" = 1 ]; then
        grep -o '"loginAction": "[^"]*"' "$page" | head -1 | sed -e 's/^"loginAction": "//' -e 's/"$//'
    else
        grep -o "id=\"$1\"[^>]*action=\"[^\"]*\"" "$page" | sed -e 's/.*action="//' -e 's/"$//' -e 's/&amp;/\&/g' | head -1
    fi
}

on_page() { # <ftl page id> <digit-phone-base form id>
    if [ "$keycloakify" = 1 ]; then
        grep -qF "kcContext.pageId = \"$1\"" "$page" && grep -qF "kcContext.themeName = \"$theme\"" "$page"
    else
        grep -q "id=\"$2\"" "$page"
    fi
}

has_attr() { # <attribute> <value>: an SPI page attribute as the theme receives it
    if [ "$keycloakify" = 1 ]; then
        grep -qF "\"$1\": \"$2\"" "$page"
    else
        case "$1" in
            digitTenant) grep -qF "id=\"digit-tenant\" value=\"$2\"" "$page" ;;
            countryCode) grep -qF "$2" "$page" ;;
            *) grep -qF "id=\"$1\"" "$page" && grep -qF "value=\"$2\"" "$page" ;;
        esac
    fi
}

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

mailpit_code() { # <digits> -> newest OTP sent to that number
    local id
    id=$(curl -fsS -G "$mailpit_url/api/v1/search" --data-urlencode "query=to:$1@sms.local" |
        jq -r '.messages[0].ID // empty')
    [ -n "$id" ] || return 1
    curl -fsS "$mailpit_url/api/v1/message/$id" | jq -r '.Subject + "\n" + .Text'
}

start_login() { # [tenant slug]
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
        --data-urlencode "digit_tenant=${1:-$tenant}"
}

post() { # <url> <curl args...>; follows nothing, writes the page, prints the redirect target
    local url=$1
    shift
    curl -sS -c "$jar" -b "$jar" -o "$page" -w '%{redirect_url}' "$url" "$@"
}

start_login
on_page login-phone-number.ftl kc-digit-phone-form || fail "phone page not rendered by $theme"
has_attr digitTenant "$tenant" || fail "digitTenant attribute missing"
has_attr countryCode +254 || fail "countryCode +254 missing (tenant rule not applied)"
if [ "$keycloakify" = 1 ]; then
    has_attr mobileNumberRegex '^[71][0-9]{8}$' || fail "mobileNumberRegex attribute missing"
fi
pass "phone page ($theme) rendered with digitTenant=$tenant and countryCode +254"

post "$(form_action kc-digit-phone-form)" --data-urlencode phoneNumber=12345 >/dev/null
on_page login-phone-number.ftl kc-digit-phone-form || fail "invalid phone left the phone page"
grep -qF "$invalid_phone_text" "$page" || fail "invalid phone accepted"
has_attr phoneNumber 12345 || fail "phoneNumber not handed back for refill"
pass "invalid phone rejected (digitInvalidPhone) and refilled"

# digit-citizen posts only the national digits typed after its +254 prefix.
post "$(form_action kc-digit-phone-form)" --data-urlencode 'phoneNumber=712345678' >/dev/null
on_page login-sms-otp.ftl kc-digit-otp-form || fail "OTP page not rendered"
grep -q '678' "$page" || fail "masked phone missing"
if [ "$keycloakify" = 1 ]; then
    grep -q '"otpLength": 6' "$page" || fail "otpLength attribute missing"
    grep -q '"resendAvailableInSeconds": [0-9]' "$page" || fail "resendAvailableInSeconds missing"
fi
pass "national digits 712345678 -> OTP page for +254712345678"

sms=""
for _ in $(seq 1 10); do sms=$(mailpit_code 254712345678) && break; sleep 1; done
[ -n "$sms" ] || fail "no SMS in Mailpit"
printf '%s\n' "$sms" | head -1 | grep -qx 'SMS to +254712345678' || fail "unexpected subject: $sms"
code=$(printf '%s\n' "$sms" | tail -n +2 | grep -oE '\b[0-9]{6}\b' | head -1)
[ -n "$code" ] || fail "no code in SMS: $sms"
pass "SMS read back from Mailpit /api/v1/search"

wrong=$([ "$code" = 000000 ] && echo 111111 || echo 000000)
post "$(form_action kc-digit-otp-form)" --data-urlencode "otp=$wrong" >/dev/null
grep -qF "$invalid_otp_text" "$page" || fail "wrong OTP accepted"
pass "wrong OTP rejected (digitInvalidOtp)"

sleep 3 # KC_SPI_DIGIT_PHONE_OTP_RESEND_SECONDS=2
post "$(form_action kc-digit-otp-form)" --data-urlencode resend=true >/dev/null
on_page login-sms-otp.ftl kc-digit-otp-form || fail "resend left the OTP page"
resent=""
for _ in $(seq 1 10); do
    [ "$(curl -fsS -G "$mailpit_url/api/v1/search" \
        --data-urlencode 'query=to:254712345678@sms.local' | jq '.messages_count')" -ge 2 ] &&
        resent=$(mailpit_code 254712345678 | tail -n +2 | grep -oE '\b[0-9]{6}\b' | head -1) && break
    sleep 1
done
[ -n "$resent" ] || fail "resend=true sent no new SMS"
code=$resent
pass "resend=true sent a new code"

post "$(form_action kc-digit-otp-form)" --data-urlencode "otp=$code" >/dev/null
on_page login-phone-profile.ftl kc-digit-profile-form || fail "new user was not asked for a name"
pass "new citizen asked for a name"

post "$(form_action kc-digit-profile-form)" --data-urlencode firstName= --data-urlencode lastName=Kip >/dev/null
on_page login-phone-profile.ftl kc-digit-profile-form || fail "empty name accepted"
has_attr lastName Kip || fail "lastName not handed back for refill"
grep -qF 'Please specify first name' "$page" || fail "missingFirstNameMessage not shown"
pass "empty name rejected (missingFirstNameMessage) and refilled"

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
on_page login-sms-otp.ftl kc-digit-otp-form || fail "second login: OTP page not rendered"
code2=""
for _ in $(seq 1 10); do
    code2=$(mailpit_code 254712345678 | tail -n +2 | grep -oE '\b[0-9]{6}\b' | head -1) || true
    [ -n "$code2" ] && [ "$(curl -fsS -G "$mailpit_url/api/v1/search" \
        --data-urlencode 'query=to:254712345678@sms.local' | jq '.messages_count')" -ge 3 ] && break
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

if [ "$bff_stub" = 1 ]; then
    start_login nowhere-county
    on_page login-phone-number.ftl kc-digit-phone-form || fail "unknown tenant: phone page not rendered"
    has_attr countryCode "$default_cc" || fail "unknown tenant did not fall back to $default_cc"
    pass "tenant without branding falls back to the configured default ($default_cc)"
fi

echo "PASS citizen phone OTP smoke"
