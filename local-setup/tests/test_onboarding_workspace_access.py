#!/usr/bin/env python3
"""seed-onboarding-workspace-access.py: what the deploy grants a state root for the configurator's
workspace endpoints, read from pgr-services' platform baseline, and that it only ever creates.

Run: python3 -m unittest local-setup/tests/test_onboarding_workspace_access.py
"""
import importlib.util
import io
import json
import os
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
BASELINE = os.path.join(REPO, "backend", "pgr-services", "src", "main", "resources", "onboarding",
                        "platform-baseline-v1.json")
_spec = importlib.util.spec_from_file_location(
    "seed_onboarding_workspace_access", os.path.join(REPO, "local-setup", "scripts", "seed-onboarding-workspace-access.py"))
wa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wa)

with open(BASELINE, encoding="utf-8") as fh:
    _baseline = json.load(fh)
ACTIONS, GRANTS = wa.select(_baseline, "ke")
RESERVED = wa.reserved(_baseline)
SEARCH, UPDATE, RENAME = (wa.URL_PREFIX + route for route in ("_search", "_update", "_rename"))


def held(*rows, active=True):
    return [(row, active) for row in rows]


def action(id_, url):
    return {"id": id_, "url": url}


def grant(id_, role, actionid):
    return {"id": id_, "rolecode": role, "actionid": actionid, "tenantId": "ke"}


class Selection(unittest.TestCase):
    def test_the_baseline_gives_exactly_the_three_workspace_actions_and_their_account_admin_grants(self):
        self.assertEqual([(a["id"], a["url"]) for a in ACTIONS],
                         [(900000, SEARCH), (900001, UPDATE), (901000, RENAME)])
        self.assertEqual([(g["rolecode"], g["actionid"], g["id"], g["tenantId"]) for g in GRANTS],
                         [("ACCOUNT_ADMIN", 900000, 900000, "ke"), ("ACCOUNT_ADMIN", 900001, 900001, "ke"),
                          ("ACCOUNT_ADMIN", 901000, 901000, "ke")])


class Plan(unittest.TestCase):
    def test_a_root_without_them_gets_the_baseline_rows_under_the_baseline_ids(self):
        actions, grants, notes = wa.plan(ACTIONS, GRANTS, held(action(1, "/other")), [], {"ACCOUNT_ADMIN"}, RESERVED)
        self.assertEqual(actions, ACTIONS)
        self.assertEqual(grants, GRANTS)
        self.assertEqual(notes, [])

    def test_a_url_the_root_holds_under_another_id_is_reused_and_granted_there(self):
        actions, grants, _ = wa.plan(ACTIONS, GRANTS, held(action(77, SEARCH), action("78", UPDATE), action(79, RENAME)),
                                     [], {"ACCOUNT_ADMIN"}, RESERVED)
        self.assertEqual(actions, [])
        self.assertEqual([g["actionid"] for g in grants], [77, 78, 79])

    def test_a_taken_baseline_id_moves_above_the_baselines_ids_and_the_roots(self):
        # Inside the baseline's range (up to 901017) a fallback would take a baseline row's id.
        self.assertEqual((max(RESERVED[0]), max(RESERVED[1])), (901017, 901017))
        actions, grants, _ = wa.plan(ACTIONS, GRANTS, held(action(900000, "/someone/else"), action(5, "/x")),
                                     held(grant(900001, "CSR", 5)), {"ACCOUNT_ADMIN"}, RESERVED)
        self.assertEqual([(a["id"], a["url"]) for a in actions], [(901018, SEARCH), (900001, UPDATE), (901000, RENAME)])
        self.assertEqual([(g["actionid"], g["id"]) for g in grants], [(901018, 900000), (900001, 901018), (901000, 901000)])
        actions, _, _ = wa.plan(ACTIONS, GRANTS, held(action(900000, "/someone/else"), action(990000, "/y")), [],
                                {"ACCOUNT_ADMIN"}, RESERVED)
        self.assertEqual(actions[0]["id"], 990001)

    def test_an_existing_grant_is_kept_and_nothing_is_rewritten(self):
        root = held(*(action(a["id"], a["url"]) for a in ACTIONS))
        actions, grants, notes = wa.plan(ACTIONS, GRANTS, root, held(grant(12, "ACCOUNT_ADMIN", "900000.0")),
                                         {"ACCOUNT_ADMIN"}, RESERVED)
        self.assertEqual(actions, [])
        self.assertEqual([g["actionid"] for g in grants], [900001, 901000])
        self.assertEqual(notes, [])

    def test_inactive_rows_are_reported_and_left_alone(self):
        root = held(action(900000, SEARCH), action(900001, UPDATE)) + held(action(901000, RENAME), active=False)
        actions, grants, notes = wa.plan(ACTIONS, GRANTS, root, held(grant(1, "ACCOUNT_ADMIN", 900001), active=False),
                                         {"ACCOUNT_ADMIN"}, RESERVED)
        self.assertEqual(actions, [])
        self.assertEqual([g["actionid"] for g in grants], [900000])
        self.assertEqual(len(notes), 2)
        self.assertIn("INACTIVE", notes[0]); self.assertIn(RENAME, notes[0])
        self.assertIn("INACTIVE", notes[1]); self.assertIn(UPDATE, notes[1])

    def test_a_role_the_root_does_not_have_is_reported_not_invented(self):
        actions, grants, notes = wa.plan(ACTIONS, GRANTS, [], [], {"SUPERUSER"}, RESERVED)
        self.assertEqual(len(actions), 3)
        self.assertEqual(grants, [])
        self.assertTrue(all("no ACCOUNT_ADMIN role" in note for note in notes) and len(notes) == 3)


class FakeDigit:
    """Kong + egov-user + mdms-v2, as far as the seeder uses them: paged search, x-unique, x-ref
    on role-actions, and a write that a search returns only from its second read on."""

    def __init__(self, actions, grants, roles=("ACCOUNT_ADMIN",), password="right"):
        self.rows = [self._row(wa.ACTIONS, data) for data in actions] + [self._row(wa.ROLEACTIONS, data) for data in grants]
        self.rows += [self._row(wa.ROLES, {"code": role}) for role in roles]
        self.password, self.creates, self.lag = password, [], {}
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
                status, body = fake.handle(self.path, raw)
                self.send_response(status); self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(json.dumps(body).encode())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = "http://127.0.0.1:%d" % self.server.server_address[1]

    @staticmethod
    def _uid(code, data):
        if code == wa.ACTIONS:
            return str(data["id"])
        return "%s.%s" % (data["rolecode"], data["actionid"]) if code == wa.ROLEACTIONS else data["code"]

    def _visible(self, row):
        return self.lag.get(id(row), -1) < 0

    def _row(self, code, data):
        return {"tenantId": "ke", "schemaCode": code, "uniqueIdentifier": self._uid(code, data), "data": data, "isActive": True}

    def handle(self, path, raw):
        if path == "/user/oauth/token":
            form = parse_qs(raw)
            return (200, {"access_token": "t"}) if form["password"] == [self.password] else (401, {"error": "invalid_grant"})
        request = json.loads(raw)
        if request["RequestInfo"].get("authToken") != "t":
            return 403, {}
        if path == "/mdms-v2/v2/_search":
            c = request["MdmsCriteria"]
            found = [r for r in self.rows if r["schemaCode"] == c["schemaCode"]
                     and ("uniqueIdentifiers" not in c or r["uniqueIdentifier"] in c["uniqueIdentifiers"])]
            visible = [r for r in found if self._visible(r)]
            for r in found:
                if id(r) in self.lag:
                    self.lag[id(r)] -= 1
            return 200, {"mdms": visible[c["offset"]:c["offset"] + c["limit"]]}
        code, data = path.rsplit("/", 1)[1], request["Mdms"]["data"]
        if any(r["schemaCode"] == code and r["uniqueIdentifier"] == self._uid(code, data) for r in self.rows):
            return 400, {"Errors": [{"code": "DUPLICATE_RECORD"}]}
        if code == wa.ROLEACTIONS and not any(r["schemaCode"] == wa.ACTIONS and r["data"]["id"] == data["actionid"]
                                               and self._visible(r) for r in self.rows):
            return 400, {"Errors": [{"code": "INVALID_REFERENCE"}]}
        row = self._row(code, data)
        self.lag[id(row)] = 1  # the next search misses it
        self.rows.append(row); self.creates.append((code, data))
        return 200, {"mdms": [row]}

    def run(self, password="right"):
        wa.URL, wa.TENANT, wa.LOGIN_TENANT, wa.BASELINE_FILE = self.url, "ke", "ke", BASELINE
        wa.USERNAME, wa.PASSWORD, wa.VISIBLE_DELAY = "ADMIN", password, 0
        out = io.StringIO()
        with redirect_stdout(out):
            code = wa.main()
        return code, out.getvalue()


class Seeder(unittest.TestCase):
    def setUp(self):
        # More actions than one search page, so the seeder must page to see the root's ids.
        self.digit = FakeDigit([action(i, "/a/%d" % i) for i in range(1, 251)], [grant(1, "SUPERUSER", 1)])
        self.addCleanup(self.digit.server.shutdown)

    def test_first_deploy_creates_the_rows_and_the_next_one_creates_nothing(self):
        code, out = self.digit.run()
        self.assertEqual(code, 0, out)
        self.assertEqual([(c, d.get("url") or d["rolecode"], d["id"]) for c, d in self.digit.creates],
                         [(wa.ACTIONS, SEARCH, 900000), (wa.ACTIONS, UPDATE, 900001), (wa.ACTIONS, RENAME, 901000),
                          (wa.ROLEACTIONS, "ACCOUNT_ADMIN", 900000), (wa.ROLEACTIONS, "ACCOUNT_ADMIN", 900001),
                          (wa.ROLEACTIONS, "ACCOUNT_ADMIN", 901000)])
        self.assertIn("WORKSPACE-ACCESS-CHANGED: 6 row(s)", out)
        code, out = self.digit.run()
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.digit.creates), 6)
        self.assertNotIn("WORKSPACE-ACCESS-CHANGED", out)

    def test_a_refused_login_reads_and_writes_nothing(self):
        code, out = self.digit.run(password="wrong")
        self.assertEqual(code, 2)
        self.assertIn("WORKSPACE-ACCESS-FAILED: logging in as ADMIN at ke failed (HTTP 401", out)
        self.assertNotIn("wrong", out)
        self.assertEqual(self.digit.creates, [])


if __name__ == "__main__":
    unittest.main()
