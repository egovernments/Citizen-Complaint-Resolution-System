#!/usr/bin/env python3
"""Give a state root the access-control rows of the configurator's workspace endpoints.

WHY THIS EXISTS
---------------
After sign-in the configurator calls POST /pgr-services/v2/onboarding/workspaces/_search, and
later _update and _rename. Kong authorizes each one through egov-accesscontrol, from the root's
ACCESSCONTROL-ACTIONS-TEST.actions-test and ACCESSCONTROL-ROLEACTIONS.roleactions rows.
pgr-services seeds those rows only into the workspaces signup provisions (PLATFORM_BASELINE) and
full-dump.sql has none, so a root that predates 2.20 refused them: its ACCOUNT_ADMIN signed in,
picked the workspace and got AccessDeniedException.

SOURCE
------
pgr-services' platform-baseline-v1.json (BASELINE_FILE): the actions whose url starts with
/pgr-services/v2/onboarding/workspaces/, and the baseline's role-actions on them.

CREATE-ONLY, MATCHED ON MEANING, NOT ON ID
------------------------------------------
  actions       by url. The root's action for a url is reused under whatever id it has. A
                missing one is created with the baseline id when no action at the root has
                that id, else with the next id above the root's highest.
  role-actions  by (rolecode, url): a grant of the role on any of the root's actions for that
                url. A missing one is created on the root's action, with the baseline id when
                no role-action at the root has it, else the next id above the root's highest.
Existing rows are never updated or deactivated. An inactive action or grant is reported and left
as it is, and a role the root does not have (ACCESSCONTROL-ROLES.roles) is reported and skipped.
A failed read writes nothing.

egov-accesscontrol caches role-actions for cache.expiry.role.action.minutes (15 by default), so
a grant created here takes effect within that.

Env:
  DIGIT_URL           Kong base, e.g. http://127.0.0.1:18000   (required)
  TENANT              the state root                             (required)
  BASELINE_FILE       path to platform-baseline-v1.json          (required)
  DIGIT_USERNAME      admin username                 (default: ADMIN)
  DIGIT_PASSWORD      admin password                 (default: eGov@123)
  DIGIT_LOGIN_TENANT  tenant to log in at            (default: $TENANT)

Prints WORKSPACE-ACCESS-CHANGED when it created rows. Exit 0 when nothing is missing that it may
create, 2 when a read or a write failed.
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error

URL = os.environ.get("DIGIT_URL", "").rstrip("/")
TENANT = os.environ.get("TENANT", "")
BASELINE_FILE = os.environ.get("BASELINE_FILE", "")
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
LOGIN_TENANT = os.environ.get("DIGIT_LOGIN_TENANT") or TENANT
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="

ACTIONS = "ACCESSCONTROL-ACTIONS-TEST.actions-test"
ROLEACTIONS = "ACCESSCONTROL-ROLEACTIONS.roleactions"
ROLES = "ACCESSCONTROL-ROLES.roles"
URL_PREFIX = "/pgr-services/v2/onboarding/workspaces/"
PAGE = 100
MAX_ROWS = 20000  # refuse to loop forever on a server that ignores offset
VISIBLE_TRIES, VISIBLE_DELAY = 40, 0.25  # mdms-v2 writes through its persister, not in the request


def _substitute(value, tenant):
    if isinstance(value, str):
        return value.replace("{tenantid}", tenant)
    if isinstance(value, list):
        return [_substitute(v, tenant) for v in value]
    if isinstance(value, dict):
        return {k: _substitute(v, tenant) for k, v in value.items()}
    return value


def _id(value):
    """An integer id, or None for anything else (ids arrive as numbers, sometimes as strings)."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else None


def select(baseline, tenant):
    """The baseline's workspace actions and its role-actions on them, for `tenant`."""
    records = baseline.get("records") or []
    actions = [r["data"] for r in records if r.get("schemaCode") == ACTIONS
               and str(r["data"].get("url", "")).startswith(URL_PREFIX)]
    ids = {a["id"] for a in actions}
    grants = [_substitute(r["data"], tenant) for r in records
              if r.get("schemaCode") == ROLEACTIONS and r["data"].get("actionid") in ids]
    return actions, grants


def _free(wanted, taken):
    chosen = wanted if wanted is not None and wanted not in taken else max(taken | {0}) + 1
    taken.add(chosen)
    return chosen


def plan(actions, grants, held_actions, held_grants, roles):
    """(actions to create, role-actions to create, notes) for a root holding `held_actions` and
    `held_grants` ([(data, active)]) and the active role codes `roles`. Pure."""
    taken = {_id(d.get("id")) for d, _ in held_actions} - {None}
    taken_grants = {_id(d.get("id")) for d, _ in held_grants} - {None}
    new_actions, new_grants, notes, root_ids = [], [], [], {}
    for action in actions:
        same_url = [(_id(d.get("id")), active) for d, active in held_actions if d.get("url") == action["url"]]
        live = sorted(i for i, active in same_url if active and i is not None)
        if live:
            root_ids[action["id"]] = live
        elif same_url:
            notes.append("action %s is INACTIVE at the root: left as it is, nothing granted on it" % action["url"])
        else:
            created = dict(action, id=_free(_id(action["id"]), taken))
            new_actions.append(created)
            root_ids[action["id"]] = [created["id"]]
    urls = {a["id"]: a["url"] for a in actions}
    for grant in grants:
        ids = root_ids.get(grant["actionid"])
        if ids is None:
            continue
        role, url = grant["rolecode"], urls[grant["actionid"]]
        held = [active for d, active in held_grants if d.get("rolecode") == role and _id(d.get("actionid")) in ids]
        if any(held):
            continue
        if held:
            notes.append("%s's grant on %s is INACTIVE at the root: left as it is" % (role, url))
        elif role not in roles:
            notes.append("the root has no %s role (ACCESSCONTROL-ROLES.roles): %s not granted to it" % (role, url))
        else:
            actionid = grant["actionid"] if grant["actionid"] in ids else ids[0]
            new_grants.append(dict(grant, actionid=actionid, id=_free(_id(grant.get("id")), taken_grants)))
    return new_actions, new_grants, notes


def _post(path, body):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=40))


def login():
    data = urllib.parse.urlencode({
        "grant_type": "password", "username": USERNAME, "password": PASSWORD,
        "tenantId": LOGIN_TENANT, "scope": "read", "userType": "EMPLOYEE"}).encode()
    req = urllib.request.Request(URL + "/user/oauth/token", data=data,
        headers={"Authorization": BASIC, "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=40))["access_token"]


def ri(tok):
    return {"apiId": "workspace-access-seed", "authToken": tok}


def rows(tok, code, unique=None):
    """Every row of `code` at TENANT, active and inactive, as (data, active). Raises on a failed read."""
    out, offset = [], 0
    while offset < MAX_ROWS:
        criteria = {"tenantId": TENANT, "schemaCode": code, "limit": PAGE, "offset": offset}
        if unique:
            criteria["uniqueIdentifiers"] = unique
        page = _post("/mdms-v2/v2/_search", {"RequestInfo": ri(tok), "MdmsCriteria": criteria}).get("mdms") or []
        out += [(r.get("data") or {}, r.get("isActive") is not False) for r in page
                if (r.get("tenantId") or TENANT) == TENANT]
        if len(page) < PAGE:
            return out
        offset += len(page)
    raise RuntimeError("%s: more than %d rows, stopped paging" % (code, MAX_ROWS))


def create(tok, code, data, unique):
    """Create one row and wait until a search returns it: a role-action's actionid must resolve."""
    _post("/mdms-v2/v2/_create/" + code, {"RequestInfo": ri(tok), "Mdms": {
        "tenantId": TENANT, "schemaCode": code, "data": data, "isActive": True}})
    for _ in range(VISIBLE_TRIES):
        if rows(tok, code, [unique]):
            return
        time.sleep(VISIBLE_DELAY)
    raise RuntimeError("%s %s was accepted but never became visible" % (code, unique))


def _why(exc):
    if isinstance(exc, urllib.error.HTTPError):
        try:
            body = exc.read().decode("utf-8", "replace")[:200]
        except Exception:  # noqa: BLE001 — an unreadable body still has a status
            body = ""
        return "HTTP %s %s" % (exc.code, body)
    return str(exc)


FAILURES = (urllib.error.URLError, OSError, ValueError, KeyError, RuntimeError)


def main():
    if not (URL and TENANT and BASELINE_FILE):
        print("WORKSPACE-ACCESS-FAILED: DIGIT_URL, TENANT and BASELINE_FILE are required")
        return 2
    with open(BASELINE_FILE, encoding="utf-8") as fh:
        actions, grants = select(json.load(fh), TENANT)
    if not actions:
        print("WORKSPACE-ACCESS-FAILED: %s has no %s* action" % (BASELINE_FILE, URL_PREFIX))
        return 2
    try:
        tok = login()
    except FAILURES as exc:
        print("WORKSPACE-ACCESS-FAILED: logging in as %s at %s failed (%s). Nothing was read or "
              "written." % (USERNAME, LOGIN_TENANT, _why(exc)))
        return 2
    try:
        held_actions, held_grants = rows(tok, ACTIONS), rows(tok, ROLEACTIONS)
        roles = {str(d.get("code") or "") for d, active in rows(tok, ROLES) if active}
    except FAILURES as exc:
        print("WORKSPACE-ACCESS-FAILED: reading %s's access-control rows failed (%s). Nothing was "
              "written." % (TENANT, _why(exc)))
        return 2
    new_actions, new_grants, notes = plan(actions, grants, held_actions, held_grants, roles)
    for note in notes:
        print("  WARNING: " + note)
    created = 0
    try:
        for action in new_actions:
            create(tok, ACTIONS, action, str(action["id"]))
            created += 1
            print("  action CREATED %s (id %s)" % (action["url"], action["id"]))
        for grant in new_grants:
            create(tok, ROLEACTIONS, grant, "%s.%s" % (grant["rolecode"], grant["actionid"]))
            created += 1
            print("  role-action CREATED %s on action %s (id %s)" % (grant["rolecode"], grant["actionid"], grant["id"]))
    except FAILURES as exc:
        print("WORKSPACE-ACCESS-FAILED: a write at %s failed (%s)." % (TENANT, _why(exc)))
        return 2
    finally:
        if created:
            print("WORKSPACE-ACCESS-CHANGED: %d row(s) created at %s. egov-accesscontrol serves new "
                  "role-actions within cache.expiry.role.action.minutes (15 by default)." % (created, TENANT))
    print("DONE: %s: nothing left to create for the %d workspace actions and %d role-actions in the baseline"
          % (TENANT, len(actions), len(grants)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
