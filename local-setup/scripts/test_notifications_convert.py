#!/usr/bin/env python3
"""Unit tests for the legacy -> NOTIFICATIONS.* converter.

    cd local-setup/scripts && python3 -m unittest

Stdlib only, on purpose: this runs in a CI job that installs nothing, and it also has
to be runnable on a deploy host next to seed-notifications.py, which imports the same
module to convert a LIVE tenant's rows.
"""
import json
import os
import unittest

import notifications_convert as nc

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RES = os.path.join(ROOT, "utilities", "default-data-handler", "src", "main", "resources")
LEGACY_DIR = os.path.join(RES, "mdmsData-dev", "RAINMAKER-PGR")
NEW_DIR = os.path.join(RES, "mdmsData-dev", "NOTIFICATIONS")


def _read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def routing(**kw):
    row = {"businessService": "PGR", "fromState": None, "action": "ASSIGN",
           "toState": "PENDINGATLME", "audience": "CITIZEN", "channel": "SMS",
           "active": True}
    row.update(kw)
    return row


def template(**kw):
    row = {"audience": "CITIZEN", "action": "ASSIGN", "toState": "PENDINGATLME",
           "channel": "SMS", "locale": "en_IN", "subject": None, "body": "hi {id}",
           "active": True}
    row.update(kw)
    return row


def provider_template(**kw):
    row = {"provider": "twilio", "channel": "WHATSAPP", "audience": "CITIZEN",
           "action": "ASSIGN", "toState": "PENDINGATLME", "locale": "en_IN",
           "templateId": "HX1", "templateName": "t1", "variables": ["id", "date"],
           "approvalStatus": "approved", "active": True}
    row.update(kw)
    return row


class EventNameTest(unittest.TestCase):
    def test_pgr_tuple_becomes_the_dotted_event_key(self):
        self.assertEqual(nc.event_name("PGR", "ASSIGN", "PENDINGATLME"),
                         "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME")

    def test_case_is_normalised_upwards(self):
        self.assertEqual(nc.event_name("pgr", "assign", "pendingatlme"),
                         "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME")

    def test_absent_business_service_defaults_to_pgr(self):
        self.assertEqual(nc.event_name(None, "APPLY", "PENDINGFORASSIGNMENT"),
                         "COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT")

    def test_an_unknown_business_service_keeps_its_rows(self):
        # Nobody has ever set one (the column has a single value in production), but a
        # tenant that did must not lose data to a KeyError.
        self.assertEqual(nc.event_name("TL", "APPROVE", "APPROVED"),
                         "TL.WORKFLOW.APPROVE.APPROVED")
        self.assertEqual(nc.module_for("TL"), "TL")

    def test_blank_action_or_state_is_an_error_not_a_guess(self):
        for bad in (("PGR", "", "X"), ("PGR", "APPLY", ""), ("PGR", None, None)):
            with self.assertRaises(nc.ConversionError):
                nc.event_name(*bad)


class AudienceFormTest(unittest.TestCase):
    def test_citizen_is_a_named_actor(self):
        self.assertEqual(nc.audience_ref("CITIZEN"), "ACTOR:citizen")

    def test_employee_is_the_assignee_actor(self):
        self.assertEqual(nc.audience_ref("EMPLOYEE"), "ACTOR:assignee")

    def test_a_bare_role_becomes_a_role_pool(self):
        self.assertEqual(nc.audience_ref("GRO"), "ROLE:GRO")
        self.assertEqual(nc.audience_ref("PGR_LME", assignee_only=False), "ROLE:PGR_LME")

    def test_assignee_only_becomes_the_pipe_chain(self):
        # The legacy semantics are "the named assignee, but fall through to the role
        # pool rather than notifying no one" -- which is exactly a chain, not ACTOR alone.
        self.assertEqual(nc.audience_ref("PGR_LME", assignee_only=True),
                         "ACTOR:assignee|ROLE:PGR_LME")

    def test_assignee_only_accepts_the_string_true_mdms_sometimes_stores(self):
        self.assertEqual(nc.audience_ref("GRO", assignee_only="true"),
                         "ACTOR:assignee|ROLE:GRO")

    def test_assignee_only_does_not_apply_to_the_named_actors(self):
        self.assertEqual(nc.audience_ref("CITIZEN", assignee_only=True), "ACTOR:citizen")
        self.assertEqual(nc.audience_ref("EMPLOYEE", assignee_only=True), "ACTOR:assignee")

    def test_non_notifiable_audiences_are_dropped(self):
        self.assertIsNone(nc.audience_ref("AUTO_ESCALATE"))
        self.assertIsNone(nc.audience_ref("SYSTEM"))
        self.assertIsNone(nc.audience_ref("system"))

    def test_already_scheme_qualified_forms_pass_through_untouched(self):
        for ref in ("ACTOR:assignee", "ROLE:GRO", "EVENT_RECIPIENTS",
                    "ACTOR:assignee|ROLE:PGR_LME", "EVENT_RECIPIENTS|ROLE:GRO"):
            self.assertEqual(nc.audience_ref(ref), ref)
            self.assertEqual(nc.audience_ref(ref, assignee_only=True), ref)

    def test_a_blank_audience_is_an_error(self):
        with self.assertRaises(nc.ConversionError):
            nc.audience_ref("")


class RoutingConversionTest(unittest.TestCase):
    def test_the_dropped_columns_are_gone_and_module_is_added(self):
        out = nc.convert_routing_row(routing(fromState="PENDINGFORASSIGNMENT"))
        self.assertEqual(out, {"module": "Complaints",
                               "eventName": "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME",
                               "audience": "ACTOR:citizen", "channel": "SMS",
                               "active": True})
        for gone in ("businessService", "fromState", "assigneeOnly", "action", "toState"):
            self.assertNotIn(gone, out)

    def test_a_non_notifiable_row_converts_to_nothing(self):
        self.assertIsNone(nc.convert_routing_row(routing(audience="AUTO_ESCALATE")))

    def test_inactive_rows_stay_inactive(self):
        self.assertFalse(nc.convert_routing_row(routing(active=False))["active"])

    def test_an_is_active_column_is_honoured_too(self):
        row = routing()
        row.pop("active")
        row["isActive"] = False
        self.assertFalse(nc.convert_routing_row(row)["active"])

    def test_a_row_with_no_active_column_defaults_to_active(self):
        row = routing()
        row.pop("active")
        self.assertTrue(nc.convert_routing_row(row)["active"])

    def test_reconverting_an_already_converted_row_is_a_no_op(self):
        once = nc.convert_routing_row(routing(audience="GRO", assigneeOnly=True))
        self.assertEqual(nc.convert_routing_row(once), once)
        self.assertEqual(nc.convert_routing_row(nc.convert_routing_row(once)), once)


class TemplateConversionTest(unittest.TestCase):
    def test_the_key_columns_collapse_into_event_name(self):
        out = nc.convert_template_row(template())
        self.assertEqual(out["eventName"], "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME")
        self.assertEqual(out["audience"], "ACTOR:citizen")
        self.assertEqual(out["module"], "Complaints")
        self.assertEqual(out["body"], "hi {id}")
        for gone in ("action", "toState"):
            self.assertNotIn(gone, out)

    def test_a_blank_locale_falls_back_to_the_default(self):
        self.assertEqual(nc.convert_template_row(template(locale=None))["locale"], "en_IN")
        self.assertEqual(nc.convert_template_row(template(locale="  "))["locale"], "en_IN")
        self.assertEqual(nc.convert_template_row(template(locale="sw_KE"))["locale"], "sw_KE")

    def test_a_blank_subject_is_stored_as_null_not_empty_string(self):
        self.assertIsNone(nc.convert_template_row(template(subject=""))["subject"])
        self.assertEqual(nc.convert_template_row(template(subject="Hi"))["subject"], "Hi")

    def test_declared_placeholders_survive(self):
        out = nc.convert_template_row(template(placeholders=["id", "date"]))
        self.assertEqual(out["placeholders"], ["id", "date"])

    def test_inactive_templates_stay_inactive(self):
        self.assertFalse(nc.convert_template_row(template(active=False))["active"])

    def test_reconversion_is_a_no_op(self):
        once = nc.convert_template_row(template(audience="GRO"))
        self.assertEqual(nc.convert_template_row(once), once)

    def test_a_template_reuses_the_audience_string_routing_produced(self):
        # THE JOIN HAZARD: routing has assigneeOnly, the template does not. Converted
        # independently the two would end up with ACTOR:assignee|ROLE:GRO and ROLE:GRO
        # and the routing row would find no template -- a silent misfire.
        index = nc.build_audience_index([routing(audience="GRO", assigneeOnly=True)])
        out = nc.convert_template_row(template(audience="GRO"), index)
        self.assertEqual(out["audience"], "ACTOR:assignee|ROLE:GRO")

    def test_the_channel_qualified_mapping_wins_when_channels_disagree(self):
        index = nc.build_audience_index([
            routing(audience="GRO", channel="SMS", assigneeOnly=True),
            routing(audience="GRO", channel="EMAIL", assigneeOnly=False),
        ])
        self.assertEqual(nc.convert_template_row(template(audience="GRO", channel="SMS"),
                                                 index)["audience"],
                         "ACTOR:assignee|ROLE:GRO")
        self.assertEqual(nc.convert_template_row(template(audience="GRO", channel="EMAIL"),
                                                 index)["audience"],
                         "ROLE:GRO")

    def test_an_orphan_template_still_converts_with_the_bare_mapping(self):
        # A template with no routing row is a warning in the Configurator, not an
        # error, and must not be lost by the copy.
        index = nc.build_audience_index([])
        self.assertEqual(nc.convert_template_row(template(audience="GRO"), index)["audience"],
                         "ROLE:GRO")


class ProviderTemplateConversionTest(unittest.TestCase):
    def test_provider_and_template_id_survive_and_the_key_collapses(self):
        out = nc.convert_provider_template_row(provider_template())
        self.assertEqual(out, {"provider": "twilio", "channel": "WHATSAPP",
                               "eventName": "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME",
                               "audience": "ACTOR:citizen", "locale": "en_IN",
                               "templateId": "HX1", "variables": ["id", "date"],
                               "active": True, "templateName": "t1",
                               "approvalStatus": "approved"})

    def test_ordered_variables_keep_their_order(self):
        out = nc.convert_provider_template_row(
            provider_template(variables=["complaint_type", "id", "date"]))
        self.assertEqual(out["variables"], ["complaint_type", "id", "date"])

    def test_optional_provider_columns_are_omitted_when_blank(self):
        out = nc.convert_provider_template_row(
            provider_template(templateName="", approvalStatus=None))
        self.assertNotIn("templateName", out)
        self.assertNotIn("approvalStatus", out)

    def test_a_blank_locale_falls_back(self):
        self.assertEqual(
            nc.convert_provider_template_row(provider_template(locale=""))["locale"], "en_IN")

    def test_it_follows_the_same_audience_index_as_templates(self):
        index = nc.build_audience_index([
            routing(audience="GRO", channel="WHATSAPP", assigneeOnly=True)])
        out = nc.convert_provider_template_row(provider_template(audience="GRO"), index)
        self.assertEqual(out["audience"], "ACTOR:assignee|ROLE:GRO")

    def test_reconversion_is_a_no_op(self):
        once = nc.convert_provider_template_row(provider_template())
        self.assertEqual(nc.convert_provider_template_row(once), once)


class ChannelConversionTest(unittest.TestCase):
    def test_the_shape_is_unchanged_only_the_namespace_moves(self):
        row = {"code": "SMS", "enabled": True, "gateway": "smscountry",
               "senderId": "EGOVS", "provider": None, "active": True}
        self.assertEqual(nc.convert_channel_row(row), row)

    def test_a_cleared_optional_stays_null(self):
        out = nc.convert_channel_row({"code": "EMAIL", "enabled": False, "provider": None})
        self.assertIsNone(out["provider"])
        self.assertTrue(out["active"])

    def test_reconversion_is_a_no_op(self):
        once = nc.convert_channel_row({"code": "WHATSAPP", "enabled": True,
                                       "gateway": "novu", "senderId": None,
                                       "provider": "twilio", "active": True})
        self.assertEqual(nc.convert_channel_row(once), once)


class ConvertAllTest(unittest.TestCase):
    def test_the_whole_bundle_converts_and_reports_what_it_dropped(self):
        legacy = {
            "RAINMAKER-PGR.NotificationRouting": [
                routing(),
                routing(audience="SYSTEM"),
                routing(audience="", action=""),
            ],
            "RAINMAKER-PGR.NotificationTemplate": [template()],
            "RAINMAKER-PGR.NotificationChannel": [{"code": "SMS", "enabled": True}],
        }
        converted, dropped = nc.convert_all(legacy)
        self.assertEqual(len(converted["NOTIFICATIONS.Routing"]), 1)
        self.assertEqual(len(dropped["NOTIFICATIONS.Routing"]), 2)
        self.assertEqual(len(converted["NOTIFICATIONS.Template"]), 1)
        self.assertEqual(len(converted["NOTIFICATIONS.Channel"]), 1)
        self.assertNotIn("NOTIFICATIONS.ProviderTemplate", converted)

    def test_converting_the_output_again_changes_nothing(self):
        # The idempotency proof for the live copy: seed-notifications.py runs the same
        # convert_all over whatever it reads, and a second deploy must not mint variants.
        legacy = {
            "RAINMAKER-PGR.NotificationRouting": [routing(audience="GRO", assigneeOnly=True)],
            "RAINMAKER-PGR.NotificationTemplate": [template(audience="GRO")],
            "RAINMAKER-PGR.NotificationProviderTemplate": [provider_template(audience="GRO")],
            "RAINMAKER-PGR.NotificationChannel": [{"code": "SMS", "enabled": True}],
        }
        once, _ = nc.convert_all(legacy)
        again, _ = nc.convert_all({
            legacy_code: once[nc.LEGACY_TO_NEW_CODE[legacy_code]] for legacy_code in legacy})
        self.assertEqual(again, once)


class CommittedDefaultsTest(unittest.TestCase):
    """The committed NOTIFICATIONS/*.json must be exactly what the converter produces
    from the committed RAINMAKER-PGR seed. Without this, someone edits one namespace,
    the two drift, and a fresh tenant gets two different sets of messages."""

    def test_the_generated_default_files_are_up_to_date(self):
        stale = []
        for path, text in nc.generate(LEGACY_DIR, NEW_DIR, write=False).items():
            current = _read_text(path) if os.path.exists(path) else None
            if current != text:
                stale.append(os.path.basename(path))
        self.assertEqual(stale, [], "stale generated data: run "
                                    "python3 local-setup/scripts/notifications_convert.py")

    def test_the_row_counts_match_the_legacy_seed(self):
        for legacy_code, new_code in nc.LEGACY_TO_NEW_CODE.items():
            legacy = _read_json(os.path.join(LEGACY_DIR, legacy_code + ".json"))
            new = _read_json(os.path.join(NEW_DIR, new_code + ".json"))
            self.assertEqual(len(new), len(legacy),
                             "%s lost or gained rows against %s" % (new_code, legacy_code))

    def test_no_generated_row_still_speaks_the_legacy_vocabulary(self):
        for new_code in nc.LEGACY_TO_NEW_CODE.values():
            rows = _read_json(os.path.join(NEW_DIR, new_code + ".json"))
            for row in rows:
                for gone in ("action", "toState", "fromState", "businessService",
                             "assigneeOnly"):
                    self.assertNotIn(gone, row, "%s still carries %s" % (new_code, gone))

    def test_every_routing_row_has_a_template_on_the_same_key(self):
        rt = _read_json(os.path.join(NEW_DIR, "NOTIFICATIONS.Routing.json"))
        tpl = _read_json(os.path.join(NEW_DIR, "NOTIFICATIONS.Template.json"))
        keys = {(t["eventName"], t["audience"], t["channel"]) for t in tpl}
        missing = sorted({(r["eventName"], r["audience"], r["channel"]) for r in rt} - keys)
        self.assertEqual(missing, [], "routing rows with no template would misfire live")

    def test_every_generated_row_fits_its_schema(self):
        """additionalProperties:false means an unknown column is a 400 on create, and
        a missing `required` column is a 400 too. Checked without jsonschema so this
        runs on a deploy host and in a CI job that installs nothing."""
        schema_path = os.path.join(RES, "schema", "NOTIFICATIONS.json")
        schemas = {s["code"]: s["definition"] for s in _read_json(schema_path)}
        for code, definition in schemas.items():
            self.assertFalse(definition.get("additionalProperties", True),
                             "%s must be additionalProperties:false" % code)
            self.assertNotIn("x-ref-schema", definition,
                             "%s authors an x-ref-schema; an empty one is mangled to {} "
                             "on storage and then throws on every data create" % code)
            allowed = set(definition["properties"])
            required = set(definition.get("required") or [])
            for row in _read_json(os.path.join(NEW_DIR, code + ".json")):
                extra = sorted(set(row) - allowed)
                self.assertEqual(extra, [], "%s row has columns the schema rejects: %s"
                                            % (code, extra))
                missing = sorted(required - set(row))
                self.assertEqual(missing, [], "%s row is missing required columns: %s"
                                              % (code, missing))

    def test_the_uniqueness_keys_hold_on_the_generated_data(self):
        for new_code, key in (("NOTIFICATIONS.Routing", ("eventName", "audience", "channel")),
                              ("NOTIFICATIONS.Template",
                               ("eventName", "audience", "channel", "locale")),
                              ("NOTIFICATIONS.ProviderTemplate",
                               ("provider", "channel", "eventName", "audience", "locale")),
                              ("NOTIFICATIONS.Channel", ("code",))):
            rows = _read_json(os.path.join(NEW_DIR, new_code + ".json"))
            seen = [tuple(r[k] for k in key) for r in rows]
            self.assertEqual(len(seen), len(set(seen)),
                             "%s has rows that collide on x-unique %s" % (new_code, key))


if __name__ == "__main__":
    unittest.main()
