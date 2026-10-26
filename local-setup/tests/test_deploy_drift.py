import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import deploy_drift as drift  # noqa: E402
import upgrade_deploy  # noqa: E402
import upgrade_dry_run  # noqa: E402


class DeployDriftTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.digit = Path(self._temp.name) / "digit"
        (self.digit / "kong").mkdir(parents=True)
        (self.digit / "kong/kong.yml").write_text("route: a\n", encoding="utf-8")
        (self.digit / "docker-compose.egov-digit.yaml").write_text("services: {}\n", encoding="utf-8")
        # Runtime state outside the protected set must never trip the guard.
        (self.digit / ".env").write_text("PASSWORD=x\n", encoding="utf-8")
        (self.digit / "otel/targets").mkdir(parents=True)

    def tearDown(self):
        self._temp.cleanup()

    def run_main(self, command):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            code = drift.main([command, str(self.digit)])
        return code, json.loads(output.getvalue()) if output.getvalue() else None

    def test_missing_directory_and_missing_manifest_are_not_blocking(self):
        code, result = drift.check(str(self.digit / "absent"))
        self.assertEqual((0, "NO_DEPLOYMENT"), (code, result["status"]))
        code, result = drift.check(str(self.digit))
        self.assertEqual((0, "NO_BASELINE"), (code, result["status"]))

    def test_recorded_deployment_is_clean_until_a_protected_file_changes(self):
        self.assertEqual(0, self.run_main("record")[0])
        self.assertEqual("CLEAN", self.run_main("check")[1]["status"])

        (self.digit / ".env").write_text("PASSWORD=rotated\n", encoding="utf-8")
        (self.digit / "otel/targets/new.json").write_text("[]\n", encoding="utf-8")
        self.assertEqual("CLEAN", self.run_main("check")[1]["status"])

        (self.digit / "kong/kong.yml").write_text("route: hand-edited\n", encoding="utf-8")
        (self.digit / "nginx").mkdir()
        (self.digit / "nginx/extra.conf").write_text("x\n", encoding="utf-8")
        (self.digit / "docker-compose.egov-digit.yaml").unlink()
        code, result = self.run_main("check")
        self.assertEqual(drift.EXIT_DRIFT, code)
        self.assertEqual("DRIFT", result["status"])
        self.assertEqual(["kong/kong.yml"], result["modified"])
        self.assertEqual(["nginx/extra.conf"], result["added"])
        self.assertEqual(["docker-compose.egov-digit.yaml"], result["removed"])

    def test_symlink_retarget_is_drift(self):
        os.symlink("kong.yml", self.digit / "kong/current.yml")
        drift.record(str(self.digit))
        (self.digit / "kong/other.yml").write_text("route: b\n", encoding="utf-8")
        os.unlink(self.digit / "kong/current.yml")
        os.symlink("other.yml", self.digit / "kong/current.yml")
        code, result = drift.check(str(self.digit))
        self.assertEqual(drift.EXIT_DRIFT, code)
        self.assertIn("kong/current.yml", result["modified"])

    def test_interrupted_deploy_is_reported_instead_of_blocking(self):
        drift.record(str(self.digit))
        self.assertEqual("IN_PROGRESS", self.run_main("begin")[1]["status"])
        (self.digit / "kong/kong.yml").write_text("route: half-written\n", encoding="utf-8")
        code, result = self.run_main("check")
        self.assertEqual((0, "INCOMPLETE_PREVIOUS"), (code, result["status"]))
        drift.record(str(self.digit))
        self.assertEqual("CLEAN", drift.check(str(self.digit))[1]["status"])

    def test_begin_without_manifest_creates_nothing(self):
        self.assertEqual("NO_BASELINE", drift.begin(str(self.digit))["status"])
        self.assertFalse((self.digit / drift.STATE_DIR).exists())

    def test_malformed_manifest_fails_closed(self):
        (self.digit / drift.STATE_DIR).mkdir()
        (self.digit / drift.STATE_DIR / drift.MANIFEST).write_text("[]\n", encoding="utf-8")
        self.assertEqual(1, self.run_main("check")[0])

    def test_usage_error(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(2, drift.main(["verify", str(self.digit)]))

    def test_protected_roots_match_the_upgrade_config_roots(self):
        self.assertEqual(set(upgrade_deploy.CONFIG_ROOTS), set(drift.PROTECTED_ROOTS))

    def test_upgrade_analysis_ignores_the_drift_state(self):
        self.assertTrue(upgrade_dry_run.excluded(f"{drift.STATE_DIR}/{drift.MANIFEST}"))


class DeployPlaybookGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import yaml

        root = Path(__file__).resolve().parents[2]
        play = yaml.safe_load(
            (root / "local-setup/ansible/playbook-deploy.yml").read_text(encoding="utf-8")
        )[0]
        cls.pre_tasks = play["pre_tasks"]
        cls.tasks = play["tasks"]

    def named(self, tasks, prefix):
        return [task for task in tasks if str(task.get("name", "")).startswith(prefix)]

    def test_check_runs_before_any_deploy_write_and_skips_upgrade_mode(self):
        guard = self.named(self.pre_tasks, "drift guard")
        self.assertEqual(4, len(guard))
        check, _, stop, begin = guard
        self.assertIn("deploy_drift.py check", check["ansible.builtin.script"]["cmd"])
        self.assertIn("not (upgrade_safe_mode | default(false) | bool)", str(check["when"]))
        self.assertIs(False, check["check_mode"])
        self.assertIn("not (allow_local_drift | default(false) | bool)", stop["when"])
        self.assertIn("deploy_drift.py begin", begin["ansible.builtin.script"]["cmd"])
        first_writer = next(
            index for index, task in enumerate(self.pre_tasks)
            if str(task.get("name", "")).startswith("force-clean")
        )
        self.assertLess(self.pre_tasks.index(begin), first_writer)

    def test_record_is_the_last_task(self):
        last = self.tasks[-1]
        self.assertTrue(last["name"].startswith("drift guard — record"))
        self.assertIn("deploy_drift.py record", last["ansible.builtin.script"]["cmd"])
        for task in self.named(self.pre_tasks, "drift guard") + [last]:
            self.assertIn("always", task["tags"])


if __name__ == "__main__":
    unittest.main()
