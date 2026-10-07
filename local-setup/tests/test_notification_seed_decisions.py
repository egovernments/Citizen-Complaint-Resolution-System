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
            "jasmin-0011aabbccddeeff": "jasmin",
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

    def test_derive_type_reads_unmarked_native_gateways_but_not_generic_sms(self):
        # ProviderCatalog.deriveType: SMSCountry/Ozeki/Jasmin are native Novu providers now.
        for provider in ("smscountry", "ozeki", "jasmin"):
            with self.subTest(provider=provider):
                self.assertEqual(mn.derive_type({"providerId": provider, "channel": "sms"}), provider)
        self.assertIsNone(mn.derive_type({"providerId": "generic-sms", "channel": "sms"}))

    NO_WORKER = object()
    PRELOADING = {"NODE_OPTIONS": "--require /opt/digit-novu-providers/register.js"}

    def plan(self, entry, integrations=(), worker_env=PRELOADING, assume=False):
        import stat
        import tempfile
        fd, path = tempfile.mkstemp(suffix=".json")
        self.addCleanup(os.unlink, path)
        with os.fdopen(fd, "w") as fh:
            json.dump({"smscountry": entry}, fh)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        ctx = types.SimpleNamespace(integrations=list(integrations), integrations_error=None)
        args = types.SimpleNamespace(create_provider=["smscountry"], create_smscountry_provider=False,
                                     credentials_file=path, assume_worker_providers=assume,
                                     worker_container=None if worker_env is self.NO_WORKER else "novu-worker")
        original = mn.catalog_required
        mn.catalog_required = lambda _ctx: dict(mn.CATALOG_REQUIRED)  # no bridge call in a unit test
        self.addCleanup(setattr, mn, "catalog_required", original)
        original_env = mn.container_env
        mn.container_env = lambda _name: worker_env  # no docker call in a unit test
        self.addCleanup(setattr, mn, "container_env", original_env)
        return mn.plan_provider_creation(ctx, args)

    # The SMSCountry form is the Novu provider's credential keys.
    CREDS = {"user": "u", "password": "p", "from": "S"}

    def test_the_pre_native_smscountry_keys_are_refused_with_their_new_names(self):
        with self.assertRaises(mn.RefuseToStart) as caught:
            self.plan({"credentials": {"user": "u", "password": "p", "senderId": "S"}})
        self.assertIn("lack required key(s): from", str(caught.exception))
        self.assertIn("senderId is now from", str(caught.exception))

    def test_an_smscountry_provider_is_refused_while_the_worker_does_not_preload_our_providers(self):
        with self.assertRaises(mn.RefuseToStart) as caught:
            self.plan({"credentials": self.CREDS}, worker_env={"NODE_ENV": "local"})
        self.assertIn("does not preload them", str(caught.exception))
        self.assertIn("digit-novu-providers/register.js", str(caught.exception))

    def test_an_smscountry_provider_is_planned_when_the_worker_preloads_our_providers(self):
        plans = self.plan({"credentials": self.CREDS},
                          worker_env={"NODE_OPTIONS": "--require /opt/digit-novu-providers/register.js"})
        self.assertEqual(plans[0]["state"], "create")
        self.assertEqual(plans[0]["keys"], ["from", "password", "user"])

    # Kanav re-review 4118608374: the guard failed OPEN — docker absent, the container named
    # differently, or the script run from a laptop against a remote box, and a DIGIT provider was
    # created with no refusal and no warning.
    def test_an_smscountry_provider_is_refused_when_docker_cannot_tell(self):
        with self.assertRaises(mn.RefuseToStart) as caught:
            self.plan({"credentials": self.CREDS}, worker_env=None)
        self.assertIn("could not be inspected", str(caught.exception))
        self.assertIn("--assume-worker-providers", str(caught.exception))

    def test_an_smscountry_provider_is_refused_when_the_worker_check_is_turned_off(self):
        with self.assertRaises(mn.RefuseToStart) as caught:
            self.plan({"credentials": self.CREDS}, worker_env=self.NO_WORKER)
        self.assertIn("turned the check off", str(caught.exception))

    def test_the_operator_can_vouch_for_an_uncheckable_worker_and_is_warned(self):
        import contextlib
        import io
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            plans = self.plan({"credentials": self.CREDS}, worker_env=None, assume=True)
        self.assertEqual(plans[0]["state"], "create")
        self.assertIn("WARNING: worker not checked", err.getvalue())

    def test_vouching_never_overrides_a_worker_that_provably_does_not_preload(self):
        with self.assertRaises(mn.RefuseToStart) as caught:
            self.plan({"credentials": self.CREDS}, worker_env={"NODE_ENV": "local"}, assume=True)
        self.assertIn("does not preload them", str(caught.exception))

    def test_a_novu_native_provider_needs_no_worker_check(self):
        # twilio-sms is Novu's own provider: an uncheckable worker is irrelevant to it.
        ctx = types.SimpleNamespace(integrations=[], integrations_error=None)
        import stat
        import tempfile
        fd, path = tempfile.mkstemp(suffix=".json")
        self.addCleanup(os.unlink, path)
        with os.fdopen(fd, "w") as fh:
            json.dump({"twilio-sms": {"credentials": {k: "x" for k in mn.CATALOG_REQUIRED["twilio-sms"]}}}, fh)
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        args = types.SimpleNamespace(create_provider=["twilio-sms"], create_smscountry_provider=False,
                                     credentials_file=path, assume_worker_providers=False,
                                     worker_container="novu-worker")
        original = mn.catalog_required
        mn.catalog_required = lambda _ctx: dict(mn.CATALOG_REQUIRED)
        self.addCleanup(setattr, mn, "catalog_required", original)
        original_env = mn.container_env
        mn.container_env = lambda _name: None
        self.addCleanup(setattr, mn, "container_env", original_env)
        self.assertEqual(mn.plan_provider_creation(ctx, args)[0]["state"], "create")

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


class ProviderCreationRefused(unittest.TestCase):
    """Vinoth re-review 4141822040: novu-bridge lets a root's own admin plan/apply (and preview)
    it, but only an admin of a state that owns the providers may create one. A refusal must
    say so, and how to do it, before any tenant is written."""

    def setUp(self):
        self.calls = []
        original_call, original_env, original_login = mn.bridge_call, mn.container_env, mn.sn.LOGIN_TENANT
        self.addCleanup(setattr, mn, "bridge_call", original_call)
        self.addCleanup(setattr, mn, "container_env", original_env)
        self.addCleanup(setattr, mn.sn, "LOGIN_TENANT", original_login)
        mn.sn.LOGIN_TENANT = "pg"
        mn.container_env = lambda _name: {"NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT": "ke",
                                          "NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS": " mz, ke.bomet ,"}

    def ctx(self, answer):
        def call(_ctx, method, path, body=None, timeout=60):
            self.calls.append((method, path))
            return answer
        mn.bridge_call = call
        plans = [{"type": t, "channel": ch, "name": t, "identifier": t + "-main", "keys": [],
                  "state": "create", "_credentials": {}} for t, ch in (("smscountry", "SMS"), ("smtp", "EMAIL"))]
        args = types.SimpleNamespace(tenant=["pg"], bridge_container="novu-bridge")
        ctx = types.SimpleNamespace(integrations=[], provider_plans=plans, args=args)
        ctx.provider_owners = mn.provider_owners(args)
        return ctx

    REFUSED = (403, {"Errors": [{"code": "NB_TENANT_NOT_ALLOWED",
                                 "message": "only an admin of ke, mz may manage them"}]})

    def test_the_owners_are_read_from_the_running_bridge(self):
        self.assertEqual(mn.provider_owners(types.SimpleNamespace(bridge_container="novu-bridge")),
                         ["ke", "mz"])
        mn.container_env = lambda _name: None
        self.assertIsNone(mn.provider_owners(types.SimpleNamespace(bridge_container="novu-bridge")))

    def test_a_refusal_stops_at_the_first_provider_and_says_how(self):
        ctx = self.ctx(self.REFUSED)
        plans = mn.create_providers(ctx, ctx.provider_plans)
        self.assertEqual(len(self.calls), 1)  # the caller is refused: no second attempt
        self.assertEqual([p["state"] for p in plans], ["refused", "create"])
        help_text = plans[0]["help"]
        self.assertIn("403 NB_TENANT_NOT_ALLOWED", help_text)
        self.assertIn("only an admin of ke or mz may create one", help_text)
        self.assertIn("Nothing was written", help_text)
        self.assertIn("DIGIT_LOGIN_TENANT=ke migrate-notifications.py apply --tenant ke "
                      "--create-provider smscountry --create-provider smtp", help_text)
        self.assertIn("--provider <SMS|EMAIL|WHATSAPP>=<identifier>", help_text)
        self.assertIn("novu_bridge_provider_admin_tenants", help_text)

    def test_a_missing_admin_role_is_named_as_such(self):
        ctx = self.ctx((403, {"Errors": [{"code": "NB_ADMIN_ROLE_REQUIRED", "message": "x"}]}))
        plans = mn.create_providers(ctx, ctx.provider_plans)
        self.assertEqual(plans[0]["state"], "refused")
        self.assertIn("holds none of novu-bridge's admin roles", plans[0]["help"])

    def test_another_403_is_an_ordinary_failure(self):
        ctx = self.ctx((403, {"Errors": [{"code": "SOMETHING_ELSE"}]}))
        plans = mn.create_providers(ctx, ctx.provider_plans)
        self.assertEqual([p["state"] for p in plans], ["failed", "failed"])

    def test_apply_stops_before_any_tenant_is_read(self):
        import contextlib
        import io
        self.ctx(self.REFUSED)  # installs the refusing bridge_call
        patches = {
            "resolve_files": lambda ctx, args: None,
            "bridge_settings": lambda args: settings(),
            "read_integrations": lambda ctx: ([], None),
            "plan_provider_creation": lambda ctx, args: [
                {"type": "smscountry", "channel": "SMS", "name": "SMSCountry",
                 "identifier": "smscountry-main", "keys": ["user"], "state": "create",
                 "active": True, "_credentials": {"user": "u"}}],
            "discover": lambda ctx, args: self.fail("a tenant was read after the refusal"),
        }
        for name, fn in patches.items():
            self.addCleanup(setattr, mn, name, getattr(mn, name))
            setattr(mn, name, fn)
        self.addCleanup(setattr, mn.sn, "token", mn.sn.token)
        mn.sn.token = lambda: "tok"
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = mn.run(["apply", "--tenant", "pg", "--create-provider", "smscountry",
                         "--credentials-file", "/dev/null", "--yes", "--digit-url", "http://kong"])
        self.assertEqual(rc, 4)
        self.assertIn("WARNING: provider creation will be refused by novu-bridge", err.getvalue())  # said up front
        self.assertIn("REFUSED: provider creation refused by novu-bridge (403 NB_TENANT_NOT_ALLOWED", err.getvalue())
        self.assertIn("REFUSED to create smscountry", out.getvalue())

    def test_without_the_container_the_owners_are_described(self):
        mn.container_env = lambda _name: None
        ctx = self.ctx(self.REFUSED)
        help_text = mn.create_providers(ctx, ctx.provider_plans)[0]["help"]
        self.assertIn("NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT", help_text)
        self.assertIn("DIGIT_LOGIN_TENANT=<state_root>", help_text)


class SeederLogin(unittest.TestCase):
    """#1943 / Kanav re-review 4118608347: the deploy now seeds every state root that has
    complaints, each with its own login. A root where the admin does not exist must be a
    clear, per-root outcome (exit 4, NOTIF-LOGIN-REFUSED) the playbook can report and move on
    from — not a traceback that looks like any other crash."""

    def login_with(self, exc):
        import contextlib
        import io
        original = sn.token

        def refuse():
            raise exc
        sn.token = refuse
        self.addCleanup(setattr, sn, "token", original)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as caught:
            sn.login()
        return caught.exception.code, out.getvalue()

    def http_error(self, code):
        import urllib.error
        return urllib.error.HTTPError("http://kong/user/oauth/token", code, "x", {}, None)

    def test_a_refused_login_is_exit_4_with_a_marker(self):
        code, out = self.login_with(self.http_error(400))
        self.assertEqual(code, 4)
        self.assertIn("NOTIF-LOGIN-REFUSED:", out)
        self.assertNotIn("DONE", out)  # the playbook's success gate must not pass

    def test_a_gateway_that_is_down_is_not_a_refused_login(self):
        import urllib.error
        code, out = self.login_with(urllib.error.URLError("connection refused"))
        self.assertEqual(code, 2)
        self.assertIn("NOTIF-LOGIN-ERROR:", out)
        self.assertNotIn("NOTIF-LOGIN-REFUSED", out)

    def test_a_server_error_on_login_is_not_a_refused_login(self):
        code, out = self.login_with(self.http_error(502))
        self.assertEqual(code, 2)
        self.assertNotIn("NOTIF-LOGIN-REFUSED", out)


try:
    import jinja2
    import yaml
except ImportError:  # pragma: no cover
    jinja2 = yaml = None


@unittest.skipIf(jinja2 is None, "needs jinja2 + PyYAML (ansible's own dependencies)")
class ProviderOwnerNotes(unittest.TestCase):
    """Vinoth 4154544385: the note each ACTION line carries about who may create a provider
    (4141822040) was pasted into both ACTION tasks; it is one set_fact now, a dict root → note,
    rendered here the way ansible renders it."""

    @classmethod
    def setUpClass(cls):
        import ast
        with open(os.path.join(REPO, "local-setup", "ansible", "playbook-deploy.yml"), encoding="utf-8") as fh:
            tasks = [t for p in yaml.safe_load(fh) for t in p.get("tasks", []) or []]
        task = next(t for t in tasks if t.get("name") == "notif-seed — who may create a provider, per state root")
        cls.template = task["ansible.builtin.set_fact"]["notif_provider_owner_notes"]
        cls.literal = staticmethod(ast.literal_eval)

    def notes(self, roots, state_root=" ke ", extra=""):
        out = jinja2.Template(self.template).render(
            notif_seed_tenant=state_root, notif_seed_roots=roots, novu_bridge_provider_admin_tenants=extra)
        return self.literal(out)  # ansible turns the rendered dict back into one the same way

    def test_every_root_gets_a_note(self):
        self.assertEqual(set(self.notes(["ke", "pg", "mz"])), {"ke", "pg", "mz"})

    def test_state_root_owns_the_providers(self):
        note = self.notes(["ke", "pg"])["ke"]
        self.assertIn("Logged in at ke is right for plan/apply", note)
        self.assertIn("It also owns the providers, so --create-provider works in the same run.", note)
        self.assertNotIn("403", note)

    def test_another_root_is_told_who_may_create_one_and_how(self):
        note = self.notes(["ke", "pg"])["pg"]
        self.assertIn("is refused there (403 NB_TENANT_NOT_ALLOWED): only an admin of ke may create one.", note)
        self.assertIn("Create it as an admin of ke ", note)
        self.assertIn("`--provider SMS=<identifier>` logged in at pg", note)
        self.assertIn("or list pg in novu_bridge_provider_admin_tenants and redeploy.", note)
        self.assertNotIn("It also owns", note)

    def test_extra_admin_tenants_own_too_and_are_named(self):
        notes = self.notes(["ke", "pg", "mz"], extra=" mz, ,ke")
        self.assertIn("It also owns the providers", notes["mz"])
        self.assertIn("only an admin of ke or mz may create one.", notes["pg"])


if __name__ == "__main__":
    unittest.main()
