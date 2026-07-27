#!/usr/bin/env python3
"""Drive a real PGR complaint end-to-end and PROVE the WhatsApp pipeline reaches Novu.

The notification runbook said "drive a complaint" in prose. This is that step, fully
scripted and self-discovering, so a fresh operator can run ONE command to verify
WhatsApp actually sends. It:

  1. mints an admin (EMPLOYEE) token;
  2. DISCOVERS a city tenant that has boundaries — a boundary_relationship row with
     boundarytype='Locality' whose tenant ALSO has a PGR ComplaintHierarchy;
  3. DISCOVERS a valid serviceCode — a ComplaintHierarchy leaf (levelCode SUB_TYPE,
     has a path);
  4. creates a CITIZEN via /user/users/_createnovalidate (mobile must satisfy
     egov-user's active regex — default a 10-digit ^[6-9][0-9]{9}$ number; override
     with --mobile. NOTE: egov-user may enforce the Indian regex regardless of tenant);
  5. gets a CITIZEN token;
  6. files the complaint via /pgr-services/v2/request/_create (geoLocation is
     non-null — a null one crashes the persister);
  7. waits, then VERIFIES both:
       - nb_dispatch_log has a WHATSAPP row for the new serviceRequestId, status SENT;
       - Novu reports that transaction's message status = 'sent' (not 'error').
     Prints PASS / FAIL.

This DOES create real test data (a citizen + a complaint) — that is its purpose.
DB + Novu are read over the box's local sockets, so run this ON the box.

Env:
  DIGIT_URL       gateway base            (default: http://141.94.92.163.nip.io)
  DIGIT_USERNAME  admin username          (default: SUPERADMIN)
  DIGIT_PASSWORD  admin password          (default: eGov@123)
  ADMIN_TENANT    tenant to auth admin at (default: ke)
  NOVU_API_URL    Novu API base           (default: http://localhost:14002)
  NOVU_API_KEY    Novu ApiKey             (default: `docker exec novu-bridge printenv NOVU_API_KEY`)
  DB_CONTAINER    postgres container      (default: docker-postgres)
  DB_USER/DB_NAME db creds                (default: egov / egov)
  DOCKER          docker cmd              (default: "sudo docker")

Flags:
  --mobile N      citizen mobile (default: random valid ^[6-9][0-9]{9}$)
  --country CC    citizen countryCode      (default: +91)
  --tenant T      force city tenant (skip discovery)
  --locality L    force locality code (skip discovery)
  --service-code S force serviceCode (skip discovery)
  --wait N        seconds to wait for async dispatch before verifying (default: 25)
  --help
"""
import os
import sys
import time
import json
import random
import shlex
import argparse
import subprocess
import urllib.request
import urllib.parse
import urllib.error

BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="  # egov-user-client:
HIER_CODE = "RAINMAKER-PGR.ComplaintHierarchy"


def env(n, d=None):
    return os.environ.get(n, d)


URL = env("DIGIT_URL", "http://141.94.92.163.nip.io").rstrip("/")
ADMIN_USER = env("DIGIT_USERNAME", "SUPERADMIN")
ADMIN_PASS = env("DIGIT_PASSWORD", "eGov@123")
ADMIN_TENANT = env("ADMIN_TENANT", "ke")
NOVU_API_URL = env("NOVU_API_URL", "http://localhost:14002").rstrip("/")
DB_CONTAINER = env("DB_CONTAINER", "docker-postgres")
DB_USER = env("DB_USER", "egov")
DB_NAME = env("DB_NAME", "egov")
DOCKER = env("DOCKER", "sudo docker")


def die(msg):
    print("FAIL: " + msg)
    sys.exit(1)


def _post(path, body, headers=None, base=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request((base or URL) + path,
                                 data=json.dumps(body).encode(), headers=h)
    return urllib.request.urlopen(req, timeout=60)


def oauth(username, password, tenant, usertype):
    body = urllib.parse.urlencode({
        "grant_type": "password", "username": username, "password": password,
        "tenantId": tenant, "scope": "read", "userType": usertype}).encode()
    req = urllib.request.Request(URL + "/user/oauth/token", data=body,
        headers={"Authorization": BASIC,
                 "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=40))


def psql(sql):
    cmd = shlex.split(DOCKER) + ["exec", DB_CONTAINER, "psql", "-U", DB_USER,
                                 "-d", DB_NAME, "-t", "-A", "-F", "\t", "-c", sql]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        die("psql failed: %s" % out.stderr.strip())
    return [ln for ln in out.stdout.splitlines() if ln.strip()]


def novu_key():
    k = env("NOVU_API_KEY")
    if k:
        return k
    cmd = shlex.split(DOCKER) + ["exec", "novu-bridge", "printenv", "NOVU_API_KEY"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return out.stdout.strip()


def ri(tok, apiid="drive-test-complaint"):
    return {"RequestInfo": {"apiId": apiid, "ver": "1.0", "ts": 0,
                            "msgId": "%d|en_IN" % int(time.time()), "authToken": tok}}


def mdms_search_hierarchy(tok, tenant):
    body = ri(tok)
    body["MdmsCriteria"] = {"tenantId": tenant, "schemaCode": HIER_CODE, "limit": 200}
    try:
        r = json.load(_post("/mdms-v2/v2/_search", body))
    except urllib.error.HTTPError:
        return []
    return [m.get("data", {}) for m in r.get("mdms", [])]


def discover(tok, args):
    """Return (city_tenant, locality_code, service_code)."""
    if args.tenant and args.locality and args.service_code:
        return args.tenant, args.locality, args.service_code

    # candidate (tenant, locality) pairs that actually have boundaries
    rows = psql("select tenantid, code from boundary_relationship "
                "where boundarytype='Locality' order by tenantid, code;")
    pairs = [tuple(r.split("\t")) for r in rows]
    if args.tenant:
        pairs = [p for p in pairs if p[0] == args.tenant]
    if not pairs:
        die("no boundary_relationship Locality rows found (no city has boundaries)")

    # pick the first tenant that ALSO has a ComplaintHierarchy leaf
    seen = []
    for tenant in dict.fromkeys(p[0] for p in pairs):
        leaves = [d for d in mdms_search_hierarchy(tok, tenant)
                  if d.get("levelCode") == "SUB_TYPE" and d.get("path")]
        seen.append((tenant, len(leaves)))
        if leaves:
            locality = args.locality or next(p[1] for p in pairs if p[0] == tenant)
            service = args.service_code or leaves[0]["code"]
            print("discovered: tenant=%s locality=%s serviceCode=%s "
                  "(%d leaves)" % (tenant, locality, service, len(leaves)))
            return tenant, locality, service
    die("no city tenant has both boundaries and a ComplaintHierarchy leaf; "
        "checked %s" % seen)


def rand_mobile():
    return str(random.choice("6789")) + "".join(random.choice("0123456789") for _ in range(9))


def create_citizen(tok, mobile, state_tenant):
    password = "Test@%d" % random.randint(1000, 9999)
    user = {
        "userName": mobile,
        "name": "WA Pipeline Test",
        "mobileNumber": mobile,
        "type": "CITIZEN",
        # active:true is REQUIRED — _createnovalidate otherwise leaves the account
        # inactive and citizen login 400s "Please activate your account".
        "active": True,
        "tenantId": state_tenant,
        "roles": [{"code": "CITIZEN", "name": "Citizen", "tenantId": state_tenant}],
        "password": password,
    }
    body = ri(tok)
    body["user"] = user
    try:
        r = json.load(_post("/user/users/_createnovalidate", body))
        u = r["user"][0]
        print("citizen created: uuid=%s mobile=***%s tenant=%s"
              % (u.get("uuid"), mobile[-3:], state_tenant))
        return password
    except urllib.error.HTTPError as e:
        blob = e.read().decode()[:300]
        if "already exists" in blob.lower() or "duplicate" in blob.lower():
            print("citizen already exists for mobile ***%s — reusing" % mobile[-3:])
            return password
        die("citizen create failed HTTP %s %s (mobile must match egov-user's active "
            "regex, e.g. ^[6-9][0-9]{9}$)" % (e.code, blob))


def file_complaint(city_tenant, locality, service_code, mobile, country, citizen_auth):
    ctok = citizen_auth["access_token"]
    uinfo = citizen_auth.get("UserRequest", {})
    body = ri(ctok, apiid="Rainmaker")
    body["RequestInfo"]["userInfo"] = uinfo
    body["service"] = {
        "tenantId": city_tenant,
        "serviceCode": service_code,
        "description": "WhatsApp pipeline e2e verification complaint",
        "source": "web",
        "citizen": {
            "name": uinfo.get("name", "WA Pipeline Test"),
            "mobileNumber": mobile,
            "type": "CITIZEN",
            "tenantId": city_tenant,
            "countryCode": country,
        },
    }
    body["address"] = {
        "tenantId": city_tenant,
        "locality": {"code": locality},
        # geoLocation MUST be non-null — a null one crashes the pgr persister.
        "geoLocation": {"latitude": 12.9716, "longitude": 77.5946},
    }
    # pgr also reads address off service in some builds; mirror it there too.
    body["service"]["address"] = body["address"]
    body["workflow"] = {"action": "APPLY"}
    try:
        r = json.load(_post("/pgr-services/v2/request/_create", body))
    except urllib.error.HTTPError as e:
        die("complaint _create failed HTTP %s %s" % (e.code, e.read().decode()[:400]))
    svc = r["ServiceWrappers"][0]["service"]
    return svc["serviceRequestId"]


def verify_dispatch_log(srid):
    rows = psql("select channel, status, transaction_id from nb_dispatch_log "
                "where reference_number='%s' and channel='WHATSAPP' "
                "order by created_time desc limit 1;" % srid.replace("'", "''"))
    if not rows:
        return None, None
    ch, status, txn = rows[0].split("\t")
    return status, txn


def verify_novu(txn, key):
    if not key:
        return None, "no NOVU_API_KEY"
    url = NOVU_API_URL + "/v1/messages?transactionId=" + urllib.parse.quote(txn) + "&limit=5"
    req = urllib.request.Request(url, headers={"Authorization": "ApiKey " + key})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=40))
    except urllib.error.HTTPError as e:
        return None, "novu HTTP %s" % e.code
    data = d.get("data", [])
    if not data:
        return None, "no Novu message for transaction"
    # WhatsApp-over-Twilio is modeled as an sms-channel message in Novu; the
    # transactionId carries the :WHATSAPP suffix. Take the message's own status.
    m = data[0]
    return m.get("status"), "channel=%s errorId=%s" % (m.get("channel"),
                                                        m.get("errorId"))


def main():
    ap = argparse.ArgumentParser(
        description="Drive a real PGR complaint and verify the WhatsApp pipeline reaches Novu.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--mobile", default=None)
    ap.add_argument("--country", default="+91")
    ap.add_argument("--tenant", default=None)
    ap.add_argument("--locality", default=None)
    ap.add_argument("--service-code", dest="service_code", default=None)
    ap.add_argument("--wait", type=int, default=25)
    args = ap.parse_args()

    print("drive-test-complaint: url=%s" % URL)
    admin = oauth(ADMIN_USER, ADMIN_PASS, ADMIN_TENANT, "EMPLOYEE")
    atok = admin["access_token"]
    print("admin token OK")

    city_tenant, locality, service_code = discover(atok, args)
    state_tenant = city_tenant.split(".")[0]

    mobile = args.mobile or rand_mobile()
    password = create_citizen(atok, mobile, state_tenant)

    citizen_auth = oauth(mobile, password, state_tenant, "CITIZEN")
    print("citizen token OK")

    srid = file_complaint(city_tenant, locality, service_code, mobile,
                          args.country, citizen_auth)
    print("COMPLAINT FILED: serviceRequestId=%s" % srid)

    print("waiting %ds for async WhatsApp dispatch..." % args.wait)
    time.sleep(args.wait)

    status, txn = verify_dispatch_log(srid)
    if not status:
        die("no WHATSAPP row in nb_dispatch_log for %s (WhatsApp did not dispatch)" % srid)
    print("nb_dispatch_log: WHATSAPP status=%s" % status)
    print("  transaction_id=%s" % txn)

    novu_status, detail = verify_novu(txn, novu_key())
    print("novu message: status=%s (%s)" % (novu_status, detail))

    db_ok = str(status).upper() == "SENT"
    novu_ok = str(novu_status).lower() == "sent"
    if db_ok and novu_ok:
        print("PASS: serviceRequestId=%s  nb_dispatch_log=SENT  novu=sent" % srid)
        sys.exit(0)
    die("serviceRequestId=%s  nb_dispatch_log=%s  novu=%s "
        "(need SENT + sent)" % (srid, status, novu_status))


if __name__ == "__main__":
    main()
