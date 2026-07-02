#!/usr/bin/env python3
"""
Migrate PGR SMS bodies from egov-localization into the
RAINMAKER-PGR.NotificationTemplate MDMS master seed.

Curated mapping (audience, action, toState) -> localization code, derived from
the REAL state machine (PgrWorkflowConfig.json) and the canonical
PGR_<AUDIENCE>_<ACTION>_<STATUS>_SMS_MESSAGE keys that NotificationUtil.getCustomizedMsg()
actually builds. We DO NOT split('_') the codes (multi-underscore statuses like
CLOSEDAFTERRESOLUTION / PENDINGFORREASSIGNMENT would mis-segment).

The dead legacy combo (PENDINGATLME + REASSIGN) is intentionally excluded:
REASSIGN transitions PENDINGATLME -> PENDINGFORREASSIGNMENT, so it never lands on
PENDINGATLME.

Usage:
  python3 migrate-pgr-sms-templates.py [LOCALE]   # default en_IN
"""
import json, re, sys, os

LOCALE = sys.argv[1] if len(sys.argv) > 1 else "en_IN"
HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.normpath(os.path.join(HERE, "..", "src", "main", "resources"))
LOC = os.path.join(RES, "localisations", LOCALE, "rainmaker-pgr.json")
OUT = os.path.join(RES, "mdmsData-dev", "RAINMAKER-PGR", "RAINMAKER-PGR.NotificationTemplate.json")

# (audience, action, toState) -> localization code
MAPPING = [
    ("CITIZEN",  "APPLY",    "PENDINGFORASSIGNMENT",   "PGR_CITIZEN_APPLY_PENDINGFORASSIGNMENT_SMS_MESSAGE"),
    ("CITIZEN",  "ASSIGN",   "PENDINGATLME",           "PGR_CITIZEN_ASSIGN_PENDINGATLME_SMS_MESSAGE"),
    ("EMPLOYEE", "ASSIGN",   "PENDINGATLME",           "PGR_EMPLOYEE_ASSIGN_PENDINGATLME_SMS_MESSAGE"),
    ("CITIZEN",  "REASSIGN", "PENDINGFORREASSIGNMENT",  "PGR_CITIZEN_REASSIGN_PENDINGFORREASSIGNMENT_SMS_MESSAGE"),
    ("EMPLOYEE", "REASSIGN", "PENDINGFORREASSIGNMENT",  "PGR_EMPLOYEE_REASSIGN_PENDINGFORREASSIGNMENT_SMS_MESSAGE"),
    ("CITIZEN",  "REJECT",   "REJECTED",               "PGR_CITIZEN_REJECT_REJECTED_SMS_MESSAGE"),
    ("CITIZEN",  "RESOLVE",  "RESOLVED",               "PGR_CITIZEN_RESOLVE_RESOLVED_SMS_MESSAGE"),
    ("CITIZEN",  "REOPEN",   "PENDINGFORASSIGNMENT",   "PGR_CITIZEN_REOPEN_PENDINGFORASSIGNMENT_SMS_MESSAGE"),
    ("EMPLOYEE", "REOPEN",   "PENDINGFORASSIGNMENT",   "PGR_EMPLOYEE_REOPEN_PENDINGFORASSIGNMENT_SMS_MESSAGE"),
    ("EMPLOYEE", "RATE",     "CLOSEDAFTERRESOLUTION",  "PGR_EMPLOYEE_RATE_CLOSEDAFTERRESOLUTION_SMS_MESSAGE"),
    ("EMPLOYEE", "RATE",     "CLOSEDAFTERREJECTION",   "PGR_EMPLOYEE_RATE_CLOSEDAFTERREJECTION_SMS_MESSAGE"),
]

def main():
    msgs = {m["code"]: m["message"] for m in json.load(open(LOC)) if isinstance(m, dict)}
    rows, missing = [], []
    for audience, action, to_state, code in MAPPING:
        body = msgs.get(code)
        if body is None:
            missing.append(code)
            continue
        rows.append({
            "audience": audience,
            "action": action,
            "toState": to_state,
            "channel": "SMS",
            "locale": LOCALE,
            "subject": None,
            "body": body,
            "placeholders": sorted(set(re.findall(r"\{(\w+)\}", body))),
            "active": True,
        })
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(rows, open(OUT, "w"), indent=2, ensure_ascii=False)
    open(OUT, "a").write("\n")
    print(f"wrote {len(rows)} template rows -> {OUT}")
    if missing:
        print("WARNING missing localization codes:", missing)

if __name__ == "__main__":
    main()
