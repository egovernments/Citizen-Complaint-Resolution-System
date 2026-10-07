#!/bin/sh
# Sweep loop for OpenSRE on a CCRS compose box (docker-compose.opensre.yml).
#
# Diagnose-only and log-only. Every OPENSRE_SWEEP_INTERVAL_MINUTES it asks Gatus
# what is failing:
#   - nothing failing           -> one "all_clear" line, no model call
#   - same failures as an investigation within OPENSRE_DEDUPE_HOURS
#                               -> one "unchanged" line, no model call
#   - otherwise                 -> one `opensre ask` investigation
# Results go to $LOG_DIR/sweeps.jsonl (one JSON object per line), a readable
# $LOG_DIR/investigations.log, and stdout, which promtail ships to Loki. Nothing
# is sent anywhere else: no Slack, no alert channel.
#
# Read-only by construction: `opensre ask` runs read-only tools automatically
# and denies anything that mutates state or does not declare its side effects.
# This script never passes --allowed-tool or --dangerously-bypass-approvals.
set -u

LOG_DIR=${OPENSRE_LOG_DIR:-/var/log/opensre}
INTERVAL_MIN=${OPENSRE_SWEEP_INTERVAL_MINUTES:-15}
DEDUPE_HOURS=${OPENSRE_DEDUPE_HOURS:-6}
GATUS_URL=${OPENSRE_GATUS_URL:-http://gatus:8080}
TIMEOUT_S=${OPENSRE_INVESTIGATION_TIMEOUT_SECONDS:-900}
RUNBOOK=/opt/ccrs/known-issues.md
STATE_FILE="$LOG_DIR/.last-investigation"

# OpenSRE reads ~/.opensre/guardrails.yml before every LLM call. It masks
# session tokens and citizen contact details before anything leaves the box.
mkdir -p "$HOME/.opensre"
cp /opt/ccrs/guardrails.yml "$HOME/.opensre/guardrails.yml"

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# On Kubernetes (the deploy-as-code tier) the pod gets a projected service
# account token that is rotated roughly hourly, and OpenSRE's kubernetes
# integration wants a kubeconfig rather than the in-cluster convention. Write
# one from the current token before every sweep, so a rotated token is picked
# up. Absent on the compose tier, where this is a no-op.
SA_DIR=/var/run/secrets/kubernetes.io/serviceaccount
write_incluster_kubeconfig() {
  [ -r "$SA_DIR/token" ] || return 0
  mkdir -p "$HOME/.kube"
  cat > "$HOME/.kube/config" <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: in-cluster
    cluster:
      server: https://${KUBERNETES_SERVICE_HOST:-kubernetes.default.svc}:${KUBERNETES_SERVICE_PORT:-443}
      certificate-authority: $SA_DIR/ca.crt
users:
  - name: in-cluster
    user:
      token: $(cat "$SA_DIR/token")
contexts:
  - name: in-cluster
    context:
      cluster: in-cluster
      user: in-cluster
      namespace: ${KUBECONFIG_NAMESPACE:-default}
current-context: in-cluster
EOF
  chmod 600 "$HOME/.kube/config"
  export KUBECONFIG="$HOME/.kube/config"
}

# One JSON object per line, to the log file and to stdout.
emit() { printf '%s\n' "$1" | tee -a "$LOG_DIR/sweeps.jsonl"; }

note() { # note <kind> <message>
  emit "$(jq -cn --arg ts "$(now)" --arg kind "$1" --arg msg "$2" '{ts: $ts, kind: $kind, message: $msg}')"
}

# Gatus endpoints failing now AND on at least 2 of their last 3 checks, so one
# dropped probe or a rolling restart does not start an investigation.
#
# curl runs on its own, not piped into jq: this is /bin/sh (no pipefail), so a
# pipeline's status is jq's, and jq exits 0 on empty input. Piped, an
# unreachable Gatus looked like a sweep with no checks at all, and every sweep
# then started a model call with an empty list of failing checks. The empty
# check is explicit too: Debian's jq 1.6 exits 0 on empty input even with -e.
failing_checks() {
  statuses=$(curl -fsS --max-time 20 "$GATUS_URL/api/v1/endpoints/statuses") || return 1
  [ -n "$statuses" ] || return 1
  printf '%s' "$statuses" | jq -ce '
    if type != "array" then error("not a Gatus status list") else . end |
    [ .[]
      | (.results // []) as $r
      | select(($r | length) > 0
               and ($r[-1].success | not)
               and ([$r[-3:][] | select(.success | not)] | length) >= 2)
      | { key, group, name,
          detail: ((($r[-1].errors // [])
                    + [$r[-1].conditionResults[]? | select(.success | not) | .condition])
                   | join("; ")) } ]'
}

sweep() {
  write_incluster_kubeconfig
  if ! failing=$(failing_checks) || [ -z "$failing" ]; then
    note error "Gatus is unreachable at $GATUS_URL or returned no status list; skipping this sweep"
    return
  fi
  if [ "$(printf '%s' "$failing" | jq length)" -eq 0 ]; then
    note all_clear "All Gatus checks passing; no investigation"
    return
  fi

  fingerprint=$(printf '%s' "$failing" | jq -r '[.[].key] | sort | join(",")')
  now_s=$(date +%s)
  if [ -f "$STATE_FILE" ]; then
    read -r last_fp last_s < "$STATE_FILE" || true
    if [ "${last_fp:-}" = "$fingerprint" ] && [ $((now_s - ${last_s:-0})) -lt $((DEDUPE_HOURS * 3600)) ]; then
      note unchanged "Same failing checks as the investigation at $(date -u -d "@$last_s" +%Y-%m-%dT%H:%M:%SZ); not re-investigating ($fingerprint)"
      return
    fi
  fi

  checks=$(printf '%s' "$failing" | jq -r '.[] | "- \(.group) / \(.name) [\(.key)]: \(.detail)"')
  prompt="Infrastructure sweep of this DIGIT CCRS deployment (a single Docker Compose VM) at $(now). Gatus reports these health checks failing:
$checks

You are diagnosing only; a human acts on what you find. Scope is infrastructure only: the host, containers, the observability stack, the API gateway, databases, the Redpanda broker and consumer lag. Do not investigate application data such as complaints, notifications or users.

For each failing check give: the root cause with evidence from your tools (Grafana/Prometheus metrics, Loki logs, Tempo traces, Kafka consumer-group lag), whether the checks share a cause, what citizens experience, and the exact commands a human should run with the risk of each. Say 'unknown' rather than guess. The attached known-issues page is this deployment's runbook."

  set -- --json ask --ephemeral
  if [ -f "$RUNBOOK" ]; then set -- "$@" -i "$RUNBOOK"; fi

  note investigating "Investigating: $fingerprint"
  started=$(date +%s)
  out=$(timeout "$TIMEOUT_S" opensre "$@" "$prompt" 2>"$LOG_DIR/.last-stderr")
  rc=$?
  result=$(printf '%s' "$out" | jq -Rsc 'fromjson? // {raw: .}')
  stderr_tail=$(tail -c 2000 "$LOG_DIR/.last-stderr" 2>/dev/null || true)
  emit "$(jq -cn --arg ts "$(now)" --arg trigger "$fingerprint" --argjson rc "$rc" \
            --argjson secs "$(( $(date +%s) - started ))" --argjson checks "$failing" \
            --argjson result "$result" --arg stderr "$stderr_tail" \
            '{ts: $ts, kind: "investigation", trigger: $trigger, exit_code: $rc, seconds: $secs,
              failing_checks: $checks, result: $result}
             + (if $rc == 0 then {} else {stderr_tail: $stderr} end)')"
  {
    printf '════ %s · %s · exit %s ════\n' "$(now)" "$fingerprint" "$rc"
    # First non-empty of these: on failure OpenSRE returns `"response": ""`,
    # which `//` alone would print instead of falling through to the error.
    printf '%s' "$result" | jq -r '[.response, .error.message, .raw]
      | map(select(. != null and . != "")) | first // "(no response)"'
    printf '\n\n'
  } >> "$LOG_DIR/investigations.log"

  # Only a completed investigation suppresses repeats; a failed one is retried
  # on the next sweep.
  if [ "$rc" -eq 0 ]; then
    printf '%s %s\n' "$fingerprint" "$now_s" > "$STATE_FILE"
  fi
}

note started "OpenSRE sweep loop: every ${INTERVAL_MIN} min, dedupe ${DEDUPE_HOURS} h, gatus ${GATUS_URL}, model ${ANTHROPIC_REASONING_MODEL:-provider default}"
while :; do
  if [ "${OPENSRE_ENABLED:-true}" != "true" ]; then
    note paused "OPENSRE_ENABLED=${OPENSRE_ENABLED:-} in .env; not sweeping. The lasting switch is enable_opensre in host_vars."
  elif [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    note idle "No Anthropic API key. Store one with: bao kv put <secrets_path> opensre_anthropic_api_key=<key>, then redeploy."
  else
    sweep
  fi
  sleep $((INTERVAL_MIN * 60))
done
