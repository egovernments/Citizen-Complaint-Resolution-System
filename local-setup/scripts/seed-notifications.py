#!/usr/bin/env python3
"""Seed the config-driven PGR notification MDMS masters (schema + data), scoped to
JUST the notification configs — the standalone, idempotent equivalent of what DDH's
MdmsBulkLoader does inside a full tenant bootstrap.

Single source of truth: reads the SAME committed JSON that ships in the
default-data-handler image —
  schema:  utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json
  data:    utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/
            RAINMAKER-PGR.Notification{Routing,Template,ProviderTemplate}.json

Creates the 3 schemas then their rows at the state-root tenant via MDMS v2. Idempotent:
schemas are search-then-create; duplicate data rows are rejected by MDMS x-unique keys
(phantom-200) and skipped. Safe to re-run — this is what makes both "fresh install" and
"add-on to an existing deploy" work from the one task.

Env:
  DIGIT_URL          Kong base, e.g. http://127.0.0.1:18000        (required)
  NOTIF_TENANT       tenant to seed at (state root, e.g. ke)       (required)
  DIGIT_USERNAME     admin username         (default: ADMIN)
  DIGIT_PASSWORD     admin password         (default: eGov@123)
  DIGIT_LOGIN_TENANT tenant to auth against (default: $NOTIF_TENANT)
  SCHEMA_FILE        path to RAINMAKER-PGR.json schema list
  DATA_DIR           dir holding the 3 RAINMAKER-PGR.Notification*.json data files
"""
import os, sys, json, time, urllib.request, urllib.parse, urllib.error

URL = os.environ["DIGIT_URL"].rstrip("/")
TENANT = os.environ["NOTIF_TENANT"]
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
LOGIN_TENANT = os.environ.get("DIGIT_LOGIN_TENANT", TENANT)
_here = os.path.dirname(os.path.abspath(__file__))
SCHEMA_FILE = os.environ.get("SCHEMA_FILE", os.path.join(_here, "notification-seed", "RAINMAKER-PGR.json"))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(_here, "notification-seed"))
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="  # egov-user-client: (empty secret)

NOTIF_CODES = [
    "RAINMAKER-PGR.NotificationRouting",
    "RAINMAKER-PGR.NotificationTemplate",
    "RAINMAKER-PGR.NotificationProviderTemplate",
]


def _post(path, body, tok=None, headers=None):
    data = json.dumps(body).encode()
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(URL + path, data=data, headers=h)
    return urllib.request.urlopen(req, timeout=40)


def token():
    data = urllib.parse.urlencode({
        "grant_type": "password", "username": USERNAME, "password": PASSWORD,
        "tenantId": LOGIN_TENANT, "scope": "read", "userType": "EMPLOYEE"}).encode()
    req = urllib.request.Request(URL + "/user/oauth/token", data=data,
        headers={"Authorization": BASIC, "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=40))["access_token"]


def ri(tok):
    return {"RequestInfo": {"apiId": "notif-seed", "authToken": tok}}


def schema_exists(tok, code):
    body = ri(tok); body["SchemaDefCriteria"] = {"tenantId": TENANT, "codes": [code]}
    try:
        r = json.load(_post("/mdms-v2/schema/v1/_search", body, tok))
        return bool(r.get("SchemaDefinitions"))
    except urllib.error.HTTPError:
        return False


def create_schema(tok, sdef):
    sdef = dict(sdef); sdef["tenantId"] = TENANT
    body = ri(tok); body["SchemaDefinition"] = sdef
    _post("/mdms-v2/schema/v1/_create", body, tok).read()


def create_row(tok, code, row):
    body = ri(tok)
    body["Mdms"] = {"tenantId": TENANT, "schemaCode": code, "data": row,
                    "isActive": bool(row.get("active", row.get("isActive", True)))}
    try:
        _post("/mdms-v2/v2/_create/" + code, body, tok).read()
        return "created"
    except urllib.error.HTTPError as e:
        blob = e.read().decode()[:160]
        if e.code in (400, 409) and ("DUPLICATE" in blob.upper() or "ALREADY" in blob.upper()):
            return "dup"
        # Resilient: log + skip a failing row rather than aborting the whole seed,
        # so the core masters still land. main() surfaces failures + the exit code.
        print("    ! %s row FAILED: HTTP %s %s" % (code, e.code, blob))
        return "failed"


def count_rows(tok, code):
    body = ri(tok)
    body["MdmsCriteria"] = {"tenantId": TENANT, "schemaCode": code, "limit": 200}
    try:
        # mdms-v2 _search takes the schemaCode in the BODY (not the path — that
        # path variant silently returns 0). Same quirk the configurator hit.
        r = json.load(_post("/mdms-v2/v2/_search", body, tok))
        return len(r.get("mdms", []))
    except urllib.error.HTTPError:
        return -1


def main():
    print("seed-notifications: tenant=%s url=%s" % (TENANT, URL))
    tok = token()

    schemas = {s.get("code"): s for s in json.load(open(SCHEMA_FILE))}
    for code in NOTIF_CODES:
        if code not in schemas:
            sys.exit("ERROR: schema %s not found in %s" % (code, SCHEMA_FILE))
        if schema_exists(tok, code):
            print("  schema EXISTS  %s" % code)
        else:
            create_schema(tok, schemas[code])
            print("  schema CREATED %s" % code)
    time.sleep(3)  # let schema definitions settle before data validates against them

    total_created = total_dup = 0
    failed_masters = []
    for code in NOTIF_CODES:
        path = os.path.join(DATA_DIR, code + ".json")
        rows = json.load(open(path))
        c = d = f = 0
        for row in rows:
            r = create_row(tok, code, row)
            c += (r == "created"); d += (r == "dup"); f += (r == "failed")
        total_created += c; total_dup += d
        if f:
            failed_masters.append(code)
        print("  data %-45s +%d created, %d already-present, %d FAILED (%d in file)" % (code, c, d, f, len(rows)))

    time.sleep(3)
    print("verify (tenant=%s):" % TENANT)
    for code in NOTIF_CODES:
        print("  %-45s %s rows" % (code, count_rows(tok, code)))
    # Core = Routing + Template (who + what). ProviderTemplate is the WhatsApp
    # ContentSid layer (a follow-up); a failure there is a WARNING, not fatal to the
    # install — the deploy still gets working config-driven SMS/Email notifications.
    core_failed = [c for c in failed_masters if c != "RAINMAKER-PGR.NotificationProviderTemplate"]
    note = ""
    if failed_masters:
        note = "  WARNING: failures in %s" % ", ".join(m.split(".")[-1] for m in failed_masters)
    print("DONE: %d created, %d already-present.%s" % (total_created, total_dup, note))
    sys.exit(2 if core_failed else 0)
    sys.exit(0 if ok else 2)


if __name__ == "__main__":
    main()
