#!/usr/bin/env python3
"""Generate NOTIFICATIONS.EventCatalogue rows for PGR from the workflow definition.

The catalogue is what the Configurator validates templates against BEFORE any event
of that type has ever been seen (thin-event design section 6.3), so it has to list every
transition the workflow can actually take. Hand-writing it would let it drift from the
workflow the moment someone adds a state -- which is exactly the drift the existing
placeholder-parity test was built to prevent, one file over. So PGR's rows are
GENERATED from local-setup/dataloader/templates/PgrWorkflowConfig.json; run it with
--check after changing the workflow to catch a stale catalogue.

A running tenant's catalogue is generated the same way from the BusinessService it
actually runs (build_live_catalogue / --live-tenant), read from egov-workflow-v2:
migrate-notifications.py and the deploy's fresh-tenant seed use that, and fall back to
the committed file only when the workflow service cannot answer.

WHAT IT DOES
------------
One row per DISTINCT (action, toState) reachable transition:

  eventName    COMPLAINTS.WORKFLOW.<ACTION>.<TOSTATE>   (the converter's mapping)
  label        a readable name, disambiguated by toState (RATE has two)
  actors       the actor names the producer will send  (see THE ACTOR RULE)
  placeholders the 13 tokens buildPlaceholderValues fills, design section 1.4
  channels     SMS / WHATSAPP / EMAIL
  module       Complaints
  entityType   COMPLAINT

THE STATE RESOLUTION, DONE ONCE
-------------------------------
A workflow action's nextState is a STATE reference; what a notification is keyed on is
the resulting applicationStatus. In a persisted BusinessService those are uuids; in the
committed template they are state names (only the start state's currentState is a uuid
placeholder). So this resolves nextState through an index built over BOTH `uuid` and
`state`, and falls back to the literal value when neither matches -- one resolution
pass, at generation time, so nothing downstream has to know a state uuid exists.

THE ACTOR RULE
--------------
`citizen` is always carried: the complaint has a filer from the moment it exists.
`assignee` is carried by every event whose source state is reachable AFTER an ASSIGN,
because resolveAssignee falls back to the last ASSIGN in workflow history and therefore
keeps resolving for the rest of the complaint's life. That is computed from the graph,
not listed by hand. It is marked required only on the ASSIGN transitions themselves,
where the producer has just been handed the assignee; everywhere else it is optional,
which is what tells an operator an ACTOR:assignee audience needs a fallback in its pipe
chain. APPLY is reachable only from the start state, so it carries no assignee.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from notifications_convert import event_name, render  # noqa: E402

MODULE = "Complaints"
ENTITY_TYPE = "COMPLAINT"
BUSINESS_SERVICE = "PGR"
CHANNELS = ["SMS", "WHATSAPP", "EMAIL"]

# Readable names for the actions the PGR workflow declares. An action not listed here
# still gets a row -- it falls back to "<ACTION> transition" -- so adding a workflow
# action can never silently drop an event from the catalogue.
ACTION_LABELS = {
    "APPLY": "Complaint filed",
    "ASSIGN": "Complaint assigned",
    "REASSIGN": "Complaint sent back for reassignment",
    "REJECT": "Complaint rejected",
    "RESOLVE": "Complaint resolved",
    "REOPEN": "Complaint reopened",
    "RATE": "Complaint rated and closed",
    "COMMENT": "Comment added",
    "ESCALATE": "Complaint escalated",
}

# The 13 placeholders and where each comes from -- design section 1.4. `blankWhen` is the
# authoring hint: what an operator sees when the source is unavailable. These are the
# ONLY tokens a PGR template may use; anything else ships with literal braces.
PLACEHOLDERS = [
    {"name": "id", "label": "Complaint number",
     "blankWhen": "never - the complaint always has a service request id"},
    {"name": "date", "label": "Date of the transition",
     "blankWhen": "never"},
    {"name": "status", "label": "Complaint status",
     "blankWhen": "never - falls back to the raw status when CS_COMMON_<STATUS> has no message"},
    {"name": "complaint_type", "label": "Complaint type",
     "blankWhen": "never - falls back to the raw service code when neither "
                  "COMPLAINT_HIERARCHY.<code> nor pgr.complaint.category.<code> resolves"},
    {"name": "additional_comments", "label": "Comment on the transition",
     "blankWhen": "the transition carried no comment"},
    {"name": "rating", "label": "Citizen rating",
     "blankWhen": "the complaint has not been rated yet"},
    {"name": "citizen_name", "label": "Name of the citizen who filed",
     "blankWhen": "the complaint was filed without a name"},
    {"name": "download_link", "label": "Short link to the complaint",
     "blankWhen": "egov-url-shortening is unavailable - blanked, never left literal, "
                  "because Twilio rejects an empty contentVariable with 21656"},
    {"name": "ulb", "label": "City / ULB name",
     "blankWhen": "rainmaker-common has no message for the district code"},
    {"name": "ao_designation", "label": "Assistant officer designation",
     "blankWhen": "rainmaker-common has no COMMON_MASTERS_DESIGNATION_AO message"},
    {"name": "emp_name", "label": "Name of the assigned employee",
     "blankWhen": "no assignee has been resolved for the complaint yet"},
    {"name": "emp_department", "label": "Department of the assigned employee",
     "blankWhen": "no assignee, or HRMS has no record for them"},
    {"name": "emp_designation", "label": "Designation of the assigned employee",
     "blankWhen": "no assignee, or HRMS has no record for them"},
]


def _states(workflow, business_service=BUSINESS_SERVICE):
    for service in workflow.get("BusinessServices") or []:
        if str(service.get("businessService", "")).upper() == business_service.upper():
            return service.get("states") or []
    raise SystemExit("ERROR: no BusinessServices entry for %r in the workflow definition"
                     % business_service)


def state_status_index(states):
    """{state uuid or name -> applicationStatus}. Both keys, because a persisted
    BusinessService references states by uuid and the committed template by name."""
    index = {}
    for state in states:
        status = state.get("applicationStatus") or state.get("state")
        for key in (state.get("uuid"), state.get("state")):
            if key:
                index[str(key)] = status
    return index


def resolve_to_state(next_state, index):
    """A nextState reference -> the resulting applicationStatus. Done once, here."""
    if next_state is None:
        return None
    return index.get(str(next_state)) or str(next_state)


def transitions(workflow, business_service=BUSINESS_SERVICE):
    """[(action, toState, fromState)] for every ACTIVE action in the definition."""
    states = _states(workflow, business_service)
    index = state_status_index(states)
    out = []
    for state in states:
        from_state = state.get("applicationStatus") or state.get("state")  # None = start
        for action in state.get("actions") or []:
            if action.get("active") is False:
                continue
            name = str(action.get("action") or "").strip().upper()
            to_state = resolve_to_state(action.get("nextState"), index)
            if not name or not to_state:
                continue
            out.append((name, str(to_state).upper(), from_state))
    return out


def states_after_assign(workflow, business_service=BUSINESS_SERVICE):
    """Every state reachable once an ASSIGN has happened -- i.e. every state from which
    resolveAssignee can still find an assignee in workflow history."""
    edges = {}
    seeds = set()
    for action, to_state, from_state in transitions(workflow, business_service):
        edges.setdefault(from_state, set()).add(to_state)
        if action == "ASSIGN":
            seeds.add(to_state)
    seen, stack = set(seeds), list(seeds)
    while stack:
        state = stack.pop()
        for nxt in edges.get(state, ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def label_for(action, to_state):
    return "%s (%s)" % (ACTION_LABELS.get(action, "%s transition" % action), to_state)


def build_catalogue(workflow, business_service=BUSINESS_SERVICE):
    """The NOTIFICATIONS.EventCatalogue rows for one workflow definition, sorted by
    eventName so the generated file is stable whatever order the states are declared in."""
    assigned_states = states_after_assign(workflow, business_service)
    events = {}
    for action, to_state, from_state in transitions(workflow, business_service):
        key = (action, to_state)
        entry = events.setdefault(key, {"from": set()})
        entry["from"].add(from_state)

    rows = []
    for (action, to_state), entry in events.items():
        # An assignee exists when the event can fire from a state that is reachable
        # after an ASSIGN. APPLY fires only from the start state, so it carries none.
        has_assignee = any(f in assigned_states for f in entry["from"])
        actors = [{"name": "citizen", "label": "The citizen who filed the complaint",
                   "required": True}]
        if has_assignee or action == "ASSIGN":
            actors.append({"name": "assignee",
                           "label": "The employee the complaint is assigned to",
                           "required": action == "ASSIGN"})
        rows.append({
            "module": MODULE,
            "eventName": event_name(business_service, action, to_state),
            "entityType": ENTITY_TYPE,
            "label": label_for(action, to_state),
            "actors": actors,
            "placeholders": [dict(p) for p in PLACEHOLDERS],
            "channels": list(CHANNELS),
            "active": True,
        })
    rows.sort(key=lambda r: r["eventName"])
    return rows


# ── the LIVE workflow: a tenant's own BusinessService from egov-workflow-v2 ────
# The committed template above is what a NEW tenant starts from; a tenant that has run
# for a while may have added or retired transitions. The catalogue decides which events
# the bridge accepts (an uncatalogued eventName is REJECTED), so a migration writes the
# catalogue of the workflow the tenant RUNS, not of the repo. build_catalogue already
# resolves a persisted BusinessService (uuid state references), so the live answer only
# has to be fetched.

WORKFLOW_SEARCH_PATH = "/egov-workflow-v2/egov-wf/businessservice/_search"


class WorkflowUnavailable(RuntimeError):
    """The live BusinessService could not be read (the caller falls back to the file)."""


def fetch_business_service(base_url, token, tenant, business_service=BUSINESS_SERVICE,
                           post=None, timeout=40):
    """{"BusinessServices": [...]} for `business_service` at `tenant`, read from the running
    egov-workflow-v2 (POST .../businessservice/_search?tenantId=&businessServices=).

    `post(url, body) -> dict` may be injected (tests); the default is urllib. Raises
    WorkflowUnavailable when the service answers with an error or no matching definition.
    """
    import urllib.error
    import urllib.parse
    import urllib.request

    query = urllib.parse.urlencode({"tenantId": tenant, "businessServices": business_service})
    url = base_url.rstrip("/") + WORKFLOW_SEARCH_PATH + "?" + query
    body = {"RequestInfo": {"apiId": "notif-catalogue", "authToken": token}}
    try:
        if post is not None:
            answer = post(url, body)
        else:
            req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json"})
            answer = json.load(urllib.request.urlopen(req, timeout=timeout))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise WorkflowUnavailable("workflow search at %s failed: %s" % (tenant, exc))
    services = [s for s in (answer or {}).get("BusinessServices") or []
                if str(s.get("businessService", "")).upper() == business_service.upper()]
    if not services:
        raise WorkflowUnavailable("no %s BusinessService at tenant %s" % (business_service, tenant))
    return {"BusinessServices": services[:1]}


def build_live_catalogue(base_url, token, tenant, business_service=BUSINESS_SERVICE, post=None):
    """The catalogue rows for the workflow `tenant` actually runs."""
    return build_catalogue(fetch_business_service(base_url, token, tenant, business_service, post),
                           business_service)


def _token_from_env(base_url):
    import urllib.parse
    import urllib.request
    tenant = os.environ.get("DIGIT_LOGIN_TENANT") or os.environ.get("NOTIF_TENANT", "")
    data = urllib.parse.urlencode({
        "grant_type": "password", "username": os.environ.get("DIGIT_USERNAME", "ADMIN"),
        "password": os.environ.get("DIGIT_PASSWORD", "eGov@123"), "tenantId": tenant,
        "scope": "read", "userType": "EMPLOYEE"}).encode()
    req = urllib.request.Request(base_url.rstrip("/") + "/user/oauth/token", data=data, headers={
        "Authorization": "Basic ZWdvdi11c2VyLWNsaWVudDo=",
        "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=40))["access_token"]


def _default_paths():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))
    return (os.path.join(root, "local-setup", "dataloader", "templates", "PgrWorkflowConfig.json"),
            os.path.join(root, "utilities", "default-data-handler", "src", "main", "resources",
                         "mdmsData-dev", "NOTIFICATIONS", "NOTIFICATIONS.EventCatalogue.json"))


def main(argv=None):
    workflow_default, out_default = _default_paths()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--workflow", default=workflow_default,
                    help="workflow definition file (the repo template by default)")
    ap.add_argument("--live-tenant", metavar="TENANT",
                    help="read the PGR BusinessService from the running egov-workflow-v2 at "
                         "TENANT instead of --workflow (DIGIT_URL, DIGIT_USERNAME, "
                         "DIGIT_PASSWORD, DIGIT_LOGIN_TENANT from the env); prints the rows "
                         "unless --out is given explicitly")
    ap.add_argument("--out", default=None,
                    help="file to write / --check against (default: the committed catalogue; "
                         "'-' = stdout)")
    ap.add_argument("--check", action="store_true",
                    help="do not write; exit 1 if --out differs")
    args = ap.parse_args(argv)

    if args.live_tenant:
        base_url = os.environ.get("DIGIT_URL", "")
        if not base_url:
            print("ERROR: --live-tenant needs DIGIT_URL", file=sys.stderr)
            return 2
        os.environ.setdefault("DIGIT_LOGIN_TENANT", args.live_tenant.split(".")[0])
        try:
            rows = build_live_catalogue(base_url, _token_from_env(base_url), args.live_tenant)
        except WorkflowUnavailable as exc:
            print("ERROR: %s" % exc, file=sys.stderr)
            return 2
        text = render(rows)
        if args.out is None:
            args.out = "-"
    else:
        with open(args.workflow, encoding="utf-8") as fh:
            workflow = json.load(fh)
        text = render(build_catalogue(workflow))
    if args.out is None:
        args.out = out_default
    if args.out == "-":
        if args.check:
            print("ERROR: --check needs a file to compare with (--out)", file=sys.stderr)
            return 2
        sys.stdout.write(text)
        return 0

    if args.check:
        current = None
        if os.path.exists(args.out):
            with open(args.out, encoding="utf-8") as fh:
                current = fh.read()
        source = ("the live workflow at %s" % args.live_tenant) if args.live_tenant else args.workflow
        if current != text:
            print("STALE: %s does not match the workflow definition at %s\n"
                  "Regenerate with: python3 local-setup/scripts/generate_event_catalogue.py"
                  % (args.out, source), file=sys.stderr)
            return 1
        print("OK: the event catalogue matches the workflow definition "
              "(%d events)." % len(json.loads(text)))
        return 0

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("wrote %s (%d events)" % (args.out, len(json.loads(text))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
