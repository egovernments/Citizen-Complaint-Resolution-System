#!/usr/bin/env python3
"""Seed USER_NOTIFICATION_PREFERENCES (consent + preferredLanguage) for the dedicated
test accounts, so per-recipient language/consent behavior is testable.

Reproducible: looks up the test EMPLOYEES by userName via egov-user (uuids differ per
install), then upserts preferences via digit-user-preferences-service. Run ON the deploy
target (needs Kong at $KONG and the internal preference service at $PREF_HOST).

  KONG=http://localhost:18000 PREF_HOST=http://digit-user-preferences-service:8080 \
  E2E_TENANT=ke.bomet python3 seed-test-account-preferences.py

The CITIZEN test account is registered per E2E run (no stable username), so seed its
preference at run time by uuid if needed — see local-setup/scripts (or the E2E script).
"""
import os, json, base64, urllib.request, urllib.parse, urllib.error

KONG = os.environ.get("KONG", "http://localhost:18000")
PREF = os.environ.get("PREF_HOST", "http://digit-user-preferences-service:8080") + "/user-preference"
TENANT = os.environ.get("E2E_TENANT", "ke.bomet")
BASIC = "Basic ZWdvdi11c2VyLWNsaWVudDo="  # egov-user-client: (empty secret)

# userName -> (preferredLanguage, {channel: GRANTED|REVOKED})
ACCOUNTS = {
    "E2E_LME_TESTER": ("hi_IN", {"WHATSAPP": "GRANTED", "SMS": "GRANTED", "EMAIL": "GRANTED"}),
    "E2E_GRO_TESTER": ("en_IN", {"WHATSAPP": "REVOKED", "SMS": "GRANTED", "EMAIL": "GRANTED"}),
}


def token():
    data = urllib.parse.urlencode({"grant_type": "password", "username": "bometadmin",
        "password": "eGov@123", "tenantId": TENANT, "scope": "read", "userType": "EMPLOYEE"}).encode()
    req = urllib.request.Request(KONG + "/user/oauth/token", data=data,
        headers={"Authorization": BASIC, "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=30))["access_token"]


def uuid_for(tok, username):
    body = json.dumps({"RequestInfo": {"authToken": tok, "apiId": "seed"},
                       "userName": username, "tenantId": TENANT}).encode()
    req = urllib.request.Request(KONG + "/user/_search", data=body, headers={"Content-Type": "application/json"})
    users = json.load(urllib.request.urlopen(req, timeout=30)).get("user", [])
    return users[0]["uuid"] if users else None


def upsert_pref(uuid, lang, consent):
    payload = {"preferredLanguage": lang,
               "consent": {ch: {"status": st, "scope": "GLOBAL"} for ch, st in consent.items()}}
    body = json.dumps({"RequestInfo": {"apiId": "seed"}, "preference": {
        "userId": uuid, "tenantId": TENANT,
        "preferenceCode": "USER_NOTIFICATION_PREFERENCES", "payload": payload}}).encode()
    req = urllib.request.Request(PREF + "/v1/_upsert", data=body, headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))


tok = token()
for username, (lang, consent) in ACCOUNTS.items():
    uid = uuid_for(tok, username)
    if not uid:
        print("SKIP %s: user not found" % username); continue
    try:
        upsert_pref(uid, lang, consent)
        print("OK %s (%s): lang=%s consent=%s" % (username, uid[:8], lang, consent))
    except urllib.error.HTTPError as e:
        print("FAIL %s: HTTP %s %s" % (username, e.code, e.read().decode()[:200]))
