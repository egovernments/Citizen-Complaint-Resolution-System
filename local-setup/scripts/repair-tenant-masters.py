#!/usr/bin/env python3
"""Verify — and repair — the ACCESS-CONTROL rows a freshly bootstrapped tenant is
supposed to inherit from the source tenant (`pg`): the actions and the role-actions.
Nothing else. It never reads, compares or copies any other MDMS master.

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
this repository consumes as a prebuilt image. So the 500-row limit cannot be changed
from here; this script is the repair, run after bootstrap.

REPORT-ONLY UNLESS ASKED
------------------------
The deploy runs this on every deploy whose state root is not `pg` — i.e. on LIVE
tenants — and by default it only REPORTS (APPLY=0). A row `pg` grants and the tenant
lacks looks the same whether the bootstrap dropped it or an operator deliberately
withheld it (the tenant's own role-action map, GRO/DGRO scoping), and a copied grant
cannot be taken back by any deploy (MDMS v2 has no delete). So the script cannot be
the one to decide; it writes only with APPLY=1, which the playbook sets only for
`repair_tenant_masters: true`.

The truncation SIGNATURE — exactly TRUNCATION_ROWS (500) role-action rows at the target
while the source has more — is reported as TRUNCATION-SIGNATURE together with the exact
opt-in command (OPT_IN_HINT), but it does NOT switch writing on by itself: 500 is a
heuristic, a deliberately trimmed tenant can sit on it, and a missed repair costs an
explicit 403 and one re-run where a wrong one silently widens access.

WHY ONLY THE ACCESS-CONTROL MASTERS
-----------------------------------
An earlier version compared every schema the two tenants share and keyed
rows on mdms-v2's uniqueIdentifier. Its schema search sent no limit, so mdms-v2
answered with 10 schemas and it reported "0 missing" having looked at 10 of ~52. Had
the paging worked it would have copied `pg`'s DEMO data — ComplaintHierarchy,
Departments, Workflow, validation rules — into a live tenant, because a row `pg` has
and the tenant lacks looks exactly like a truncation gap. Only the access-control
masters are reference data that must match `pg`; everything else legitimately differs
per tenant. So ACL_MASTERS below is a hard allow-list, enforced again at the one place
that writes (copy_row).

IDENTITY, NOT uniqueIdentifier
------------------------------
  actions      are matched on their `url`: the permission IS the url. A target action
               with the same url under another id is present, not missing.
  roleactions  are matched on (rolecode, actionid) — the master's x-unique — and are
               copied only when the actionid means the SAME url at the target as at
               the source. Otherwise a copied role-action would grant whatever action
               the target happens to hold under that id: a different permission.
An action whose id is already taken at the target by a different url is never copied
(it would collide); both cases are reported.

ORDER MATTERS. Actions first, then role-actions: a role-action references an action by
id (x-ref-schema), and roleactions is both the master that gets truncated AND the one
that grants permission to write the others.

THE CHICKEN-AND-EGG, STATED PLAINLY. The repair goes through Kong like every other
client, so it is itself subject to the truncated permissions it is fixing. If the
admin role kept its `/mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions`
role-action in the surviving 500 rows, the repair works and unblocks everything else.
If it did not, every write 403s and this script exits 3 (RBAC_BLOCKED) with an exact
diagnosis rather than pretending to have succeeded.

Env:
  DIGIT_URL          Kong base, e.g. http://127.0.0.1:18000        (required)
  TARGET_TENANT      tenant to verify/repair                       (required)
  SOURCE_TENANT      tenant to copy from            (default: pg)
  DIGIT_USERNAME     admin username                 (default: ADMIN)
  DIGIT_PASSWORD     admin password                 (default: eGov@123)
  DIGIT_LOGIN_TENANT tenant to auth against         (default: $TARGET_TENANT)
  APPLY              1 = copy missing rows, 0 = report only  (default: 0)
  TRUNCATION_ROWS    the role-action count the truncated bootstrap leaves (default: 500)
  OPT_IN_HINT        the command printed for turning the repair on
                     (default: this script with APPLY=1; the playbook passes its own)
  PAGE_LIMIT         MDMS search page size          (default: 100)
  SHOW_MISSING       how many missing rows to list per master in the report (default: 5)

Exit: 0 nothing missing / everything repaired / report-only · 3 RBAC_BLOCKED (APPLY=1
only: report-only never writes, so it can never be refused) · 2 other failures.
"""
import os, sys, json, urllib.request, urllib.parse, urllib.error

URL = os.environ.get("DIGIT_URL", "").rstrip("/")
TARGET = os.environ.get("TARGET_TENANT", "")
SOURCE = os.environ.get("SOURCE_TENANT", "pg")
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
LOGIN_TENANT = os.environ.get("DIGIT_LOGIN_TENANT", TARGET)
# Report-only unless the caller says otherwise — see "REPORT-ONLY UNLESS ASKED" above.
APPLY = os.environ.get("APPLY", "0").strip().lower() in ("1", "true", "yes")
TRUNCATION_ROWS = int(os.environ.get("TRUNCATION_ROWS", "500"))
OPT_IN_HINT = os.environ.get("OPT_IN_HINT") or (
    "APPLY=1 DIGIT_URL=%s TARGET_TENANT=%s python3 %s"
    % (os.environ.get("DIGIT_URL", "<kong>"), os.environ.get("TARGET_TENANT", "<tenant>"),
       os.path.basename(__file__)))
PAGE = int(os.environ.get("PAGE_LIMIT", "100"))
SHOW = int(os.environ.get("SHOW_MISSING", "5"))
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="

ACTIONS = "ACCESSCONTROL-ACTIONS-TEST.actions-test"
ROLEACTIONS = "ACCESSCONTROL-ROLEACTIONS.roleactions"
# The ONLY masters this script may read or write, in repair order.
ACL_MASTERS = (ACTIONS, ROLEACTIONS)
MAX_ROWS = 20000  # refuse to loop forever on a server that ignores offset


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


def schemas_present(tok, tenant):
    """Which of ACL_MASTERS have a schema at `tenant`, walked page by page.

    Asks for exactly these codes AND pages: mdms-v2's schema search answers 10 rows
    when no limit is sent, which is how the old version compared 10 of ~52 schemas.
    """
    found, offset = set(), 0
    while True:
        body = ri(tok)
        body["SchemaDefCriteria"] = {"tenantId": tenant, "codes": list(ACL_MASTERS),
                                     "limit": PAGE, "offset": offset}
        try:
            page = json.load(_post("/mdms-v2/schema/v1/_search", body)).get("SchemaDefinitions") or []
        except urllib.error.HTTPError as e:
            sys.exit("ERROR: schema search failed for %s: HTTP %s" % (tenant, e.code))
        except (urllib.error.URLError, OSError, ValueError) as e:
            # Unreachable is not absent: say which, so nobody goes looking for a bootstrap
            # that did run.
            sys.exit("ERROR: schema search for %s did not answer (%s) — MDMS/Kong unreachable"
                     % (tenant, e))
        found |= {s.get("code") for s in page if s.get("code") in ACL_MASTERS}
        if len(page) < PAGE:
            return found
        offset += len(page)
        if offset > MAX_ROWS:
            sys.exit("ERROR: schema search for %s never ended — server ignores offset?" % tenant)


def all_rows(tok, tenant, code):
    """Every row for `code` at `tenant`, walked page by page. Returns (rows, complete).

    Never trust one page: mdms-v2 caps a search well below the row counts these
    masters reach (roleactions alone is ~945 at pg), which is the same class of bug
    this script exists to repair. Advances by the page's ACTUAL length (a server that
    caps below PAGE must not leave gaps) and stops only on a short or empty page.
    """
    assert code in ACL_MASTERS, code
    out, seen, offset = [], set(), 0
    while True:
        body = ri(tok)
        body["MdmsCriteria"] = {"tenantId": tenant, "schemaCode": code,
                                "limit": PAGE, "offset": offset}
        try:
            page = json.load(_post("/mdms-v2/v2/_search", body)).get("mdms") or []
        except urllib.error.HTTPError as e:
            print("    ! search %s@%s failed: HTTP %s" % (code, tenant, e.code))
            return out, False
        except (urllib.error.URLError, OSError, ValueError) as e:
            print("    ! search %s@%s did not answer: %s" % (code, tenant, e))
            return out, False
        for rec in page:
            uid = rec.get("id") or rec.get("uniqueIdentifier")
            if uid is not None and uid in seen:
                continue
            if uid is not None:
                seen.add(uid)
            out.append(rec)
        if len(page) < PAGE:
            return out, True
        offset += len(page)
        if offset > MAX_ROWS:
            print("    ! search %s@%s exceeded %d rows — aborting walk" % (code, tenant, MAX_ROWS))
            return out, False


def _data(rec):
    data = rec.get("data")
    return data if isinstance(data, dict) else {}


def _id(value):
    """Action ids arrive as ints or strings depending on who wrote the row."""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def action_index(rows):
    """({url: id}, {id: url}) for a tenant's action rows."""
    by_url, by_id = {}, {}
    for rec in rows:
        d = _data(rec)
        url, aid = str(d.get("url") or "").strip(), _id(d.get("id"))
        if url and aid is not None:
            by_url.setdefault(url, aid)
            by_id.setdefault(aid, url)
    return by_url, by_id


def roleaction_key(rec):
    d = _data(rec)
    return (str(d.get("rolecode") or "").strip(), _id(d.get("actionid")))


def copy_row(tok, code, rec):
    # The one place that writes. Enforce the allow-list here too, so no future caller
    # can route a non-ACL master through it.
    if code not in ACL_MASTERS:
        raise RuntimeError("refusing to copy %s: only %s may be repaired" % (code, ", ".join(ACL_MASTERS)))
    data = dict(_data(rec))
    # A row that names its own tenant must name the NEW one, or the copy is a
    # duplicate of pg's row wearing the target's label.
    if "tenantId" in data:
        data["tenantId"] = TARGET
    body = ri(tok)
    body["Mdms"] = {"tenantId": TARGET, "schemaCode": code, "data": data,
                    "isActive": bool(rec.get("isActive", True))}
    try:
        _post("/mdms-v2/v2/_create/" + code, body).read()
        return "created"
    except urllib.error.HTTPError as e:
        blob = e.read().decode()[:200]
        if e.code in (400, 409) and ("DUPLICATE" in blob.upper() or "ALREADY" in blob.upper()):
            return "dup"
        if e.code == 403:
            return "forbidden"
        print("    ! %s create failed: HTTP %s %s" % (code, e.code, blob))
        return "failed"


def _apply(tok, code, rows, forbidden_codes):
    """Copy `rows`; stop the master at the first 403. Returns (created, failed)."""
    c = f = 0
    for rec in rows:
        r = copy_row(tok, code, rec)
        c += (r == "created")
        if r == "forbidden":
            f += 1
            forbidden_codes.append(code)
            break  # one 403 means the whole master is blocked; do not spam
        f += (r == "failed")
    print("       -> +%d copied, %d failed" % (c, f))
    return c, f


def _sample(label, items):
    for item in items[:SHOW]:
        print("       %s %s" % (label, item))
    if len(items) > SHOW:
        print("       ... and %d more" % (len(items) - SHOW))


def main():
    if not URL or not TARGET:
        sys.exit("ERROR: DIGIT_URL and TARGET_TENANT are required")
    if os.environ.get("SCHEMA_CODES"):
        # The old knob that let a caller widen the repair to any master. Gone on purpose.
        print("  NOTE: SCHEMA_CODES is ignored — this script only ever repairs %s"
              % ", ".join(ACL_MASTERS))
    print("repair-tenant-masters: source=%s target=%s url=%s apply=%s masters=%s"
          % (SOURCE, TARGET, URL, APPLY, ", ".join(ACL_MASTERS)))
    if SOURCE == TARGET:
        print("source == target; nothing to do")
        return 0
    try:
        tok = token()
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        print("ERROR: login as %s at %s failed (%s) — nothing compared, nothing written"
              % (USERNAME, LOGIN_TENANT, e))
        return 2

    missing_schemas = [(t, c) for t in (SOURCE, TARGET) for c in sorted(set(ACL_MASTERS) - schemas_present(tok, t))]
    if missing_schemas:
        for t, c in missing_schemas:
            print("  ! schema %s ABSENT at %s — cannot compare" % (c, t))
        print("SUMMARY: access-control masters not comparable (tenant bootstrap has not run?)")
        return 2

    src_actions, ok1 = all_rows(tok, SOURCE, ACTIONS)
    tgt_actions, ok2 = all_rows(tok, TARGET, ACTIONS)
    src_ra, ok3 = all_rows(tok, SOURCE, ROLEACTIONS)
    tgt_ra, ok4 = all_rows(tok, TARGET, ROLEACTIONS)
    if not (ok1 and ok2 and ok3 and ok4):
        print("  ! could not read every page of the access-control masters — nothing compared, "
              "nothing copied")
        return 2

    # The one shape a truncated bootstrap leaves. Reported, never acted on by itself.
    signature = len(tgt_ra) == TRUNCATION_ROWS and len(src_ra) > TRUNCATION_ROWS

    total_missing = total_created = total_failed = 0
    forbidden_codes = []

    # ── actions, matched on url ────────────────────────────────────────────────
    src_by_url, src_by_id = action_index(src_actions)
    tgt_by_url, tgt_by_id = action_index(tgt_actions)
    missing_actions, collisions = [], []
    for rec in src_actions:
        d = _data(rec)
        url, aid = str(d.get("url") or "").strip(), _id(d.get("id"))
        if not url or aid is None or url in tgt_by_url:
            continue
        if aid in tgt_by_id:
            collisions.append("id %s is %s at %s but %s at %s" % (aid, url, SOURCE, tgt_by_id[aid], TARGET))
            continue
        missing_actions.append(rec)
    print("  %s %-45s %4d/%-4d  (%d missing by url%s)"
          % ("GAP " if missing_actions else "OK  ", ACTIONS, len(tgt_actions), len(src_actions),
             len(missing_actions), ", %d id collision(s) — not copied" % len(collisions) if collisions else ""))
    _sample("missing", ["%s %s" % (_id(_data(r).get("id")), _data(r).get("url")) for r in missing_actions])
    _sample("COLLISION", collisions)
    total_missing += len(missing_actions)
    if APPLY and missing_actions:
        c, f = _apply(tok, ACTIONS, missing_actions, forbidden_codes)
        total_created += c; total_failed += f
        if c:  # re-read so the role-action check below sees what now exists
            tgt_actions, ok = all_rows(tok, TARGET, ACTIONS)
            tgt_by_url, tgt_by_id = action_index(tgt_actions)
    else:
        # Report-only: count the actions this run WOULD have copied as present for the
        # role-action check, so the report shows what a real run would copy.
        for rec in missing_actions:
            d = _data(rec)
            tgt_by_id.setdefault(_id(d.get("id")), str(d.get("url")).strip())

    # ── role-actions, matched on (rolecode, actionid), gated on same-url ─────────
    have = {roleaction_key(r) for r in tgt_ra}
    missing_ra, unsafe, orphan = [], [], []
    for rec in src_ra:
        key = roleaction_key(rec)
        role, aid = key
        if not role or aid is None or key in have:
            continue
        src_url = src_by_id.get(aid)
        tgt_url = tgt_by_id.get(aid)
        if src_url is None:
            orphan.append("%s -> %s (no such action at %s)" % (role, aid, SOURCE))
            continue
        if tgt_url is None:
            orphan.append("%s -> %s %s (action not at %s)" % (role, aid, src_url, TARGET))
            continue
        if tgt_url != src_url:
            unsafe.append("%s -> %s: %s at %s but %s at %s" % (role, aid, src_url, SOURCE, tgt_url, TARGET))
            continue
        missing_ra.append(rec)
    extra = ""
    if unsafe:
        extra += ", %d refused (id means another url here)" % len(unsafe)
    if orphan:
        extra += ", %d skipped (action missing)" % len(orphan)
    print("  %s %-45s %4d/%-4d  (%d missing%s)"
          % ("GAP " if missing_ra else "OK  ", ROLEACTIONS, len(tgt_ra), len(src_ra), len(missing_ra), extra))
    _sample("missing", ["%s -> %s %s" % (roleaction_key(r)[0], roleaction_key(r)[1], src_by_id.get(roleaction_key(r)[1]))
                        for r in missing_ra])
    _sample("REFUSED", unsafe)
    _sample("skipped", orphan)
    total_missing += len(missing_ra)
    if APPLY and missing_ra:
        c, f = _apply(tok, ROLEACTIONS, missing_ra, forbidden_codes)
        total_created += c; total_failed += f

    verb = "copied" if APPLY else "would be copied (report only, APPLY=0)"
    print("SUMMARY: %d access-control master(s) compared, %d row(s) missing, %s %s, %d failed"
          % (len(ACL_MASTERS), total_missing, total_created if APPLY else total_missing, verb,
             total_failed))

    if signature:
        print("TRUNCATION-SIGNATURE: %s has exactly %d %s rows and %s has %d — the shape a "
              "truncated tenant bootstrap leaves (SUPERUSER/MDMS_ADMIN typically lose their "
              "/mdms-v2/v2/_create role-actions, and the configurator's MDMS writes 403)."
              % (TARGET, len(tgt_ra), ROLEACTIONS, SOURCE, len(src_ra)))
    if not APPLY and total_missing:
        # Nothing was written: a gap on a live tenant can be deliberate. Say how to act on
        # it instead of acting.
        print("REPORT-ONLY: nothing written. %s differs from %s by %d access-control row(s); "
              "that can be deliberate (a tenant's own role-action map), so copying them is the "
              "operator's call. Review the rows above; to copy them: %s"
              % (TARGET, SOURCE, total_missing, OPT_IN_HINT))

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
    if total_failed:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
