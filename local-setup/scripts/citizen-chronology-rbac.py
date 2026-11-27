#!/usr/bin/env python3
"""Grant /pgr-services/v2/request/_chronology and revoke the CITIZEN role's raw workflow
search on a LIVE tenant, through the MDMS API (no server shell needed).

Why: a citizen's complaint timeline must come from pgr-services' requester-filtered
chronology endpoint. The raw egov-workflow-v2 process search answers per tenant and
complaint id with no notion of who owns a complaint, so the CITIZEN role must not hold it
(egovernments/Citizen-Complaint-Resolution-System#2846). The seed under
utilities/default-data-handler and local-setup/db/full-dump.sql carry this for NEW tenants
and fresh local stacks; a tenant that already exists needs this script once.

  BASE=https://<gateway> TENANT=<state tenant> python3 citizen-chronology-rbac.py
      dry run: prints the rows it would create / deactivate, writes nothing
  ... APPLY=1 python3 citizen-chronology-rbac.py
      create the chronology action and its role grants
  ... APPLY=1 REVOKE_CITIZEN_RAW=1 python3 citizen-chronology-rbac.py
      the same, then deactivate CITIZEN's grant on the raw workflow search

Order matters: deploy the pgr-services that serves _chronology and the UI that calls it
BEFORE REVOKE_CITIZEN_RAW=1, or the citizen timeline goes blank. Revoking is reversible:
re-activate the row (mdms-v2 _update with isActive true) or create it again.

Auth: TOKEN=<authToken> (never stored) or DIGIT_USER / DIGIT_PASS (prompted), with
MDMS_ADMIN or ACCOUNT_ADMIN (ADMIN has both). Idempotent: rows that already exist are
skipped. egov-accesscontrol caches these masters: a 403 right after the change clears
within a few minutes, or restart egov-accesscontrol.
Optional: EXTRA_ROLES=A,B adds grants beyond the raw action's holders; ACTION_ID picks the
id for the new action (default 2635, the id the seed uses); TEST_BUSINESS_ID=<complaint id>
makes one authorization call as the signed-in employee at the end.
"""
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("BASE", "http://localhost:18000").rstrip("/")
TENANT = os.environ.get("TENANT") or sys.exit("TENANT=<state tenant code> is required")
ACTION_ID = int(os.environ.get("ACTION_ID", "2635"))
URL = "/pgr-services/v2/request/_chronology"
RAW_URL = "/egov-workflow-v2/egov-wf/process/_search"
EXTRA_ROLES = [r for r in os.environ.get("EXTRA_ROLES", "").split(",") if r]
APPLY = os.environ.get("APPLY") == "1"
REVOKE = os.environ.get("REVOKE_CITIZEN_RAW") == "1"
TEST_BUSINESS_ID = os.environ.get("TEST_BUSINESS_ID", "")
RA_SCHEMA = "ACCESSCONTROL-ROLEACTIONS.roleactions"
RI = {"apiId": "Rainmaker"}


def post(path, body, token=None):
    if token:
        body.setdefault("RequestInfo", {})["authToken"] = token
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}


def read_masters():
    _, res = post("/egov-mdms-service/v1/_search", {"RequestInfo": dict(RI), "MdmsCriteria": {"tenantId": TENANT, "moduleDetails": [
        {"moduleName": "ACCESSCONTROL-ACTIONS-TEST", "masterDetails": [{"name": "actions-test"}]},
        {"moduleName": "ACCESSCONTROL-ACTIONS", "masterDetails": [{"name": "actions"}]},
        {"moduleName": "ACCESSCONTROL-ROLEACTIONS", "masterDetails": [{"name": "roleactions"}]},
        {"moduleName": "ACCESSCONTROL-ROLES", "masterDetails": [{"name": "roles"}]}]}})
    m = res.get("MdmsRes") or sys.exit(f"could not read the access-control masters on {TENANT}: {str(res)[:200]}")
    return ({"ACCESSCONTROL-ACTIONS-TEST.actions-test": m.get("ACCESSCONTROL-ACTIONS-TEST", {}).get("actions-test", []),
             "ACCESSCONTROL-ACTIONS.actions": m.get("ACCESSCONTROL-ACTIONS", {}).get("actions", [])},
            m.get("ACCESSCONTROL-ROLEACTIONS", {}).get("roleactions", []),
            {x["code"] for x in m.get("ACCESSCONTROL-ROLES", {}).get("roles", [])})


def login():
    tok = os.environ.get("TOKEN")
    if tok:
        return tok, "token user"
    user = os.environ.get("DIGIT_USER", "ADMIN")
    pw = os.environ.get("DIGIT_PASS") or getpass.getpass(f"password for {user} on {TENANT}: ")
    data = urllib.parse.urlencode({"username": user, "password": pw, "grant_type": "password", "scope": "read",
                                   "tenantId": TENANT, "userType": "EMPLOYEE"}).encode()
    req = urllib.request.Request(BASE + "/user/oauth/token", data=data, headers={
        "Authorization": "Basic ZWdvdi11c2VyLWNsaWVudDo=", "Content-Type": "application/x-www-form-urlencoded"})
    auth = json.loads(urllib.request.urlopen(req, timeout=60).read())
    tok = auth.get("access_token") or sys.exit(f"login failed: {str(auth)[:200]}")
    have = {r["code"] for r in (auth.get("UserRequest") or {}).get("roles", [])}
    print(f"logged in as {user} | MDMS write role present: {bool(have & {'MDMS_ADMIN', 'ACCOUNT_ADMIN'})}")
    return tok, user


def v2_records(schema, token):
    """Every mdms-v2 record of a schema on the tenant (paged), with id / uniqueIdentifier / isActive."""
    out, offset, limit = [], 0, 500
    while True:
        st, res = post("/mdms-v2/v2/_search", {"RequestInfo": dict(RI), "MdmsCriteria": {
            "tenantId": TENANT, "schemaCode": schema, "limit": limit, "offset": offset}}, token)
        rows = res.get("mdms") or []
        if st != 200 and not rows:
            sys.exit(f"mdms-v2 search of {schema} failed: HTTP {st} {str(res)[:200]}")
        out.extend(rows)
        if len(rows) < limit:
            return out
        offset += limit


print(f"target: gateway={BASE} tenant={TENANT} action={ACTION_ID} {URL}")
masters, roleactions, defined = read_masters()
actions_test = masters["ACCESSCONTROL-ACTIONS-TEST.actions-test"]
raw = [a for a in actions_test if a.get("url") == RAW_URL]
raw_id = raw[0]["id"] if raw else None
if raw_id is None:
    sys.exit(f"!! the raw workflow search action ({RAW_URL}) is not defined on {TENANT} — check TENANT")
clash = [(s, a["url"]) for s, rows in masters.items() for a in rows if a.get("id") == ACTION_ID and a.get("url") != URL]
if clash:
    sys.exit(f"!! action id {ACTION_ID} already used for {clash} — rerun with ACTION_ID=<free id>")

# Grant to every role that may call the raw search today (CITIZEN included), plus extras.
roles = sorted({r["rolecode"] for r in roleactions if r.get("actionid") == raw_id} | set(EXTRA_ROLES))
undefined = [x for x in roles if defined and x not in defined]
if undefined:   # a grant for an undefined role is rejected (REFERENCE_VALIDATION_ERR)
    print(f"  ! not defined in ACCESSCONTROL-ROLES.roles on {TENANT}, skipped: {', '.join(undefined)}")
    roles = [x for x in roles if x not in undefined]
granted = {r["rolecode"] for r in roleactions if r.get("actionid") == ACTION_ID}
action_row = {"id": ACTION_ID, "url": URL, "code": "null", "name": "Chronology Filtered Search", "path": "",
              "enabled": False, "displayName": "Chronology Filtered Search", "orderNumber": 0,
              "serviceCode": "pgr-services", "parentModule": "", "method": "POST"}
plan = []
for schema, rows in masters.items():
    if not rows:
        continue  # master not used on this tenant
    if any(a.get("id") == ACTION_ID for a in rows):
        print(f"  = {schema}: action {ACTION_ID} already present")
        continue
    plan.append((schema, action_row))
for role in roles:
    if role in granted:
        print(f"  = roleaction {role}.{ACTION_ID} already present")
        continue
    plan.append((RA_SCHEMA, {"rolecode": role, "actionid": ACTION_ID, "actioncode": "", "tenantId": TENANT}))
citizen_raw = any(r.get("rolecode") == "CITIZEN" and r.get("actionid") == raw_id for r in roleactions)
print(f"raw workflow search = action {raw_id}; CITIZEN holds it: {citizen_raw}")
print(f"roles to grant {ACTION_ID}: {', '.join(roles)}")
print(f"rows to create: {len(plan)}")
for schema, data in plan:
    print(f"  + {schema}: {json.dumps(data)}")
if REVOKE:
    print(f"revoke: CITIZEN grant on action {raw_id} will be deactivated" if citizen_raw else "revoke: nothing to do, CITIZEN does not hold the raw action")
else:
    print("revoke: not requested (REVOKE_CITIZEN_RAW=1) — do it only once the UI calling _chronology is live")
if not plan and not (REVOKE and citizen_raw):
    print("nothing to do")
    sys.exit(0)
if not APPLY:
    print("--- dry run; rerun with APPLY=1 to write")
    sys.exit(0)

tok, user = login()
fails = 0
for schema, row in plan:
    st, r = post(f"/mdms-v2/v2/_create/{schema}", {"RequestInfo": dict(RI), "Mdms": {
        "tenantId": TENANT, "schemaCode": schema, "data": row, "isActive": True}}, tok)
    ok = st in (200, 202) and not r.get("Errors") and r.get("mdms")  # mdms-v2 answers 202 on create
    label = row.get("rolecode", "action")
    detail = json.dumps(r.get("Errors"))[:200] if r.get("Errors") else (r["mdms"][0].get("uniqueIdentifier") if ok else str(r)[:160])
    print(f"  {'OK  ' if ok else 'FAIL'} {schema} {label} -> HTTP {st} {detail}")
    fails += 0 if ok else 1
print(f"created with {fails} failure(s)")

if REVOKE and citizen_raw:
    if fails:
        sys.exit("!! not revoking after a failed grant — fix the failures first, then rerun")
    targets = [rec for rec in v2_records(RA_SCHEMA, tok)
               if rec.get("isActive", True) and (rec.get("data") or {}).get("rolecode") == "CITIZEN"
               and (rec.get("data") or {}).get("actionid") == raw_id]
    if not targets:
        sys.exit(f"!! CITIZEN.{raw_id} is visible in the v1 masters but not as an active mdms-v2 record — deactivate it by hand")
    for rec in targets:
        st, r = post(f"/mdms-v2/v2/_update/{RA_SCHEMA}", {"RequestInfo": dict(RI), "Mdms": {**rec, "isActive": False}}, tok)
        ok = st in (200, 202) and not r.get("Errors") and r.get("mdms")
        print(f"  {'OK  ' if ok else 'FAIL'} deactivate CITIZEN.{raw_id} ({rec.get('uniqueIdentifier')}) -> HTTP {st} {json.dumps(r.get('Errors'))[:200] if r.get('Errors') else ''}")
        fails += 0 if ok else 1

masters, roleactions, _ = read_masters()
print("verify: action in actions-test:", any(a.get("id") == ACTION_ID for a in masters["ACCESSCONTROL-ACTIONS-TEST.actions-test"]),
      "| roles granted:", sorted({r["rolecode"] for r in roleactions if r.get("actionid") == ACTION_ID}),
      "| CITIZEN still holds the raw search:", any(r.get("rolecode") == "CITIZEN" and r.get("actionid") == raw_id for r in roleactions))
if TEST_BUSINESS_ID:
    st, r = post(f"{URL}?tenantId={TENANT}&businessIds={urllib.parse.quote(TEST_BUSINESS_ID)}&history=true", {"RequestInfo": dict(RI)}, tok)
    print(f"authorization check as {user} on {TEST_BUSINESS_ID}: HTTP {st} "
          f"{'ACCESS DENIED - access-control cache still stale; wait or restart egov-accesscontrol' if st == 403 else str(r)[:160]}")
sys.exit(1 if fails else 0)
