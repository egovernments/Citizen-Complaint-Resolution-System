#!/usr/bin/env python3
"""The seeder's NOTIF_ACTIONS and local-setup/db/full-dump.sql must agree, row for row.

    cd local-setup/scripts && python3 -m unittest

WHY THIS EXISTS
A tenant seeded by the dump (fresh compose/k8s install) and a tenant seeded by
seed-notifications.py (an existing box, where MDMS SQL migrations never run) must end
up with the SAME action ids, because a role-action references an action by numeric id.
If the two drift, Kong's enforce_rbac fails closed on one of the two stacks and the
Notifications screens 403 with no message anywhere. Nothing else in the toolchain
compares them, and both are hand-allocated.

It also re-derives the next free ids from the dump, so the next person adding an action
does not have to trust a comment.
"""
import collections
import importlib.util
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DUMP = os.path.join(ROOT, "local-setup", "db", "full-dump.sql")

ACTION_SCHEMA = "ACCESSCONTROL-ACTIONS-TEST.actions-test"
ROLEACTION_SCHEMA = "ACCESSCONTROL-ROLEACTIONS.roleactions"
# The dump columns, in order, for the eg_mdms_data COPY block.
COLUMNS = 10


def _load_seeder():
    """seed-notifications.py has a hyphen in its name, so it cannot be imported by name."""
    spec = importlib.util.spec_from_file_location(
        "seed_notifications", os.path.join(HERE, "seed-notifications.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _copy_rows():
    """Every row of the eg_mdms_data COPY block, split into its tab-separated columns."""
    with open(DUMP, encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    start = next(i for i, l in enumerate(lines)
                 if l.startswith("COPY public.eg_mdms_data")) + 1
    end = start
    while lines[end] != "\\.":
        end += 1
    return [l.split("\t") for l in lines[start:end]]


SEEDER = _load_seeder()
ROWS = _copy_rows()


class DumpBlockTest(unittest.TestCase):
    """Invariants of the COPY block itself. A malformed row here does not fail the
    import loudly -- Postgres takes whatever column count the line has."""

    def test_every_row_has_the_same_column_count(self):
        counts = collections.Counter(len(r) for r in ROWS)
        self.assertEqual(sorted(counts), [COLUMNS],
                         "a row with the wrong number of tabs corrupts the COPY import: "
                         "%s" % dict(counts))

    def test_the_data_column_is_valid_json_on_every_row(self):
        for row in ROWS:
            try:
                json.loads(row[4])
            except ValueError as exc:
                self.fail("invalid JSON in %s: %s" % (row[0], exc))

    def test_primary_keys_and_unique_identifiers_do_not_repeat(self):
        for label, values in (("id", [r[0] for r in ROWS]),
                              ("(tenant, uniqueidentifier, schemacode)",
                               [tuple(r[1:4]) for r in ROWS])):
            dupes = [k for k, v in collections.Counter(values).items() if v > 1]
            self.assertEqual(dupes, [], "duplicate %s in the dump: %s" % (label, dupes))

    def test_no_role_action_points_at_an_action_that_does_not_exist(self):
        actions = {json.loads(r[4])["id"] for r in ROWS if r[3] == ACTION_SCHEMA}
        referenced = {json.loads(r[4])["actionid"] for r in ROWS if r[3] == ROLEACTION_SCHEMA}
        self.assertEqual(sorted(referenced - actions), [],
                         "these role-actions grant nothing and fail closed at the gateway")

    def test_action_and_role_action_ids_are_unique(self):
        for label, schema, field in (("action", ACTION_SCHEMA, "id"),
                                     ("role-action", ROLEACTION_SCHEMA, "id")):
            ids = [json.loads(r[4]).get(field) for r in ROWS if r[3] == schema]
            ids = [i for i in ids if i is not None]
            dupes = [k for k, v in collections.Counter(ids).items() if v > 1]
            self.assertEqual(dupes, [], "duplicate %s ids: %s" % (label, dupes))


class SeederDumpParityTest(unittest.TestCase):
    def setUp(self):
        self.dump_actions = {json.loads(r[4])["id"]: json.loads(r[4])
                             for r in ROWS if r[3] == ACTION_SCHEMA}
        self.dump_roleactions = collections.defaultdict(set)
        for row in ROWS:
            if row[3] == ROLEACTION_SCHEMA:
                data = json.loads(row[4])
                self.dump_roleactions[data["actionid"]].add(data["rolecode"])

    def test_every_seeded_action_exists_in_the_dump_field_for_field(self):
        for aid, url, name, enabled, display, service, _roles in SEEDER.NOTIF_ACTIONS:
            self.assertIn(aid, self.dump_actions, "action %d is in the seeder but not "
                                                  "in full-dump.sql" % aid)
            self.assertEqual(self.dump_actions[aid], {
                "id": aid, "url": url, "code": "null", "name": name, "path": "",
                "enabled": enabled, "displayName": display, "orderNumber": 0,
                "serviceCode": service, "parentModule": "",
            }, "action %d differs between the seeder and the dump" % aid)

    def test_the_new_block_carries_no_method_field(self):
        # Row-shape convention, decided once for this block (design 5.4 rule 2). Some
        # older dump rows carry "method": "POST"; the notification block does not.
        for aid, *_ in SEEDER.NOTIF_ACTIONS:
            self.assertNotIn("method", self.dump_actions[aid])

    def test_every_seeded_role_grant_exists_in_the_dump(self):
        for aid, _url, _name, _enabled, _display, _service, roles in SEEDER.NOTIF_ACTIONS:
            self.assertEqual(set(roles), self.dump_roleactions[aid],
                             "role grants for action %d differ between the seeder and "
                             "the dump" % aid)

    def test_the_dump_grants_nothing_the_seeder_does_not(self):
        # The other direction: a grant only the dump has would make a dump-seeded tenant
        # strictly more permissive than a script-seeded one.
        seeded = {aid for aid, *_ in SEEDER.NOTIF_ACTIONS}
        for aid in seeded:
            roles = {r for a, _u, _n, _e, _d, _s, rs in SEEDER.NOTIF_ACTIONS
                     if a == aid for r in rs}
            self.assertEqual(self.dump_roleactions[aid], roles)

    def test_no_action_url_is_an_internal_gateway_url(self):
        # Rule 4: /novu-adapter/v1/gateways/** carries provider credentials in headers
        # and is deliberately gateway-unreachable. Seeding an action for it is the one
        # change that could make it reachable.
        for _aid, url, *_ in SEEDER.NOTIF_ACTIONS:
            self.assertNotIn("/gateways/", url)

    def test_the_notifications_masters_all_have_a_create_and_an_update_action(self):
        urls = {url for _aid, url, *_ in SEEDER.NOTIF_ACTIONS}
        for master in ("NOTIFICATIONS.EventCatalogue", "NOTIFICATIONS.Routing",
                       "NOTIFICATIONS.Template", "NOTIFICATIONS.ProviderTemplate",
                       "NOTIFICATIONS.Channel"):
            for verb in ("_create", "_update"):
                self.assertIn("/mdms-v2/v2/%s/%s" % (verb, master), urls)

    def test_search_needs_no_action_and_none_is_seeded(self):
        # Search goes through the un-suffixed /mdms-v2/v2/_search. The legacy masters
        # have no _search row either; this pins that the new block matches.
        for _aid, url, *_ in SEEDER.NOTIF_ACTIONS:
            self.assertNotIn("/mdms-v2/v2/_search/", url)

    def test_the_next_free_ids_are_re_derivable_from_the_dump(self):
        max_action = max(self.dump_actions)
        role_ids = [json.loads(r[4])["id"] for r in ROWS
                    if r[3] == ROLEACTION_SCHEMA and json.loads(r[4]).get("id") is not None]
        self.assertEqual(max_action, 4639,
                         "the dump's highest action id moved: the next block starts at "
                         "%d, not 4640" % (max_action + 1))
        self.assertEqual(max(role_ids), 2406,
                         "the dump's highest role-action id moved: the next block starts "
                         "at %d, not 2407" % (max(role_ids) + 1))


if __name__ == "__main__":
    unittest.main()
