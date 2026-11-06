#!/usr/bin/env bash
# The k8s counterpart of the novu-bootstrap tasks in local-setup/ansible/playbook-deploy.yml:
# makes sure the Novu admin, its API key and the channel workflows exist, and hands the key to
# novu-bridge in a Secret. Safe on every upgrade.
#
# Never fails the hook, as in Ansible: a failed hook fails the novu release, and helmfile then
# stops before core, common and urban. Problems are logged as WARNING and retried on the next
# upgrade; until then the bridge reports NB_NOVU_TRIGGER_FAILED on each send.
#
# Only the key mint needs the private novu-api sidecar (the one with registration open). Checking
# the stored key and creating workflows use the public novu-api, so an upgrade whose key still
# works never waits for the sidecar's cold start.
set -uo pipefail

PUBLIC_API="http://${NOVU_API_SERVICE}"
PRIVATE_API="http://127.0.0.1:${NOVU_API_PORT}"

warn() { echo "novu-bootstrap: WARNING $*" >&2; }

secret_field() { # <namespace> <secret> <field>; empty when the Secret does not exist
  kubectl -n "$1" get secret "$2" -o "jsonpath={.data.$3}" --ignore-not-found | base64 -d
}

key_works() { # <api> <key>
  [[ -n "$2" ]] && printf 'Authorization: ApiKey %s\n' "$2" \
    | curl -s -m 10 -o /dev/null -w '%{http_code}' -H @- "$1/v1/environments" | grep -q '^200$'
}

wait_for() { # <api> <seconds>
  local deadline=$((SECONDS + $2))
  until curl -sf -m 5 -o /dev/null "$1/v1/health-check"; do
    ((SECONDS < deadline)) || return 1
    sleep 5
  done
}

# A new key only reaches the bridge when its pod starts (env from a Secret), so roll it. A bridge
# that does not exist yet reads the Secret when it is installed.
roll_bridge() {
  if kubectl -n "$BRIDGE_NAMESPACE" get deployment "$BRIDGE_DEPLOYMENT" -o name >/dev/null 2>&1; then
    kubectl -n "$BRIDGE_NAMESPACE" rollout restart deployment "$BRIDGE_DEPLOYMENT" >/dev/null \
      && echo "novu-bootstrap: restarted $BRIDGE_NAMESPACE/$BRIDGE_DEPLOYMENT for the new key" \
      || warn "could not restart $BRIDGE_NAMESPACE/$BRIDGE_DEPLOYMENT; restart it to pick up the new key"
  fi
}

mint_key() {
  local password key
  password="$(secret_field "$POD_NAMESPACE" "$ADMIN_SECRET" password)"
  if [[ -z "$password" ]]; then
    # Stored before the account exists, so a crash below cannot lose the only copy.
    # The fixed suffix satisfies Novu's password policy (upper, lower, number, special).
    password="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32) + "aA1!")')"
    kubectl -n "$POD_NAMESPACE" create secret generic "$ADMIN_SECRET" \
      --from-literal=email="$NOVU_ADMIN_EMAIL" --from-literal=password="$password" >/dev/null \
      || { warn "could not store the admin password in Secret $ADMIN_SECRET"; return 1; }
    echo "novu-bootstrap: generated the admin password (Secret $ADMIN_SECRET)"
  fi

  wait_for "$PRIVATE_API" "$PRIVATE_API_WAIT_SECONDS" \
    || { warn "the private novu-api did not start within ${PRIVATE_API_WAIT_SECONDS}s"; return 1; }

  # The mint logs a key prefix; keep that out of the pod log.
  key="$(NOVU_API_URL="$PRIVATE_API" NOVU_ADMIN_PASSWORD="$password" \
    bash /scripts/novu-mint-key.sh 2> >(grep -v 'key:' >&2))" || {
    warn "could not get an API key. If this Novu has an admin with another password, put it in"
    warn "Secret $POD_NAMESPACE/$ADMIN_SECRET, or pin novu-bridge.novu-api-key in the environment."
    return 1
  }

  kubectl -n "$BRIDGE_NAMESPACE" create secret generic "$API_KEY_SECRET" \
    --from-literal=api-key="$key" --dry-run=client -o yaml | kubectl apply -f - >/dev/null \
    || { warn "could not store the API key in $BRIDGE_NAMESPACE/$API_KEY_SECRET"; return 1; }
  echo "novu-bootstrap: stored the API key in $BRIDGE_NAMESPACE/$API_KEY_SECRET"
  roll_bridge
}

wait_for "$PUBLIC_API" "$PUBLIC_API_WAIT_SECONDS" || warn "novu-api is not answering at $PUBLIC_API"

key="$(secret_field "$BRIDGE_NAMESPACE" "$API_KEY_SECRET" api-key)"
if key_works "$PUBLIC_API" "$key"; then
  echo "novu-bootstrap: the existing API key still works"
elif mint_key; then
  key="$(secret_field "$BRIDGE_NAMESPACE" "$API_KEY_SECRET" api-key)"
else
  key=""
fi

# Per-tenant accounts: the login, encryption key and internal tokens the bridge needs. Generated
# once and then left alone: a new encryption key would strand every stored tenant key.
if [[ -n "${TENANT_ACCOUNTS_SECRET:-}" ]] \
  && [[ -z "$(kubectl -n "$BRIDGE_NAMESPACE" get secret "$TENANT_ACCOUNTS_SECRET" -o name --ignore-not-found)" ]]; then
  password="$(secret_field "$POD_NAMESPACE" "$ADMIN_SECRET" password)"
  if [[ -z "$password" ]]; then
    warn "no admin password in Secret $ADMIN_SECRET yet, so $TENANT_ACCOUNTS_SECRET is not created"
  else
    random_hex() { python3 -c "import secrets; print(secrets.token_hex($1))"; }
    kubectl -n "$BRIDGE_NAMESPACE" create secret generic "$TENANT_ACCOUNTS_SECRET" \
      --from-literal=novu-admin-email="$NOVU_ADMIN_EMAIL" \
      --from-literal=novu-admin-password="$password" \
      --from-literal=encryption-key="$(random_hex 32)" \
      --from-literal=internal-admin-token="$(random_hex 24)" \
      --from-literal=internal-send-token="$(random_hex 24)" >/dev/null \
      && echo "novu-bootstrap: created $BRIDGE_NAMESPACE/$TENANT_ACCOUNTS_SECRET" \
      || warn "could not create $BRIDGE_NAMESPACE/$TENANT_ACCOUNTS_SECRET"
  fi
fi

if [[ -n "$key" ]]; then
  NOVU_BASE_URL="$PUBLIC_API" NOVU_API_KEY="$key" NOVU_ENV_NAME="$NOVU_ENV_NAME" \
    bash /scripts/bootstrap-novu-whatsapp.sh | grep -E '^(==>|    (Created|Found|Workflow))' \
    || warn "the workflow bootstrap failed; it retries on the next upgrade"
else
  warn "no working API key, so no workflows were created; the next upgrade retries"
fi

echo "novu-bootstrap: done"
exit 0
