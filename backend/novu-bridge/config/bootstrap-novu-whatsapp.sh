#!/usr/bin/env bash
set -euo pipefail

# Bootstraps Novu (self-hosted or cloud-compatible) with:
# 1) Environment (project-like scope)
# 2) Twilio SMS integration (usable for WhatsApp by sending phone as whatsapp:+<number>)
# 3) Minimal workflow with a single SMS step
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
#   NOVU_WORKFLOW_ID       (default: complaints-whatsapp-v1)
#   NOVU_WORKFLOW_NAME     (default: Complaints WhatsApp Workflow)
#   NOVU_INTEGRATION_NAME  (default: twilio-whatsapp)
#   NOVU_INTEGRATION_ID    (default: twilio-whatsapp)
#   NOVU_SMS_BODY          (default: Complaint {{payload.complaintNo}} status is {{payload.status}})
#   NOVU_EVENT_WORKFLOWS   (default: COMPLAINTS.WORKFLOW.APPLY,COMPLAINTS.WORKFLOW.ASSIGN)

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
NOVU_ENV_FILE="${NOVU_ENV_FILE:-${SCRIPT_DIR}/.env.novu}"
if [[ -f "$NOVU_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$NOVU_ENV_FILE" && set +a
  echo "Loaded environment from: $NOVU_ENV_FILE"
fi

require_var NOVU_API_KEY
require_var TWILIO_ACCOUNT_SID
require_var TWILIO_AUTH_TOKEN
require_var TWILIO_WHATSAPP_FROM

NOVU_BASE_URL="${NOVU_BASE_URL:-http://localhost:1336}"
NOVU_ENV_NAME="${NOVU_ENV_NAME:-digit-dev}"
NOVU_ENV_COLOR="${NOVU_ENV_COLOR:-#4F46E5}"
NOVU_WORKFLOW_ID="${NOVU_WORKFLOW_ID:-complaints-whatsapp-v1}"
NOVU_WORKFLOW_NAME="${NOVU_WORKFLOW_NAME:-Complaints WhatsApp Workflow}"
NOVU_INTEGRATION_NAME="${NOVU_INTEGRATION_NAME:-twilio-whatsapp}"
NOVU_INTEGRATION_ID="${NOVU_INTEGRATION_ID:-twilio-whatsapp}"
NOVU_SMS_BODY="${NOVU_SMS_BODY:-Complaint {{payload.complaintNo}} status is {{payload.status}}}"
NOVU_EVENT_WORKFLOWS="${NOVU_EVENT_WORKFLOWS:-COMPLAINTS.WORKFLOW.APPLY,COMPLAINTS.WORKFLOW.ASSIGN}"

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

api_get_no_fail() {
  local path="$1"
  curl -sS \
    -H "$AUTH_HEADER" \
    "${NOVU_BASE_URL}${path}" || true
}

api_post_with_status() {
  local path="$1"
  local payload="$2"
  local body_file
  body_file="$(mktemp)"
  local status
  status="$(curl -sS -o "$body_file" -w '%{http_code}' \
    -X POST \
    -H "$AUTH_HEADER" \
    -H "$JSON_HEADER" \
    -d "$payload" \
    "${NOVU_BASE_URL}${path}" || true)"
  echo "${status}|${body_file}"
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
  INTEGRATION_ID="$(echo "$INTEGRATIONS_JSON" | jq -r --arg ident "$NOVU_INTEGRATION_ID" --arg env "$ENV_ID" '
    (.. | arrays | .[]? | select(type=="object")) as $i
    | select(($i.identifier // "") == $ident and (($i._environmentId // $i.environmentId // "") == $env))
    | ($i._id // $i.id // empty)
  ' | head -n1)"
else
  INTEGRATION_ID="$(echo "$INTEGRATIONS_JSON" | jq -r --arg ident "$NOVU_INTEGRATION_ID" '
    (.. | arrays | .[]? | select(type=="object")) as $i
    | select(($i.identifier // "") == $ident)
    | ($i._id // $i.id // empty)
  ' | head -n1)"
fi

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
  echo "    Found integration id: $INTEGRATION_ID"
fi

echo "==> Checking/creating workflow: ${NOVU_WORKFLOW_ID}"
WORKFLOWS_JSON="$(api_get "/v2/workflows?limit=100&page=0")"
WORKFLOW_EXISTS="$(echo "$WORKFLOWS_JSON" | jq -r --arg wid "$NOVU_WORKFLOW_ID" '
  [
    (.. | arrays | .[]? | select(type=="object") | select((.workflowId // "") == $wid))
  ] | length
')"

if [[ "$WORKFLOW_EXISTS" == "0" ]]; then
  # Minimal v2 workflow payload with one SMS step.
  # WhatsApp delivery is achieved at trigger-time by sending `to.phone=whatsapp:+<number>`.
  CREATE_WORKFLOW_PAYLOAD="$(jq -cn \
    --arg wfId "$NOVU_WORKFLOW_ID" \
    --arg name "$NOVU_WORKFLOW_NAME" \
    --arg body "$NOVU_SMS_BODY" \
    '{
      workflowId:$wfId,
      name:$name,
      active:true,
      validatePayload:false,
      isTranslationEnabled:false,
      steps:[
        {
          name:"Send WhatsApp via Twilio",
          type:"sms",
          controlValues:{
            body:$body
          }
        }
      ]
    }')"

  CREATED_WORKFLOW="$(api_post "/v2/workflows" "$CREATE_WORKFLOW_PAYLOAD")" || {
    echo "Workflow creation failed. Response follows." >&2
    echo "$CREATE_WORKFLOW_PAYLOAD" | jq . >&2
    exit 1
  }
  CREATED_WORKFLOW_ID="$(echo "$CREATED_WORKFLOW" | jq -r '.workflowId // .data.workflowId // empty')"
  if [[ -z "${CREATED_WORKFLOW_ID}" ]]; then
    echo "Workflow create response did not include workflowId:" >&2
    echo "$CREATED_WORKFLOW" | jq . >&2
    exit 1
  fi
  echo "    Created workflow: $CREATED_WORKFLOW_ID"
else
  echo "    Workflow already exists"
fi

echo "==> Checking/creating event-convention workflows: ${NOVU_EVENT_WORKFLOWS}"
IFS=',' read -r -a EVENT_WF_IDS <<< "$NOVU_EVENT_WORKFLOWS"
for EVENT_WF_ID in "${EVENT_WF_IDS[@]}"; do
  EVENT_WF_ID="$(echo "$EVENT_WF_ID" | xargs)"
  [[ -z "$EVENT_WF_ID" ]] && continue
  EVENT_WORKFLOW_EXISTS="$(echo "$WORKFLOWS_JSON" | jq -r --arg wid "$EVENT_WF_ID" '
    [
      (.. | arrays | .[]? | select(type=="object") | select((.workflowId // "") == $wid))
    ] | length
  ')"

  if [[ "$EVENT_WORKFLOW_EXISTS" == "0" ]]; then
    EVENT_NAME_PRETTY="$(echo "$EVENT_WF_ID" | tr '.' ' ')"
    EVENT_WF_ID_EFFECTIVE="$EVENT_WF_ID"
    EVENT_CREATE_PAYLOAD="$(jq -cn \
      --arg wfId "$EVENT_WF_ID_EFFECTIVE" \
      --arg name "$EVENT_NAME_PRETTY" \
      '{
        workflowId:$wfId,
        name:$name,
        active:true,
        validatePayload:false,
        isTranslationEnabled:false,
        steps:[
          {
            name:"Send WhatsApp via Twilio",
            type:"sms",
            controlValues:{
              body:"Complaint {{payload.complaintNo}} status {{payload.workflowState}} for tenant {{payload.tenantId}}"
            }
          }
        ]
      }')"

    CREATE_RESULT="$(api_post_with_status "/v2/workflows" "$EVENT_CREATE_PAYLOAD")"
    CREATE_STATUS="${CREATE_RESULT%%|*}"
    CREATE_BODY_FILE="${CREATE_RESULT#*|}"
    CREATED_EVENT_WF="$(cat "$CREATE_BODY_FILE")"
    rm -f "$CREATE_BODY_FILE"

    if [[ "$CREATE_STATUS" == "422" ]]; then
      EVENT_WF_ID_EFFECTIVE="$(slugify "$EVENT_WF_ID")"
      echo "    Workflow ID '$EVENT_WF_ID' rejected by Novu (422). Retrying with '$EVENT_WF_ID_EFFECTIVE'."
      EVENT_CREATE_PAYLOAD="$(jq -cn \
        --arg wfId "$EVENT_WF_ID_EFFECTIVE" \
        --arg name "$EVENT_NAME_PRETTY" \
        '{
          workflowId:$wfId,
          name:$name,
          active:true,
          validatePayload:false,
          isTranslationEnabled:false,
          steps:[
            {
              name:"Send WhatsApp via Twilio",
              type:"sms",
              controlValues:{
                body:"Complaint {{payload.complaintNo}} status {{payload.workflowState}} for tenant {{payload.tenantId}}"
              }
            }
          ]
        }')"
      RETRY_RESULT="$(api_post_with_status "/v2/workflows" "$EVENT_CREATE_PAYLOAD")"
      RETRY_STATUS="${RETRY_RESULT%%|*}"
      RETRY_BODY_FILE="${RETRY_RESULT#*|}"
      CREATED_EVENT_WF="$(cat "$RETRY_BODY_FILE")"
      rm -f "$RETRY_BODY_FILE"
      if [[ "$RETRY_STATUS" -lt 200 || "$RETRY_STATUS" -ge 300 ]]; then
        echo "Failed creating workflow ${EVENT_WF_ID} with normalized id ${EVENT_WF_ID_EFFECTIVE} (HTTP ${RETRY_STATUS})" >&2
        echo "$CREATED_EVENT_WF" | jq . >&2
        exit 1
      fi
    elif [[ "$CREATE_STATUS" -lt 200 || "$CREATE_STATUS" -ge 300 ]]; then
      echo "Failed creating workflow ${EVENT_WF_ID} (HTTP ${CREATE_STATUS})" >&2
      echo "$CREATED_EVENT_WF" | jq . >&2
      exit 1
    fi

    CREATED_EVENT_WF_ID="$(echo "$CREATED_EVENT_WF" | jq -r '.workflowId // .data.workflowId // empty')"
    if [[ -z "${CREATED_EVENT_WF_ID}" ]]; then
      echo "Failed creating workflow ${EVENT_WF_ID}" >&2
      echo "$CREATED_EVENT_WF" | jq . >&2
      exit 1
    fi
    echo "    Created workflow: $CREATED_EVENT_WF_ID (source event: $EVENT_WF_ID)"
  else
    echo "    Workflow already exists: $EVENT_WF_ID"
  fi
done

echo
echo "Bootstrap complete."
echo "Environment: $NOVU_ENV_NAME ($ENV_ID)"
echo "Integration: $NOVU_INTEGRATION_ID ($INTEGRATION_ID)"
echo "Workflow: $NOVU_WORKFLOW_ID"
echo "Event Workflows: $NOVU_EVENT_WORKFLOWS"
echo
echo "Trigger example (WhatsApp):"
cat <<'EOT'
curl -X POST "$NOVU_BASE_URL/v1/events/trigger" \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"complaints-whatsapp-v1",
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
