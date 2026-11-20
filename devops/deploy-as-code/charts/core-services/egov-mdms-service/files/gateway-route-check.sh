#!/usr/bin/env bash
# Makes sure the DIGIT gateway routes /egov-mdms-service. The gateway learns routes from the
# Services' zuul/route-path annotations only when it starts (its gateway-kubernetes-discovery
# init container), so a gateway that started before this Service had the annotation, on an
# existing cluster or in a parallel fresh install, answers the route with its own 404. Then, and
# only then, roll it. Never fails the hook: a failed hook would fail the release.
set -uo pipefail
warn() { echo "gateway-route-check: WARNING $*" >&2; }

if ! kubectl -n "$NAMESPACE" get deployment "$GATEWAY" -o name >/dev/null 2>&1; then
  echo "gateway-route-check: no $GATEWAY deployment yet; it will read the route when it starts"
  exit 0
fi
kubectl -n "$NAMESPACE" rollout status deployment "$GATEWAY" --timeout="${WAIT_SECONDS}s" >/dev/null \
  || { warn "$GATEWAY is not ready; restart it if $ROUTE returns 404"; exit 0; }

# The open MDMS read the citizen home makes. A routed request gets mdms-v2's answer, whatever its
# status; an unrouted one gets Spring's JSON 404 naming the path.
body="$(curl -s -m 15 -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"RequestInfo":{},"MdmsCriteria":{"tenantId":"'"$TENANT"'","moduleDetails":[{"moduleName":"common-masters","masterDetails":[{"name":"StateInfo"}]}]}}' \
  "http://$GATEWAY.$NAMESPACE:$GATEWAY_PORT$ROUTE")"
code="$(tail -n1 <<<"$body")"
if [[ "$code" == 404 ]] && grep -q '"error":"Not Found"' <<<"$body"; then
  kubectl -n "$NAMESPACE" rollout restart deployment "$GATEWAY" >/dev/null \
    && echo "gateway-route-check: $GATEWAY had no $ROUTE route; restarted it" \
    || warn "could not restart $GATEWAY; restart it by hand"
else
  echo "gateway-route-check: $GATEWAY routes $ROUTE (HTTP $code)"
fi
exit 0
