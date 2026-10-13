#!/usr/bin/env python3
"""Package the notification defaults a NEW WORKSPACE gets at signup, for pgr-services.

pgr-services provisions a self-serve workspace (onboarding step NOTIFICATION_DEFAULTS, after
PLATFORM_BASELINE). Its Docker build context is backend/pgr-services, so it cannot read the
default-data-handler files the deploy seeds from at run time; this script packages THE SAME
data into one resource it can:

  backend/pgr-services/src/main/resources/onboarding/notification-defaults.json

It is generated, never edited by hand, and `--check` (run by
local-setup/tests/test_onboarding_notification_defaults.py) fails when it drifts from its
sources:

  schemas  the 4 legacy RAINMAKER-PGR.Notification* and the 5 NOTIFICATIONS.* schema
           definitions seed-notifications.py creates (DDH schema/RAINMAKER-PGR.json and
           schema/NOTIFICATIONS.json), with the same empty-x-ref-schema fix
  access   seed-notifications.py's NOTIF_ACTIONS: every action row, and a role-action for
           each role the platform baseline gives a workspace (ACCESSCONTROL-ROLES.roles in
           platform-baseline-v1.json), in the seeder's exact row shape
  config   the shipped NOTIFICATIONS.Template / ProviderTemplate / Routing defaults
           (mdmsData-dev/NOTIFICATIONS) and the EventCatalogue generated from the workflow
           the platform baseline installs (generate_event_catalogue.build_catalogue — the
           seeder's "live workflow" rule, which for a workspace is this workflow). Routing is
           LAST: novu-bridge serves a tenant from NOTIFICATIONS.* the moment it has one
           Routing row.

No channel rows: a tenant without them follows the deployment's NOVU_BRIDGE_CHANNELS_ENABLED,
which is what the seeder's allowlist-derived rows reproduce, and pgr-services does not know
that allowlist.

Usage: build-onboarding-notification-defaults.py [--check]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DDH = os.path.join(REPO, "utilities", "default-data-handler", "src", "main", "resources")
BASELINE = os.path.join(REPO, "backend", "pgr-services", "src", "main", "resources", "onboarding",
                        "platform-baseline-v1.json")
OUT = os.path.join(REPO, "backend", "pgr-services", "src", "main", "resources", "onboarding",
                   "notification-defaults.json")

sys.path.insert(0, HERE)
import generate_event_catalogue as gec  # noqa: E402


def _seeder():
    spec = importlib.util.spec_from_file_location("seed_notifications_for_packaging",
                                                  os.path.join(HERE, "seed-notifications.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _uid(data, unique):
    """MDMS v2's uniqueIdentifier: the x-unique values joined with '.'."""
    return ".".join(str(data[field]) for field in unique)


def build():
    sn = _seeder()
    baseline = _load(BASELINE)
    unique = {s["code"]: s["definition"]["x-unique"] for s in baseline["schemas"]
              if s["code"] in (sn.ACTION_SCHEMA, sn.ROLEACTION_SCHEMA)}

    schemas = []
    for path, codes in ((os.path.join(DDH, "schema", "RAINMAKER-PGR.json"), sn.NOTIF_CODES),
                        (os.path.join(DDH, "schema", "NOTIFICATIONS.json"), sn.NEW_CODES)):
        by_code = {s["code"]: s for s in _load(path)}
        for code in codes:
            definition = sn._strip_empty_ref(by_code[code])["definition"]
            schemas.append({"code": code, "definition": definition})
            unique[code] = definition["x-unique"]

    roles = {r["data"]["code"] for r in baseline["records"] if r["schemaCode"] == sn.ROLES_SCHEMA}
    records = []

    def add(code, data):
        records.append({"schemaCode": code, "uniqueIdentifier": _uid(data, unique[code]), "data": data})

    for aid, url, name, enabled, disp, svc, _roles in sn.NOTIF_ACTIONS:
        add(sn.ACTION_SCHEMA, {"id": aid, "url": url, "code": "null", "name": name, "path": "",
                               "enabled": enabled, "displayName": disp, "orderNumber": 0,
                               "serviceCode": svc, "parentModule": ""})
    for aid, _url, _name, _enabled, _disp, _svc, action_roles in sn.NOTIF_ACTIONS:
        for role in action_roles:
            if role in roles:
                add(sn.ROLEACTION_SCHEMA, {"rolecode": role, "actionid": aid, "actioncode": "",
                                           "tenantId": "{tenantid}"})

    catalogue = gec.build_catalogue({"BusinessServices": baseline["workflow"]})
    for row in catalogue:
        add("NOTIFICATIONS.EventCatalogue", row)
    for code in ("NOTIFICATIONS.Template", "NOTIFICATIONS.ProviderTemplate", "NOTIFICATIONS.Routing"):
        for row in _load(os.path.join(DDH, "mdmsData-dev", "NOTIFICATIONS", code + ".json")):
            add(code, row)

    return {
        "source": "GENERATED by local-setup/scripts/build-onboarding-notification-defaults.py from "
                  "seed-notifications.py, default-data-handler schema/ and mdmsData-dev/NOTIFICATIONS/, "
                  "and platform-baseline-v1.json. Do not edit; regenerate.",
        "configurationSchemas": ["NOTIFICATIONS.EventCatalogue", "NOTIFICATIONS.Template",
                                 "NOTIFICATIONS.ProviderTemplate", "NOTIFICATIONS.Routing"],
        "routingSchemas": ["NOTIFICATIONS.Routing", "RAINMAKER-PGR.NotificationRouting"],
        "unique": unique,
        "schemas": schemas,
        "records": records,
    }


def render(doc):
    return json.dumps(doc, indent=1, ensure_ascii=False, sort_keys=False) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="do not write; exit 1 if the packaged file is stale")
    args = ap.parse_args(argv)
    text = render(build())
    if args.check:
        current = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else None
        if current != text:
            print("STALE: %s — regenerate with %s" % (os.path.relpath(OUT, REPO), os.path.basename(__file__)),
                  file=sys.stderr)
            return 1
        print("OK: %s matches its sources." % os.path.relpath(OUT, REPO))
        return 0
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    doc = json.loads(text)
    print("wrote %s (%d schemas, %d records)" % (os.path.relpath(OUT, REPO), len(doc["schemas"]), len(doc["records"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
