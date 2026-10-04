#!/usr/bin/env bash
# Applies configure-keycloak.sh to a throwaway Keycloak and checks the result
# by driving real sign-ins (tests/live-check.py).
#
#   keycloak/tests/run-live-check.sh
#
# Starts its own Keycloak (KEYCLOAK_IMAGE, default the stock 26.7.3 image) and
# a Mailpit mail catcher on a private Docker network, publishes both on
# loopback only, and removes everything on exit (KEEP_STACK=1 keeps them).
# Nothing here talks to a real deployment.
set -euo pipefail

cd "$(dirname "$0")/.."
keycloak_dir=$(pwd)

image=${KEYCLOAK_IMAGE:-quay.io/keycloak/keycloak:26.7.3}
mailpit_image=${MAILPIT_IMAGE:-axllent/mailpit:v1.27}
run_id=$$
network=kc-live-check-$run_id
container=kc-live-check-$run_id
mailpit=kc-live-check-mail-$run_id

cleanup() {
  if [ "${KEEP_STACK:-0}" = 1 ]; then
    printf 'kept: %s %s on %s\n' "$container" "$mailpit" "$network" >&2
    return
  fi
  docker rm -f "$container" "$mailpit" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name "$mailpit" --network "$network" --network-alias mailpit \
  -p 127.0.0.1::8025 "$mailpit_image" >/dev/null
# The admin user exists only inside this throwaway container.
docker run -d --name "$container" --network "$network" \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  -p 127.0.0.1::8180 "$image" start-dev --http-port=8180 >/dev/null

kc_port=$(docker port "$container" 8180/tcp | head -1 | sed 's/.*://')
mail_port=$(docker port "$mailpit" 8025/tcp | head -1 | sed 's/.*://')
curl -fsS --retry 60 --retry-delay 2 --retry-all-errors -o /dev/null \
  "http://127.0.0.1:$kc_port/realms/master"

secret() { openssl rand -hex 16; }
export KEYCLOAK_CONTAINER=$container
export KC_BOOTSTRAP_ADMIN_USERNAME=admin KC_BOOTSTRAP_ADMIN_PASSWORD=admin
export IDENTITY_ENV_DIR=/nonexistent
export KEYCLOAK_ORGANIZATION_REALM=digit KEYCLOAK_SSL_REQUIRED=none
export IDENTITY_REDIRECT_URI=http://localhost/identity/v1/callback
export IDENTITY_ALLOWED_ORIGINS=http://localhost
export KEYCLOAK_SMTP_HOST=mailpit KEYCLOAK_SMTP_PORT=1025 KEYCLOAK_SMTP_STARTTLS=false
export KEYCLOAK_SMTP_FROM=identity@example.test
KEYCLOAK_BFF_CLIENT_SECRET=$(secret)
KEYCLOAK_ADMIN_CLIENT_SECRET=$(secret)
KEYCLOAK_EMPLOYEE_CLIENT_SECRET=$(secret)
KEYCLOAK_CITIZEN_CLIENT_SECRET=$(secret)
KEYCLOAK_MAGIC_LINK_CLIENT_SECRET=$(secret)
export KEYCLOAK_BFF_CLIENT_SECRET KEYCLOAK_ADMIN_CLIENT_SECRET KEYCLOAK_EMPLOYEE_CLIENT_SECRET \
  KEYCLOAK_CITIZEN_CLIENT_SECRET KEYCLOAK_MAGIC_LINK_CLIENT_SECRET
# Placeholder social providers: never contacted, but configured like real ones.
export KEYCLOAK_GOOGLE_CLIENT_ID=placeholder-google KEYCLOAK_GOOGLE_CLIENT_SECRET=placeholder
export KEYCLOAK_GITHUB_CLIENT_ID=placeholder-github KEYCLOAK_GITHUB_CLIENT_SECRET=placeholder
export KEYCLOAK_EVENTS_EXPIRATION_SECONDS=${KEYCLOAK_EVENTS_EXPIRATION_SECONDS:-604800}

# Twice: the second run must be a no-op that still succeeds.
"$keycloak_dir/configure-keycloak.sh"
"$keycloak_dir/configure-keycloak.sh"

KC_URL=http://127.0.0.1:$kc_port MAILPIT_URL=http://127.0.0.1:$mail_port \
  KEYCLOAK_CONFIGURE="$keycloak_dir/configure-keycloak.sh" \
  python3 -u "$keycloak_dir/tests/live-check.py" "$@"
