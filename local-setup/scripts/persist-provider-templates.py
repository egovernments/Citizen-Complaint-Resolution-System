#!/usr/bin/env python3
"""Persist an operator's OWN approved Twilio WhatsApp Content templates into MDMS.

This closes the notification-runbook "last mile": there was no executable path to take
the ContentSids Twilio approved for a specific operator's WABA and land them in the
RAINMAKER-PGR.NotificationProviderTemplate master. The bridge already reconciles the
operator's Twilio content templates against the PGR routing tuples and exposes the
result at:

    GET {BRIDGE_URL}/novu-bridge/novu-adapter/v1/providers/twilio-templates
        Authorization: Bearer <employee-token>

    -> { "matched":   [ {provider, channel, audience, action, toState, locale,
                          templateId, templateName, variables[], approvalStatus, active}, ... ],
         "unmatched": [ ...diagnostics... ] }

Each matched[] row is UPSERTed into MDMS RAINMAKER-PGR.NotificationProviderTemplate at
the state-root tenant (default ke). The unique key is the routing tuple
(provider, channel, audience, action, toState, locale) -> MDMS uniqueIdentifier
"<provider>.<channel>.<audience>.<action>.<toState>.<locale>". We search the master
once, then per row: _create if absent, _update (carrying the existing id + auditDetails)
if present. Idempotent and safe to re-run.

Authentication + MDMS request shapes mirror seed-notifications.py (Basic egov-user-client:
oauth, MDMS v2 body-carries-schemaCode).

Exit status:
  0  matched non-empty AND full coverage (>= EXPECTED_ROUTING_KEYS distinct routing keys)
  2  matched empty, or partial coverage  (operator: WhatsApp is NOT fully wired)

Env (like seed-notifications.py):
  DIGIT_URL          gateway base, e.g. http://141.94.92.163.nip.io   (required)
  NOTIF_TENANT       state-root tenant to persist at   (default: ke)
  DIGIT_USERNAME     admin username                    (default: SUPERADMIN)
  DIGIT_PASSWORD     admin password                    (default: eGov@123)
  DIGIT_LOGIN_TENANT tenant to auth against            (default: $NOTIF_TENANT)
  BRIDGE_URL         base for the twilio-templates endpoint (default: $DIGIT_URL)

Flags:
  --dry-run   print the exact create/update each row WOULD produce, write nothing
  --help
"""
import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
import urllib.error

CODE = "RAINMAKER-PGR.NotificationProviderTemplate"
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="  # egov-user-client: (empty secret)
UNIQUE_KEY = ("provider", "channel", "audience", "action", "toState", "locale")
# The 7 stock PGR routing keys (action.toState, one WhatsApp Content template each,
# per locale). Full WhatsApp coverage means all 7 distinct routing tuples are present.
EXPECTED_ROUTING_KEYS = 7

# Data fields we persist into MDMS (drop transport-only extras defensively).
DATA_FIELDS = ("provider", "channel", "audience", "action", "toState", "locale",
               "templateId", "templateName", "variables", "approvalStatus", "active")


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        sys.exit("ERROR: env %s is required" % name)
    return v


URL = env("DIGIT_URL", required=True).rstrip("/")
TENANT = env("NOTIF_TENANT", "ke")
USERNAME = env("DIGIT_USERNAME", "SUPERADMIN")
PASSWORD = env("DIGIT_PASSWORD", "eGov@123")
LOGIN_TENANT = env("DIGIT_LOGIN_TENANT", TENANT)
BRIDGE_URL = env("BRIDGE_URL", URL).rstrip("/")


def _req(url, data=None, headers=None, method=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    return urllib.request.urlopen(req, timeout=40)


def token():
    body = urllib.parse.urlencode({
        "grant_type": "password", "username": USERNAME, "password": PASSWORD,
        "tenantId": LOGIN_TENANT, "scope": "read", "userType": "EMPLOYEE"}).encode()
    r = _req(URL + "/user/oauth/token", data=body,
             headers={"Authorization": BASIC,
                      "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(r)["access_token"]


def ri(tok):
    return {"RequestInfo": {"apiId": "persist-provider-templates", "authToken": tok}}


def fetch_matched(tok):
    """Pull the operator's reconciled Twilio templates from the bridge."""
    url = BRIDGE_URL + "/novu-bridge/novu-adapter/v1/providers/twilio-templates"
    r = _req(url, headers={"Authorization": "Bearer " + tok})
    payload = json.load(r)
    return payload.get("matched", []) or [], payload.get("unmatched", []) or []


def uid_of(row):
    return ".".join(str(row[k]) for k in UNIQUE_KEY)


def mdms_data(row):
    """Project a bridge row down to the persisted MDMS data object."""
    return {k: row[k] for k in DATA_FIELDS if k in row}


def existing_by_uid(tok):
    """One _search of the master -> {uniqueIdentifier: full mdms record}."""
    body = ri(tok)
    body["MdmsCriteria"] = {"tenantId": TENANT, "schemaCode": CODE, "limit": 500}
    try:
        r = json.load(_req(URL + "/mdms-v2/v2/_search",
                           data=json.dumps(body).encode()))
    except urllib.error.HTTPError as e:
        sys.exit("ERROR: MDMS _search failed HTTP %s %s" % (e.code, e.read().decode()[:200]))
    return {m.get("uniqueIdentifier"): m for m in r.get("mdms", [])}


def create_payload(tok, row):
    body = ri(tok)
    body["Mdms"] = {"tenantId": TENANT, "schemaCode": CODE,
                    "data": mdms_data(row),
                    "isActive": bool(row.get("active", True))}
    return body


def update_payload(tok, row, existing):
    body = ri(tok)
    body["Mdms"] = {"id": existing["id"], "tenantId": TENANT, "schemaCode": CODE,
                    "uniqueIdentifier": existing.get("uniqueIdentifier"),
                    "data": mdms_data(row),
                    "isActive": bool(row.get("active", True)),
                    "auditDetails": existing.get("auditDetails")}
    return body


def do_create(body):
    _req(URL + "/mdms-v2/v2/_create/" + CODE, data=json.dumps(body).encode()).read()


def do_update(body):
    _req(URL + "/mdms-v2/v2/_update/" + CODE, data=json.dumps(body).encode()).read()


def main():
    ap = argparse.ArgumentParser(
        description="Persist operator's approved Twilio WhatsApp Content templates into "
                    "MDMS %s at the state-root tenant." % CODE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="print the create/update each row WOULD produce; write nothing")
    args = ap.parse_args()

    print("persist-provider-templates: tenant=%s url=%s bridge=%s%s"
          % (TENANT, URL, BRIDGE_URL, "  [DRY-RUN]" if args.dry_run else ""))

    tok = token()
    matched, unmatched = fetch_matched(tok)
    print("bridge: %d matched, %d unmatched" % (len(matched), len(unmatched)))
    for u in unmatched:
        # diagnostics only; never fatal
        why = u.get("reason") or u.get("approvalStatus") or "unmatched"
        name = u.get("templateName") or u.get("templateId") or "?"
        print("  unmatched-skip: %s (%s)" % (name, why))

    if not matched:
        print("SUMMARY: +0 created, 0 updated, %d unmatched-skipped" % len(unmatched))
        sys.exit("FAIL: bridge returned NO matched rows — WhatsApp is not wired "
                 "(no approved Twilio Content templates map to PGR routing keys).")

    existing = existing_by_uid(tok)
    created = updated = 0
    routing_keys = set()

    for row in matched:
        uid = uid_of(row)
        routing_keys.add(tuple(row[k] for k in UNIQUE_KEY[:-1]))  # ignore locale
        prior = existing.get(uid)
        if prior:
            body = update_payload(tok, row, prior)
            action = "UPDATE"
        else:
            body = create_payload(tok, row)
            action = "CREATE"
        if args.dry_run:
            print("  WOULD %-6s %s" % (action, uid))
            print("        %s" % json.dumps(body["Mdms"]))
        else:
            try:
                if prior:
                    do_update(body)
                    updated += 1
                else:
                    do_create(body)
                    created += 1
                print("  %-7s %s" % (action + "d", uid))
            except urllib.error.HTTPError as e:
                blob = e.read().decode()[:200]
                if e.code in (400, 409) and ("DUPLICATE" in blob.upper() or "ALREADY" in blob.upper()):
                    print("  dup     %s (already present)" % uid)
                else:
                    print("  ! FAILED %s: HTTP %s %s" % (uid, e.code, blob))

    n_keys = len(routing_keys)
    print("SUMMARY: +%d created, %d updated, %d unmatched-skipped "
          "(%d distinct routing keys of %d expected)"
          % (created, updated, len(unmatched), n_keys, EXPECTED_ROUTING_KEYS))

    if n_keys < EXPECTED_ROUTING_KEYS:
        sys.exit("FAIL: only %d of %d stock routing keys covered — WhatsApp is NOT "
                 "fully wired." % (n_keys, EXPECTED_ROUTING_KEYS))
    print("OK: full WhatsApp routing coverage.")
    sys.exit(0)


if __name__ == "__main__":
    main()
