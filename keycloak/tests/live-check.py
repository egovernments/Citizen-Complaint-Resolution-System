#!/usr/bin/env python3
"""Live check of the realm configure-keycloak.sh builds, on a real Keycloak.

Run through tests/run-live-check.sh, which starts a throwaway Keycloak and
mail catcher, applies the script, and exports what this needs. Every check
signs in through Keycloak's own pages the way a browser does; nothing is
mocked. Covers:

  * the declared realm (realm.json): events, retention, self-service actions,
    name fields, IMPORT sync, the employee one-time-code step, view-events;
  * each self-service action of design §8 on the employee client;
  * each Keycloak row of design §9 done as a configuration-only change, i.e.
    by editing realm.json or the realm, then re-running the script.
"""

import copy
import hashlib
import html
import hmac
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from kcbrowser import Browser, get_json, pkce_pair, post_json  # noqa: E402

KC = os.environ["KC_URL"]
MAIL = os.environ["MAILPIT_URL"]
CONFIGURE = os.environ["KEYCLOAK_CONFIGURE"]
REALM = os.environ["KEYCLOAK_ORGANIZATION_REALM"]
REDIRECT = os.environ["IDENTITY_REDIRECT_URI"]
EMPLOYEE = (os.environ.get("KEYCLOAK_EMPLOYEE_CLIENT_ID", "digit-ui-employee"),
            os.environ["KEYCLOAK_EMPLOYEE_CLIENT_SECRET"])
BFF = ("digit-identity-bff", os.environ["KEYCLOAK_BFF_CLIENT_SECRET"])
ADMIN_CLIENT = ("digit-identity-admin", os.environ["KEYCLOAK_ADMIN_CLIENT_SECRET"])
REALM_JSON = os.path.join(os.path.dirname(CONFIGURE), "realm.json")
DECLARED = json.load(open(REALM_JSON))
EXPIRATION = int(os.environ["KEYCLOAK_EVENTS_EXPIRATION_SECONDS"])
PASSWORD = "Initial-pass-1"


# ---------------------------------------------------------------- helpers

def master_token():
    return post_json(f"{KC}/realms/master/protocol/openid-connect/token", {
        "grant_type": "password", "client_id": "admin-cli",
        "username": "admin", "password": "admin"})["access_token"]


def service_token():
    """The BFF's admin service account, so checks see what the BFF can see."""
    return post_json(f"{KC}/realms/{REALM}/protocol/openid-connect/token", {
        "grant_type": "client_credentials",
        "client_id": ADMIN_CLIENT[0], "client_secret": ADMIN_CLIENT[1]})["access_token"]


def admin(method, path, body=None, token=None, realm=REALM):
    url = f"{KC}/admin/realms/{realm}{path}" if realm else f"{KC}/admin/realms{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token or master_token()}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as response:
        raw = response.read()
        if response.status == 201 and response.headers.get("Location"):
            return response.headers["Location"].rsplit("/", 1)[-1]
        return json.loads(raw) if raw else None


def configure(realm_config=None):
    """Re-runs configure-keycloak.sh, optionally with another realm.json."""
    env = dict(os.environ)
    if realm_config is not None:
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", dir=os.path.dirname(CONFIGURE), delete=False)
        json.dump(realm_config, handle)
        handle.close()
        env["KEYCLOAK_REALM_CONFIG"] = handle.name
    try:
        subprocess.run([CONFIGURE], env=env, check=True, stdout=subprocess.DEVNULL, timeout=600)
    finally:
        if realm_config is not None:
            os.unlink(handle.name)


def create_user(username, email=None, verified=True, first_name=None, password=PASSWORD):
    body = {"username": username, "enabled": True}
    if email:
        body.update(email=email, emailVerified=verified)
    if first_name:
        body["firstName"] = first_name
    user_id = admin("POST", "/users", body)
    admin("PUT", f"/users/{user_id}/reset-password",
          {"type": "password", "value": password, "temporary": False})
    return user_id


def totp(secret, step_offset=0):
    """RFC 6238 with Keycloak's defaults: SHA-1, 6 digits, 30 s. Keycloak keys
    the HMAC with the raw secret string it put in the form."""
    counter = int(time.time() // 30) + step_offset
    digest = hmac.new(secret.encode(), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


class SignIn:
    """One browser signing in to one client, optionally with kc_action."""

    def __init__(self, client=EMPLOYEE, **params):
        self.client = client
        self.browser = Browser()
        self.verifier, challenge = pkce_pair()
        query = {"client_id": client[0], "redirect_uri": REDIRECT, "response_type": "code",
                 "scope": "openid", "code_challenge": challenge, "code_challenge_method": "S256"}
        query.update(params)
        self.page = self.browser.request(
            f"{KC}/realms/{REALM}/protocol/openid-connect/auth?{urllib.parse.urlencode(query)}",
            stop_at=REDIRECT)

    def submit(self, required, values):
        action, fields = self.page.form(*required)
        fields.update(values)
        self.page = self.browser.request(action, fields, stop_at=REDIRECT)
        return self

    def password(self, username, password=PASSWORD):
        if self.has_form("username", "password"):
            return self.submit(("username", "password"), {"username": username, "password": password})
        self.submit(("username",), {"username": username})
        return self.submit(("password",), {"password": password})

    def has_form(self, *fields):
        return any(all(field in found for field in fields) for _, found in self.page.forms())

    @property
    def done(self):
        return self.page.location is not None

    def code(self):
        assert self.done, f"sign-in did not finish:\n{self.page.text()[:1500]}"
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.page.location).query)
        assert "code" in query, f"no code in {self.page.location}"
        return query["code"][0]

    def tokens(self):
        return post_json(f"{KC}/realms/{REALM}/protocol/openid-connect/token", {
            "grant_type": "authorization_code", "code": self.code(), "redirect_uri": REDIRECT,
            "client_id": self.client[0], "client_secret": self.client[1],
            "code_verifier": self.verifier})


def mail_to(address, since=0.0):
    """Newest message to `address` received after `since` (epoch seconds)."""
    for _ in range(30):
        listing = json.load(urllib.request.urlopen(
            f"{MAIL}/api/v1/search?query={urllib.parse.quote('to:' + address)}"))
        for message in listing.get("messages", []):
            created = message["Created"]
            stamp = time.mktime(time.strptime(created[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
            if stamp >= since - 2:
                return json.load(urllib.request.urlopen(f"{MAIL}/api/v1/message/{message['ID']}"))
        time.sleep(1)
    raise AssertionError(f"no mail to {address}")


def first_link(message):
    links = re.findall(r'https?://[^\s"<>]+', message.get("Text", "") or message.get("HTML", ""))
    links = [link.replace("&amp;", "&") for link in links if "action-token" in link or "key=" in link]
    assert links, f"no action link in mail: {message.get('Text', '')[:500]}"
    # Keycloak builds links from the request's host; the test reaches it on loopback.
    parsed = urllib.parse.urlparse(links[0])
    return urllib.parse.urlunparse(parsed._replace(netloc=urllib.parse.urlparse(KC).netloc))


def events(event_type, user_id=None):
    params = {"type": event_type, "max": 100}
    if user_id:
        params["user"] = user_id
    return admin("GET", f"/events?{urllib.parse.urlencode(params)}", token=service_token())


def credential(user_id, kind):
    return [c for c in admin("GET", f"/users/{user_id}/credentials") if c["type"] == kind]


RESULTS = []


def check(name):
    def register(fn):
        RESULTS.append((name, fn))
        return fn
    return register


# ------------------------------------------------- declared realm (§12)

@check("§12 events: user and admin events on, declared types, retention")
def _():
    config = admin("GET", "/events/config", token=service_token())  # needs view-events
    assert config["eventsEnabled"] is True, config
    assert config["adminEventsEnabled"] is True, config
    assert config["adminEventsDetailsEnabled"] is True, config
    assert config["eventsExpiration"] == EXPIRATION, config["eventsExpiration"]
    wanted = set(DECLARED["events"]["enabledEventTypes"])
    assert wanted <= set(config["enabledEventTypes"]), wanted - set(config["enabledEventTypes"])
    for must in ("VERIFY_EMAIL", "LOGOUT", "UPDATE_PASSWORD", "UPDATE_CREDENTIAL"):
        assert must in config["enabledEventTypes"], must
    realm = admin("GET", "")
    assert realm["attributes"]["adminEventsExpiration"] == str(EXPIRATION), realm["attributes"]
    return f"retention {EXPIRATION}s, {len(config['enabledEventTypes'])} user event types"


@check("§12 view-events: the BFF admin service account reads events")
def _():
    client = admin("GET", f"/clients?clientId={ADMIN_CLIENT[0]}")[0]
    user = admin("GET", f"/clients/{client['id']}/service-account-user")
    management = admin("GET", "/clients?clientId=realm-management")[0]
    roles = {r["name"] for r in admin("GET", f"/users/{user['id']}/role-mappings/clients/{management['id']}")}
    assert "view-events" in roles, roles
    admin("GET", "/events?max=1", token=service_token())
    admin("GET", "/admin-events?max=1", token=service_token())


@check("§12 names read-only for the person, lastName not required")
def _():
    profile = admin("GET", "/users/profile")
    by_name = {a["name"]: a for a in profile["attributes"]}
    for name in ("firstName", "lastName"):
        assert by_name[name]["permissions"]["edit"] == ["admin"], by_name[name]
    assert "required" not in by_name["lastName"], by_name["lastName"]
    assert profile["unmanagedAttributePolicy"] == "ADMIN_EDIT"


def declared_digit_attributes():
    return {name: config for name, config in DECLARED["userProfile"]["attributes"].items()
            if name.startswith("digit.")}


@check("§5.1 digit.* user attributes: declared admin-only with their length limits")
def _():
    by_name = {a["name"]: a for a in admin("GET", "/users/profile")["attributes"]}
    for name, wanted in declared_digit_attributes().items():
        stored = by_name.get(name)
        assert stored, f"{name} is not declared"
        assert stored["permissions"] == {"view": ["admin"], "edit": ["admin"]}, stored
        assert stored["validations"]["length"] == wanted["validations"]["length"], stored
        assert stored.get("multivalued", False) == wanted.get("multivalued", False), stored
    return f"{len(declared_digit_attributes())} attributes"


@check("§5.1 an existing realm without the digit.* declarations gets them on the next run")
def _():
    profile = admin("GET", "/users/profile")
    profile["attributes"] = [a for a in profile["attributes"] if not a["name"].startswith("digit.")]
    admin("PUT", "/users/profile", profile)
    configure()
    names = {a["name"] for a in admin("GET", "/users/profile")["attributes"]}
    assert set(declared_digit_attributes()) <= names, set(declared_digit_attributes()) - names


@check("§5.1 the BFF writes and reads back a digit.bindings value over 2048 characters")
def _():
    # Keycloak caps an undeclared attribute at 2048 characters (400
    # error-invalid-length); the realm declares digit.bindings with more.
    user_id = create_user("emp-long-attributes", "long-attributes@example.test")
    record = {"tenantId": "t" * 50, "uuid": "00000000-0000-4000-8000-000000000000", "state": "active",
              "invitationVersion": 1, "createdAt": 1, "boundAt": 1,
              "createdBy": {"kind": "browser", "subject": "s" * 36, "requestId": "a" * 64}}
    bindings = json.dumps({"v": 1, "bindings": [dict(record, tenantId=f"t{i:02d}" + "t" * 47) for i in range(64)]})
    assert len(bindings) > 2048, len(bindings)
    bound = [f"t{i:02d}{'t' * 47}|{record['uuid']}" for i in range(64)]
    token = service_token()  # the BFF's own admin client, not the master admin
    user = admin("GET", f"/users/{user_id}", token=token)
    admin("PUT", f"/users/{user_id}", {"email": user["email"], "attributes": {
        "digit.bindings": [bindings], "digit.boundUuids": bound}}, token=token)
    stored = admin("GET", f"/users/{user_id}", token=token)["attributes"]
    assert stored["digit.bindings"] == [bindings], len(stored["digit.bindings"][0])
    assert sorted(stored["digit.boundUuids"]) == sorted(bound)
    found = admin("GET", "/users?" + urllib.parse.urlencode(
        {"q": f"digit.boundUuids:{bound[7]}", "briefRepresentation": "false"}), token=token)
    assert [u["id"] for u in found] == [user_id], found
    # Past the declared limit Keycloak still refuses (the BFF logs it, §5.1).
    limit = declared_digit_attributes()["digit.bindings"]["validations"]["length"]["max"]
    try:
        admin("PUT", f"/users/{user_id}", {"email": user["email"], "attributes": {
            "digit.bindings": ["x" * (limit + 1)]}}, token=token)
        raise AssertionError("a value over the declared limit was accepted")
    except urllib.error.HTTPError as error:
        assert error.code == 400 and b"error-invalid-length" in error.read(), error
    # The declarations do not get in the way of signing in.
    assert SignIn().password("emp-long-attributes").tokens()["access_token"]
    return f"{len(bindings)} characters"


@check("#2121 the sign-up marker and the undeclared phone attributes survive an admin write")
def _():
    # Keycloak answers 204 to a PUT whose attributes it drops, so only a read-back proves
    # they are kept: digit.identityBffSignup is declared (above), while phoneNumber and
    # phoneNumberVerified stay undeclared and rely on unmanagedAttributePolicy ADMIN_EDIT.
    # Written as JSON with the BFF's own service account: kcadm can't set dotted keys.
    declared = {a["name"] for a in admin("GET", "/users/profile")["attributes"]}
    assert "digit.identityBffSignup" in declared, "the sign-up marker is not declared"
    assert not {"phoneNumber", "phoneNumberVerified"} & declared, "declared: this would not test the policy"
    token = service_token()
    user_id = admin("POST", "/users", {"username": f"attr-{time.time_ns()}", "enabled": True}, token=token)
    try:
        user = admin("GET", f"/users/{user_id}", token=token)
        written = {"digit.identityBffSignup": ["true"], "phoneNumber": ["+254700000001"], "phoneNumberVerified": ["true"]}
        admin("PUT", f"/users/{user_id}", {**user, "attributes": {**user.get("attributes", {}), **written}}, token=token)
        stored = admin("GET", f"/users/{user_id}", token=token).get("attributes", {})
        assert {name: stored.get(name) for name in written} == written, stored
    finally:
        admin("DELETE", f"/users/{user_id}", token=token)


@check("§12 identity providers and their mappers use IMPORT")
def _():
    providers = admin("GET", "/identity-provider/instances")
    assert {p["alias"] for p in providers} >= {"google", "github"}, providers
    for provider in providers:
        assert provider["config"].get("syncMode") == "IMPORT", provider
        assert provider["firstBrokerLoginFlowAlias"] == "digit-first-broker-login", provider
        for mapper in admin("GET", f"/identity-provider/instances/{provider['alias']}/mappers"):
            assert mapper["config"].get("syncMode") == "IMPORT", mapper


@check("§12 employee flow: password, then a conditional one-time code")
def _():
    flow = DECLARED["employeeFlow"]
    steps = admin("GET", "/authentication/flows/digit-employee-browser/executions")
    shape = [(s["level"], s.get("providerId") or s["displayName"], s["requirement"]) for s in steps]
    expected = [(0, "auth-username-password-form", "REQUIRED"),
                (0, flow["otpSubFlow"], "CONDITIONAL")]
    expected += [(1, provider, requirement) for provider, requirement in flow["otpSteps"].items()]
    assert shape == expected, shape
    assert not any(s.get("providerId") == "auth-cookie" for s in steps)


@check("§12 self-service required actions are enabled as declared")
def _():
    actions = {a["alias"]: a for a in admin("GET", "/authentication/required-actions")}
    for alias, config in DECLARED["requiredActions"].items():
        if alias.startswith("$"):
            continue
        assert actions[alias]["enabled"] is True, actions.get(alias)
        if config:
            stored = admin("GET", f"/authentication/required-actions/{alias}/config")["config"]
            assert {k: stored.get(k) for k in config} == config, stored


@check("surface client policy: CSV action allowlist and password-setup redirect")
def _():
    for client in (BFF[0], EMPLOYEE[0], "digit-ui-citizen"):
        [stored] = admin("GET", "/clients?clientId=" + client)
        assert stored["attributes"]["digit.auth.account.actions"] == ",".join(DECLARED["clientPolicy"]["accountActions"])
        assert REDIRECT.removesuffix("/callback") + DECLARED["clientPolicy"]["passwordSetupRedirectPath"] in stored["redirectUris"]


# ------------------------------------------ sign-in and self-service (§8)

STATE = {}


@check("a nameless employee signs in with password only, no profile prompt")
def _():
    STATE["emp"] = create_user("emp-nameless", "emp@example.test")
    tokens = SignIn().password("emp-nameless").tokens()
    assert tokens["access_token"]


@check("§8 CONFIGURE_TOTP, then the code is demanded at the next employee sign-in")
def _():
    signin = SignIn(kc_action="CONFIGURE_TOTP").password("emp-nameless")
    assert signin.has_form("totp", "totpSecret"), signin.page.text()[:800]
    _, fields = signin.page.form("totp", "totpSecret")
    STATE["secret"] = fields["totpSecret"]
    signin.submit(("totp", "totpSecret"), {"totp": totp(STATE["secret"]), "userLabel": "phone"})
    signin.tokens()
    assert credential(STATE["emp"], "otp"), "no OTP credential"

    nxt = SignIn().password("emp-nameless")
    assert nxt.has_form("otp") and not nxt.done, "no one-time code step after enrolment"
    nxt.submit(("otp",), {"otp": "000000" if totp(STATE["secret"], 1) != "000000" else "111111"})
    assert not nxt.done, "a wrong code was accepted"
    nxt.submit(("otp",), {"otp": totp(STATE["secret"], 1)})
    nxt.tokens()


@check("§8 delete_credential removes the second factor; the code step goes away")
def _():
    [otp] = credential(STATE["emp"], "otp")
    signin = SignIn(kc_action=f"delete_credential:{otp['id']}").password("emp-nameless")
    if signin.has_form("otp"):
        signin.submit(("otp",), {"otp": totp(STATE["secret"], -1)})
    # Keycloak asks to confirm the removal.
    action, fields = signin.page.forms()[0]
    fields.setdefault("accept", "")
    signin.page = signin.browser.request(action, fields, stop_at=REDIRECT)
    signin.tokens()
    assert not credential(STATE["emp"], "otp"), "OTP credential still present"
    assert SignIn().password("emp-nameless").done, "code still demanded"


@check("§8 UPDATE_PASSWORD: the new password works, the old one no longer does")
def _():
    signin = SignIn(kc_action="UPDATE_PASSWORD").password("emp-nameless")
    signin.submit(("password-new", "password-confirm"),
                  {"password-new": "Changed-pass-2", "password-confirm": "Changed-pass-2"})
    signin.tokens()
    assert not SignIn().password("emp-nameless").done, "old password still accepted"
    assert SignIn().password("emp-nameless", "Changed-pass-2").done


@check("§8 UPDATE_EMAIL: saved only after the new address is verified")
def _():
    started = time.time()
    signin = SignIn(kc_action="UPDATE_EMAIL").password("emp-nameless", "Changed-pass-2")
    signin.submit(("email",), {"email": "emp-new@example.test"})
    assert admin("GET", f"/users/{STATE['emp']}")["email"] == "emp@example.test", "changed before verifying"
    link = first_link(mail_to("emp-new@example.test", started))
    page = Browser().request(link, stop_at=REDIRECT)
    if page.location is None and page.forms():
        action, fields = page.forms()[0]
        page = Browser().request(action, fields, stop_at=REDIRECT)
    user = admin("GET", f"/users/{STATE['emp']}")
    assert user["email"] == "emp-new@example.test" and user["emailVerified"], user
    # Notifying the old address is deferred (contract §3.3.11); stock Keycloak
    # only verifies the new address.
    return "new address verified; old-address notification explicitly deferred"


@check("§8 VERIFY_EMAIL for an unverified address")
def _():
    user_id = create_user("emp-unverified", "unverified@example.test", verified=False)
    started = time.time()
    signin = SignIn(kc_action="VERIFY_EMAIL").password("emp-unverified")
    # An application-initiated VERIFY_EMAIL first asks the user to send it.
    action, fields = signin.page.forms()[0]
    signin.page = signin.browser.request(action, fields, stop_at=REDIRECT)
    link = first_link(mail_to("unverified@example.test", started))
    signin.page = signin.browser.request(link, stop_at=REDIRECT)
    if not signin.done and signin.page.forms():
        action, fields = signin.page.forms()[0]
        signin.page = signin.browser.request(action, fields, stop_at=REDIRECT)
    assert admin("GET", f"/users/{user_id}")["emailVerified"] is True


def ensure_upstream():
    """A second realm acting as an outside identity provider, added to the
    shared realm by configuration only (design §9, new identity provider)."""
    if "upstream" in STATE:
        return
    token = master_token()
    admin("POST", "", {"realm": "upstream", "enabled": True, "sslRequired": "none"}, token, realm=None)
    admin("POST", "/clients", {
        "clientId": "digit", "secret": "upstream-secret", "publicClient": False,
        "redirectUris": [f"{KC}/realms/{REALM}/broker/upstream/endpoint", "*"],
        "standardFlowEnabled": True}, token, realm="upstream")
    upstream_user = admin("POST", "/users", {
        "username": "outside", "enabled": True, "email": "outside@example.test",
        "emailVerified": True, "firstName": "Original", "lastName": "Name"}, token, realm="upstream")
    admin("PUT", f"/users/{upstream_user}/reset-password",
          {"type": "password", "value": PASSWORD, "temporary": False}, token, realm="upstream")
    inside = "http://127.0.0.1:8180/realms/upstream/protocol/openid-connect"
    outside = f"{KC}/realms/upstream/protocol/openid-connect"
    admin("POST", "/identity-provider/instances", {
        "alias": "upstream", "providerId": "keycloak-oidc", "enabled": True,
        "config": {"clientId": "digit", "clientSecret": "upstream-secret", "clientAuthMethod": "client_secret_post",
                   "authorizationUrl": f"{outside}/auth", "tokenUrl": f"{inside}/token",
                   "jwksUrl": f"{inside}/certs", "validateSignature": "true", "useJwksUrl": "true",
                   "issuer": f"{KC}/realms/upstream", "defaultScope": "openid email profile",
                   "syncMode": "FORCE"}}, token)
    admin("POST", "/identity-provider/instances/upstream/mappers", {
        "name": "department", "identityProviderAlias": "upstream",
        "identityProviderMapper": "hardcoded-attribute-idp-mapper",
        "config": {"syncMode": "FORCE", "attribute": "department", "attribute.value": "outside"}}, token)
    configure()
    STATE["upstream"] = upstream_user


def upstream_login(signin):
    """Completes the upstream realm's sign-in page, then any linking pages."""
    signin.submit(("username", "password"), {"username": "outside", "password": PASSWORD})
    for _ in range(4):
        if signin.done or not signin.page.forms():
            break
        action, fields = signin.page.forms()[0]
        signin.page = signin.browser.request(action, fields, stop_at=REDIRECT)
    return signin


@check("§9 new identity provider by configuration: IMPORT and the shared linking flow")
def _():
    ensure_upstream()
    provider = admin("GET", "/identity-provider/instances/upstream")
    assert provider["config"]["syncMode"] == "IMPORT", provider["config"]
    assert provider["firstBrokerLoginFlowAlias"] == "digit-first-broker-login", provider
    [mapper] = admin("GET", "/identity-provider/instances/upstream/mappers")
    assert mapper["config"]["syncMode"] == "IMPORT", mapper


@check("§8 idp_link links an outside account to a signed-in employee")
def _():
    ensure_upstream()
    signin = SignIn(kc_action="idp_link:upstream").password("emp-nameless", "Changed-pass-2")
    action, fields = signin.page.forms()[0]
    fields["continue"] = "Continue"
    signin.page = signin.browser.request(action, fields, stop_at=REDIRECT)
    upstream_login(signin).tokens()
    links = admin("GET", f"/users/{STATE['emp']}/federated-identity")
    assert [link["identityProvider"] for link in links] == ["upstream"], links


@check("D19 IMPORT: a provider's later name change does not overwrite Keycloak's")
def _():
    ensure_upstream()
    before = admin("GET", f"/users/{STATE['emp']}")
    admin("PUT", f"/users/{STATE['upstream']}", {"firstName": "Renamed", "lastName": "Elsewhere"},
          realm="upstream")
    [mapper] = admin("GET", "/identity-provider/instances/upstream/mappers")
    mapper["config"]["attribute.value"] = "changed-by-provider"
    admin("PUT", f"/identity-provider/instances/upstream/mappers/{mapper['id']}", mapper)
    upstream_login(SignIn(client=BFF, kc_idp_hint="upstream")).tokens()
    after = admin("GET", f"/users/{STATE['emp']}")
    assert after.get("firstName") == before.get("firstName"), (before.get("firstName"), after.get("firstName"))
    assert after.get("lastName") == before.get("lastName")
    assert (after.get("attributes") or {}).get("department") == (before.get("attributes") or {}).get("department")


@check("LOGOUT is recorded when a session is signed out")
def _():
    tokens = SignIn().password("emp-nameless", "Changed-pass-2").tokens()
    logout = urllib.request.Request(
        f"{KC}/realms/{REALM}/protocol/openid-connect/logout",
        data=urllib.parse.urlencode({"client_id": EMPLOYEE[0], "client_secret": EMPLOYEE[1],
                                     "refresh_token": tokens["refresh_token"]}).encode())
    urllib.request.urlopen(logout).read()


@check("the BFF service account sees every event the revocation poller needs")
def _():
    emp = STATE["emp"]
    found = {}
    for event_type in ("LOGIN", "LOGOUT", "UPDATE_PASSWORD", "UPDATE_CREDENTIAL", "REMOVE_CREDENTIAL",
                       "UPDATE_EMAIL", "VERIFY_EMAIL", "FEDERATED_IDENTITY_LINK", "CODE_TO_TOKEN"):
        found[event_type] = len(events(event_type, None if event_type == "VERIFY_EMAIL" else emp))
    missing = [t for t, n in found.items() if n == 0]
    assert not missing, f"no {missing} events; seen {found}"
    created = admin("GET", "/admin-events?operationTypes=CREATE&resourceTypes=USER&max=5",
                    token=service_token())
    assert created and created[0].get("representation"), "admin events lack representations"
    return ", ".join(f"{t}={n}" for t, n in found.items())


@check("frozen §10: password changes use code_id; login/logout use sessionId")
def _():
    for event_type in ("LOGIN", "LOGOUT"):
        [event, *_] = events(event_type, STATE["emp"])
        assert event.get("sessionId") and event.get("clientId") == EMPLOYEE[0]
    changed = [e for e in events("UPDATE_CREDENTIAL", STATE["emp"])
               if e.get("details", {}).get("credential_type") == "password"]
    assert changed and changed[0]["details"].get("code_id")
    assert changed[0]["clientId"] == EMPLOYEE[0]



def jwt_claims(token):
    import base64
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


@check("frozen §10: credential-change survivors — auth_time in the access token, action token leaves no SSO session")
def _():
    # Password setup by action token (execute-actions-email, as the BFF sends it).
    user = admin("POST", "/users", {"username": "emp-setup", "email": "setup@example.test",
                                    "emailVerified": True, "enabled": True})
    started = time.time()
    query = urllib.parse.urlencode({"client_id": EMPLOYEE[0], "lifespan": 600,
                                    "redirect_uri": REDIRECT.removesuffix("/callback") + "/password/setup-complete/live"})
    urllib.request.urlopen(urllib.request.Request(
        f"{KC}/admin/realms/{REALM}/users/{user}/execute-actions-email?{query}",
        data=json.dumps(["UPDATE_PASSWORD"]).encode(), method="PUT",
        headers={"Authorization": f"Bearer {master_token()}", "Content-Type": "application/json"})).read()
    browser = Browser()
    page = browser.request(first_link(mail_to("setup@example.test", started)))
    proceed = re.search(r'href="([^"]*login-actions/action-token[^"]*)"', page.body)
    if proceed:
        page = browser.request(urllib.parse.urljoin(page.url, html.unescape(proceed.group(1))))
    action, fields = page.form("password-new", "password-confirm")
    fields.update({"password-new": "Setup-pass-1", "password-confirm": "Setup-pass-1"})
    browser.request(action, fields)
    [setup] = events("UPDATE_CREDENTIAL", user)
    assert setup.get("sessionId") is None and setup["details"].get("code_id"), setup
    # No SSO session survives the action token, so the next sign-in authenticates afresh.
    assert admin("GET", f"/users/{user}/sessions") == [], "action token left an SSO session"
    # A required action inside a sign-in: the event's code_id is that sign-in's sid.
    create_user("emp-inline", "inline@example.test")
    signin = SignIn(kc_action="UPDATE_PASSWORD").password("emp-inline")
    signin.submit(("password-new", "password-confirm"),
                  {"password-new": "Inline-pass-2", "password-confirm": "Inline-pass-2"})
    access = jwt_claims(signin.tokens()["access_token"])
    [inline] = events("UPDATE_CREDENTIAL", admin("GET", "/users?username=emp-inline&exact=true")[0]["id"])
    assert isinstance(access.get("auth_time"), int), access
    assert inline["details"]["code_id"] == access["sid"], (inline, access)
    started_ms = admin("GET", f"/users/{access['sub']}/sessions")[0]["start"]
    return f"auth_time={access['auth_time']} session start={started_ms} event time={inline['time']}"

@check("frozen §10: membership removal identifies the person in resourcePath")
def _():
    org = admin("POST", "/organizations", {"name": "Live Check Org", "alias": "live-check-org",
                                           "domains": [{"name": "live-check.example"}]})
    req = urllib.request.Request(
        f"{KC}/admin/realms/{REALM}/organizations/{org}/members", data=json.dumps(STATE["emp"]).encode(),
        method="POST", headers={"Authorization": f"Bearer {master_token()}",
                                "Content-Type": "application/json"})
    urllib.request.urlopen(req).read()
    admin("DELETE", f"/organizations/{org}/members/{STATE['emp']}")
    found = admin("GET", "/admin-events?operationTypes=DELETE&resourceTypes=ORGANIZATION_MEMBERSHIP&max=5",
                  token=service_token())
    assert any(e["resourcePath"] == f"organizations/{org}/members/{STATE['emp']}" for e in found)


# ----------------------------------- configuration-only changes (§9)

def with_declared(change):
    config = copy.deepcopy(DECLARED)
    change(config)
    return config


@check("§9 staff SSO policy: otpRequirement REQUIRED makes every employee set up a code")
def _():
    configure(with_declared(lambda c: c["employeeFlow"].update(otpRequirement="REQUIRED")))
    try:
        create_user("emp-policy", "policy@example.test")
        signin = SignIn().password("emp-policy")
        assert signin.has_form("totp", "totpSecret"), signin.page.text()[:800]
    finally:
        configure()
    assert SignIn().password("emp-policy").done, "policy not reverted"


@check("§9 Keycloak-hosted authenticator and new self-service action: recovery codes")
def _():
    def change(config):
        config["requiredActions"]["CONFIGURE_RECOVERY_AUTHN_CODES"] = {}
        config["employeeFlow"]["otpSteps"] = {
            "conditional-user-configured": "REQUIRED",
            "auth-otp-form": "ALTERNATIVE",
            "auth-recovery-authn-code-form": "ALTERNATIVE"}
    configure(with_declared(change))
    try:
        create_user("emp-recovery", "recovery@example.test")
        signin = SignIn(kc_action="CONFIGURE_RECOVERY_AUTHN_CODES").password("emp-recovery")
        action, fields = signin.page.form("generatedRecoveryAuthnCodes")
        codes = fields["generatedRecoveryAuthnCodes"].split(",")
        signin.page = signin.browser.request(action, fields, stop_at=REDIRECT)
        signin.tokens()
        nxt = SignIn().password("emp-recovery")
        nxt.submit(("recoveryCodeInput",), {"recoveryCodeInput": codes[0]})
        nxt.tokens()
    finally:
        configure()


@check("§9 new browser surface: a client added by configuration survives the script")
def _():
    client_id = admin("POST", "/clients", {
        "clientId": "digit-ui-new-surface", "secret": "surface-secret", "publicClient": False,
        "standardFlowEnabled": True, "redirectUris": [REDIRECT],
        "attributes": {"pkce.code.challenge.method": "S256", "digit.auth.surface": "employee",
                       "digit.auth.signin.methods": "password"}})
    configure()
    stored = admin("GET", f"/clients/{client_id}")
    assert stored["attributes"]["digit.auth.surface"] == "employee", stored["attributes"]
    assert SignIn(client=("digit-ui-new-surface", "surface-secret")).password("emp-nameless", "Changed-pass-2").done


@check("§9 new login-page string through realm localisation")
def _():
    req = urllib.request.Request(
        f"{KC}/admin/realms/{REALM}/localization/en/loginAccountTitle",
        data="Sign in to your DIGIT workspace".encode(), method="PUT",
        headers={"Authorization": f"Bearer {master_token()}", "Content-Type": "text/plain"})
    urllib.request.urlopen(req).read()
    page = SignIn().page
    assert "Sign in to your DIGIT workspace" in page.text(), page.text()[:500]


def main():
    selected = sys.argv[1:]
    failed = 0
    for name, fn in RESULTS:
        if selected and not any(term in name for term in selected):
            continue
        try:
            note = fn()
            print(f"PASS  {name}" + (f"  ({note})" if note else ""))
        except Exception as error:  # noqa: BLE001 - report every check
            failed += 1
            print(f"FAIL  {name}\n      {type(error).__name__}: {str(error)[:1500]}")
            if os.environ.get("VERBOSE"):
                traceback.print_exc()
    total = sum(1 for name, _ in RESULTS if not selected or any(t in name for t in selected))
    print(f"\n{total - failed}/{total} checks passed against Keycloak "
          f"{get_json(f'{KC}/admin/serverinfo', master_token())['systemInfo']['version']}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
