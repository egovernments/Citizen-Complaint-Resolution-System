"""The render contract: playbook-deploy.yml can render its own /opt/digit configuration.

The upgrade tooling (scripts/digit_upgrade) computes what a version deploys by
running that version's playbook with --tags render.  These tests keep that
exact: every task that touches the analysed configuration is either tagged
`render` or listed in NOT_RENDERED with the reason it is not, render tasks stay
local and deterministic, and the render actually works without Docker.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "local-setup/scripts"))

import deploy_state  # noqa: E402
from digit_upgrade import mdms, render  # noqa: E402

ANSIBLE = ROOT / "local-setup/ansible"
IN_CI = bool(os.environ.get("CI"))

# Tasks that reference analysed paths without being part of the render.
NOT_RENDERED = {
    "Configurator SPA — place runtime config.js beside the host-served dist":
        "reads configurator-runtime/config.js; writes the host-served dist outside /opt/digit",
    "status board — basic-auth user for the Mac nginx container": "macOS only; upgrades are Linux-only",
    "Mac nginx — ensure nginx dir": "macOS only; upgrades are Linux-only",
    "Mac nginx — render site config (upstreams -> host.docker.internal)": "macOS only; upgrades are Linux-only",
    "Mac nginx — (re)create the digit-nginx container": "macOS only; upgrades are Linux-only",
    "validate — no container is restarting / unhealthy / crash-looping": "reads the Compose file",
    "identity-bootstrap — reconcile Organizations realm and BFF clients": "reads the realm file",
    "CI — CRSLoader E2E (10-phase dataloader flow, throwaway tenant)": "CI only; runs the dataloader",
    "CI — CRSLoader v2 regression suite (#263 fixes)": "CI only; runs a script",
}
RENDER_MODULES = {
    "assert", "blockinfile", "copy", "debug", "fail", "file", "lineinfile", "replace", "set_fact", "stat",
    "synchronize", "template",
}
# Shell in a render task needs a reason too.
RENDER_SHELL = {
    "Kong — write the pinned config back IN PLACE (preserves the inode)":
        "cat > keeps the bind-mounted file's inode; a local file write",
}
DIGIT_PATH = re.compile(r"\{\{ *digit_dir *\}\}/(?P<path>[^\s\"'{}]+)")


def module(task):
    for key in task:
        short = key.split(".")[-1]
        if short not in {"name", "when", "tags", "register", "loop", "vars", "loop_control", "args", "become",
                         "delegate_to", "changed_when", "failed_when", "no_log", "check_mode", "until",
                         "retries", "delay", "environment", "ignore_errors", "notify", "block", "rescue",
                         "always", "run_once", "listen", "timeout"}:
            return short
    return None


def walk(tasks, origin):
    for task in tasks or []:
        if isinstance(task, dict):
            for key in ("block", "rescue", "always"):
                yield from walk(task.get(key), origin)
            yield task, origin


def deploy_tasks():
    play = yaml.safe_load((ANSIBLE / "playbook-deploy.yml").read_text(encoding="utf-8"))[0]
    found = list(walk((play.get("pre_tasks") or []) + play["tasks"], "playbook-deploy.yml"))
    for path in sorted((ANSIBLE / "tasks").glob("*.yml")):
        found += list(walk(yaml.safe_load(path.read_text(encoding="utf-8")), f"tasks/{path.name}"))
    return found


def analysed_references(task):
    body = yaml.safe_dump({k: v for k, v in task.items() if k not in ("block", "rescue", "always", "name")}, width=10**6)
    refs = set()
    for match in DIGIT_PATH.finditer(body):
        path = match.group("path").rstrip("/")
        top = path.split("/", 1)[0]
        if deploy_state.is_analysed(path) or ("/" not in path and top in deploy_state.ANALYSED_ROOTS):
            refs.add(path)
    return refs


class RenderContractTests(unittest.TestCase):
    def test_every_task_touching_analysed_config_is_rendered_or_explained(self):
        unclassified = [
            f"{origin}: {task.get('name')} -> {sorted(analysed_references(task))}"
            for task, origin in deploy_tasks()
            if module(task) not in (None, "include_tasks", "import_tasks", "debug", "assert", "fail", "stat")
            and analysed_references(task)
            and "render" not in (task.get("tags") or [])
            and task.get("name") not in NOT_RENDERED
        ]
        self.assertEqual([], unclassified, "tag these `render`, or add them to NOT_RENDERED with a reason")

    def test_not_rendered_entries_still_exist(self):
        names = {task.get("name") for task, _ in deploy_tasks()}
        self.assertEqual([], sorted(set(NOT_RENDERED) - names))

    def test_render_tasks_are_local_and_deterministic(self):
        problems = []
        for task, origin in deploy_tasks():
            if "render" not in (task.get("tags") or []):
                continue
            name, kind = task.get("name"), module(task)
            if kind in ("shell", "command"):
                if name not in RENDER_SHELL:
                    problems.append(f"{name}: shell in a render task needs an entry in RENDER_SHELL")
            elif kind not in RENDER_MODULES:
                problems.append(f"{name}: module {kind} cannot run in a render")
            if task.get("delegate_to") not in (None, "localhost"):
                problems.append(f"{name}: delegates to {task['delegate_to']}")
            if task.get("become") is True:
                problems.append(f"{name}: needs root")
        self.assertEqual([], problems)

    def test_always_tasks_are_safe_in_a_render(self):
        unsafe = [
            task.get("name") for task, _ in deploy_tasks()
            if "always" in (task.get("tags") or [])
            and module(task) not in {"set_fact", "assert", "debug", "fail", "stat"}
            and "digit_render_only" not in str(task.get("when"))
        ]
        self.assertEqual([], unsafe, "an `always` task runs during a render; gate it on digit_render_only")

    def test_mdms_writes_outside_migrations_are_declared(self):
        """The upgrade replays mdms.DEPLOY_SQL on its database clone; anything else is unpredictable."""
        writes = re.compile(r"(?is)\b(update|insert\s+into|delete\s+from)\s+(public\.)?eg_mdms_data\b")
        undeclared = []
        for task, origin in deploy_tasks():
            body = yaml.safe_dump(task, width=10**6)
            if "psql" not in body:
                continue
            if writes.search(body):
                undeclared.append(f"{origin}: {task.get('name')} (inline SQL)")
            for sql in re.findall(r"([\w./-]+\.sql)\b", body):
                path = next((p for p in (ROOT / "local-setup/db" / Path(sql).name,) if p.is_file()), None)
                rel = path and path.relative_to(ROOT).as_posix()
                if path and writes.search(path.read_text(encoding="utf-8")) and rel not in mdms.DEPLOY_SQL:
                    undeclared.append(f"{origin}: {task.get('name')} ({rel})")
        self.assertEqual([], undeclared, "add the SQL file to digit_upgrade.mdms.DEPLOY_SQL")

    def test_render_playbook_carries_the_contract_marker(self):
        self.assertTrue(render.has_contract(ROOT))


@unittest.skipUnless(shutil.which("ansible-playbook") or IN_CI, "ansible-playbook is not installed")
class RenderRunTests(unittest.TestCase):
    """Render for real, as an unprivileged user with no Docker."""

    def render(self, source, vars_file, allow_legacy=False):
        out = Path(self.scratch.name) / "out"
        how = render.render(source, "rt", vars_file, out, allow_legacy=allow_legacy)
        return how, out

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.vars = Path(self.scratch.name) / "rt.yml"
        values = yaml.safe_load((ANSIBLE / "inventory/host_vars/_example.yml").read_text(encoding="utf-8"))
        self.vars.write_text(yaml.safe_dump(values), encoding="utf-8")
        self.values = values

    def tearDown(self):
        self.scratch.cleanup()

    def test_this_version_renders_itself(self):
        how, out = self.render(ROOT, self.vars)
        self.assertEqual(render.OWN, how)
        files = deploy_state.analysed_files(str(out))
        for expected in ("docker-compose.egov-digit.yaml", "kong/kong.yml", "nginx/digit-ui.conf",
                         "configurator-runtime/config.js", "identity-keycloak-realm.json"):
            self.assertIn(expected, files)
        compose = (out / "docker-compose.egov-digit.yaml").read_text(encoding="utf-8")
        self.assertIn(f"STATE_LEVEL_TENANT_ID: {self.values['state_root']}", compose)
        self.assertIn(f"- 'https://{self.values['domain']}'", (out / "kong/kong.yml").read_text(encoding="utf-8"))
        self.assertFalse((out / ".digit-deploy-state").exists())
        self.assertFalse((out / ".env").exists() and "PASSWORD" in (out / ".env").read_text())

    def test_render_refuses_the_live_directory(self):
        with self.assertRaises(Exception):
            render._render(ROOT, "rt", self.vars, Path("/opt/digit"))

    def test_legacy_versions_render_through_grafted_tags(self):
        tags = [t for t in ("v2.12-beta", "v2.12", "v2.12.1")
                if subprocess.run(["git", "rev-parse", "-q", "--verify", f"{t}^{{commit}}"], cwd=ROOT,
                                  capture_output=True).returncode == 0]
        if not tags:
            if IN_CI:
                self.fail("the v2.12 tags are missing; check out with fetch-depth: 0")
            self.skipTest("v2.12 tags are not in this clone")
        for tag in tags:
            with self.subTest(tag=tag), tempfile.TemporaryDirectory() as scratch:
                source = Path(scratch) / "src"
                render.export_commit(ROOT, tag, source)
                out = Path(scratch) / "out"
                self.assertEqual(render.GRAFTED, render.render(source, "rt", self.vars, out, allow_legacy=True))
                compose = (out / "docker-compose.egov-digit.yaml").read_text(encoding="utf-8")
                self.assertIn(f"STATE_LEVEL_TENANT_ID: {self.values['state_root']}", compose)

    def test_a_target_without_the_contract_is_refused(self):
        with tempfile.TemporaryDirectory() as scratch:
            with self.assertRaisesRegex(Exception, "predates the render contract"):
                render.render(Path(scratch), "rt", self.vars, Path(scratch) / "out", allow_legacy=False)


if __name__ == "__main__":
    unittest.main()
