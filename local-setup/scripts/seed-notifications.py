#!/usr/bin/env python3
"""Seed the notification MDMS SOFTWARE a deploy owns — schemas, access-control rows,
channel rows from the env allowlist — and the shipped default configuration for a tenant
that has NO notification configuration at all. The standalone, idempotent equivalent of
what DDH's MdmsBulkLoader does inside a full tenant bootstrap, scoped to notifications.

A DEPLOY UPGRADES SOFTWARE ONLY. It never moves a tenant's configuration:

  - a tenant with 2.12 configuration (RAINMAKER-PGR.NotificationRouting / Template /
    ProviderTemplate rows) and no NOTIFICATIONS.Routing row is LEFT ON IT. novu-bridge
    keeps serving it through its legacy read adapter, byte for byte, until an operator
    reviews `migrate-notifications.py plan` and runs `apply` for it. Nothing is copied
    into NOTIFICATIONS.*, and the shipped default rows are never merged into its legacy
    masters (that added every default notification a customised tenant never had).
  - a tenant already on NOTIFICATIONS.* (any NOTIFICATIONS.Routing row, active or not) is
    left exactly as it is: no default row is added to it either.
  - a tenant with NO configuration in either namespace (a fresh install) gets the shipped
    defaults, written STRAIGHT into NOTIFICATIONS.* — never into the legacy masters. There
    is nothing on such a tenant to review or preserve, so routing it through the legacy
    masters and a migration would only create a tenant that starts out "not migrated"
    (read-only in the Configurator) with a second copy of every row.

Single source of truth: the SAME committed JSON that ships in the default-data-handler
image —
  schema:  utilities/default-data-handler/src/main/resources/schema/{RAINMAKER-PGR,NOTIFICATIONS}.json
  data:    utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS/
            NOTIFICATIONS.{Routing,Template,ProviderTemplate,EventCatalogue}.json
            (generated from the legacy defaults by notifications_convert.py, --check pins it)
           mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.NotificationChannel.json (row shapes only)

Channel rows are the one master whose rows CHANGE BEHAVIOUR the moment they exist:
novu-bridge's ChannelPolicyClient lets a tenant with ANY active channel row be decided
by those rows alone (no row = off), and only a tenant with none falls back to the
deployment's NOVU_BRIDGE_CHANNELS_ENABLED allowlist. So the channel rows are never
copied blindly from the committed all-off file:

  - a tenant with NO channel rows in either namespace is seeded from the allowlist the
    bridge runs with (NOTIF_CHANNELS_ALLOWLIST): enabled = the channel is on that list.
    An upgraded tenant therefore keeps delivering exactly what it delivered before, and
    a brand-new deployment with an empty allowlist gets every channel off — the
    intended out-of-box default. `gateway` is left out of these rows so the
    deployment's NOVU_BRIDGE_SMS_PROVIDER keeps choosing the SMS transport, as today.
    They go to the namespace the tenant's configuration is in: the legacy master for a
    tenant still on its 2.12 configuration (the migration copies them), NOTIFICATIONS.Channel
    otherwise.
  - a tenant that already has channel rows is left alone entirely: nothing is added
    (a channel without a row is already off) and existing rows are never modified. The
    one exception is finishing an allowlist seed that an earlier run left half done.
  - NOTIF_CHANNELS_ALLOWLIST not supplied: no channel rows are written at all, rather
    than guessing (the tenant stays on the env allowlist).

Jobs, all idempotent, all safe to re-run — which is what makes both "fresh install"
and "upgrade" work from the one task. They run in this order:

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
               schemas (the bridge's legacy adapter reads them) and the five
               NOTIFICATIONS.* ones. A schema that EXISTS but is missing properties the
               committed definition has is reported as STALE (mdms-v2 cannot update a
               schema in place).
  3. state     which configuration the tenant has (NOTIFICATIONS-STATE: legacy |
               notifications | fresh), by the rule above.
  4. channels  channel rows for a tenant that has none, by the rule above.
  5. defaults  fresh tenants only: the shipped defaults into NOTIFICATIONS.*, the event
               catalogue generated from the tenant's LIVE workflow (the committed file
               when egov-workflow-v2 cannot answer). Routing is written LAST and only when
               every Template and ProviderTemplate write succeeded: the bridge serves a
               tenant from NOTIFICATIONS.* the moment it has one NOTIFICATIONS.Routing row.
               A held-back routing write leaves the tenant "fresh", so a re-run finishes it.
  6. verify    row counts per master, on both namespaces.

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
  DATA_DIR           dir holding the staged *.json data files
  WORKFLOW_FILE      workflow template the catalogue falls back to before the committed
                     catalogue file (default: the repo's PgrWorkflowConfig.json, if present)
  NOTIF_SEED_PHASE   all | access | data                           (default: all)
                     access = job 1 only; data = jobs 2-6; all = job 1, then jobs 2-6
                     unless job 1 created rows (then exit 3: restart accesscontrol).
  NOTIF_CHANNELS_ALLOWLIST  the NOVU_BRIDGE_CHANNELS_ENABLED value novu-bridge runs
                     with, e.g. "SMS,EMAIL"; "" = nothing enabled. UNSET = unknown,
                     and a tenant without channel rows gets none (see above).
  SEED_ACCESS_CONTROL  set to 0 to skip job 1                      (default: 1)
  (COPY_TO_NOTIFICATIONS is no longer read: the deploy never copies a tenant's
   configuration. Migrating it is migrate-notifications.py's job.)
"""
import os, sys, json, time, urllib.request, urllib.parse, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import notifications_convert as nc
except ImportError:  # pragma: no cover - staging bug, reported in main()
    nc = None
try:
    import generate_event_catalogue as gec
except ImportError:  # not staged: the catalogue comes from the committed file
    gec = None

# Read lazily-ish: an empty value is validated in main(). Kept as module constants so
# test_acl_dump_parity.py can import this file and diff NOTIF_ACTIONS against the dump
# without a live DIGIT. migrate-notifications.py imports this module too and sets URL /
# USERNAME / PASSWORD / LOGIN_TENANT / DATA_DIR itself; every I/O helper below takes the
# tenant as an argument (defaulting to TENANT) so one process can serve many tenants.
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
WORKFLOW_FILE = os.environ.get("WORKFLOW_FILE", os.path.join(
    _here, "..", "dataloader", "templates", "PgrWorkflowConfig.json"))
SEED_ACL = os.environ.get("SEED_ACCESS_CONTROL", "1") not in ("0", "false", "no")
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
# The configuration proper (who, what) — as opposed to channel policy (whether).
LEGACY_CONTENT = (
    "RAINMAKER-PGR.NotificationRouting",
    "RAINMAKER-PGR.NotificationTemplate",
    "RAINMAKER-PGR.NotificationProviderTemplate",
)
NEW_CONTENT = ("NOTIFICATIONS.Routing", "NOTIFICATIONS.Template", "NOTIFICATIONS.ProviderTemplate")
NEW_ROUTING = "NOTIFICATIONS.Routing"
NEW_CATALOGUE = "NOTIFICATIONS.EventCatalogue"

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
# The order NOTIFICATIONS.* rows are written in (write_new_namespace), by the deploy's
# fresh-tenant seed and by migrate-notifications.py alike. Routing is LAST on purpose:
# novu-bridge serves a tenant from NOTIFICATIONS.* the moment that tenant has a single
# NOTIFICATIONS.Routing row (MdmsNotificationConfigRepository.load), so a routing row
# that lands before its templates switches the tenant to a namespace with nothing to
# render. Channel goes before Routing because it has its own all-or-nothing switch
# (ChannelPolicyClient) and does not depend on Routing.
COPY_ORDER = [
    "NOTIFICATIONS.EventCatalogue",
    "NOTIFICATIONS.Template",
    "NOTIFICATIONS.ProviderTemplate",
    "NOTIFICATIONS.Channel",
    "NOTIFICATIONS.Routing",
]
# A failure in any of these holds the Routing write back for the tenant. The catalogue is
# one of them: novu-bridge REJECTS (and dead-letters) an event whose eventName is missing
# from a NON-EMPTY NOTIFICATIONS.EventCatalogue, whichever namespace serves the tenant
# (NotificationResolver.requireCatalogued), so a partial catalogue drops notifications on
# its own. It is written FIRST: MDMS v2 creates one row per call and has no delete, so a
# catalogue cannot appear in one step; written first, a failure is known before routing
# could switch the tenant, and routing is held. Written last beside routing, the same
# one-row-at-a-time window would exist, but a failure would be found after the switch.
ROUTING_PREREQUISITES = ("NOTIFICATIONS.EventCatalogue", "NOTIFICATIONS.Template",
                         "NOTIFICATIONS.ProviderTemplate")
# How long novu-bridge serves a non-empty config read from cache
# (novu.bridge.notifications.cache.ttl.ms default): the tail of the catalogue window.
BRIDGE_CACHE_SECONDS = 60

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


def find_schema(tok, code, tenant=None):
    """The live SchemaDefinition for `code`, or None."""
    body = ri(tok); body["SchemaDefCriteria"] = {"tenantId": tenant or TENANT, "codes": [code]}
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


def create_schema(tok, sdef, tenant=None):
    sdef = dict(sdef); sdef["tenantId"] = tenant or TENANT
    body = ri(tok); body["SchemaDefinition"] = _strip_empty_ref(sdef)
    _post("/mdms-v2/schema/v1/_create", body, tok).read()


def missing_properties(live, committed):
    """Property names the committed definition has and the live one does not."""
    lp = ((live or {}).get("definition") or {}).get("properties") or {}
    cp = ((committed or {}).get("definition") or {}).get("properties") or {}
    return sorted(set(cp) - set(lp))



def create_row(tok, code, row, is_active=None, tenant=None):
    body = ri(tok)
    if is_active is None:
        is_active = bool(row.get("active", row.get("isActive", True)))
    body["Mdms"] = {"tenantId": tenant or TENANT, "schemaCode": code, "data": row,
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
    except (urllib.error.URLError, OSError) as e:
        print("    ! %s row FAILED: %s" % (code, e))
        return "failed"


def count_rows(tok, code, tenant=None):
    """Total rows for `code`, ACTIVE AND INACTIVE. Uses mdms-v2 _count when the build
    has it and otherwise falls back to paging, because the old single-page _search with
    limit=200 silently under-reported any master that outgrew the page."""
    body = ri(tok)
    body["MdmsCriteria"] = {"tenantId": tenant or TENANT, "schemaCode": code}
    try:
        r = json.load(_post("/mdms-v2/v2/_count", body, tok))
        total = r.get("totalCount")
        if isinstance(total, int):
            return total
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
        pass
    rows = search_rows(tok, code, tenant)
    return -1 if rows is None else len(rows)


# Paging constants. Every MDMS read in this script goes through search_rows: a single
# limit=200 page is a known bug class in this repo (configurator #953), and a live
# tenant's notification masters have already drifted past the repo's 24/42/14 defaults.
PAGE = 100
MAX_PAGES = 200  # 20k rows; a safety ceiling, not an expected bound


def search_rows(tok, code, tenant=None):
    """EVERY row for `code`, active and inactive, as the raw mdms records.

    Returns None when the search itself fails, which the caller must treat as "unknown",
    never as "empty" — a failed read that looked like zero rows would make a tenant with
    configuration look fresh and get the shipped defaults written over it.

    No isActive criterion is pushed down, so inactive rows come back too: an operator who
    deactivated a routing row expects it to still be deactivated after a migration, and
    the bridge's namespace switch counts inactive NOTIFICATIONS.Routing rows as well.
    """
    out, seen, offset = [], set(), 0
    for _ in range(MAX_PAGES):
        body = ri(tok)
        # mdms-v2 _search takes the schemaCode in the BODY (not the path — that
        # path variant silently returns 0). Same quirk the configurator hit.
        body["MdmsCriteria"] = {"tenantId": tenant or TENANT, "schemaCode": code,
                                "limit": PAGE, "offset": offset}
        try:
            page = json.load(_post("/mdms-v2/v2/_search", body, tok)).get("mdms") or []
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError):
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
    print("    ! %s: stopped paging at %d rows (safety ceiling) — the read may be "
          "incomplete" % (code, len(out)))
    return out


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
    """[(data dict, effective active)] from raw mdms records — the flag novu-bridge uses:
    the record's isActive AND the data's own active flag (notifications_convert.record_active)."""
    out = []
    for rec in records or []:
        data = rec.get("data")
        if not isinstance(data, dict):
            continue
        out.append((data, nc.record_active(rec) if nc else rec.get("isActive") is not False))
    return out


def _load_default_rows(code):
    path = os.path.join(DATA_DIR, code + ".json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ── Writing NOTIFICATIONS.* rows safely (shared with migrate-notifications.py) ──

def write_new_namespace(tok, planned, tenant=None, label="write"):
    """Create the `planned` NOTIFICATIONS.* rows for one tenant, in COPY_ORDER.

    planned: {new code: [(row, active)]}. A row whose x-unique key is already present is
    skipped and counted as present — never modified. Routing is written last and HELD
    BACK when any Template/ProviderTemplate write failed, or when their existing rows
    could not be read: the first NOTIFICATIONS.Routing row moves the tenant onto this
    namespace, and templates missing there would make its events send nothing.

    Returns {"by_code": {code: {"planned", "created", "present", "failed",
                                "started", "finished"}},
             "routing_held": bool, "blockers": [code, ...], "order": [code written, ...]}.
    started/finished are UTC timestamps of the first and last create for that master.
    """
    tenant = tenant or TENANT
    result = {"by_code": {}, "routing_held": False, "blockers": [], "order": []}
    for code in COPY_ORDER:
        rows = list(planned.get(code) or [])
        stats = {"planned": len(rows), "created": 0, "present": 0, "failed": 0}
        result["by_code"][code] = stats
        if not rows:
            continue
        if code == NEW_ROUTING:
            blockers = [c for c in ROUTING_PREREQUISITES if result["by_code"].get(c, {}).get("failed")]
            if blockers:
                result["routing_held"] = True
                result["blockers"] = blockers
                stats["failed"] = len(rows)
                print("  %s %-33s HELD BACK — %s did not write completely; writing routing now "
                      "would move %s onto NOTIFICATIONS.* with templates missing. It stays on "
                      "what it has; re-run to finish."
                      % (label, code, " and ".join(b.split(".")[-1] for b in blockers), tenant))
                print("NOTIFICATIONS-ROUTING-HELD: %s — %s incomplete" % (tenant, ", ".join(blockers)))
                continue
        existing = search_rows(tok, code, tenant)
        if existing is None:
            stats["failed"] = len(rows)
            print("  %s %-33s SEARCH FAILED — skipped (cannot tell present from absent, and "
                  "guessing would duplicate or overwrite)" % (label, code))
            continue
        present_keys = {_unique_key(code, data) for data, _ in _record_rows(existing)}
        if code == NEW_CHANNEL:
            # Enabled rows first: the first row to land makes this tenant "decided by
            # rows", so if a later create fails, the missing row is one that was off anyway.
            rows.sort(key=lambda item: not (item[1] and item[0].get("enabled")))
        for row, active in rows:
            key = _unique_key(code, row)
            if key in present_keys:
                stats["present"] += 1
                continue
            stats.setdefault("started", _utc())
            outcome = create_row(tok, code, row, is_active=active, tenant=tenant)
            stats["finished"] = _utc()
            if outcome == "created":
                stats["created"] += 1
                present_keys.add(key)
            elif outcome == "dup":
                stats["present"] += 1
                present_keys.add(key)
            else:
                stats["failed"] += 1
        result["order"].append(code)
        print("  %s %-33s +%d created, %d already-present, %d FAILED (%d planned)"
              % (label, code, stats["created"], stats["present"], stats["failed"], stats["planned"]))
        if code == NEW_CATALOGUE and stats["created"]:
            first = not existing
            print("  %s %-33s written %s → %s%s" % (
                label, code, stats["started"], stats["finished"],
                (" — the tenant's FIRST catalogue: until it was complete, and for up to %d s of "
                 "bridge cache after, an event whose type was not yet written could be REJECTED "
                 "(NB_EVENT_NOT_IN_CATALOGUE, Logs + novu-bridge.dlq)" % BRIDGE_CACHE_SECONDS)
                if first else ""))
            if stats["failed"]:
                print("NOTIFICATIONS-CATALOGUE-INCOMPLETE: %s — %d of %d catalogue rows written. "
                      "novu-bridge now REJECTS every event whose type is missing from it; re-run "
                      "NOW to finish it." % (tenant, stats["created"] + stats["present"],
                                             stats["planned"]))
    return result


def _utc():
    """Now, UTC, to the millisecond (the catalogue window is usually well under a second)."""
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ── Which configuration a tenant has ────────────────────────────────────────

def deploy_state(tok, tenant=None):
    """('notifications' | 'legacy' | 'fresh' | None, {code: row count}).

    notifications  at least one NOTIFICATIONS.Routing row (active or not): novu-bridge
                   serves the tenant from NOTIFICATIONS.* — the deploy leaves it alone
    legacy         2.12 rows in RAINMAKER-PGR.Notification{Routing,Template,
                   ProviderTemplate} and no NOTIFICATIONS.Routing: served through the
                   bridge's legacy adapter until migrate-notifications.py moves it
    fresh          neither: nothing to preserve, the shipped defaults are seeded
    None           a read failed; nothing may be decided (or written) from that
    """
    counts = {}
    for code in (NEW_ROUTING,) + LEGACY_CONTENT:
        rows = search_rows(tok, code, tenant)
        if rows is None:
            return None, counts
        counts[code] = len(rows)
    if counts[NEW_ROUTING]:
        return "notifications", counts
    if any(counts[c] for c in LEGACY_CONTENT):
        return "legacy", counts
    return "fresh", counts


def event_catalogue_rows(tok, tenant=None):
    """(rows, origin) — NOTIFICATIONS.EventCatalogue rows for the workflow `tenant` RUNS.

    The live PGR BusinessService from egov-workflow-v2 first; then the workflow template
    (WORKFLOW_FILE, the repo's PgrWorkflowConfig.json); then the committed catalogue file.
    `origin` says which one answered and why the earlier ones did not, so a caller can
    print the fallback as the warning it is. rows is None when none of them could.
    """
    tenant = tenant or TENANT
    why = []
    if gec is not None:
        try:
            return gec.build_live_catalogue(URL, tok, tenant), "the live PGR workflow at %s" % tenant
        except gec.WorkflowUnavailable as exc:
            why.append(str(exc))
        except (KeyError, TypeError, ValueError, SystemExit) as exc:
            why.append("live workflow at %s unusable: %s" % (tenant, exc))
        if WORKFLOW_FILE and os.path.exists(WORKFLOW_FILE):
            try:
                with open(WORKFLOW_FILE, encoding="utf-8") as fh:
                    rows = gec.build_catalogue(json.load(fh))
                return rows, "the repo workflow template %s (FALLBACK: %s)" % (
                    os.path.basename(WORKFLOW_FILE), "; ".join(why))
            except (OSError, ValueError, SystemExit) as exc:
                why.append("workflow file unusable: %s" % exc)
    else:
        why.append("generate_event_catalogue.py not staged")
    rows = _load_default_rows(NEW_CATALOGUE)
    if rows is None:
        return None, "no catalogue source (%s; no %s.json in %s)" % ("; ".join(why), NEW_CATALOGUE, DATA_DIR)
    return rows, "the committed catalogue file (FALLBACK: %s)" % "; ".join(why)


def shipped_default_rows(tok, tenant=None):
    """({new code: [(row, active)]}, catalogue origin, [missing file, ...]) — the shipped
    defaults a fresh tenant starts from. Channel rows are not among them: those come from
    the allowlist decision, never from a file."""
    planned, missing = {}, []
    for code in ("NOTIFICATIONS.Template", "NOTIFICATIONS.ProviderTemplate", NEW_ROUTING):
        rows = _load_default_rows(code)
        if rows is None:
            missing.append(code + ".json")
            continue
        planned[code] = [(row, nc.is_active(row)) for row in rows]
    catalogue, origin = event_catalogue_rows(tok, tenant)
    if catalogue is None:
        missing.append(NEW_CATALOGUE + ".json")
    else:
        planned[NEW_CATALOGUE] = [(row, nc.is_active(row)) for row in catalogue]
    return planned, origin, missing


def seed_fresh_defaults(tok, tenant=None):
    """Job 5 for a fresh tenant. Returns (created, present, failed, routing_held)."""
    planned, origin, missing = shipped_default_rows(tok, tenant)
    for name in missing:
        print("  defaults: NO staged default file %s in %s" % (name, DATA_DIR))
    if missing and any(name.startswith(("NOTIFICATIONS.Template", "NOTIFICATIONS.Routing"))
                       for name in missing):
        # Without templates or routing a fresh tenant would get half a configuration.
        # Write nothing; the tenant stays fresh and a re-run with the files staged seeds it.
        return 0, 0, 1, False
    print("  defaults: event catalogue from %s" % origin)
    result = write_new_namespace(tok, planned, tenant, label="defaults")
    created = sum(s["created"] for s in result["by_code"].values())
    present = sum(s["present"] for s in result["by_code"].values())
    failed = sum(s["failed"] for s in result["by_code"].values()) + len(missing)
    return created, present, failed, result["routing_held"]


# ── The channel decision ─────────────────────────────────────────────────────
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
    """Which channel rows to create, and why. Pure.

    Returns {"mode", "create": [row, ...] enabled-first, "lines": [str, ...]}.
    mode is one of:
      env      no channel rows anywhere: seed every channel from the allowlist
      resume   rows exist but are exactly a partial `env` seed of this same allowlist
               (a run that died half way): finish it with the same rule
      rows     rows already decide: write nothing (a channel without a row is off)
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
                # Nothing is written: the tenant's rows decide its channels and a channel
                # without a row is off. Adding an off-row would change nothing today, but
                # it is still a row this tenant never had (a 2.12 tenant would carry it
                # into its migration), and a deploy adds nothing to a configured tenant.
                note = ""
                if allowlist is not None and code in allowlist:
                    note = (" NOTE: %s IS on NOVU_BRIDGE_CHANNELS_ENABLED, but that list is "
                            "not consulted for a tenant with channel rows — it is OFF here. "
                            "Switch it on in Configurator -> Notifications -> Channels if it "
                            "should deliver." % code)
                lines.append("%-8s no row — left alone: the tenant's rows already decide its "
                             "channels and a channel without a row is off.%s" % (code, note))

    # Enabled first: the first row to land flips the tenant to "decided by rows"; if a
    # later create then fails, the channel left without a row is one that was off anyway.
    create.sort(key=lambda r: not r.get("enabled"))
    return {"mode": mode, "create": create, "lines": lines}


def channel_target(legacy_records, new_records, state):
    """The master new channel rows go to: the one whose rows decide today, else the
    namespace the tenant's configuration is in (legacy for a tenant still on its 2.12
    masters, so the migration carries them across with the rest; NOTIFICATIONS.Channel
    otherwise). Writing a lone off-row into NOTIFICATIONS.Channel next to governing
    legacy rows would make it the governing namespace and switch every channel off."""
    if _governing(new_records):
        return NEW_CHANNEL
    if _governing(legacy_records):
        return LEGACY_CHANNEL
    return LEGACY_CHANNEL if state == "legacy" else NEW_CHANNEL


def seed_channel_policy(tok, state, tenant=None):
    """Create the channel rows decide_channel_rows asks for, in channel_target's master.

    Returns (created, present, failed, core_failed). core_failed is True when a channel
    that is ON today was left without a row after another row landed — i.e. this run
    switched a delivering channel off — or when the decision could not be made.
    """
    tenant = tenant or TENANT
    defaults = _load_default_rows(LEGACY_CHANNEL)
    if defaults is None:
        print("  ! channel policy: MISSING FILE %s.json in %s" % (LEGACY_CHANNEL, DATA_DIR))
        return 0, 0, 1, True
    legacy = search_rows(tok, LEGACY_CHANNEL, tenant)
    new = search_rows(tok, NEW_CHANNEL, tenant)
    if new is None and find_schema(tok, NEW_CHANNEL, tenant) is None:
        new = []  # no schema = no rows there; the bridge reads the legacy master then
    if legacy is None or new is None:
        print("  channel policy: SEARCH FAILED — no channel rows written (cannot tell "
              "whether this tenant already has any, and guessing could switch it off)")
        return 0, 0, 1, True

    allowlist = parse_allowlist(CHANNELS_ALLOWLIST_RAW)
    decision = decide_channel_rows(defaults, legacy, new, allowlist)
    target = channel_target(legacy, new, state)
    print("CHANNEL-POLICY: tenant=%s mode=%s allowlist=%s target=%s"
          % (tenant, decision["mode"],
             "(unset)" if allowlist is None else (",".join(sorted(allowlist)) or '""'), target))
    for line in decision["lines"]:
        print("  channel %s" % line)

    created = present = failed = 0
    lost_on = []
    for row in decision["create"]:
        result = create_row(tok, target, row, tenant=tenant)
        if result == "created":
            created += 1
        elif result == "dup":
            present += 1
        else:
            failed += 1
            if row.get("enabled"):
                lost_on.append(_channel_code(row))
    print("  data %-45s +%d created, %d already-present, %d FAILED (%d decided)"
          % (target, created, present, failed, len(decision["create"])))
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


def ensure_schemas(tok, schema_file, codes, tenant=None):
    """search-then-create every code in `schema_file`. Missing file = fatal.
    Returns the codes it created."""
    tenant = tenant or TENANT
    if not os.path.exists(schema_file):
        sys.exit("ERROR: schema file %s not staged" % schema_file)
    with open(schema_file, encoding="utf-8") as fh:
        schemas = {s.get("code"): s for s in json.load(fh)}
    made = []
    for code in codes:
        if code not in schemas:
            sys.exit("ERROR: schema %s not found in %s" % (code, schema_file))
        live = find_schema(tok, code, tenant)
        if live is None:
            try:
                create_schema(tok, schemas[code], tenant)
            except urllib.error.HTTPError as e:
                if e.code != 403:
                    raise
                # Same contract as a refused row: exit 3 so the playbook restarts
                # egov-accesscontrol and runs the data phase again, instead of a traceback.
                FORBIDDEN.append("schema " + code)
                print("  ! schema %s FORBIDDEN (403): no role-action for /mdms-v2/schema/v1/_create "
                      "for this login's roles (or a stale login)" % code)
                continue
            made.append(code)
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
    return made


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
    """Jobs 2-6. Returns the process exit code."""
    ensure_schemas(tok, SCHEMA_FILE, NOTIF_CODES)
    # The module-neutral schemas. NOTE the schema upgrade path compares PROPERTY NAMES
    # only: a changed x-unique, required, enum or property type on an EXISTING schema is
    # invisible and never pushed (missing_properties). These five must be right the
    # first time — there is no in-place key migration.
    ensure_schemas(tok, NOTIF_SCHEMA_FILE, NEW_CODES)
    if FORBIDDEN:
        # Nothing below can be written without its schema.
        print("NOTIF-FORBIDDEN: 403 on %s — restart egov-accesscontrol and run the data "
              "phase again" % ", ".join(FORBIDDEN))
        print("DONE: 0 created, 0 already-present. (stopped before the data: schemas refused)")
        return 3
    time.sleep(3)  # let schema definitions settle before data validates against them

    total_created = total_dup = 0
    failed_masters = []

    state, counts = deploy_state(tok)
    shown = ", ".join("%s=%d" % (c.split(".")[-1], n) for c, n in counts.items())
    if state is None:
        # Deciding "fresh" from a failed read is exactly how a customised tenant would get
        # the defaults written over it. Write nothing; the caller sees exit 2.
        print("NOTIFICATIONS-STATE: tenant=%s state=UNKNOWN (a notification master could not "
              "be read) — nothing written" % TENANT)
        print("DONE: 0 created, 0 already-present.  WARNING: tenant state unreadable")
        return 2
    print("NOTIFICATIONS-STATE: tenant=%s state=%s (%s)" % (TENANT, state, shown))
    if state == "legacy":
        print("NOTIFICATIONS-MIGRATION-PENDING: tenant %s has its 2.12 configuration (%s legacy "
              "Routing/Template/ProviderTemplate rows) and no NOTIFICATIONS.Routing row. This "
              "deploy left it as it is: novu-bridge keeps serving it through the legacy "
              "adapter. Review and migrate it with "
              "`migrate-notifications.py plan --tenant %s`, then `apply --tenant %s --yes`."
              % (TENANT, "/".join(str(counts[c]) for c in LEGACY_CONTENT), TENANT, TENANT))
    elif state == "notifications":
        print("  config: %s is on NOTIFICATIONS.* — left as it is (a deploy adds no rows to a "
              "tenant's configuration)" % TENANT)

    ch_created, ch_present, _, ch_core = seed_channel_policy(tok, state)
    total_created += ch_created; total_dup += ch_present
    if ch_core:
        failed_masters.append("Channel")

    seed_created = seed_failed = 0
    routing_held = False
    if state == "fresh":
        seed_created, seed_present, seed_failed, routing_held = seed_fresh_defaults(tok)
        total_created += seed_created; total_dup += seed_present
        if seed_failed:
            failed_masters.append("defaults")

    time.sleep(3)
    print("verify (tenant=%s):" % TENANT)
    for code in NOTIF_CODES + NEW_CODES:
        print("  %-45s %s rows" % (code, count_rows(tok, code)))
    note = ""
    if failed_masters:
        note = "  WARNING: failures in %s" % ", ".join(failed_masters)
    if seed_failed:
        # A fresh tenant whose Routing was held has NO configuration in either namespace,
        # so it is still "fresh" and the next run finishes the seed. What is lost until
        # then: its notifications (there is nothing to serve).
        print("NOTIFICATIONS-SEED-INCOMPLETE: %d default row(s) not written for %s%s — re-run "
              "with --tags notifications" % (seed_failed, TENANT,
                                            " (routing held back)" if routing_held else ""))
    if seed_created:
        # Machine-greppable: the playbook keys off this to report that a fresh tenant got
        # the shipped defaults on THIS run.
        print("NOTIFICATIONS-SEEDED: %d default row(s) created in NOTIFICATIONS.* for %s"
              % (seed_created, TENANT))
    if total_created:
        print("ROWS-CREATED: %d" % total_created)
    if FORBIDDEN:
        print("NOTIF-FORBIDDEN: 403 on %s — restart egov-accesscontrol and run the data "
              "phase again" % ", ".join(FORBIDDEN))
    print("DONE: %d created, %d already-present.%s" % (total_created, total_dup, note))
    if FORBIDDEN:
        return 3
    # Core = the fresh defaults (who + what) and the channel rows (whether). A tenant that
    # is not fresh has no defaults to fail.
    return 2 if failed_masters else 0


def main():
    if not URL or not TENANT:
        sys.exit("ERROR: DIGIT_URL and NOTIF_TENANT are required")
    if PHASE not in ("all", "access", "data"):
        sys.exit("ERROR: NOTIF_SEED_PHASE must be all, access or data (got %r)" % PHASE)
    if nc is None:
        sys.exit("ERROR: notifications_convert.py is not staged next to this script")
    print("seed-notifications: tenant=%s url=%s phase=%s" % (TENANT, URL, PHASE))
    tok = token()

    if PHASE in ("all", "access"):
        acl_created, acl_dup, acl_failed = run_access_phase(tok)
        if PHASE == "access":
            print("DONE: access phase — %d created, %d already-present, %d failed."
                  % (acl_created, acl_dup, acl_failed))
            # Refused rows used to exit 0, so a deploy carried on with no notification
            # permissions and every later write 403'd. 3 = refused, 2 = other failure.
            sys.exit(3 if FORBIDDEN else (2 if acl_failed else 0))
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
