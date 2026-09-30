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
readonly FIRST_BROKER_FLOW=digit-first-broker-login
# The Keycloakify login theme shipped in the Keycloak image
# (keycloak/theme-src, built by keycloak/Dockerfile.magic-link). Selected per
# client rather than on the shared realm.
readonly LOGIN_THEME=${KEYCLOAK_LOGIN_THEME:-configurator-blue}
# digit-ui sign-in surfaces (CCRS #2167). Each has its own client. The
# employee client has its own browser flow and Keycloakify theme; the citizen
# client uses the realm's flow and sets no theme, because citizens sign in with
# phone OTP inside digit-ui and never see a Keycloak page. A citizen theme
# (digit-citizen) comes back with the first Keycloak sign-in method for citizens.
readonly EMPLOYEE_LOGIN_THEME=${KEYCLOAK_EMPLOYEE_LOGIN_THEME:-digit-employee}
readonly EMPLOYEE_FLOW=digit-employee-browser
# Realm-level theme names this deployment set itself and may therefore clear.
# `digit` is the name earlier revisions used before the theme was renamed.
readonly OWNED_REALM_THEMES="$LOGIN_THEME digit $EMPLOYEE_LOGIN_THEME digit-citizen"

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
readonly EMPLOYEE_CLIENT=${KEYCLOAK_EMPLOYEE_CLIENT_ID:-digit-ui-employee}
readonly CITIZEN_CLIENT=${KEYCLOAK_CITIZEN_CLIENT_ID:-digit-ui-citizen}
readonly EMPLOYEE_SIGNIN_METHODS=${KEYCLOAK_EMPLOYEE_SIGNIN_METHODS:-password}
# Which citizen sign-in methods to offer is open (CCRS #2189): none by default.
# An empty value leaves the client attribute absent (see configure_digit_ui_client).
readonly CITIZEN_SIGNIN_METHODS=${KEYCLOAK_CITIZEN_SIGNIN_METHODS:-}
# Journey policy belongs to the OIDC client. The BFF reads these attributes
# live; these values are installer inputs, not BFF runtime configuration.
readonly BFF_SIGNIN_METHODS=${KEYCLOAK_BFF_SIGNIN_METHODS:-password,google,github}
readonly BFF_SIGNUP_METHODS=${KEYCLOAK_BFF_SIGNUP_METHODS:-magic_link,google,github}
# Keycloak's execute-actions redirect validation matches this path wildcard but
# does not treat a trailing wildcard as matching a query string.
readonly PASSWORD_SETUP_REDIRECT="${IDENTITY_REDIRECT_URI%/callback}/password/setup-complete/*"
readonly POST_LOGIN_REDIRECT=${IDENTITY_POST_LOGIN_REDIRECT:-/}
# digit-ui lives at /{tenantSlug}/digit-ui/... on the same origin as the BFF.
readonly DIGIT_UI_BASE_URL=${IDENTITY_DIGIT_UI_BASE_URL:-${IDENTITY_REDIRECT_URI%%/identity/*}/}
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
  local alias=$1 provider=$2 client_id=$3 client_secret=$4 display_name
  case "$alias" in
    google) display_name=Google ;;
    github) display_name=GitHub ;;
    *) display_name=$alias ;;
  esac
  [ -n "$client_id" ] || return 0
  [ -n "$client_secret" ] || {
    printf 'missing client secret for configured %s identity provider\n' "$alias" >&2
    return 1
  }
  if kc get "identity-provider/instances/$alias" -r "$REALM" >/dev/null 2>&1; then
    kc update "identity-provider/instances/$alias" -r "$REALM" \
      -s enabled=true -s "displayName=$display_name" -s trustEmail=false -s storeToken=false \
      -s "firstBrokerLoginFlowAlias=$FIRST_BROKER_FLOW" \
      -s "config.clientId=$client_id" -s "config.clientSecret=$client_secret" >/dev/null
  else
    kc create identity-provider/instances -r "$REALM" \
      -s "alias=$alias" -s "providerId=$provider" -s "displayName=$display_name" -s enabled=true \
      -s trustEmail=false -s storeToken=false \
      -s "firstBrokerLoginFlowAlias=$FIRST_BROKER_FLOW" \
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

ensure_top_level_flow() {
  local alias=$1 description=$2
  if [ -z "$(flow_uuid "$alias")" ]; then
    kc create authentication/flows -r "$REALM" \
      -s "alias=$alias" -s "description=$description" \
      -s providerId=basic-flow -s topLevel=true -s builtIn=false >/dev/null
  fi
}

# Adds `provider` to `flow` once and pins its requirement. `flow` may be a
# sub-flow alias; Keycloak resolves either.
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

# The digit-ui flows deliberately have no auth-cookie step: an existing
# Keycloak SSO session (e.g. from the Configurator) must not sign someone in to
# another surface without that surface's own credential.
remove_cookie_executions() {
  local flow=$1 id
  for id in $(kc get "authentication/flows/$flow/executions" -r "$REALM" |
    jq -r '.[] | select(.providerId == "auth-cookie") | .id'); do
    kc delete "authentication/executions/$id" -r "$REALM" >/dev/null
  done
}

configure_employee_flow() {
  ensure_top_level_flow "$EMPLOYEE_FLOW" 'digit-ui employee sign-in: username and password'
  remove_cookie_executions "$EMPLOYEE_FLOW"
  ensure_execution "$EMPLOYEE_FLOW" auth-username-password-form REQUIRED
}

# One confidential authorization-code client per digit-ui surface. The BFF is
# the only party that talks to it (PKCE, its own callback), and binds the
# client's theme and, when `flow` is set, its browser flow (an empty `flow`
# clears any override, so the realm's browser flow applies; an empty `theme`
# likewise leaves login_theme absent, clearing an earlier value).
# `digit.auth.signup.methods` is empty by design (no self-service sign-up).
# Keycloak does not persist an empty client attribute (the JPA ClientAdapter
# removes it), so writing "" through the JSON body clears any earlier value and
# leaves the attribute ABSENT, which is how the BFF must read "no sign-up
# methods" (and, for an empty citizen list, "no sign-in methods").
configure_digit_ui_client() {
  local client_id=$1 secret=$2 surface=$3 theme=$4 signin_methods=$5 flow=$6
  local client_uuid_value flow_id=
  client_uuid_value=$(ensure_client "$client_id" "$secret" false)
  [ -z "$flow" ] || flow_id=$(flow_uuid "$flow")
  kc update "clients/$client_uuid_value" -r "$REALM" \
    -s standardFlowEnabled=true -s implicitFlowEnabled=false \
    -s "baseUrl=$DIGIT_UI_BASE_URL" \
    -s "redirectUris=[\"$IDENTITY_REDIRECT_URI\"]" \
    -s "webOrigins=$ALLOWED_ORIGINS_JSON" \
    -s "authenticationFlowBindingOverrides.browser=$flow_id" >/dev/null
  kc get "clients/$client_uuid_value" -r "$REALM" |
    jq --arg theme "$theme" --arg surface "$surface" --arg signin "$signin_methods" \
      '.attributes = ((.attributes // {}) + {
         "pkce.code.challenge.method": "S256",
         "post.logout.redirect.uris": "+",
         "login_theme": $theme,
         "digit.auth.surface": $surface,
         "digit.auth.signin.methods": $signin,
         "digit.auth.signup.methods": "",
         "standard.token.exchange.enabled": "false"
       })' |
    docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh \
      update "clients/$client_uuid_value" -r "$REALM" -f - --config "$KC_CONFIG" >/dev/null
  # Tokens are verified by the BFF against its own audience; azp stays the
  # surface client, which is how the BFF tells the surfaces apart.
  ensure_mapper "clients/$client_uuid_value" digit-identity-bff-audience oidc-audience-mapper \
    -s "config.\"included.client.audience\"=$BFF_CLIENT" \
    -s 'config."id.token.claim"=false' -s 'config."access.token.claim"=true'
  # Returned through a variable, not stdout: inside $(...) bash drops `set -e`,
  # so a failed kc update above would go unnoticed (review, #2199).
  DIGIT_UI_CLIENT_UUID=$client_uuid_value
}

# Keeps every attribute an admin can see (ADMIN_EDIT, instead of silently
# dropping unmanaged attributes). Written as JSON because kcadm cannot set the
# dotted `unmanagedAttributePolicy` key.
configure_user_profile() {
  kc get users/profile -r "$REALM" |
    jq '.unmanagedAttributePolicy = "ADMIN_EDIT"' |
    docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh \
      update users/profile -r "$REALM" -f - --config "$KC_CONFIG" >/dev/null
}

configure_first_broker_login() {
  # Pin the account-linking behaviour instead of inheriting whatever a realm's
  # default happens to contain. Keycloak 26's built-in flow already has the
  # exact safety properties required here: confirm linking, then prove the
  # existing account by email or re-authentication before attaching the IdP.
  if [ -z "$(flow_uuid "$FIRST_BROKER_FLOW")" ]; then
    kc create 'authentication/flows/first%20broker%20login/copy' -r "$REALM" \
      -s "newName=$FIRST_BROKER_FLOW" >/dev/null
  fi
  local executions
  executions=$(kc get "authentication/flows/$FIRST_BROKER_FLOW/executions" -r "$REALM")
  local invariant provider requirement
  for invariant in \
    idp-create-user-if-unique:ALTERNATIVE \
    idp-confirm-link:REQUIRED \
    idp-email-verification:ALTERNATIVE \
    idp-username-password-form:REQUIRED; do
    provider=${invariant%%:*}
    requirement=${invariant#*:}
    if ! printf '%s' "$executions" | jq -e \
      --arg provider "$provider" --arg requirement "$requirement" \
      'any(.[]; .providerId == $provider and .requirement == $requirement)' >/dev/null; then
      printf 'first broker flow execution invariant failed: %s must be %s\n' \
        "$provider" "$requirement" >&2
      return 1
    fi
  done
}

configure_smtp() {
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
}

configure_magic_link() {
  : "${KEYCLOAK_MAGIC_LINK_CLIENT_SECRET:?set KEYCLOAK_MAGIC_LINK_CLIENT_SECRET}"
  # The client application collects the identity draft and the BFF calls the extension's
  # authenticated /magic-link resource. Its action token skips browser flows,
  # so this client must not retain the old hosted email-form binding.
  local magic_uuid
  magic_uuid=$(ensure_client "$MAGIC_LINK_CLIENT" "$KEYCLOAK_MAGIC_LINK_CLIENT_SECRET" false)
  kc update "clients/$magic_uuid" -r "$REALM" \
    -s standardFlowEnabled=true \
    -s "baseUrl=$POST_LOGIN_REDIRECT" \
    -s "redirectUris=[\"$IDENTITY_REDIRECT_URI\"]" \
    -s "webOrigins=$ALLOWED_ORIGINS_JSON" \
    -s 'attributes."pkce.code.challenge.method"=S256' \
    -s 'attributes."post.logout.redirect.uris"=+' \
    -s "attributes.\"login_theme\"=$LOGIN_THEME" \
    -s 'authenticationFlowBindingOverrides={}' >/dev/null

  ensure_mapper "clients/$magic_uuid" digit-identity-bff-audience oidc-audience-mapper \
    -s "config.\"included.client.audience\"=$BFF_CLIENT" \
    -s 'config."id.token.claim"=false' -s 'config."access.token.claim"=true'
  kc update "clients/$magic_uuid/optional-client-scopes/$organization_scope" \
    -r "$REALM" -n >/dev/null
}

# A new realm gets conservative defaults; the small set of identity invariants
# applied below is also pinned on existing realms.
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

# These are identity invariants, not magic-link settings. Pin them on both new
# and existing realms even when the optional magic-link resource is disabled.
kc update "realms/$REALM" -s organizationsEnabled=true \
  -s loginWithEmailAllowed=true -s duplicateEmailsAllowed=false \
  -s resetPasswordAllowed=false \
  -s "sslRequired=$SSL_REQUIRED" >/dev/null

# The DIGIT theme is selected per client below (CCRS #2108) so that a client
# that is not part of the Configurator journey keeps its own theme. Earlier
# revisions pinned it on the shared realm, where every client inherits it, so
# undo exactly that: a realm-level theme an operator chose is left alone.
#
# kcadm drops an empty `-s` value, so clearing has to go through the JSON body.
realm_theme=$(kc get "realms/$REALM" | jq -r '.loginTheme // ""')
for owned_theme in $OWNED_REALM_THEMES; do
  if [ "$realm_theme" = "$owned_theme" ]; then
    kc get "realms/$REALM" | jq '.loginTheme = ""' |
      docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh \
        update "realms/$REALM" -f - --config "$KC_CONFIG" >/dev/null
    break
  fi
done
configure_smtp

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
  -s "baseUrl=$POST_LOGIN_REDIRECT" \
  -s "redirectUris=[\"$IDENTITY_REDIRECT_URI\",\"$PASSWORD_SETUP_REDIRECT\"]" \
  -s "webOrigins=$ALLOWED_ORIGINS_JSON" \
  -s 'attributes."pkce.code.challenge.method"=S256' \
  -s 'attributes."post.logout.redirect.uris"=+' \
  -s "attributes.\"login_theme\"=$LOGIN_THEME" \
  -s "attributes.\"digit.auth.signin.methods\"=$BFF_SIGNIN_METHODS" \
  -s "attributes.\"digit.auth.signup.methods\"=$BFF_SIGNUP_METHODS" \
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

configure_user_profile

# digit-ui employee and citizen sign-in (CCRS #2167). Skipped, not failed,
# while an older installer has not generated their secrets yet.
digit_ui_clients=skipped
if [ -n "${KEYCLOAK_EMPLOYEE_CLIENT_SECRET:-}" ] && [ -n "${KEYCLOAK_CITIZEN_CLIENT_SECRET:-}" ]; then
  configure_employee_flow
  configure_digit_ui_client "$EMPLOYEE_CLIENT" "$KEYCLOAK_EMPLOYEE_CLIENT_SECRET" \
    employee "$EMPLOYEE_LOGIN_THEME" "$EMPLOYEE_SIGNIN_METHODS" "$EMPLOYEE_FLOW"
  kc update "clients/$DIGIT_UI_CLIENT_UUID/optional-client-scopes/$organization_scope" -r "$REALM" -n >/dev/null
  configure_digit_ui_client "$CITIZEN_CLIENT" "$KEYCLOAK_CITIZEN_CLIENT_SECRET" \
    citizen '' "$CITIZEN_SIGNIN_METHODS" ''
  digit_ui_clients="$EMPLOYEE_CLIENT,$CITIZEN_CLIENT"
else
  printf 'KEYCLOAK_EMPLOYEE_CLIENT_SECRET / KEYCLOAK_CITIZEN_CLIENT_SECRET unset: digit-ui clients not configured\n' >&2
fi

if [ "${KEYCLOAK_MAGIC_LINK_ENABLED:-false}" = true ]; then
  configure_magic_link
else
  magic_uuid=$(client_uuid "$MAGIC_LINK_CLIENT")
  if [ -n "$magic_uuid" ]; then
    kc update "clients/$magic_uuid" -r "$REALM" -s enabled=false >/dev/null
  fi
fi

configure_first_broker_login
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

printf 'realm=%s organizations=enabled bff_client=%s magic_link=%s admin_client=%s digit_ui_clients=%s temporary_admin_removed=%s\n' \
  "$REALM" "$BFF_CLIENT" "${KEYCLOAK_MAGIC_LINK_ENABLED:-false}" "$ADMIN_CLIENT" "$digit_ui_clients" "$temporary_admin"
