#!/usr/bin/env bash
# The k8s counterpart of the novu-bootstrap tasks in local-setup/ansible/playbook-deploy.yml:
# makes sure the Novu admin, its API key and the channel workflows exist, and hands the key to
# novu-bridge in a Secret. Safe on every upgrade. Talks only to the sidecar on localhost, the
# one novu-api with registration open.
set -euo pipefail

export NOVU_API_URL="http://127.0.0.1:${NOVU_API_PORT}"

secret_field() { # <namespace> <secret> <field>; empty when the Secret does not exist
  kubectl -n "$1" get secret "$2" -o "jsonpath={.data.$3}" --ignore-not-found | base64 -d
}

key_works() {
  [[ -n "$1" ]] && printf 'Authorization: ApiKey %s\n' "$1" \
    | curl -s -o /dev/null -w '%{http_code}' -H @- "$NOVU_API_URL/v1/environments" | grep -q '^200$'
}

key="$(secret_field "$BRIDGE_NAMESPACE" "$API_KEY_SECRET" api-key)"
if key_works "$key"; then
  echo "novu-bootstrap: the existing API key still works"
else
  password="$(secret_field "$POD_NAMESPACE" "$ADMIN_SECRET" password)"
  if [[ -z "$password" ]]; then
    # Stored before the account exists, so a crash below cannot lose the only copy.
    # The fixed suffix satisfies Novu's password policy (upper, lower, number, special).
    password="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32) + "aA1!")')"
    kubectl -n "$POD_NAMESPACE" create secret generic "$ADMIN_SECRET" \
      --from-literal=email="$NOVU_ADMIN_EMAIL" --from-literal=password="$password" >/dev/null
    echo "novu-bootstrap: generated the admin password (Secret $ADMIN_SECRET)"
  fi

  # The mint logs a key prefix; keep that out of the pod log.
  key="$(NOVU_ADMIN_PASSWORD="$password" bash /scripts/novu-mint-key.sh 2> >(grep -v 'key:' >&2))" || {
    echo "novu-bootstrap: FAILED to get an API key. If this Novu has an admin with another password," >&2
    echo "put it in Secret $ADMIN_SECRET, or pin novu-bridge.novu-api-key in the environment." >&2
    exit 1
  }

  kubectl -n "$BRIDGE_NAMESPACE" create secret generic "$API_KEY_SECRET" \
    --from-literal=api-key="$key" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "novu-bootstrap: stored the API key in $BRIDGE_NAMESPACE/$API_KEY_SECRET"
fi

# Not fatal, as in Ansible: a transient Novu error must not fail the release, and the next
# upgrade retries. A bridge with no workflows reports NB_NOVU_TRIGGER_FAILED on each send.
NOVU_BASE_URL="$NOVU_API_URL" NOVU_API_KEY="$key" NOVU_ENV_NAME="$NOVU_ENV_NAME" \
  bash /scripts/bootstrap-novu-whatsapp.sh | grep -E '^(==>|    (Created|Found|Workflow))' \
  || echo "novu-bootstrap: WARNING the workflow bootstrap failed; it retries on the next upgrade" >&2

echo "novu-bootstrap: done"
