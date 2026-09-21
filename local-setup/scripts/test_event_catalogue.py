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
import re
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
# The PRODUCER. pgr-services renders nothing any more: it emits one thin event per
# workflow transition, and the placeholder values ride on it in two maps built here.
THIN_EVENT_BUILDER = os.path.join(ROOT, "backend", "pgr-services", "src", "main", "java",
                                  "org", "egov", "pgr", "service", "notification",
                                  "ThinEventBuilder.java")


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


# The two map-building methods of ThinEventBuilder, by the signature the extraction
# anchors on and the local variable each one writes through. Anchoring on BOTH is what
# keeps the neighbouring actors() and payload() maps out — payload() has a "status" key
# of its own, so a file-wide grep for put(..., "status") would be wrong.
PRODUCER_MAPS = (("data", "private Map<String, Object> data(", "data"),
                 ("localized", "private Map<String, Object> localized(", "localized"))

# Tokens no PGR message has ever gone without; the canaries that stop this test passing
# vacuously if the extraction ever matches nothing.
WELL_KNOWN_TOKENS = ("id", "complaint_type", "status", "emp_name", "download_link")


def _method_body(source, marker):
    """A method's body, brace-matched from its signature, or "" if it is not there."""
    start = source.find(marker)
    if start == -1:
        return ""
    open_brace = source.find("{", start)
    if open_brace == -1:
        return ""
    depth = 0
    for i in range(open_brace, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[open_brace:i + 1]
    return ""


def _map_keys(body, variable):
    """Keys written into `variable`, through either shape the builder uses: the
    null-skipping helper put(<var>, "name", value) and the direct <var>.put("name", …)."""
    pattern = re.compile(r'\b(?:put\(\s*%s\s*,\s*|%s\.put\(\s*)"([A-Za-z0-9_]+)"'
                         % (re.escape(variable), re.escape(variable)))
    return set(pattern.findall(body))


def producer_tokens(source):
    """Every token the producer can put on an event: data keys UNION localized keys.
    A token is fillable if it arrives as a literal OR as a localization code."""
    tokens = set()
    for _, marker, variable in PRODUCER_MAPS:
        tokens |= _map_keys(_method_body(source, marker), variable)
    return tokens


@unittest.skipUnless(os.path.exists(THIN_EVENT_BUILDER),
                     "pgr-services source is not in this checkout")
class ProducerParityTest(unittest.TestCase):
    """The generator's PLACEHOLDERS list is what every catalogue row advertises, so it
    must equal what pgr-services actually sends. The configurator asserts the same
    property from the TypeScript side (placeholderParity.test.ts); this is the Python
    half, so the GENERATOR cannot drift from the producer either — the list lives here,
    and a token added to the Java side with no entry here would otherwise ship a
    catalogue that hides a working placeholder."""

    def setUp(self):
        with open(THIN_EVENT_BUILDER, encoding="utf-8") as fh:
            self.source = fh.read()

    def test_the_producer_maps_are_still_where_the_extraction_looks(self):
        # Non-vacuity. If this fails, ThinEventBuilder moved or the maps are no longer
        # built from string-literal keys -- fix the extraction deliberately rather than
        # letting the parity assertion below pass on an empty set.
        for what, marker, variable in PRODUCER_MAPS:
            body = _method_body(self.source, marker)
            self.assertGreater(len(body), 200,
                               "%s(): %r no longer appears in ThinEventBuilder.java"
                               % (what, marker))
            self.assertGreater(len(_map_keys(body, variable)), 4,
                               "%s(): the key extraction matched nothing" % what)
        tokens = producer_tokens(self.source)
        self.assertGreaterEqual(len(tokens), 13)
        for token in WELL_KNOWN_TOKENS:
            self.assertIn(token, tokens,
                          "the producer no longer appears to send {%s}" % token)

    def test_the_generator_vocabulary_equals_what_the_producer_sends(self):
        self.assertEqual(sorted(p["name"] for p in gen.PLACEHOLDERS),
                         sorted(producer_tokens(self.source)),
                         "generate_event_catalogue.PLACEHOLDERS has drifted from "
                         "ThinEventBuilder's data/localized maps")

    def test_the_four_code_only_tokens_carry_no_literal(self):
        # The union is the contract; the SPLIT is the design. Moving one of these four
        # into `data` would keep the union intact while changing what survives a
        # localization outage, and every blankWhen note above assumes today's split.
        data_keys = _map_keys(_method_body(self.source, PRODUCER_MAPS[0][1]), "data")
        localized_keys = _map_keys(_method_body(self.source, PRODUCER_MAPS[1][1]),
                                   "localized")
        for token in ("ulb", "ao_designation", "emp_department", "emp_designation"):
            self.assertIn(token, localized_keys)
            self.assertNotIn(token, data_keys)
        for token in ("complaint_type", "status"):
            self.assertIn(token, data_keys)
            self.assertIn(token, localized_keys)


if __name__ == "__main__":
    unittest.main()
