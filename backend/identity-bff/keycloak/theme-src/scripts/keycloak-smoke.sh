#!/usr/bin/env bash
# Browser-level smoke test of the built theme on the supported Keycloak.
#
# Builds the identity-keycloak image (which builds this theme), starts it,
# seeds a realm and a client with `login_theme=digit`, and drives the resulting
# authorization URL in a real browser. Everything runs on one docker network so
# no host ports or host browsers are needed.
set -euo pipefail

cd "$(dirname "$0")/.."
identity_dir=$(cd ../.. && pwd)
repo_root=$(cd ../../../.. && pwd)
theme_dir=backend/identity-bff/keycloak/theme-src

image=${IDENTITY_KEYCLOAK_IMAGE:-identity-keycloak:smoke}
network=digit-theme-smoke-$$
container=keycloak-theme-smoke-$$
realm=digit
client=digit-identity-bff
playwright_image="mcr.microsoft.com/playwright:v$(node -p "require('./scripts/playwright-version.cjs')")-noble"

cleanup() {
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [ "${SKIP_BUILD:-0}" != "1" ]; then
    docker build -f keycloak/Dockerfile.magic-link -t "$image" "$identity_dir"
fi

docker network create "$network" >/dev/null
docker run -d --name "$container" --network "$network" \
    -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
    "$image" start-dev >/dev/null

kcadm() { docker exec "$container" /opt/keycloak/bin/kcadm.sh "$@"; }

echo "waiting for Keycloak..."
for _ in $(seq 1 90); do
    if kcadm config credentials --server http://localhost:8080 \
        --realm master --user admin --password admin >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
kcadm config credentials --server http://localhost:8080 \
    --realm master --user admin --password admin >/dev/null

kcadm create realms -s "realm=$realm" -s enabled=true -s loginWithEmailAllowed=true >/dev/null
kcadm create clients -r "$realm" -s "clientId=$client" -s enabled=true \
    -s publicClient=true -s standardFlowEnabled=true \
    -s 'redirectUris=["http://localhost/*"]' \
    -s baseUrl=http://localhost/configurator/ \
    -s 'attributes."login_theme"=digit' >/dev/null

login_url="http://$container:8080/realms/$realm/protocol/openid-connect/auth"
login_url="$login_url?client_id=$client&redirect_uri=http%3A%2F%2Flocalhost%2Fcb&response_type=code&scope=openid"

docker run --rm --init --network "$network" \
    -v "$repo_root":/work -v "/work/$theme_dir/node_modules" -w "/work/$theme_dir" \
    -e CI=1 -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
    -e KEYCLOAK_LOGIN_URL="$login_url" \
    "$playwright_image" \
    bash -lc "npm ci --no-audit --no-fund && npx playwright test --config playwright.keycloak.config.ts"
