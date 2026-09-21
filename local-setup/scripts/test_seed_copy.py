#!/usr/bin/env python3
"""Tests for seed-notifications.py's legacy -> NOTIFICATIONS.* copy step.

    cd local-setup/scripts && python3 -m unittest

These drive seed_new_namespace() against an in-memory fake MDMS, because the property
that matters is not "does it POST" but "what does a SECOND run do". The seeder is
create-only and swallows DUPLICATE, so a copy that is subtly non-idempotent would still
print DONE on every deploy while quietly minting variants of the same row — the failure
would only be visible as duplicated SMS months later.

The idempotency proof is test_a_second_run_creates_nothing and
test_a_third_run_over_its_own_output_creates_nothing.
"""
import importlib.util
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_seeder():
    spec = importlib.util.spec_from_file_location(
        "seed_notifications_copy", os.path.join(HERE, "seed-notifications.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SEEDER = _load_seeder()

LEGACY_ROUTING = "RAINMAKER-PGR.NotificationRouting"
LEGACY_TEMPLATE = "RAINMAKER-PGR.NotificationTemplate"
LEGACY_PROVIDER = "RAINMAKER-PGR.NotificationProviderTemplate"
LEGACY_CHANNEL = "RAINMAKER-PGR.NotificationChannel"


class FakeMdms:
    """The minimum of MDMS the copy step touches: search, and create-with-x-unique."""

    def __init__(self, rows=None, default_files=None):
        # {schemaCode: [ {data, isActive} ]}
        self.rows = {code: list(recs) for code, recs in (rows or {}).items()}
        self.default_files = default_files or {}
        self.creates = []
        self.search_failures = set()

    def search(self, _tok, code):
        if code in self.search_failures:
            return None
        return [dict(rec) for rec in self.rows.get(code, [])]

    def create(self, _tok, code, row, is_active=None):
        self.creates.append((code, json.loads(json.dumps(row)), is_active))
        key = SEEDER._unique_key(code, row) if code in SEEDER.NEW_UNIQUE_KEYS else None
        for rec in self.rows.get(code, []):
            if key is not None and SEEDER._unique_key(code, rec["data"]) == key:
                return "dup"
        self.rows.setdefault(code, []).append(
            {"data": row, "isActive": True if is_active is None else bool(is_active),
             "uniqueIdentifier": json.dumps(key)})
        return "created"

    def load_defaults(self, code):
        return self.default_files.get(code)

    def install(self, test):
        test.addCleanup(setattr, SEEDER, "search_rows", SEEDER.search_rows)
        test.addCleanup(setattr, SEEDER, "create_row", SEEDER.create_row)
        test.addCleanup(setattr, SEEDER, "_load_default_rows", SEEDER._load_default_rows)
        SEEDER.search_rows = self.search
        SEEDER.create_row = self.create
        SEEDER._load_default_rows = self.load_defaults


def rec(data, active=True):
    return {"data": data, "isActive": active, "uniqueIdentifier": json.dumps(sorted(data.items()), default=str)}


LEGACY_ROWS = {
    LEGACY_ROUTING: [
        rec({"businessService": "PGR", "action": "APPLY",
             "toState": "PENDINGFORASSIGNMENT", "audience": "CITIZEN",
             "channel": "SMS", "active": True}),
        rec({"businessService": "PGR", "action": "ASSIGN", "toState": "PENDINGATLME",
             "audience": "PGR_LME", "assigneeOnly": True, "channel": "SMS",
             "active": True}),
        # An operator-deactivated row: it must arrive deactivated, not resurrected.
        rec({"businessService": "PGR", "action": "REJECT", "toState": "REJECTED",
             "audience": "CITIZEN", "channel": "EMAIL", "active": True}, active=False),
        # Non-notifiable: dropped with a warning, exactly as the router drops it today.
        rec({"businessService": "PGR", "action": "ESCALATE", "toState": "PENDINGATLME",
             "audience": "AUTO_ESCALATE", "channel": "SMS", "active": True}),
    ],
    LEGACY_TEMPLATE: [
        rec({"audience": "CITIZEN", "action": "APPLY",
             "toState": "PENDINGFORASSIGNMENT", "channel": "SMS", "locale": "en_IN",
             "body": "filed {id}", "active": True}),
        rec({"audience": "PGR_LME", "action": "ASSIGN", "toState": "PENDINGATLME",
             "channel": "SMS", "locale": "en_IN", "body": "assigned {id}",
             "active": True}),
    ],
    LEGACY_CHANNEL: [rec({"code": "SMS", "enabled": True, "gateway": "novu"})],
}

# What the playbook stages next to the seeder. Every new master has a file, because a
# master listed in NEW_CODES but not staged is exactly how NotificationChannel once
# silently never got seeded — so the seeder counts a missing file as a failure.
CATALOGUE_DEFAULTS = {
    "NOTIFICATIONS.EventCatalogue": [
        {"module": "Complaints", "eventName": "COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT",
         "label": "Complaint filed (PENDINGFORASSIGNMENT)", "active": True},
    ],
    "NOTIFICATIONS.Routing": [],
    "NOTIFICATIONS.Template": [],
    "NOTIFICATIONS.ProviderTemplate": [],
    "NOTIFICATIONS.Channel": [],
}


class CopyFromLiveRowsTest(unittest.TestCase):
    def setUp(self):
        self.mdms = FakeMdms(rows=dict(LEGACY_ROWS), default_files=dict(CATALOGUE_DEFAULTS))
        self.mdms.install(self)

    def created(self, code):
        return [row for c, row, _a in self.mdms.creates if c == code]

    def test_live_legacy_rows_are_converted_and_created(self):
        created, present, failed = SEEDER.seed_new_namespace("tok")
        self.assertEqual(failed, 0)
        self.assertEqual(present, 0)
        routing = self.created("NOTIFICATIONS.Routing")
        self.assertEqual(
            sorted(r["eventName"] for r in routing),
            ["COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT",
             "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME",
             "COMPLAINTS.WORKFLOW.REJECT.REJECTED"])
        self.assertGreater(created, 0)

    def test_the_non_notifiable_row_is_dropped_not_invented(self):
        SEEDER.seed_new_namespace("tok")
        for row in self.created("NOTIFICATIONS.Routing"):
            self.assertNotIn("AUTO_ESCALATE", row["audience"])
            self.assertNotIn("ESCALATE.PENDINGATLME", row["eventName"])

    def test_a_deactivated_legacy_row_arrives_deactivated(self):
        SEEDER.seed_new_namespace("tok")
        by_event = {row["eventName"]: (row, active)
                    for code, row, active in self.mdms.creates
                    if code == "NOTIFICATIONS.Routing"}
        row, active = by_event["COMPLAINTS.WORKFLOW.REJECT.REJECTED"]
        self.assertFalse(active, "the create must carry isActive=False")
        self.assertFalse(row["active"], "the data column must agree with it")

    def test_a_template_inherits_the_routing_rows_audience_chain(self):
        SEEDER.seed_new_namespace("tok")
        templates = {t["eventName"]: t for t in self.created("NOTIFICATIONS.Template")}
        self.assertEqual(templates["COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME"]["audience"],
                         "ACTOR:assignee|ROLE:PGR_LME")
        self.assertEqual(
            templates["COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT"]["audience"],
            "ACTOR:citizen")

    def test_the_legacy_rows_are_never_written_to(self):
        SEEDER.seed_new_namespace("tok")
        for code, _row, _active in self.mdms.creates:
            self.assertFalse(code.startswith("RAINMAKER-PGR."),
                             "the copy must never write to the legacy namespace")
        self.assertEqual(len(self.mdms.rows[LEGACY_ROUTING]), 4)
        self.assertEqual(len(self.mdms.rows[LEGACY_TEMPLATE]), 2)

    def test_a_second_run_creates_nothing(self):
        """The idempotency proof: re-running the whole step is a no-op."""
        SEEDER.seed_new_namespace("tok")
        self.mdms.creates = []
        created, present, failed = SEEDER.seed_new_namespace("tok")
        self.assertEqual((created, failed), (0, 0))
        self.assertGreater(present, 0, "the second run must SEE the rows, not skip blindly")
        self.assertEqual(self.mdms.creates, [], "a re-run fired a create")

    def test_a_third_run_over_its_own_output_creates_nothing(self):
        SEEDER.seed_new_namespace("tok")
        SEEDER.seed_new_namespace("tok")
        self.mdms.creates = []
        SEEDER.seed_new_namespace("tok")
        self.assertEqual(self.mdms.creates, [])

    def test_the_event_catalogue_comes_from_its_file_not_from_a_conversion(self):
        SEEDER.seed_new_namespace("tok")
        catalogue = self.created("NOTIFICATIONS.EventCatalogue")
        self.assertEqual([r["eventName"] for r in catalogue],
                         ["COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT"])


class CopyOnATenantWithoutLegacyRowsTest(unittest.TestCase):
    def test_defaults_are_seeded_when_there_is_nothing_to_copy(self):
        defaults = dict(CATALOGUE_DEFAULTS)
        defaults["NOTIFICATIONS.Routing"] = [
            {"module": "Complaints", "eventName": "X.Y.Z", "audience": "ACTOR:citizen",
             "channel": "SMS", "active": True}]
        defaults["NOTIFICATIONS.Template"] = []
        defaults["NOTIFICATIONS.ProviderTemplate"] = []
        defaults["NOTIFICATIONS.Channel"] = [{"code": "SMS", "enabled": False}]
        mdms = FakeMdms(rows={}, default_files=defaults)
        mdms.install(self)
        created, _present, failed = SEEDER.seed_new_namespace("tok")
        self.assertEqual(failed, 0)
        self.assertEqual(created, 3)  # catalogue + routing + channel

    def test_nothing_is_seeded_when_the_tenant_already_has_new_rows(self):
        existing = {"NOTIFICATIONS.Routing": [
            rec({"module": "Complaints", "eventName": "X.Y.Z",
                 "audience": "ACTOR:citizen", "channel": "SMS", "active": True})]}
        defaults = dict(CATALOGUE_DEFAULTS)
        defaults["NOTIFICATIONS.Routing"] = [
            {"module": "Complaints", "eventName": "OTHER.E.V", "audience": "ACTOR:citizen",
             "channel": "SMS", "active": True}]
        mdms = FakeMdms(rows=existing, default_files=defaults)
        mdms.install(self)
        SEEDER.seed_new_namespace("tok")
        routing_creates = [r for c, r, _a in mdms.creates if c == "NOTIFICATIONS.Routing"]
        self.assertEqual(routing_creates, [],
                         "a tenant that already has rows must not be handed repo defaults")


class CopyFailureModesTest(unittest.TestCase):
    def test_a_failed_search_is_never_read_as_an_empty_tenant(self):
        # The dangerous case: if a failed read looked like "no rows", the step would
        # decide the tenant has no data and seed the repo's defaults over live ones.
        mdms = FakeMdms(rows=dict(LEGACY_ROWS), default_files=dict(CATALOGUE_DEFAULTS))
        mdms.search_failures.add("NOTIFICATIONS.Routing")
        mdms.install(self)
        _created, _present, failed = SEEDER.seed_new_namespace("tok")
        self.assertGreaterEqual(failed, 1)
        self.assertEqual([r for c, r, _a in mdms.creates if c == "NOTIFICATIONS.Routing"], [])

    def test_a_failed_legacy_search_skips_that_master(self):
        mdms = FakeMdms(rows=dict(LEGACY_ROWS), default_files=dict(CATALOGUE_DEFAULTS))
        mdms.search_failures.add(LEGACY_TEMPLATE)
        mdms.install(self)
        _created, _present, failed = SEEDER.seed_new_namespace("tok")
        self.assertGreaterEqual(failed, 1)
        self.assertEqual([r for c, r, _a in mdms.creates if c == "NOTIFICATIONS.Template"], [])

    def test_a_missing_converter_module_fails_loudly_instead_of_seeding_nothing(self):
        self.addCleanup(setattr, SEEDER, "nc", SEEDER.nc)
        SEEDER.nc = None
        self.assertEqual(SEEDER.seed_new_namespace("tok"), (0, 0, 1))


class UniqueKeyMirrorTest(unittest.TestCase):
    """NEW_UNIQUE_KEYS is a hand-kept mirror of the schema file's x-unique tuples. If
    it drifts, the copy's skip-if-present check looks at the wrong columns and either
    re-creates rows forever or silently skips distinct ones."""

    def test_the_keys_match_the_committed_schema_definitions(self):
        path = os.path.join(HERE, "..", "..", "utilities", "default-data-handler",
                            "src", "main", "resources", "schema", "NOTIFICATIONS.json")
        with open(os.path.abspath(path), encoding="utf-8") as fh:
            schemas = json.load(fh)
        from_file = {s["code"]: tuple(s["definition"]["x-unique"]) for s in schemas}
        self.assertEqual(SEEDER.NEW_UNIQUE_KEYS, from_file)

    def test_every_new_code_has_a_key_and_a_schema(self):
        self.assertEqual(sorted(SEEDER.NEW_CODES), sorted(SEEDER.NEW_UNIQUE_KEYS))


if __name__ == "__main__":
    unittest.main()
