#!/usr/bin/env python3
"""Seed the config-driven PGR notification MDMS masters (schema + data) AND the
access-control rows the notification screens need, scoped to JUST notifications —
the standalone, idempotent equivalent of what DDH's MdmsBulkLoader does inside a
full tenant bootstrap.

Single source of truth: reads the SAME committed JSON that ships in the
default-data-handler image —
  schema:  utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json
  data:    utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/
            RAINMAKER-PGR.Notification{Routing,Template,ProviderTemplate,Channel}.json

Creates the 4 schemas then their rows at the state-root tenant via MDMS v2.
NotificationChannel is seeded with every channel DISABLED and no provider selected —
an operator switches channels on and picks a provider in the configurator
(Notifications -> Channels / Providers) once a provider is onboarded.

Three jobs, all idempotent, all safe to re-run — which is what makes both "fresh
install" and "add-on to an existing deploy" work from the one task:

  1. schemas   search-then-create. A schema that EXISTS but is missing properties
               the committed definition has (e.g. NotificationChannel.provider,
               added by the provider catalog) is UPDATED in place. Without this an
               upgraded box keeps the old definition and, because these schemas are
               additionalProperties:false, every configurator write carrying the new
               field is rejected — the exact way a seed-only change silently fails
               to reach an existing deployment.
  2. data      duplicate rows are rejected by MDMS x-unique keys and skipped.
  3. access    ACCESSCONTROL-ACTIONS-TEST.actions-test + ACCESSCONTROL-ROLEACTIONS
               .roleactions rows for the NotificationChannel master and the
               novu-bridge provider endpoints. SQL migrations for MDMS do not run on
               deployed boxes, so local-setup/db/full-dump.sql alone never reaches an
               existing install; these rows are how it gets there. egov-accesscontrol
               caches role-actions in memory, so when rows are created this prints
               ACL-CHANGED and the playbook restarts it.

Env:
  DIGIT_URL          Kong base, e.g. http://127.0.0.1:18000        (required)
  NOTIF_TENANT       tenant to seed at (state root, e.g. ke)       (required)
  DIGIT_USERNAME     admin username         (default: ADMIN)
  DIGIT_PASSWORD     admin password         (default: eGov@123)
  DIGIT_LOGIN_TENANT tenant to auth against (default: $NOTIF_TENANT)
  SCHEMA_FILE        path to RAINMAKER-PGR.json schema list
  DATA_DIR           dir holding the 4 RAINMAKER-PGR.Notification*.json data files
  SEED_ACCESS_CONTROL  set to 0 to skip job 3                      (default: 1)
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
SEED_ACL = os.environ.get("SEED_ACCESS_CONTROL", "1") not in ("0", "false", "no")
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="  # egov-user-client: (empty secret)

NOTIF_CODES = [
    "RAINMAKER-PGR.NotificationRouting",
    "RAINMAKER-PGR.NotificationTemplate",
    "RAINMAKER-PGR.NotificationProviderTemplate",
    "RAINMAKER-PGR.NotificationChannel",
]

ACTION_SCHEMA = "ACCESSCONTROL-ACTIONS-TEST.actions-test"
ROLEACTION_SCHEMA = "ACCESSCONTROL-ROLEACTIONS.roleactions"

# ── Phase 1 provider catalog: access control ────────────────────────────────
# Kong's enforce_rbac authorizes every protected URI through egov-accesscontrol,
# which matches EXACT action URLs from ACCESSCONTROL-ACTIONS-TEST.actions-test +
# ACCESSCONTROL-ROLEACTIONS.roleactions. No rows -> the gateway fails closed with
# 403 and the Channels screen and the provider endpoints are unusable.
#
# THESE IDS ARE LOAD-BEARING AND MUST NOT DIVERGE: the identical rows (ids
# 4623-4627, roleaction ids 2347-2361 and 2365-2367) are seeded into local-setup/db/full-dump.sql
# for fresh dump-based installs. A tenant seeded by the dump and a tenant seeded by
# this script must end up with the same action ids, because roleactions reference an
# action by numeric id. 4620-4622 were already taken; these start at 4623.
#
# Roles mirror what the existing rows use: the MDMS masters follow
# NotificationRouting/Template (MDMS_ADMIN, ACCOUNT_ADMIN) plus SUPERUSER; the
# read-only bridge endpoint follows the existing /novu-adapter/ actions 4582-4589
# (ACCOUNT_ADMIN, SUPERUSER, MDMS_ADMIN, CSR, GRO, PGR_LME). Note the EFFECTIVE gate
# on the bridge endpoints is novu-bridge's own ProxyAuthFilter
# (novu_bridge_proxy_allowed_roles), not this list — these rows exist so the gateway
# and the UI action list agree with it, not to widen it.
#
# _update and _delete (4626/4627) are the exception: they rotate or destroy provider
# credentials, so they are seeded ONLY for the config-admin roles, matching the bridge's
# narrower novu_bridge_proxy_admin_roles gate. A CSR/GRO/PGR_LME row here would be
# refused by the bridge anyway (403 NB_ADMIN_ROLE_REQUIRED) — seeding it would only
# advertise a capability those roles do not have.
#
# Not narrowed here: action 4585 (POST .../v1/providers, create) is a pre-existing row
# that ships with CSR/GRO/PGR_LME grants in full-dump.sql and on every already-deployed
# tenant. Changing it is out of scope; the bridge's admin check is the effective gate.
#
# Deliberately absent: /novu-bridge/novu-adapter/v1/gateways/** — the internal
# SMSCountry send adapter is called by Novu's worker over the container network and
# must never be gateway-reachable. Kong terminates it; seeding an action for it
# would be the one change that could make it reachable.
MDMS_ROLES = ["MDMS_ADMIN", "ACCOUNT_ADMIN", "SUPERUSER"]
BRIDGE_ROLES = ["ACCOUNT_ADMIN", "SUPERUSER", "MDMS_ADMIN", "CSR", "GRO", "PGR_LME"]
# Order matters only for reviewability: it is the order the same rows appear in
# full-dump.sql (roleaction ids 2359-2361 and 2365-2367).
PROVIDER_ADMIN_ROLES = ["ACCOUNT_ADMIN", "SUPERUSER", "MDMS_ADMIN"]

NOTIF_ACTIONS = [
    # (id, url, name, enabled, displayName, serviceCode, roles)
    (4623, "/mdms-v2/v2/_create/RAINMAKER-PGR.NotificationChannel", "MDMS", True,
     "create notification channel", "MDMS", MDMS_ROLES),
    (4624, "/mdms-v2/v2/_update/RAINMAKER-PGR.NotificationChannel", "MDMS", True,
     "update notification channel", "MDMS", MDMS_ROLES),
    (4625, "/novu-bridge/novu-adapter/v1/providers/catalog", "Novu Bridge", False,
     "Notification Provider Catalog", "novu-bridge", BRIDGE_ROLES),
    (4626, "/novu-bridge/novu-adapter/v1/providers/_update", "Novu Bridge", False,
     "Update Notification Provider", "novu-bridge", PROVIDER_ADMIN_ROLES),
    (4627, "/novu-bridge/novu-adapter/v1/providers/_delete", "Novu Bridge", False,
     "Delete Notification Provider", "novu-bridge", PROVIDER_ADMIN_ROLES),
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


def find_schema(tok, code):
    """The live SchemaDefinition for `code`, or None."""
    body = ri(tok); body["SchemaDefCriteria"] = {"tenantId": TENANT, "codes": [code]}
    try:
        r = json.load(_post("/mdms-v2/schema/v1/_search", body, tok))
        defs = r.get("SchemaDefinitions") or []
        return defs[0] if defs else None
    except urllib.error.HTTPError:
        return None


def _strip_empty_ref(sdef):
    # MDMS's schema-create mangles an empty "x-ref-schema": [] into {} on storage;
    # then MdmsDataValidator does (JSONArray) get("x-ref-schema") on that {} and
    # throws ClassCastException for EVERY subsequent data create. The validator only
    # runs `if schemaObject.has("x-ref-schema")`, so drop an empty x-ref-schema
    # entirely — it's a no-op reference list anyway — and the whole block is skipped.
    defn = dict(sdef.get("definition") or {})
    if defn.get("x-ref-schema") == []:
        defn.pop("x-ref-schema", None)
        sdef = dict(sdef)
        sdef["definition"] = defn
    return sdef


def create_schema(tok, sdef):
    sdef = dict(sdef); sdef["tenantId"] = TENANT
    body = ri(tok); body["SchemaDefinition"] = _strip_empty_ref(sdef)
    _post("/mdms-v2/schema/v1/_create", body, tok).read()


def missing_properties(live, committed):
    """Property names the committed definition has and the live one does not."""
    lp = ((live or {}).get("definition") or {}).get("properties") or {}
    cp = ((committed or {}).get("definition") or {}).get("properties") or {}
    return sorted(set(cp) - set(lp))


def update_schema(tok, live, committed):
    """Push the committed definition onto the EXISTING schema row, keeping its id."""
    sdef = dict(live)
    sdef["definition"] = (committed.get("definition") or {})
    sdef["tenantId"] = TENANT
    body = ri(tok); body["SchemaDefinition"] = _strip_empty_ref(sdef)
    _post("/mdms-v2/schema/v1/_update", body, tok).read()


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
        if e.code == 403:
            # Kong fail-closed: this tenant's SUPERUSER/MDMS_ADMIN has no
            # roleaction for /mdms-v2/v2/_create/<code>. Almost always the
            # truncated-bootstrap symptom — see repair-tenant-masters.py.
            print("    ! %s row FORBIDDEN (403): the admin role has no roleaction for "
                  "/mdms-v2/v2/_create/%s. Run repair-tenant-masters.py first." % (code, code))
            return "forbidden"
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


def seed_access_control(tok):
    """Upsert the notification actions + roleactions. Returns (created, dup, failed)."""
    created = dup = failed = 0
    for schema in (ACTION_SCHEMA, ROLEACTION_SCHEMA):
        if find_schema(tok, schema) is None:
            print("  access-control: schema %s ABSENT at %s — skipping ACL seed "
                  "(tenant bootstrap has not run?)" % (schema, TENANT))
            return 0, 0, 1

    for aid, url, name, enabled, disp, svc, roles in NOTIF_ACTIONS:
        action = {"id": aid, "url": url, "code": "null", "name": name, "path": "",
                  "enabled": enabled, "displayName": disp, "orderNumber": 0,
                  "serviceCode": svc, "parentModule": ""}
        r = create_row(tok, ACTION_SCHEMA, action)
        created += (r == "created"); dup += (r == "dup"); failed += r in ("failed", "forbidden")
        for role in roles:
            # x-ref-schema on roleactions validates rolecode against
            # ACCESSCONTROL-ROLES.roles — a role this tenant does not have fails
            # here and is skipped, which is correct: we do not invent roles.
            ra = {"rolecode": role, "actionid": aid, "actioncode": "", "tenantId": TENANT}
            r = create_row(tok, ROLEACTION_SCHEMA, ra)
            created += (r == "created"); dup += (r == "dup"); failed += r in ("failed", "forbidden")
    return created, dup, failed


def main():
    print("seed-notifications: tenant=%s url=%s" % (TENANT, URL))
    tok = token()

    schemas = {s.get("code"): s for s in json.load(open(SCHEMA_FILE))}
    for code in NOTIF_CODES:
        if code not in schemas:
            sys.exit("ERROR: schema %s not found in %s" % (code, SCHEMA_FILE))
        live = find_schema(tok, code)
        if live is None:
            create_schema(tok, schemas[code])
            print("  schema CREATED %s" % code)
            continue
        added = missing_properties(live, schemas[code])
        if not added:
            print("  schema EXISTS  %s" % code)
            continue
        try:
            update_schema(tok, live, schemas[code])
            print("  schema UPDATED %s (+%s)" % (code, ", ".join(added)))
        except urllib.error.HTTPError as e:
            # Non-fatal: the existing rows keep working, only writes carrying the
            # new field are rejected. Say so loudly instead of exiting DONE.
            print("  ! schema UPDATE FAILED %s (+%s): HTTP %s %s"
                  % (code, ", ".join(added), e.code, e.read().decode()[:160]))
    time.sleep(3)  # let schema definitions settle before data validates against them

    total_created = total_dup = 0
    failed_masters = []
    for code in NOTIF_CODES:
        path = os.path.join(DATA_DIR, code + ".json")
        if not os.path.exists(path):
            # Fail loudly: a master listed here but not staged is exactly how
            # NotificationChannel silently never got seeded.
            print("  ! data %-45s MISSING FILE %s" % (code, path))
            failed_masters.append(code)
            continue
        rows = json.load(open(path))
        c = d = f = 0
        for row in rows:
            r = create_row(tok, code, row)
            c += (r == "created"); d += (r == "dup"); f += r in ("failed", "forbidden")
        total_created += c; total_dup += d
        if f:
            failed_masters.append(code)
        print("  data %-45s +%d created, %d already-present, %d FAILED (%d in file)" % (code, c, d, f, len(rows)))

    acl_created = acl_failed = 0
    if SEED_ACL:
        acl_created, acl_dup, acl_failed = seed_access_control(tok)
        print("  access-control  +%d created, %d already-present, %d FAILED "
              "(%d actions, %d roleactions)"
              % (acl_created, acl_dup, acl_failed, len(NOTIF_ACTIONS),
                 sum(len(a[6]) for a in NOTIF_ACTIONS)))
        total_created += acl_created; total_dup += acl_dup
    else:
        print("  access-control  SKIPPED (SEED_ACCESS_CONTROL=0)")

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
    if acl_failed:
        note += "  WARNING: %d access-control row(s) failed" % acl_failed
    if acl_created:
        # egov-accesscontrol caches role-actions in memory: new rows are invisible
        # until it restarts. The playbook greps for this marker.
        print("ACL-CHANGED: %d access-control row(s) created — restart egov-accesscontrol" % acl_created)
    print("DONE: %d created, %d already-present.%s" % (total_created, total_dup, note))
    sys.exit(2 if core_failed else 0)


if __name__ == "__main__":
    main()
