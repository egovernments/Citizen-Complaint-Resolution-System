#!/usr/bin/env python3
"""The pure decisions in seed-notifications.py and migrate-notifications.py that decide
what a deploy or a migration WRITES — no DIGIT needed.

Kanav review of #2097:
  4079418103  a tenant with no MDMS notification rows was always "fresh", so an upgrade
              wrote the shipped defaults over tenants that ran 2.12's hard-coded path.
  4079418107  once any NOTIFICATIONS.Channel row existed the migration skipped the whole
              channel copy, so a half-finished copy (SMS landed, EMAIL failed) left EMAIL
              off for good while every re-run reported OK.

Run: python3 -m unittest local-setup/tests/test_notification_seed_decisions.py
"""
import importlib.util
import json
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SCRIPTS = os.path.join(REPO, "local-setup", "scripts")
CHANNEL_DEFAULTS = os.path.join(
    REPO, "utilities", "default-data-handler", "src", "main", "resources", "mdmsData-dev",
    "RAINMAKER-PGR", "RAINMAKER-PGR.NotificationChannel.json")
sys.path.insert(0, SCRIPTS)


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(SCRIPTS, filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sn = _load("seed_notifications_under_test", "seed-notifications.py")
mn = _load("migrate_notifications_under_test", "migrate-notifications.py")

LEGACY_CH, NEW_CH = sn.LEGACY_CHANNEL, sn.NEW_CHANNEL


def rec(data, is_active=True):
    return {"isActive": is_active, "data": data}


def channel(code, enabled=True, **extra):
    return dict({"code": code, "enabled": enabled, "active": True}, **extra)


def settings(allowlist=None):
    return {"allowlist": allowlist, "allowlist_source": "test",
            "allowlist_set": sn.parse_allowlist(allowlist), "sms_provider": "",
            "sms_provider_source": "test", "sms_direct": False, "default_locale": "en_IN"}


def empty_records():
    return {code: [] for code in mn.LEGACY_ALL + mn.NEW_ALL}


with open(CHANNEL_DEFAULTS, encoding="utf-8") as fh:
    DEFAULT_CHANNEL_ROWS = json.load(fh)


class FreshInstallEvidence(unittest.TestCase):
    """Only a counted ZERO (or the operator's explicit override) is a fresh install."""

    def test_zero_complaints_is_fresh(self):
        fresh, why = sn.fresh_install_evidence("0", None)
        self.assertTrue(fresh)
        self.assertIn("no complaint", why)

    def test_complaints_filed_is_not_fresh(self):
        fresh, why = sn.fresh_install_evidence("12", None)
        self.assertFalse(fresh)
        self.assertIn("12 complaint(s)", why)

    def test_unknown_count_is_never_read_as_zero(self):
        for raw in (None, "", "  ", "n/a", "-1", "3.0"):
            with self.subTest(raw=raw):
                fresh, why = sn.fresh_install_evidence(raw, None)
                self.assertFalse(fresh)
                self.assertIn("unknown", why)

    def test_adopt_defaults_is_an_explicit_override(self):
        self.assertTrue(sn.fresh_install_evidence("12", "1")[0])
        self.assertTrue(sn.fresh_install_evidence(None, "true")[0])
        self.assertFalse(sn.fresh_install_evidence("12", "0")[0])
        self.assertFalse(sn.fresh_install_evidence("12", "")[0])


class ChannelTarget(unittest.TestCase):
    def test_a_tenant_waiting_for_its_defaults_keeps_channel_rows_in_the_legacy_master(self):
        # Rows in NOTIFICATIONS.Channel would make the migration see it as `partial`.
        self.assertEqual(sn.channel_target([], [], "none"), LEGACY_CH)
        self.assertEqual(sn.channel_target([], [], "legacy"), LEGACY_CH)
        self.assertEqual(sn.channel_target([], [], "fresh"), NEW_CH)
        self.assertEqual(sn.channel_target([], [], "notifications"), NEW_CH)


class PlanChannelRows(unittest.TestCase):
    """migrate-notifications.py copies channel rows per CODE, never all-or-nothing."""

    def plan(self, legacy, new, allowlist=None):
        records = empty_records()
        records[LEGACY_CH], records[NEW_CH] = legacy, new
        return mn.plan_channel_rows(records, settings(allowlist), DEFAULT_CHANNEL_ROWS)

    def codes(self, plan):
        return [row["code"] for row, _ in plan["rows"]]

    def test_first_copy_takes_every_legacy_row(self):
        plan = self.plan([rec(channel("SMS")), rec(channel("EMAIL"))], [])
        self.assertEqual(self.codes(plan), ["SMS", "EMAIL"])
        self.assertEqual(plan["unfinished"], [])

    def test_a_half_finished_copy_is_finished(self):
        # SMS landed, EMAIL failed: NOTIFICATIONS.Channel now decides, and EMAIL is off.
        plan = self.plan([rec(channel("SMS")), rec(channel("EMAIL"))], [rec(channel("SMS"))])
        self.assertEqual(self.codes(plan), ["EMAIL"])
        self.assertEqual(plan["unfinished"], ["EMAIL"])
        self.assertIn("did not finish", plan["origin"])

    def test_a_finished_copy_plans_nothing(self):
        plan = self.plan([rec(channel("SMS")), rec(channel("EMAIL"))],
                         [rec(channel("SMS")), rec(channel("EMAIL", enabled=False))])
        self.assertEqual(plan["rows"], [])
        self.assertEqual(plan["unfinished"], [])

    def test_an_existing_row_is_never_rewritten_even_when_it_differs(self):
        plan = self.plan([rec(channel("SMS", enabled=True))], [rec(channel("SMS", enabled=False))])
        self.assertEqual(plan["rows"], [])

    def test_a_legacy_row_without_a_code_is_not_planned(self):
        plan = self.plan([rec(channel("")), rec(channel("SMS"))], [rec(channel("EMAIL"))])
        self.assertEqual(self.codes(plan), ["SMS"])

    def test_an_interrupted_allowlist_seed_is_finished_even_with_a_provider_pin(self):
        # migrate pins providers into the allowlist rows it creates; that pin must not
        # make the seed look operator-edited.
        plan = self.plan([], [rec(channel("SMS", provider="sms-primary"))], allowlist="SMS,EMAIL")
        self.assertEqual(sorted(self.codes(plan)), ["EMAIL", "WHATSAPP"])
        enabled = {row["code"]: row["enabled"] for row, _ in plan["rows"]}
        self.assertEqual(enabled, {"EMAIL": True, "WHATSAPP": False})
        self.assertEqual(sorted(plan["unfinished"]), ["EMAIL", "WHATSAPP"])

    def test_operator_rows_that_decide_are_left_alone(self):
        plan = self.plan([], [rec(channel("SMS", gateway="smscountry"))], allowlist="SMS,EMAIL")
        self.assertEqual(plan["rows"], [])
        self.assertEqual(plan["unfinished"], [])

    def test_unknown_allowlist_writes_nothing(self):
        self.assertEqual(self.plan([], [rec(channel("SMS"))])["rows"], [])
        self.assertEqual(self.plan([], [])["rows"], [])


class AnalysePartialChannelCopy(unittest.TestCase):
    """The whole plan for a tenant already served from NOTIFICATIONS.* whose channel copy
    stopped half way: it must be `partial` with EMAIL planned, not `migrated` with nothing."""

    def ctx(self):
        ctx = types.SimpleNamespace()
        ctx.args = types.SimpleNamespace(adopt_defaults=False)
        ctx.defaults = {}
        ctx.settings = settings("SMS,EMAIL")
        ctx.channel_defaults = DEFAULT_CHANNEL_ROWS
        ctx.integrations, ctx.integrations_error = None, "not read in a unit test"
        ctx.provider_plans, ctx.explicit_pins = [], {}
        return ctx

    def test_half_copied_channels_make_the_tenant_partial(self):
        event = "COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT"
        records = empty_records()
        records[mn.CATALOGUE] = [rec({"eventName": event, "active": True})]
        records[mn.ROUTING] = [rec({"eventName": event, "audience": "ACTOR:citizen",
                                    "channel": "SMS", "active": True})]
        records[LEGACY_CH] = [rec(channel("SMS")), rec(channel("EMAIL"))]
        records[NEW_CH] = [rec(channel("SMS"))]
        t = mn.analyse(self.ctx(), "mz", records, [], [{"eventName": event, "active": True}],
                       "the live PGR workflow at mz")
        self.assertEqual(t["category"], "partial")
        self.assertTrue(any("NOTIFICATIONS.Channel lacks EMAIL" in r for r in t["reasons"]))
        self.assertEqual([row["code"] for row in t["planned"][NEW_CH]], ["EMAIL"])
        self.assertEqual(t["channels"]["now"]["channels"]["EMAIL"]["enabled"], False)
        self.assertEqual(t["channels"]["after"]["channels"]["EMAIL"]["enabled"], True)
        self.assertTrue(any(n.startswith("EMAIL is off now and ON after apply") for n in t["notes"]))
        # The row already there still decides SMS after apply: the "after" view is the
        # existing rows PLUS the created ones, not the created ones alone.
        self.assertEqual(t["channels"]["after"]["channels"]["SMS"]["enabled"], True)
        self.assertFalse(any(n.startswith("SMS ") for n in t["notes"]))


class ProviderIdentifier(unittest.TestCase):
    """novu-bridge now refuses POST /providers (400 NB_INVALID_PROVIDER) when a caller-supplied
    identifier does not read back as its type; the migration must refuse it at plan time."""

    def test_type_from_identifier_mirrors_the_bridge(self):
        # ProviderCatalog.typeFromIdentifier: longest type first, case-insensitive, trimmed.
        cases = {
            "twilio-whatsapp-abc": "twilio-whatsapp",   # not twilio-sms, not twilio
            "twilio-sms-abc": "twilio-sms",
            "SMSCountry-Main": "smscountry",
            " ozeki ": "ozeki",
            "smtp-1": "smtp",
            "whatsapp-legacy": "twilio-whatsapp",       # the pre-catalog marker
            "twilio-smsx": None,                        # a prefix needs the dash
            "sms-primary": None,
            "": None,
            None: None,
        }
        for ident, expected in cases.items():
            with self.subTest(identifier=ident):
                self.assertEqual(mn.type_from_identifier(ident), expected)

    def plan(self, entry, integrations=()):
        import stat
        import tempfile
        fd, path = tempfile.mkstemp(suffix=".json")
        self.addCleanup(os.unlink, path)
        with os.fdopen(fd, "w") as fh:
            json.dump({"smscountry": entry}, fh)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        ctx = types.SimpleNamespace(integrations=list(integrations), integrations_error=None)
        args = types.SimpleNamespace(create_provider=["smscountry"], create_smscountry_provider=False,
                                     credentials_file=path)
        original = mn.catalog_required
        mn.catalog_required = lambda _ctx: dict(mn.CATALOG_REQUIRED)  # no bridge call in a unit test
        self.addCleanup(setattr, mn, "catalog_required", original)
        return mn.plan_provider_creation(ctx, args)

    CREDS = {"user": "u", "password": "p", "senderId": "S"}

    def test_a_prefixless_identifier_is_refused_before_any_write(self):
        with self.assertRaises(mn.RefuseToStart) as caught:
            self.plan({"name": "Main", "identifier": "sms-primary", "credentials": self.CREDS})
        self.assertIn("must start with 'smscountry-'", str(caught.exception))
        self.assertIn("NB_INVALID_PROVIDER", str(caught.exception))

    def test_an_identifier_of_another_type_is_refused(self):
        with self.assertRaises(mn.RefuseToStart) as caught:
            self.plan({"identifier": "ozeki-main", "credentials": self.CREDS})
        self.assertIn("reads as ozeki", str(caught.exception))

    def test_a_matching_or_derived_identifier_is_accepted(self):
        self.assertEqual(self.plan({"identifier": "smscountry-main", "credentials": self.CREDS})[0]["state"],
                         "create")
        derived = self.plan({"name": "Main", "credentials": self.CREDS})[0]["identifier"]
        self.assertTrue(derived.startswith("smscountry-"))

    def test_an_existing_provider_is_not_created_so_not_refused(self):
        plans = self.plan({"identifier": "sms-primary", "credentials": self.CREDS},
                          integrations=[{"identifier": "sms-primary", "active": True}])
        self.assertEqual(plans[0]["state"], "exists")


if __name__ == "__main__":
    unittest.main()
