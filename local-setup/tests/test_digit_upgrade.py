import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "local-setup/scripts"))

from digit_upgrade import analyse, cli, deploy, mdms, merge, render  # noqa: E402
from digit_upgrade.common import NeedsOperator, UpgradeError, run  # noqa: E402
from digit_upgrade.redaction import (  # noqa: E402
    REDACTED, Redactor, RestoreError, Sources, compare_secret_fields, is_secret_key, is_secret_value,
    restore, secret_fields,
)
from digit_upgrade.trees import leaks, prepare  # noqa: E402


def write(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class TempDirCase(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._temp.name)

    def tearDown(self):
        self._temp.cleanup()


class SecretDetectionTests(unittest.TestCase):
    def test_keys(self):
        for key in ("PASSWORD", "db_password", "api-key", "API_KEY", "client_secret", "UNSEAL_KEY"):
            self.assertTrue(is_secret_key(key), key)
        for key in ("password_file", "secret_name", "token_url", "TOKEN_ENABLED", "service"):
            self.assertFalse(is_secret_key(key), key)

    def test_values(self):
        self.assertTrue(is_secret_value("hunter2-long"))
        for value in ("", "short", "<REDACTED>", "true", "${DB_PASSWORD}", "{{ vault }}", "changeme"):
            self.assertFalse(is_secret_value(value), value)

    def test_field_ids_are_stable_names(self):
        text = "a: 1\nPASSWORD: one-secret\nPASSWORD: two-secret\n"
        self.assertEqual({"PASSWORD#1": "one-secret", "PASSWORD#2": "two-secret"}, secret_fields(text, ".env"))
        self.assertEqual({"$.db.password": "s3cret-value"},
                         secret_fields('{"db": {"password": "s3cret-value", "host": "x"}}', ".json"))
        # Source code: only literals are values, never expressions.
        self.assertEqual({"TOKEN#1": "abc12345"}, secret_fields("TOKEN = 'abc12345'\nSECRET = os.environ['X']\n", ".py"))


class RedactorTests(unittest.TestCase):
    def test_text_assignments_and_known_values(self):
        redactor = Redactor({"leaked-value-123"})
        text = "user: digit\npassword: hunter2-long\nurl: http://x?k=leaked-value-123\n"
        self.assertEqual(
            "user: digit\npassword: <REDACTED>\nurl: http://x?k=<REDACTED>\n", redactor.redact(text, ".yml")
        )

    def test_json_is_structural_and_canonical(self):
        out = Redactor(()).redact('{"b": 1, "a": {"api_key": "zzz-123456"}}', ".json")
        self.assertEqual({"a": {"api_key": REDACTED}, "b": 1}, json.loads(out))
        self.assertTrue(out.startswith('{\n  "a"'))

    def test_source_code_expressions_survive(self):
        text = "TOKEN = os.environ['TOKEN']\n"
        self.assertEqual(text, Redactor(()).redact(text, ".py"))

    def test_line_endings_survive(self):
        self.assertEqual("password: <REDACTED>\r\nx: 1\r\n", Redactor(()).redact("password: abcdef12\r\nx: 1\r\n", ""))


class SecretFindingTests(unittest.TestCase):
    def test_classification(self):
        base = {"f": {"A#1": "h1", "B#1": "h1", "C#1": "h1"}}
        live = {"f": {"A#1": "h2", "B#1": "h2", "C#1": "h1"}}
        target = {"f": {"A#1": "h1", "B#1": "h3", "C#1": "h3"}}
        result = compare_secret_fields(base, live, target)
        self.assertEqual(
            [("A#1", "local-only", "warning"), ("B#1", "both-changed", "blocker")],
            [(f["field"], f["change"], f["severity"]) for f in result["findings"]],
        )


class RestoreTests(unittest.TestCase):
    def restore(self, candidate, base, live, target, path="kong/kong.yml"):
        sources = Sources(base=base, live=live, target=target, redactor=Redactor(()))
        return restore(candidate, path, sources), sources.conflicts

    def test_local_change_keeps_the_live_value(self):
        out, conflicts = self.restore(
            "a: 1\npassword: <REDACTED>\n", "a: 0\npassword: default-1\n",
            "a: 0\npassword: rotated-2\n", "a: 1\npassword: default-1\n",
        )
        self.assertEqual(("a: 1\npassword: rotated-2\n", []), (out, conflicts))

    def test_target_only_change_is_taken_not_reverted(self):
        # Live still has the base value, the target changed it: a live-first
        # restore would silently revert the new version's change.
        out, conflicts = self.restore(
            "local: edit\npassword: <REDACTED>\n", "local: x\npassword: old-value-1\n",
            "local: edit\npassword: old-value-1\n", "local: x\npassword: new-value-2\n",
        )
        self.assertEqual(("local: edit\npassword: new-value-2\n", []), (out, conflicts))

    def test_both_changed_keeps_live_and_reports(self):
        out, conflicts = self.restore(
            "x: 1\npassword: <REDACTED>\n", "x: 0\npassword: base-value-1\n",
            "x: 0\npassword: live-value-2\n", "x: 0\npassword: target-value-3\n",
        )
        self.assertEqual("x: 1\npassword: live-value-2\n", out)
        self.assertEqual(1, len(conflicts))

    def test_value_only_in_one_tree(self):
        out, _ = self.restore("token: <REDACTED>\n", None, "token: live-only-1\n", None, "configs/new.yml")
        self.assertEqual("token: live-only-1\n", out)

    def test_multiline_value_restored_from_the_whole_file(self):
        key = "-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----"
        live = f"name: x\n{key}\ntail: 1\n"
        out, _ = self.restore(f"name: x\n{REDACTED}\ntail: 1\n", None, live, None, "configs/key.pem")
        self.assertEqual(live, out)

    def test_repeated_lines_are_told_apart_by_their_neighbours(self):
        live = "[a]\npassword: first-value-1\n[b]\npassword: second-value-2\n"
        candidate = "[a]\npassword: first-value-1\n[b]\npassword: <REDACTED>\nnew: line\n"
        out, _ = self.restore(candidate, None, live, None, "configs/x.ini")
        self.assertEqual("[a]\npassword: first-value-1\n[b]\npassword: second-value-2\nnew: line\n", out)

    def test_ambiguity_is_an_error(self):
        live = "password: one-value-1\npassword: two-value-2\n"
        with self.assertRaises(RestoreError):
            self.restore("x\npassword: <REDACTED>\ny\n", None, live, None, "configs/x.ini")

    def test_json_leaves(self):
        candidate = json.dumps({"db": {"password": REDACTED, "user": "u"}, "n": 2}, indent=2, sort_keys=True) + "\n"
        live = json.dumps({"db": {"password": "live-secret-1", "user": "u"}, "n": 1})
        out, _ = self.restore(candidate, None, live, None, "configs/x.json")
        self.assertEqual({"db": {"password": "live-secret-1", "user": "u"}, "n": 2}, json.loads(out))


class MergeTests(TempDirCase):
    def trees(self, base, live, target):
        result = {}
        for name, files in (("base", base), ("live", live), ("target", target)):
            result[name] = self.tmp / name
            result[name].mkdir()
            for rel, text in files.items():
                write(result[name], rel, text)
        return result

    def test_non_overlapping_changes_merge(self):
        trees = self.trees({"a.yml": "1\n2\n3\n"}, {"a.yml": "one\n2\n3\n", "new.yml": "n\n"}, {"a.yml": "1\n2\nthree\n"})
        result = merge.merge(trees, self.tmp / "repo")
        self.assertEqual([], result.conflicts)
        self.assertEqual("one\n2\nthree\n", (self.tmp / "repo/a.yml").read_text())
        self.assertEqual({("M", "a.yml"), ("A", "new.yml")}, {(c["status"], c["path"]) for c in result.deployment_changes})

    def test_conflict_then_validated_resolution(self):
        trees = self.trees({"a.yml": "x\n", "b.yml": "b\n"}, {"a.yml": "live\n", "b.yml": "b\n"},
                           {"a.yml": "target\n", "b.yml": "b2\n"})
        repo = self.tmp / "repo"
        result = merge.merge(trees, repo)
        self.assertEqual(["a.yml"], result.conflicts)
        self.assertIn("||||||| ", (repo / "a.yml").read_text())  # diff3: base shown
        with self.assertRaisesRegex(NeedsOperator, "unresolved"):
            merge.conclude(repo, result.conflicts, result.stage0)
        (repo / "a.yml").write_text("both\n")
        merge.git(repo, "add", "a.yml")
        (repo / "b.yml").write_text("sneaky\n")
        merge.git(repo, "add", "b.yml")
        with self.assertRaisesRegex(NeedsOperator, "b.yml"):
            merge.conclude(repo, result.conflicts, result.stage0)
        merge.git(repo, "checkout", "MERGE_HEAD", "--", "b.yml")
        changes = merge.conclude(repo, result.conflicts, result.stage0)
        self.assertEqual([{"status": "M", "path": "a.yml"}], changes)

    def test_markers_and_typed_secrets_are_refused(self):
        trees = self.trees({"a.yml": "x\n"}, {"a.yml": "live\n"}, {"a.yml": "target\n"})
        repo = self.tmp / "repo"
        result = merge.merge(trees, repo)
        (repo / "a.yml").write_text("password: typed-in-secret\n")
        merge.git(repo, "add", "a.yml")
        with self.assertRaisesRegex(NeedsOperator, "secret value typed in"):
            merge.conclude(repo, result.conflicts, result.stage0)


class PrepareTests(TempDirCase):
    def test_normalized_hashes_are_reproducible(self):
        raw = {}
        for name, password in (("base", "base-pass-1"), ("live", "live-pass-2"), ("target", "base-pass-1")):
            raw[name] = self.tmp / f"raw-{name}"
            write(raw[name], "configs/app.yml", f"user: x\npassword: {password}\n")
            write(raw[name], ".env", "IGNORED=1\n")
        first = prepare(raw, self.tmp / "one", known_secrets={"tenant-secret-9"})
        second = prepare(raw, self.tmp / "two", known_secrets={"tenant-secret-9"})
        self.assertEqual(first.hashes, second.hashes)
        self.assertFalse((first.normalized["live"] / ".env").exists())
        self.assertIn(REDACTED, (first.normalized["live"] / "configs/app.yml").read_text())
        self.assertEqual(1, first.secrets["warning_count"])
        self.assertEqual([], leaks(self.tmp / "one", first.redactor.values))


class RenderHelperTests(TempDirCase):
    def test_tag_grafting_merges_existing_tags(self):
        playbook = (
            "- hosts: digit\n  tasks:\n"
            "    - name: \"Copy one\"\n      copy: {src: a, dest: b}\n"
            "    - name: Copy two\n      tags: ['x']\n      copy: {src: a, dest: b}\n"
            "    - name: Other\n      debug: {msg: hi}\n"
        )
        import yaml

        tasks = yaml.safe_load(render.tag_tasks(playbook, {"Copy one", "Copy two"}))[0]["tasks"]
        self.assertEqual([["render"], ["x", "render"], None], [t.get("tags") for t in tasks])

    def test_archive_escapes_are_refused(self):
        archive = self.tmp / "bad.tar"
        with tarfile.open(archive, "w") as bundle:
            info = tarfile.TarInfo("../escape")
            bundle.addfile(info, None)
        with self.assertRaises(UpgradeError):
            render.extract_tar(archive, self.tmp / "out")

    def test_escaping_links_are_skipped_only_when_asked(self):
        archive = self.tmp / "links.tar"
        with tarfile.open(archive, "w") as bundle:
            info = tarfile.TarInfo("node_modules")
            info.type, info.linkname = tarfile.SYMTYPE, "../../elsewhere"
            bundle.addfile(info)
        with self.assertRaises(UpgradeError):
            render.extract_tar(archive, self.tmp / "a")
        render.extract_tar(archive, self.tmp / "b", skip_unsafe_links=True)
        self.assertFalse((self.tmp / "b/node_modules").exists())


class MdmsTests(unittest.TestCase):
    def row(self, value, modified=1):
        return {"tenantid": "pg", "schemacode": "s", "uniqueidentifier": "u", "data": value, "lastmodifiedtime": modified}

    def test_changes_ignore_audit_columns(self):
        before = mdms.index({"eg_mdms_data": [self.row(1)]})
        self.assertEqual([], mdms.changes(before, mdms.index({"eg_mdms_data": [self.row(1, 99)]}))["modified"])
        changed = mdms.changes(before, mdms.index({"eg_mdms_data": [self.row(2)]}))["modified"]
        self.assertEqual(["modify"], [c["kind"] for c in changed])
        self.assertEqual(["delete"], [c["kind"] for c in mdms.changes(before, {"eg_mdms_data": {}})["modified"]])

    def test_resolution_must_cover_every_conflict_exactly(self):
        conflicts = mdms.changes(mdms.index({"eg_mdms_data": [self.row(1)]}),
                                 mdms.index({"eg_mdms_data": [self.row(2)]}))["modified"]
        with self.assertRaises(UpgradeError):
            mdms.resolve(conflicts, {})
        with self.assertRaises(UpgradeError):
            mdms.resolve(conflicts, {"eg_mdms_data:pg|s|u": "maybe"})
        keep = mdms.resolve(conflicts, {"eg_mdms_data:pg|s|u": "backup"})
        self.assertEqual(1, keep[0]["row"]["data"])
        self.assertIn("ON CONFLICT (tenantid, schemacode, uniqueidentifier)", mdms.restore_sql(keep))

    def test_verify_enforces_kept_rows_and_reports_the_rest(self):
        keep = [{"table": "eg_mdms_data", "key": "pg|s|u", "row": self.row(1)}]
        predicted = mdms.index({"eg_mdms_data": [self.row(1)]})
        after = mdms.index({"eg_mdms_data": [self.row(3)]})
        result = mdms.verify(after, predicted, keep)
        self.assertEqual(["eg_mdms_data:pg|s|u"], result["kept_rows_broken"])
        self.assertEqual(1, len(result["unpredicted_modified"]))

    def test_conflict_report_redacts_secret_fields(self):
        conflict = {"table": "t", "key": "k", "kind": "modify",
                    "backup": {"data": {"password": "p-123456"}}, "target": {"data": {"password": "q-123456"}}}
        self.assertNotIn("p-123456", json.dumps(mdms.conflict_report([conflict])))


class FakeDocker(deploy.Docker):
    def __init__(self, inspect, compose_config=None):
        self._inspect, self.compose_config, self.calls = inspect, compose_config, []
        super().__init__(self.fake_run)

    def fake_run(self, args, **_):
        self.calls.append(args)
        if args[:2] == ["docker", "inspect"]:
            return subprocess.CompletedProcess(args, 0, json.dumps([self._inspect[a] for a in args[2:]]), "")
        if "config" in args:
            return subprocess.CompletedProcess(args, 0, json.dumps(self.compose_config), "")
        return subprocess.CompletedProcess(args, 0, "", "")


class DeployPreflightTests(TempDirCase):
    def deployment(self, docker):
        run_dir = self.tmp / "run"
        run_dir.mkdir(exist_ok=True)
        (run_dir / "run.json").write_text(json.dumps({"tenant": "t", "status": "READY"}))
        return deploy.Deployment(run_dir, backup_parent=self.tmp / "b", resolution=None, docker=docker,
                                 tool_root=self.tmp)

    def stack(self, data_directory="/var/lib/postgresql/data"):
        return deploy.StackRecord(digit_dir=str(self.tmp), project="digit", compose_files=[], services=[],
                                  images={}, volumes=[], data_directory=data_directory)

    def postgres(self, mounts):
        return {deploy.POSTGRES: {"Mounts": mounts}}

    def test_data_in_an_anonymous_volume_is_refused(self):
        docker = FakeDocker(self.postgres([{"Type": "volume", "Name": "a" * 64,
                                            "Destination": "/var/lib/postgresql/data"}]))
        with self.assertRaisesRegex(UpgradeError, "not on the named volume"):
            self.deployment(docker)._check_postgres_storage(self.tmp, self.tmp, self.stack())

    def test_new_stack_must_mount_the_same_data(self):
        mounts = [{"Type": "volume", "Name": "digit_postgres_data", "Destination": "/var/lib/postgresql/data"}]
        wrong = {"services": {"postgres-db": {"volumes": [
            {"type": "volume", "source": "postgres_data", "target": "/var/lib/docker-postgresql/data"}]}}}
        write(self.tmp, "local-setup/docker-compose.upgrade-safe.yml", "services: {}\n")
        with self.assertRaisesRegex(UpgradeError, "would not mount postgres_data"):
            self.deployment(FakeDocker(self.postgres(mounts), wrong))._check_postgres_storage(self.tmp, self.tmp, self.stack())
        right = {"services": {"postgres-db": {"volumes": [
            {"type": "volume", "source": "postgres_data", "target": "/var/lib/postgresql/data"}]}}}
        self.deployment(FakeDocker(self.postgres(mounts), right))._check_postgres_storage(self.tmp, self.tmp, self.stack())

    def test_an_interrupted_run_must_be_recovered_first(self):
        first = self.deployment(FakeDocker({}))
        first.dir.mkdir()
        deploy.Journal(first.dir).enter("deploying")
        again = self.deployment(FakeDocker({}))
        with mock.patch.object(deploy, "LOCK_FILE", self.tmp / "lock"):
            with self.assertRaisesRegex(UpgradeError, "digit-upgrade rollback"):
                again.execute()


class ProcessGroupTests(unittest.TestCase):
    def test_interrupt_stops_the_whole_tree(self):
        process = subprocess.Popen(["bash", "-c", "sleep 300 & echo $!; wait"], stdout=subprocess.PIPE,
                                   text=True, start_new_session=True)
        child = int(process.stdout.readline())
        process.stdout.close()
        deploy.stop_process_group(process, grace=5)
        time.sleep(0.2)
        with self.assertRaises(ProcessLookupError):
            os.kill(child, 0)


class ReviewRegressionTests(TempDirCase):
    """Each test pins a defect found in review."""

    def test_a_failed_command_reports_its_own_output(self):
        with self.assertRaisesRegex(UpgradeError, r"(?s)exit 3.*boom"):
            run(["bash", "-c", "echo boom >&2; exit 3"])
        with self.assertRaisesRegex(UpgradeError, "PASSWORD=<REDACTED>"):
            run(["bash", "-c", "exit 1", "PASSWORD=hunter2-long"])

    def test_json_list_secrets_follow_the_element_not_its_position(self):
        def realm(*clients):
            return json.dumps({"clients": [{"clientId": c, "secret": v} for c, v in clients]}, indent=2, sort_keys=True)
        base = realm(("a", "a-old-secret"))
        live = realm(("a", "a-rotated-secret"))
        target = realm(("new", "new-client-secret"), ("a", "a-old-secret"))
        candidate = Redactor(()).redact(target, ".json")
        sources = Sources(base=base, live=live, target=target, redactor=Redactor(()))
        clients = json.loads(restore(candidate, "identity-keycloak-realm.json", sources))["clients"]
        self.assertEqual({"new": "new-client-secret", "a": "a-rotated-secret"},
                         {c["clientId"]: c["secret"] for c in clients})
        self.assertEqual([], sources.conflicts)

    def test_yaml_restores_by_field_and_keeps_formatting(self):
        base = "# settings\ndb:\n  user: x\n  password: base-secret-1\n"
        live = "# settings\ndb:\n  user: x\n  password: live-secret-2\n"
        target = "# settings\ndb:\n  user: y\n  password: base-secret-1\n"
        candidate = "# settings\ndb:\n  user: y\n  password: <REDACTED>\n"
        out = restore(candidate, "configs/a.yml", Sources(base=base, live=live, target=target, redactor=Redactor(())))
        self.assertEqual("# settings\ndb:\n  user: y\n  password: live-secret-2\n", out)

    def test_block_scalar_secrets_are_redacted_whole_and_restored(self):
        key = "-----BEGIN KEY-----\n    abcdefgh12345678\n    -----END KEY-----"
        live = f"name: x\nprivate_key: |\n    {key}\nafter: 1\n"
        redacted = Redactor(()).redact(live, ".yml")
        self.assertEqual("name: x\nprivate_key: |\n    <REDACTED>\nafter: 1\n", redacted)
        self.assertEqual(["k.yml"], leaks_in(self.tmp, "k.yml", live, "-----BEGIN KEY-----\nabcdefgh12345678\n-----END KEY-----\n"))
        out = restore(redacted, "configs/k.yml", Sources(base=None, live=live, target=None, redactor=Redactor(())))
        self.assertEqual(live, out)

    def test_code_fragments_are_not_secret_values(self):
        for fragment in ("await login();", "SECRET_REVIEW", "get_token(user)"):
            self.assertFalse(is_secret_value(fragment), fragment)

    def test_a_secret_the_target_moved_cannot_be_silently_replaced(self):
        live_root, target_root, overlay = (self.tmp / n for n in ("live", "target", "overlay"))
        write(live_root, "configs/a.yml", "db:\n  password: rotated-on-box\n")
        write(target_root, "configs/a.yml", "services:\n  db:\n    password: target-default\n")
        overlay.mkdir()
        deployment = deploy.Deployment.__new__(deploy.Deployment)
        deployment.manifest = {"secrets": {"findings": [
            {"path": "configs/a.yml", "field": "$.db.password", "change": "both-changed", "severity": "blocker"}]}}
        prepared = mock.Mock(raw={"live": live_root, "target": target_root})
        with self.assertRaisesRegex(UpgradeError, r"configs/a.yml \$\.db\.password"):
            deployment._check_secret_promise(prepared, overlay, [])

    def test_maintenance_rule_is_tagged_and_removed_completely(self):
        calls, present = [], {"n": 0}

        def runner(args, check=True, **_):
            calls.append(args)
            code = 0 if (args[1] == "-C" and present["n"]) else 1 if args[1] == "-C" else 0
            if args[1] == "-I":
                present["n"] += 1
            if args[1] == "-D":
                present["n"] -= 1
            return subprocess.CompletedProcess(args, code, "", "")

        with mock.patch.object(deploy.shutil, "which", side_effect=lambda t: t == "iptables"):
            maintenance = deploy.Maintenance([443, 80, 80], runner)
            maintenance.on()
            maintenance.on()  # idempotent
            maintenance.off()
        self.assertEqual(0, present["n"])
        inserted = next(c for c in calls if c[1] == "-I")
        self.assertIn(deploy.MAINTENANCE_TAG, inserted)
        self.assertIn("80,443", inserted)
        self.assertEqual(["!", "-i", "lo"], inserted[3:6])

    def stack_docker(self, crash_first_start=()):
        """A fake Docker with a three-level depends_on chain and per-container state."""
        config = {"services": {
            "postgres-db": {},
            "egov-mdms-service": {"depends_on": {"postgres-db": {}, "mdms-migration": {}}},
            "egov-user": {"depends_on": {"egov-mdms-service": {"condition": "service_healthy"}}},
        }}
        state = {}
        starts = []

        def runner(args, check=True, **_):
            out = ""
            if "config" in args:
                out = json.dumps(config)
            elif args[:3] == ["docker", "ps", "-a"]:
                out = args[-1].split("=")[-1]  # the container id is the service name
            elif args[:2] == ["docker", "inspect"]:
                out = json.dumps([{"State": state[args[2]]}])
            elif "up" in args or args[1] in ("start", "restart"):
                names = args[args.index("never") + 1:] if "up" in args else args[2:]
                starts.append((args[1] if args[1] != "compose" else "up", names))
                for name in names:
                    crashed = name in crash_first_start and args[1] != "restart"
                    state[name] = {"Running": not crashed, "Health": {"Status": "healthy"}}
            return subprocess.CompletedProcess(args, 0, out, "")

        docker = deploy.Docker(runner)
        deployment = deploy.Deployment.__new__(deploy.Deployment)
        deployment.docker, deployment.log = docker, lambda message: None
        stack = deploy.StackRecord(digit_dir=str(self.tmp), project="digit", compose_files=["/c.yml"],
                                   services=["egov-user", "postgres-db", "egov-mdms-service"], images={},
                                   volumes=[], data_directory="/d")
        return deployment, stack, starts

    def test_rollback_starts_in_dependency_waves_and_checks_the_database_first(self):
        deployment, stack, starts = self.stack_docker()
        order = []
        deployment._start_previous(stack, check_database=lambda: order.append(len(starts)))
        self.assertEqual([("up", ["postgres-db"]), ("up", ["egov-mdms-service"]), ("up", ["egov-user"])], starts)
        self.assertEqual([1], order)  # right after PostgreSQL, before any application

    def test_restart_starts_existing_containers_and_retries_a_lost_race_once(self):
        deployment, stack, starts = self.stack_docker(crash_first_start={"egov-user"})
        deployment.restart_previous(stack)
        self.assertEqual(
            [("start", ["postgres-db"]), ("start", ["egov-mdms-service"]), ("start", ["egov-user"]),
             ("restart", ["egov-user"])],
            starts,
        )


def leaks_in(root, rel, text, value):
    write(root, rel, text)
    return leaks(root, {value})


class CliTests(unittest.TestCase):
    def test_deploy_needs_explicit_confirmation(self):
        with self.assertRaises(SystemExit), mock.patch("sys.stderr"):
            cli.build_parser().parse_args(["deploy", "/tmp/run"])

    def test_overrides_are_yaml_and_secrets_are_refused(self):
        args = cli.build_parser().parse_args([
            "analyse", "--repo", ".", "--target-ref", "x", "--tenant", "t", "--tenant-vars", "v",
            "--backup", "b", "--output", "o", "--base-override", "enable_novu=false",
        ])
        self.assertEqual([("enable_novu", False)], args.base_override)
        with self.assertRaisesRegex(UpgradeError, "cannot set secrets"):
            analyse.analyse(repo=Path("."), target_ref="HEAD", base_ref=None, tenant="t",
                            tenant_vars=ROOT / "local-setup/ansible/inventory/host_vars/_example.yml",
                            base_overrides={"db_password": "x"}, backup=Path("."), output=Path("."), excludes=())


if __name__ == "__main__":
    unittest.main()
