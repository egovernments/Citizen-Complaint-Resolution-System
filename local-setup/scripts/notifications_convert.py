#!/usr/bin/env python3
"""Convert the legacy RAINMAKER-PGR.Notification* MDMS rows into the module-neutral
NOTIFICATIONS.* rows (thin-event design, sections 2.3 / 5.1 / 5.2).

WHY THIS IS A LIBRARY AND NOT A ONE-OFF SCRIPT
----------------------------------------------
The same mapping has to run in two places and produce byte-identical results:

  1. offline, over the repo's committed defaults, to generate
     utilities/default-data-handler/src/main/resources/mdmsData-dev/NOTIFICATIONS/*.json
     (the CLI at the bottom of this file does that, and its output is committed);
  2. online, inside seed-notifications.py, over the rows a LIVE tenant actually has.

(2) cannot be replaced by (1). The seeder is create-only -- a data row that collides
on x-unique comes back DUPLICATE and is counted as `dup`, and there is no data _update
call anywhere in it. So it is idempotent but NOT convergent: a changed default value
has never reached a deployed box. Live servers have drifted from the repo's 24/42/14
to roughly 41/60/14 rows through operator edits. Staging a file of adapted rows would
therefore copy the REPO's defaults over a tenant that has its own. The copy must read
the live rows and convert them.

THE MAPPING
-----------
  businessService + action + toState  ->  eventName  ("COMPLAINTS.WORKFLOW.<ACTION>.<TOSTATE>")
  audience (bare) + assigneeOnly      ->  an audience reference with a scheme
  fromState                           ->  dropped (documentation-only, never matched)
  businessService                     ->  dropped (subsumed by eventName)
  assigneeOnly                        ->  dropped (expressed by the ACTOR:assignee|ROLE:x chain)
  module                              ->  added (Complaints), required non-key column

Audience forms, per design section 2.3:

  | legacy audience         | assigneeOnly | becomes                        |
  |-------------------------|--------------|--------------------------------|
  | CITIZEN                 | any          | ACTOR:citizen                  |
  | EMPLOYEE                | any          | ACTOR:assignee                 |
  | AUTO_ESCALATE / SYSTEM  | any          | (row dropped, with a warning)  |
  | anything else           | false/absent | ROLE:<it>                      |
  | anything else           | true         | ACTOR:assignee|ROLE:<it>       |

Every function here is pure and every one is idempotent: feeding an already-converted
row back in returns it unchanged. That is what makes the live copy safe to re-run.

THE ONE JOIN HAZARD, AND HOW IT IS HANDLED
------------------------------------------
Today pgr-services looks a template up by the audience string of the ROUTING row that
matched. So routing and template rows must end up with the SAME audience string. A
routing row with audience=GRO, assigneeOnly=true becomes ACTOR:assignee|ROLE:GRO, but
its template row carries no assigneeOnly column at all and would map to a bare
ROLE:GRO -- and the join would break silently. So template and provider-template
conversion takes the routing rows as context (`audience_index`) and reuses exactly the
audience string routing produced for that (audience, action, toState[, channel]).
Resolution order: the exact channel-qualified key, then the channel-independent key
when every channel agreed, then the bare mapping. Deterministic, and documented here
because it is the one place this conversion is not a per-row function.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

# Channels the masters accept. Kept here so a row carrying a channel the schema
# rejects is reported by the converter rather than by MDMS at write time.
CHANNELS = ("SMS", "WHATSAPP", "EMAIL")

# Locale a row with a blank/absent locale falls back to. locale is part of the
# Template and ProviderTemplate uniqueness keys and is `required` in the new schema,
# so a live row with a null locale would be rejected on create; give it the default
# rather than dropping a message body an operator wrote.
DEFAULT_LOCALE = "en_IN"

# Audiences that are not notifiable. NotificationRouter drops them today with a WARN;
# the converter does the same rather than minting a ROLE:SYSTEM nobody holds.
NON_NOTIFIABLE = ("AUTO_ESCALATE", "SYSTEM")

# Bare legacy audience names that are really named actors, not role pools.
BARE_ACTORS = {"CITIZEN": "ACTOR:citizen", "EMPLOYEE": "ACTOR:assignee"}

# businessService -> (module, eventName prefix). businessService has exactly one value
# in production ("PGR"): NotificationRouter.route has one caller and it passes the
# PGR_MODULENAME constant. An unknown businessService is still converted rather than
# dropped -- see module_for()/event_name() -- so a tenant that invented one keeps its
# rows, under a prefix derived from the service code.
BUSINESS_SERVICE_MODULES = {"PGR": ("Complaints", "COMPLAINTS.WORKFLOW")}

LEGACY_TO_NEW_CODE = {
    "RAINMAKER-PGR.NotificationRouting": "NOTIFICATIONS.Routing",
    "RAINMAKER-PGR.NotificationTemplate": "NOTIFICATIONS.Template",
    "RAINMAKER-PGR.NotificationProviderTemplate": "NOTIFICATIONS.ProviderTemplate",
    "RAINMAKER-PGR.NotificationChannel": "NOTIFICATIONS.Channel",
}

# The order matters for the copy: routing is converted first so its audience strings
# are available as context when the templates are converted (see the join hazard above).
LEGACY_ORDER = [
    "RAINMAKER-PGR.NotificationRouting",
    "RAINMAKER-PGR.NotificationTemplate",
    "RAINMAKER-PGR.NotificationProviderTemplate",
    "RAINMAKER-PGR.NotificationChannel",
]


class ConversionError(ValueError):
    """A row that cannot be converted without inventing data."""


# ── small helpers ────────────────────────────────────────────────────────────

def _s(value):
    """A trimmed string, or '' for None/blank. MDMS happily stores nulls."""
    return "" if value is None else str(value).strip()


def _truthy(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return _s(value).lower() in ("true", "1", "yes")


def is_active(row):
    """The row's active flag, defaulting to True exactly as create_row() does."""
    if "active" in row:
        return _truthy(row.get("active"))
    if "isActive" in row:
        return _truthy(row.get("isActive"))
    return True


def module_for(business_service):
    bs = _s(business_service) or "PGR"
    return BUSINESS_SERVICE_MODULES.get(bs.upper(), (bs, bs.upper() + ".WORKFLOW"))[0]


def event_name(business_service, action, to_state):
    """'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME' from ('PGR', 'ASSIGN', 'PENDINGATLME')."""
    action, to_state = _s(action).upper(), _s(to_state).upper()
    if not action or not to_state:
        raise ConversionError(
            "cannot derive eventName: action=%r toState=%r (both are required; "
            "NotificationService returns early on a blank action or toState)"
            % (action, to_state))
    bs = _s(business_service) or "PGR"
    prefix = BUSINESS_SERVICE_MODULES.get(bs.upper(), (bs, bs.upper() + ".WORKFLOW"))[1]
    return "%s.%s.%s" % (prefix, action, to_state)


def is_scheme_ref(audience):
    """True when `audience` is ALREADY an audience reference and must be left alone."""
    a = _s(audience)
    if not a:
        return False
    for part in a.split("|"):
        part = part.strip()
        if part.startswith("ACTOR:") or part.startswith("ROLE:") or part == "EVENT_RECIPIENTS":
            return True
    return False


def audience_ref(audience, assignee_only=False):
    """Legacy bare audience (+ assigneeOnly) -> an audience reference with a scheme.

    Returns None for a non-notifiable audience, which means: drop the row.
    An audience that is already a scheme reference is returned unchanged, which is
    what makes re-conversion a no-op.
    """
    a = _s(audience)
    if not a:
        raise ConversionError("audience is blank")
    if is_scheme_ref(a):
        return a
    if a.upper() in NON_NOTIFIABLE:
        return None
    if a.upper() in BARE_ACTORS:
        return BARE_ACTORS[a.upper()]
    if _truthy(assignee_only):
        # Today's "notify the named assignee, but fall through to the role pool rather
        # than notifying no one" (NotificationService:551-556) is exactly a pipe chain.
        return "ACTOR:assignee|ROLE:%s" % a
    return "ROLE:%s" % a


# ── per-master conversion ────────────────────────────────────────────────────

def convert_routing_row(row):
    """RAINMAKER-PGR.NotificationRouting row -> NOTIFICATIONS.Routing row, or None."""
    if "eventName" in row and "action" not in row:  # already converted
        return dict(row)
    aud = audience_ref(row.get("audience"), row.get("assigneeOnly"))
    if aud is None:
        return None
    return {
        "module": module_for(row.get("businessService")),
        "eventName": event_name(row.get("businessService"), row.get("action"), row.get("toState")),
        "audience": aud,
        "channel": _s(row.get("channel")).upper(),
        "active": is_active(row),
    }


def build_audience_index(legacy_routing_rows):
    """Context for template conversion: how routing mapped each legacy audience.

    Returns {(audience, action, toState, channel): ref, (audience, action, toState): ref}
    where the 3-tuple entry is present only when every channel agreed on one ref.
    """
    exact, grouped = {}, {}
    for row in legacy_routing_rows or []:
        if "eventName" in row and "action" not in row:
            continue  # already converted: nothing legacy to key on
        try:
            aud = audience_ref(row.get("audience"), row.get("assigneeOnly"))
        except ConversionError:
            continue
        if aud is None:
            continue
        legacy = _s(row.get("audience")).upper()
        action, to_state = _s(row.get("action")).upper(), _s(row.get("toState")).upper()
        channel = _s(row.get("channel")).upper()
        exact[(legacy, action, to_state, channel)] = aud
        grouped.setdefault((legacy, action, to_state), set()).add(aud)
    for key, refs in grouped.items():
        if len(refs) == 1:
            exact[key] = next(iter(refs))
    return exact


def _joined_audience(row, audience_index):
    """The audience string the matching routing row produced, else the bare mapping."""
    legacy = _s(row.get("audience")).upper()
    action, to_state = _s(row.get("action")).upper(), _s(row.get("toState")).upper()
    channel = _s(row.get("channel")).upper()
    if audience_index:
        for key in ((legacy, action, to_state, channel), (legacy, action, to_state)):
            if key in audience_index:
                return audience_index[key]
    return audience_ref(row.get("audience"))


def convert_template_row(row, audience_index=None):
    """RAINMAKER-PGR.NotificationTemplate row -> NOTIFICATIONS.Template row, or None."""
    if "eventName" in row and "action" not in row:
        return dict(row)
    aud = _joined_audience(row, audience_index)
    if aud is None:
        return None
    out = {
        "module": module_for(row.get("businessService")),
        "eventName": event_name(row.get("businessService"), row.get("action"), row.get("toState")),
        "audience": aud,
        "channel": _s(row.get("channel")).upper(),
        "locale": _s(row.get("locale")) or DEFAULT_LOCALE,
        "subject": row.get("subject") if _s(row.get("subject")) else None,
        "body": row.get("body") or "",
        "active": is_active(row),
    }
    if row.get("placeholders") is not None:
        out["placeholders"] = list(row.get("placeholders"))
    return out


def convert_provider_template_row(row, audience_index=None):
    """RAINMAKER-PGR.NotificationProviderTemplate -> NOTIFICATIONS.ProviderTemplate."""
    if "eventName" in row and "action" not in row:
        return dict(row)
    aud = _joined_audience(row, audience_index)
    if aud is None:
        return None
    out = {
        "provider": _s(row.get("provider")),
        "channel": _s(row.get("channel")).upper(),
        "eventName": event_name(row.get("businessService"), row.get("action"), row.get("toState")),
        "audience": aud,
        "locale": _s(row.get("locale")) or DEFAULT_LOCALE,
        "templateId": _s(row.get("templateId")),
        "variables": list(row.get("variables") or []),
        "active": is_active(row),
    }
    if _s(row.get("templateName")):
        out["templateName"] = row.get("templateName")
    if _s(row.get("approvalStatus")):
        out["approvalStatus"] = row.get("approvalStatus")
    return out


def convert_channel_row(row):
    """RAINMAKER-PGR.NotificationChannel -> NOTIFICATIONS.Channel. Shape is unchanged;
    only the namespace moves, so this is a copy with the known columns picked out."""
    out = {"code": _s(row.get("code")).upper(), "enabled": _truthy(row.get("enabled"))}
    for key in ("gateway", "senderId", "provider"):
        if key in row:
            out[key] = row.get(key)
    out["active"] = is_active(row)
    return out


def convert_master(legacy_code, rows, audience_index=None):
    """Convert one master's rows. Returns (new_code, converted_rows, dropped).

    `dropped` is a list of (row, reason) for rows a human should know about:
    non-notifiable audiences and rows that cannot yield an eventName.
    """
    if legacy_code not in LEGACY_TO_NEW_CODE:
        raise ConversionError("unknown legacy master %r" % legacy_code)
    new_code = LEGACY_TO_NEW_CODE[legacy_code]
    out, dropped = [], []
    for row in rows or []:
        try:
            if legacy_code == "RAINMAKER-PGR.NotificationRouting":
                converted = convert_routing_row(row)
            elif legacy_code == "RAINMAKER-PGR.NotificationTemplate":
                converted = convert_template_row(row, audience_index)
            elif legacy_code == "RAINMAKER-PGR.NotificationProviderTemplate":
                converted = convert_provider_template_row(row, audience_index)
            else:
                converted = convert_channel_row(row)
        except ConversionError as exc:
            dropped.append((row, str(exc)))
            continue
        if converted is None:
            dropped.append((row, "audience %r is not notifiable" % row.get("audience")))
            continue
        out.append(converted)
    return new_code, out, dropped


def convert_all(legacy_by_code):
    """{legacy code: rows} -> ({new code: rows}, {new code: [(row, reason)]}).

    Routing is converted first so the audience index is available to the templates.
    """
    index = build_audience_index(legacy_by_code.get("RAINMAKER-PGR.NotificationRouting"))
    converted, dropped = {}, {}
    for legacy_code in LEGACY_ORDER:
        if legacy_code not in legacy_by_code:
            continue
        new_code, rows, drops = convert_master(legacy_code, legacy_by_code[legacy_code], index)
        converted[new_code] = rows
        dropped[new_code] = drops
    return converted, dropped


# ── CLI: regenerate the committed default data files ─────────────────────────

def _default_dirs():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))
    res = os.path.join(root, "utilities", "default-data-handler", "src", "main", "resources")
    return (os.path.join(res, "mdmsData-dev", "RAINMAKER-PGR"),
            os.path.join(res, "mdmsData-dev", "NOTIFICATIONS"))


def render(rows):
    """The exact bytes a generated data file holds. One definition, so the generator
    and the no-diff test cannot disagree about formatting."""
    return json.dumps(rows, indent=2, ensure_ascii=False) + "\n"


def generate(in_dir, out_dir, write=True):
    """Convert every staged legacy file in `in_dir`. Returns {out path: bytes}."""
    legacy = {}
    for code in LEGACY_ORDER:
        path = os.path.join(in_dir, code + ".json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                legacy[code] = json.load(fh)
    converted, dropped = convert_all(legacy)
    files = {}
    for new_code, rows in converted.items():
        path = os.path.join(out_dir, new_code + ".json")
        files[path] = render(rows)
        for row, reason in dropped.get(new_code, []):
            print("  ! dropped a %s row: %s (%s)" % (new_code, reason, row), file=sys.stderr)
    if write:
        os.makedirs(out_dir, exist_ok=True)
        for path, text in files.items():
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
            print("wrote %s (%d rows)" % (path, len(json.loads(text))))
    return files


def main(argv=None):
    in_default, out_default = _default_dirs()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--in-dir", default=in_default,
                    help="directory holding RAINMAKER-PGR.Notification*.json")
    ap.add_argument("--out-dir", default=out_default,
                    help="directory to write NOTIFICATIONS.*.json into")
    ap.add_argument("--check", action="store_true",
                    help="do not write; exit 1 if the committed files differ")
    args = ap.parse_args(argv)

    files = generate(args.in_dir, args.out_dir, write=not args.check)
    if args.check:
        stale = []
        for path, text in files.items():
            current = None
            if os.path.exists(path):
                with open(path, encoding="utf-8") as fh:
                    current = fh.read()
            if current != text:
                stale.append(path)
        if stale:
            print("STALE (regenerate with notifications_convert.py):", file=sys.stderr)
            for path in stale:
                print("  " + path, file=sys.stderr)
            return 1
        print("OK: %d converted default files match the legacy seed." % len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
