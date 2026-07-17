#!/usr/bin/env python3
# Gateway BEHAVIOR parity probe (companion to .github/scripts/check-gateway-whitelist-parity.py).
#
# The whitelist check proves the RULES match; this proves the DECISIONS match.
# Fires identical requests at the compose Kong gateway and the k3s Spring gateway
# and diffs the HTTP auth outcome (pass / 401 / 403). Every mismatch is a parity gap.
#
# Usage:  KONG=http://localhost:18000  K3S=https://<k3s-ingress>  python3 gateway-behavior-parity.py
# Requires both stacks up + reachable. Excludes the §1.10 bodyless-GET row (k3s bug — Kong is
# correctly better there; do NOT "fix" Kong to match k3s's 500).
"""Gateway parity probe: fire identical requests at compose-Kong and k3s-Spring
gateways, diff the HTTP status outcomes. Every mismatch is a parity gap."""
import json, os, subprocess, sys

# Endpoints are environment-specific — pass them in (see the usage note above).
KONG = os.environ.get("KONG", "http://localhost:18000")
K3S  = os.environ.get("K3S",  "https://<k3s-ingress>")

def curl(base, method, path, token=None, body=None, insecure=False):
    cmd = ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-X", method, base+path]
    if insecure: cmd.insert(1, "-k")
    cmd += ["-H", "Content-Type: application/json"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}", "-H", f"auth-token: {token}"]
        # real DIGIT clients also carry the token in RequestInfo.authToken
        if body is not None:
            try:
                b = json.loads(body); b.setdefault("RequestInfo", {})["authToken"] = token
                body = json.dumps(b)
            except Exception: pass
    if body is not None: cmd += ["-d", body]
    try: return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception as e: return f"ERR"

def login(base, insecure):
    cmd = ["curl","-s","-X","POST",base+"/user/oauth/token",
           "-H","Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=",
           "-H","Content-Type: application/x-www-form-urlencoded",
           "--data","username=ADMIN&password=eGov@123&grant_type=password&scope=read&tenantId=mz&userType=EMPLOYEE"]
    if insecure: cmd.insert(1,"-k")
    try: return json.loads(subprocess.run(cmd,capture_output=True,text=True,timeout=20).stdout)["access_token"]
    except Exception: return None

OP_KONG = login(KONG, False)
OP_K3S  = login(K3S, True)
print(f"tokens: kong={'ok' if OP_KONG else 'FAIL'} k3s={'ok' if OP_K3S else 'FAIL'}\n")

DEPT = json.dumps({"RequestInfo":{},"Mdms":{"tenantId":"mz","schemaCode":"common-masters.Department","uniqueIdentifier":"PARITY_PROBE","data":{"code":"PARITY_PROBE","name":"x","active":True},"isActive":True}})
SEARCH = json.dumps({"RequestInfo":{}})

# (label, method, path, token-kind, body)  token-kind: none|operator
PROBES = [
 ("open: mdms search (no auth)",        "POST","/egov-mdms-service/v1/_search","none",SEARCH),
 ("open: localization search",          "POST","/localization/messages/v1/_search","none",SEARCH),
 ("protected write, NO token",          "POST","/mdms-v2/v2/_create/common-masters.Department","none",DEPT),
 ("protected write, operator",          "POST","/mdms-v2/v2/_create/common-masters.Department","operator",DEPT),
 ("mdms ACCESSCONTROL write, operator", "POST","/mdms-v2/v2/_create/ACCESSCONTROL-ROLES.roles","operator",SEARCH),
 ("user _search, NO token",             "POST","/user/_search","none",SEARCH),
 ("user _search, operator",             "POST","/user/_search","operator",SEARCH),
 ("pgr request _search, NO token",      "POST","/pgr-services/v2/request/_search","none",SEARCH),
 ("pgr request _search, operator",      "POST","/pgr-services/v2/request/_search","operator",SEARCH),
 ("workflow bs _search, NO token",      "POST","/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=mz","none",SEARCH),
 ("hrms _search, operator",             "POST","/egov-hrms/employees/_search?tenantId=mz","operator",SEARCH),
 ("bodyless GET dashboard, operator",   "GET","/pgr-services/v2/dashboard?tenantId=mz","operator",None),
 ("idgen generate, NO token (mixed)",   "POST","/egov-idgen/id/_generate","none",SEARCH),
 ("filestore url GET, operator",        "GET","/filestore/v1/files/url?tenantId=mz&fileStoreIds=zzz","operator",None),
]

print(f"{'probe':<38}{'kong':>7}{'k3s':>7}  parity")
print("-"*64)
gaps=[]
for label,method,path,tk,body in PROBES:
    tkK = OP_KONG if tk=="operator" else None
    tkS = OP_K3S  if tk=="operator" else None
    ck = curl(KONG, method, path, tkK, body, False)
    cs = curl(K3S,  method, path, tkS, body, True)
    match = "OK" if ck==cs else "◄ DIVERGE"
    if ck!=cs: gaps.append((label,ck,cs))
    print(f"{label:<38}{ck:>7}{cs:>7}  {match}")
print(f"\n{len(gaps)} divergences / {len(PROBES)} probes")
for l,ck,cs in gaps: print(f"  - {l}: kong={ck} k3s={cs}")
