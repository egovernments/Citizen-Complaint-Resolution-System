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


class SeederAccessToken(unittest.TestCase):
    """Field finding (dev deployment, 2026-10-07): a self-serve workspace's founder signs in through
    Keycloak only and has no DIGIT password, so the seeder and the migration (username/password
    only) could not run for that workspace. DIGIT_ACCESS_TOKEN replaces the login.

    Review of #2342: the token was checked with an MDMS search, which Kong treats as auth-optional:
    it forwards a request whose token it rejects ANONYMOUSLY, so a dead token answered 200 and the
    run went on reading anonymously. The fake gateway below answers the way Kong does
    (local-setup/kong/kong.yml AUTH_OPTIONAL + auth enrichment), so a check through an auth-optional
    path cannot pass these tests."""

    TOKEN = "f0unders-access-t0ken"
    # Kong's AUTH_OPTIONAL paths this script reads (a rejected token is dropped, the call goes on).
    AUTH_OPTIONAL = ("/mdms-v2/v2/_search", "/mdms-v2/schema/v1/_search")

    def setUp(self):
        import urllib.error
        self.calls = []
        self.token_valid = True
        self.answer = None          # an exception the gateway raises for every call
        self.details_body = None    # what /user/_details answers a valid token with
        originals = {name: getattr(sn, name) for name in ("ACCESS_TOKEN", "TENANT", "_post")}
        for name, value in originals.items():
            self.addCleanup(setattr, sn, name, value)
        sn.ACCESS_TOKEN = self.TOKEN
        sn.TENANT = "kworkspace"

        def post(path, body, tok=None, headers=None):
            import io
            self.calls.append((path, body))
            if self.answer is not None:
                raise self.answer
            endpoint = path.split("?", 1)[0]
            if endpoint in self.AUTH_OPTIONAL:
                # Kong: a token egov-user rejects is ignored here and the request goes on anonymously.
                return io.BytesIO(b'{"mdms": []}')
            body_token = ((body or {}).get("RequestInfo") or {}).get("authToken")
            if not body_token:
                raise self.http_error(401, path)          # a protected POST without a body token
            if not self.token_valid:
                raise self.http_error(401, path)          # Kong resolves the token first: InvalidAccessTokenException
            if self.details_body is not None:
                return io.BytesIO(self.details_body)
            return io.BytesIO(b'{"uuid": "3f0c", "userName": "FOUNDER_1", "type": "EMPLOYEE", "roles": []}')
        sn._post = post
        self.http_error = lambda code, path="/user/_details", body=b"x": urllib.error.HTTPError(
            "http://kong" + path, code, "x", {}, __import__("io").BytesIO(body))

    def login(self):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            try:
                return sn.login(), None, out.getvalue()
            except SystemExit as exc:
                return None, exc.code, out.getvalue()

    def test_the_token_is_checked_by_egov_user_introspection_never_a_password_login(self):
        import urllib.parse
        tok, code, _ = self.login()
        self.assertEqual(tok, self.TOKEN)
        self.assertIsNone(code)
        self.assertEqual(len(self.calls), 1)
        path, body = self.calls[0]
        endpoint, query = path.split("?", 1)
        self.assertEqual(endpoint, "/user/_details")
        self.assertNotIn(endpoint, self.AUTH_OPTIONAL)
        self.assertEqual(urllib.parse.parse_qs(query)["access_token"], [self.TOKEN])
        self.assertEqual(body["RequestInfo"]["authToken"], self.TOKEN, "Kong refuses a protected POST without it")

    def test_a_refused_token_is_exit_4_and_the_token_is_never_printed(self):
        self.token_valid = False
        tok, code, out = self.login()
        self.assertEqual(code, 4, "an auth-optional check would have answered 200 here")
        self.assertIn("NOTIF-LOGIN-REFUSED:", out)
        self.assertIn("DIGIT_ACCESS_TOKEN", out)
        self.assertNotIn(self.TOKEN, out)

    def test_every_way_egov_user_refuses_is_exit_4(self):
        cases = {
            "403": self.http_error(403),
            "400 InvalidAccessTokenException": self.http_error(
                400, body=b'{"Errors":[{"code":"InvalidAccessTokenException"}]}'),
        }
        for name, error in cases.items():
            with self.subTest(name):
                self.answer = error
                tok, code, out = self.login()
                self.assertEqual(code, 4)
                self.assertIn("NOTIF-LOGIN-REFUSED:", out)
                self.assertNotIn(self.TOKEN, out)
        self.answer = None
        for name, body in {"no user": b"{}", "an anonymous search answer": b'{"mdms": []}', "not JSON": b"<html>"}.items():
            with self.subTest(name):
                self.details_body = body
                tok, code, out = self.login()
                self.assertEqual(code, 4, "a 200 that names no user is no user")
                self.assertIn("NOTIF-LOGIN-REFUSED:", out)
                self.assertNotIn(self.TOKEN, out)

    def test_a_server_error_on_the_check_is_not_a_refused_token(self):
        for status, body in ((502, b"x"), (400, b'{"Errors":[{"code":"SOMETHING_ELSE"}]}')):
            with self.subTest(status=status):
                self.answer = self.http_error(status, body=body)
                tok, code, out = self.login()
                self.assertEqual(code, 2)
                self.assertIn("NOTIF-LOGIN-ERROR:", out)
                self.assertIn("/user/_details", out)
                self.assertNotIn("NOTIF-LOGIN-REFUSED", out)
                self.assertNotIn(self.TOKEN, out)

    def test_who_names_the_token_not_a_user(self):
        self.assertEqual(sn.who(), "the supplied DIGIT_ACCESS_TOKEN")
        sn.ACCESS_TOKEN = ""
        self.assertNotIn("TOKEN", sn.who())

    def _migrate_plan(self):
        import contextlib
        import io
        # migrate-notifications.py loads its own copy of the seeder module.
        for name in ("ACCESS_TOKEN", "_post", "URL", "LOGIN_TENANT"):
            self.addCleanup(setattr, mn.sn, name, getattr(mn.sn, name))
        mn.sn._post = sn._post
        env = {"DIGIT_ACCESS_TOKEN": self.TOKEN, "DIGIT_URL": "http://kong"}
        saved = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        for k, v in saved.items():
            self.addCleanup(lambda k=k, v=v: os.environ.__setitem__(k, v) if v is not None else os.environ.pop(k, None))
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = mn.run(["plan", "--tenant", "kworkspace", "--bridge-container", "", "--worker-container", ""])
        return rc, err.getvalue()

    def test_the_migration_takes_the_same_token_and_refuses_a_bad_one_before_reading(self):
        self.token_valid = False
        rc, err = self._migrate_plan()
        self.assertEqual(rc, 4)
        self.assertIn("DIGIT_ACCESS_TOKEN was refused (HTTP 401)", err)
        self.assertNotIn(self.TOKEN, err)
        self.assertEqual([path.split("?", 1)[0] for path, _ in self.calls], ["/user/_details"],
                         "nothing but the token check was read")

    def test_the_migration_refuses_a_check_answered_without_a_user(self):
        self.details_body = b"{}"
        rc, err = self._migrate_plan()
        self.assertEqual(rc, 4)
        self.assertIn("DIGIT_ACCESS_TOKEN was refused (HTTP 200 without a user)", err)
        self.assertEqual([path.split("?", 1)[0] for path, _ in self.calls], ["/user/_details"])


try:
    import jinja2
    import yaml
except ImportError:  # pragma: no cover
    # CI installs both (local-setup-ci.yaml, config-contracts): there a missing one must fail the
    # run, not quietly skip the playbook-render cases below.
    if os.environ.get("CI"):
        raise
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


def action(aid, url):
    return {"id": aid, "url": url, "name": "x", "enabled": True}


FIXED = [a[0] for a in sn.NOTIF_ACTIONS]
URLS = [a[1] for a in sn.NOTIF_ACTIONS]
FLOOR = sn.RELOCATED_ACTION_ID_FLOOR
FULL_DUMP = os.path.join(REPO, "local-setup", "db", "full-dump.sql")
PLATFORM_BASELINE = os.path.join(REPO, "backend", "pgr-services", "src", "main", "resources",
                                 "onboarding", "platform-baseline-v1.json")
DDH_ACTIONS = os.path.join(REPO, "utilities", "default-data-handler", "src", "main", "resources",
                           "mdmsData", "ACCESSCONTROL-ACTIONS-TEST",
                           "ACCESSCONTROL-ACTIONS-TEST.actions-test.json")


def dump_rows(schema, tenant):
    """The data of every full-dump.sql eg_mdms_data row of `schema` at `tenant`."""
    out, columns = [], None
    with open(FULL_DUMP, encoding="utf-8") as fh:
        for line in fh:
            if columns is None:
                if line.startswith("COPY public.eg_mdms_data ("):
                    columns = [c.strip() for c in line.split("(", 1)[1].split(")", 1)[0].split(",")]
                continue
            if line.startswith("\\."):
                break
            row = dict(zip(columns, line.rstrip("\n").split("\t")))
            if row.get("schemacode") == schema and row.get("tenantid") == tenant:
                out.append(json.loads(row["data"]))
    return out


def baseline_actions():
    with open(PLATFORM_BASELINE, encoding="utf-8") as fh:
        return {int(r["data"]["id"]): r["data"]["url"] for r in json.load(fh)["records"]
                if r["schemaCode"] == sn.ACTION_SCHEMA}


class NotificationActionIds(unittest.TestCase):
    """bomet `ke`, deploy of 2026-10-19: the tenant's own actions-test table already used
    4623-4640 for other URLs (pgr-services analytics, ACCESSCONTROL-ACTIONS, ...). Creating
    the notification actions there came back DUPLICATE, the role-actions were granted to the
    other URLs, and every NOTIFICATIONS.* write stayed 403, so the tenant could not be
    migrated."""

    # The shape of bomet ke: every fixed id (and one past them) held by another URL, plus
    # the high ids pgr-services' onboarding uses. Its highest id was 901000.
    BOMET_KE = [(action(aid, "/pgr-services/other/%d" % aid), True) for aid in range(4620, 4641)] + [
        (action(900000, "/pgr-services/v2/onboarding/workspaces/_search"), True),
        (action(901000, "/pgr-services/v2/onboarding/workspaces/_rename"), True)]

    def test_a_fresh_tenant_gets_the_fixed_ids(self):
        self.assertEqual(sn.plan_notif_actions([]), [(aid, aid, True, None) for aid in FIXED])

    def test_a_seeded_tenant_creates_nothing(self):
        seeded = [(action(aid, url), True) for aid, url in zip(FIXED, URLS)]
        self.assertEqual(sn.plan_notif_actions(seeded), [(aid, aid, False, None) for aid in FIXED])

    def test_an_id_held_by_another_url_moves_to_a_free_id(self):
        plan = sn.plan_notif_actions(self.BOMET_KE)
        self.assertEqual([p[1] for p in plan], list(range(FLOOR + 1, FLOOR + 1 + len(FIXED))))
        self.assertTrue(all(p[2] for p in plan), "each one is created")
        self.assertEqual([p[3] for p in plan], ["/pgr-services/other/%d" % aid for aid in FIXED])

    def test_the_next_free_id_never_takes_a_fixed_id(self):
        # Only 4623 collides, and the tenant's highest id is below the fixed range: the moved
        # action must not land on 4624-4639, which the rows after it still need.
        plan = sn.plan_notif_actions([(action(4623, "/elsewhere"), True)])
        self.assertEqual(plan[0], (4623, FLOOR + 1, True, "/elsewhere"))
        self.assertEqual(plan[1:], [(aid, aid, True, None) for aid in FIXED[1:]])

    def test_a_moved_id_never_takes_a_platform_baseline_id(self):
        # The platform baseline creates its actions by fixed id at state_root on every deploy
        # (digit-mcp's tenant bootstrap) and skips one whose id is taken, then grants its
        # roles to it. "Above the tenant's highest id" put bomet ke's actions on 901001-901017
        # (its highest was 901000): the baseline's cache-bust, ComplaintHierarchy, ... ids.
        baseline = baseline_actions()
        partial = [(action(aid, url), True) for aid, url in baseline.items() if aid <= 901000]
        full = [(action(aid, url), True) for aid, url in baseline.items()]
        for label, tenant in (("highest id 901000, as bomet ke", partial),
                              ("the whole baseline already applied", full)):
            colliding = [(action(aid, "/tenant/own/%d" % aid), True) for aid in FIXED]
            moved = [p[1] for p in sn.plan_notif_actions(tenant + colliding)]
            self.assertFalse(set(moved) & set(baseline), label)
            self.assertTrue(all(aid > FLOOR for aid in moved), label)

    def test_every_fixed_id_seed_stays_below_the_relocation_floor(self):
        # The floor is only safe while no seed that writes actions by fixed id reaches it.
        with open(DDH_ACTIONS, encoding="utf-8") as fh:
            ddh = [int(a["id"]) for a in json.load(fh)]
        dump = [int(a["id"]) for a in dump_rows(sn.ACTION_SCHEMA, "pg") if str(a.get("id")).isdigit()]
        for label, ids in (("platform baseline", list(baseline_actions())), ("full-dump.sql", dump),
                           ("default-data-handler", ddh), ("NOTIF_ACTIONS", FIXED)):
            self.assertTrue(ids, label)
            self.assertLess(max(ids), FLOOR, "%s reaches RELOCATED_ACTION_ID_FLOOR" % label)

    def test_a_url_already_held_at_another_id_is_reused(self):
        url = "/mdms-v2/v2/_create/NOTIFICATIONS.Routing"
        fixed = FIXED[URLS.index(url)]
        plan = sn.plan_notif_actions(self.BOMET_KE + [(action(777, url), True)])
        self.assertEqual(plan[URLS.index(url)], (fixed, 777, False, None))

    def test_an_active_action_wins_over_an_inactive_one(self):
        url = URLS[0]
        plan = sn.plan_notif_actions([(action(FIXED[0], url), False), (action(800, url), True)])
        self.assertEqual(plan[0], (FIXED[0], 800, False, None))
        plan = sn.plan_notif_actions([(action(900, url), False), (action(FIXED[0], url), False)])
        self.assertEqual(plan[0], (FIXED[0], FIXED[0], False, None), "then the fixed id")

    def seed(self, existing, hidden_ids=(), failures=0):
        """seed_access_control against a fake MDMS holding `existing` actions (plus
        `hidden_ids`, rows its search does not return); returns the rows it asked MDMS to
        create and what it printed."""
        import contextlib
        import io
        writes = []

        def create_row(_tok, code, row, is_active=None, tenant=None):
            if code == sn.ACTION_SCHEMA and row["id"] in hidden_ids:
                return "dup"
            writes.append((code, dict(row)))
            return "created"

        patches = {"TENANT": "ke", "find_schema": lambda _tok, _code, tenant=None: {},
                   "tenant_roles": lambda _tok, tenant=None: {"MDMS_ADMIN", "ACCOUNT_ADMIN", "SUPERUSER",
                                                              "CSR", "GRO", "PGR_LME"},
                   "search_rows": lambda _tok, code, tenant=None: [rec(d, a) for d, a in existing],
                   "create_row": create_row}
        for name, value in patches.items():
            self.addCleanup(setattr, sn, name, getattr(sn, name))
            setattr(sn, name, value)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            _created, _dup, failed = sn.seed_access_control("tok")
        self.assertEqual(failed, failures)
        actions = {row["id"]: row["url"] for code, row in writes if code == sn.ACTION_SCHEMA}
        grants = [(row["rolecode"], row["actionid"]) for code, row in writes if code == sn.ROLEACTION_SCHEMA]
        return actions, grants, out.getvalue()

    def test_grants_follow_the_url_on_a_colliding_tenant(self):
        actions, grants, out = self.seed(self.BOMET_KE)
        self.assertEqual(sorted(actions.values()), sorted(URLS), "every notification URL is created")
        self.assertFalse(set(actions) & set(FIXED), "never at an id another URL holds")
        self.assertFalse([g for g in grants if g[1] in FIXED], "no grant on another URL's action")
        self.assertEqual({aid for _role, aid in grants}, set(actions))
        self.assertEqual(out.count("ACL-ID-COLLISION"), len(FIXED))
        self.assertIn("ACL-ID-COLLISION: action 4630 is /pgr-services/other/4630 at ke, not "
                      "/mdms-v2/v2/_create/NOTIFICATIONS.Routing — creating it as action", out)

    def test_an_id_the_search_missed_gets_no_grant(self):
        # mdms-v2's search drops some inactive rows (45 of 254 on bomet ke). If the free id
        # turns out to be taken, its row's URL is unknown: grant nothing there, fail the phase.
        actions, grants, out = self.seed(self.BOMET_KE, hidden_ids={FLOOR + 1}, failures=1)
        self.assertNotIn(FLOOR + 1, {aid for _role, aid in grants})
        self.assertNotIn(FLOOR + 1, actions)
        self.assertIn("ACL-ID-TAKEN: action id %d at ke was not free" % (FLOOR + 1), out)
        self.assertEqual(len(actions), len(FIXED) - 1, "the other actions still land")

    def test_a_fresh_tenant_is_seeded_exactly_as_the_dump(self):
        # Dump-seeded and script-seeded tenants must agree, or a dump-seeded tenant would read
        # as colliding with itself. The dump's `pg` is the reference.
        dump_actions = {int(a["id"]): a["url"] for a in dump_rows(sn.ACTION_SCHEMA, "pg")
                        if str(a.get("id")).isdigit() and int(a["id"]) in FIXED}
        dump_grants = sorted((g["rolecode"], int(g["actionid"])) for g in dump_rows(sn.ROLEACTION_SCHEMA, "pg")
                             if str(g.get("actionid")).isdigit() and int(g["actionid"]) in FIXED)
        actions, grants, out = self.seed([])
        self.assertEqual(actions, dump_actions)
        self.assertEqual(sorted(grants), dump_grants)
        self.assertNotIn("ACL-ID-COLLISION", out)

    def test_a_seeded_tenant_only_re_asserts_its_grants(self):
        actions, grants, out = self.seed([(action(aid, url), True) for aid, url in zip(FIXED, URLS)])
        self.assertEqual(actions, {}, "no action is created again")
        self.assertEqual({aid for _role, aid in grants}, set(FIXED))
        self.assertNotIn("ACL-ACTION-INACTIVE", out)

    def test_an_inactive_action_is_kept_and_named(self):
        # Re-creating it active would undo whoever deactivated it, so its grants go to it as
        # before; but the 403s that follow must not read as a missing MDMS_ADMIN.
        seeded = [(action(aid, url), aid != FIXED[0]) for aid, url in zip(FIXED, URLS)]
        actions, grants, out = self.seed(seeded)
        self.assertEqual(actions, {}, "nothing is created for it")
        self.assertIn(FIXED[0], {aid for _role, aid in grants})
        self.assertEqual(out.count("ACL-ACTION-INACTIVE"), 1)
        self.assertIn("ACL-ACTION-INACTIVE: %s is action %d at ke and it is INACTIVE" % (URLS[0], FIXED[0]), out)

    @unittest.skipIf(jinja2 is None, "needs jinja2 + PyYAML (ansible's own dependencies)")
    def test_the_deploy_failure_shows_why(self):
        # The access task's output is never printed; the failure and the WARNING show only the
        # seeder lines that match one filter. Without ACL- in it, a state_root that failed on
        # an inactive action read as a missing MDMS_ADMIN.
        import re
        with open(os.path.join(REPO, "local-setup", "ansible", "playbook-deploy.yml"), encoding="utf-8") as fh:
            tasks = {t.get("name"): t for p in yaml.safe_load(fh) for t in p.get("tasks", []) or []}
        env = jinja2.Environment()
        env.tests["search"] = lambda value, pattern: re.search(pattern, value) is not None  # ansible's test
        fail = env.from_string(tasks["notif-seed — fail: state_root could not be seeded"]
                               ["ansible.builtin.fail"]["msg"])
        warn = env.from_string(tasks["notif-seed — WARNING: a complaint root other than state_root could not be seeded"]
                               ["ansible.builtin.debug"]["msg"])

        def shown(out, acl_rc, data_rc):
            acl = {"rc": acl_rc, "stdout": out, "stdout_lines": out.splitlines()}
            fin = {} if data_rc is None else {"rc": data_rc, "stdout": "", "stdout_lines": []}
            values = dict(notif_seed_failed_roots=["ke"], notif_acl_by_root={"ke": acl},
                          notif_seed_final_by_root={"ke": fin} if fin else {},
                          notif_acl_ok_roots=[] if data_rc is None else ["ke"],
                          inventory_hostname="box", item="ke", notif_seed_tenant="other",
                          notif_complaint_counts={"ke": "12"})
            return fail.render(**values), warn.render(**values)

        _a, _g, out = self.seed(self.BOMET_KE, hidden_ids={FLOOR + 1}, failures=1)
        for msg in shown(out, 2, None):
            self.assertIn("ACL-ID-TAKEN: action id %d at ke was not free" % (FLOOR + 1), msg)
        _a, _g, out = self.seed([(action(aid, url), aid != FIXED[0]) for aid, url in zip(FIXED, URLS)])
        for msg in shown(out, 0, 3):
            self.assertIn("ACL-ACTION-INACTIVE: %s is action %d at ke" % (URLS[0], FIXED[0]), msg)



@unittest.skipIf(jinja2 is None, "needs jinja2 + PyYAML (ansible's own dependencies)")
class WorkspaceRootsAreNotSeededByTheDeploy(unittest.TestCase):
    """Field finding (dev deployment, 2026-10-07): every self-serve workspace root with complaints
    printed "NOT SEEDED — the access-control rows failed (exit 2)": the deploy logged in as ADMIN,
    which does not exist at a workspace. Workspaces are seeded by pgr-services at signup, so the
    deploy leaves them out of the ADMIN loop and names the ones still without routing."""

    @classmethod
    def setUpClass(cls):
        import ast
        import re
        with open(os.path.join(REPO, "local-setup", "ansible", "playbook-deploy.yml"), encoding="utf-8") as fh:
            tasks = [t for p in yaml.safe_load(fh) for t in p.get("tasks", []) or []]
        task = next(t for t in tasks if t.get("name") == "notif-seed — the state roots to seed")
        cls.facts = task["ansible.builtin.set_fact"]
        action = next(t for t in tasks if t.get("name") == "notif-seed — ACTION: a self-serve workspace has no notification configuration")
        cls.action_when = [w for w in action["when"] if "notif_workspace_routing" in w][0]
        cls.action_loop = action["loop"]
        cls.action_msg = action["ansible.builtin.debug"]["msg"]
        env = jinja2.Environment()
        env.tests["match"] = lambda value, pattern: re.match(pattern, value) is not None   # ansible's test
        cls.env = env
        cls.literal = staticmethod(ast.literal_eval)

    def render(self, name, **values):
        return self.literal(self.env.from_string(self.facts[name]).render(**values).strip())

    def test_workspace_roots_leave_the_admin_loop_but_state_root_never_does(self):
        values = dict(notif_seed_tenant="ke ", notif_complaint_counts={"ke": "12", "knewman": "3", "pg": "40", "PW_x": "1"},
                      notif_workspace_routing={"knewman": "0", "kpgr": "24", "ke": "0"})
        self.assertEqual(self.render("notif_seed_roots", **values), ["ke", "pg"])
        self.assertEqual(self.render("notif_seed_workspaces", **values), ["knewman", "kpgr"])

    def test_without_the_onboarding_tables_every_root_is_seeded_as_before(self):
        values = dict(notif_seed_tenant="ke", notif_complaint_counts={"ke": "1", "knewman": "3"}, notif_workspace_routing={})
        self.assertEqual(self.render("notif_seed_roots", **values), ["ke", "knewman"])
        self.assertEqual(self.render("notif_seed_workspaces", **values), [])

    def test_excluded_test_signups_are_neither_listed_nor_given_an_action(self):
        # Review of #2342: lowercase pwt… test signups are workspaces too, and were listed.
        values = dict(notif_seed_tenant="ke", notif_complaint_counts={"ke": "1", "pwtsignup1": "2"},
                      notif_workspace_routing={"pwtsignup1": "0", "PW_x": "0", "knewman": "0"})
        self.assertEqual(self.render("notif_seed_workspaces", **values), ["knewman"])
        self.assertEqual(self.render("notif_seed_roots", **values), ["ke"], "nor seeded as a plain root")
        self.assertIn("notif_seed_workspaces", self.action_loop, "the ACTION loops over the filtered list")
        values["notifications_seed_exclude"] = "^knew"
        self.assertEqual(self.render("notif_seed_workspaces", **values), ["PW_x", "pwtsignup1"])

    def test_the_action_reads_the_token_without_echo(self):
        # Review of #2342: `DIGIT_ACCESS_TOKEN=<token>` on the command line lands in the shell history.
        self.assertIn("read -rs DIGIT_ACCESS_TOKEN && export DIGIT_ACCESS_TOKEN", self.action_msg)
        self.assertNotIn("DIGIT_ACCESS_TOKEN=<", self.action_msg)
        self.assertIn("unset DIGIT_ACCESS_TOKEN", self.action_msg)

    def test_only_a_workspace_without_routing_gets_the_action(self):
        when = self.env.from_string("{{ " + self.action_when + " }}")
        routing = {"knewman": "0", "kpgr": "24"}
        self.assertEqual(when.render(item="knewman", notif_workspace_routing=routing), "True")
        self.assertEqual(when.render(item="kpgr", notif_workspace_routing=routing), "False")

if __name__ == "__main__":
    unittest.main()
