#!/usr/bin/env bash
# Reproduce the VERIFIED login matrix. Run ON the bomet host (or anywhere that can
# reach Kong at 127.0.0.1:18000). Prints, per user: LOGIN ok/fail, role codes, and
# whether those roles grant dashboard access (per DASHBOARD_ROLES).
#
#   ssh bomet 'bash -s' < verify-login-matrix.sh                # default demo users
#   ssh bomet 'bash -s' < verify-login-matrix.sh SOME_OTHER_USER
#
# Password for all seeded users: eGov@123.
set -uo pipefail
KONG="${KONG:-http://127.0.0.1:18000}"
BASIC="Basic ZWdvdi11c2VyLWNsaWVudDo="
DASHBOARD_ROLES="SUPERVISOR PGR_SUPERVISOR GRO DGRO PGR_LME PGR_ADMIN SUPERUSER"

USERS=("$@")
if [ ${#USERS[@]} -eq 0 ]; then
  USERS=(KE_ADMIN DEMO_SUPERVISOR KE_GRO BOMET_ADMIN ANDREW VINOTH)
fi

for u in "${USERS[@]}"; do
  resp=$(curl -s -X POST "$KONG/user/oauth/token" \
    -H "Authorization: $BASIC" -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "username=$u" --data-urlencode "password=eGov@123" \
    --data-urlencode "tenantId=ke" --data-urlencode "userType=EMPLOYEE" \
    --data-urlencode "scope=read" --data-urlencode "grant_type=password")
  echo "USER=$u"
  DASHBOARD_ROLES="$DASHBOARD_ROLES" python3 - "$resp" <<'PY'
import os,sys,json
resp=sys.argv[1]; dash=set(os.environ["DASHBOARD_ROLES"].split())
try:
    d=json.loads(resp)
except Exception:
    print("  PARSE_ERR", resp[:160]); sys.exit()
if "access_token" not in d:
    print("  LOGIN=FAIL", d.get("error_description") or d.get("error") or d); sys.exit()
codes=sorted({r["code"] for r in d["UserRequest"]["roles"]})
grant=sorted(set(codes)&dash)
print("  LOGIN=OK roles="+",".join(codes))
print("  DASHBOARD_ACCESS="+("YES via "+",".join(grant) if grant else "NO (no DASHBOARD_ROLES)"))
PY
done
