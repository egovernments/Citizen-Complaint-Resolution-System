#!/usr/bin/env python3
"""Migrate a state tenant's notification configuration from the 2.12 legacy masters
(RAINMAKER-PGR.Notification*) to the 2.20 NOTIFICATIONS.* masters — per tenant, one way,
after a reviewed plan.

WHY THIS IS NOT PART OF THE DEPLOY
----------------------------------
A deploy upgrades software (seed-notifications.py). Moving a tenant's configuration
changes what its citizens receive, so it is an operator decision taken per tenant, after
reading exactly what will change. novu-bridge serves a tenant from its legacy masters
(through LegacyMasterAdapter, the same conversion notifications_convert.py applies) until
the tenant's FIRST NOTIFICATIONS.Routing row exists — active or not, MDMS has no delete —
and from NOTIFICATIONS.* only after that. There is no switch back: the legacy rows are
never modified, but a NOTIFICATIONS.Routing row cannot be removed. Hence `plan` first.

WHAT IT DOES
------------
plan    read-only. Per state tenant: the category —
          none        no notification configuration in either namespace
          defaults    legacy rows equal to the shipped defaults (after conversion)
          customised  legacy rows that differ: rows only in the tenant, only in the
                      defaults, and every changed field (body, subject, active, ...)
          migrated    already served from NOTIFICATIONS.*
          partial     NOTIFICATIONS.* rows but no Routing, a copy that did not finish,
                      no event catalogue, or an interrupted default seed
        — then the rows `apply` would create (after conversion), the event catalogue from
        the tenant's LIVE workflow, the channel policy now and after, the provider pin per
        channel, and warnings (routing for events the live workflow cannot produce,
        templates missing the default locale, WhatsApp routes with no approved provider
        template, rows the conversion drops).
apply   copies THE TENANT'S OWN legacy rows through the converter — never the shipped
        defaults, unless --adopt-defaults (the only way a `none` tenant gets them here) —
        in the safe order (catalogue, templates, provider templates, channel, routing
        LAST; routing held back if any template write failed), pins providers, re-reads
        and verifies, and diffs a before/after preview from the bridge's
        POST /novu-bridge/novu-adapter/v1/dispatch/_resolve (one synthetic thin event per
        catalogued event and locale; nothing is sent, no ledger row is written). Any
        difference in who / channel / locale / text makes the tenant WARN.

Idempotent: a re-run skips rows already there (reported as present). Each tenant is
isolated: a failure is reported and the next tenant still runs. `apply` needs --yes;
with --all it also needs --only, and customised/partial tenants are applied only when
named with --tenant or listed in --only.

PROVIDERS
---------
Novu integrations are shared by the deployment; NOTIFICATIONS.Channel.provider pins one
per channel per tenant (it outranks the channel's `gateway` and the env). For each
enabled channel: exactly one active integration of that channel (Novu's in_app inbox
excluded) → pinned; several → reported, left unpinned unless --provider CH=<identifier>;
none → an operator action. SMS on the legacy DIRECT SMSCountry route (gateway=smscountry,
or NOVU_BRIDGE_SMS_PROVIDER=smscountry) is kept as it is unless you ask otherwise:
--create-smscountry-provider (or --create-provider <type>) creates a catalog provider
through POST /novu-bridge/novu-adapter/v1/providers from --credentials-file (JSON, mode
0600 or stricter; values are never printed or written to the report) and pins it.

Exit: 0 ok · 1 finished with warnings (preview differences, verification mismatch, a
required operator action) · 2 a tenant failed or could not be read · 3 a write was
refused with 403 (egov-accesscontrol cache / missing role-action) · 4 refused to start
(apply without --yes, --all without --only, bad credentials file, bad --provider).
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import notifications_convert as nc  # noqa: E402
import generate_event_catalogue as gec  # noqa: E402


def _load_seeder():
    spec = importlib.util.spec_from_file_location("seed_notifications",
                                                  os.path.join(HERE, "seed-notifications.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sn = _load_seeder()

CATEGORIES = ("none", "defaults", "customised", "migrated", "partial")
CHANNELS = sn.KNOWN_CHANNELS
LEGACY_CONTENT = sn.LEGACY_CONTENT
NEW_CONTENT = sn.NEW_CONTENT
LEGACY_ALL = LEGACY_CONTENT + (sn.LEGACY_CHANNEL,)
NEW_ALL = tuple(sn.NEW_CODES)
ROUTING, TEMPLATE, PTEMPLATE = "NOTIFICATIONS.Routing", "NOTIFICATIONS.Template", "NOTIFICATIONS.ProviderTemplate"
CATALOGUE, CHANNEL = sn.NEW_CATALOGUE, sn.NEW_CHANNEL
DEFAULT_EXCLUDE = r"(?i)^(PW_|pwt)"

BRIDGE = "/novu-bridge/novu-adapter/v1"
RESOLVE_PATH = BRIDGE + "/dispatch/_resolve"
EVENT_TYPE = "COMPLAINTS_WORKFLOW_TRANSITIONED"

# ── The provider catalog, mirrored from novu-bridge's ProviderCatalog.java ────
CATALOG_CHANNEL = {"twilio-sms": "SMS", "twilio-whatsapp": "WHATSAPP", "smtp": "EMAIL",
                   "smscountry": "SMS", "ozeki": "SMS"}
CATALOG_LABEL = {"twilio-sms": "Twilio SMS", "twilio-whatsapp": "Twilio WhatsApp",
                 "smtp": "Email (SMTP)", "smscountry": "SMSCountry", "ozeki": "Ozeki SMS Gateway"}
# Used only when the bridge's GET /providers/catalog cannot be read.
CATALOG_REQUIRED = {"twilio-sms": ["accountSid", "token", "from"],
                    "twilio-whatsapp": ["accountSid", "token", "from"],
                    "smtp": ["host", "port", "user", "password", "from", "senderName"],
                    "smscountry": ["user", "password", "senderId"],
                    "ozeki": ["baseUrl", "username", "password"]}
TYPES_LONGEST_FIRST = ("twilio-whatsapp", "smscountry", "twilio-sms", "ozeki", "smtp")

# Synthetic people for the preview. Carrying name/phone/email makes the bridge use them
# as-is (ActorRecipientResolver), so nothing is looked up and nobody real is addressed.
PREVIEW_ACTORS = {
    "citizen": {"userId": "00000000-0000-4000-8000-00000000c171", "type": "CITIZEN",
                "name": "Preview Citizen", "phone": "+10000000001",
                "email": "citizen@preview.invalid"},
    "assignee": {"userId": "00000000-0000-4000-8000-0000000a551e", "type": "EMPLOYEE",
                 "name": "Preview Assignee", "phone": "+10000000002",
                 "email": "assignee@preview.invalid"},
}
PREVIEW_DATA = {
    "id": "PREVIEW-0001", "date": "01/01/2026", "complaint_type": "Streetlight",
    "additional_comments": "Preview comment", "rating": "5", "citizen_name": "Preview Citizen",
    "download_link": "https://preview.invalid/c/1", "ulb": "Preview City",
    "ao_designation": "Assistant Officer", "emp_name": "Preview Assignee",
    "emp_department": "Preview Department", "emp_designation": "Preview Designation",
}
PREVIEW_NS = uuid.UUID("5d7c3a52-2f44-4a8e-9b1c-6f0e2a9d4b17")


class RefuseToStart(Exception):
    """A usage or safety check failed before anything was read or written (exit 4)."""


# ── small helpers ────────────────────────────────────────────────────────────

def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _norm(code, row):
    """A row as compared: None-valued keys dropped, placeholders order-insensitive
    (they document tokens; `variables` stays ordered — Twilio maps them by position)."""
    out = {k: v for k, v in (row or {}).items() if v is not None}
    if isinstance(out.get("placeholders"), list):
        out["placeholders"] = sorted(str(p) for p in out["placeholders"])
    if "active" in out:
        out["active"] = nc._truthy(out["active"])
    return out


def _key(code, row):
    return sn._unique_key(code, row)


def _show_key(key):
    return " · ".join(str(part) for part in key)


def _short(text, width=90):
    text = "" if text is None else str(text).replace("\n", "\\n")
    return text if len(text) <= width else text[:width - 1] + "…"


def _mask(subscriber):
    """tenant:uuid → tenant:1a2b3c4d… ; the preview's own synthetic people stay readable."""
    subscriber = str(subscriber or "")
    for name, actor in PREVIEW_ACTORS.items():
        if subscriber.endswith(actor["userId"]):
            return "%s(%s)" % (subscriber.split(":")[0] + ":", name)
    head, sep, tail = subscriber.partition(":")
    return head + sep + (tail[:8] + "…" if len(tail) > 8 else tail)


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def first_existing(paths):
    for path in paths:
        if path and os.path.exists(path):
            return path
    return None


# ── HTTP to the bridge (Bearer: ProxyAuthFilter introspects it itself) ────────

def bridge_call(ctx, method, path, body=None, timeout=60):
    """(status or None, parsed body or error text). Never raises for HTTP/network errors."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(ctx.bridge_url + path, data=data, method=method, headers={
        "Authorization": "Bearer " + ctx.tok, "Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        raw = resp.read().decode() or "{}"
        try:
            return resp.status, json.loads(raw)
        except ValueError:
            return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, raw[:300]
    except (urllib.error.URLError, OSError) as exc:
        return None, str(getattr(exc, "reason", exc))


def _error_code(payload):
    if isinstance(payload, dict):
        errors = payload.get("Errors") or payload.get("errors") or []
        if errors and isinstance(errors[0], dict):
            return errors[0].get("code") or errors[0].get("message")
        return payload.get("code") or payload.get("error")
    return None


def mdms_update(ctx, code, record, tenant):
    """Replace one existing record's data (used ONLY to set Channel.provider)."""
    body = sn.ri(ctx.tok)
    body["Mdms"] = dict(record)
    body["Mdms"]["tenantId"] = tenant
    body["Mdms"]["schemaCode"] = code
    try:
        sn._post("/mdms-v2/v2/_update/" + code, body, ctx.tok).read()
        return "updated"
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            if code not in sn.FORBIDDEN:
                sn.FORBIDDEN.append(code)
            return "forbidden"
        return "failed: HTTP %s %s" % (exc.code, exc.read().decode(errors="replace")[:160])
    except (urllib.error.URLError, OSError) as exc:
        return "failed: %s" % exc


# ── the deployment around the tenants ────────────────────────────────────────

def container_env(name):
    """{VAR: value} of a running container, or None (no docker, no container)."""
    if not name:
        return None
    try:
        out = subprocess.run(["docker", "inspect", "--format", "{{json .Config.Env}}", name],
                             capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    try:
        pairs = json.loads(out.stdout)
    except ValueError:
        return None
    return dict(p.split("=", 1) for p in pairs if "=" in p)


def bridge_settings(args):
    """The bridge env the channel policy falls back to, and where each value came from."""
    env = container_env(args.bridge_container)
    out = {}
    for key, flag, var, default in (
            ("allowlist", args.channels_allowlist, "NOVU_BRIDGE_CHANNELS_ENABLED", None),
            ("sms_provider", args.sms_provider, "NOVU_BRIDGE_SMS_PROVIDER", None),
            ("default_locale", args.default_locale, "NOVU_BRIDGE_DEFAULT_LOCALE", "en_IN")):
        alias = "NOTIF_CHANNELS_ALLOWLIST" if key == "allowlist" else var
        if flag is not None:
            out[key], out[key + "_source"] = flag, "--" + key.replace("_", "-")
        elif alias in os.environ:
            out[key], out[key + "_source"] = os.environ[alias], "env " + alias
        elif env is not None:
            out[key] = env.get(var, "" if default is None else default)
            out[key + "_source"] = "the running %s container" % args.bridge_container
        else:
            out[key], out[key + "_source"] = default, "unknown" if default is None else "default"
    out["allowlist_set"] = sn.parse_allowlist(out["allowlist"])
    out["sms_direct"] = (out["sms_provider"] or "").strip().lower() == "smscountry"
    return out


def derive_type(integration):
    """ProviderCatalog.deriveType: the identifier marker first, then the unambiguous
    providerId+channel pairs. Unmarked generic-sms stays None (SMSCountry and Ozeki look
    identical, and a guess would pick the wrong request body)."""
    ident = str(integration.get("identifier") or "").strip().lower()
    for kind in TYPES_LONGEST_FIRST:
        if ident == kind or ident.startswith(kind + "-"):
            return kind
    if ident.startswith("whatsapp-"):
        return "twilio-whatsapp"
    provider = str(integration.get("providerId") or "").lower()
    channel = str(integration.get("channel") or "").lower()
    if provider == "twilio" and channel == "sms":
        return "twilio-sms"
    if provider == "nodemailer" and channel == "email":
        return "smtp"
    return None


def integration_channel(integration):
    """SMS | EMAIL | WHATSAPP for an integration, or None (in_app, push, chat)."""
    kind = integration.get("type") or derive_type(integration)
    if kind in CATALOG_CHANNEL:
        return CATALOG_CHANNEL[kind]
    return {"sms": "SMS", "email": "EMAIL"}.get(str(integration.get("channel") or "").lower())


def identifier_for(kind, name):
    """ProviderCatalog.identifierFor: <type>-<sha256(name)[0:16]>."""
    return "%s-%s" % (kind, hashlib.sha256((name or kind).encode("utf-8")).hexdigest()[:16])


def read_integrations(ctx):
    status, payload = bridge_call(ctx, "GET", BRIDGE + "/integrations")
    if status != 200 or not isinstance(payload, dict):
        return None, "GET %s/integrations answered %s %s" % (
            BRIDGE, status if status is not None else "(unreachable)",
            _short(_error_code(payload) or payload, 120))
    rows = []
    for item in payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        item = dict(item)
        item["type"] = item.get("type") or derive_type(item)
        item["channelCode"] = integration_channel(item)
        rows.append(item)
    return rows, None


def catalog_required(ctx):
    status, payload = bridge_call(ctx, "GET", BRIDGE + "/providers/catalog")
    if status == 200 and isinstance(payload, dict):
        out = {}
        for kind in payload.get("data") or []:
            fields = kind.get("credentialFields") or []
            out[kind.get("type")] = [f.get("key") for f in fields if f.get("required")]
        if out:
            return out
    return dict(CATALOG_REQUIRED)


def read_credentials_file(path):
    """The credentials JSON — refused unless it is a regular file readable by its owner
    only (mode 0600 or stricter). Never echoed."""
    if not path:
        raise RefuseToStart("creating a provider needs --credentials-file <json>")
    try:
        info = os.stat(path)
    except OSError as exc:
        raise RefuseToStart("credentials file %s: %s" % (path, exc.strerror))
    if not stat.S_ISREG(info.st_mode):
        raise RefuseToStart("credentials file %s is not a regular file" % path)
    if info.st_mode & 0o077:
        raise RefuseToStart("credentials file %s has mode %04o: it must be readable by its owner "
                            "only (chmod 600 %s)" % (path, stat.S_IMODE(info.st_mode), path))
    try:
        data = load_json(path)
    except (OSError, ValueError) as exc:
        raise RefuseToStart("credentials file %s is not valid JSON (%s)" % (path, type(exc).__name__))
    if not isinstance(data, dict):
        raise RefuseToStart("credentials file %s must hold a JSON object keyed by provider type" % path)
    return data


def plan_provider_creation(ctx, args):
    """[{type, channel, name, identifier, keys, state: create|exists}] for --create-*.
    Validates everything it can before any write; raises RefuseToStart otherwise."""
    kinds = list(dict.fromkeys((args.create_provider or []) +
                               (["smscountry"] if args.create_smscountry_provider else [])))
    if not kinds:
        return []
    for kind in kinds:
        if kind not in CATALOG_CHANNEL:
            raise RefuseToStart("--create-provider %s: not a catalog type (%s)"
                                % (kind, ", ".join(sorted(CATALOG_CHANNEL))))
    channels = [CATALOG_CHANNEL[k] for k in kinds]
    for ch in set(channels):
        if channels.count(ch) > 1:
            raise RefuseToStart("two providers to create for %s — create one per channel" % ch)
    if ctx.integrations is None:
        raise RefuseToStart("cannot create providers: the bridge's integration list is "
                            "unavailable (%s)" % ctx.integrations_error)
    creds = read_credentials_file(args.credentials_file)
    required = catalog_required(ctx)
    plans = []
    for kind in kinds:
        entry = creds.get(kind)
        if not isinstance(entry, dict):
            raise RefuseToStart("credentials file has no object for provider type %r" % kind)
        values = entry.get("credentials") if isinstance(entry.get("credentials"), dict) else \
            {k: v for k, v in entry.items() if k not in ("name", "identifier")}
        missing = [k for k in required.get(kind, CATALOG_REQUIRED.get(kind, []))
                   if not str(values.get(k) or "").strip()]
        if missing:
            raise RefuseToStart("credentials for %s lack required key(s): %s" % (kind, ", ".join(missing)))
        name = str(entry.get("name") or CATALOG_LABEL[kind])
        ident = str(entry.get("identifier") or identifier_for(kind, name))
        existing = [i for i in ctx.integrations if i.get("identifier") == ident]
        plans.append({"type": kind, "channel": CATALOG_CHANNEL[kind], "name": name,
                      "identifier": ident, "keys": sorted(values),
                      "state": "exists" if existing else "create",
                      "active": bool(existing and existing[0].get("active")) if existing else True,
                      "_credentials": values})
    return plans


def create_providers(ctx, plans):
    """POST each planned provider. Returns [plan with state created|exists|failed]."""
    for plan in plans:
        if plan["state"] != "create":
            continue
        body = {"type": plan["type"], "name": plan["name"], "identifier": plan["identifier"],
                "credentials": plan["_credentials"], "active": True}
        status, payload = bridge_call(ctx, "POST", BRIDGE + "/providers", body)
        if status in (200, 201) and isinstance(payload, dict):
            data = payload.get("data") or {}
            plan["identifier"] = data.get("identifier") or plan["identifier"]
            plan["state"] = "created"
            ctx.integrations.append({"identifier": plan["identifier"], "type": plan["type"],
                                     "channelCode": plan["channel"], "active": True,
                                     "name": plan["name"], "providerId": data.get("providerId")})
        else:
            plan["state"] = "failed"
            plan["error"] = "HTTP %s %s" % (status, _short(_error_code(payload) or payload, 160))
    return plans


# ── tenants ──────────────────────────────────────────────────────────────────

def compose_state_root(digit_dir):
    path = os.path.join(digit_dir, "docker-compose.egov-digit.yaml")
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                m = re.match(r"\s+STATE_LEVEL_TENANT_ID:\s*['\"]?([A-Za-z0-9_-]+)", line)
                if m:
                    return m.group(1)
    except OSError:
        pass
    return None


def resolve_roots(args):
    if args.roots:
        return [r.strip() for r in args.roots.split(",") if r.strip()], "--roots"
    for var in ("NOTIF_ROOTS", "STATE_ROOT"):
        if os.environ.get(var):
            return [r.strip() for r in os.environ[var].split(",") if r.strip()], "env " + var
    # The deploy rewrites this to state_root (playbook "post-bootstrap — set
    # NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT"), and the running container is what it ran with.
    env = container_env(args.bridge_container) or {}
    core = str(env.get("NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT") or "").strip().split(".")[0]
    if core:
        return [core], "NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT of the running %s container" % args.bridge_container
    root = compose_state_root(args.digit_dir)
    if root:
        return [root], "STATE_LEVEL_TENANT_ID in %s/docker-compose.egov-digit.yaml" % args.digit_dir
    raise RefuseToStart("--all needs the state root(s): pass --roots a,b (or STATE_ROOT); "
                        "neither the %s container nor %s/docker-compose.egov-digit.yaml says "
                        "what it is" % (args.bridge_container or "novu-bridge", args.digit_dir))


def discover(ctx, args):
    """(tenants, excluded, errors). State codes only (no '.'), --exclude applied."""
    excluded, errors, seen = [], [], []
    if args.tenant:
        for raw in args.tenant:
            code = raw.strip().split(".")[0]
            if code != raw.strip():
                errors.append("--tenant %s is a city; its configuration lives at the state "
                              "tenant %s, which is used instead" % (raw, code))
            if code and code not in seen:
                seen.append(code)
        return seen, excluded, errors
    patterns = [re.compile(p) for p in (args.exclude if args.exclude is not None else [DEFAULT_EXCLUDE])]
    for root in ctx.roots:
        records = sn.search_rows(ctx.tok, "tenant.tenants", root)
        if records is None:
            errors.append("tenant.tenants at %s could not be read" % root)
            codes = [root]
        else:
            codes = [root] + [str((r.get("data") or {}).get("code") or "") for r in records]
        for code in codes:
            if not code or "." in code or code in seen or code in excluded:
                continue
            if any(p.search(code) for p in patterns):
                excluded.append(code)
                continue
            seen.append(code)
    return seen, excluded, errors


def city_for_preview(ctx, tenant):
    """A city under the state tenant, so ROLE: pools resolve the way a real event would."""
    records = sn.search_rows(ctx.tok, "tenant.tenants", tenant) or []
    for rec in records:
        code = str((rec.get("data") or {}).get("code") or "")
        if code.startswith(tenant + "."):
            return code
    return tenant


def read_tenant(ctx, tenant):
    records = {}
    for code in LEGACY_ALL + NEW_ALL:
        rows = sn.search_rows(ctx.tok, code, tenant)
        if rows is None:
            raise RuntimeError("could not read %s at %s" % (code, tenant))
        records[code] = rows
    missing_schemas = [code for code in NEW_ALL if sn.find_schema(ctx.tok, code, tenant) is None]
    return records, missing_schemas


# ── the analysis (pure: from what was read to what apply would do) ───────────

def rows_by_key(code, pairs):
    """{key: (row, active)} keeping the FIRST row per key (what MDMS would keep)."""
    out = {}
    for row, active in pairs:
        out.setdefault(_key(code, row), (row, active))
    return out


def diff_against_defaults(tenant_rows, default_rows):
    """How a tenant's converted rows differ from the shipped defaults."""
    out = {"onlyInTenant": [], "onlyInDefaults": [], "changed": []}
    for code in NEW_CONTENT:
        mine = rows_by_key(code, tenant_rows.get(code, []))
        ship = rows_by_key(code, default_rows.get(code, []))
        for key in mine:
            if key not in ship:
                out["onlyInTenant"].append({"master": code, "key": list(key), "row": mine[key][0]})
        for key in ship:
            if key not in mine:
                out["onlyInDefaults"].append({"master": code, "key": list(key), "row": ship[key][0]})
        for key in mine:
            if key in ship:
                a, b = _norm(code, ship[key][0]), _norm(code, mine[key][0])
                if a != b:
                    fields = {f: {"default": a.get(f), "tenant": b.get(f)}
                              for f in sorted(set(a) | set(b)) if a.get(f) != b.get(f)}
                    out["changed"].append({"master": code, "key": list(key), "fields": fields})
    return out


def channel_policy_view(records_new, records_legacy, settings):
    """What decides each channel, as ChannelPolicyClient reads it."""
    gov_new, gov_legacy = sn._governing(records_new), sn._governing(records_legacy)
    governing = gov_new or gov_legacy
    if governing:
        source = CHANNEL if gov_new else sn.LEGACY_CHANNEL
        channels = {}
        for ch in CHANNELS:
            row = governing.get(ch)
            channels[ch] = {"enabled": bool(row and row.get("enabled")),
                            "gateway": (row or {}).get("gateway"),
                            "provider": (row or {}).get("provider"), "row": bool(row)}
        return {"source": source, "channels": channels}
    allow = settings["allowlist_set"]
    channels = {ch: {"enabled": None if allow is None else ch in allow, "gateway": None,
                     "provider": None, "row": False} for ch in CHANNELS}
    return {"source": "env NOVU_BRIDGE_CHANNELS_ENABLED=%s (%s)" % (
        "(unknown)" if allow is None else (settings["allowlist"] or '""'),
        settings["allowlist_source"]), "channels": channels}


def transport(ch, info, settings):
    gw = str(info.get("gateway") or "").strip().lower()
    if info.get("provider"):
        return "novu integration %s" % info["provider"]
    if ch == "SMS" and (gw == "smscountry" or (not gw and settings["sms_direct"])):
        return "direct SMSCountry (legacy route)"
    return "novu (Novu's active/primary %s integration)" % ch.lower()


def config_warnings(effective, catalogue_names, default_locale):
    """Warnings about the configuration the tenant will be SERVED after apply."""
    warn = []
    routing = [(r, a) for r, a in effective.get(ROUTING, []) if a]
    templates = [(r, a) for r, a in effective.get(TEMPLATE, []) if a]
    ptemplates = [(r, a) for r, a in effective.get(PTEMPLATE, []) if a]
    if catalogue_names:
        stray = sorted({r["eventName"] for r, _ in routing if r["eventName"] not in catalogue_names})
        for name in stray:
            warn.append("routing for %s, which the tenant's live workflow cannot produce: after "
                        "migration the catalogue rejects it (NB_EVENT_NOT_IN_CATALOGUE); today it "
                        "never fires either" % name)
    for row, _ in routing:
        triple = (row["eventName"], row["audience"], row["channel"])
        locales = sorted({t["locale"] for t, _ in templates
                          if (t["eventName"], t["audience"], t["channel"]) == triple})
        if not locales:
            warn.append("%s → %s on %s is routed but has no active template: SKIPPED NB_NO_TEMPLATE"
                        % triple)
        elif default_locale not in locales:
            warn.append("%s → %s on %s has templates only in %s, none in the default locale %s: a "
                        "recipient in any other locale gets nothing (NB_NO_TEMPLATE)"
                        % (triple + (", ".join(locales), default_locale)))
        if row["channel"] == "WHATSAPP":
            usable = [p for p, _ in ptemplates
                      if str(p.get("provider", "")).lower() == "twilio"
                      and (p["eventName"], p["audience"]) == triple[:2]
                      and str(p.get("approvalStatus") or "").strip().lower() == "approved"
                      and str(p.get("templateId") or "").strip()]
            if not usable:
                warn.append("WHATSAPP %s → %s has no approved provider template: every such "
                            "message is SKIPPED NB_TEMPLATE_NOT_APPROVED" % triple[:2])
    return warn


def analyse(ctx, tenant, records, missing_schemas, catalogue, catalogue_origin):
    """Everything plan prints and apply does for one tenant. No I/O."""
    t = {"tenant": tenant, "warnings": [], "operatorActions": [], "notes": [],
         "missingSchemas": missing_schemas}
    t["counts"] = {"legacy": {c: len(records[c]) for c in LEGACY_ALL},
                   "new": {c: len(records[c]) for c in NEW_ALL}}
    legacy_n = sum(len(records[c]) for c in LEGACY_CONTENT)
    present = {c: rows_by_key(c, sn._record_rows(records[c])) for c in NEW_ALL}

    converted, dropped = nc.convert_records({c: records[c] for c in LEGACY_CONTENT})
    own = {c: [(row, row["active"]) for row in converted.get(c, [])] for c in NEW_CONTENT}
    for code, lost in dropped.items():
        for data, reason in lost:
            t["warnings"].append("a legacy %s row is not copied (%s) — novu-bridge drops it today "
                                 "too: %s" % (code.split(".")[-1], reason, _short(json.dumps(data), 120)))
    for code in NEW_CONTENT:
        seen = {}
        for row, _ in own[code]:
            key = _key(code, row)
            if key in seen:
                t["warnings"].append("two legacy %s rows convert to the same NOTIFICATIONS key %s: "
                                     "only the first is copied" % (code.split(".")[-1], _show_key(key)))
            seen[key] = True

    defaults = ctx.defaults
    t["defaultsDiff"] = diff_against_defaults(own, defaults) if legacy_n else None

    # ── category ──
    reasons = []
    new_rows = {c: len(records[c]) for c in NEW_ALL}
    if new_rows[ROUTING]:
        lacking = [(c, k) for c in NEW_CONTENT for k in rows_by_key(c, own[c]) if k not in present[c]]
        default_keys = {c: rows_by_key(c, defaults.get(c, [])) for c in NEW_CONTENT}
        all_default = all(k in default_keys[c] and
                          _norm(c, present[c][k][0]) == _norm(c, default_keys[c][k][0])
                          and present[c][k][1] == default_keys[c][k][1]
                          for c in NEW_CONTENT for k in present[c])
        short = sum(1 for c in NEW_CONTENT for k in default_keys[c] if k not in present[c])
        if lacking:
            category = "partial"
            reasons.append("NOTIFICATIONS.Routing exists (served from NOTIFICATIONS.*), but %d of "
                           "the tenant's own legacy rows are not in NOTIFICATIONS.*: an earlier copy "
                           "that did not finish" % len(lacking))
        elif not legacy_n and all_default and short:
            category = "partial"
            reasons.append("every NOTIFICATIONS row is an unedited shipped default, but %d shipped "
                           "default rows are missing: an interrupted default seed (or defaults "
                           "from an older release); --adopt-defaults adds them" % short)
        elif not new_rows[CATALOGUE]:
            category = "partial"
            reasons.append("served from NOTIFICATIONS.* but it has no NOTIFICATIONS.EventCatalogue rows")
        else:
            category = "migrated"
            reasons.append("NOTIFICATIONS.Routing has %d rows: novu-bridge serves NOTIFICATIONS.*"
                           % new_rows[ROUTING] + (" (all %d of its legacy rows are there too)"
                                                 % sum(len(own[c]) for c in NEW_CONTENT) if legacy_n else ""))
    elif any(new_rows[c] for c in NEW_ALL):
        category = "partial"
        reasons.append("NOTIFICATIONS.* has rows (%s) but no Routing: novu-bridge still serves %s"
                       % (", ".join("%s %d" % (c.split(".")[-1], n) for c, n in new_rows.items() if n),
                          "the legacy masters" if legacy_n else "nothing"))
    elif not legacy_n:
        category = "none"
        reasons.append("no notification configuration in either namespace")
    else:
        d = t["defaultsDiff"]
        if d["onlyInTenant"] or d["onlyInDefaults"] or d["changed"]:
            category = "customised"
            reasons.append("legacy rows differ from the shipped defaults: %d only in the tenant, "
                           "%d only in the defaults, %d changed" % (
                               len(d["onlyInTenant"]), len(d["onlyInDefaults"]), len(d["changed"])))
        else:
            category = "defaults"
            reasons.append("legacy rows equal the shipped defaults (after conversion)")
    t["category"], t["reasons"] = category, reasons

    # ── what apply writes: content ──
    source = {c: list(own[c]) for c in NEW_CONTENT}
    if ctx.args.adopt_defaults:
        for c in NEW_CONTENT:
            have = set(rows_by_key(c, own[c])) | set(present[c])
            source[c] += [(row, active) for row, active in defaults.get(c, [])
                          if _key(c, row) not in have]
    planned, present_same, present_diff = {}, 0, []
    for c in NEW_CONTENT:
        planned[c] = []
        for key, (row, active) in rows_by_key(c, source[c]).items():
            if key in present[c]:
                live_row, live_active = present[c][key]
                if _norm(c, dict(live_row, active=live_active)) == _norm(c, dict(row, active=active)):
                    present_same += 1
                else:
                    present_diff.append({"master": c, "key": list(key)})
                continue
            planned[c].append((row, active))
    t["presentSame"], t["presentDifferent"] = present_same, present_diff
    if present_diff:
        t["notes"].append("%d of the tenant's rows are already in NOTIFICATIONS.* with different "
                          "content (edited since an earlier copy): left as they are" % len(present_diff))

    # ── the event catalogue ──
    t["catalogue"] = {"origin": catalogue_origin, "rows": len(catalogue or [])}
    if catalogue is None:
        t["warnings"].append("no event catalogue could be built (%s): apply writes none" % catalogue_origin)
        catalogue = []
    elif "FALLBACK" in catalogue_origin:
        t["warnings"].append("event catalogue from %s — check it lists every transition this "
                             "tenant's workflow has" % catalogue_origin)
    have_cat = present[CATALOGUE]
    live_names = {r["eventName"] for r in catalogue}
    planned[CATALOGUE] = [(r, nc.is_active(r)) for r in catalogue if (r["eventName"],) not in have_cat]
    t["catalogue"]["toAdd"] = [r["eventName"] for r, _ in planned[CATALOGUE]]
    t["catalogue"]["first"] = bool(planned[CATALOGUE]) and not have_cat
    t["catalogue"]["notInLiveWorkflow"] = sorted(k[0] for k in have_cat if k[0] not in live_names)
    catalogue_names = live_names | {k[0] for k in have_cat}

    # ── channel rows and provider pins ──
    settings = ctx.settings
    current = channel_policy_view(records[CHANNEL], records[sn.LEGACY_CHANNEL], settings)
    if records[CHANNEL]:
        channel_rows, channel_origin = [], "NOTIFICATIONS.Channel rows exist: kept as they are"
    elif records[sn.LEGACY_CHANNEL]:
        conv, _ = nc.convert_records({sn.LEGACY_CHANNEL: records[sn.LEGACY_CHANNEL]})
        channel_rows = [(row, row["active"]) for row in conv.get(CHANNEL, [])]
        channel_origin = "copied from RAINMAKER-PGR.NotificationChannel (%d rows)" % len(channel_rows)
    elif settings["allowlist_set"] is not None:
        decision = sn.decide_channel_rows(ctx.channel_defaults, [], [], settings["allowlist_set"])
        channel_rows = [(row, True) for row in decision["create"]]
        channel_origin = "from NOVU_BRIDGE_CHANNELS_ENABLED=%s (%s): the tenant has no channel rows" % (
            settings["allowlist"] or '""', settings["allowlist_source"])
    else:
        channel_rows = []
        channel_origin = ("none: the tenant has no channel rows and NOVU_BRIDGE_CHANNELS_ENABLED "
                          "is unknown (pass --channels-allowlist), so it stays on the env")
    planned[CHANNEL] = [(dict(row), active) for row, active in channel_rows]
    if planned[CHANNEL]:
        after = channel_policy_view([{"isActive": a, "data": r} for r, a in planned[CHANNEL]],
                                    records[sn.LEGACY_CHANNEL], settings)
    else:
        after = current
    t["channels"] = {"now": current, "after": after, "rowsOrigin": channel_origin}

    if category == "none" and not ctx.args.adopt_defaults:
        # Nothing of the tenant's to migrate: apply skips it, so plan nothing (not even
        # the catalogue or channel rows, which would only half-configure it).
        planned = {c: [] for c in sn.COPY_ORDER}
        t["catalogue"]["toAdd"] = []
        t["notes"].append("apply skips this tenant: it has no notification configuration. "
                          "--adopt-defaults would seed the shipped defaults (review them in "
                          "utilities/default-data-handler/.../mdmsData-dev/NOTIFICATIONS/)")

    pins, updates = plan_pins(ctx, t, records, planned, after, settings)
    t["providers"], t["_updates"] = pins, updates

    # ── warnings about what will be served ──
    effective = {}
    for c in NEW_CONTENT:
        rows = dict(present[c])
        for row, active in planned[c]:
            rows.setdefault(_key(c, row), (row, active))
        effective[c] = list(rows.values())
    if category not in ("none",) or ctx.args.adopt_defaults:
        t["warnings"] += config_warnings(effective, catalogue_names, settings["default_locale"] or "en_IN")
    if missing_schemas and any(planned[c] for c in sn.COPY_ORDER):
        t["warnings"].append("NOTIFICATIONS schema(s) absent here (%s): apply creates them, but if this "
                             "tenant never had the deploy's notification seed its access-control "
                             "rows are missing too and every write is refused (403) — run "
                             "`NOTIF_TENANT=%s NOTIF_SEED_PHASE=access seed-notifications.py` and "
                             "restart egov-accesscontrol first" % (", ".join(s.split(".")[-1] for s in missing_schemas), tenant))

    if t["catalogue"].get("first") and any(planned[c] for c in sn.COPY_ORDER):
        t["notes"].append(
            "apply writes this tenant's FIRST event catalogue (%d rows, one MDMS call each). "
            "novu-bridge rejects an event missing from a non-empty catalogue whichever namespace "
            "serves the tenant, and caches a read for %d s: an event published while the rows "
            "are landing may be REJECTED (NB_EVENT_NOT_IN_CATALOGUE). Apply in a quiet period; "
            "apply prints the window" % (len(planned[CATALOGUE]), sn.BRIDGE_CACHE_SECONDS))
    t["_planned"] = planned
    t["planned"] = {c: [row for row, _ in planned[c]] for c in sn.COPY_ORDER}
    t["plannedCounts"] = {c: len(planned[c]) for c in sn.COPY_ORDER}
    t["_catalogue_rows"] = [dict(r) for r, a in effective_catalogue(present, planned) if a]
    t["_template_locales"] = sorted({row["locale"] for row, a in effective.get(TEMPLATE, []) if a})
    t["_legacy_served"] = not new_rows[ROUTING] and legacy_n > 0
    return t


def effective_catalogue(present, planned):
    rows = dict(present[CATALOGUE])
    for row, active in planned[CATALOGUE]:
        rows.setdefault((row["eventName"],), (row, active))
    return sorted(rows.values(), key=lambda item: item[0]["eventName"])


def plan_pins(ctx, t, records, planned, after, settings):
    """{channel: decision} and the existing NOTIFICATIONS.Channel records to update.
    Pins land in the rows being created when there are any, else on existing rows."""
    decisions, updates = {}, []
    integrations = ctx.integrations
    created = {p["channel"]: p for p in ctx.provider_plans if p["state"] in ("create", "created", "exists")}
    new_by_code = {}
    for rec in records[CHANNEL]:
        data = rec.get("data") or {}
        if sn._channel_code(data) and rec.get("isActive") is not False and data.get("active") is not False:
            new_by_code.setdefault(sn._channel_code(data), rec)
    planned_by_code = {sn._channel_code(row): row for row, active in planned[CHANNEL] if active}
    for ch in CHANNELS:
        info = after["channels"][ch]
        d = {"channel": ch, "enabled": info["enabled"]}
        decisions[ch] = d
        if not info["enabled"]:
            d["decision"] = "off" if info["enabled"] is False else "unknown"
            d["detail"] = "channel off: no provider needed" if info["enabled"] is False else \
                "enabled state unknown (NOVU_BRIDGE_CHANNELS_ENABLED unknown)"
            continue
        row = planned_by_code.get(ch) or (new_by_code.get(ch) or {}).get("data")
        candidates = [i for i in (integrations or []) if i.get("channelCode") == ch and i.get("active")]
        d["candidates"] = [i.get("identifier") for i in candidates]
        if row is None:
            d["decision"] = "env" if after["source"].startswith("env") else "no-row"
            d["detail"] = ("on through NOVU_BRIDGE_CHANNELS_ENABLED with no channel row, so no pin "
                           "can be stored; Novu's active/primary integration sends it"
                           if d["decision"] == "env" else
                           "no active NOTIFICATIONS.Channel row to hold a pin (%s decides)" % after["source"])
            continue
        if row.get("provider"):
            pinned = row["provider"]
            match = [i for i in (integrations or []) if i.get("identifier") == pinned]
            d.update(decision="pinned", identifier=pinned)
            if integrations is None:
                d["detail"] = "pinned to %s (integration list unavailable, not checked)" % pinned
            elif not match:
                d["detail"] = "pinned to %s, which is NOT a Novu integration" % pinned
                t["operatorActions"].append("%s is pinned to %s, which does not exist: every %s is "
                                            "SKIPPED NB_PROVIDER_UNAVAILABLE — pick a provider in "
                                            "Configurator → Notifications → Channels" % (ch, pinned, ch))
            elif not match[0].get("active") or match[0].get("channelCode") != ch:
                d["detail"] = "pinned to %s, which is %s" % (
                    pinned, "inactive" if not match[0].get("active") else "not a %s integration" % ch)
                t["operatorActions"].append("%s is pinned to %s (%s): fix it in Configurator → "
                                            "Notifications → Channels" % (ch, pinned, d["detail"]))
            else:
                d["detail"] = "pinned to %s (active)" % pinned
            continue
        explicit = ctx.explicit_pins.get(ch)
        chosen, why = None, None
        # A pinned provider outranks `gateway` (DeliveryProviderRegistry.select), so pinning
        # SMS on a tenant that sends straight to SMSCountry MOVES it to that Novu integration.
        # Only an explicit request may do that; the auto-pin below never does.
        gw = str(row.get("gateway") or "").strip().lower()
        direct = ch == "SMS" and (gw == "smscountry" or (not gw and settings["sms_direct"]))
        if explicit:
            chosen, why = explicit, "--provider %s=%s" % (ch, explicit)
        elif ch in created:
            chosen, why = created[ch]["identifier"], "the %s provider this run %s" % (
                created[ch]["type"], "creates" if created[ch]["state"] == "create" else "found")
        if chosen and direct:
            why += "; REPLACES the direct SMSCountry route (%s), as explicitly requested" % (
                "gateway=smscountry" if gw else "NOVU_BRIDGE_SMS_PROVIDER=smscountry")
        if not chosen:
            if direct:
                d.update(decision="direct-smscountry",
                         detail="SMS goes straight to SMSCountry (%s) — kept as it is: a pin would "
                                "outrank that route and move SMS onto a Novu integration. To move it "
                                "on purpose: --create-smscountry-provider --credentials-file <0600 "
                                "json>, or --provider SMS=<identifier>" % (
                                    "gateway=smscountry" if gw else "NOVU_BRIDGE_SMS_PROVIDER=smscountry"))
                continue
            if integrations is None:
                d.update(decision="unknown", detail="integration list unavailable (%s): no pin"
                         % ctx.integrations_error)
                continue
            if len(candidates) == 1:
                chosen, why = candidates[0]["identifier"], "the only active %s integration" % ch
            elif len(candidates) > 1:
                primary = [i["identifier"] for i in candidates if i.get("primary")]
                d.update(decision="ambiguous",
                         detail="%d active %s integrations (%s): left unpinned — Novu keeps using "
                                "its primary%s; choose with --provider %s=<identifier>" % (
                                    len(candidates), ch, ", ".join(d["candidates"]),
                                    " (%s)" % primary[0] if primary else "", ch))
                continue
            else:
                d.update(decision="none", detail="no active %s integration" % ch)
                t["operatorActions"].append("%s is on but no active %s integration exists: nothing "
                                            "can deliver it — add one (Configurator → Notifications → "
                                            "Providers, or --create-provider <type> "
                                            "--credentials-file <0600 json>)" % (ch, ch))
                continue
        d.update(decision="pin", identifier=chosen, detail="pin %s (%s)" % (chosen, why))
        if ch in planned_by_code:
            planned_by_code[ch]["provider"] = chosen
            d["where"] = "in the NOTIFICATIONS.Channel row this apply creates"
        else:
            rec = new_by_code[ch]
            updates.append((ch, rec, chosen))
            d["where"] = "update of the existing NOTIFICATIONS.Channel row"
    return decisions, updates


# ── preview through the bridge ───────────────────────────────────────────────

def synthetic_event(event_tenant, cat, locale):
    names = [a.get("name") for a in cat.get("actors") or [] if isinstance(a, dict)] or ["citizen"]
    actors = {}
    for name in names:
        if name in PREVIEW_ACTORS:
            actors[name] = dict(PREVIEW_ACTORS[name], locale=locale)
    status = cat["eventName"].rsplit(".", 1)[-1]
    seed = "%s|%s|%s" % (event_tenant, cat["eventName"], locale)
    return {"kind": "THIN", "schemaVersion": "1", "eventId": str(uuid.uuid5(PREVIEW_NS, seed)),
            "eventType": EVENT_TYPE, "eventTime": "2026-01-01T00:00:00Z",
            "producer": "migrate-notifications-preview", "module": cat.get("module") or "Complaints",
            "eventName": cat["eventName"], "entityType": cat.get("entityType") or "COMPLAINT",
            "entityId": PREVIEW_DATA["id"], "tenantId": event_tenant,
            "transactionSeed": "migrate-preview:" + seed, "actors": actors,
            "data": dict(PREVIEW_DATA, status=status)}


def preview(ctx, event_tenant, catalogue_rows, locales):
    """{"event|locale": {terminal, envelopes: {channel|subscriber|locale: {...}}, diagnostics}}
    or (None, why) when the bridge cannot answer."""
    out = {}
    for cat in catalogue_rows:
        for locale in locales:
            body = {"RequestInfo": {"apiId": "migrate-notifications", "authToken": ctx.tok},
                    "event": synthetic_event(event_tenant, cat, locale)}
            status, payload = bridge_call(ctx, "POST", RESOLVE_PATH, body, timeout=90)
            key = "%s|%s" % (cat["eventName"], locale)
            if status is None or status in (401, 403, 404, 405, 502, 503):
                return None, "POST %s answered %s %s" % (
                    RESOLVE_PATH, status if status is not None else "(unreachable)",
                    _short(_error_code(payload) or payload, 120))
            if status != 200 or not isinstance(payload, dict):
                out[key] = {"terminal": _error_code(payload) or "HTTP %s" % status,
                            "envelopes": {}, "diagnostics": []}
                continue
            envelopes = {}
            for env in payload.get("envelopes") or []:
                contact = env.get("contact") or {}
                ekey = "%s|%s|%s" % (env.get("channel"), env.get("subscriberId"), contact.get("locale"))
                envelopes[ekey] = {"body": env.get("renderedBody"), "subject": env.get("subject"),
                                   "templateKey": env.get("templateKey"),
                                   "templateId": env.get("templateId"),
                                   "contentVariables": env.get("contentVariables")}
            out[key] = {"terminal": payload.get("terminalCode"), "envelopes": envelopes,
                        "diagnostics": sorted(payload.get("diagnostics") or [])}
    return out, None


def diff_previews(before, after):
    """[human-readable difference] between two preview() results."""
    lines = []
    for key in sorted(set(before) | set(after)):
        event, locale = key.split("|", 1)
        b, a = before.get(key), after.get(key)
        where = "%s [%s]" % (event, locale)
        if b is None or a is None:
            lines.append("%s: only %s" % (where, "after" if b is None else "before"))
            continue
        if b["terminal"] != a["terminal"]:
            lines.append("%s: outcome %s → %s%s" % (
                where, b["terminal"] or "sent", a["terminal"] or "sent",
                " (it was being rejected by an incomplete event catalogue)"
                if b["terminal"] == "NB_EVENT_NOT_IN_CATALOGUE" and not a["terminal"] else ""))
        for ekey in sorted(set(b["envelopes"]) | set(a["envelopes"])):
            channel, subscriber, loc = ekey.split("|", 2)
            who = "%s to %s in %s" % (channel, _mask(subscriber), loc)
            eb, ea = b["envelopes"].get(ekey), a["envelopes"].get(ekey)
            if eb is None:
                lines.append("%s: NEW message %s" % (where, who))
            elif ea is None:
                lines.append("%s: message %s NO LONGER SENT" % (where, who))
            else:
                for field in ("body", "subject", "templateKey", "templateId", "contentVariables"):
                    if eb.get(field) != ea.get(field):
                        lines.append("%s: %s %s differs: before %r / after %r" % (
                            where, who, field, _short(eb.get(field), 70), _short(ea.get(field), 70)))
        if b["diagnostics"] != a["diagnostics"]:
            lines.append("%s: resolver decisions differ: before %s / after %s" % (
                where, _short("; ".join(b["diagnostics"]), 120), _short("; ".join(a["diagnostics"]), 120)))
    return lines


def wait_for_switch(ctx, tenant, seconds=75):
    """True once /config/source says Routing is served from NOTIFICATIONS.*; None if the
    bridge cannot say."""
    deadline = time.time() + seconds
    while True:
        status, payload = bridge_call(ctx, "GET", BRIDGE + "/config/source?tenantId=" + tenant)
        if status != 200 or not isinstance(payload, dict):
            return None
        routing = ((payload.get("masters") or {}).get("Routing") or {})
        if routing and routing.get("legacy") is False and routing.get("rows", 0) > 0:
            return True
        if time.time() >= deadline:
            return False
        time.sleep(5)


def bridge_source(ctx, tenant):
    status, payload = bridge_call(ctx, "GET", BRIDGE + "/config/source?tenantId=" + tenant)
    if status != 200 or not isinstance(payload, dict):
        return None
    routing = (payload.get("masters") or {}).get("Routing") or {}
    return {"legacy": routing.get("legacy"), "schema": routing.get("schemaCode"),
            "rows": routing.get("rows"), "anyLegacy": payload.get("anyLegacy")}


# ── apply ────────────────────────────────────────────────────────────────────

def gate(ctx, t):
    """None when apply may act on this tenant, else the reason it is skipped."""
    args = ctx.args
    if args.only and t["category"] not in args.only:
        return "category %s is not in --only %s" % (t["category"], ",".join(args.only))
    if not args.tenant and not args.only:
        return "apply --all needs --only"  # refused earlier; defensive
    if t["category"] == "none" and not args.adopt_defaults:
        return "no notification configuration to migrate; --adopt-defaults seeds the shipped defaults"
    return None


def apply_tenant(ctx, t):
    tenant = t["tenant"]
    run = t.setdefault("apply", {})
    sn.FORBIDDEN.clear()
    made = sn.ensure_schemas(ctx.tok, ctx.notif_schema_file, sn.NEW_CODES, tenant)
    if made:
        run["schemasCreated"] = made
        time.sleep(3)
    event_tenant = city_for_preview(ctx, tenant)
    locales = t["_template_locales"] or [ctx.settings["default_locale"] or "en_IN"]
    before = why = None
    if ctx.args.no_preview:
        why = "--no-preview"
    elif ctx.integrations is None and ctx.integrations_error and "(unreachable)" in ctx.integrations_error:
        why = "novu-bridge unreachable (%s)" % ctx.integrations_error
    else:
        before, why = preview(ctx, event_tenant, t["_catalogue_rows"], locales)
    run["previewTenant"] = event_tenant

    result = sn.write_new_namespace(ctx.tok, t["_planned"], tenant, label="apply")
    run["write"] = result["by_code"]
    run["routingHeld"] = result["routing_held"]
    cat = result["by_code"].get(CATALOGUE, {})
    if cat.get("planned"):
        run["catalogue"] = {
            "planned": cat["planned"], "created": cat["created"], "present": cat["present"],
            "failed": cat["failed"], "first": bool(t["catalogue"].get("first")),
            "writtenFrom": cat.get("started"), "writtenTo": cat.get("finished"),
            "status": "PARTIAL" if cat["failed"] else "COMPLETE"}
    pinned = []
    for ch, rec, ident in t["_updates"]:
        data = dict(rec.get("data") or {}, provider=ident)
        outcome = mdms_update(ctx, CHANNEL, dict(rec, data=data), tenant)
        pinned.append({"channel": ch, "identifier": ident, "result": outcome})
        print("  apply %-33s %s → provider %s: %s" % (CHANNEL, ch, ident, outcome))
    run["pinUpdates"] = pinned

    # ── verify by reading back ──
    time.sleep(1)
    verify, mismatches = {}, []
    for code in sn.COPY_ORDER:
        records = sn.search_rows(ctx.tok, code, tenant)
        if records is None:
            mismatches.append("%s could not be re-read" % code)
            continue
        live = rows_by_key(code, sn._record_rows(records))
        missing = [_show_key(_key(code, row)) for row, _ in t["_planned"].get(code, [])
                   if _key(code, row) not in live]
        different = [_show_key(_key(code, row)) for row, active in t["_planned"].get(code, [])
                     if _key(code, row) in live and
                     _norm(code, dict(live[_key(code, row)][0], active=live[_key(code, row)][1]))
                     != _norm(code, dict(row, active=active))]
        verify[code] = {"rows": len(records), "planned": len(t["_planned"].get(code, [])),
                        "missing": missing, "different": different}
        if missing:
            mismatches.append("%s: %d planned row(s) not there (%s)" % (
                code, len(missing), _short("; ".join(missing), 150)))
        if different:
            mismatches.append("%s: %d row(s) read back different from what was written (%s)" % (
                code, len(different), _short("; ".join(different), 150)))
    for pin in pinned:
        if pin["result"] != "updated":
            mismatches.append("%s provider pin not written: %s" % (pin["channel"], pin["result"]))
    if (run.get("catalogue") or {}).get("status") == "PARTIAL":
        mismatches.insert(0, "EVENT CATALOGUE INCOMPLETE (%d of %d rows): novu-bridge now REJECTS "
                             "every event whose type is missing from it — re-run apply NOW" % (
                                 run["catalogue"]["created"] + run["catalogue"]["present"],
                                 run["catalogue"]["planned"]))
    run["verify"], run["mismatches"] = verify, mismatches

    # ── the preview after ──
    routing_created = result["by_code"].get(ROUTING, {}).get("created", 0)
    diffs = []
    if before is not None:
        if routing_created and t["_legacy_served"]:
            switched = wait_for_switch(ctx, tenant)
            run["bridgeSwitched"] = switched
            if switched is False:
                mismatches.append("novu-bridge still reports the legacy masters for %s 75 s after "
                                  "the routing rows landed" % tenant)
        after, why_after = preview(ctx, event_tenant, t["_catalogue_rows"], locales)
        if after is None:
            run["preview"] = {"available": False, "why": why_after}
        else:
            diffs = diff_previews(before, after)
            expected = t["category"] == "none"
            run["preview"] = {"available": True, "events": len(t["_catalogue_rows"]),
                              "locales": locales, "differences": diffs,
                              "expected": expected, "before": before, "after": after}
            if expected and diffs:
                t["notes"].append("preview: %d difference(s), all expected — the tenant had no "
                                  "configuration before" % len(diffs))
                diffs = []
    else:
        run["preview"] = {"available": False, "why": why}

    if sn.FORBIDDEN or result["routing_held"] or any(
            s["failed"] for s in result["by_code"].values()):
        status = "FAILED"
    elif mismatches or diffs or t["operatorActions"]:
        status = "WARN"
    else:
        status = "OK"
    run["forbidden"] = list(sn.FORBIDDEN)
    t["result"] = status


# ── output ───────────────────────────────────────────────────────────────────

def counts_line(t):
    lg, nw = t["counts"]["legacy"], t["counts"]["new"]
    return ("%d/%d/%d/%d" % tuple(lg[c] for c in LEGACY_ALL),
            "%d/%d/%d/%d/%d" % tuple(nw[c] for c in (CATALOGUE, ROUTING, TEMPLATE, PTEMPLATE, CHANNEL)))


def row_line(code, row, active):
    flag = "" if active else "  [inactive]"
    if code == ROUTING:
        return "%s · %s · %s%s" % (row["eventName"], row["audience"], row["channel"], flag)
    if code == TEMPLATE:
        return "%s · %s · %s · %s  %s%s" % (row["eventName"], row["audience"], row["channel"],
                                            row["locale"], _short(row.get("body"), 60), flag)
    if code == PTEMPLATE:
        return "%s · %s · %s · %s · %s → %s%s" % (row["provider"], row["channel"], row["eventName"],
                                                  row["audience"], row["locale"], row.get("templateId"), flag)
    if code == CATALOGUE:
        return "%s%s" % (row["eventName"], flag)
    if code == CHANNEL:
        return "%s enabled=%s gateway=%s provider=%s%s" % (
            row.get("code"), str(bool(row.get("enabled"))).lower(), row.get("gateway") or "-",
            row.get("provider") or "-", flag)
    return json.dumps(row)


def what_apply_does(t):
    total = sum(t["plannedCounts"].values())
    parts = ["%d %s" % (n, c.split(".")[-1]) for c, n in t["plannedCounts"].items() if n]
    pins = [ch for ch, d in t["providers"].items() if d.get("decision") == "pin"]
    text = ("create %d row(s): %s" % (total, ", ".join(parts))) if total else "nothing to create"
    if pins:
        text += "; pin %s" % ", ".join(pins)
    return text


def print_tenant(ctx, t, mode):
    args = ctx.args
    print()
    print("══ %s — %s ══" % (t["tenant"], t["category"].upper()))
    lg, nw = t["counts"]["legacy"], t["counts"]["new"]
    print("  legacy    Routing %d  Template %d  ProviderTemplate %d  Channel %d" % tuple(lg[c] for c in LEGACY_ALL))
    print("  new       EventCatalogue %d  Routing %d  Template %d  ProviderTemplate %d  Channel %d"
          % tuple(nw[c] for c in (CATALOGUE, ROUTING, TEMPLATE, PTEMPLATE, CHANNEL)))
    for reason in t["reasons"]:
        print("  why       %s" % reason)
    if t.get("bridgeSource"):
        bs = t["bridgeSource"]
        print("  bridge    /config/source: Routing from %s (%s rows)%s" % (
            bs["schema"], bs["rows"], "  ← DISAGREES with the reading above (bridge cache?)"
            if (bs["legacy"] is True) != t["_legacy_served"] else ""))
    d = t.get("defaultsDiff")
    if d and t["category"] in ("customised", "partial") and (d["onlyInTenant"] or d["onlyInDefaults"] or d["changed"]):
        print("  vs the shipped defaults:")
        for item in d["onlyInTenant"]:
            print("    + only in tenant    %s  %s" % (item["master"].split(".")[-1], _show_key(item["key"])))
        for item in d["onlyInDefaults"]:
            print("    - only in defaults  %s  %s  (NOT added%s)" % (
                item["master"].split(".")[-1], _show_key(item["key"]),
                "" if not args.adopt_defaults else " unless --adopt-defaults"))
        for item in d["changed"]:
            print("    ~ changed           %s  %s" % (item["master"].split(".")[-1], _show_key(item["key"])))
            for field, pair in item["fields"].items():
                print("        %-12s default: %s" % (field, _short(json.dumps(pair["default"], ensure_ascii=False), 150)))
                print("        %-12s tenant:  %s" % ("", _short(json.dumps(pair["tenant"], ensure_ascii=False), 150)))
    cat = t["catalogue"]
    print("  catalogue %s: %d events; %d to add%s" % (
        cat["origin"], cat["rows"], len(cat["toAdd"]),
        ("; catalogued but not in the live workflow: %s" % ", ".join(cat["notInLiveWorkflow"]))
        if cat["notInLiveWorkflow"] else ""))
    now, after = t["channels"]["now"], t["channels"]["after"]
    print("  channels  now:   %s" % now["source"])
    for ch in CHANNELS:
        info = now["channels"][ch]
        state = {True: "ON ", False: "off", None: "?  "}[info["enabled"]]
        print("            %-8s %s  %s" % (ch, state, transport(ch, info, ctx.settings) if info["enabled"] else ""))
    print("            after: %s" % ("unchanged" if not t["plannedCounts"][CHANNEL] else
                                     "NOTIFICATIONS.Channel rows, " + t["channels"]["rowsOrigin"]))
    print("  providers")
    for ch in CHANNELS:
        dec = t["providers"][ch]
        print("            %-8s %-17s %s" % (ch, dec.get("decision"), dec.get("detail", "")))
    print("  apply     %s" % what_apply_does(t))
    if args.show_rows != "none":
        for code in sn.COPY_ORDER:
            rows = t["_planned"].get(code) or []
            if not rows:
                continue
            print("    %s (%d)%s" % (code, len(rows), "  ← written last" if code == ROUTING else ""))
            shown = rows if args.show_rows == "full" else rows[:25]
            for row, active in shown:
                print("      %s" % (row_line(code, row, active) if args.show_rows == "keys"
                                    else json.dumps(row, ensure_ascii=False)))
            if len(rows) > len(shown):
                print("      … %d more (--show-rows full, or the --report file)" % (len(rows) - len(shown)))
    if t["presentSame"] or t["presentDifferent"]:
        print("  present   %d of the tenant's rows already there%s" % (
            t["presentSame"] + len(t["presentDifferent"]),
            " (%d with different content — left as they are)" % len(t["presentDifferent"])
            if t["presentDifferent"] else ""))
    for label, items in (("warning", t["warnings"]), ("ACTION", t["operatorActions"]), ("note", t["notes"])):
        for item in items:
            print("  %-9s %s" % (label, item))
    if mode == "apply":
        run = t.get("apply") or {}
        if t.get("skipped"):
            print("  result    SKIPPED — %s" % t["skipped"])
            return
        cat = run.get("catalogue")
        if cat and cat.get("created"):
            print("  catalogue %s: %d row(s) written %s → %s%s" % (
                cat["status"], cat["created"], cat["writtenFrom"], cat["writtenTo"],
                ("; first catalogue — look for REJECTED NB_EVENT_NOT_IN_CATALOGUE rows on Logs "
                 "(and in novu-bridge.dlq) from %s until %d s after %s" % (
                     cat["writtenFrom"], sn.BRIDGE_CACHE_SECONDS, cat["writtenTo"]))
                if cat.get("first") else ""))
        for mismatch in run.get("mismatches", []):
            print("  MISMATCH  %s" % mismatch)
        pv = run.get("preview") or {}
        if pv.get("available"):
            diffs = pv.get("differences") or []
            print("  preview   %d event(s) × %s via _resolve at %s: %s" % (
                pv["events"], "/".join(pv["locales"]), run.get("previewTenant"),
                "no difference" if not diffs else "%d DIFFERENCE(S)" % len(diffs)))
            for line in diffs[:30]:
                print("    ! %s" % line)
            if len(diffs) > 30:
                print("    … %d more in the --report file" % (len(diffs) - 30))
        else:
            print("  preview   not run — %s" % pv.get("why"))
        print("  result    %s" % t.get("result"))


def print_providers(ctx):
    print("providers — Novu integrations, shared by the whole deployment (via %s/integrations):" % BRIDGE)
    if ctx.integrations is None:
        print("  UNAVAILABLE: %s — no provider can be pinned this run" % ctx.integrations_error)
    else:
        inbox = [i for i in ctx.integrations if str(i.get("channel")).lower() == "in_app"]
        for i in ctx.integrations:
            if i in inbox:
                continue
            print("  %-8s %-36s %-16s %-8s%s \"%s\"" % (
                i.get("channelCode") or "?", i.get("identifier"), i.get("type") or "(pre-catalog)",
                "active" if i.get("active") else "inactive", " primary" if i.get("primary") else "",
                i.get("name")))
        if inbox:
            print("  (%d Novu in_app inbox integration(s) ignored)" % len(inbox))
        for note in ctx.pre_catalog:
            print("  note     %s" % note)
    for plan in ctx.provider_plans:
        print("  %s %s provider %s \"%s\" (identifier %s; credential keys %s — values not shown)%s" % (
            {"create": "WILL CREATE", "exists": "exists:", "created": "CREATED",
             "failed": "FAILED to create"}.get(plan["state"], plan["state"]),
            plan["type"], plan["channel"], plan["name"], plan["identifier"], ", ".join(plan["keys"]),
            (" — " + plan["error"]) if plan.get("error") else ""))
    s = ctx.settings
    print("bridge env  channels=%s (%s)  sms_provider=%s (%s)  default_locale=%s" % (
        "(unknown)" if s["allowlist"] is None else (s["allowlist"] or '""'), s["allowlist_source"],
        s["sms_provider"] if s["sms_provider"] is not None else "(unknown)", s["sms_provider_source"],
        s["default_locale"]))


def print_summary(ctx, tenants, excluded, mode):
    print()
    print("SUMMARY (%s)" % mode)
    print("%-12s %-11s %-15s %-17s %-44s %s" % ("TENANT", "CATEGORY", "LEGACY R/T/P/C",
                                               "NEW E/R/T/P/C", "APPLY" if mode == "apply" else "APPLY WOULD", "RESULT"))
    for t in tenants:
        if t.get("error"):
            print("%-12s %-11s %-15s %-17s %-44s %s" % (t["tenant"], "?", "-", "-", _short(t["error"], 44), "FAILED"))
            continue
        legacy, new = counts_line(t)
        if t.get("skipped"):
            action = "skip: " + t["skipped"]
        elif mode == "apply":
            run = t.get("apply") or {}
            created = sum(s.get("created", 0) for s in (run.get("write") or {}).values())
            present = sum(s.get("present", 0) for s in (run.get("write") or {}).values())
            action = "+%d created, %d present%s" % (created, present, ", ROUTING HELD" if run.get("routingHeld") else "")
        else:
            action = what_apply_does(t)
        print("%-12s %-11s %-15s %-17s %-44s %s" % (t["tenant"], t["category"], legacy, new,
                                                  _short(action, 44), t.get("result", "-")))
    if excluded:
        print("excluded: %s (--exclude %s)" % (", ".join(excluded), " ".join(
            ctx.args.exclude if ctx.args.exclude is not None else [DEFAULT_EXCLUDE])))


def public(t):
    """The tenant entry as written to the JSON report (internal fields dropped)."""
    return {k: v for k, v in t.items() if not k.startswith("_")}


# ── main ─────────────────────────────────────────────────────────────────────

class Ctx:
    pass


def parse_args(argv):
    ap = argparse.ArgumentParser(
        prog="migrate-notifications.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Plan, then apply, the one-way migration of a state tenant's notification "
                    "configuration from RAINMAKER-PGR.Notification* to NOTIFICATIONS.*.",
        epilog="""examples:
  migrate-notifications.py plan --all --report plan.json
  migrate-notifications.py apply --all --only defaults --yes --report apply.json
  migrate-notifications.py apply --tenant ke --yes
  migrate-notifications.py apply --tenant ke --create-smscountry-provider \\
      --credentials-file ./providers.json --yes          # file must be chmod 600

credentials file (only the types you create; values are never printed or reported):
  {"smscountry": {"name": "SMSCountry", "credentials": {"user": "...", "password": "...",
                  "senderId": "...", "apiUrl": "(optional)"}},
   "twilio-sms": {"credentials": {"accountSid": "AC...", "token": "...", "from": "+1..."}}}

env: DIGIT_URL, DIGIT_USERNAME (ADMIN), DIGIT_PASSWORD (eGov@123), DIGIT_LOGIN_TENANT,
     STATE_ROOT / NOTIF_ROOTS (for --all), NOTIF_CHANNELS_ALLOWLIST, NOVU_BRIDGE_SMS_PROVIDER
exit: 0 ok · 1 warnings · 2 a tenant failed · 3 403 · 4 refused to start""")
    ap.add_argument("mode", choices=("plan", "apply"))
    who = ap.add_mutually_exclusive_group(required=True)
    who.add_argument("--tenant", action="append", metavar="CODE",
                     help="a state tenant (repeatable); a city code is reduced to its state")
    who.add_argument("--all", action="store_true",
                     help="every state tenant listed in tenant.tenants at the root(s)")
    ap.add_argument("--roots", help="comma-separated roots for --all (default: STATE_ROOT / "
                                    "NOTIF_ROOTS, else the bridge container's "
                                    "NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT, else "
                                    "STATE_LEVEL_TENANT_ID in $DIGIT_DIR/docker-compose.egov-digit.yaml)")
    ap.add_argument("--exclude", action="append", metavar="REGEX",
                    help="skip state codes matching (repeatable; default %r — test junk)" % DEFAULT_EXCLUDE)
    ap.add_argument("--only", help="categories apply may act on, e.g. defaults,none "
                                   "(required with apply --all)")
    ap.add_argument("--adopt-defaults", action="store_true",
                    help="also write the shipped default rows the tenant lacks (the only way a "
                         "`none` tenant gets the defaults here)")
    ap.add_argument("--provider", action="append", metavar="CH=IDENTIFIER",
                    help="pin this Novu integration for channel CH (SMS, EMAIL, WHATSAPP)")
    ap.add_argument("--create-smscountry-provider", action="store_true",
                    help="create a catalog SMSCountry provider from --credentials-file and pin it for SMS")
    ap.add_argument("--create-provider", action="append", metavar="TYPE",
                    help="create a catalog provider of TYPE (%s) from --credentials-file and pin "
                         "it for its channel" % ", ".join(sorted(CATALOG_CHANNEL)))
    ap.add_argument("--credentials-file", help="JSON with the credentials; mode 0600 or stricter")
    ap.add_argument("--channels-allowlist", help="NOVU_BRIDGE_CHANNELS_ENABLED as the bridge runs "
                                                 "it (default: read from the novu-bridge container)")
    ap.add_argument("--sms-provider", help="NOVU_BRIDGE_SMS_PROVIDER as the bridge runs it")
    ap.add_argument("--default-locale", help="NOVU_BRIDGE_DEFAULT_LOCALE (default: container, else en_IN)")
    ap.add_argument("--bridge-container", default="novu-bridge",
                    help="container to read the bridge env from ('' = do not ask docker)")
    ap.add_argument("--bridge-url", help="novu-bridge base URL (default: DIGIT_URL, through Kong)")
    ap.add_argument("--digit-url", default=os.environ.get("DIGIT_URL", ""))
    ap.add_argument("--login-tenant", default=os.environ.get("DIGIT_LOGIN_TENANT"))
    ap.add_argument("--digit-dir", default=os.environ.get("DIGIT_DIR", "/opt/digit"))
    ap.add_argument("--data-dir", help="dir with NOTIFICATIONS.*.json defaults (default: the staged "
                                       "notification-seed/ next to this script, else the repo)")
    ap.add_argument("--show-rows", choices=("none", "keys", "full"), default="keys")
    ap.add_argument("--no-preview", action="store_true", help="apply without the _resolve preview")
    ap.add_argument("--report", help="write the full JSON report here")
    ap.add_argument("--yes", action="store_true", help="really apply (after reviewing the plan)")
    args = ap.parse_args(argv)
    if args.only:
        args.only = [c.strip() for c in args.only.split(",") if c.strip()]
        bad = [c for c in args.only if c not in CATEGORIES]
        if bad:
            ap.error("--only: unknown categor%s %s (use %s)" % ("y" if len(bad) == 1 else "ies",
                                                                ", ".join(bad), ", ".join(CATEGORIES)))
    return args


def resolve_files(ctx, args):
    repo = os.path.abspath(os.path.join(HERE, "..", "..", "utilities", "default-data-handler",
                                        "src", "main", "resources"))
    staged = os.path.join(HERE, "notification-seed")
    data_dir = args.data_dir or os.environ.get("DATA_DIR") or (
        staged if os.path.exists(os.path.join(staged, "NOTIFICATIONS.Template.json"))
        else os.path.join(repo, "mdmsData-dev", "NOTIFICATIONS"))
    sn.DATA_DIR = data_dir
    ctx.notif_schema_file = first_existing([
        os.environ.get("NOTIF_SCHEMA_FILE"), os.path.join(data_dir, "NOTIFICATIONS.json"),
        os.path.join(repo, "schema", "NOTIFICATIONS.json")])
    channel_file = first_existing([
        os.path.join(data_dir, sn.LEGACY_CHANNEL + ".json"),
        os.path.join(repo, "mdmsData-dev", "RAINMAKER-PGR", sn.LEGACY_CHANNEL + ".json")])
    missing = [name for name, path in (("NOTIFICATIONS.json schema", ctx.notif_schema_file),
                                        (sn.LEGACY_CHANNEL + ".json", channel_file)) if not path]
    ctx.defaults = {}
    for code in NEW_CONTENT:
        path = os.path.join(data_dir, code + ".json")
        if not os.path.exists(path):
            missing.append(path)
            continue
        ctx.defaults[code] = [(row, nc.is_active(row)) for row in load_json(path)]
    if missing:
        raise RefuseToStart("files not found: %s (--data-dir)" % ", ".join(missing))
    ctx.channel_defaults = load_json(channel_file)


def run(argv=None):
    args = parse_args(argv)
    ctx = Ctx()
    ctx.args = args
    report = {"generatedAt": _now(), "mode": args.mode, "tenants": []}
    try:
        if args.mode == "apply" and args.all and not args.only:
            raise RefuseToStart("apply --all needs --only <categories> (e.g. --only defaults,none); "
                                "customised and partial tenants are applied only when listed "
                                "there or named with --tenant")
        if not args.digit_url:
            raise RefuseToStart("DIGIT_URL (or --digit-url) is required")
        resolve_files(ctx, args)
        sn.URL = args.digit_url.rstrip("/")
        ctx.bridge_url = (args.bridge_url or sn.URL).rstrip("/")
        ctx.roots, roots_source = (resolve_roots(args) if args.all else ([], "--tenant"))
        sn.USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
        sn.PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
        sn.LOGIN_TENANT = args.login_tenant or (ctx.roots[0] if ctx.roots else
                                                args.tenant[0].split(".")[0])
        try:
            ctx.tok = sn.token()
        except (urllib.error.URLError, OSError, KeyError, ValueError) as exc:
            raise RefuseToStart("login as %s at %s failed: %s" % (sn.USERNAME, sn.LOGIN_TENANT, exc))
        ctx.settings = bridge_settings(args)
        ctx.integrations, ctx.integrations_error = read_integrations(ctx)
        ctx.pre_catalog = []
        for i in ctx.integrations or []:
            if i.get("channelCode") and not i.get("type"):
                ctx.pre_catalog.append("%s (%s, %s) predates the provider catalog: it works, but its "
                                       "credentials cannot be rotated from the Configurator — "
                                       "re-create it from the catalog when convenient"
                                       % (i.get("identifier"), i.get("providerId"), i.get("channelCode")))
        ctx.explicit_pins = {}
        for item in args.provider or []:
            ch, _, ident = item.partition("=")
            ch = ch.strip().upper()
            if ch not in CHANNELS or not ident.strip():
                raise RefuseToStart("--provider %s: expected SMS|EMAIL|WHATSAPP=<identifier>" % item)
            if ctx.integrations is None:
                raise RefuseToStart("--provider %s: the integration list is unavailable (%s), so the "
                                    "pin cannot be checked" % (item, ctx.integrations_error))
            match = [i for i in ctx.integrations if i.get("identifier") == ident.strip()]
            if not match or not match[0].get("active") or match[0].get("channelCode") != ch:
                raise RefuseToStart("--provider %s: no ACTIVE %s integration with that identifier"
                                    % (item, ch))
            ctx.explicit_pins[ch] = ident.strip()
        ctx.provider_plans = plan_provider_creation(ctx, args)
        for plan in ctx.provider_plans:
            if plan["channel"] in ctx.explicit_pins:
                raise RefuseToStart("both --provider %s=… and a provider to create for %s"
                                    % (plan["channel"], plan["channel"]))
            if plan["state"] == "exists" and not plan["active"]:
                raise RefuseToStart("provider %s already exists but is inactive; activate it in the "
                                    "Configurator or pick another name" % plan["identifier"])
    except RefuseToStart as exc:
        print("REFUSED: %s" % exc, file=sys.stderr)
        return 4

    print("migrate-notifications %s — %s — %s — %s%s" % (
        args.mode, report["generatedAt"], sn.URL,
        ("roots %s (%s)" % (",".join(ctx.roots), roots_source)) if args.all else "tenants " + ",".join(args.tenant),
        "  [--adopt-defaults]" if args.adopt_defaults else ""))
    tenants, excluded, notes = discover(ctx, args)
    for note in notes:
        print("note: %s" % note)
    if args.mode == "apply" and args.yes and ctx.provider_plans:
        create_providers(ctx, ctx.provider_plans)
    print_providers(ctx)

    entries = []
    for code in tenants:
        try:
            records, missing_schemas = read_tenant(ctx, code)
            catalogue, origin = sn.event_catalogue_rows(ctx.tok, code)
            t = analyse(ctx, code, records, missing_schemas, catalogue, origin)
            t["bridgeSource"] = bridge_source(ctx, code)
        except Exception as exc:  # per-tenant isolation: report and go on
            entries.append({"tenant": code, "error": "%s: %s" % (type(exc).__name__, exc)})
            print("\n══ %s — ERROR ══\n  %s: %s" % (code, type(exc).__name__, exc))
            continue
        entries.append(t)

    forbidden = False
    if args.mode == "plan" or not args.yes:
        for t in entries:
            if not t.get("error"):
                print_tenant(ctx, t, "plan")
    else:
        for t in entries:
            if t.get("error"):
                continue
            reason = gate(ctx, t)
            if reason:
                t["skipped"], t["result"] = reason, "SKIPPED"
                print_tenant(ctx, t, "apply")
                continue
            print("\n── applying %s (%s) ──" % (t["tenant"], t["category"]))
            try:
                apply_tenant(ctx, t)
            except Exception as exc:  # isolation: the next tenant still runs
                t["result"] = "FAILED"
                t.setdefault("apply", {})["error"] = "%s: %s" % (type(exc).__name__, exc)
                print("  ERROR %s: %s" % (type(exc).__name__, exc))
            forbidden = forbidden or bool((t.get("apply") or {}).get("forbidden"))
            print_tenant(ctx, t, "apply")

    mode = "apply" if (args.mode == "apply" and args.yes) else "plan"
    print_summary(ctx, entries, excluded, mode)
    report.update({
        "mode": mode, "digitUrl": sn.URL, "roots": ctx.roots, "excluded": excluded,
        "adoptDefaults": args.adopt_defaults, "only": args.only,
        "bridgeEnv": {k: v for k, v in ctx.settings.items() if k != "allowlist_set"},
        "providers": {"integrations": ctx.integrations, "error": ctx.integrations_error,
                      "preCatalog": ctx.pre_catalog,
                      "created": [{k: v for k, v in p.items() if not k.startswith("_")}
                                  for p in ctx.provider_plans]},
        "tenants": [public(t) for t in entries]})
    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, ensure_ascii=False, default=str)
            fh.write("\n")
        print("report: %s" % args.report)

    if args.mode == "apply" and not args.yes:
        print("\nNOT APPLIED: review the plan above, then re-run with --yes. Migration is one-way per "
              "tenant: once a tenant has a NOTIFICATIONS.Routing row the bridge never reads its "
              "legacy masters again.", file=sys.stderr)
        return 4
    if any(t.get("error") for t in entries) or any(t.get("result") == "FAILED" for t in entries):
        return 3 if forbidden else 2
    if any(p["state"] == "failed" for p in ctx.provider_plans):
        return 2
    if any(t.get("result") == "WARN" for t in entries):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(run())
