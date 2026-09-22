set -uo pipefail
KC="${KC_URL:?set KC_URL to the Keycloak-fronted deployment}"
TEN="${TENANT:-ke.bomet}"; ROOT="${ROOT_TENANT:-ke}"
say(){ printf "  %-40s %s\n" "$1" "$2"; }
tok(){ curl -s -X POST "$KC/kc/realms/ke/protocol/openid-connect/token" -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&client_id=digit-ui&username=$1&password=$2&tenantId=$3" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(json.dumps({'t':d.get('access_token',''),'u':d.get('digit_user') or {}}))"; }

CJ=$(tok 712345678 123456 ke);  CIT=$(echo "$CJ"|python3 -c "import json,sys;print(json.load(sys.stdin)['t'])"); CU=$(echo "$CJ"|python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin)['u']))")
EJ=$(tok ADMIN eGov@123 ke);    EMP=$(echo "$EJ"|python3 -c "import json,sys;print(json.load(sys.stdin)['t'])"); EU=$(echo "$EJ"|python3 -c "import json,sys;print(json.dumps(json.load(sys.stdin)['u']))")
say "citizen / employee KC tokens" "len=${#CIT} / ${#EMP}"
EUUID=$(echo "$EU"|python3 -c "import json,sys;print(json.load(sys.stdin).get('uuid',''))")

RI(){ echo "{\"apiId\":\"Rainmaker\",\"msgId\":\"$(date +%s)000|en_IN\",\"authToken\":\"$1\",\"userInfo\":$2}"; }

CREATE=$(curl -s -X POST "$KC/kc/pgr-services/v2/request/_create?tenantId=$TEN" -H "Content-Type: application/json" -H "Authorization: Bearer $CIT" -d "$(python3 -c "
import json,sys,time
cu=json.loads('''$CU''')
print(json.dumps({'RequestInfo':{'apiId':'Rainmaker','msgId':f'{int(time.time())}000|en_IN','authToken':'$CIT','userInfo':cu},
 'service':{'tenantId':'$TEN','serviceCode':'${SERVICE:-DamagedRoad}','description':'kc lifecycle probe','source':'web',
   'address':{'city':'$TEN','locality':{'code':'BOMET_BOMET_CENTRAL_MUTARAKWA','name':'Chesoen'},'geoLocation':{'latitude':-0.7813,'longitude':35.3416}},
   'citizen':{'name':cu.get('name','Citizen'),'mobileNumber':cu.get('mobileNumber'),'countryCode':cu.get('countryCode'),'emailId':cu.get('emailId'),'type':'CITIZEN','tenantId':'$ROOT','uuid':cu.get('uuid')}},
 'workflow':{'action':'APPLY'}}))")")
SRID=$(echo "$CREATE"|python3 -c "import json,sys;print((json.load(sys.stdin).get('ServiceWrappers') or [{}])[0].get('service',{}).get('serviceRequestId',''))" 2>/dev/null)
say "APPLY (citizen files)" "${SRID:-FAILED: $(echo "$CREATE"|head -c 110)}"
[ -z "$SRID" ] && exit 1

step(){ # action token userinfo extra
  local S=$(curl -s -X POST "$KC/kc/pgr-services/v2/request/_search?tenantId=$TEN&serviceRequestId=$SRID" -H "Content-Type: application/json" -H "Authorization: Bearer $2" -d "{\"RequestInfo\":$(RI "$2" "$3")}" \
    | python3 -c "import json,sys
w=(json.load(sys.stdin).get('ServiceWrappers') or [{}])[0]; s=w.get('service',{}); s.pop('processInstance',None); print(json.dumps(s))" 2>/dev/null)
  [ -z "$S" ] && { say "$1" "search FAILED"; return; }
  local R=$(curl -s -w '\n%{http_code}' -X POST "$KC/kc/pgr-services/v2/request/_update?tenantId=$TEN" -H "Content-Type: application/json" -H "Authorization: Bearer $2" \
    -d "{\"RequestInfo\":$(RI "$2" "$3"),\"service\":$S,\"workflow\":{\"action\":\"$1\",\"comments\":\"kc lifecycle\"$4}}")
  local C=$(echo "$R"|tail -1)
  local ST=$(echo "$R"|sed '$d'|python3 -c "import json,sys;w=(json.load(sys.stdin).get('ServiceWrappers') or [{}])[0];print(w.get('service',{}).get('applicationStatus',''))" 2>/dev/null)
  say "$1" "http=$C  status=${ST:-$(echo "$R"|sed '$d'|head -c 300)}"
}
step ASSIGN  "$EMP" "$EU" ",\"assignes\":[\"${ASSIGNEE:-$EUUID}\"]"
step RESOLVE "$EMP" "$EU" ""
step RATE    "$CIT" "$CU" ""
FIN=$(curl -s -X POST "$KC/kc/pgr-services/v2/request/_search?tenantId=$TEN&serviceRequestId=$SRID" -H "Content-Type: application/json" -H "Authorization: Bearer $CIT" -d "{\"RequestInfo\":$(RI "$CIT" "$CU")}" \
 | python3 -c "import json,sys;w=(json.load(sys.stdin).get('ServiceWrappers') or [{}])[0];print(w.get('service',{}).get('applicationStatus',''))" 2>/dev/null)
say "FINAL STATUS ($SRID)" "$FIN"
