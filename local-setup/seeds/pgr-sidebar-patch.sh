#!/usr/bin/env bash
#
# pgr-sidebar-patch.sh — runtime MDMS patch for the PGR employee sidebar.
#
# Idempotent (safe to re-run) changes for tenant $TENANT:
#   1. Rename action 2553 "Search Complaint" -> "Inbox" (still points at
#      /employee/pgr/inbox-v2).
#   2. Create action 9001 "Search Complaint" -> /employee/pgr/search.
#   3. Grant action 9001 to the same 8 roles that already see the inbox link.
#   4. Upsert the ACTION_TEST_INBOX label ("Inbox") in en_IN + default.
#
# It patches BOTH access-control action masters that may exist
# (ACCESSCONTROL-ACTIONS-TEST.actions-test and the bridged ACCESSCONTROL-ACTIONS.actions),
# because the MCP tenant bootstrap mirrors rows across both, preserving data.id.
#
# Requires: bash, curl, jq. Targets the running stack via the nginx gateway.
#
# Usage:
#   ./pgr-sidebar-patch.sh
#   BASE_URL=http://localhost TENANT=mz ADMIN_USER=ADMIN ADMIN_PASS='eGov@123' ./pgr-sidebar-patch.sh
#
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"     # nginx gateway fronting the services
TENANT="${TENANT:-mz}"                       # tenant holding the access-control MDMS data
LOGIN_TENANT="${LOGIN_TENANT:-$TENANT}"      # tenant to authenticate against
ADMIN_USER="${ADMIN_USER:-ADMIN}"
ADMIN_PASS="${ADMIN_PASS:-eGov@123}"

INBOX_ACTION_ID="${INBOX_ACTION_ID:-2553}"   # existing "Search Complaint" -> inbox action
NEW_ACTION_ID="${NEW_ACTION_ID:-9001}"       # new "Search Complaint" -> /search action
NEW_NAV_URL="/digit-ui/employee/pgr/search"
ROLES=(CMS_CASE_MANAGER CMS_RECEPTION_OFFICER CMS_SCREENING_OFFICER CMS_SUPERVISOR COMPLAINTS_EDITOR CSR GRO PGR_LME)
ACTION_SCHEMAS=("ACCESSCONTROL-ACTIONS-TEST.actions-test" "ACCESSCONTROL-ACTIONS.actions")
ROLEACTION_SCHEMA="ACCESSCONTROL-ROLEACTIONS.roleactions"

command -v jq   >/dev/null || { echo "jq is required (brew install jq)"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }
say() { printf '%s\n' "$*" >&2; }

# ---------- 1. auth ----------
say "-> login: $ADMIN_USER @ $LOGIN_TENANT via $BASE_URL"
BASIC=$(printf '%s' "egov-user-client:" | base64)
TOKEN=$(curl -sS "$BASE_URL/user/oauth/token" \
  -H "Authorization: Basic $BASIC" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "username=$ADMIN_USER" \
  --data-urlencode "password=$ADMIN_PASS" \
  --data-urlencode "userType=EMPLOYEE" \
  --data-urlencode "tenantId=$LOGIN_TENANT" \
  --data-urlencode "scope=read" \
  --data-urlencode "grant_type=password" 2>/dev/null | jq -r '.access_token // empty' || true)
[ -n "$TOKEN" ] || { say "x login failed - check ADMIN creds / LOGIN_TENANT / BASE_URL"; exit 1; }
say "   ok"

ri()   { jq -cn --arg t "$TOKEN" '{apiId:"Rainmaker",ver:".01",ts:(now*1000|floor),msgId:"pgr-sidebar|en_IN",authToken:$t}'; }
post() { curl -sS -X POST "$BASE_URL$1" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d @-; }
mdms_search() { # $1 = schemaCode
  jq -cn --argjson ri "$(ri)" --arg tid "$TENANT" --arg sc "$1" \
    '{RequestInfo:$ri,MdmsCriteria:{tenantId:$tid,schemaCode:$sc,limit:2000,offset:0}}' \
  | post "/mdms-v2/v2/_search"
}

# ---------- 2. rename 2553 -> Inbox, 3. create 9001 (both action masters) ----------
TEMPLATE=""   # 2553 data object, reused as a template for 9001
for SCHEMA in "${ACTION_SCHEMAS[@]}"; do
  RESP=$(mdms_search "$SCHEMA" 2>/dev/null || true)
  COUNT=$(printf '%s' "$RESP" | jq -r '(.mdms // []) | length' 2>/dev/null || echo 0)
  if [ "${COUNT:-0}" = "0" ]; then say "- $SCHEMA: absent/empty - skipping"; continue; fi
  say "- $SCHEMA: $COUNT rows"

  # rename 2553
  REC=$(printf '%s' "$RESP" | jq -c --arg id "$INBOX_ACTION_ID" '(.mdms//[])|map(select((.data.id|tostring)==$id))|.[0]//empty' 2>/dev/null || true)
  if [ -n "$REC" ]; then
    [ -z "$TEMPLATE" ] && TEMPLATE=$(printf '%s' "$REC" | jq -c '.data')
    if [ "$(printf '%s' "$REC" | jq -r '.data.displayName')" = "Inbox" ]; then
      say "     2553 already 'Inbox'"
    else
      BODY=$(jq -cn --argjson ri "$(ri)" --argjson m "$(printf '%s' "$REC" | jq -c '.data.displayName="Inbox"')" '{RequestInfo:$ri,Mdms:$m}')
      OUT=$(printf '%s' "$BODY" | post "/mdms-v2/v2/_update/$SCHEMA" 2>/dev/null || true)
      printf '%s' "$OUT" | jq -e '.mdms[0].id' >/dev/null 2>&1 && say "     2553 -> Inbox ok" || say "     x update 2553 failed: $OUT"
    fi
  else
    say "     (action 2553 not in this master)"
  fi

  # create 9001
  EXIST=$(printf '%s' "$RESP" | jq -c --arg id "$NEW_ACTION_ID" '(.mdms//[])|map(select((.data.id|tostring)==$id))|.[0]//empty' 2>/dev/null || true)
  if [ -n "$EXIST" ]; then
    say "     9001 already present"
  else
    DATA=$(jq -cn --argjson tmpl "${TEMPLATE:-null}" --arg id "$NEW_ACTION_ID" --arg url "$NEW_NAV_URL" --arg tid "$TENANT" '
      ($tmpl // {url:"url",enabled:true,leftIcon:"PGRIcon",queryParams:"",serviceCode:"PGR",parentModule:"rainmaker-pgr",orderNumber:1,rightIcon:"",createdBy:null,createdDate:null,lastModifiedBy:null,lastModifiedDate:null})
      | .id=($id|tonumber) | .name="Search Citizen Complaint" | .path="SearchCitizenComplaint"
      | .displayName="Search Complaint" | .navigationURL=$url | .tenantId=$tid')
    BODY=$(jq -cn --argjson ri "$(ri)" --arg tid "$TENANT" --arg sc "$SCHEMA" --arg uid "$NEW_ACTION_ID" --argjson d "$DATA" \
      '{RequestInfo:$ri,Mdms:{tenantId:$tid,schemaCode:$sc,uniqueIdentifier:$uid,data:$d,isActive:true}}')
    OUT=$(printf '%s' "$BODY" | post "/mdms-v2/v2/_create/$SCHEMA" 2>/dev/null || true)
    printf '%s' "$OUT" | jq -e '.mdms[0].id' >/dev/null 2>&1 && say "     9001 created ok" || say "     x create 9001 failed: $OUT"
  fi
done

# ---------- 4. roleactions for 9001 ----------
say "- $ROLEACTION_SCHEMA: granting 9001 to ${#ROLES[@]} roles"
RA_RESP=$(mdms_search "$ROLEACTION_SCHEMA" 2>/dev/null || true)
for R in "${ROLES[@]}"; do
  HAS=$(printf '%s' "$RA_RESP" | jq -r --arg r "$R" --arg a "$NEW_ACTION_ID" '(.mdms//[])|map(select(.data.rolecode==$r and (.data.actionid|tostring)==$a))|length' 2>/dev/null || echo 0)
  if [ "${HAS:-0}" != "0" ]; then say "     $R already granted"; continue; fi
  BODY=$(jq -cn --argjson ri "$(ri)" --arg tid "$TENANT" --arg sc "$ROLEACTION_SCHEMA" --arg uid "${R}-${NEW_ACTION_ID}" --arg r "$R" --arg a "$NEW_ACTION_ID" \
    '{RequestInfo:$ri,Mdms:{tenantId:$tid,schemaCode:$sc,uniqueIdentifier:$uid,data:{rolecode:$r,actionid:($a|tonumber),actioncode:"",tenantId:$tid},isActive:true}}')
  OUT=$(printf '%s' "$BODY" | post "/mdms-v2/v2/_create/$ROLEACTION_SCHEMA" 2>/dev/null || true)
  printf '%s' "$OUT" | jq -e '.mdms[0].id' >/dev/null 2>&1 && say "     +$R ok" || say "     x $R failed: $OUT"
done

# ---------- 5. localization ----------
say "- localization: ACTION_TEST_INBOX = Inbox"
jq -cn --argjson ri "$(ri)" --arg tid "$TENANT" \
  '{RequestInfo:$ri,tenantId:$tid,messages:[
     {code:"ACTION_TEST_INBOX",message:"Inbox",module:"rainmaker-common",locale:"en_IN"},
     {code:"ACTION_TEST_INBOX",message:"Inbox",module:"rainmaker-common",locale:"default"}]}' \
  | post "/localization/messages/v1/_upsert" >/dev/null 2>&1 && say "     upserted ok" || say "     x localization upsert failed"
curl -sS -X POST "$BASE_URL/localization/messages/cache-bust" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || true

say ""
say "Done. If the sidebar doesn't update immediately:"
say "  * hard-refresh the browser (Cmd+Shift+R) - the UI caches actions per session;"
say "  * if still stale, restart access control:  docker restart egov-accesscontrol"
say "    (it caches actions/roleactions read from MDMS)."
