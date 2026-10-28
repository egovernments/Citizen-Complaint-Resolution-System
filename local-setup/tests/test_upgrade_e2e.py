"""End to end on real renders: analyse → resolve → resume → deploy preflight.

Uses a throwaway clone with one extra "target" commit, a simulated /opt/digit
(the base render plus operator edits), and the deployer's own preflight steps
up to the point where it would touch Docker.  Needs ansible-playbook.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "local-setup/scripts"))

from digit_upgrade import analyse, deploy, render  # noqa: E402
from digit_upgrade.common import NeedsOperator, UpgradeError  # noqa: E402
from digit_upgrade.trees import prepare  # noqa: E402

PERSISTER = "configs/egov-persister/audit-service-persister.yml"
EXAMPLE = ROOT / "local-setup/ansible/inventory/host_vars/_example.yml"


def git(repo, *args):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=repo, check=True,
                          capture_output=True, text=True).stdout.strip()


def replace_line(path: Path, number: int, text: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    lines[number - 1] = text + "\n"
    path.write_text("".join(lines), encoding="utf-8")


@unittest.skipUnless(shutil.which("ansible-playbook") or os.environ.get("CI"), "ansible-playbook is not installed")
class UpgradeEndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._temp = tempfile.TemporaryDirectory()
        tmp = Path(cls._temp.name)
        # The tracked example fails the target's preflight on purpose until an
        # operator fills it in; settle it the way one would on a plain box.
        cls.vars = tmp / "rt.yml"
        cls.vars.write_text(
            EXAMPLE.read_text(encoding="utf-8")
            .replace("db_fast_path_ack_data_wipe: false", "db_fast_path_ack_data_wipe: true")
            .replace("\nenable_mcp: true", "\nenable_mcp: false"),
            encoding="utf-8",
        )
        cls.repo = tmp / "repo"
        subprocess.run(["git", "clone", "-q", "--shared", str(ROOT), str(cls.repo)], check=True)
        # The working tree under test, not just its last commit.
        subprocess.run(["rsync", "-a", "--delete", "--exclude=.git", "--exclude=node_modules", f"{ROOT}/", f"{cls.repo}/"],
                       check=True)
        git(cls.repo, "add", "-A")
        git(cls.repo, "commit", "-q", "--allow-empty", "-m", "base")
        cls.base = git(cls.repo, "rev-parse", "HEAD")
        replace_line(cls.repo / "local-setup" / PERSISTER, 5, "      description: target wording")
        with (cls.repo / "local-setup/kong/kong.yml").open("a", encoding="utf-8") as stream:
            stream.write("# target-side change\n")
        git(cls.repo, "commit", "-q", "-am", "target")
        cls.target = git(cls.repo, "rev-parse", "HEAD")

        # The box: the base render plus an operator's edits.
        cls.live = tmp / "live"
        source = tmp / "base-source"
        render.export_commit(cls.repo, cls.base, source)
        render.render(source, "rt", cls.vars, cls.live, allow_legacy=False)
        replace_line(cls.live / PERSISTER, 5, "      description: operator wording")
        kong = cls.live / "kong/kong.yml"
        kong.write_text("# operator note\n" + kong.read_text(encoding="utf-8"), encoding="utf-8")
        (cls.live / "configs/custom").mkdir()
        (cls.live / "configs/custom/local.yml").write_text("service: local\npassword: SuperSecret123\n")
        (cls.live / "configs/egov-persister/boundary-persister.yml").unlink()

        cls.output = tmp / "runs"
        try:
            analyse.analyse(repo=cls.repo, target_ref=cls.target, base_ref=cls.base, tenant="rt", tenant_vars=cls.vars,
                            base_overrides={}, backup=cls.live, output=cls.output, excludes=())
        except NeedsOperator:
            pass
        else:
            raise AssertionError("the conflicting edit should have stopped the analysis")
        cls.run_dir = next(cls.output.glob("digit-upgrade-*"))

    @classmethod
    def tearDownClass(cls):
        cls._temp.cleanup()

    def test_1_analysis_finds_the_changes_and_the_conflict(self):
        manifest = analyse.read_json(self.run_dir / "run.json")
        self.assertEqual("CONFLICTS", manifest["status"])
        self.assertEqual([PERSISTER], manifest["conflicts"])
        self.assertEqual(
            {("A", "configs/custom/local.yml"), ("M", PERSISTER), ("D", "configs/egov-persister/boundary-persister.yml"),
             ("M", "kong/kong.yml")},
            {(c["status"], c["path"]) for c in manifest["local_changes"]},
        )
        self.assertEqual(1, manifest["secrets"]["warning_count"])
        output = b"".join(p.read_bytes() for p in self.run_dir.rglob("*") if p.is_file() and ".git" not in p.parts)
        self.assertNotIn(b"SuperSecret123", output)

    def test_2_resume_after_resolution(self):
        workspace = self.run_dir / "workspace"
        with self.assertRaises(NeedsOperator):
            analyse.resume(self.run_dir, acknowledge_secret_review=False)
        path = workspace / PERSISTER
        text = re.sub(r"<<<<<<< .*?>>>>>>> target\n", "      description: both wordings\n",
                      path.read_text(encoding="utf-8"), flags=re.S)
        path.write_text(text, encoding="utf-8")
        git(workspace, "add", PERSISTER)
        analyse.resume(self.run_dir, acknowledge_secret_review=False)
        candidate = self.run_dir / "candidate"
        kong = (candidate / "kong/kong.yml").read_text(encoding="utf-8")
        self.assertTrue(kong.startswith("# operator note\n") and kong.endswith("# target-side change\n"))
        self.assertFalse((candidate / "configs/egov-persister/boundary-persister.yml").exists())

    def preflight_trees(self, live):
        manifest = analyse.read_json(self.run_dir / "run.json")
        scratch = Path(tempfile.mkdtemp(dir=self._temp.name))
        raw = {"live": live}
        for name, commit in (("base", manifest["base_commit"]), ("target", manifest["target_commit"])):
            render.export_commit(self.repo, commit, scratch / f"{name}-source")
            raw[name] = scratch / f"{name}-render"
            render.render(scratch / f"{name}-source", "rt", self.vars, raw[name], allow_legacy=False)
        known = analyse.values_in_structure(analyse.load_yaml(self.vars))
        deployment = deploy.Deployment(self.run_dir, backup_parent=scratch / "b", resolution=None, tool_root=self.repo)
        return deployment, prepare(raw, scratch / "normalized", known_secrets=known, excludes=()), scratch

    def test_3_deploy_reproduces_the_analysis_and_restores_secrets(self):
        deployment, prepared, scratch = self.preflight_trees(self.live)
        deployment._check_same_as_analysed(prepared.hashes, prepared.normalized["live"])
        overlay, deleted, conflicts = deployment._materialize(prepared, scratch)
        self.assertEqual((["configs/egov-persister/boundary-persister.yml"], []), (deleted, conflicts))
        self.assertEqual("service: local\npassword: SuperSecret123\n",
                         (overlay / "configs/custom/local.yml").read_text(encoding="utf-8"))
        shutil.rmtree(overlay)

    def test_4_deploy_refuses_a_box_edited_after_the_backup(self):
        drifted = Path(self._temp.name) / "drifted"
        shutil.copytree(self.live, drifted, symlinks=True)
        with (drifted / "nginx/digit-ui.conf").open("a") as stream:
            stream.write("# edited after the backup\n")
        deployment, prepared, _ = self.preflight_trees(drifted)
        with self.assertRaisesRegex(UpgradeError, r"\(1 path\(s\): nginx/digit-ui.conf\)"):
            deployment._check_same_as_analysed(prepared.hashes, prepared.normalized["live"])


    def test_5_auto_base_finds_the_deployed_commit(self):
        """A box deployed before the drift guard: no recorded commit, found from its files."""
        try:
            analyse.analyse(repo=self.repo, target_ref=self.target, base_ref="auto", tenant="rt",
                            tenant_vars=self.vars, base_overrides={}, backup=self.live,
                            output=Path(self._temp.name) / "auto-runs", excludes=())
        except NeedsOperator:
            pass  # the same conflict as test_1
        run_dir = next((Path(self._temp.name) / "auto-runs").glob("digit-upgrade-*"))
        manifest = analyse.read_json(run_dir / "run.json")
        self.assertEqual((self.base, "auto"), (manifest["base_commit"], manifest["base_ref_source"]))
        self.assertIn("found from the files on the box", (run_dir / "report.md").read_text(encoding="utf-8"))

if __name__ == "__main__":
    unittest.main()
