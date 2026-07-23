#!/usr/bin/env python3
"""Seed a single OOTB theme (schema + one ThemeConfig data row) at a tenant —
the standalone, idempotent equivalent of what DDH's MdmsBulkLoader does inside
a full tenant bootstrap, scoped to JUST the theme. Modeled directly on
seed-notifications.py (same shape, same idempotency guarantees).

Single source of truth: reads the SAME committed JSON that ships in the
default-data-handler image for the schema, and one of the committed OOTB
preset files for the data —
  schema: utilities/default-data-handler/src/main/resources/schema/common-masters.json
  data:   digit-ui-esbuild/src/theme/presets/<preset>.json  (e.g. bomet-blue.json)

Creates the common-masters.ThemeConfig schema (if absent) then the theme row
at the given tenant via MDMS v2. Idempotent: schema is search-then-create;
a duplicate data row is rejected by MDMS's x-unique "code" key (phantom-200)
and skipped. Safe to re-run.

isActive is NOT server-enforced-exclusive within a tenant scope — MDMS will
happily let two ThemeConfig rows sit active side by side, and the frontend
just takes whichever one it's handed first (see digitInitData in
packages/libraries/src/services/molecules/Store/service.js). So before
creating the new row, this script finds any OTHER active ThemeConfig row at
the tenant and deactivates it, so re-running or swapping presets never
leaves two active-looking themes.

Env:
  DIGIT_URL          Kong base, e.g. http://127.0.0.1:18000        (required)
  THEME_TENANT       tenant to seed at (state root or city, e.g. ke, ke.bomet) (required)
  DIGIT_USERNAME     admin username         (default: ADMIN)
  DIGIT_PASSWORD     admin password         (default: eGov@123)
  DIGIT_LOGIN_TENANT tenant to auth against (default: $THEME_TENANT)
  SCHEMA_FILE        path to common-masters.json schema list
  DATA_FILE          path to the one preset JSON to seed (e.g. bomet-blue.json)
"""
import os, sys, json, time, urllib.request, urllib.parse, urllib.error

URL = os.environ["DIGIT_URL"].rstrip("/")
TENANT = os.environ["THEME_TENANT"]
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
LOGIN_TENANT = os.environ.get("DIGIT_LOGIN_TENANT", TENANT)
_here = os.path.dirname(os.path.abspath(__file__))
SCHEMA_FILE = os.environ.get("SCHEMA_FILE", os.path.join(_here, "theme-seed", "common-masters.json"))
DATA_FILE = os.environ.get("DATA_FILE", os.path.join(_here, "theme-seed", "bomet-blue.json"))
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="  # egov-user-client: (empty secret)

THEME_CODE = "common-masters.ThemeConfig"


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
    return {"RequestInfo": {"apiId": "theme-seed", "authToken": tok}}


def schema_exists(tok, code):
    body = ri(tok); body["SchemaDefCriteria"] = {"tenantId": TENANT, "codes": [code]}
    try:
        r = json.load(_post("/mdms-v2/schema/v1/_search", body, tok))
        return bool(r.get("SchemaDefinitions"))
    except urllib.error.HTTPError:
        return False


def create_schema(tok, sdef):
    sdef = dict(sdef); sdef["tenantId"] = TENANT
    # Same MDMS quirk seed-notifications.py works around: an empty
    # "x-ref-schema": [] mangles to {} on storage and crashes every
    # subsequent data create. This schema never sets x-ref-schema, but
    # strip it defensively if a future edit adds one.
    defn = dict(sdef.get("definition") or {})
    if defn.get("x-ref-schema") == []:
        defn.pop("x-ref-schema", None)
        sdef["definition"] = defn
    body = ri(tok); body["SchemaDefinition"] = sdef
    _post("/mdms-v2/schema/v1/_create", body, tok).read()


def search_rows(tok, code):
    body = ri(tok)
    body["MdmsCriteria"] = {"tenantId": TENANT, "schemaCode": code, "limit": 200}
    try:
        r = json.load(_post("/mdms-v2/v2/_search", body, tok))
        return r.get("mdms", [])
    except urllib.error.HTTPError:
        return []


def deactivate(tok, code, row):
    # MDMS v2's _update rejects the request outright (AUDIT_DETAILS_ABSENT_ERR)
    # unless the row's own auditDetails is echoed back verbatim.
    body = ri(tok)
    body["Mdms"] = {
        "tenantId": TENANT, "schemaCode": code,
        "uniqueIdentifier": row.get("uniqueIdentifier"), "id": row.get("id"),
        "data": row.get("data"), "isActive": False,
        "auditDetails": row.get("auditDetails"),
    }
    try:
        _post("/mdms-v2/v2/_update/" + code, body, tok).read()
        return True
    except urllib.error.HTTPError as e:
        # Non-fatal: creating the new theme is the goal of this run; leaving
        # a stale theme active is a (loudly reported) degradation, not a
        # reason to abort the whole seed.
        print("    ! could not deactivate %s: HTTP %s %s" % (
            (row.get("data") or {}).get("code"), e.code, e.read().decode()[:160]))
        return False


def create_row(tok, code, row_code, data):
    body = ri(tok)
    body["Mdms"] = {"tenantId": TENANT, "schemaCode": code, "data": data, "isActive": True}
    try:
        _post("/mdms-v2/v2/_create/" + code, body, tok).read()
        return "created"
    except urllib.error.HTTPError as e:
        blob = e.read().decode()[:160]
        if e.code in (400, 409) and ("DUPLICATE" in blob.upper() or "ALREADY" in blob.upper()):
            return "dup"
        print("    ! %s row FAILED (%s): HTTP %s %s" % (code, row_code, e.code, blob))
        return "failed"


def main():
    print("seed-theme: tenant=%s url=%s" % (TENANT, URL))
    tok = token()

    schemas = {s.get("code"): s for s in json.load(open(SCHEMA_FILE))}
    if THEME_CODE not in schemas:
        sys.exit("ERROR: schema %s not found in %s" % (THEME_CODE, SCHEMA_FILE))
    if schema_exists(tok, THEME_CODE):
        print("  schema EXISTS  %s" % THEME_CODE)
    else:
        create_schema(tok, schemas[THEME_CODE])
        print("  schema CREATED %s" % THEME_CODE)
    time.sleep(3)  # let the schema definition settle before data validates against it

    preset = json.load(open(DATA_FILE))
    preset_code = preset.get("code")
    if not preset_code:
        sys.exit("ERROR: preset file %s has no 'code' field" % DATA_FILE)

    # Deactivate any OTHER active ThemeConfig row at this tenant so re-runs
    # or preset swaps never leave two "active" themes fighting over
    # ThemeConfig?.[0] on the frontend.
    existing = search_rows(tok, THEME_CODE)
    deactivated = 0
    for row in existing:
        row_code = (row.get("data") or {}).get("code")
        if row.get("isActive") and row_code != preset_code:
            if deactivate(tok, THEME_CODE, row):
                deactivated += 1
                print("  deactivated stale active theme: %s" % row_code)

    result = create_row(tok, THEME_CODE, preset_code, preset)
    print("  data %-30s -> %s" % (preset_code, result))

    time.sleep(2)
    rows = search_rows(tok, THEME_CODE)
    active = [r for r in rows if r.get("isActive")]
    print("verify (tenant=%s): %d ThemeConfig row(s), %d active" % (TENANT, len(rows), len(active)))
    ok = result in ("created", "dup") and any((r.get("data") or {}).get("code") == preset_code for r in active)
    print("DONE" if ok else "DONE (with warnings)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
