#!/usr/bin/env python3
"""
CI e2e harness for PGR notification routing, asserted through the delivery LEDGER.

WHAT CHANGED AND WHY
--------------------
This harness used to count messages on the Kafka topic `complaints.domain.events`:
pgr-services rendered one pre-rendered envelope per (recipient x channel), so tailing
the topic with `rpk` and counting per transition was a fair proxy for "who got told".

Under the thin-event design that proxy is gone. A transition now publishes ONE thin
event and the box decides the fan-out, so a count on that topic measures the producer's
intent and nothing else -- it would read "1" for a transition that notified nine people
and "1" for one that notified nobody.

So the assertions moved to where the outcome actually is:

    GET /novu-bridge/novu-adapter/v1/logs?tenantId=...&referenceNumber=<complaintNo>

which is a better assertion than the old one even on the pre-move path, because it
proves the OUTCOME rather than the intent. The Kafka tail survives as a separate,
deliberately WEAKER check: exactly one thin event per transition was published. It is
advisory -- `rpk` may not be reachable from wherever this runs -- and it never fails the
run on its own.

WHAT IT ASSERTS
---------------
  1. Which namespace serves this tenant's config -- GET /config/source when the bridge
     has it, else inferred from mdms-v2 row counts. Per tenant, all-or-nothing (design
     5.2). Everything downstream reads the masters from whichever one answered.
  2. The EXPECT matrix is read from that namespace: NOTIFICATIONS.Routing rows keyed on
     eventName = <PREFIX>.<ACTION>.<TOSTATE>, or the legacy RAINMAKER-PGR.NotificationRouting
     rows adapted on the way in (the same mapping notifications_convert.py applies).
  3. Per driven transition, every expected (audience, channel) tuple has a ledger row,
     and every row's status/last_error_code is one the tenant's own channel policy
     predicts (channel off -> NB_NO_PROVIDER; WhatsApp with no approved provider
     template -> NB_TEMPLATE_NOT_APPROVED; otherwise SENT). NB_CONTACT_MISSING is an
     accepted per-recipient outcome -- it is a property of the person, not the config.
  4. A transition with NO routing rows produces exactly ONE channel-less row --
     channel NONE, SKIPPED/NB_NO_ROUTING, transaction_id <seed>:NONE -- on the thin
     path, and zero rows on the pre-move path. Which path is in effect is read off
     `source_path`, not guessed.
  5. transaction_id keeps its documented shape (six colon-separated parts, or the
     four-part <seed>:NONE), is unique per row, and event_name is COMPLAINTS.WORKFLOW.<ACTION>.
  6. source_path is consistent: all RESOLVED or all PRERENDERED. Both at once means two
     producers are live and one transition can send twice (design R1).

SEEDING IS NOT THIS SCRIPT'S JOB ANY MORE. It used to create the masters from the repo's
committed seed files, which staged the REPO's defaults over a tenant that has its own --
live servers have drifted from 24/42/14 rows to ~41/60/14 through operator edits. The
seeder (`local-setup/scripts/seed-notifications.py`, run by
`./deploy.sh <tenant> --tags notifications`) reads the live rows and converts them, which
is the only correct way to do it. This harness asserts; it does not author config.

EXIT CODES (unchanged contract)
  0  every assertion passed and at least one assertion ran
  1  any assertion failed, or nothing ran (a down stack yields a FAIL summary, never a
     traceback)

Environment variables:
  DIGIT_URL        Kong gateway URL            (default: http://localhost:18000)
  DIGIT_USERNAME   Admin username              (default: ADMIN)
  DIGIT_PASSWORD   Admin password              (default: eGov@123)
  ROOT_TENANT      Root tenant for login       (default: ke)
  TARGET_TENANT    Tenant to drive             (default: ke.bomet)
  STATE_TENANT     Tenant the masters live at  (default: first label of TARGET_TENANT)
  SERVICE_CODE     Complaint serviceCode       (default: auto-discover a leaf)
  REDPANDA_CONTAINER  redpanda container name  (default: digit-redpanda)
  KAFKA_TOPIC      domain events topic         (default: complaints.domain.events)
  THIN_TOPIC       module-neutral topic        (default: notifications.events)
  CONSUME_SECS     seconds to tail per drive   (default: 25)
  SETTLE_SECS      seconds to wait for the ledger after a transition (default: 45)

Flags:
  --no-drive    Read the config + assert the matrix loads; do not create/transition
                complaints. Ledger assertions are skipped (there is nothing to assert on).
  --seed-only   Deprecated alias for --no-drive. Seeding moved to seed-notifications.py.
"""

import os
import sys
import json
import time
import base64
import subprocess

try:
    import requests
except ImportError:  # keep importable for syntax-check on a bare box
    requests = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

# The ONE legacy -> new mapping. Importing it rather than restating it is the point:
# a harness that re-implemented the audience table would drift from the converter and
# then assert the wrong audiences with great confidence.
import notifications_convert as NC  # noqa: E402


# ----------------------------- configuration -------------------------------------------------

BASE_URL = os.environ.get("DIGIT_URL", "http://localhost:18000").rstrip("/")
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
ROOT_TENANT = os.environ.get("ROOT_TENANT", "ke")
TARGET_TENANT = os.environ.get("TARGET_TENANT", "ke.bomet")
STATE_TENANT = os.environ.get("STATE_TENANT", "") or TARGET_TENANT.split(".")[0]
SERVICE_CODE = os.environ.get("SERVICE_CODE", "")
REDPANDA_CONTAINER = os.environ.get("REDPANDA_CONTAINER", "digit-redpanda")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "complaints.domain.events")
THIN_TOPIC = os.environ.get("THIN_TOPIC", "notifications.events")
CONSUME_SECS = int(os.environ.get("CONSUME_SECS", "25"))
SETTLE_SECS = int(os.environ.get("SETTLE_SECS", "45"))

NB_PREFIX = "/novu-bridge/novu-adapter/v1"

VALID_CHANNELS = ("SMS", "WHATSAPP", "EMAIL")
CHANNEL_NONE = "NONE"

# The drive sequence we exercise. Each leg's expectation is READ from the tenant's own
# routing rows; the only thing hardcoded here is which transitions we can reach.
DRIVE_SEQUENCE = [
    ("APPLY", "PENDINGFORASSIGNMENT"),
    ("ASSIGN", "PENDINGATLME"),
    ("RESOLVE", "RESOLVED"),
    ("RATE", "CLOSEDAFTERRESOLUTION"),
]

GREEN, RED, YEL, NC_ = "\033[0;32m", "\033[0;31m", "\033[0;33m", "\033[0m"


class Results:
    def __init__(self):
        self.rows = []   # (label, ok, detail)

    def add(self, label, ok, detail=""):
        self.rows.append((label, bool(ok), detail))
        tag = f"{GREEN}PASS{NC_}" if ok else f"{RED}FAIL{NC_}"
        print(f"  [{tag}] {label}" + (f" - {detail}" if detail else ""))

    def note(self, label, detail=""):
        """Advisory: printed, never counted. Used for the weakened Kafka check."""
        print(f"  [{YEL}NOTE{NC_}] {label}" + (f" - {detail}" if detail else ""))

    def ok(self):
        return all(ok for _, ok, _ in self.rows)


# ----------------------------- low-level helpers ---------------------------------------------

def section(title):
    print("\n" + "=" * 64)
    print(title)
    print("=" * 64)


def http_post(url, payload, headers=None, timeout=30):
    """POST JSON; return (status_code, json_or_text) or (None, error_string)."""
    if requests is None:
        return None, "requests-not-installed"
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    try:
        r = requests.post(url, json=payload, headers=h, timeout=timeout)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def http_get(url, headers=None, timeout=30):
    if requests is None:
        return None, "requests-not-installed"
    try:
        r = requests.get(url, headers=headers or {}, timeout=timeout)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def http_form(url, data, headers=None, timeout=30):
    if requests is None:
        return None, "requests-not-installed"
    try:
        r = requests.post(url, data=data, headers=headers or {}, timeout=timeout)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def docker_exec(container, argv, timeout=60, input_text=None):
    """Run `docker exec <container> <argv...>`; return (rc, stdout, stderr)."""
    cmd = ["docker", "exec"]
    if input_text is not None:
        cmd.append("-i")
    cmd.append(container)
    cmd.extend(argv)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           input=input_text)
        return p.returncode, p.stdout, p.stderr
    except FileNotFoundError:
        return 127, "", "docker-not-found"
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except Exception as e:
        return 1, "", f"{type(e).__name__}: {e}"


def login():
    """OAuth2 password grant via Kong. Returns (auth_token, user_info) or (None, None)."""
    token_url = f"{BASE_URL}/user/oauth/token"
    creds = base64.b64encode(b"egov-user-client:").decode()
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": f"Basic {creds}",
    }
    data = {
        "username": USERNAME, "password": PASSWORD, "userType": "EMPLOYEE",
        "tenantId": ROOT_TENANT, "scope": "read", "grant_type": "password",
    }
    code, body = http_form(token_url, data, headers)
    if code == 200 and isinstance(body, dict):
        return body.get("access_token"), body.get("UserRequest", {})
    print(f"  login failed: status={code} body={str(body)[:200]}")
    return None, None


def request_info(token, user_info):
    return {
        "apiId": "Rainmaker", "ver": "1.0", "ts": int(time.time() * 1000),
        "action": "_create", "msgId": f"ci-notif|{int(time.time())}",
        "authToken": token, "userInfo": user_info or {},
    }


def _s(value):
    return "" if value is None else str(value).strip()


def _up(value):
    return _s(value).upper()


# ----------------------------- config source + masters ----------------------------------------

def search_master(token, user_info, schema_code, tenant):
    """mdms-v2 v1-compat search. `schema_code` is `MODULE.Master`."""
    if not schema_code or "." not in schema_code:
        return None
    module, master = schema_code.split(".", 1)
    url = f"{BASE_URL}/mdms-v2/v1/_search"
    payload = {
        "RequestInfo": request_info(token, user_info),
        "MdmsCriteria": {"tenantId": tenant, "moduleDetails": [
            {"moduleName": module, "masterDetails": [{"name": master}]}]},
    }
    code, body = http_post(url, payload)
    if code == 200 and isinstance(body, dict):
        return body.get("MdmsRes", {}).get(module, {}).get(master, [])
    return None


def schema_code_for(master, source):
    """`master` is one of Routing / Template / ProviderTemplate / Channel / EventCatalogue."""
    legacy = {
        "Routing": "RAINMAKER-PGR.NotificationRouting",
        "Template": "RAINMAKER-PGR.NotificationTemplate",
        "ProviderTemplate": "RAINMAKER-PGR.NotificationProviderTemplate",
        "Channel": "RAINMAKER-PGR.NotificationChannel",
        "EventCatalogue": None,   # new; there is nothing to fall back to
    }
    if source == "NOTIFICATIONS":
        return "NOTIFICATIONS." + master
    return legacy[master]


def resolve_config_source(token, user_info, res):
    """Which namespace serves this tenant. The bridge's endpoint first, MDMS as the fallback.

    The endpoint is the authority when it exists, because it is what the bridge itself
    decided. When it does not (a build without the resolution stage), the same rule is
    applied to the row counts, which is exactly how the bridge computes it.
    """
    code, body = http_get(f"{BASE_URL}{NB_PREFIX}/config/source?tenantId={TARGET_TENANT}")
    if code == 200 and isinstance(body, dict) and body.get("masters"):
        masters = body["masters"]
        any_legacy = bool(body.get("anyLegacy")) or any(m.get("legacy") for m in masters.values())
        source = "RAINMAKER-PGR" if any_legacy else "NOTIFICATIONS"
        detail = " ".join(f"{k}={v.get('schemaCode')}({v.get('rows')})" for k, v in masters.items())
        res.add("config source readable via GET /config/source", True, f"{source}: {detail}")
        return source, True

    new_rows = search_master(token, user_info, "NOTIFICATIONS.Routing", STATE_TENANT)
    legacy_rows = search_master(token, user_info, "RAINMAKER-PGR.NotificationRouting", STATE_TENANT)
    n_new = len(new_rows or [])
    n_legacy = len(legacy_rows or [])
    source = "NOTIFICATIONS" if n_new > 0 else "RAINMAKER-PGR"
    res.add("config source inferred from MDMS row counts", n_new + n_legacy > 0,
            f"{source} (NOTIFICATIONS.Routing={n_new}, RAINMAKER-PGR.NotificationRouting={n_legacy}); "
            f"GET /config/source answered {code} -- this bridge has no resolution stage yet")
    return source, False


def parse_event_name(event_name):
    """'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME' -> ('ASSIGN', 'PENDINGATLME'), else None.

    The last two dotted segments are the action and the target state; neither ever
    contains a dot. Fewer than four segments cannot be split without guessing, and the
    ledger's transaction_id is parsed on exactly that pair, so we refuse rather than guess.
    """
    parts = [p.strip() for p in _s(event_name).split(".") if p.strip()]
    if len(parts) < 4:
        return None
    return parts[-2].upper(), parts[-1].upper()


def build_expect_matrix(rows, source):
    """Routing rows (either namespace) -> {(action, toState): {audience_ref: set(channels)}}.

    The legacy branch replays NotificationRouter.route()'s filters and then maps each
    bare audience through notifications_convert.audience_ref, so both branches produce
    the same audience vocabulary and everything downstream is one code path.
    """
    matrix = {}
    dropped = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if not NC.is_active(row):
            continue
        if source == "NOTIFICATIONS":
            parsed = parse_event_name(row.get("eventName"))
            if not parsed:
                dropped.append((row, "eventName %r is not <PREFIX>.<ACTION>.<TOSTATE>"
                                % row.get("eventName")))
                continue
            action, to_state = parsed
            audience = _s(row.get("audience"))
        else:
            bs = _up(row.get("businessService"))
            if bs and bs != "PGR":
                continue
            action, to_state = _up(row.get("action")), _up(row.get("toState"))
            if not action or not to_state:
                dropped.append((row, "blank action or toState"))
                continue
            try:
                audience = NC.audience_ref(row.get("audience"), row.get("assigneeOnly"))
            except NC.ConversionError as exc:
                dropped.append((row, str(exc)))
                continue
        if not audience:
            dropped.append((row, "audience %r is not notifiable" % row.get("audience")))
            continue
        channel = _up(row.get("channel"))
        if channel not in VALID_CHANNELS:
            dropped.append((row, "channel %r is not one of %s" % (channel, "/".join(VALID_CHANNELS))))
            continue
        matrix.setdefault((action, to_state), {}).setdefault(audience, set()).add(channel)
    return matrix, dropped


def build_channel_policy(token, user_info, res):
    """The tenant's channel policy, resolved exactly as ChannelPolicyClient resolves it.

    NOTIFICATIONS.Channel rows if there are any, else the legacy master, else the
    deployment-wide env allowlist -- which this script cannot read, so a tenant with no
    rows at all leaves every channel UNKNOWN and its expectations are not asserted
    (reported, not silently passed).
    """
    for code in ("NOTIFICATIONS.Channel", "RAINMAKER-PGR.NotificationChannel"):
        rows = search_master(token, user_info, code, STATE_TENANT) or []
        rows = [r for r in rows if isinstance(r, dict) and NC.is_active(r) and _s(r.get("code"))]
        if rows:
            policy = {}
            for row in rows:
                policy[_up(row.get("code"))] = {
                    "enabled": bool(row.get("enabled")),
                    "provider": _s(row.get("provider")) or None,
                }
            # A tenant WITH rows is governed by them alone: a channel with no row is off.
            for ch in VALID_CHANNELS:
                policy.setdefault(ch, {"enabled": False, "provider": None})
            res.add(f"channel policy from {code}", True,
                    " ".join(f"{c}={'on' if policy[c]['enabled'] else 'off'}" for c in VALID_CHANNELS))
            return policy, code
    res.add("channel policy", True,
            "no channel rows in either namespace -- the bridge falls back to "
            "novu.bridge.channels.enabled, which this script cannot read; per-channel "
            "expectations are reported, not asserted")
    return None, None


def approved_provider_templates(token, user_info, source, routing_rows):
    """(action, toState, audience, channel) -> count of approved, active provider templates."""
    code = schema_code_for("ProviderTemplate", source)
    rows = search_master(token, user_info, code, STATE_TENANT) or []
    index = NC.build_audience_index(routing_rows if source == "RAINMAKER-PGR" else [])
    counts = {}
    for row in rows:
        if not isinstance(row, dict) or not NC.is_active(row):
            continue
        if _s(row.get("approvalStatus")).lower() != "approved":
            continue
        if source == "NOTIFICATIONS":
            parsed = parse_event_name(row.get("eventName"))
            if not parsed:
                continue
            action, to_state = parsed
            audience = _s(row.get("audience"))
        else:
            action, to_state = _up(row.get("action")), _up(row.get("toState"))
            try:
                audience = NC._joined_audience(row, index)
            except NC.ConversionError:
                continue
        if not audience:
            continue
        key = (action, to_state, audience, _up(row.get("channel")))
        counts[key] = counts.get(key, 0) + 1
    return counts


def channel_expectation(channel, policy, approved):
    """What a row for (recipient x channel) should say, from the tenant's own config.

    The order is the gate order in DispatchPipelineService, which is the thing being
    asserted: the WhatsApp template gate runs BEFORE the provider-availability gate.
    Returns (status, code, tolerated_codes, reason). status None = not assertable.
    """
    contact_missing = ("SKIPPED", "NB_CONTACT_MISSING")
    if policy is None:
        return None, None, [], "channel policy unknown (env fallback, unreadable from here)"
    setting = policy.get(channel, {"enabled": False, "provider": None})
    if not setting["enabled"]:
        return "SKIPPED", "NB_NO_PROVIDER", [], f"{channel} is not enabled for this tenant"
    if channel == "WHATSAPP" and approved <= 0:
        return ("SKIPPED", "NB_TEMPLATE_NOT_APPROVED", [contact_missing],
                "WhatsApp is on but no approved provider template matches this (event, audience)")
    tolerated = [contact_missing]
    if setting["provider"]:
        # Whether the pinned provider is usable needs Novu, which this script does not
        # reach. Tolerated and REPORTED, never silently folded into a pass.
        tolerated.append(("SKIPPED", "NB_PROVIDER_UNAVAILABLE"))
    return "SENT", None, tolerated, f"{channel} is enabled and a template should resolve"


# ----------------------------- the ledger -----------------------------------------------------

def fetch_logs(complaint_no, limit=500):
    """GET /logs for one complaint. Returns (rows, detail) with rows=None on failure."""
    url = (f"{BASE_URL}{NB_PREFIX}/logs?tenantId={TARGET_TENANT}"
           f"&referenceNumber={complaint_no}&limit={limit}")
    code, body = http_get(url)
    if code != 200 or not isinstance(body, dict):
        return None, f"GET /logs returned {code}: {str(body)[:160]}"
    data = body.get("data")
    if not isinstance(data, list):
        return None, f"GET /logs answered 200 with no data array: {str(body)[:160]}"
    return data, f"{len(data)} ledger row(s), total={body.get('total')}"


def parse_transaction_id(txn):
    """Six colon-separated parts, or the four-part `<seed>:NONE` channel-less shape."""
    parts = _s(txn).split(":")
    channel_less = len(parts) == 4 and parts[3].upper() == CHANNEL_NONE
    return {
        "action": _up(parts[1]) if len(parts) > 1 else "",
        "toState": _up(parts[2]) if len(parts) > 2 else "",
        "uuid": parts[-2] if len(parts) >= 6 else "",
        "channelLess": channel_less,
        "wellFormed": len(parts) == 6 or channel_less,
    }


def fetch_roles(token, user_info, uuids):
    """uuid -> set of role codes, via egov-user `_search`.

    This is what makes a `ROLE:` audience a real assertion through the API rather than a
    shrug: the ledger says who was reached, egov-user says whether they hold the role the
    routing row named. A uuid the search does not return is left out, and the row it came
    from is reported as unattributable rather than counted either way.
    """
    out = {}
    uuids = [u for u in uuids if u and "***" not in u]
    if not uuids:
        return out
    code, body = http_post(f"{BASE_URL}/user/_search", {
        "RequestInfo": request_info(token, user_info),
        "uuid": uuids,
        "tenantId": TARGET_TENANT,
    })
    if code != 200 or not isinstance(body, dict):
        return out
    for user in body.get("user") or []:
        uid = _s(user.get("uuid"))
        if not uid:
            continue
        out[uid] = {_up(r.get("code")) for r in (user.get("roles") or []) if r.get("code")}
    return out


def rows_for_transition(rows, action, to_state):
    out = []
    for row in rows or []:
        t = parse_transaction_id(row.get("transactionId"))
        if t["action"] == action and t["toState"] == to_state:
            out.append((row, t))
    return out


def audience_of_row(row, t, audience, uuid_roles):
    """Does this ledger row belong to this audience reference?

    The /logs projection masks recipient PII, but a uuid survives masking untouched (it
    has no 7+-digit run), which is what makes this check possible through the API at all.
    A row whose subscriber segment IS masked (a uuid-less recipient, published under a
    phone) cannot be attributed to an audience and is reported rather than counted.
    """
    uuid = t["uuid"]
    if not uuid or "***" in uuid:
        return None   # unattributable, not "no"
    for part in _s(audience).split("|"):
        part = part.strip()
        if part.startswith("ROLE:"):
            if part[5:].strip().upper() in uuid_roles.get(uuid, set()):
                return True
        elif part.startswith("ACTOR:") or part == "EVENT_RECIPIENTS":
            # The producer alone knows who the named actor is; through the API all we can
            # say is that SOMEBODY was reached on this tuple. Asserting identity needs
            # database access, which e2e-role-notifications.js has and this does not.
            return True
    return False


# ----------------------------- drive transitions ----------------------------------------------

def discover_service_code(token, user_info):
    if SERVICE_CODE:
        return SERVICE_CODE
    rows = search_master(token, user_info, "RAINMAKER-PGR.ComplaintHierarchy", STATE_TENANT)
    if rows:
        leaves = [r for r in rows if r.get("department")]
        if leaves:
            return leaves[0].get("code")
    return None


def pgr_create(token, user_info, service_code):
    url = f"{BASE_URL}/pgr-services/v2/request/_create"
    service = {
        "tenantId": TARGET_TENANT,
        "serviceCode": service_code,
        "description": "CI notification-routing e2e",
        "source": "web",
        "address": {"tenantId": TARGET_TENANT, "city": TARGET_TENANT,
                    "geoLocation": {"latitude": -0.78, "longitude": 35.34}},
    }
    payload = {
        "RequestInfo": request_info(token, user_info),
        "service": service,
        "workflow": {"action": "APPLY"},
    }
    code, body = http_post(url, payload)
    if code in (200, 201) and isinstance(body, dict):
        svcs = body.get("ServiceWrappers") or body.get("services") or []
        if svcs:
            s = svcs[0].get("service", svcs[0])
            return s.get("serviceRequestId"), s
    return None, body


def pgr_update(token, user_info, service_obj, action, assignees=None, rating=None):
    url = f"{BASE_URL}/pgr-services/v2/request/_update"
    wf = {"action": action}
    if assignees:
        wf["assignes"] = assignees
    svc = dict(service_obj or {})
    svc.pop("processInstance", None)
    if rating is not None:
        svc["rating"] = rating
    payload = {
        "RequestInfo": request_info(token, user_info),
        "service": svc,
        "workflow": wf,
    }
    code, body = http_post(url, payload)
    if code in (200, 201) and isinstance(body, dict):
        svcs = body.get("ServiceWrappers") or body.get("services") or []
        if svcs:
            return svcs[0].get("service", svcs[0])
    return None


# ----------------------------- assertions -----------------------------------------------------

def assert_transition(rows, action, to_state, matrix, policy, approved_counts, thin_path,
                      uuid_roles, res):
    """One transition: the expected tuples are present and say what the config predicts."""
    expected = matrix.get((action, to_state), {})
    here = rows_for_transition(rows, action, to_state)

    # ---- The no-routing case (E2E-4's CI twin) -------------------------------------
    if not expected:
        channel_less = [r for r, t in here
                        if _up(r.get("channel")) == CHANNEL_NONE
                        and _up(r.get("status")) == "SKIPPED"
                        and _s(r.get("lastErrorCode")) == "NB_NO_ROUTING"]
        others = [r for r, t in here if r not in channel_less]
        if thin_path is True:
            ok = len(channel_less) == 1 and not others
            res.add(f"{action}->{to_state}: no routing -> one SKIPPED/NB_NO_ROUTING row", ok,
                    f"channel-less={len(channel_less)} other={len(others)}")
        elif thin_path is False:
            res.add(f"{action}->{to_state}: no routing -> zero rows (pre-move producer)",
                    len(here) == 0, f"rows={len(here)}")
        else:
            ok = len(here) == 0 or (len(channel_less) == 1 and not others)
            res.add(f"{action}->{to_state}: no routing -> zero rows or one NB_NO_ROUTING row", ok,
                    f"rows={len(here)} (producer path not observed)")
        return

    for audience, channels in sorted(expected.items()):
        for channel in sorted(channels):
            on_channel = [(r, t) for r, t in here if _up(r.get("channel")) == channel]
            attributed = []
            unattributable = 0
            for r, t in on_channel:
                verdict = audience_of_row(r, t, audience, uuid_roles)
                if verdict is None:
                    unattributable += 1
                elif verdict:
                    attributed.append(r)

            label = f"{action}->{to_state} {audience} on {channel}"
            if not attributed:
                res.add(label, False,
                        f"no ledger row (rows on this channel: {len(on_channel)}, "
                        f"unattributable: {unattributable})")
                continue

            status, code, tolerated, reason = channel_expectation(
                channel, policy, approved_counts.get((action, to_state, audience, channel), 0))
            if status is None:
                res.add(label, True,
                        f"{len(attributed)} row(s) "
                        + ",".join(sorted({_up(r.get('status')) for r in attributed}))
                        + f" -- status not asserted: {reason}")
                continue

            bad = []
            for r in attributed:
                got = (_up(r.get("status")), _s(r.get("lastErrorCode")) or None)
                if got == (status, code):
                    continue
                if status == "SENT" and got[0] in ("SENT", "DELIVERED") and not got[1]:
                    continue
                if got in [(s, c) for s, c in tolerated]:
                    continue
                bad.append("/".join(x for x in got if x))
            res.add(label, not bad,
                    f"{len(attributed)} row(s); expected {status}{'/' + code if code else ''} "
                    f"({reason})" + (f"; got {','.join(sorted(set(bad)))}" if bad else ""))


def assert_ledger_invariants(rows, res):
    """Shape rules that hold for every row, whatever the routing says."""
    if not rows:
        res.add("ledger invariants", False, "no rows to check")
        return

    malformed = [r for r in rows if not parse_transaction_id(r.get("transactionId"))["wellFormed"]]
    res.add("transaction_id keeps its documented shape", not malformed,
            f"{len(rows)} row(s); malformed={len(malformed)}"
            + (f" e.g. {malformed[0].get('transactionId')}" if malformed else ""))

    keys = [(r.get("transactionId"), _up(r.get("channel")), r.get("recipientValue")) for r in rows]
    res.add("the ledger's unique key holds (transaction_id, channel, recipient_value)",
            len(keys) == len(set(keys)), f"rows={len(keys)} distinct={len(set(keys))}")

    bad_names = [r for r in rows
                 if _s(r.get("eventName")) and not _s(r.get("eventName")).startswith("COMPLAINTS.WORKFLOW.")]
    res.add("event_name is COMPLAINTS.WORKFLOW.<ACTION>", not bad_names,
            f"distinct={sorted({_s(r.get('eventName')) for r in rows})}")

    paths = {_up(r.get("sourcePath")) for r in rows if _s(r.get("sourcePath"))}
    if not paths:
        res.add("source_path is present on every row", False,
                "no row carries source_path -- this deployment predates the thin-event release, "
                "or the column is not being written")
    else:
        # Both at once means two producers are live and one transition can send twice.
        # The ledger cannot show it any other way: both paths mint the same transaction_id
        # and upsert the SAME row (design R1).
        res.add("source_path is consistent across the run", len(paths) == 1,
                f"paths={sorted(paths)}"
                + ("" if len(paths) == 1 else
                   " -- BOTH producers are live; one transition can send twice"))


def observed_thin_path(rows):
    paths = {_up(r.get("sourcePath")) for r in rows if _s(r.get("sourcePath"))}
    if paths == {"RESOLVED"}:
        return True
    if paths == {"PRERENDERED"}:
        return False
    return None


# ----------------------------- the weakened Kafka check ---------------------------------------

def count_thin_events(complaint_no, res):
    """Advisory: exactly ONE thin event per transition was published.

    Deliberately weaker than what it replaces, and deliberately never fatal: it measures
    the producer's INTENT, and `rpk` may not be reachable from wherever this runs. The
    ledger assertions above are the ones that decide the exit code.
    """
    seen = {}
    for topic in (THIN_TOPIC, KAFKA_TOPIC):
        rc, out, err = docker_exec(
            REDPANDA_CONTAINER,
            ["rpk", "topic", "consume", topic, "--offset", "start", "--num", "500"],
            timeout=CONSUME_SECS + 10,
        )
        if rc not in (0, 124):
            res.note(f"kafka tail {topic}", f"rpk rc={rc} {err.strip()[:120]} -- skipped")
            continue
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            val = rec.get("value", rec)
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except ValueError:
                    continue
            if not isinstance(val, dict):
                continue
            if _s(val.get("entityId")) != complaint_no:
                continue
            if _up(val.get("kind")) != "THIN":
                continue
            seen.setdefault(_s(val.get("eventName")), 0)
            seen[_s(val.get("eventName"))] += 1
    if not seen:
        res.note("one thin event per transition",
                 "no THIN events found on either topic -- either the producer still emits "
                 "pre-rendered envelopes, or rpk could not read the topic. Advisory only.")
        return
    extra = {k: v for k, v in seen.items() if v != 1}
    res.note("one thin event per transition",
             f"{seen}" + ("" if not extra else f" -- NOT exactly one for {sorted(extra)}"))


# ----------------------------- main -----------------------------------------------------------

def main():
    no_drive = "--no-drive" in sys.argv or "--seed-only" in sys.argv
    if "--seed-only" in sys.argv:
        print("NOTE: --seed-only is deprecated. Seeding moved to seed-notifications.py "
              "(./deploy.sh <tenant> --tags notifications); treating it as --no-drive.")

    section("CI: PGR notification routing, asserted through the delivery ledger")
    print(f"Kong:    {BASE_URL}")
    print(f"Tenant:  {TARGET_TENANT}  (masters at {STATE_TENANT})")
    print(f"Ledger:  GET {NB_PREFIX}/logs")

    res = Results()

    if requests is None:
        res.add("python requests available", False, "pip install requests")
        return summarize(res)

    # 1. login
    section("[1] Admin token via Kong")
    token, user_info = login()
    res.add("admin login", bool(token), f"tenant={ROOT_TENANT} user={USERNAME}")
    if not token:
        return summarize(res)

    # 2. which namespace serves this tenant
    section("[2] Config source (design 5.2: per tenant, all-or-nothing)")
    source, from_endpoint = resolve_config_source(token, user_info, res)

    # 3. the EXPECT matrix, from that namespace
    section("[3] EXPECT matrix from the serving namespace")
    routing_code = schema_code_for("Routing", source)
    routing_rows = search_master(token, user_info, routing_code, STATE_TENANT)
    res.add(f"read {routing_code}", routing_rows is not None and len(routing_rows) > 0,
            f"rows={len(routing_rows) if routing_rows is not None else 'n/a'}")
    if not routing_rows:
        return summarize(res)
    matrix, dropped = build_expect_matrix(routing_rows, source)
    tuples = sum(len(chs) for auds in matrix.values() for chs in auds.values())
    res.add("routing rows reduce to an expectation matrix", tuples > 0,
            f"{len(matrix)} transition(s), {tuples} (audience,channel) tuple(s)"
            + (f", {len(dropped)} row(s) dropped" if dropped else ""))
    for row, why in dropped:
        print(f"    (dropped) {why}: {json.dumps(row)[:140]}")

    policy, policy_code = build_channel_policy(token, user_info, res)
    approved_counts = approved_provider_templates(token, user_info, source, routing_rows)

    if no_drive:
        section("[4] (--no-drive) config read only; nothing driven, nothing asserted on the ledger")
        return summarize(res)

    # 4. drive APPLY -> ASSIGN -> RESOLVE -> RATE
    section("[4] Drive APPLY -> ASSIGN -> RESOLVE -> RATE via Kong")
    service_code = discover_service_code(token, user_info)
    res.add("discover serviceCode", bool(service_code), service_code or "none")
    if not service_code:
        return summarize(res)

    complaint_no, service = pgr_create(token, user_info, service_code)
    res.add("APPLY (create complaint)", bool(complaint_no), complaint_no or str(service)[:160])
    if not complaint_no:
        return summarize(res)

    assignee_uuid = (user_info or {}).get("uuid")
    s2 = pgr_update(token, user_info, service, "ASSIGN",
                    assignees=[assignee_uuid] if assignee_uuid else None)
    res.add("ASSIGN", bool(s2), "assigned")
    s3 = pgr_update(token, user_info, s2 or service, "RESOLVE")
    res.add("RESOLVE", bool(s3), "resolved")
    s4 = pgr_update(token, user_info, s3 or s2 or service, "RATE", rating=5)
    res.add("RATE", bool(s4), "rated")

    # 5. assert on the ledger
    section(f"[5] Assert through {NB_PREFIX}/logs")
    print(f"  settling {SETTLE_SECS}s for the ledger to catch up ...")
    time.sleep(SETTLE_SECS)
    rows, detail = fetch_logs(complaint_no)
    res.add("read the ledger for this complaint", rows is not None and len(rows) > 0, detail)
    if not rows:
        return summarize(res)

    thin_path = observed_thin_path(rows)
    print(f"  producer path: {'RESOLVED (thin)' if thin_path else 'PRERENDERED' if thin_path is False else 'not observed'}")

    # Roles of every recipient the ledger names, so a ROLE: audience is a real check.
    uuid_roles = fetch_roles(token, user_info,
                             [parse_transaction_id(r.get("transactionId"))["uuid"] for r in rows])
    res.add("resolve recipient roles for the audience cross-check", True,
            f"{len(uuid_roles)} recipient(s) resolved from egov-user")

    for action, to_state in DRIVE_SEQUENCE:
        assert_transition(rows, action, to_state, matrix, policy, approved_counts, thin_path,
                          uuid_roles, res)

    section("[6] Ledger invariants")
    assert_ledger_invariants(rows, res)

    section("[7] Kafka tail (advisory, deliberately weaker than the ledger)")
    count_thin_events(complaint_no, res)

    return summarize(res)


def summarize(res):
    section("SUMMARY")
    passed = sum(1 for _, ok, _ in res.rows if ok)
    failed = sum(1 for _, ok, _ in res.rows if not ok)
    for label, ok, detail in res.rows:
        tag = f"{GREEN}PASS{NC_}" if ok else f"{RED}FAIL{NC_}"
        print(f"  [{tag}] {label}" + (f" - {detail}" if detail else ""))
    print(f"\n  {passed} passed, {failed} failed")
    overall = res.ok() and passed > 0
    print(f"\n  OVERALL: {'PASS' if overall else 'FAIL'}")
    return 0 if overall else 1


if __name__ == "__main__":
    sys.exit(main())
