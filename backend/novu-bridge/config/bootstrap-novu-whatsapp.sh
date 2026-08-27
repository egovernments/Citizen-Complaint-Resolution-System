#!/usr/bin/env bash
set -euo pipefail

# Bootstraps Novu (self-hosted or cloud-compatible) with:
# 1) Environment (project-like scope)
# 2) Twilio SMS integration (usable for WhatsApp by sending phone as whatsapp:+<number>)
# 3) Minimal workflow with a single SMS step
# 4) novu-bridge pass-through channel workflows: complaints-sms (one `sms`
#    step) and complaints-email (one `email` step) — the fixed workflows the
#    bridge triggers with the fully rendered message in payload.body /
#    payload.subject. Without these a fresh install logs
#    FAILED/NB_NOVU_TRIGGER_FAILED for every SMS/EMAIL notification.
#
# Required env vars:
#   NOVU_API_KEY
#   TWILIO_ACCOUNT_SID
#   TWILIO_AUTH_TOKEN
#   TWILIO_WHATSAPP_FROM   (example: whatsapp:+14155238886)
#
# Optional env vars:
#   NOVU_BASE_URL          (default: http://localhost:1336)
#   NOVU_ENV_FILE          (default: <script-dir>/.env.novu)
#   NOVU_ENV_NAME          (default: digit-dev)
#   NOVU_ENV_COLOR         (default: #4F46E5)
#   NOVU_WORKFLOW_ID       (default: complaints-whatsapp — MUST match novu.bridge.workflow.id.whatsapp, i.e. what the bridge triggers)
#   NOVU_INTEGRATION_NAME  (default: twilio-whatsapp)
#   NOVU_INTEGRATION_ID    (default: twilio-whatsapp)
#   NOVU_SMS_BODY          (default: Complaint {{payload.complaintNo}} status is {{payload.status}})
#   NOVU_EVENT_WORKFLOWS   (default: COMPLAINTS.WORKFLOW.APPLY,COMPLAINTS.WORKFLOW.ASSIGN)
#   NOVU_SMS_WORKFLOW_ID   (default: complaints-sms   — must match novu.bridge.workflow.id.sms)
#   NOVU_EMAIL_WORKFLOW_ID (default: complaints-email — must match novu.bridge.workflow.id.email)

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

require_cmd() {
  local name="$1"
  command -v "$name" >/dev/null 2>&1 || {
    echo "Required command not found: $name" >&2
    exit 1
  }
}

require_cmd curl
require_cmd jq

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=load-dotenv.sh
source "${SCRIPT_DIR}/load-dotenv.sh"

NOVU_ENV_FILE="${NOVU_ENV_FILE:-${SCRIPT_DIR}/.env.novu}"
if [[ -f "$NOVU_ENV_FILE" ]]; then
  # EXPLICIT ENV WINS. The tracked .env.novu holds DUMMY values, so it only
  # fills variables the caller did not provide. Parse it as dotenv rather than
  # shell: unquoted message bodies with spaces are valid dotenv and must not be
  # executed as commands (issue #1517).
  load_dotenv_defaults "$NOVU_ENV_FILE"
  echo "Loaded environment from: $NOVU_ENV_FILE (explicit env preserved)"
fi

require_var NOVU_API_KEY
require_var TWILIO_ACCOUNT_SID
require_var TWILIO_AUTH_TOKEN
require_var TWILIO_WHATSAPP_FROM

NOVU_BASE_URL="${NOVU_BASE_URL:-http://localhost:1336}"
NOVU_ENV_NAME="${NOVU_ENV_NAME:-digit-dev}"
NOVU_ENV_COLOR="${NOVU_ENV_COLOR:-#4F46E5}"
NOVU_WORKFLOW_ID="${NOVU_WORKFLOW_ID:-complaints-whatsapp}"
NOVU_INTEGRATION_NAME="${NOVU_INTEGRATION_NAME:-twilio-whatsapp}"
NOVU_INTEGRATION_ID="${NOVU_INTEGRATION_ID:-twilio-whatsapp}"
NOVU_SMS_BODY="${NOVU_SMS_BODY:-Complaint {{payload.complaintNo}} status is {{payload.status}}}"
NOVU_EVENT_WORKFLOWS="${NOVU_EVENT_WORKFLOWS:-COMPLAINTS.WORKFLOW.APPLY,COMPLAINTS.WORKFLOW.ASSIGN}"
NOVU_SMS_WORKFLOW_ID="${NOVU_SMS_WORKFLOW_ID:-complaints-sms}"
NOVU_EMAIL_WORKFLOW_ID="${NOVU_EMAIL_WORKFLOW_ID:-complaints-email}"

AUTH_HEADER="Authorization: ApiKey ${NOVU_API_KEY}"
JSON_HEADER="Content-Type: application/json"

probe_base_url() {
  local candidate="$1"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "$AUTH_HEADER" \
    "${candidate}/v1/environments" || true)"
  # 2xx/4xx means endpoint is reachable (auth may still fail); 000 means connect failure.
  [[ "$code" != "000" ]]
}

if ! probe_base_url "$NOVU_BASE_URL"; then
  for fallback in "http://localhost:1336" "http://localhost:3000"; do
    if [[ "$fallback" != "$NOVU_BASE_URL" ]] && probe_base_url "$fallback"; then
      echo "Novu not reachable at $NOVU_BASE_URL, switching to $fallback"
      NOVU_BASE_URL="$fallback"
      break
    fi
  done
fi

if ! probe_base_url "$NOVU_BASE_URL"; then
  echo "Unable to reach Novu API." >&2
  echo "Tried: $NOVU_BASE_URL, http://localhost:1336, http://localhost:3000" >&2
  echo "Ensure Novu API container is up and port-mapped, then retry." >&2
  exit 1
fi

api_get() {
  local path="$1"
  curl -sS --fail-with-body \
    -H "$AUTH_HEADER" \
    "${NOVU_BASE_URL}${path}"
}

api_post() {
  local path="$1"
  local payload="$2"
  curl -sS --fail-with-body \
    -X POST \
    -H "$AUTH_HEADER" \
    -H "$JSON_HEADER" \
    -d "$payload" \
    "${NOVU_BASE_URL}${path}"
}

api_put() {
  local path="$1"
  local payload="$2"
  curl -sS --fail-with-body \
    -X PUT \
    -H "$AUTH_HEADER" \
    -H "$JSON_HEADER" \
    -d "$payload" \
    "${NOVU_BASE_URL}${path}"
}

api_get_no_fail() {
  local path="$1"
  curl -sS \
    -H "$AUTH_HEADER" \
    "${NOVU_BASE_URL}${path}" || true
}

extract_id() {
  local json="$1"
  echo "$json" | jq -r '
    ._id // .id //
    .data._id // .data.id //
    .data.data._id // .data.data.id //
    empty
  ' 2>/dev/null || true
}

slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -cs 'a-z0-9' '-' \
    | sed -E 's/^-+//; s/-+$//; s/-{2,}/-/g'
}

echo "==> Checking/creating Novu environment: ${NOVU_ENV_NAME}"
ENV_ID=""
ENV_JSON="$(api_get_no_fail "/v1/environments")"
ENV_API_ERROR="$(echo "$ENV_JSON" | jq -r '.error // .message // empty' 2>/dev/null || true)"
if [[ -n "$ENV_API_ERROR" ]] && echo "$ENV_API_ERROR" | grep -qiE '402|payment|required|not allowed|forbidden'; then
  echo "    Environments API unavailable for this Novu setup; proceeding without explicit environment id."
else
  ENV_ID="$(echo "$ENV_JSON" | jq -r --arg name "$NOVU_ENV_NAME" '
    (.. | arrays | .[]? | select(type=="object")) as $e
    | select(($e.name // "") == $name)
    | ($e._id // $e.id // empty)
  ' | head -n1)"

  if [[ -z "${ENV_ID}" ]]; then
    CREATE_ENV_PAYLOAD="$(jq -cn \
      --arg name "$NOVU_ENV_NAME" \
      --arg color "$NOVU_ENV_COLOR" \
      '{name:$name,color:$color}')"
    CREATED_ENV="$(api_post "/v1/environments" "$CREATE_ENV_PAYLOAD" || true)"
    ENV_ID="$(extract_id "$CREATED_ENV")"
    if [[ -n "${ENV_ID}" ]]; then
      echo "    Created environment id: $ENV_ID"
    else
      echo "    Could not create/read environment id; continuing without explicit environment id."
      ENV_ID=""
    fi
  else
    echo "    Found environment id: $ENV_ID"
  fi
fi

echo "==> Checking/creating Twilio integration: ${NOVU_INTEGRATION_ID}"
INTEGRATIONS_JSON="$(api_get "/v1/integrations")"
if [[ -n "$ENV_ID" ]]; then
  INTEGRATION_JSON="$(echo "$INTEGRATIONS_JSON" | jq -c --arg ident "$NOVU_INTEGRATION_ID" --arg env "$ENV_ID" '
    (.. | arrays | .[]? | select(type=="object")) as $i
    | select(($i.identifier // "") == $ident and (($i._environmentId // $i.environmentId // "") == $env))
    | $i
  ' | head -n1)"
else
  INTEGRATION_JSON="$(echo "$INTEGRATIONS_JSON" | jq -c --arg ident "$NOVU_INTEGRATION_ID" '
    (.. | arrays | .[]? | select(type=="object")) as $i
    | select(($i.identifier // "") == $ident)
    | $i
  ' | head -n1)"
fi
INTEGRATION_ID="$(extract_id "${INTEGRATION_JSON:-}")"

if [[ -z "${INTEGRATION_ID}" ]]; then
  if [[ -n "$ENV_ID" ]]; then
    CREATE_INTEGRATION_PAYLOAD="$(jq -cn \
      --arg name "$NOVU_INTEGRATION_NAME" \
      --arg ident "$NOVU_INTEGRATION_ID" \
      --arg env "$ENV_ID" \
      --arg sid "$TWILIO_ACCOUNT_SID" \
      --arg token "$TWILIO_AUTH_TOKEN" \
      --arg from "$TWILIO_WHATSAPP_FROM" \
      '{
        name:$name,
        identifier:$ident,
        _environmentId:$env,
        providerId:"twilio",
        channel:"sms",
        active:true,
        check:false,
        credentials:{
          accountSid:$sid,
          token:$token,
          from:$from
        }
      }')"
  else
    CREATE_INTEGRATION_PAYLOAD="$(jq -cn \
      --arg name "$NOVU_INTEGRATION_NAME" \
      --arg ident "$NOVU_INTEGRATION_ID" \
      --arg sid "$TWILIO_ACCOUNT_SID" \
      --arg token "$TWILIO_AUTH_TOKEN" \
      --arg from "$TWILIO_WHATSAPP_FROM" \
      '{
        name:$name,
        identifier:$ident,
        providerId:"twilio",
        channel:"sms",
        active:true,
        check:false,
        credentials:{
          accountSid:$sid,
          token:$token,
          from:$from
        }
      }')"
  fi

  CREATED_INTEGRATION="$(api_post "/v1/integrations" "$CREATE_INTEGRATION_PAYLOAD")"
  INTEGRATION_ID="$(extract_id "$CREATED_INTEGRATION")"
  if [[ -z "${INTEGRATION_ID}" ]]; then
    echo "Failed to resolve integration id from create response:" >&2
    echo "$CREATED_INTEGRATION" | jq . >&2
    exit 1
  fi
  echo "    Created integration id: $INTEGRATION_ID"
else
  # ApiKey-authenticated integration reads intentionally omit credentials, so
  # comparing the desired secrets with the stored values is impossible. PUT
  # the complete desired state on every run: this rotates credentials and
  # repairs name/sender/active drift without deleting the integration.
  INTEGRATION_ENV_ID="$(echo "$INTEGRATION_JSON" | jq -r '._environmentId // .environmentId // empty')"
  if [[ -z "$INTEGRATION_ENV_ID" ]]; then
    echo "Existing integration $INTEGRATION_ID has no environment id; refusing an incomplete update." >&2
    exit 1
  fi
  UPDATE_INTEGRATION_PAYLOAD="$(jq -cn \
    --arg name "$NOVU_INTEGRATION_NAME" \
    --arg ident "$NOVU_INTEGRATION_ID" \
    --arg env "$INTEGRATION_ENV_ID" \
    --arg sid "$TWILIO_ACCOUNT_SID" \
    --arg token "$TWILIO_AUTH_TOKEN" \
    --arg from "$TWILIO_WHATSAPP_FROM" \
    '{
      name:$name,
      identifier:$ident,
      _environmentId:$env,
      active:true,
      check:false,
      credentials:{
        accountSid:$sid,
        token:$token,
        from:$from
      }
    }')"
  UPDATED_INTEGRATION="$(api_put "/v1/integrations/${INTEGRATION_ID}" "$UPDATE_INTEGRATION_PAYLOAD")"
  UPDATED_INTEGRATION_ID="$(extract_id "$UPDATED_INTEGRATION")"
  if [[ "$UPDATED_INTEGRATION_ID" != "$INTEGRATION_ID" ]]; then
    echo "Failed to reconcile integration $INTEGRATION_ID: response did not identify the same integration." >&2
    echo "$UPDATED_INTEGRATION" | jq . >&2
    exit 1
  fi
  echo "    Reconciled integration id: $INTEGRATION_ID"
fi

# Idempotent create of a Novu v2 workflow: skip when the workflowId already
# exists in WORKFLOWS_JSON, otherwise POST /v2/workflows with the given steps.
# Novu 2.3 derives workflowId from name even when workflowId is supplied, so
# name intentionally equals the desired id and the response is verified.
# Args: <workflowId> <steps-json-array>
ensure_channel_workflow() {
  local wf_id="$1"
  local steps_json="$2"

  local wf_exists
  wf_exists="$(echo "$WORKFLOWS_JSON" | jq -r --arg wid "$wf_id" '
    [
      (.. | arrays | .[]? | select(type=="object") | select((.workflowId // "") == $wid))
    ] | length
  ')"

  if [[ "$wf_exists" != "0" ]]; then
    echo "    Workflow already exists: $wf_id"
    return 0
  fi

  local payload
  payload="$(jq -cn \
    --arg wfId "$wf_id" \
    --argjson steps "$steps_json" \
    '{
      workflowId:$wfId,
      name:$wfId,
      active:true,
      validatePayload:false,
      isTranslationEnabled:false,
      steps:$steps
    }')"

  local created
  created="$(api_post "/v2/workflows" "$payload")" || {
    echo "Workflow creation failed for ${wf_id}. Payload follows." >&2
    echo "$payload" | jq . >&2
    exit 1
  }
  local created_id
  created_id="$(echo "$created" | jq -r '.workflowId // .data.workflowId // empty')"
  if [[ -z "${created_id}" ]]; then
    echo "Workflow create response did not include workflowId for ${wf_id}:" >&2
    echo "$created" | jq . >&2
    exit 1
  fi
  if [[ "$created_id" != "$wf_id" ]]; then
    echo "Novu created workflow id '$created_id', expected '$wf_id'." >&2
    exit 1
  fi
  echo "    Created workflow: $created_id"
}

WORKFLOWS_JSON="$(api_get "/v2/workflows?limit=100&page=0")"

echo "==> Checking/creating workflow: ${NOVU_WORKFLOW_ID}"
# Minimal v2 workflow with one SMS step.
# WhatsApp delivery is achieved at trigger-time by sending `to.phone=whatsapp:+<number>`.
WHATSAPP_STEPS="$(jq -cn --arg body "$NOVU_SMS_BODY" '[
  {
    name:"Send WhatsApp via Twilio",
    type:"sms",
    controlValues:{ body:$body }
  }
]')"
ensure_channel_workflow "$NOVU_WORKFLOW_ID" "$WHATSAPP_STEPS"

echo "==> Checking/creating novu-bridge channel workflows: ${NOVU_SMS_WORKFLOW_ID}, ${NOVU_EMAIL_WORKFLOW_ID}"
# novu-bridge triggers these fixed per-channel workflows (see
# novu.bridge.workflow.id.sms / .email in application.properties) with the
# fully rendered message in the trigger payload — the steps are pure
# pass-throughs of payload.body / payload.subject. Shapes match the live
# definitions on the reference install.
SMS_STEPS='[
  {
    "name":"sms-step",
    "type":"sms",
    "controlValues":{ "body":"{{ payload.body }}" }
  }
]'
EMAIL_STEPS='[
  {
    "name":"email-step",
    "type":"email",
    "controlValues":{
      "subject":"{{ payload.subject }}",
      "body":"{{ payload.body }}",
      "editorType":"html",
      "disableOutputSanitization":true
    }
  }
]'
ensure_channel_workflow "$NOVU_SMS_WORKFLOW_ID" "$SMS_STEPS"
ensure_channel_workflow "$NOVU_EMAIL_WORKFLOW_ID" "$EMAIL_STEPS"

echo "==> Checking/creating event-convention workflows: ${NOVU_EVENT_WORKFLOWS}"
IFS=',' read -r -a EVENT_WF_IDS <<< "$NOVU_EVENT_WORKFLOWS"
for EVENT_WF_ID in "${EVENT_WF_IDS[@]}"; do
  EVENT_WF_ID="$(echo "$EVENT_WF_ID" | xargs)"
  [[ -z "$EVENT_WF_ID" ]] && continue
  EVENT_WF_ID_EFFECTIVE="$(slugify "$EVENT_WF_ID")"
  EVENT_STEPS='[
    {
      "name":"Send WhatsApp via Twilio",
      "type":"sms",
      "controlValues":{
        "body":"Complaint {{payload.complaintNo}} status {{payload.workflowState}} for tenant {{payload.tenantId}}"
      }
    }
  ]'
  ensure_channel_workflow "$EVENT_WF_ID_EFFECTIVE" "$EVENT_STEPS"
done

echo
echo "Bootstrap complete."
echo "Environment: $NOVU_ENV_NAME ($ENV_ID)"
echo "Integration: $NOVU_INTEGRATION_ID ($INTEGRATION_ID)"
echo "Workflow: $NOVU_WORKFLOW_ID"
echo "Bridge Channel Workflows: $NOVU_SMS_WORKFLOW_ID, $NOVU_EMAIL_WORKFLOW_ID"
echo "Event Workflows: $NOVU_EVENT_WORKFLOWS"
echo
echo "Trigger example (WhatsApp):"
cat <<'EOT'
curl -X POST "$NOVU_BASE_URL/v1/events/trigger" \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"complaints-whatsapp",
    "to":{
      "subscriberId":"pb.amritsar:4fef6612-07a8-4751-97e9-0e0ac0687ebe",
      "phone":"whatsapp:+14155550123"
    },
    "payload":{
      "complaintNo":"CMP-123",
      "status":"ASSIGNED"
    },
    "transactionId":"tx-001"
  }'
EOT
