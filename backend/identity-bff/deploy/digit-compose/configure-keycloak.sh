#!/usr/bin/env bash
# Idempotently configures the shared Organizations realm used by the identity
# BFF. Run on the Docker host after the keycloak container is healthy.
#
# Admin access is ephemeral: unless KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD are
# exported for this run, a random temporary master-realm admin is created with
# `kc.sh bootstrap-admin`, used, and deleted before exit. Nothing is written
# to disk outside the container's temporary kcadm config, which is removed.
set -euo pipefail

readonly IDENTITY_ENV_DIR=${IDENTITY_ENV_DIR:-/opt/digit}
readonly KEYCLOAK_CONTAINER=${KEYCLOAK_CONTAINER:-keycloak}
readonly KC_CONFIG=/tmp/identity-bff-kcadm.config
readonly BFF_CLIENT=digit-identity-bff
# Removed design: Standard Token Exchange to this audience is no longer used.
readonly RETIRED_ASSERTION_AUDIENCE=digit-identity-exchange
readonly ADMIN_CLIENT=digit-identity-admin
readonly ROLE_CLIENT=digit-ui
readonly MAGIC_LINK_FLOW=digit-magic-link-browser
readonly MAGIC_LINK_FORMS=digit-magic-link-forms

# Standalone installs keep these values in identity-bff.env. Ansible deployments
# pass them as task-scoped environment variables so no second secrets file has
# to be maintained beside the Compose .env.
if [ -f "$IDENTITY_ENV_DIR/identity-bff.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$IDENTITY_ENV_DIR/identity-bff.env"
  set +a
fi
readonly REALM=${KEYCLOAK_ORGANIZATION_REALM:?set KEYCLOAK_ORGANIZATION_REALM}
readonly SSL_REQUIRED=${KEYCLOAK_SSL_REQUIRED:-external}
readonly MAGIC_LINK_CLIENT=${KEYCLOAK_MAGIC_LINK_CLIENT_ID:-digit-identity-bff-magic-link}
readonly ALLOWED_ORIGINS=${IDENTITY_ALLOWED_ORIGINS:-${IDENTITY_ALLOWED_ORIGIN:-}}
readonly ALLOWED_ORIGINS_JSON=$(printf '%s' "$ALLOWED_ORIGINS" | jq -Rc \
  'split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))')

temporary_admin=false
if [ -z "${KC_BOOTSTRAP_ADMIN_USERNAME:-}" ] || [ -z "${KC_BOOTSTRAP_ADMIN_PASSWORD:-}" ]; then
  KC_BOOTSTRAP_ADMIN_USERNAME="bootstrap-$(openssl rand -hex 6)"
  KC_BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -base64 36 | tr -d '\n')
  temporary_admin=true
  docker exec \
    -e KC_BOOTSTRAP_ADMIN_USERNAME="$KC_BOOTSTRAP_ADMIN_USERNAME" \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
    "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kc.sh bootstrap-admin user \
    --username:env KC_BOOTSTRAP_ADMIN_USERNAME \
    --password:env KC_BOOTSTRAP_ADMIN_PASSWORD \
    --http-management-port=9001 >/dev/null
fi

kc() {
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh "$@" --config "$KC_CONFIG"
}

cleanup() {
  if [ "$temporary_admin" = true ]; then
    admin_id=$(kc get users -r master -q "username=$KC_BOOTSTRAP_ADMIN_USERNAME" --fields id 2>/dev/null |
      jq -r '.[0].id // empty' || true)
    if [ -n "$admin_id" ]; then kc delete "users/$admin_id" -r master >/dev/null 2>&1 || true; fi
  fi
  docker exec "$KEYCLOAK_CONTAINER" rm -f "$KC_CONFIG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec \
  -e KCADM_USERNAME="$KC_BOOTSTRAP_ADMIN_USERNAME" \
  -e KCADM_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  "$KEYCLOAK_CONTAINER" sh -c \
  '/opt/keycloak/bin/kcadm.sh config credentials --config '"$KC_CONFIG"' --server http://127.0.0.1:8180 --realm master --user "$KCADM_USERNAME" --password "$KCADM_PASSWORD" >/dev/null'

client_uuid() {
  kc get clients -r "$REALM" -q "clientId=$1" --fields id,clientId |
    jq -r --arg id "$1" '.[] | select(.clientId == $id) | .id' | head -1
}

ensure_client() {
  local client_id=$1 secret=$2 service_accounts=$3 client_uuid_value
  client_uuid_value=$(client_uuid "$client_id")
  if [ -z "$client_uuid_value" ]; then
    kc create clients -r "$REALM" \
      -s "clientId=$client_id" -s enabled=true -s publicClient=false \
      -s "secret=$secret" -s standardFlowEnabled=false \
      -s directAccessGrantsEnabled=false \
      -s "serviceAccountsEnabled=$service_accounts" >/dev/null
    client_uuid_value=$(client_uuid "$client_id")
  else
    kc update "clients/$client_uuid_value" -r "$REALM" \
      -s enabled=true -s publicClient=false -s "secret=$secret" \
      -s directAccessGrantsEnabled=false \
      -s "serviceAccountsEnabled=$service_accounts" >/dev/null
  fi
  printf '%s' "$client_uuid_value"
}

ensure_social_provider() {
  local alias=$1 provider=$2 client_id=$3 client_secret=$4
  [ -n "$client_id" ] || return 0
  [ -n "$client_secret" ] || {
    printf 'missing client secret for configured %s identity provider\n' "$alias" >&2
    return 1
  }
  if kc get "identity-provider/instances/$alias" -r "$REALM" >/dev/null 2>&1; then
    kc update "identity-provider/instances/$alias" -r "$REALM" \
      -s enabled=true -s trustEmail=false -s storeToken=false \
      -s "config.clientId=$client_id" -s "config.clientSecret=$client_secret" >/dev/null
  else
    kc create identity-provider/instances -r "$REALM" \
      -s "alias=$alias" -s "providerId=$provider" -s enabled=true \
      -s trustEmail=false -s storeToken=false \
      -s "config.clientId=$client_id" -s "config.clientSecret=$client_secret" >/dev/null
  fi
}

ensure_mapper() {
  local owner=$1 name=$2 mapper=$3 mapper_id
  shift 3
  mapper_id=$(kc get "$owner/protocol-mappers/models" -r "$REALM" |
    jq -r --arg name "$name" '.[] | select(.name == $name) | .id' | head -1)
  if [ -z "$mapper_id" ]; then
    kc create "$owner/protocol-mappers/models" -r "$REALM" \
      -s "name=$name" -s protocol=openid-connect -s "protocolMapper=$mapper" "$@" >/dev/null
  else
    kc update "$owner/protocol-mappers/models/$mapper_id" -r "$REALM" \
      -s "name=$name" -s protocol=openid-connect -s "protocolMapper=$mapper" "$@" >/dev/null
  fi
}

flow_uuid() {
  kc get authentication/flows -r "$REALM" |
    jq -r --arg alias "$1" '.[] | select(.alias == $alias) | .id' | head -1
}

ensure_execution() {
  local flow=$1 provider=$2 requirement=$3 execution
  execution=$(kc get "authentication/flows/$flow/executions" -r "$REALM" |
    jq -c --arg provider "$provider" '.[] | select(.providerId == $provider)' | head -1)
  if [ -z "$execution" ]; then
    kc create "authentication/flows/$flow/executions/execution" -r "$REALM" \
      -s "provider=$provider" >/dev/null
    execution=$(kc get "authentication/flows/$flow/executions" -r "$REALM" |
      jq -c --arg provider "$provider" '.[] | select(.providerId == $provider)' | head -1)
  fi
  printf '%s' "$execution" | jq --arg requirement "$requirement" \
    '.requirement = $requirement' |
    docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh \
      update "authentication/flows/$flow/executions" -r "$REALM" -f - \
      --config "$KC_CONFIG" >/dev/null
}

configure_magic_link() {
  : "${KEYCLOAK_MAGIC_LINK_CLIENT_SECRET:?set KEYCLOAK_MAGIC_LINK_CLIENT_SECRET}"
  : "${KEYCLOAK_SMTP_HOST:?set KEYCLOAK_SMTP_HOST}"
  : "${KEYCLOAK_SMTP_FROM:?set KEYCLOAK_SMTP_FROM}"

  local smtp_auth=${KEYCLOAK_SMTP_AUTH:-false}
  local smtp_port=${KEYCLOAK_SMTP_PORT:-587}
  local smtp_ssl=${KEYCLOAK_SMTP_SSL:-false}
  local smtp_starttls=${KEYCLOAK_SMTP_STARTTLS:-true}
  local smtp_from_name=${KEYCLOAK_SMTP_FROM_DISPLAY_NAME:-DIGIT Identity}
  local smtp_user=${KEYCLOAK_SMTP_USER:-}
  local smtp_password=${KEYCLOAK_SMTP_PASSWORD:-}

  kc get "realms/$REALM" |
    jq --arg host "$KEYCLOAK_SMTP_HOST" --arg port "$smtp_port" \
      --arg from "$KEYCLOAK_SMTP_FROM" --arg from_name "$smtp_from_name" \
      --arg auth "$smtp_auth" --arg ssl "$smtp_ssl" --arg starttls "$smtp_starttls" \
      --arg user "$smtp_user" --arg password "$smtp_password" \
      '.loginWithEmailAllowed = true |
       .registrationEmailAsUsername = false |
       .duplicateEmailsAllowed = false |
       .smtpServer = {host:$host, port:$port, from:$from,
         fromDisplayName:$from_name, auth:$auth, ssl:$ssl, starttls:$starttls} |
       if $user != "" then .smtpServer.user = $user else . end |
       if $password != "" then .smtpServer.password = $password else . end' |
    docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh \
      update "realms/$REALM" -f - --config "$KC_CONFIG" >/dev/null

  if [ -z "$(flow_uuid "$MAGIC_LINK_FLOW")" ]; then
    kc create authentication/flows -r "$REALM" \
      -s "alias=$MAGIC_LINK_FLOW" \
      -s 'description=Passwordless email magic-link browser flow' \
      -s providerId=basic-flow -s topLevel=true -s builtIn=false >/dev/null
  fi
  ensure_execution "$MAGIC_LINK_FLOW" auth-cookie ALTERNATIVE

  local forms_execution
  forms_execution=$(kc get "authentication/flows/$MAGIC_LINK_FLOW/executions" -r "$REALM" |
    jq -c --arg display "$MAGIC_LINK_FORMS" '.[] | select(.displayName == $display)' | head -1)
  if [ -z "$forms_execution" ]; then
    kc create "authentication/flows/$MAGIC_LINK_FLOW/executions/flow" -r "$REALM" \
      -s "alias=$MAGIC_LINK_FORMS" -s 'description=Magic link email form' \
      -s provider=registration-page -s type=basic-flow >/dev/null
  fi
  forms_execution=$(kc get "authentication/flows/$MAGIC_LINK_FLOW/executions" -r "$REALM" |
    jq -c --arg display "$MAGIC_LINK_FORMS" '.[] | select(.displayName == $display)' | head -1)
  printf '%s' "$forms_execution" | jq '.requirement = "ALTERNATIVE"' |
    docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh \
      update "authentication/flows/$MAGIC_LINK_FLOW/executions" -r "$REALM" -f - \
      --config "$KC_CONFIG" >/dev/null

  ensure_execution "$MAGIC_LINK_FORMS" ext-magic-form REQUIRED
  local magic_execution magic_execution_id magic_config_id
  magic_execution=$(kc get "authentication/flows/$MAGIC_LINK_FORMS/executions" -r "$REALM" |
    jq -c '.[] | select(.providerId == "ext-magic-form")' | head -1)
  magic_execution_id=$(printf '%s' "$magic_execution" | jq -r .id)
  magic_config_id=$(printf '%s' "$magic_execution" | jq -r '.authenticationConfig // empty')
  if [ -z "$magic_config_id" ]; then
    kc create "authentication/executions/$magic_execution_id/config" -r "$REALM" \
      -s alias=digit-magic-link-config \
      -s 'config."ext-magic-create-nonexistent-user"=true' \
      -s 'config."ext-magic-update-profile-action"=false' \
      -s 'config."ext-magic-update-password-action"=false' \
      -s 'config."ext-magic-allow-token-reuse"=false' \
      -s 'config."ext-magic-token-life-span"=600' >/dev/null
  fi

  local magic_uuid magic_flow_id
  magic_uuid=$(ensure_client "$MAGIC_LINK_CLIENT" "$KEYCLOAK_MAGIC_LINK_CLIENT_SECRET" false)
  magic_flow_id=$(flow_uuid "$MAGIC_LINK_FLOW")
  kc update "clients/$magic_uuid" -r "$REALM" \
    -s standardFlowEnabled=true \
    -s "redirectUris=[\"$IDENTITY_REDIRECT_URI\"]" \
    -s "webOrigins=$ALLOWED_ORIGINS_JSON" \
    -s 'attributes."pkce.code.challenge.method"=S256' \
    -s 'attributes."post.logout.redirect.uris"=+' \
    -s "authenticationFlowBindingOverrides.browser=$magic_flow_id" >/dev/null

  ensure_mapper "clients/$magic_uuid" digit-identity-bff-audience oidc-audience-mapper \
    -s "config.\"included.client.audience\"=$BFF_CLIENT" \
    -s 'config."id.token.claim"=false' -s 'config."access.token.claim"=true'
  kc update "clients/$magic_uuid/optional-client-scopes/$organization_scope" \
    -r "$REALM" -n >/dev/null
}

# A new realm gets conservative defaults; an existing realm is only switched
# to Organizations so operator-tuned settings are preserved.
if kc get "realms/$REALM" >/dev/null 2>&1; then
  kc update "realms/$REALM" -s organizationsEnabled=true \
    -s "sslRequired=$SSL_REQUIRED" >/dev/null
else
  kc create realms -s "realm=$REALM" -s enabled=true -s organizationsEnabled=true \
    -s registrationAllowed=false -s loginWithEmailAllowed=true \
    -s resetPasswordAllowed=false -s bruteForceProtected=true \
    -s "sslRequired=$SSL_REQUIRED" -s accessTokenLifespan=300 \
    -s ssoSessionIdleTimeout=1800 -s ssoSessionMaxLifespan=604800 >/dev/null
fi

# Organization-group client roles are published under this client and filtered
# by the DIGIT projection allowlist. It is a role container, not a login client.
if [ -z "$(client_uuid "$ROLE_CLIENT")" ]; then
  kc create clients -r "$REALM" -s "clientId=$ROLE_CLIENT" -s enabled=true \
    -s bearerOnly=true -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false >/dev/null
fi

bff_uuid=$(ensure_client "$BFF_CLIENT" "$KEYCLOAK_BFF_CLIENT_SECRET" false)
kc update "clients/$bff_uuid" -r "$REALM" \
  -s standardFlowEnabled=true \
  -s "redirectUris=[\"$IDENTITY_REDIRECT_URI\"]" \
  -s "webOrigins=$ALLOWED_ORIGINS_JSON" \
  -s 'attributes."pkce.code.challenge.method"=S256' \
  -s 'attributes."post.logout.redirect.uris"=+' \
  -s 'attributes."standard.token.exchange.enabled"=false' >/dev/null

retired_uuid=$(client_uuid "$RETIRED_ASSERTION_AUDIENCE")
if [ -n "$retired_uuid" ]; then kc delete "clients/$retired_uuid" -r "$REALM" >/dev/null; fi
retired_mapper=$(kc get "clients/$bff_uuid/protocol-mappers/models" -r "$REALM" |
  jq -r '.[] | select(.name == "digit-identity-exchange-audience") | .id' | head -1)
if [ -n "$retired_mapper" ]; then
  kc delete "clients/$bff_uuid/protocol-mappers/models/$retired_mapper" -r "$REALM" >/dev/null
fi

ensure_mapper "clients/$bff_uuid" digit-identity-bff-audience oidc-audience-mapper \
  -s "config.\"included.client.audience\"=$BFF_CLIENT" \
  -s 'config."id.token.claim"=false' -s 'config."access.token.claim"=true'

organization_scope=$(kc get client-scopes -r "$REALM" |
  jq -r '.[] | select(.name == "organization") | .id' | head -1)
if [ -z "$organization_scope" ]; then
  kc create client-scopes -r "$REALM" -s name=organization -s protocol=openid-connect \
    -s 'attributes."include.in.token.scope"=true' \
    -s 'attributes."display.on.consent.screen"=false' >/dev/null
  organization_scope=$(kc get client-scopes -r "$REALM" |
    jq -r '.[] | select(.name == "organization") | .id' | head -1)
fi
ensure_mapper "client-scopes/$organization_scope" organization \
  oidc-organization-membership-mapper \
  -s 'config."id.token.claim"=true' -s 'config."access.token.claim"=true' \
  -s 'config."userinfo.token.claim"=true' -s 'config."introspection.token.claim"=true' \
  -s 'config."claim.name"=organization' -s 'config."jsonType.label"=String' \
  -s 'config."multivalued"=true' -s 'config."addOrganizationId"=true'
ensure_mapper "client-scopes/$organization_scope" 'organization groups' \
  oidc-organization-group-membership-mapper \
  -s 'config."id.token.claim"=true' -s 'config."access.token.claim"=true' \
  -s 'config."userinfo.token.claim"=true' -s 'config."introspection.token.claim"=true' \
  -s 'config."addGroupRoleMappings"=true'
kc update "clients/$bff_uuid/optional-client-scopes/$organization_scope" -r "$REALM" -n >/dev/null

if [ "${KEYCLOAK_MAGIC_LINK_ENABLED:-false}" = true ]; then
  configure_magic_link
fi

ensure_social_provider google google \
  "${KEYCLOAK_GOOGLE_CLIENT_ID:-}" "${KEYCLOAK_GOOGLE_CLIENT_SECRET:-}"
ensure_social_provider github github \
  "${KEYCLOAK_GITHUB_CLIENT_ID:-}" "${KEYCLOAK_GITHUB_CLIENT_SECRET:-}"

admin_uuid=$(ensure_client "$ADMIN_CLIENT" "$KEYCLOAK_ADMIN_CLIENT_SECRET" true)
service_user=$(kc get "clients/$admin_uuid/service-account-user" -r "$REALM" | jq -r '.id')
management_uuid=$(client_uuid realm-management)
kc get "clients/$management_uuid/roles" -r "$REALM" |
  jq '[.[] | select(.name == "manage-organizations" or .name == "query-organizations" or
                    .name == "view-organizations" or .name == "manage-users" or
                    .name == "query-users" or .name == "view-users" or
                    .name == "query-clients" or .name == "view-clients" or
                    .name == "view-identity-providers")]' |
  docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh \
    create "users/$service_user/role-mappings/clients/$management_uuid" \
    -r "$REALM" -f - --config "$KC_CONFIG" >/dev/null

role_uuid=$(client_uuid "$ROLE_CLIENT")
for role in EMPLOYEE SUPERUSER GRO PGR_LME DGRO CSR SUPERVISOR \
  AUTO_ESCALATE PGR_VIEWER TICKET_REPORT_VIEWER TENANT_ADMIN VIEWER \
  ACCOUNT_ADMIN MDMS_ADMIN LOC_ADMIN; do
  if ! kc get "clients/$role_uuid/roles/$role" -r "$REALM" >/dev/null 2>&1; then
    kc create "clients/$role_uuid/roles" -r "$REALM" -s "name=$role" >/dev/null
  fi
done

printf 'realm=%s organizations=enabled bff_client=%s magic_link=%s admin_client=%s temporary_admin_removed=%s\n' \
  "$REALM" "$BFF_CLIENT" "${KEYCLOAK_MAGIC_LINK_ENABLED:-false}" "$ADMIN_CLIENT" "$temporary_admin"
