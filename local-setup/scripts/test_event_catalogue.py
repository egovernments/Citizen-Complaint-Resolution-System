#!/usr/bin/env python3
"""Unit tests for the PGR event-catalogue generator.

    cd local-setup/scripts && python3 -m unittest

The load-bearing one is test_the_committed_catalogue_matches_the_workflow: it is what
stops the catalogue drifting away from PgrWorkflowConfig.json. CI runs it with `paths`
filters that fire on a workflow-definition-only change, because a path filter is a
silent SKIP, not a failure.
"""
import json
import os
import unittest

import generate_event_catalogue as gen
import notifications_convert as nc

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORKFLOW = os.path.join(ROOT, "local-setup", "dataloader", "templates",
                        "PgrWorkflowConfig.json")
CATALOGUE = os.path.join(ROOT, "utilities", "default-data-handler", "src", "main",
                         "resources", "mdmsData-dev", "NOTIFICATIONS",
                         "NOTIFICATIONS.EventCatalogue.json")
NEW_DIR = os.path.dirname(CATALOGUE)


def _read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_workflow():
    return _read_json(WORKFLOW)


# A miniature workflow that uses UUID state references the way a PERSISTED
# BusinessService does, to prove the nextState -> applicationStatus resolution is real
# and not an accident of the committed template using state names.
UUID_WORKFLOW = {
    "BusinessServices": [{
        "businessService": "PGR",
        "states": [
            {"uuid": "s0", "state": None, "applicationStatus": None,
             "actions": [{"action": "APPLY", "nextState": "s1", "active": True}]},
            {"uuid": "s1", "state": "PENDINGFORASSIGNMENT",
             "applicationStatus": "PENDINGFORASSIGNMENT",
             "actions": [{"action": "ASSIGN", "nextState": "s2", "active": True},
                         {"action": "WITHDRAW", "nextState": "s3", "active": False}]},
            {"uuid": "s2", "state": "PENDINGATLME", "applicationStatus": "PENDINGATLME",
             "actions": [{"action": "RESOLVE", "nextState": "s3", "active": True}]},
            {"uuid": "s3", "state": "RESOLVED", "applicationStatus": "RESOLVED",
             "actions": None},
        ],
    }],
}


class StateResolutionTest(unittest.TestCase):
    def test_a_uuid_next_state_resolves_to_its_application_status(self):
        states = UUID_WORKFLOW["BusinessServices"][0]["states"]
        index = gen.state_status_index(states)
        self.assertEqual(gen.resolve_to_state("s2", index), "PENDINGATLME")

    def test_a_named_next_state_resolves_too(self):
        states = UUID_WORKFLOW["BusinessServices"][0]["states"]
        index = gen.state_status_index(states)
        self.assertEqual(gen.resolve_to_state("PENDINGATLME", index), "PENDINGATLME")

    def test_an_unknown_reference_is_kept_verbatim_not_dropped(self):
        self.assertEqual(gen.resolve_to_state("MYSTERY", {}), "MYSTERY")

    def test_inactive_actions_produce_no_event(self):
        names = {a for a, _, _ in gen.transitions(UUID_WORKFLOW)}
        self.assertNotIn("WITHDRAW", names)

    def test_the_committed_template_resolves_without_uuids(self):
        # The committed PgrWorkflowConfig.json references states by NAME; the start
        # state's currentState is a uuid placeholder and must not leak into an event.
        for _, to_state, _ in gen.transitions(load_workflow()):
            self.assertRegex(to_state, r"^[A-Z0-9_]+$")


class CatalogueShapeTest(unittest.TestCase):
    def setUp(self):
        self.rows = gen.build_catalogue(load_workflow())
        self.by_name = {r["eventName"]: r for r in self.rows}

    def test_one_row_per_distinct_action_and_target_state(self):
        pairs = {(a, s) for a, s, _ in gen.transitions(load_workflow())}
        self.assertEqual(len(self.rows), len(pairs))
        self.assertEqual(len(self.rows), len({r["eventName"] for r in self.rows}))

    def test_event_names_use_the_converter_mapping(self):
        # The catalogue and the converted routing rows must agree, or a routing row
        # points at an event that does not exist.
        self.assertIn(nc.event_name("PGR", "ASSIGN", "PENDINGATLME"), self.by_name)

    def test_rows_are_sorted_so_the_file_is_stable(self):
        self.assertEqual([r["eventName"] for r in self.rows],
                         sorted(r["eventName"] for r in self.rows))

    def test_every_row_carries_all_thirteen_placeholders(self):
        for row in self.rows:
            self.assertEqual([p["name"] for p in row["placeholders"]],
                             [p["name"] for p in gen.PLACEHOLDERS])
            self.assertEqual(len(row["placeholders"]), 13)

    def test_same_action_different_state_events_are_distinguishable(self):
        rated = [r for r in self.rows if ".RATE." in r["eventName"]]
        self.assertEqual(len(rated), 2)
        self.assertEqual(len({r["label"] for r in rated}), 2)

    def test_apply_carries_no_assignee_because_none_exists_yet(self):
        actors = self.by_name["COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT"]["actors"]
        self.assertEqual([a["name"] for a in actors], ["citizen"])

    def test_assign_requires_the_assignee_actor(self):
        actors = self.by_name["COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME"]["actors"]
        self.assertEqual({a["name"]: a["required"] for a in actors},
                         {"citizen": True, "assignee": True})

    def test_post_assignment_events_carry_an_optional_assignee(self):
        # RATE after a resolution is the case that makes the EMPLOYEE routing row work
        # today, through resolveAssignee's walk back through workflow history.
        actors = self.by_name["COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION"]["actors"]
        self.assertEqual({a["name"]: a["required"] for a in actors},
                         {"citizen": True, "assignee": False})

    def test_the_citizen_actor_is_always_present_and_required(self):
        for row in self.rows:
            citizen = [a for a in row["actors"] if a["name"] == "citizen"]
            self.assertEqual(len(citizen), 1)
            self.assertTrue(citizen[0]["required"])

    def test_module_entity_and_channels_are_filled_on_every_row(self):
        for row in self.rows:
            self.assertEqual(row["module"], "Complaints")
            self.assertEqual(row["entityType"], "COMPLAINT")
            self.assertEqual(row["channels"], ["SMS", "WHATSAPP", "EMAIL"])
            self.assertTrue(row["active"])
            self.assertTrue(row["label"])


class CommittedCatalogueTest(unittest.TestCase):
    def test_the_committed_catalogue_matches_the_workflow(self):
        """The no-drift gate. Regenerating must produce byte-identical output."""
        expected = nc.render(gen.build_catalogue(load_workflow()))
        self.assertTrue(os.path.exists(CATALOGUE), "the catalogue has never been generated")
        self.assertEqual(_read_text(CATALOGUE), expected,
                         "the committed NOTIFICATIONS.EventCatalogue.json is stale -- run "
                         "python3 local-setup/scripts/generate_event_catalogue.py")

    def test_the_check_mode_of_the_generator_agrees(self):
        self.assertEqual(gen.main(["--check"]), 0)

    def test_every_seeded_row_points_at_a_catalogued_event(self):
        known = {r["eventName"] for r in _read_json(CATALOGUE)}
        for name in ("NOTIFICATIONS.Routing", "NOTIFICATIONS.Template",
                     "NOTIFICATIONS.ProviderTemplate"):
            rows = _read_json(os.path.join(NEW_DIR, name + ".json"))
            unknown = sorted({r["eventName"] for r in rows} - known)
            self.assertEqual(unknown, [], "%s references events the catalogue does "
                                          "not declare" % name)

    def test_seeded_template_tokens_are_in_the_catalogue_vocabulary(self):
        vocabulary = {p["name"] for p in gen.PLACEHOLDERS}
        rows = _read_json(os.path.join(NEW_DIR, "NOTIFICATIONS.Template.json"))
        for row in rows:
            for token in row.get("placeholders") or []:
                self.assertIn(token, vocabulary,
                              "%s declares a token no event carries" % row["eventName"])


if __name__ == "__main__":
    unittest.main()
