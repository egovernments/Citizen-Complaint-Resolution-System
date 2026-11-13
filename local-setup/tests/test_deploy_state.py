import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "local-setup/scripts"))

import deploy_state as state  # noqa: E402


class StateTestCase(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.digit = Path(self._temp.name) / "digit"
        self.write("kong/kong.yml", "route: a\n")
        self.write("docker-compose.egov-digit.yaml", "services: {}\n")
        # Runtime state outside the analysed set must never trip the guard.
        self.write(".env", "PASSWORD=x\n")
        self.write("otel/targets/keycloak.json", "[]\n")

    def tearDown(self):
        self._temp.cleanup()

    def write(self, rel, text):
        path = self.digit / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def read(self, rel):
        return (self.digit / rel).read_text(encoding="utf-8")

    def main(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = state.main(list(args))
        return code, json.loads(out.getvalue()) if out.getvalue() else None


class AnalysedSetTests(unittest.TestCase):
    def test_membership(self):
        for rel in ("kong/kong.yml", "configs/a/b.yml", "docker-compose.egov-digit.yaml",
                    "docker-compose.ke.yml", "identity-keycloak-realm.json"):
            self.assertTrue(state.is_analysed(rel), rel)
        for rel in (".env", ".openbao/init.json", "sherlog/rules.yml", "nginx/globalConfigs.js",
                    "otel/targets/x.json", "db/full-dump.sql", "opensre/logs/a.log", "configs/x/__pycache__/m.pyc",
                    "docker-compose.upgrade-safe.yml", "README.md", "kong/.kong.yml.pinned"):
            self.assertFalse(state.is_analysed(rel), rel)
        self.assertFalse(state.is_analysed("configs/local.yml", ("configs/local.*",)))


class CheckTests(StateTestCase):
    def test_missing_directory_and_record_do_not_block(self):
        self.assertEqual((0, "NO_DEPLOYMENT"), (state.check(str(self.digit / "absent"))[0], "NO_DEPLOYMENT"))
        self.assertEqual("NO_BASELINE", state.check(str(self.digit))[1]["status"])

    def test_clean_until_an_analysed_file_changes(self):
        self.assertEqual(0, self.main("record", str(self.digit), "abc123")[0])
        self.assertEqual("CLEAN", self.main("check", str(self.digit))[1]["status"])

        self.write(".env", "PASSWORD=rotated\n")
        self.write("otel/targets/new.json", "[]\n")
        self.assertEqual("CLEAN", self.main("check", str(self.digit))[1]["status"])

        self.write("kong/kong.yml", "route: hand-edited\n")
        self.write("nginx/extra.conf", "x\n")
        (self.digit / "docker-compose.egov-digit.yaml").unlink()
        code, result = self.main("check", str(self.digit))
        self.assertEqual((state.EXIT_ATTENTION, "DRIFT"), (code, result["status"]))
        self.assertEqual(["kong/kong.yml"], result["modified"])
        self.assertEqual(["nginx/extra.conf"], result["added"])
        self.assertEqual(["docker-compose.egov-digit.yaml"], result["removed"])

    def test_record_keeps_the_deployed_commit(self):
        state.record(str(self.digit), "0123abc")
        # A run limited by --tags passes no commit: the deployed version is unchanged.
        state.record(str(self.digit))
        manifest = json.loads((self.digit / state.STATE_DIR / state.MANIFEST).read_text())
        self.assertEqual("0123abc", manifest["deployed_commit"])

    def test_symlink_retarget_is_drift(self):
        self.write("kong/other.yml", "route: b\n")
        os.symlink("kong.yml", self.digit / "kong/current.yml")
        state.record(str(self.digit))
        os.unlink(self.digit / "kong/current.yml")
        os.symlink("other.yml", self.digit / "kong/current.yml")
        self.assertIn("kong/current.yml", state.check(str(self.digit))[1]["modified"])

    def test_interrupted_deploy_is_reported_instead_of_blocking(self):
        state.record(str(self.digit))
        self.assertEqual("IN_PROGRESS", self.main("begin", str(self.digit))[1]["status"])
        self.write("kong/kong.yml", "route: half-written\n")
        self.assertEqual((0, "INCOMPLETE_PREVIOUS"), (state.check(str(self.digit))[0], "INCOMPLETE_PREVIOUS"))

    def test_record_from_another_version_is_no_baseline(self):
        state.record(str(self.digit))
        path = self.digit / state.STATE_DIR / state.MANIFEST
        manifest = json.loads(path.read_text())
        manifest["version"] = 1
        path.write_text(json.dumps(manifest))
        self.assertEqual("NO_BASELINE", state.check(str(self.digit))[1]["status"])

    def test_malformed_record_fails_closed(self):
        (self.digit / state.STATE_DIR).mkdir()
        (self.digit / state.STATE_DIR / state.MANIFEST).write_text("[]\n")
        self.assertEqual(1, self.main("check", str(self.digit))[0])

    def test_usage_error(self):
        self.assertEqual(2, self.main("verify", str(self.digit))[0])


class OverrideTests(StateTestCase):
    def adopt(self, files, deleted=()):
        incoming = Path(tempfile.mkdtemp(dir=self._temp.name))
        for rel, text in files.items():
            (incoming / rel).parent.mkdir(parents=True, exist_ok=True)
            (incoming / rel).write_text(text, encoding="utf-8")
        listing = Path(self._temp.name) / "deleted.json"
        listing.write_text(json.dumps(list(deleted)))
        return self.main("adopt", str(self.digit), str(incoming), str(listing))

    def test_adopt_applies_in_place_and_reapply_carries_onto_an_unchanged_render(self):
        inode = (self.digit / "kong/kong.yml").stat().st_ino
        self.write("configs/old.yml", "old\n")
        code, result = self.adopt({"kong/kong.yml": "route: mine\n"}, deleted=["configs/old.yml"])
        self.assertEqual((0, "ADOPTED", 2), (code, result["status"], result["overrides"]))
        self.assertEqual("route: mine\n", self.read("kong/kong.yml"))
        self.assertEqual(inode, (self.digit / "kong/kong.yml").stat().st_ino)
        self.assertFalse((self.digit / "configs/old.yml").exists())

        # The next deploy renders the same version again, then re-applies.
        state.record(str(self.digit))
        state.begin(str(self.digit))
        self.write("kong/kong.yml", "route: a\n")
        self.write("configs/old.yml", "old\n")
        code, result = self.main("reapply", str(self.digit))
        self.assertEqual((0, "REAPPLIED"), (code, result["status"]))
        self.assertEqual("route: mine\n", self.read("kong/kong.yml"))
        self.assertFalse((self.digit / "configs/old.yml").exists())

    def test_a_conflicting_render_is_undone_completely(self):
        self.adopt({"kong/kong.yml": "route: mine\n"})
        self.write(".env", "PASSWORD=before\n")
        state.record(str(self.digit), "old")
        state.begin(str(self.digit))
        # The new version's render: the overridden file, another file, a new file and .env.
        self.write("kong/kong.yml", "route: new version\n")
        self.write("docker-compose.egov-digit.yaml", "services: {new: {}}\n")
        self.write("configs/new.yml", "x\n")
        self.write(".env", "PASSWORD=after\n")
        code, result = self.main("reapply", str(self.digit))
        self.assertEqual((state.EXIT_ATTENTION, "CONFLICT", ["kong/kong.yml"]),
                         (code, result["status"], result["conflicts"]))
        self.assertEqual("route: mine\n", self.read("kong/kong.yml"))
        self.assertEqual("services: {}\n", self.read("docker-compose.egov-digit.yaml"))
        self.assertFalse((self.digit / "configs/new.yml").exists())
        self.assertEqual("PASSWORD=before\n", self.read(".env"))
        self.assertEqual("CLEAN", state.check(str(self.digit))[1]["status"])

    def test_a_run_that_did_not_render_the_file_is_not_a_conflict(self):
        self.adopt({"kong/kong.yml": "route: mine\n"})
        self.assertEqual((0, "REAPPLIED"), (self.main("reapply", str(self.digit))[0], "REAPPLIED"))

    def test_discard_drops_the_overrides(self):
        self.adopt({"kong/kong.yml": "route: mine\n"})
        state.record(str(self.digit))
        state.begin(str(self.digit))
        self.write("kong/kong.yml", "route: new version\n")
        code, result = self.main("reapply", str(self.digit), "--discard")
        self.assertEqual((0, "DISCARDED"), (code, result["status"]))
        self.assertEqual("route: new version\n", self.read("kong/kong.yml"))
        self.assertEqual("NONE", state.reapply(str(self.digit))[1]["status"])

    def test_a_new_adoption_replaces_the_previous_set(self):
        self.adopt({"kong/kong.yml": "route: mine\n"})
        self.adopt({"configs/new.yml": "x\n"})
        index = json.loads((self.digit / state.STATE_DIR / state.OVERRIDES).read_text())
        self.assertEqual(["configs/new.yml"], sorted(index))

    def test_unsafe_paths_are_refused(self):
        self.assertEqual(1, self.adopt({}, deleted=["../etc/passwd"])[0])


class PlaybookWiringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        play = yaml.safe_load((ROOT / "local-setup/ansible/playbook-deploy.yml").read_text(encoding="utf-8"))[0]
        cls.pre_tasks, cls.tasks = play["pre_tasks"], play["tasks"]

    @staticmethod
    def named(tasks, prefix):
        return [t for t in tasks if str(t.get("name", "")).startswith(prefix)]

    @staticmethod
    def script(task):
        return task["ansible.builtin.script"]["cmd"]

    def test_check_runs_before_any_write_and_not_in_upgrade_or_render_mode(self):
        check, _, stop, needs_full_run, begin = self.named(self.pre_tasks, "drift guard")
        self.assertIn("'all' not in ansible_run_tags", str(needs_full_run["when"]))
        self.assertIn("deploy_state.py check", self.script(check))
        self.assertIn("deploy_state.py begin", self.script(begin))
        for flag in ("upgrade_safe_mode", "digit_render_only"):
            self.assertIn(flag, str(check["when"]))
        self.assertIn("allow_local_drift", str(stop["when"]))
        first_writer = next(i for i, t in enumerate(self.pre_tasks) if str(t.get("name", "")).startswith("force-clean"))
        self.assertLess(self.pre_tasks.index(begin), first_writer)

    def test_overrides_go_on_after_the_render_and_before_openbao(self):
        names = [t.get("name", "") for t in self.tasks]
        reapply = names.index("local overrides — re-apply onto this render")
        adopt = names.index("local overrides — adopt the upgrade's resolved local changes")
        openbao = next(i for i, n in enumerate(names) if n.startswith("Secrets prep"))
        last_prestart_render = max(
            i for i, t in enumerate(self.tasks)
            if "render" in (t.get("tags") or []) and not str(t.get("name", "")).startswith(("post-bootstrap", "notif-seed"))
        )
        self.assertLess(last_prestart_render, min(adopt, reapply))
        self.assertLess(max(adopt, reapply), openbao)
        self.assertIn("drop_local_overrides", self.script(self.tasks[reapply]))

    def test_record_is_the_last_task_and_keeps_the_commit(self):
        last = self.tasks[-1]
        self.assertTrue(last["name"].startswith("drift guard — record"))
        self.assertIn("deploy_state.py record", self.script(last))
        self.assertIn("rev-parse HEAD", self.script(last))
        self.assertIn("'all' in ansible_run_tags", self.script(last))


if __name__ == "__main__":
    unittest.main()
