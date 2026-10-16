# shellcheck shell=bash
# core-sms-handoff.sh — sourced (bash), never executed. Decides when the retired OTP senders
# (egov-notification-sms, otp-publisher) may be removed: only once novu-bridge has TAKEN OVER
# the login-OTP topic, so no OTP is published while nothing will ever consume it.
#
# Used by local-setup/ansible/playbook-deploy.yml (staged as <digit_dir>/core-sms-handoff.sh)
# and by local-setup/scripts/enable-notifications.sh. Keep the two callers on this one copy.
#
# Why "running" or "healthy" is not enough (Vinoth re-review of #2097, 4141822022):
# CoreSmsConsumer subscribes with auto.offset.reset=latest. On a box whose OTPs went through
# egov-notification-sms (2.12), the novu-bridge group has never committed an offset on
# egov.core.notification.sms, so the new consumer starts at the END of the topic at the moment
# it is first assigned a partition — 1-2 minutes of JVM boot after `up -d`. Every OTP published
# before that would be skipped by the bridge, and lost if the old sender was already gone.
#
# Handoff needs novu-bridge HEALTHY and, for every partition of the topic, either:
#   committed  the novu-bridge group has a committed offset there: the bridge resumes from it
#              whenever its listener starts, so nothing published meanwhile is skipped;
#   assigned   a live member of the group owns it: the listener is up and positioned, and
#              everything published from now on reaches it.
# Partitions are counted from the topic itself, so a group that covers only some of them is
# not taken for a handoff. While the group has live members, rpk lists only the topics they
# subscribe to, so members that do not consume this topic (an old bridge, or the new one before
# its core-SMS listener joins) hide it: that reads as WAITING, the safe side.
# A box where the bridge's core-SMS listener is switched off
# (NOVU_BRIDGE_CORE_SMS_ENABLED other than true) never hands off: the old senders must stay.
#
# Overridable (defaults are the compose names):
#   DOCKER              how to run docker ("docker"; enable-notifications.sh: "sudo docker")
#   BRIDGE_CONTAINER    novu-bridge          REDPANDA_CONTAINER  digit-redpanda
#   BRIDGE_SERVICE      novu-bridge          (the compose service, for core_sms_bridge_current)
#   CORE_SMS_GROUP      novu-bridge          (spring.kafka.consumer.group-id)
#   CORE_SMS_TOPIC      the bridge container's NOVU_BRIDGE_CORE_SMS_TOPIC, else egov.core.notification.sms
#   CSH_COMPOSE         the compose command with its files, evaluated, so it may carry an env
#                       prefix ("COMPOSE_PROFILES=x docker compose -f a.yaml"); default "docker compose"
#   CSH_COMPOSE_DIR     where to run it (the files are relative to it); default the current directory
#   CSH_UNKNOWN_TRIES   consecutive UNKNOWN answers after which core_sms_wait_handoff gives up (6)

_csh_docker() { ${DOCKER:-docker} "$@"; }

_csh_compose() {
  (
    if [ -n "${CSH_COMPOSE_DIR:-}" ]; then cd "$CSH_COMPOSE_DIR" || exit 1; fi
    eval "${CSH_COMPOSE:-docker compose} \"\$@\""
  )
}

# core_sms_bridge_current — is the novu-bridge container the one compose configures NOW? Both
# callers ask this right after `up -d novu-bridge` on an upgrade, where "a novu-bridge container
# is running" proves nothing: the OLD one is still running if the recreate did not happen
# (Vinoth re-review 4141822018). One copy for the playbook and enable-notifications.sh
# (4154544380). Compares the running container's image id and compose config-hash label with
# the image compose resolves for the service and its config hash now. Sets CSH_BRIDGE to:
#   RUNNING      the current image and config, and running
#   NOT-RUNNING  the current image and config, not running (e.g. a crash loop)
#   NOT-CURRENT  anything else: an old container left in place, none at all, or compose could
#                not say which image / hash it wants (never taken for the current one)
# and CSH_BRIDGE_WHY to the comparison, for the operator. Returns 0 for RUNNING and NOT-RUNNING.
core_sms_bridge_current() {
  local svc want_image want_id="" want_hash have
  svc="${BRIDGE_SERVICE:-novu-bridge}"
  # `config --images <svc>` also lists the images of its dependencies: read the one image.
  want_image="$(_csh_compose config --format json "$svc" 2>/dev/null \
    | python3 -c 'import json, sys; print(json.load(sys.stdin)["services"][sys.argv[1]]["image"])' "$svc" 2>/dev/null || true)"
  if [ -n "$want_image" ]; then
    want_id="$(_csh_docker image inspect -f '{{.Id}}' "$want_image" 2>/dev/null || true)"
  fi
  want_hash="$(_csh_compose config --hash "$svc" 2>/dev/null | awk -v s="$svc" '$1 == s {print $2}')"
  have="$(_csh_docker inspect -f '{{.Image}}|{{index .Config.Labels "com.docker.compose.config-hash"}}|{{.State.Running}}' \
    "${BRIDGE_CONTAINER:-novu-bridge}" 2>/dev/null || true)"
  CSH_BRIDGE_WHY="want image ${want_image:-?} (${want_id:-not present}) config ${want_hash:-?}; have ${have:-no container}"
  if [ -z "$want_id" ] || [ -z "$want_hash" ] || [ "${have%|*}" != "$want_id|$want_hash" ]; then
    CSH_BRIDGE=NOT-CURRENT
    return 1
  fi
  if [ "${have##*|}" = "true" ]; then CSH_BRIDGE=RUNNING; else CSH_BRIDGE=NOT-RUNNING; fi
  return 0
}

# _csh_bridge_env VAR — VAR's value in the running bridge container's env ("" when unset).
_csh_bridge_env() {
  _csh_docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
    "${BRIDGE_CONTAINER:-novu-bridge}" 2>/dev/null | sed -n "s/^$1=//p" | tail -n1
}

_csh_topic() {
  local t="${CORE_SMS_TOPIC:-}"
  [ -n "$t" ] || t="$(_csh_bridge_env NOVU_BRIDGE_CORE_SMS_TOPIC)"
  printf '%s\n' "${t:-egov.core.notification.sms}"
}

# core_sms_listener_enabled — 0 unless the bridge container switches the core-SMS listener off
# (@ConditionalOnProperty havingValue=true, matchIfMissing=true: unset = on).
core_sms_listener_enabled() {
  local v
  v="$(_csh_bridge_env NOVU_BRIDGE_CORE_SMS_ENABLED)"
  [ -z "$v" ] || [ "$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')" = "true" ]
}

# core_sms_bridge_health — the bridge container's health (or plain state), "absent" if none.
core_sms_bridge_health() {
  _csh_docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "${BRIDGE_CONTAINER:-novu-bridge}" 2>/dev/null || echo absent
}

# core_sms_offsets — "<partitions> <committed> <assigned>" for the topic and the bridge's group.
# Returns 1 (prints nothing) when Redpanda cannot be asked. A topic that does not exist yet
# prints "0 0 0".
core_sms_offsets() {
  local topic group parts desc
  topic="$(_csh_topic)"
  group="${CORE_SMS_GROUP:-novu-bridge}"
  parts="$(_csh_docker exec "${REDPANDA_CONTAINER:-digit-redpanda}" rpk topic describe "$topic" -p 2>/dev/null)" || return 1
  parts="$(printf '%s\n' "$parts" | awk '$1 ~ /^[0-9]+$/ {n++} END {print n + 0}')"
  desc="$(_csh_docker exec "${REDPANDA_CONTAINER:-digit-redpanda}" rpk group describe "$group" 2>/dev/null)" || return 1
  # Columns are located from the header (rpk versions differ: LOG-START-OFFSET, INSTANCE-ID).
  # An unassigned partition leaves MEMBER-ID and the columns after it EMPTY, so its row simply
  # has fewer fields; every column before MEMBER-ID is always filled ("-" when unknown).
  printf '%s\n' "$desc" | awk -v t="$topic" -v parts="$parts" '
    $1 == "TOPIC" && $2 == "PARTITION" {
      for (i = 1; i <= NF; i++) { if ($i == "CURRENT-OFFSET") co = i; if ($i == "MEMBER-ID") mi = i }
      hdr = 1; next
    }
    hdr && co && mi && $1 == t && $2 ~ /^[0-9]+$/ {
      if ($co ~ /^[0-9]+$/) c[$2] = 1
      if (NF >= mi && $mi != "" && $mi != "-") a[$2] = 1
    }
    END {
      nc = 0; na = 0
      for (p = 0; p < parts; p++) { if (p in c) nc++; if ((p in a) || (p in c)) na++ }
      printf "%d %d %d\n", parts, nc, na
    }'
}

# core_sms_handoff_state — sets CSH_STATE to one word and CSH_WHY to a sentence for the operator:
#   COMMITTED  bridge healthy, and every partition has a committed offset (it resumes from them)
#   ASSIGNED   bridge healthy, and every partition is committed or owned by a live group member
#   WAITING    not yet: the bridge is not healthy, or partitions are neither committed nor assigned
#   DISABLED   the bridge's core-SMS listener is off — it will never take over
#   NOTOPIC    the topic does not exist yet (created here when CSH_CREATE_TOPIC=1)
#   UNKNOWN    Redpanda could not be asked
# Only COMMITTED and ASSIGNED are a handoff. Health is required for both: a bridge that never
# comes up keeps the old senders running, so OTPs keep going out (possibly twice) instead of
# waiting in Kafka for someone to fix it.
core_sms_handoff_state() {
  local topic health counts parts committed covered
  topic="$(_csh_topic)"
  if ! core_sms_listener_enabled; then
    CSH_STATE=DISABLED
    CSH_WHY="novu-bridge runs with NOVU_BRIDGE_CORE_SMS_ENABLED=$(_csh_bridge_env NOVU_BRIDGE_CORE_SMS_ENABLED), so it does not consume $topic"
    return 0
  fi
  if ! counts="$(core_sms_offsets)" || [ -z "$counts" ]; then
    CSH_STATE=UNKNOWN
    CSH_WHY="the consumer group could not be read from ${REDPANDA_CONTAINER:-digit-redpanda} (rpk group describe ${CORE_SMS_GROUP:-novu-bridge})"
    return 0
  fi
  read -r parts committed covered <<< "$counts"
  if [ "${parts:-0}" -eq 0 ]; then
    if [ "${CSH_CREATE_TOPIC:-0}" = 1 ]; then
      # Same partitions and replication as the deploy's own "ensure ... topics exist" task: the
      # bridge's listener (missing-topics-fatal=false) is assigned once its metadata sees it.
      _csh_docker exec "${REDPANDA_CONTAINER:-digit-redpanda}" rpk topic create "$topic" -p 1 -r 1 >/dev/null 2>&1 || true
    fi
    CSH_STATE=NOTOPIC
    CSH_WHY="$topic does not exist yet, so novu-bridge has not been assigned it"
    return 0
  fi
  health="$(core_sms_bridge_health)"
  if [ "$health" != healthy ]; then
    CSH_STATE=WAITING
    CSH_WHY="novu-bridge is $health (its group owns or has committed $covered of $parts partition(s) of $topic)"
  elif [ "$committed" -eq "$parts" ]; then
    CSH_STATE=COMMITTED
    CSH_WHY="novu-bridge is healthy and the ${CORE_SMS_GROUP:-novu-bridge} group has committed offsets on all $parts partition(s) of $topic"
  elif [ "$covered" -eq "$parts" ]; then
    CSH_STATE=ASSIGNED
    CSH_WHY="novu-bridge is healthy and its group owns (or has committed) all $parts partition(s) of $topic"
  else
    CSH_STATE=WAITING
    CSH_WHY="novu-bridge is healthy but its group owns or has committed only $covered of $parts partition(s) of $topic"
  fi
  return 0
}

# core_sms_wait_handoff TRIES INTERVAL — poll until COMMITTED or ASSIGNED (0), or give up (1).
# DISABLED gives up at once; so do CSH_UNKNOWN_TRIES (6) UNKNOWN answers in a row (Vinoth
# re-review 4154544393): Redpanda that cannot be asked for a minute is not coming back within
# the 5/10-minute budget, and sleeping it out only delays the deploy — giving up keeps the old
# senders, the same outcome as running out of tries. A different answer in between starts the
# count again (a broker restart). CSH_STATE / CSH_WHY hold the last answer.
core_sms_wait_handoff() {
  local tries="$1" interval="$2" unknown_max="${CSH_UNKNOWN_TRIES:-6}" unknown=0 i
  CSH_STATE=""; CSH_WHY=""
  for i in $(seq 1 "$tries"); do
    CSH_CREATE_TOPIC=1 core_sms_handoff_state
    case "$CSH_STATE" in
      COMMITTED|ASSIGNED) return 0 ;;
      DISABLED) return 1 ;;
      UNKNOWN)
        unknown=$((unknown + 1))
        if [ "$unknown" -ge "$unknown_max" ]; then
          CSH_WHY="$CSH_WHY — $unknown times in a row, so gave up waiting"
          return 1
        fi ;;
      *) unknown=0 ;;
    esac
    if [ "$i" -lt "$tries" ]; then sleep "$interval"; fi
  done
  return 1
}
