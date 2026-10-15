#!/usr/bin/env python3
"""The Novu admin sign-in probe of tasks/novu-tenant-accounts-verify.yml (review S2 of #2343),
run for real against a fake Novu on localhost.

The deploy keeps per-tenant Novu accounts on only when this probe prints VERIFIED (or, before
the stack starts, ROTATABLE). The ansible matrix (tests/novu-tenant-accounts-verify-test.yml)
stubs the verdict; this file proves the verdicts the script itself prints, from the HTTP
answers Novu 2.3.0 gives: 201 + data.token for a good sign-in, 400/401 for a bad one.

Run: python3 -m unittest local-setup/tests/test_novu_admin_signin_probe.py
"""
import http.server
import json
import os
import subprocess
import threading
import unittest

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS = os.path.join(os.path.dirname(HERE), "ansible", "tasks", "novu-tenant-accounts-verify.yml")
PROBE_TASK = "novu tenant accounts — sign in to Novu as the platform admin ({{ nta_phase }})"
EMAIL = "admin@digit.local"


def probe_script():
    tasks = yaml.safe_load(open(TASKS))
    task = next(t for t in tasks if t.get("name") == PROBE_TASK)
    return task["args"]["stdin"]


class FakeNovu(http.server.BaseHTTPRequestHandler):
    passwords = set()      # what signs in
    status_for_bad = 400   # what a bad sign-in answers
    forced = None          # (status, body) answered to every sign-in
    calls = []

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        FakeNovu.calls.append(body.get("password"))
        if self.path != "/v1/auth/login":
            return self._answer(404, {})
        if FakeNovu.forced:
            return self._answer(*FakeNovu.forced)
        if body.get("email") == EMAIL and body.get("password") in FakeNovu.passwords:
            return self._answer(201, {"data": {"token": "jwt"}})
        return self._answer(FakeNovu.status_for_bad, {"message": "Incorrect email or password provided."})

    def _answer(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


@unittest.skipIf(yaml is None, "PyYAML is required")
class SignInProbeTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeNovu)
        cls.url = "http://127.0.0.1:%d" % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.script = probe_script()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        FakeNovu.passwords, FakeNovu.status_for_bad, FakeNovu.forced, FakeNovu.calls = set(), 400, None, []

    def run_probe(self, phase, new="Generated-Aa1-", old="Digit@12345", url=None):
        env = dict(os.environ, NB_API=url or self.url, NB_PHASE=phase, NB_EMAIL=EMAIL, NB_NEW=new, NB_OLD=old,
                   NB_RETRY_DELAY="0")
        out = subprocess.run(["python3", "-"], input=self.script, env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(0, out.returncode, out.stderr)
        return out.stdout.strip()

    def test_the_password_the_bridge_gets_signs_in(self):
        FakeNovu.passwords = {"Generated-Aa1-"}
        for phase in ("preflight", "post-start"):
            self.assertEqual("VERIFIED", self.run_probe(phase))

    def test_before_the_start_the_legacy_password_is_enough_because_the_move_follows(self):
        FakeNovu.passwords = {"Digit@12345"}
        self.assertEqual("ROTATABLE", self.run_probe("preflight"))
        # After the start the move has happened: only the new password counts.
        FakeNovu.calls = []
        self.assertEqual("REFUSED 400", self.run_probe("post-start"))
        self.assertEqual(["Generated-Aa1-"], FakeNovu.calls, "post-start never signs in with the legacy password")

    def test_a_custom_password_nobody_pinned_is_refused(self):
        FakeNovu.passwords = {"Someone-Changed-It-9!"}
        self.assertEqual("REFUSED 400", self.run_probe("preflight"))
        FakeNovu.status_for_bad = 401
        self.assertEqual("REFUSED 401", self.run_probe("post-start"))

    def test_a_2xx_without_a_token_is_not_a_sign_in(self):
        FakeNovu.forced = (200, {"data": {}})
        self.assertEqual("REFUSED no-token", self.run_probe("post-start"))

    def test_novu_failing_or_absent_is_unreachable_not_refused(self):
        FakeNovu.forced = (503, {})
        self.assertEqual("UNREACHABLE 503", self.run_probe("preflight"))
        FakeNovu.calls = []
        self.assertEqual("UNREACHABLE 503", self.run_probe("post-start"))
        self.assertEqual(3, len(FakeNovu.calls), "post-start retries a Novu that was just restarted")
        self.assertEqual("UNREACHABLE unreachable", self.run_probe("preflight", url="http://127.0.0.1:9"))

    def test_the_legacy_password_equal_to_the_new_one_is_not_tried_twice(self):
        self.assertEqual("REFUSED 400", self.run_probe("preflight", new="Same-Aa1-", old="Same-Aa1-"))
        self.assertEqual(["Same-Aa1-"], FakeNovu.calls)


if __name__ == "__main__":
    unittest.main()
