#!/usr/bin/env python3
"""Seed tenant-specific complaint-hierarchy + city-level boundary data that
`tenant_bootstrap`/`city_setup` do NOT (or did not) create.

Why this script exists: `RAINMAKER-PGR.ComplaintHierarchy` data is deliberately
EXCLUDED from digit-mcp's `tenant_bootstrap` copy-from-pg step (it's
tenant-specific — copying pg's demo complaint types would pollute a real
tenant), so a fresh tenant has the SCHEMA but zero complaint-type rows: the
create-complaint dropdown is empty. Separately, this tenant's `ap.citya` city
boundary hierarchy (definition + City/Ward entities/relationships) was found
missing after `ap`'s original bootstrap — `city_setup` is supposed to create
these at the city tenant level but evidently didn't land for this run.

Both gaps are pure DATA (not code/schema), can't be baked into
`local-setup/db/full-dump.sql` (that dump only ever seeds the `pg` tenant),
and were previously fixed by hand via one-off curl/psql commands. This script
is that fix, made idempotent and rerunnable — safe after a fresh
tenant_bootstrap, after a volume wipe + redeploy, or any time this data goes
missing again.

Idempotent: MDMS rows are create-then-skip-on-duplicate; boundary entities/
relationships are search-then-create. The one known flaky step — boundary
relationship creation is async (Kafka -> egov-persister) and was observed to
silently drop ~1-in-5 creates under load — is handled by polling the search
API after create and falling back to a direct SQL insert (matching the
sibling rows' exact shape) if the row still hasn't landed after the retries.

Env:
  DIGIT_URL           Kong base, e.g. http://127.0.0.1:18000         (required)
  SEED_TENANT         state-root tenant, e.g. ap                     (required)
  SEED_CITY_TENANT    city tenant, e.g. ap.citya                     (required)
  DIGIT_USERNAME      admin username                  (default: ADMIN)
  DIGIT_PASSWORD      admin password                  (default: eGov@123)
  DIGIT_LOGIN_TENANT  tenant to auth against           (default: SEED_TENANT)
  DEPT_GARBAGE        department code for Garbage sub-types  (default: ENV)
  DEPT_STREETLIGHT    department code for StreetLights sub-types (default: WORKS)
  DEPT_ROADS          department code for Roads sub-types    (default: WORKS)
  BOUNDARY_HIERARCHY_TYPE  boundary hierarchyType     (default: ADMIN)
  BOUNDARY_CITY_CODE       city boundary code         (default: CITY_001)
  BOUNDARY_WARD_CODES      comma-separated ward codes (default: WARD_001,WARD_002,WARD_003,WARD_004)
  DB_CONTAINER        postgres container name for the SQL fallback (default: docker-postgres)

Usage:
  DIGIT_URL=http://localhost:18000 SEED_TENANT=ap SEED_CITY_TENANT=ap.citya \\
    python3 local-setup/scripts/seed-tenant-city-data.py
"""
import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

URL = os.environ["DIGIT_URL"].rstrip("/")
TENANT = os.environ["SEED_TENANT"]
CITY_TENANT = os.environ["SEED_CITY_TENANT"]
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
LOGIN_TENANT = os.environ.get("DIGIT_LOGIN_TENANT", TENANT)
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="  # egov-user-client: (empty secret)

DEPT_GARBAGE = os.environ.get("DEPT_GARBAGE", "ENV")
DEPT_STREETLIGHT = os.environ.get("DEPT_STREETLIGHT", "WORKS")
DEPT_ROADS = os.environ.get("DEPT_ROADS", "WORKS")

HIERARCHY_TYPE = os.environ.get("BOUNDARY_HIERARCHY_TYPE", "ADMIN")
CITY_CODE = os.environ.get("BOUNDARY_CITY_CODE", "CITY_001")
WARD_CODES = os.environ.get("BOUNDARY_WARD_CODES", "WARD_001,WARD_002,WARD_003,WARD_004").split(",")

DB_CONTAINER = os.environ.get("DB_CONTAINER", "docker-postgres")

PLACEHOLDER_GEOMETRY = {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]}

# The eGov@123 default is fine for the local-setup convention this script was written for, but
# offers no protection if someone points DIGIT_URL at a non-local deployment without also
# overriding DIGIT_PASSWORD (#1441 review).
if "DIGIT_PASSWORD" not in os.environ and not any(h in URL for h in ("localhost", "127.0.0.1")):
    print(f"WARNING: DIGIT_URL={URL} doesn't look local, but DIGIT_PASSWORD wasn't set — "
          f"using the eGov@123 local-setup default against it. Set DIGIT_PASSWORD explicitly "
          f"if this is a real deployment.", flush=True)


def _post(path, body, timeout=40):
    data = json.dumps(body).encode()
    req = urllib.request.Request(URL + path, data=data, headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)


def token():
    data = urllib.parse.urlencode({
        "grant_type": "password", "username": USERNAME, "password": PASSWORD,
        "tenantId": LOGIN_TENANT, "scope": "read", "userType": "EMPLOYEE"}).encode()
    req = urllib.request.Request(URL + "/user/oauth/token", data=data,
        headers={"Authorization": BASIC, "Content-Type": "application/x-www-form-urlencoded"})
    resp = json.load(urllib.request.urlopen(req, timeout=40))
    return resp["access_token"], resp["UserRequest"]["uuid"]


def ri(tok, uuid, tenant):
    return {"RequestInfo": {
        "apiId": "seed-tenant-city-data", "authToken": tok,
        "userInfo": {"id": 1, "uuid": uuid, "userName": USERNAME, "type": "EMPLOYEE",
                     "roles": [{"code": "MDMS_ADMIN", "name": "MDMS Admin", "tenantId": tenant},
                               {"code": "SUPERUSER", "name": "Super User", "tenantId": tenant}],
                     "tenantId": tenant}}}


# ---------- MDMS schema + data (ComplaintHierarchy / ComplaintHierarchyDefinition) ----------

def schema_exists(tok, uuid, tenant, code):
    body = ri(tok, uuid, tenant)
    body["SchemaDefCriteria"] = {"tenantId": tenant, "codes": [code]}
    try:
        r = json.load(_post("/mdms-v2/schema/v1/_search", body))
        return bool(r.get("SchemaDefinitions"))
    except urllib.error.HTTPError:
        return False


def create_schema(tok, uuid, tenant, code, description, definition):
    body = ri(tok, uuid, tenant)
    body["SchemaDefinition"] = {"tenantId": tenant, "code": code, "description": description,
                                 "isActive": True, "definition": definition}
    _post("/mdms-v2/schema/v1/_create", body).read()


def mdms_row_exists(tok, uuid, tenant, code, unique_id):
    body = ri(tok, uuid, tenant)
    body["MdmsCriteria"] = {"tenantId": tenant, "schemaCode": code, "uniqueIdentifiers": [unique_id]}
    try:
        r = json.load(_post("/mdms-v2/v2/_search", body))
        return bool(r.get("mdms"))
    except urllib.error.HTTPError:
        return False


def create_mdms_row(tok, uuid, tenant, code, unique_id, data):
    if mdms_row_exists(tok, uuid, tenant, code, unique_id):
        return "exists"
    body = ri(tok, uuid, tenant)
    body["Mdms"] = {"tenantId": tenant, "schemaCode": code, "uniqueIdentifier": unique_id,
                     "isActive": True, "data": data}
    try:
        _post("/mdms-v2/v2/_create/" + code, body).read()
        return "created"
    except urllib.error.HTTPError as e:
        blob = e.read().decode()[:200]
        if "DUPLICATE" in blob.upper():
            return "exists"
        print("    ! %s/%s FAILED: HTTP %s %s" % (code, unique_id, e.code, blob))
        return "failed"


COMPLAINT_HIERARCHY_DEFINITION_SCHEMA = {
    "type": "object", "title": "Complaint Hierarchy Definition",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "required": ["hierarchyType", "levels"], "x-unique": ["hierarchyType"],
    "properties": {
        "hierarchyType": {"type": "string"}, "active": {"type": "boolean"},
        "levels": {"type": "array", "minItems": 1, "items": {
            "type": "object", "required": ["levelCode", "order"],
            "properties": {
                "levelCode": {"type": "string"}, "order": {"type": "number"},
                "parentLevel": {"type": ["string", "null"]}, "isFreeText": {"type": "boolean"},
                "isLeafServiceCode": {"type": "boolean"}, "label": {"type": "string"},
            }, "additionalProperties": False,
        }},
    }, "x-ref-schema": [], "additionalProperties": False,
}

COMPLAINT_HIERARCHY_SCHEMA = {
    "type": "object", "title": "Complaint Hierarchy",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "required": ["hierarchyType", "levelCode", "code", "name"],
    "x-unique": ["hierarchyType", "code"],
    "properties": {
        "hierarchyType": {"type": "string"}, "levelCode": {"type": "string"},
        "code": {"type": "string"}, "parentCode": {"type": ["string", "null"]},
        "name": {"type": "string"}, "order": {"type": "number"}, "active": {"type": "boolean"},
        "path": {"type": "string"}, "department": {"type": "string"},
        "departments": {"type": "array", "items": {"type": "string"}},
        "slaHours": {"type": "number"}, "keywords": {"type": "string"},
    }, "x-ref-schema": [], "additionalProperties": False,
}

COMPLAINT_HIERARCHY_DEFINITION_DATA = {
    "hierarchyType": "PGR", "active": True,
    "levels": [
        {"levelCode": "CATEGORY", "order": 1, "parentLevel": None, "isFreeText": False,
         "isLeafServiceCode": False, "label": "Category"},
        {"levelCode": "SUB_TYPE", "order": 2, "parentLevel": "CATEGORY", "isFreeText": False,
         "isLeafServiceCode": True, "label": "Sub-Type"},
    ],
}


def complaint_hierarchy_rows():
    """3 categories + 7 leaf sub-types. department codes come from DEPT_* env vars
    so this maps onto whatever department master the target tenant actually has."""
    return [
        {"hierarchyType": "PGR", "levelCode": "CATEGORY", "code": "Garbage", "parentCode": None,
         "name": "Garbage", "order": 1, "active": True, "path": "Garbage"},
        {"hierarchyType": "PGR", "levelCode": "CATEGORY", "code": "StreetLights", "parentCode": None,
         "name": "Street Lights", "order": 2, "active": True, "path": "StreetLights"},
        {"hierarchyType": "PGR", "levelCode": "CATEGORY", "code": "RoadsAndPavements", "parentCode": None,
         "name": "Roads and Pavements", "order": 3, "active": True, "path": "RoadsAndPavements"},

        {"hierarchyType": "PGR", "levelCode": "SUB_TYPE", "code": "BurningOfGarbage", "parentCode": "Garbage",
         "name": "Burning of garbage", "order": 1, "active": True, "path": "Garbage.BurningOfGarbage",
         "department": DEPT_GARBAGE, "departments": [DEPT_GARBAGE], "slaHours": 336,
         "keywords": "garbage, remove, burn, fire, health, waste, smoke, plastic, illegal"},
        {"hierarchyType": "PGR", "levelCode": "SUB_TYPE", "code": "DamagedGarbageBin", "parentCode": "Garbage",
         "name": "Damaged garbage bin", "order": 2, "active": True, "path": "Garbage.DamagedGarbageBin",
         "department": DEPT_GARBAGE, "departments": [DEPT_GARBAGE], "slaHours": 336,
         "keywords": "garbage, waste, bin, dustbin, clean, remove, sanitation, overflow, smell, health"},
        {"hierarchyType": "PGR", "levelCode": "SUB_TYPE", "code": "GarbageNeedsTobeCleared", "parentCode": "Garbage",
         "name": "Garbage needs to be cleared", "order": 3, "active": True,
         "path": "Garbage.GarbageNeedsTobeCleared", "department": DEPT_GARBAGE, "departments": [DEPT_GARBAGE],
         "slaHours": 336, "keywords": "garbage, collect, litter, clean, waste, remove, sanitation, dump, health"},

        {"hierarchyType": "PGR", "levelCode": "SUB_TYPE", "code": "StreetLightNotWorking", "parentCode": "StreetLights",
         "name": "Streetlight not working", "order": 1, "active": True,
         "path": "StreetLights.StreetLightNotWorking", "department": DEPT_STREETLIGHT,
         "departments": [DEPT_STREETLIGHT], "slaHours": 336,
         "keywords": "streetlight, light, repair, pole, electric, power, fix"},
        {"hierarchyType": "PGR", "levelCode": "SUB_TYPE", "code": "NoStreetlight", "parentCode": "StreetLights",
         "name": "No streetlight", "order": 2, "active": True, "path": "StreetLights.NoStreetlight",
         "department": DEPT_STREETLIGHT, "departments": [DEPT_STREETLIGHT], "slaHours": 336,
         "keywords": "streetlight, light, repair, pole, electric, power, damage, fix"},

        {"hierarchyType": "PGR", "levelCode": "SUB_TYPE", "code": "PotholeOnRoad", "parentCode": "RoadsAndPavements",
         "name": "Pothole on road", "order": 1, "active": True, "path": "RoadsAndPavements.PotholeOnRoad",
         "department": DEPT_ROADS, "departments": [DEPT_ROADS], "slaHours": 336,
         "keywords": "road, pothole, damage, repair, tar, asphalt"},
        {"hierarchyType": "PGR", "levelCode": "SUB_TYPE", "code": "DamagedFootpath", "parentCode": "RoadsAndPavements",
         "name": "Damaged footpath", "order": 2, "active": True, "path": "RoadsAndPavements.DamagedFootpath",
         "department": DEPT_ROADS, "departments": [DEPT_ROADS], "slaHours": 336,
         "keywords": "footpath, pavement, damage, repair, sidewalk"},
    ]


def seed_complaint_hierarchy(tok, uuid):
    print("--- ComplaintHierarchy(Definition) schema ---")
    for code, desc, defn in [
        ("RAINMAKER-PGR.ComplaintHierarchyDefinition",
         "Declares the ORDERED, CONFIGURABLE levels of a complaint-type hierarchy for a tenant.",
         COMPLAINT_HIERARCHY_DEFINITION_SCHEMA),
        ("RAINMAKER-PGR.ComplaintHierarchy",
         "Single adjacency-list master for the whole complaint-type tree.",
         COMPLAINT_HIERARCHY_SCHEMA),
    ]:
        if schema_exists(tok, uuid, TENANT, code):
            print("  schema EXISTS  %s" % code)
        else:
            create_schema(tok, uuid, TENANT, code, desc, defn)
            print("  schema CREATED %s" % code)
    time.sleep(2)

    rows = complaint_hierarchy_rows()
    total_failed = 0
    for tenant in [TENANT, CITY_TENANT]:
        print("--- ComplaintHierarchy(Definition) data: %s ---" % tenant)
        r = create_mdms_row(tok, uuid, tenant, "RAINMAKER-PGR.ComplaintHierarchyDefinition", "PGR",
                             COMPLAINT_HIERARCHY_DEFINITION_DATA)
        print("  definition: %s" % r)
        counts = {"created": 0, "exists": 0, "failed": 0}
        for row in rows:
            uid = "PGR." + row["code"]
            counts[create_mdms_row(tok, uuid, tenant, "RAINMAKER-PGR.ComplaintHierarchy", uid, row)] += 1
        print("  rows: %d created, %d already existed, %d failed" %
              (counts["created"], counts["exists"], counts["failed"]))
        total_failed += counts["failed"]
    return total_failed


# ---------- Boundary: hierarchy definition + City/Ward entities/relationships ----------

def boundary_hierarchy_def_exists(tok, tenant):
    body = {"RequestInfo": {"apiId": "seed-tenant-city-data", "authToken": tok},
            "BoundaryTypeHierarchySearchCriteria": {"tenantId": tenant, "hierarchyType": HIERARCHY_TYPE}}
    try:
        r = json.load(_post("/boundary-service/boundary-hierarchy-definition/_search", body))
        return (r.get("totalCount") or 0) > 0
    except urllib.error.HTTPError:
        return False


def create_boundary_hierarchy_def(tok, tenant, levels):
    body = {"RequestInfo": {"apiId": "seed-tenant-city-data", "authToken": tok},
            "BoundaryHierarchy": {"tenantId": tenant, "hierarchyType": HIERARCHY_TYPE, "boundaryHierarchy": levels}}
    _post("/boundary-service/boundary-hierarchy-definition/_create", body).read()


def boundary_entity_exists(tenant, code):
    body = {"RequestInfo": {"apiId": "seed-tenant-city-data"}}
    try:
        r = json.load(_post("/boundary-service/boundary/_search?tenantId=%s&codes=%s" % (tenant, code), body))
        return bool(r.get("Boundary"))
    except urllib.error.HTTPError:
        return False


def create_boundary_entities(tok, tenant, codes):
    to_create = [c for c in codes if not boundary_entity_exists(tenant, c)]
    if not to_create:
        print("  boundary entities: all %d already exist" % len(codes))
        return
    body = {"RequestInfo": {"apiId": "seed-tenant-city-data", "authToken": tok},
            "Boundary": [{"code": c, "tenantId": tenant, "geometry": PLACEHOLDER_GEOMETRY} for c in to_create]}
    _post("/boundary-service/boundary/_create", body).read()
    print("  boundary entities: created %s" % to_create)


def boundary_relationship_tree(tenant):
    body = {"RequestInfo": {"apiId": "seed-tenant-city-data"}}
    try:
        r = json.load(_post(
            "/boundary-service/boundary-relationships/_search?tenantId=%s&hierarchyType=%s&includeChildren=true"
            % (tenant, HIERARCHY_TYPE), body))
        if "Errors" in r:
            return set()
        codes = set()
        def walk(items):
            for it in items:
                codes.add(it.get("code"))
                walk(it.get("children") or [])
        for t in r.get("TenantBoundary", []):
            walk(t.get("boundary", []))
        return codes
    except urllib.error.HTTPError:
        return set()


def create_boundary_relationship(tok, tenant, code, btype, parent):
    body = {"RequestInfo": {"apiId": "seed-tenant-city-data", "authToken": tok},
            "BoundaryRelationship": {"code": code, "tenantId": tenant, "hierarchyType": HIERARCHY_TYPE,
                                     "boundaryType": btype, "parent": parent}}
    _post("/boundary-service/boundary-relationships/_create", body).read()


def sql_insert_boundary_relationship(tenant, code, btype, parent, path):
    """Fallback for the observed Kafka/persister flakiness: boundary-relationships/_create
    returns 202 (accepted) and is consumed (offset advances, lag 0) but the row sometimes
    never lands — direct insert, matching the exact column shape of a sibling row.

    Values are passed as psql `-v` variables and substituted via `:'var'` (psql's quoted-literal
    form, which escapes embedded quotes/backslashes) rather than formatted directly into the SQL
    string — env-derived values (tenant/code/parent/path) containing a `'` would otherwise break
    out of the string literal and corrupt the statement (#1441 review)."""
    ts = int(time.time() * 1000)
    sql = (
        "INSERT INTO boundary_relationship "
        "(id, tenantid, code, hierarchytype, boundarytype, parent, ancestralmaterializedpath, "
        "createdtime, createdby, lastmodifiedtime, lastmodifiedby) "
        "VALUES (gen_random_uuid()::text, :'tenant', :'code', :'htype', :'btype', %s, %s, %d, 'system', %d, 'system') "
        "ON CONFLICT (tenantid, code, hierarchytype) DO NOTHING;"
        % (":'parent'" if parent else "NULL", ":'path'" if path else "NULL", ts, ts)
    )
    cmd = ["docker", "exec", DB_CONTAINER, "psql", "-U", "egov", "-d", "egov",
           "-v", "tenant=" + tenant, "-v", "code=" + code, "-v", "htype=" + HIERARCHY_TYPE, "-v", "btype=" + btype]
    if parent:
        cmd += ["-v", "parent=" + parent]
    if path:
        cmd += ["-v", "path=" + path]
    cmd += ["-c", sql]
    subprocess.run(cmd, check=True)


def seed_city_boundary(tok):
    print("--- boundary hierarchy definition: %s ---" % CITY_TENANT)
    if boundary_hierarchy_def_exists(tok, CITY_TENANT):
        print("  EXISTS")
    else:
        create_boundary_hierarchy_def(tok, CITY_TENANT, [
            {"boundaryType": "City", "parentBoundaryType": None, "active": True},
            {"boundaryType": "Ward", "parentBoundaryType": "City", "active": True},
        ])
        print("  CREATED (City -> Ward)")

    all_codes = [CITY_CODE] + WARD_CODES
    print("--- boundary entities: %s ---" % CITY_TENANT)
    create_boundary_entities(tok, CITY_TENANT, all_codes)

    print("--- boundary relationships: %s ---" % CITY_TENANT)
    existing = boundary_relationship_tree(CITY_TENANT)
    plan = [(CITY_CODE, "City", None, CITY_CODE)]
    for w in WARD_CODES:
        plan.append((w, "Ward", CITY_CODE, "%s.%s" % (CITY_CODE, w)))

    still_missing = []
    for code, btype, parent, path in plan:
        if code in existing:
            print("  %s: exists" % code)
            continue
        create_boundary_relationship(tok, CITY_TENANT, code, btype, parent)
        landed = False
        for attempt in range(5):
            time.sleep(2)
            if code in boundary_relationship_tree(CITY_TENANT):
                landed = True
                break
        if landed:
            print("  %s: created (confirmed)" % code)
        else:
            print("  %s: create accepted but never landed after 5 retries — falling back to direct SQL" % code)
            sql_insert_boundary_relationship(CITY_TENANT, code, btype, parent, path)
            if code in boundary_relationship_tree(CITY_TENANT):
                print("  %s: created via SQL fallback (confirmed)" % code)
            else:
                print("  ! %s: STILL missing after SQL fallback — investigate manually" % code)
                still_missing.append(code)
    return still_missing


def main():
    print("seed-tenant-city-data: tenant=%s city=%s url=%s" % (TENANT, CITY_TENANT, URL))
    tok, uuid = token()
    failed_rows = seed_complaint_hierarchy(tok, uuid)
    still_missing = seed_city_boundary(tok)
    if failed_rows or still_missing:
        raise RuntimeError(
            "seed-tenant-city-data: incomplete — %d ComplaintHierarchy row(s) failed, "
            "boundary relationship(s) still missing after SQL fallback: %s"
            % (failed_rows, still_missing or "none")
        )
    print("done.")


if __name__ == "__main__":
    main()
