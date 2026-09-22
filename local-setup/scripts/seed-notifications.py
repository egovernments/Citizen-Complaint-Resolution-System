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

Creates the schemas then their rows at the state-root tenant via MDMS v2.

Channel rows are the one master whose rows CHANGE BEHAVIOUR the moment they exist:
novu-bridge's ChannelPolicyClient lets a tenant with ANY active channel row be decided
by those rows alone (no row = off), and only a tenant with none falls back to the
deployment's NOVU_BRIDGE_CHANNELS_ENABLED allowlist. So the channel rows are never
copied blindly from the committed all-off file (job 3 below):

  - a tenant with NO channel rows in either namespace is seeded from the allowlist the
    bridge runs with (NOTIF_CHANNELS_ALLOWLIST): enabled = the channel is on that list.
    An upgraded tenant therefore keeps delivering exactly what it delivered before, and
    a brand-new deployment with an empty allowlist gets every channel off — the
    intended out-of-box default. `gateway` is left out of these rows so the
    deployment's NOVU_BRIDGE_SMS_PROVIDER keeps choosing the SMS transport, as today.
  - a tenant that already has rows is left alone: a missing channel is added switched
    off, which is what a missing row already means. Existing rows are never modified.
  - NOTIF_CHANNELS_ALLOWLIST not supplied: no channel rows are written at all, rather
    than guessing (the tenant stays on the env allowlist).

Jobs, all idempotent, all safe to re-run — which is what makes both "fresh install"
and "add-on to an existing deploy" work from the one task. They run in this order:

  1. access    ACCESSCONTROL-ACTIONS-TEST.actions-test + ACCESSCONTROL-ROLEACTIONS
               .roleactions rows for the NotificationChannel master, the five new
               NOTIFICATIONS.* masters and the novu-bridge endpoints. SQL migrations
               for MDMS do not run on deployed boxes, so local-setup/db/full-dump.sql
               alone never reaches an existing install; these rows are how it gets
               there. FIRST, because every write below needs them: a data write that
               runs before its action exists is a 403. egov-accesscontrol caches
               role-actions in memory, so when rows are created this prints
               ACL-CHANGED and the caller must restart it before the data phase (the
               playbook does; NOTIF_SEED_PHASE=all stops here and says so).
  2. schemas   search-then-create, for BOTH the four legacy RAINMAKER-PGR.Notification*
               schemas and the five module-neutral NOTIFICATIONS.* ones. A schema that
               EXISTS but is missing properties the committed definition has is
               reported as STALE (mdms-v2 cannot update a schema in place).
  3. data      the legacy Routing/Template/ProviderTemplate masters from the committed
               default files (duplicates are rejected by MDMS x-unique keys and
               skipped), and the legacy channel rows by the rule above.
  4. copy      the legacy rows a LIVE tenant actually has, converted into the
               NOTIFICATIONS.* namespace (see the block above seed_new_namespace for why
               this reads the server instead of staging a data file), plus the
               EventCatalogue, which has no legacy counterpart. Routing is copied LAST
               and only when every Template and ProviderTemplate copy succeeded: the
               bridge moves a tenant to the new namespace the moment it has one
               NOTIFICATIONS.Routing row. Additive: it NEVER deletes or modifies a row.
  5. verify    row counts per master, on both namespaces.

Exit: 0 done · 2 a core master failed · 3 at least one write was refused with 403
(restart egov-accesscontrol and run the data phase again — the playbook does this once
by itself) or, with NOTIF_SEED_PHASE=all, access-control rows were just created.

Env:
  DIGIT_URL          Kong base, e.g. http://127.0.0.1:18000        (required)
  NOTIF_TENANT       tenant to seed at (state root, e.g. ke)       (required)
  DIGIT_USERNAME     admin username         (default: ADMIN)
  DIGIT_PASSWORD     admin password         (default: eGov@123)
  DIGIT_LOGIN_TENANT tenant to auth against (default: $NOTIF_TENANT)
  SCHEMA_FILE        path to RAINMAKER-PGR.json schema list
  NOTIF_SCHEMA_FILE  path to NOTIFICATIONS.json schema list
  DATA_DIR           dir holding the staged *.json data files (both namespaces)
  NOTIF_SEED_PHASE   all | access | data                           (default: all)
                     access = job 1 only; data = jobs 2-5; all = job 1, then jobs 2-5
                     unless job 1 created rows (then exit 3: restart accesscontrol).
  NOTIF_CHANNELS_ALLOWLIST  the NOVU_BRIDGE_CHANNELS_ENABLED value novu-bridge runs
                     with, e.g. "SMS,EMAIL"; "" = nothing enabled. UNSET = unknown,
                     and a tenant without channel rows gets none (see above).
  SEED_ACCESS_CONTROL  set to 0 to skip job 1                      (default: 1)
  COPY_TO_NOTIFICATIONS set to 0 to skip job 4                     (default: 1)
"""
import os, sys, json, time, urllib.request, urllib.parse, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import notifications_convert as nc
except ImportError:  # pragma: no cover - staging bug, reported in main()
    nc = None

# Read lazily-ish: an empty value is validated in main(). Kept as module constants so
# test_acl_dump_parity.py can import this file and diff NOTIF_ACTIONS against the dump
# without a live DIGIT.
URL = os.environ.get("DIGIT_URL", "").rstrip("/")
TENANT = os.environ.get("NOTIF_TENANT", "")
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
LOGIN_TENANT = os.environ.get("DIGIT_LOGIN_TENANT", TENANT)
_here = os.path.dirname(os.path.abspath(__file__))
SCHEMA_FILE = os.environ.get("SCHEMA_FILE", os.path.join(_here, "notification-seed", "RAINMAKER-PGR.json"))
NOTIF_SCHEMA_FILE = os.environ.get(
    "NOTIF_SCHEMA_FILE", os.path.join(os.path.dirname(SCHEMA_FILE), "NOTIFICATIONS.json"))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(_here, "notification-seed"))
SEED_ACL = os.environ.get("SEED_ACCESS_CONTROL", "1") not in ("0", "false", "no")
COPY_TO_NEW = os.environ.get("COPY_TO_NOTIFICATIONS", "1") not in ("0", "false", "no")
PHASE = os.environ.get("NOTIF_SEED_PHASE", "all").strip().lower()
# None (unset) is deliberately different from "" (set, empty): "" is a deployment that
# enables nothing, None is a caller that did not say — see the module docstring.
CHANNELS_ALLOWLIST_RAW = os.environ.get("NOTIF_CHANNELS_ALLOWLIST")
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="  # egov-user-client: (empty secret)

NOTIF_CODES = [
    "RAINMAKER-PGR.NotificationRouting",
    "RAINMAKER-PGR.NotificationTemplate",
    "RAINMAKER-PGR.NotificationProviderTemplate",
    "RAINMAKER-PGR.NotificationChannel",
]
LEGACY_CHANNEL = "RAINMAKER-PGR.NotificationChannel"
NEW_CHANNEL = "NOTIFICATIONS.Channel"
KNOWN_CHANNELS = ("SMS", "EMAIL", "WHATSAPP")

# The module-neutral namespace (thin-event design §5.1). ONE namespace for every module;
# NOTIFICATIONS.Channel is the same shape as RAINMAKER-PGR.NotificationChannel, only the
# namespace moves. EventCatalogue is new and has no legacy counterpart.
NEW_CODES = [
    "NOTIFICATIONS.EventCatalogue",
    "NOTIFICATIONS.Routing",
    "NOTIFICATIONS.Template",
    "NOTIFICATIONS.ProviderTemplate",
    "NOTIFICATIONS.Channel",
]
# The order the copy writes them in. Routing is LAST on purpose: novu-bridge serves a
# tenant from NOTIFICATIONS.* the moment that tenant has a single NOTIFICATIONS.Routing
# row (MdmsNotificationConfigRepository.load), so a routing row that lands before its
# templates switches the tenant to a namespace with nothing to render. Channel goes
# before Routing because it has its own all-or-nothing switch (ChannelPolicyClient) and
# does not depend on Routing.
COPY_ORDER = [
    "NOTIFICATIONS.EventCatalogue",
    "NOTIFICATIONS.Template",
    "NOTIFICATIONS.ProviderTemplate",
    "NOTIFICATIONS.Channel",
    "NOTIFICATIONS.Routing",
]
# A failure in any of these holds the Routing copy back for the tenant.
ROUTING_PREREQUISITES = ("NOTIFICATIONS.Template", "NOTIFICATIONS.ProviderTemplate")
# Masters whose default rows are seeded from a file when the tenant has NEITHER
# new-namespace rows nor legacy rows to copy. EventCatalogue is always in this set: it
# is generated from the workflow definition, not converted from anything.
# NOTIFICATIONS.Channel is NEVER seeded from its file: its rows switch delivery on or
# off, so they only ever come from the legacy rows or the allowlist decision.
NEW_CODES_FROM_FILE = ["NOTIFICATIONS.EventCatalogue"]

# Masters a 403 was returned for during this run. A 403 here is almost always
# egov-accesscontrol serving a role-action cache from before job 1 created the rows,
# which a restart fixes; the exit code (3) tells the caller to do that and run again.
FORBIDDEN = []

ACTION_SCHEMA = "ACCESSCONTROL-ACTIONS-TEST.actions-test"
ROLEACTION_SCHEMA = "ACCESSCONTROL-ROLEACTIONS.roleactions"

# ── Phase 1 provider catalog: access control ────────────────────────────────
# Kong's enforce_rbac authorizes every protected URI through egov-accesscontrol,
# which matches EXACT action URLs from ACCESSCONTROL-ACTIONS-TEST.actions-test +
# ACCESSCONTROL-ROLEACTIONS.roleactions. No rows -> the gateway fails closed with
# 403 and the Channels screen and the provider endpoints are unusable.
#
# THESE IDS ARE LOAD-BEARING AND MUST NOT DIVERGE: the identical rows (ids
# 4623-4639, roleaction ids 2347-2361, 2365-2367 and 2368-2406) are seeded into
# local-setup/db/full-dump.sql
# for fresh dump-based installs. A tenant seeded by the dump and a tenant seeded by
# this script must end up with the same action ids, because roleactions reference an
# action by numeric id. 4620-4622 were already taken; these start at 4623.
# test_acl_dump_parity.py re-derives the next free ids from the dump and asserts the
# tuples below and the dump rows agree field-for-field — run it after any edit here.
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

    # ── Thin-event design §5.4: the module-neutral NOTIFICATIONS.* masters ──────
    # Ten actions, thirty role-actions. Kong's enforce_rbac authorizes on EXACT
    # action URLs, so a missing row here is a 403 that presents as "the Notifications
    # screens save nothing" — silent, and indistinguishable from a UI bug. Search goes
    # through the un-suffixed /mdms-v2/v2/_search, which needs no action of its own:
    # that is why there is no _search row for the legacy masters either (verified
    # against full-dump.sql, which carries none for 4591-4596 or 4623/4624).
    #
    # Row-shape convention for this block, decided once (design §5.4 rule 2): NO
    # "method" field, matching 4591-4596 and 4623-4627. Some older dump rows carry
    # "method": "POST"; mixing the two in one block is what makes the dump unreviewable.
    #
    # Roles: the same three the existing notification masters use. MDMS_ADMIN is the
    # configurator's own role; ACCOUNT_ADMIN and SUPERUSER are the tenant admins.
    (4628, "/mdms-v2/v2/_create/NOTIFICATIONS.EventCatalogue", "MDMS", True,
     "create notification event catalogue", "MDMS", MDMS_ROLES),
    (4629, "/mdms-v2/v2/_update/NOTIFICATIONS.EventCatalogue", "MDMS", True,
     "update notification event catalogue", "MDMS", MDMS_ROLES),
    (4630, "/mdms-v2/v2/_create/NOTIFICATIONS.Routing", "MDMS", True,
     "create notification routing", "MDMS", MDMS_ROLES),
    (4631, "/mdms-v2/v2/_update/NOTIFICATIONS.Routing", "MDMS", True,
     "update notification routing", "MDMS", MDMS_ROLES),
    (4632, "/mdms-v2/v2/_create/NOTIFICATIONS.Template", "MDMS", True,
     "create notification template", "MDMS", MDMS_ROLES),
    (4633, "/mdms-v2/v2/_update/NOTIFICATIONS.Template", "MDMS", True,
     "update notification template", "MDMS", MDMS_ROLES),
    (4634, "/mdms-v2/v2/_create/NOTIFICATIONS.ProviderTemplate", "MDMS", True,
     "create notification provider template", "MDMS", MDMS_ROLES),
    (4635, "/mdms-v2/v2/_update/NOTIFICATIONS.ProviderTemplate", "MDMS", True,
     "update notification provider template", "MDMS", MDMS_ROLES),
    (4636, "/mdms-v2/v2/_create/NOTIFICATIONS.Channel", "MDMS", True,
     "create notification channel", "MDMS", MDMS_ROLES),
    (4637, "/mdms-v2/v2/_update/NOTIFICATIONS.Channel", "MDMS", True,
     "update notification channel", "MDMS", MDMS_ROLES),

    # ── The two new novu-bridge endpoints the thin event brings ────────────────
    # /config/source (design §5.2) answers "which namespace served each master for this
    # tenant, and how many rows did it find". It is an observability read with the same
    # audience as the other read-only bridge endpoints, so it gets BRIDGE_ROLES.
    # /dispatch/_resolve (design §7.2 P1) takes a thin event and returns the envelope
    # list WITHOUT dispatching or writing a ledger row. It reveals recipients, so it
    # gets the narrower admin set, matching the bridge's own novu_bridge_proxy_admin_roles.
    # As with the rest of the bridge, the EFFECTIVE gate is ProxyAuthFilter inside
    # novu-bridge; these rows exist so the gateway and the UI action list agree with it.
    # /novu-adapter/v1/contract/thin-event gets NO row on purpose: like the two contract
    # endpoints that ship today it is in Kong's AUTH_OPTIONAL set on a GET-only route and
    # is deliberately not action-RBAC'd — it describes an interface, not a deployment.
    (4638, "/novu-bridge/novu-adapter/v1/config/source", "Novu Bridge", False,
     "Notification Config Source", "novu-bridge", BRIDGE_ROLES),
    (4639, "/novu-bridge/novu-adapter/v1/dispatch/_resolve", "Novu Bridge", False,
     "Resolve Thin Notification Event", "novu-bridge", PROVIDER_ADMIN_ROLES),
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



def create_row(tok, code, row, is_active=None):
    body = ri(tok)
    if is_active is None:
        is_active = bool(row.get("active", row.get("isActive", True)))
    body["Mdms"] = {"tenantId": TENANT, "schemaCode": code, "data": row,
                    "isActive": bool(is_active)}
    try:
        resp = _post("/mdms-v2/v2/_create/" + code, body, tok).read()
        # MDMS v2's "phantom 200": a create that collides on x-unique can come back 200
        # with an EMPTY mdms array instead of an error (the configurator client has the
        # same special case). Counting that as `created` is what makes a re-run look
        # like it changed something — and the ACL-CHANGED marker then restarts
        # egov-accesscontrol on every deploy for no reason.
        try:
            if not (json.loads(resp.decode() or "{}").get("mdms") or []):
                return "dup"
        except ValueError:
            pass
        return "created"
    except urllib.error.HTTPError as e:
        blob = e.read().decode()[:160]
        if e.code in (400, 409) and ("DUPLICATE" in blob.upper() or "ALREADY" in blob.upper()):
            return "dup"
        if e.code == 403:
            # Kong fail-closed: the gateway found no role-action for
            # /mdms-v2/v2/_create/<code>. Two causes: egov-accesscontrol has not been
            # restarted since job 1 created the action (it caches role-actions), or the
            # tenant's admin role genuinely lacks it (the truncated-bootstrap symptom —
            # see repair-tenant-masters.py). Only the first is fixed by a restart.
            if code not in FORBIDDEN:
                FORBIDDEN.append(code)
                print("    ! %s row FORBIDDEN (403): no role-action for /mdms-v2/v2/_create/%s "
                      "is loaded. Restart egov-accesscontrol and re-run; if it persists, the "
                      "admin role lacks it (repair-tenant-masters.py)." % (code, code))
            return "forbidden"
        # Resilient: log + skip a failing row rather than aborting the whole seed,
        # so the core masters still land. main() surfaces failures + the exit code.
        print("    ! %s row FAILED: HTTP %s %s" % (code, e.code, blob))
        return "failed"


def count_rows(tok, code):
    """Total rows for `code`, ACTIVE AND INACTIVE. Uses mdms-v2 _count when the build
    has it and otherwise falls back to paging, because the old single-page _search with
    limit=200 silently under-reported any master that outgrew the page."""
    body = ri(tok)
    body["MdmsCriteria"] = {"tenantId": TENANT, "schemaCode": code}
    try:
        r = json.load(_post("/mdms-v2/v2/_count", body, tok))
        total = r.get("totalCount")
        if isinstance(total, int):
            return total
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
        pass
    rows = search_rows(tok, code)
    return -1 if rows is None else len(rows)


# Paging constants. Every MDMS read in this script goes through search_rows: a single
# limit=200 page is a known bug class in this repo (configurator #953), and a live
# tenant's notification masters have already drifted past the repo's 24/42/14 defaults.
PAGE = 100
MAX_PAGES = 200  # 20k rows; a safety ceiling, not an expected bound


def search_rows(tok, code):
    """EVERY row for `code`, active and inactive, as the raw mdms records.

    Returns None when the search itself fails, which the caller must treat as "unknown",
    never as "empty" — a failed read that looked like zero rows would make the copy step
    decide the tenant has no legacy data and seed repo defaults over live ones.

    No isActive criterion is pushed down, so inactive rows come back too: an operator who
    deactivated a routing row expects it to still be deactivated after the copy.
    """
    out, seen, offset = [], set(), 0
    for _ in range(MAX_PAGES):
        body = ri(tok)
        # mdms-v2 _search takes the schemaCode in the BODY (not the path — that
        # path variant silently returns 0). Same quirk the configurator hit.
        body["MdmsCriteria"] = {"tenantId": TENANT, "schemaCode": code,
                                "limit": PAGE, "offset": offset}
        try:
            page = json.load(_post("/mdms-v2/v2/_search", body, tok)).get("mdms") or []
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
            return None
        if not page:
            return out
        for rec in page:
            uid = rec.get("uniqueIdentifier") or rec.get("id")
            if uid is not None and uid in seen:
                continue
            if uid is not None:
                seen.add(uid)
            out.append(rec)
        # Advance by the page's ACTUAL length, not the requested limit: a build that
        # caps the server-side limit below PAGE would otherwise leave gaps.
        offset += len(page)
        if len(page) < PAGE:
            return out
    print("    ! %s: stopped paging at %d rows (safety ceiling) — the copy may be "
          "incomplete" % (code, len(out)))
    return out


# ── Job 4: copy the legacy masters into the NOTIFICATIONS.* namespace ────────
# WHY THIS READS THE SERVER AND NOT A STAGED DATA FILE (thin-event design §5.2)
#
# This script is create-only: a data row that collides on x-unique comes back DUPLICATE
# and is counted as `dup`, and there is no data _update call anywhere in it. So it is
# idempotent but NOT convergent — a changed default value has never reached a deployed
# box. Live servers have drifted from the repo's 24/42/14 rows to roughly 41/60/14
# through operator edits this script cannot see. Staging a file of pre-converted rows
# would therefore copy the REPO's defaults onto a tenant that has its own data, and the
# operator's edited messages would never appear in the new namespace.
#
# So: search the live legacy rows, convert them with notifications_convert (the same
# pure functions that generated the committed defaults, so an untouched tenant lands on
# exactly the committed rows), and create what is missing. The legacy rows are never
# deleted and never modified — after this runs BOTH namespaces hold the data, which is
# what makes the release rollback-able (design D2) to the configuration as it was at the
# copy: Configurator edits made after it land in NOTIFICATIONS.* only.

# The x-unique tuple of each new master, mirrored from
# utilities/default-data-handler/src/main/resources/schema/NOTIFICATIONS.json. Used to
# skip a row that is already there instead of firing a create and reading DUPLICATE
# back — same outcome, but the printed "already-present" count is then the truth rather
# than a count of swallowed 400s.
NEW_UNIQUE_KEYS = {
    "NOTIFICATIONS.EventCatalogue": ("eventName",),
    "NOTIFICATIONS.Routing": ("eventName", "audience", "channel"),
    "NOTIFICATIONS.Template": ("eventName", "audience", "channel", "locale"),
    "NOTIFICATIONS.ProviderTemplate": ("provider", "channel", "eventName", "audience", "locale"),
    "NOTIFICATIONS.Channel": ("code",),
}


def _unique_key(code, row):
    return tuple(str(row.get(field, "")) for field in NEW_UNIQUE_KEYS[code])


def _record_rows(records):
    """[(data dict, isActive)] from raw mdms records.

    The record-level isActive is authoritative when present: the configurator's
    "deactivate" flips it and leaves data.active alone, so reading data.active would
    resurrect a row the operator switched off.
    """
    out = []
    for rec in records or []:
        data = rec.get("data")
        if not isinstance(data, dict):
            continue
        active = rec.get("isActive")
        if active is None:
            active = data.get("active", data.get("isActive", True))
        out.append((data, bool(active)))
    return out


def _load_default_rows(code):
    path = os.path.join(DATA_DIR, code + ".json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def seed_new_namespace(tok):
    """Populate NOTIFICATIONS.* for this tenant, in COPY_ORDER.

    Returns (created, present, failed, routing_held). routing_held is True when the
    Routing copy was skipped because a Template/ProviderTemplate copy did not complete.
    """
    if nc is None:
        print("  copy: notifications_convert.py NOT STAGED next to this script — "
              "the NOTIFICATIONS.* namespace cannot be populated")
        return 0, 0, 1, False

    total_created = total_present = total_failed = 0
    failed_by_code = {}
    routing_held = False

    # One audience index for the whole run, built from the LIVE routing rows, so a
    # template inherits exactly the audience string its routing row produced. See the
    # join-hazard note in notifications_convert.py.
    live_routing = search_rows(tok, "RAINMAKER-PGR.NotificationRouting")
    index = nc.build_audience_index(
        [data for data, _ in _record_rows(live_routing)] if live_routing else [])

    for new_code in COPY_ORDER:
        if new_code == "NOTIFICATIONS.Routing":
            blockers = [c for c in ROUTING_PREREQUISITES if failed_by_code.get(c)]
            if blockers:
                # Copying Routing now would switch this tenant to NOTIFICATIONS.* with
                # templates missing: every event whose template did not land would be
                # SKIPPED/NB_NO_TEMPLATE. Holding it back keeps the tenant on its legacy
                # masters, which still deliver, until a re-run completes the copy.
                print("  copy %-33s HELD BACK — %s did not copy completely; copying routing "
                      "now would move %s onto the new namespace with templates missing. "
                      "The tenant keeps using its legacy masters; re-run to finish."
                      % (new_code, " and ".join(b.split(".")[-1] for b in blockers), TENANT))
                print("NOTIFICATIONS-ROUTING-HELD: %s stays on the legacy masters until "
                      "%s copy completely" % (TENANT, ", ".join(blockers)))
                failed_by_code[new_code] = 1
                total_failed += 1
                routing_held = True
                continue

        legacy_code = None
        for legacy, new in nc.LEGACY_TO_NEW_CODE.items():
            if new == new_code:
                legacy_code = legacy

        existing = search_rows(tok, new_code)
        if existing is None:
            print("  copy %-33s SEARCH FAILED — skipped (cannot tell present from "
                  "absent, and guessing would duplicate or overwrite)" % new_code)
            failed_by_code[new_code] = 1
            total_failed += 1
            continue
        present_keys = {_unique_key(new_code, data) for data, _ in _record_rows(existing)}

        source, origin = [], ""
        legacy_records = search_rows(tok, legacy_code) if legacy_code else None
        if legacy_code and legacy_records is None:
            print("  copy %-33s legacy SEARCH FAILED — skipped" % new_code)
            failed_by_code[new_code] = 1
            total_failed += 1
            continue
        if legacy_records:
            origin = "converted from %d live %s rows" % (
                len(legacy_records), legacy_code.split(".")[-1])
            for data, active in _record_rows(legacy_records):
                try:
                    _, converted, dropped = nc.convert_master(legacy_code, [data], index)
                except nc.ConversionError as exc:
                    print("    ! %s: unconvertible legacy row skipped (%s)" % (new_code, exc))
                    continue
                for row, reason in dropped:
                    print("    - %s: legacy row not copied (%s)" % (new_code, reason))
                for row in converted:
                    # The legacy row's own isActive carries over verbatim.
                    row["active"] = active
                    source.append((row, active))
        elif new_code == NEW_CHANNEL:
            # Never from the committed file: an all-off NOTIFICATIONS.Channel would take
            # over from the env allowlist and switch every channel of this tenant off.
            # The channel decision above is the only thing that writes channel rows.
            origin = "no legacy channel rows to copy (see the channel decision above)"
        elif not present_keys or new_code in NEW_CODES_FROM_FILE:
            rows = _load_default_rows(new_code)
            if rows is None:
                print("  copy %-33s NO legacy rows and NO staged default file %s"
                      % (new_code, new_code + ".json"))
                failed_by_code[new_code] = 1
                total_failed += 1
                continue
            origin = "seeded from the committed defaults (%d rows)" % len(rows)
            source = [(row, bool(row.get("active", True))) for row in rows]
        else:
            origin = "no legacy rows to copy; %d already here" % len(present_keys)

        if new_code == NEW_CHANNEL:
            # Enabled rows first: the first row to land makes this tenant "decided by
            # rows", so if a later create fails, the missing row is one that was off anyway.
            source.sort(key=lambda item: not (item[1] and item[0].get("enabled")))

        created = present = failed = 0
        for row, active in source:
            if _unique_key(new_code, row) in present_keys:
                present += 1
                continue
            result = create_row(tok, new_code, row, is_active=active)
            if result == "created":
                created += 1
                present_keys.add(_unique_key(new_code, row))
            elif result == "dup":
                present += 1
                present_keys.add(_unique_key(new_code, row))
            else:
                failed += 1
        print("  copy %-33s +%d copied, %d already-present, %d FAILED  (%s)"
              % (new_code, created, present, failed, origin))
        failed_by_code[new_code] = failed
        total_created += created
        total_present += present
        total_failed += failed

    return total_created, total_present, total_failed, routing_held


# ── The channel decision (legacy RAINMAKER-PGR.NotificationChannel rows) ──────
# See the module docstring. decide_channel_rows is pure (no I/O) so the rule can be
# exercised without a live MDMS.

def parse_allowlist(raw):
    """The channel codes novu-bridge's isChannelEnabled() accepts for `raw`, or None.

    Mirrors NovuBridgeConfiguration: comma-split, trimmed, case-insensitive; an empty
    string enables nothing. None means the caller did not supply the value at all.
    """
    if raw is None:
        return None
    return {part.strip().upper() for part in raw.split(",") if part.strip()}


def _channel_code(data):
    return str((data or {}).get("code") or "").strip().upper()


def _channel_rows(records):
    """[(data, effective_active)] for records that carry a channel code."""
    out = []
    for rec in records or []:
        data = rec.get("data")
        if not isinstance(data, dict) or not _channel_code(data):
            continue
        # What ChannelPolicyClient.fetch keeps: it asks MDMS for isActive=true and then
        # also drops rows whose data.active is false.
        active = rec.get("isActive") is not False and data.get("active") is not False
        out.append((data, active))
    return out


def _governing(records):
    """{code: data} for the rows ChannelPolicyClient would actually use."""
    out = {}
    for data, active in _channel_rows(records):
        if active:
            out.setdefault(_channel_code(data), data)
    return out


def _allowlist_row(default_row, enabled):
    # No `gateway`: a row that names one pins the transport, and today this tenant's
    # SMS transport is chosen by NOVU_BRIDGE_SMS_PROVIDER (novu or direct smscountry).
    # Leaving it out keeps that env setting in charge, exactly as before the rows.
    row = {k: v for k, v in default_row.items() if k != "gateway"}
    row["enabled"] = bool(enabled)
    row["active"] = True
    return row


def _is_allowlist_seed(data, allowlist):
    """True when a row looks exactly like one _allowlist_row produced for `allowlist`."""
    return (not data.get("gateway") and not data.get("provider") and not data.get("senderId")
            and bool(data.get("enabled")) == (_channel_code(data) in allowlist))


def decide_channel_rows(defaults, legacy_records, new_records, allowlist):
    """Which legacy channel rows to create, and why. Pure.

    Returns {"mode", "create": [row, ...] enabled-first, "lines": [str, ...]}.
    mode is one of:
      env      no channel rows anywhere: seed every channel from the allowlist
      resume   rows exist but are exactly a partial `env` seed of this same allowlist
               (a run that died half way): finish it with the same rule
      rows     rows already decide: add missing channels switched off (= unchanged)
      unknown  no rows and no allowlist supplied: write nothing
      conflict no active rows, but an inactive row exists for an allowlisted channel:
               adding rows would switch that channel off, so write nothing
    """
    defaults_by_code = {}
    for row in defaults or []:
        code = _channel_code(row)
        if code and code not in defaults_by_code:
            defaults_by_code[code] = row
    order = [c for c in KNOWN_CHANNELS if c in defaults_by_code] + \
        [c for c in defaults_by_code if c not in KNOWN_CHANNELS]

    legacy_rows, new_rows = _channel_rows(legacy_records), _channel_rows(new_records)
    gov_new, gov_legacy = _governing(new_records), _governing(legacy_records)
    governing = gov_new or gov_legacy
    where = NEW_CHANNEL if gov_new else LEGACY_CHANNEL
    present = {_channel_code(d) for d, _ in legacy_rows + new_rows}
    # A code with a row in EITHER namespace is left alone (never modified); the copy
    # carries a legacy row across, and a legacy twin of a NOTIFICATIONS row is noise.
    missing = [c for c in order if c not in present]
    shown = "(unset)" if allowlist is None else (",".join(sorted(allowlist)) or '""')
    lines, create = [], []

    if allowlist is not None:
        for extra in sorted(allowlist - set(KNOWN_CHANNELS)):
            lines.append("allowlist entry %r is not a channel (SMS, EMAIL, WHATSAPP) — ignored"
                         % extra)

    if not governing:
        dormant = sorted(present)
        if allowlist is None:
            lines.append("NOT SEEDING channel rows: the tenant has none, so novu-bridge "
                         "follows NOVU_BRIDGE_CHANNELS_ENABLED today, and "
                         "NOTIF_CHANNELS_ALLOWLIST was not supplied to say what that is. "
                         "Writing rows now could switch channels off. Run through the "
                         "playbook (it passes the bridge's value), or set "
                         "NOTIF_CHANNELS_ALLOWLIST to it (\"\" = nothing enabled).")
            return {"mode": "unknown", "create": [], "lines": lines}
        conflict = [c for c in dormant if c in allowlist]
        if conflict:
            lines.append("NOT SEEDING channel rows: %s %s an INACTIVE row but %s on "
                         "NOVU_BRIDGE_CHANNELS_ENABLED=%s. The first active row would make "
                         "this tenant decided by rows, and %s would go OFF. Reactivate or "
                         "decide %s in Configurator -> Notifications -> Channels."
                         % (", ".join(conflict), "has" if len(conflict) == 1 else "have",
                            "is" if len(conflict) == 1 else "are", shown,
                            ", ".join(conflict), "it" if len(conflict) == 1 else "them"))
            return {"mode": "conflict", "create": [], "lines": lines}
        mode = "env"
        for code in order:
            if code in present:
                lines.append("%-8s existing inactive row — untouched (off, as today)" % code)
                continue
            on = code in allowlist
            create.append(_allowlist_row(defaults_by_code[code], on))
            lines.append("%-8s seed %-3s — %s NOVU_BRIDGE_CHANNELS_ENABLED=%s and the tenant "
                         "has no channel rows, so this is what novu-bridge does today"
                         % (code, "ON" if on else "off", "listed in" if on else "not in", shown))
    else:
        every = legacy_rows + new_rows
        resumable = (allowlist is not None and missing
                     and all(active and _is_allowlist_seed(d, allowlist) for d, active in every))
        mode = "resume" if resumable else "rows"
        for code in order:
            if code in governing:
                lines.append("%-8s existing row in %s (enabled=%s) — untouched"
                             % (code, where, str(bool(governing[code].get("enabled"))).lower()))
            elif code in present:
                lines.append("%-8s existing row that novu-bridge does not use (inactive, or "
                             "in the namespace it is not reading) — untouched" % code)
            elif mode == "resume":
                on = code in allowlist
                create.append(_allowlist_row(defaults_by_code[code], on))
                lines.append("%-8s seed %-3s — finishing an interrupted allowlist seed "
                             "(NOVU_BRIDGE_CHANNELS_ENABLED=%s)"
                             % (code, "ON" if on else "off", shown))
            else:
                row = dict(defaults_by_code[code])
                row["enabled"] = False
                create.append(row)
                note = ""
                if allowlist is not None and code in allowlist:
                    note = (" NOTE: %s IS on NOVU_BRIDGE_CHANNELS_ENABLED, but that list is "
                            "not consulted for a tenant with channel rows — it is already "
                            "OFF here. Switch it on in Configurator -> Notifications -> "
                            "Channels if it should deliver." % code)
                lines.append("%-8s seed off — the tenant's rows already decide its channels "
                             "and a channel with no row is off, so nothing changes.%s"
                             % (code, note))

    # Enabled first: the first row to land flips the tenant to "decided by rows"; if a
    # later create then fails, the channel left without a row is one that was off anyway.
    create.sort(key=lambda r: not r.get("enabled"))
    return {"mode": mode, "create": create, "lines": lines}


def seed_channel_policy(tok):
    """Create the legacy channel rows decide_channel_rows asks for.

    Returns (created, present, failed, core_failed). core_failed is True when a channel
    that is ON today was left without a row after another row landed — i.e. this run
    switched a delivering channel off — or when the decision could not be made.
    """
    defaults = _load_default_rows(LEGACY_CHANNEL)
    if defaults is None:
        print("  ! channel policy: MISSING FILE %s.json in %s" % (LEGACY_CHANNEL, DATA_DIR))
        return 0, 0, 1, True
    legacy = search_rows(tok, LEGACY_CHANNEL)
    new = search_rows(tok, NEW_CHANNEL)
    if new is None and find_schema(tok, NEW_CHANNEL) is None:
        new = []  # no schema = no rows there; the bridge reads the legacy master then
    if legacy is None or new is None:
        print("  channel policy: SEARCH FAILED — no channel rows written (cannot tell "
              "whether this tenant already has any, and guessing could switch it off)")
        return 0, 0, 1, True

    allowlist = parse_allowlist(CHANNELS_ALLOWLIST_RAW)
    decision = decide_channel_rows(defaults, legacy, new, allowlist)
    print("CHANNEL-POLICY: tenant=%s mode=%s allowlist=%s"
          % (TENANT, decision["mode"],
             "(unset)" if allowlist is None else (",".join(sorted(allowlist)) or '""')))
    for line in decision["lines"]:
        print("  channel %s" % line)

    created = present = failed = 0
    lost_on = []
    for row in decision["create"]:
        result = create_row(tok, LEGACY_CHANNEL, row)
        if result == "created":
            created += 1
        elif result == "dup":
            present += 1
        else:
            failed += 1
            if row.get("enabled"):
                lost_on.append(_channel_code(row))
    print("  data %-45s +%d created, %d already-present, %d FAILED (%d decided)"
          % (LEGACY_CHANNEL, created, present, failed, len(decision["create"])))
    core = False
    if lost_on and created:
        # Some rows landed, an enabled one did not: the tenant is now decided by rows and
        # these channels, which deliver today, have none. A re-run finishes the seed
        # (mode=resume), so fail loudly now rather than leave it for the operator to find.
        print("CHANNEL-POLICY-INCOMPLETE: %s delivered through NOVU_BRIDGE_CHANNELS_ENABLED "
              "but got no row, and other rows did land — %s is OFF until this is re-run"
              % (", ".join(lost_on), "it" if len(lost_on) == 1 else "they"))
        core = True
    elif failed:
        core = True
    return created, present, failed, core


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


def ensure_schemas(tok, schema_file, codes):
    """search-then-create/update every code in `schema_file`. Missing file = fatal."""
    if not os.path.exists(schema_file):
        sys.exit("ERROR: schema file %s not staged" % schema_file)
    with open(schema_file, encoding="utf-8") as fh:
        schemas = {s.get("code"): s for s in json.load(fh)}
    for code in codes:
        if code not in schemas:
            sys.exit("ERROR: schema %s not found in %s" % (code, schema_file))
        live = find_schema(tok, code)
        if live is None:
            create_schema(tok, schemas[code])
            print("  schema CREATED %s" % code)
            continue
        added = missing_properties(live, schemas[code])
        if not added:
            print("  schema EXISTS  %s" % code)
            continue
        # mdms-v2 cannot change a stored schema: POST /mdms-v2/schema/v1/_update answers
        # 501 Not Implemented (verified against the deployed image), and the gateway has
        # no access-control action for it either. So do not try. It is harmless for the
        # legacy RAINMAKER-PGR masters, which are read-only now — configuration is written
        # to NOTIFICATIONS.*, whose schemas are created fresh from the committed file. For
        # any other schema it means rows carrying the new field will be rejected until the
        # definition is replaced in the database by hand, so say so plainly.
        legacy = code.startswith("RAINMAKER-PGR.")
        print("  schema STALE   %s lacks %s — mdms-v2 cannot update schemas in place%s"
              % (code, ", ".join(added),
                 " (harmless: this legacy master is read-only now)" if legacy
                 else " — writes carrying these fields will be REJECTED"))


def run_access_phase(tok):
    """Job 1. Returns (created, dup, failed)."""
    if not SEED_ACL:
        print("  access-control  SKIPPED (SEED_ACCESS_CONTROL=0)")
        return 0, 0, 0
    created, dup, failed = seed_access_control(tok)
    print("  access-control  +%d created, %d already-present, %d FAILED "
          "(%d actions, %d roleactions)"
          % (created, dup, failed, len(NOTIF_ACTIONS), sum(len(a[6]) for a in NOTIF_ACTIONS)))
    if created:
        # egov-accesscontrol caches role-actions in memory: new rows are invisible until
        # it restarts. The playbook greps for this marker and restarts it before running
        # the data phase.
        print("ACL-CHANGED: %d access-control row(s) created — restart egov-accesscontrol"
              % created)
    return created, dup, failed


def run_data_phase(tok):
    """Jobs 2-5. Returns the process exit code."""
    ensure_schemas(tok, SCHEMA_FILE, NOTIF_CODES)
    # The module-neutral schemas. NOTE the schema upgrade path compares PROPERTY NAMES
    # only: a changed x-unique, required, enum or property type on an EXISTING schema is
    # invisible and never pushed (missing_properties). These five must be right the
    # first time — there is no in-place key migration.
    if COPY_TO_NEW:
        ensure_schemas(tok, NOTIF_SCHEMA_FILE, NEW_CODES)
    time.sleep(3)  # let schema definitions settle before data validates against them

    total_created = total_dup = 0
    failed_masters = []
    for code in NOTIF_CODES:
        if code == LEGACY_CHANNEL:
            continue  # decided by seed_channel_policy below, never copied from the file
        path = os.path.join(DATA_DIR, code + ".json")
        if not os.path.exists(path):
            # Fail loudly: a master listed here but not staged is exactly how
            # NotificationChannel silently never got seeded.
            print("  ! data %-45s MISSING FILE %s" % (code, path))
            failed_masters.append(code)
            continue
        with open(path, encoding="utf-8") as fh:
            rows = json.load(fh)
        c = d = f = 0
        for row in rows:
            r = create_row(tok, code, row)
            c += (r == "created"); d += (r == "dup"); f += r in ("failed", "forbidden")
        total_created += c; total_dup += d
        if f:
            failed_masters.append(code)
        print("  data %-45s +%d created, %d already-present, %d FAILED (%d in file)" % (code, c, d, f, len(rows)))

    ch_created, ch_present, _, ch_core = seed_channel_policy(tok)
    total_created += ch_created; total_dup += ch_present
    if ch_core:
        failed_masters.append(LEGACY_CHANNEL)

    # The copy runs AFTER the legacy data on purpose: on a fresh tenant the legacy rows
    # have just been created, so the copy converts them and both namespaces end up
    # consistent without a second branch. (Converting the committed legacy seed is
    # byte-identical to the committed NOTIFICATIONS.* defaults — notifications_convert.py
    # --check pins it.)
    copy_created = copy_failed = 0
    routing_held = False
    if COPY_TO_NEW:
        copy_created, copy_present, copy_failed, routing_held = seed_new_namespace(tok)
        total_created += copy_created; total_dup += copy_present
    else:
        print("  copy            SKIPPED (COPY_TO_NOTIFICATIONS=0)")

    time.sleep(3)
    print("verify (tenant=%s):" % TENANT)
    for code in NOTIF_CODES + (NEW_CODES if COPY_TO_NEW else []):
        print("  %-45s %s rows" % (code, count_rows(tok, code)))
    # Core = Routing + Template (who + what) + Channel (whether). ProviderTemplate is the
    # WhatsApp ContentSid layer; a failure there is a WARNING, not fatal to the install —
    # the deploy still gets working SMS/Email notifications.
    core_failed = [c for c in failed_masters if c != "RAINMAKER-PGR.NotificationProviderTemplate"]
    note = ""
    if failed_masters:
        note = "  WARNING: failures in %s" % ", ".join(m.split(".")[-1] for m in failed_masters)
    if copy_failed:
        # LOUD but NOT fatal. novu-bridge reads NOTIFICATIONS.* for a tenant only once it
        # has NOTIFICATIONS.Routing rows, and Routing is copied last and only when the
        # templates made it (NOTIFICATIONS-ROUTING-HELD otherwise) — so a tenant whose
        # copy did not finish keeps being served from its legacy masters and keeps
        # delivering. What an incomplete copy does cost: the Configurator shows the tenant
        # read-only as "not migrated". Re-running is safe and finishes it.
        note += "  WARNING: %d NOTIFICATIONS.* master(s) not copied" % copy_failed
        print("NOTIFICATIONS-COPY-FAILED: %d master(s)%s — re-run with --tags notifications; "
              "the legacy rows are untouched"
              % (copy_failed, " (routing held back)" if routing_held else ""))
    if copy_created:
        # Machine-greppable: the playbook and enable-notifications.sh key off this to
        # report that a tenant's config moved into the new namespace on THIS run.
        print("NOTIFICATIONS-COPIED: %d row(s) created in the NOTIFICATIONS.* namespace"
              % copy_created)
    if total_created:
        print("ROWS-CREATED: %d" % total_created)
    if FORBIDDEN:
        print("NOTIF-FORBIDDEN: 403 on %s — restart egov-accesscontrol and run the data "
              "phase again" % ", ".join(FORBIDDEN))
    print("DONE: %d created, %d already-present.%s" % (total_created, total_dup, note))
    if FORBIDDEN:
        return 3
    return 2 if core_failed else 0


def main():
    if not URL or not TENANT:
        sys.exit("ERROR: DIGIT_URL and NOTIF_TENANT are required")
    if PHASE not in ("all", "access", "data"):
        sys.exit("ERROR: NOTIF_SEED_PHASE must be all, access or data (got %r)" % PHASE)
    print("seed-notifications: tenant=%s url=%s phase=%s" % (TENANT, URL, PHASE))
    tok = token()

    if PHASE in ("all", "access"):
        acl_created, acl_dup, acl_failed = run_access_phase(tok)
        if PHASE == "access":
            print("DONE: access phase — %d created, %d already-present, %d failed."
                  % (acl_created, acl_dup, acl_failed))
            sys.exit(0)
        if acl_created:
            # The rows this run just created are not in egov-accesscontrol's cache yet,
            # so every write they authorize would be refused. Stop before writing any
            # data rather than leave a half-written tenant.
            print("STOPPED before the data phase: restart egov-accesscontrol "
                  "(docker restart egov-accesscontrol), wait for it, then run this again "
                  "(or with NOTIF_SEED_PHASE=data). Nothing else was written.")
            print("DONE: access phase only — %d created." % acl_created)
            sys.exit(3)
    sys.exit(run_data_phase(tok))


if __name__ == "__main__":
    main()
