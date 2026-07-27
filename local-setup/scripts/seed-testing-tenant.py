#!/usr/bin/env python3
"""Seed the hidden TESTING tenant for the /testing-ui entrance.

Run by the deploy playbook when `testing_ui_enabled: true` (idempotent —
every create treats an already-exists/duplicate response as success), or by
hand:

    DIGIT_BASE=http://localhost TESTING_TENANT=mz.igetesting \
    SOURCE_TENANT=mz.ige STATE_TENANT=mz \
    ADMIN_USER=ADMIN ADMIN_PASS='eGov@123' \
    python3 seed-testing-tenant.py

What it seeds (all ADDITIVE — no prod record is modified):
  MDMS  : tenant.tenants row, tenant.citymodule membership (PGR+HRMS),
          RAINMAKER-PGR.ComplaintRelatedToMap row (code <TESTING_CODE>),
          RAINMAKER-PGR.ComplaintTemplateType clone (extendedAttributes
          validation reads it at create), RAINMAKER-PGR.MapConfig
          (boundaryTenantId = the testing tenant), common-masters.IdFormat
          (TST- complaint prefix), common-masters.Department +
          Designation clones (HRMS validates them per tenant).
  BOUNDARY: hierarchy definition + full relationship tree + geometry
          copied from SOURCE_TENANT.
  LOC   : boundary-label module copied to the testing tenant (labels load
          at the TREE's tenant); entrance labels at the state tenant.
  HRMS  : 4 test employees (reception/screening/supervisor/case manager),
          password eGov@123 — CHANGE ON REAL DEPLOYMENTS via TEST_EMP_PASS.

Deliberately NOT seeded: NotificationRouting/Template (no SMS/email ever
fires from the testing tenant) and any DSS/dashboard config.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = os.environ.get("DIGIT_BASE", "http://localhost")
T = os.environ.get("TESTING_TENANT", "mz.igetesting")
SRC = os.environ.get("SOURCE_TENANT", "mz.ige")
STATE = os.environ.get("STATE_TENANT", "mz")
CODE = os.environ.get("TESTING_CODE", "IGETESTING")
HIER = os.environ.get("HIERARCHY_TYPE", "divisao_administrativa")
ADMIN_USER = os.environ.get("ADMIN_USER", "ADMIN")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "eGov@123")
EMP_PASS = os.environ.get("TEST_EMP_PASS", "eGov@123")

CHANGED = False


def call(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return {"HTTPError": e.code, "body": e.read().decode()[:400]}


def ok_or_dup(r, label):
    """Create responses: success OR already-exists both count as seeded."""
    global CHANGED
    status = r.get("ResponseInfo", {}).get("status")
    if status == "successful":
        CHANGED = True
        print(f"CREATED {label}")
        return True
    body = r.get("body", "")
    if r.get("HTTPError") and ("DUPLICATE" in body or "already exist" in body.lower() or "unique" in body.lower()):
        print(f"exists  {label}")
        return True
    print(f"FAILED  {label}: {r}", file=sys.stderr)
    return False


def auth():
    data = urllib.parse.urlencode({
        "username": ADMIN_USER, "password": ADMIN_PASS, "grant_type": "password",
        "scope": "read", "tenantId": STATE, "userType": "EMPLOYEE"}).encode()
    req = urllib.request.Request(BASE + "/user/oauth/token", data=data, headers={
        "Authorization": "Basic ZWdvdi11c2VyLWNsaWVudDo=",
        "Content-Type": "application/x-www-form-urlencoded"})
    d = json.load(urllib.request.urlopen(req))
    return {"authToken": d["access_token"], "userInfo": d["UserRequest"]}


RI = auth()


def mdms_rows(schema, tenant, limit=200):
    return call("/mdms-v2/v2/_search", {"RequestInfo": RI, "MdmsCriteria": {
        "tenantId": tenant, "schemaCode": schema, "limit": limit}}).get("mdms", [])


def mdms_create(schema, tenant, uid, data):
    return ok_or_dup(call(f"/mdms-v2/v2/_create/{schema}", {"RequestInfo": RI, "Mdms": {
        "tenantId": tenant, "schemaCode": schema, "uniqueIdentifier": uid,
        "isActive": True, "data": data}}), f"{schema}@{tenant}/{uid}")


def mdms_update(row):
    r = call(f"/mdms-v2/v2/_update/{row['schemaCode']}", {"RequestInfo": RI, "Mdms": row})
    return r.get("ResponseInfo", {}).get("status") == "successful"


# ── 1. tenants row ───────────────────────────────────────────────────────────
existing = {r["data"].get("code") for r in mdms_rows("tenant.tenants", STATE)}
if T not in existing:
    src = [r for r in mdms_rows("tenant.tenants", STATE) if r["data"].get("code") == SRC][0]
    d = dict(src["data"])
    d.update({"code": T, "name": f"{CODE.title()} (Testing)", "tenantId": T,
              "description": "TESTING tenant - QA only, not for production users"})
    d["city"] = {**d.get("city", {}), "code": T.upper(), "name": f"{CODE.title()} (Testing)",
                 "districtTenantCode": T}
    mdms_create("tenant.tenants", STATE, T, d)
else:
    print(f"exists  tenant.tenants/{T}")

# ── 2. citymodule membership ─────────────────────────────────────────────────
for row in mdms_rows("tenant.citymodule", STATE):
    if row["data"].get("code") in ("PGR", "HRMS"):
        codes = [x["code"] for x in row["data"].get("tenants", [])]
        if T not in codes:
            row["data"]["tenants"].append({"code": T})
            if mdms_update(row):
                CHANGED = True
                print(f"UPDATED citymodule/{row['data']['code']} += {T}")
        else:
            print(f"exists  citymodule/{row['data']['code']}")

# ── 3. dispatcher row + template clone ───────────────────────────────────────
crtm = mdms_rows("RAINMAKER-PGR.ComplaintRelatedToMap", STATE)
if not any(r["data"].get("code") == CODE for r in crtm):
    mdms_create("RAINMAKER-PGR.ComplaintRelatedToMap", STATE, CODE, {
        "code": CODE, "name": f"PGR_RELATEDTO_NAME_{CODE}", "active": True,
        "tenantId": STATE, "shortName": CODE, "tenantCode": T, "displayOrder": 99})
else:
    print(f"exists  ComplaintRelatedToMap/{CODE}")

tpls = mdms_rows("RAINMAKER-PGR.ComplaintTemplateType", STATE)
if not any(r["data"].get("caseRelatedTo") == CODE for r in tpls):
    src_tpl = [r for r in tpls if r["data"].get("caseRelatedTo") != CODE][0]
    d = dict(src_tpl["data"]); d["caseRelatedTo"] = CODE
    mdms_create("RAINMAKER-PGR.ComplaintTemplateType", STATE, CODE, d)
else:
    print(f"exists  ComplaintTemplateType/{CODE}")

# ── 4. MapConfig + IdFormat at the testing tenant ────────────────────────────
if not mdms_rows("RAINMAKER-PGR.MapConfig", T):
    base = mdms_rows("RAINMAKER-PGR.MapConfig", STATE)
    d = dict(base[0]["data"]) if base else {"code": "DEFAULT"}
    d["boundaryTenantId"] = T
    mdms_create("RAINMAKER-PGR.MapConfig", T, "DEFAULT", d)
else:
    print("exists  MapConfig")

seq = "SEQ_EG_PGR" + T.replace(".", "").upper()
if not any(r["data"].get("idname") == "pgr.servicerequestid" for r in mdms_rows("common-masters.IdFormat", T)):
    mdms_create("common-masters.IdFormat", T, "pgr.servicerequestid",
                {"format": f"TST-[cy:yyyy]-[{seq}]", "idname": "pgr.servicerequestid"})
else:
    print("exists  IdFormat")

# ── 5. Department + Designation clones (HRMS validates per tenant) ───────────
have_depts = {r["data"].get("code") for r in mdms_rows("common-masters.Department", T)}
src_depts = mdms_rows("common-masters.Department", SRC)
central = [r for r in src_depts if r["data"].get("code") == "central"] or src_depts[:1]
for r in central:
    if r["data"]["code"] not in have_depts:
        mdms_create("common-masters.Department", T, r["uniqueIdentifier"], dict(r["data"]))
have_desig = {r["data"].get("code") for r in mdms_rows("common-masters.Designation", T)}
for r in mdms_rows("common-masters.Designation", SRC):
    if r["data"]["code"] not in have_desig:
        mdms_create("common-masters.Designation", T, r["uniqueIdentifier"], dict(r["data"]))

# ── 6. boundary: definition + tree + geometry copy ───────────────────────────
d = call("/boundary-service/boundary-hierarchy-definition/_search", {"RequestInfo": RI,
        "BoundaryTypeHierarchySearchCriteria": {"tenantId": T, "hierarchyType": HIER, "limit": 1, "offset": 0}})
if not (d.get("BoundaryHierarchy") or []):
    s = call("/boundary-service/boundary-hierarchy-definition/_search", {"RequestInfo": RI,
            "BoundaryTypeHierarchySearchCriteria": {"tenantId": SRC, "hierarchyType": HIER, "limit": 1, "offset": 0}})
    bh = [{"boundaryType": b["boundaryType"], "parentBoundaryType": b.get("parentBoundaryType"), "active": True}
          for b in s["BoundaryHierarchy"][0]["boundaryHierarchy"]]
    call("/boundary-service/boundary-hierarchy-definition/_create", {"RequestInfo": RI,
         "BoundaryHierarchy": {"tenantId": T, "hierarchyType": HIER, "boundaryHierarchy": bh}})
    CHANGED = True
    print("CREATED boundary hierarchy definition")
else:
    print("exists  boundary hierarchy definition")

tree = call(f"/boundary-service/boundary-relationships/_search?tenantId={T}&hierarchyType={HIER}&includeChildren=true",
            {"RequestInfo": RI})
have_nodes = set()
def _walk(n):
    have_nodes.add(n["code"])
    for c in n.get("children") or []:
        _walk(c)
for tb in tree.get("TenantBoundary", []):
    b = tb.get("boundary"); b = b if isinstance(b, list) else ([b] if b else [])
    for root in b:
        _walk(root)

src_tree = call(f"/boundary-service/boundary-relationships/_search?tenantId={SRC}&hierarchyType={HIER}&includeChildren=true",
                {"RequestInfo": RI})
nodes = []
def _collect(n, parent):
    nodes.append({"code": n["code"], "boundaryType": n.get("boundaryType"), "parent": parent})
    for c in n.get("children") or []:
        _collect(c, n["code"])
for tb in src_tree.get("TenantBoundary", []):
    b = tb.get("boundary"); b = b if isinstance(b, list) else ([b] if b else [])
    for root in b:
        _collect(root, None)

missing = [n for n in nodes if n["code"] not in have_nodes]
if missing:
    codes = [n["code"] for n in nodes]
    geo = {}
    for i in range(0, len(codes), 40):
        g = call(f"/boundary-service/boundary/_search?tenantId={SRC}&codes={','.join(codes[i:i+40])}&limit=100",
                 {"RequestInfo": RI})
        for row in g.get("Boundary", []):
            geo[row["code"]] = row.get("geometry")
    ents = [{"tenantId": T, "code": n["code"], "geometry": geo.get(n["code"])} for n in missing]
    for i in range(0, len(ents), 40):
        call("/boundary-service/boundary/_create", {"RequestInfo": RI, "Boundary": ents[i:i+40]})
    made = 0
    for n in missing:  # BFS order — parents before children
        r = call("/boundary-service/boundary-relationships/_create", {"RequestInfo": RI,
                 "BoundaryRelationship": {"tenantId": T, "code": n["code"], "hierarchyType": HIER,
                                          "boundaryType": n["boundaryType"], "parent": n["parent"]}})
        if r.get("TenantBoundary") is not None or (r.get("ResponseInfo") and not r.get("HTTPError")):
            made += 1
    CHANGED = True
    print(f"CREATED boundary tree: {made}/{len(missing)} nodes copied")
else:
    print(f"exists  boundary tree ({len(have_nodes)} nodes)")

# ── 7. localization: boundary labels + entrance labels ───────────────────────
MOD = f"rainmaker-boundary-{HIER}"
for loc in ("pt_PT", "en_IN"):
    msgs = []
    for src_t in (SRC, STATE):
        r = call(f"/localization/messages/v1/_search?tenantId={src_t}&locale={loc}&module={MOD}", {"RequestInfo": RI})
        msgs = r.get("messages", [])
        if msgs:
            break
    if msgs:
        up = [{"code": m["code"], "message": m["message"], "module": MOD, "locale": loc} for m in msgs]
        call("/localization/messages/v1/_upsert", {"RequestInfo": RI, "tenantId": T, "messages": up})
        print(f"seeded  boundary labels {loc}: {len(up)}")
labels = {
    "pt_PT": [(f"TENANT_TENANTS_{T.replace('.', '_').upper()}", f"{CODE.title()} (Ambiente de Teste)"),
              (f"PGR_RELATEDTO_NAME_{CODE}", f"{CODE.title()} (Ambiente de Teste)")],
    "en_IN": [(f"TENANT_TENANTS_{T.replace('.', '_').upper()}", f"{CODE.title()} (Testing)"),
              (f"PGR_RELATEDTO_NAME_{CODE}", f"{CODE.title()} (Testing)")],
}
for loc, pairs in labels.items():
    up = [{"code": c, "message": m, "module": "rainmaker-common", "locale": loc} for c, m in pairs]
    call("/localization/messages/v1/_upsert", {"RequestInfo": RI, "tenantId": STATE, "messages": up})
print("seeded  entrance labels")

# ── 8. HRMS test employees (full CMS chain) ──────────────────────────────────
# username -> (roles, designation, display name). Role-descriptive logins, plus
# one all-roles account (all four workflow roles + CMS_VIEWER, which the PGR
# workflow accepts on nearly every transition) so a single login can walk a
# complaint end-to-end without switching users.
ROLES = {
    "TST_RECEPTION":    (["CMS_RECEPTION_OFFICER"], "reception_officer", "Oficial de Recepcao Teste"),
    "TST_SCREENING":    (["CMS_SCREENING_OFFICER"], "screening_officer", "Oficial de Triagem Teste"),
    "TST_SUPERVISOR":   (["CMS_SUPERVISOR"], "supervisor", "Supervisor Teste"),
    "TST_CASE_MANAGER": (["CMS_CASE_MANAGER"], "case_manager", "Gestor de Caso Teste"),
    "TST_ALL_ROLES":    (["CMS_RECEPTION_OFFICER", "CMS_SCREENING_OFFICER", "CMS_SUPERVISOR",
                          "CMS_CASE_MANAGER", "CMS_VIEWER"], "supervisor", "Testador Geral Teste"),
}
prov = next((n["code"] for n in nodes if n["parent"] is None), None)
now = int(time.time() * 1000)
i = 0
for code, (roles, desig, name) in ROLES.items():
    i += 1
    r = call(f"/egov-hrms/employees/_search?tenantId={T}&codes={code}&limit=2&offset=0", {"RequestInfo": RI})
    if r.get("Employees"):
        print(f"exists  employee {code}")
        continue
    role_objs = [{"code": "EMPLOYEE", "name": "EMPLOYEE", "tenantId": T}] + [
        {"code": rl, "name": rl, "tenantId": T} for rl in roles]
    emp = {"tenantId": T, "code": code, "employeeStatus": "EMPLOYED", "employeeType": "PERMANENT",
           "dateOfAppointment": now - 86400000,
           "user": {"name": name, "userName": code, "password": EMP_PASS, "mobileNumber": f"8477001{i:02d}",
                    "gender": "MALE", "dob": 631152000000, "type": "EMPLOYEE", "tenantId": T,
                    "roles": role_objs},
           "assignments": [{"fromDate": now - 86400000, "toDate": None, "isCurrentAssignment": True,
                            "department": "central", "designation": desig}],
           "jurisdictions": [{"hierarchy": HIER, "boundaryType": "Provincia", "boundary": prov, "tenantId": T}],
           "serviceHistory": [], "education": [], "tests": [], "documents": [],
           "deactivationDetails": [], "reactivationDetails": []}
    r = call("/egov-hrms/employees/_create", {"RequestInfo": RI, "Employees": [emp]})
    if (r.get("Employees") or [{}])[0].get("code"):
        CHANGED = True
        print(f"CREATED employee {code}")
    else:
        print(f"FAILED  employee {code}: {r}", file=sys.stderr)

print("DONE", "CHANGED" if CHANGED else "no-op")
