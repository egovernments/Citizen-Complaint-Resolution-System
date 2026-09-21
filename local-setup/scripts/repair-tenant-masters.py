#!/usr/bin/env python3
"""Verify — and repair — the MDMS masters a freshly bootstrapped tenant is supposed
to inherit from the source tenant (`pg`).

WHY THIS EXISTS
---------------
Creating a tenant copies the state-level masters from `pg` into the new tenant. On a
real fresh deploy that copy comes up SHORT: the new tenant ends up with exactly 500
ACCESSCONTROL-ROLEACTIONS.roleactions rows against 945 at `pg`. A round 500 is a
pagination/limit artefact, not a data difference. The consequence is not subtle:
SUPERUSER and MDMS_ADMIN lose their `/mdms-v2/v2/_create/*` role-actions, so Kong's
fail-closed enforce_rbac 403s every MDMS write the configurator makes, and the tenant
looks "deployed" while being unusable.

WHERE THE BUG IS — and why it is not fixed at the source here
-------------------------------------------------------------
The copy is NOT performed by anything in this repository. The chain is:

  utilities/default-data-handler
    DataHandlerService.createTenantData(...)
      -> MdmsV2Util.createDefaultMdmsData(...)
        -> POST {egov.mdms.host}/mdms-v2/defaultdata/_create   <-- the copy happens HERE

`/mdms-v2/defaultdata/_create` is implemented inside the **mdms-v2 service**, which
this repository consumes as a prebuilt image (`egovio/mdms-v2:maven-jdk21-f3a7c13` in
local-setup/docker-compose.egov-digit.yaml). There is no mdms-v2 source tree under
backend/ — only digit-config-service, digit-user-preferences-service, novu-bridge,
novu-dashboard, pgr-services and xstate-chatbot. So the 500-row limit cannot be
changed from here without guessing at code we do not have.

(For the record, the one paginated loop that IS in this repo —
DataHandlerService.getAllMdmsResults, limit 100 with an offset walk — is correct and
is NOT the truncation. It is only used for the boundary master.)

So this script is the repair, run after bootstrap: compare per-schema row counts
between the source tenant and the new tenant, and copy whatever is missing through
the ordinary MDMS v2 API. It is idempotent — a tenant that bootstrapped completely
reports "0 missing" and writes nothing.

ORDER MATTERS. ACCESSCONTROL-ROLES.roles, then ...ACTIONS-TEST.actions-test, then
...ROLEACTIONS.roleactions are repaired first, because roleactions is both the master
that gets truncated AND the master that grants permission to write the others.

THE CHICKEN-AND-EGG, STATED PLAINLY. The repair goes through Kong like every other
client, so it is itself subject to the truncated permissions it is fixing. If the
admin role kept its `/mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions`
role-action in the surviving 500 rows, the repair works and unblocks everything else.
If it did not, every write 403s and this script exits 3 (RBAC_BLOCKED) with an exact
diagnosis rather than pretending to have succeeded. Recovering from that needs either
a fixed mdms-v2 image or a direct DB insert, and this script will not silently do the
latter.

Env:
  DIGIT_URL          Kong base, e.g. http://127.0.0.1:18000        (required)
  TARGET_TENANT      tenant to verify/repair                       (required)
  SOURCE_TENANT      tenant to copy from            (default: pg)
  DIGIT_USERNAME     admin username                 (default: ADMIN)
  DIGIT_PASSWORD     admin password                 (default: eGov@123)
  DIGIT_LOGIN_TENANT tenant to auth against         (default: $TARGET_TENANT)
  SCHEMA_CODES       comma-separated allow-list     (default: every schema the target has)
  APPLY              1 = copy missing rows, 0 = report only  (default: 1)
  PAGE_LIMIT         MDMS search page size          (default: 100)

Exit: 0 nothing missing / everything repaired · 3 RBAC_BLOCKED · 2 other failures.
"""
import os, sys, json, urllib.request, urllib.parse, urllib.error

URL = os.environ["DIGIT_URL"].rstrip("/")
TARGET = os.environ["TARGET_TENANT"]
SOURCE = os.environ.get("SOURCE_TENANT", "pg")
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
LOGIN_TENANT = os.environ.get("DIGIT_LOGIN_TENANT", TARGET)
APPLY = os.environ.get("APPLY", "1") not in ("0", "false", "no")
PAGE = int(os.environ.get("PAGE_LIMIT", "100"))
ONLY = [c.strip() for c in os.environ.get("SCHEMA_CODES", "").split(",") if c.strip()]
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="

# Repaired first, in this order, for the reason in the docstring.
PRIORITY = [
    "ACCESSCONTROL-ROLES.roles",
    "ACCESSCONTROL-ACTIONS-TEST.actions-test",
    "ACCESSCONTROL-ROLEACTIONS.roleactions",
]

# A tenant-scoped master whose rows legitimately differ between tenants: copying
# `pg`'s rows in would be wrong, not a repair. Everything else is state-level
# reference data that the bootstrap is meant to clone verbatim.
SKIP = {
    "tenant.tenants",
    "tenant.citymodule",
    "egov-location.TenantBoundary",
}


def _post(path, body):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=60)


def token():
    data = urllib.parse.urlencode({
        "grant_type": "password", "username": USERNAME, "password": PASSWORD,
        "tenantId": LOGIN_TENANT, "scope": "read", "userType": "EMPLOYEE"}).encode()
    req = urllib.request.Request(URL + "/user/oauth/token", data=data,
        headers={"Authorization": BASIC, "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=40))["access_token"]


def ri(tok):
    return {"RequestInfo": {"apiId": "tenant-master-repair", "authToken": tok}}


def schema_codes(tok, tenant):
    body = ri(tok); body["SchemaDefCriteria"] = {"tenantId": tenant}
    try:
        r = json.load(_post("/mdms-v2/schema/v1/_search", body))
        return [s.get("code") for s in (r.get("SchemaDefinitions") or []) if s.get("code")]
    except urllib.error.HTTPError as e:
        sys.exit("ERROR: schema search failed for %s: HTTP %s" % (tenant, e.code))


def all_rows(tok, tenant, code):
    """Every row for `code` at `tenant`, walked page by page.

    Never trust one page: mdms-v2 caps a search well below the row counts these
    masters reach (roleactions alone is ~945 at pg), which is the same class of bug
    this script exists to repair. Stop only on a short page.
    """
    out, offset = [], 0
    while True:
        body = ri(tok)
        body["MdmsCriteria"] = {"tenantId": tenant, "schemaCode": code,
                                "limit": PAGE, "offset": offset}
        try:
            r = json.load(_post("/mdms-v2/v2/_search", body))
        except urllib.error.HTTPError as e:
            print("    ! search %s@%s failed: HTTP %s" % (code, tenant, e.code))
            return out, False
        page = r.get("mdms") or []
        out.extend(page)
        if len(page) < PAGE:
            return out, True
        offset += PAGE
        if offset > 20000:  # refuse to loop forever on a server that ignores offset
            print("    ! search %s@%s exceeded 20000 rows — aborting walk" % (code, tenant))
            return out, False


def key_of(row):
    """Identity of a row: mdms-v2 derives uniqueIdentifier from the schema's
    x-unique fields, so it is the same string at both tenants for the same logical
    row (e.g. roleactions -> "MDMS_ADMIN.4623")."""
    return row.get("uniqueIdentifier") or json.dumps(row.get("data"), sort_keys=True)


def copy_row(tok, code, row):
    data = dict(row.get("data") or {})
    # A row that names its own tenant must name the NEW one, or the copy is a
    # duplicate of pg's row wearing the target's label.
    if "tenantId" in data:
        data["tenantId"] = TARGET
    body = ri(tok)
    body["Mdms"] = {"tenantId": TARGET, "schemaCode": code, "data": data,
                    "isActive": bool(row.get("isActive", True))}
    try:
        _post("/mdms-v2/v2/_create/" + code, body).read()
        return "created"
    except urllib.error.HTTPError as e:
        blob = e.read().decode()[:200]
        if e.code in (400, 409) and ("DUPLICATE" in blob.upper() or "ALREADY" in blob.upper()):
            return "dup"
        if e.code == 403:
            return "forbidden"
        print("    ! %s/%s create failed: HTTP %s %s" % (code, key_of(row), e.code, blob))
        return "failed"


def main():
    print("repair-tenant-masters: source=%s target=%s url=%s apply=%s"
          % (SOURCE, TARGET, URL, APPLY))
    if SOURCE == TARGET:
        print("source == target; nothing to do")
        return 0
    tok = token()

    target_codes = set(schema_codes(tok, TARGET))
    source_codes = set(schema_codes(tok, SOURCE))
    codes = [c for c in (ONLY or sorted(source_codes & target_codes))
             if c not in SKIP and c in target_codes and c in source_codes]
    codes.sort(key=lambda c: (PRIORITY.index(c) if c in PRIORITY else len(PRIORITY), c))

    only_source = sorted((source_codes - target_codes) - SKIP)
    if only_source:
        print("  NOTE: %d schema(s) exist at %s but not at %s (not repaired here): %s"
              % (len(only_source), SOURCE, TARGET, ", ".join(only_source[:10])))

    total_missing = total_created = total_failed = 0
    forbidden_codes = []
    incomplete = []
    for code in codes:
        src, src_ok = all_rows(tok, SOURCE, code)
        tgt, tgt_ok = all_rows(tok, TARGET, code)
        if not (src_ok and tgt_ok):
            incomplete.append(code)
            continue
        have = {key_of(r) for r in tgt}
        missing = [r for r in src if key_of(r) not in have]
        if not missing:
            print("  OK   %-45s %4d/%-4d" % (code, len(tgt), len(src)))
            continue
        total_missing += len(missing)
        print("  GAP  %-45s %4d/%-4d  (%d missing)" % (code, len(tgt), len(src), len(missing)))
        if not APPLY:
            continue
        c = f = 0
        for row in missing:
            r = copy_row(tok, code, row)
            c += (r == "created")
            if r == "forbidden":
                f += 1
                if code not in forbidden_codes:
                    forbidden_codes.append(code)
                break  # one 403 means the whole master is blocked; do not spam
            f += (r == "failed")
        total_created += c; total_failed += f
        print("       -> +%d copied, %d failed" % (c, f))

    if incomplete:
        print("  ! could not read every page for: %s" % ", ".join(incomplete))
    print("SUMMARY: %d schema(s) compared, %d row(s) missing, %d copied, %d failed"
          % (len(codes), total_missing, total_created, total_failed))

    if forbidden_codes:
        print("RBAC_BLOCKED: the admin role has no /mdms-v2/v2/_create role-action for: %s"
              % ", ".join(forbidden_codes))
        print("  This is the truncated-bootstrap failure repairing itself out of reach:")
        print("  the permission needed to restore the permissions was itself dropped.")
        print("  Fix at the source (mdms-v2 /mdms-v2/defaultdata/_create pagination) or")
        print("  restore the missing roleactions rows directly in eg_mdms_data, then re-run.")
        return 3
    if total_created:
        # egov-accesscontrol caches role-actions in memory.
        print("ACL-CHANGED: %d row(s) copied — restart egov-accesscontrol" % total_created)
    if total_failed or incomplete:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
