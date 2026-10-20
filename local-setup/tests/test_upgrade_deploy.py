import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import upgrade_deploy as deploy  # noqa: E402
import upgrade_dry_run as dry  # noqa: E402


def row(identifier="one", value="before"):
    return {
        "id": identifier,
        "tenantid": "mz",
        "schemacode": "module.master",
        "uniqueidentifier": identifier,
        "data": {"value": value},
        "isactive": True,
    }


def empty_snapshot():
    return {table: {} for table in deploy.MDMS_TABLES}


class CommandRunnerTests(unittest.TestCase):
    def test_failure_reports_stdout_and_stderr(self):
        completed = deploy.subprocess.CompletedProcess(
            ["preflight"], 1, stdout="real validation failure\n", stderr="tool notice\n"
        )
        with mock.patch.object(deploy.subprocess, "run", return_value=completed):
            with self.assertRaises(deploy.DeployError) as raised:
                deploy.CommandRunner().run(["preflight"])
        self.assertIn("real validation failure", str(raised.exception))
        self.assertIn("tool notice", str(raised.exception))


class ProjectMetadataTests(unittest.TestCase):
    def test_stopped_one_shot_container_volume_is_excluded(self):
        class Runner:
            def __init__(self, volume_path):
                self.volume_path = volume_path
                self.inspected_volumes = []

            def run(self, args, **_kwargs):
                if args[:3] == ["docker", "inspect", "docker-postgres"]:
                    stdout = "digit\n"
                elif args[:3] == ["docker", "info", "--format"]:
                    stdout = str(self.volume_path.parents[2]) + "\n"
                elif args[:3] == ["docker", "ps", "-aq"]:
                    stdout = "running-id\nstopped-id\n"
                elif args[:2] == ["docker", "inspect"] and len(args) == 3:
                    running = args[2] == "running-id"
                    name = "keep-volume" if running else "vanishing-volume"
                    stdout = json.dumps(
                        [
                            {
                                "Config": {
                                    "Labels": {
                                        "com.docker.compose.service": "app" if running else "one-shot",
                                        "com.docker.compose.project.config_files": "/opt/digit/compose.yml",
                                    }
                                },
                                "State": {"Running": running},
                                "Mounts": [
                                    {
                                        "Type": "volume",
                                        "Name": name,
                                        "Destination": "/data",
                                    }
                                ],
                            }
                        ]
                    )
                elif args[:3] == ["docker", "volume", "inspect"]:
                    self.inspected_volumes.append(args[3])
                    stdout = json.dumps([{"Mountpoint": str(self.volume_path)}])
                elif args[0] == "du":
                    stdout = "1 path\n"
                else:
                    raise AssertionError(args)
                return deploy.subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

        with tempfile.TemporaryDirectory(dir=Path.cwd()) as tmp:
            root = Path(tmp)
            digit = root / "digit"
            backup = root / "backups"
            volume = root / "docker" / "volumes" / "keep-volume" / "_data"
            for path in (digit, backup, volume):
                path.mkdir(parents=True)
            runner = Runner(volume)
            upgrade = deploy.UpgradeDeployment(
                root / "run",
                root / "repo",
                "mycity",
                root / "tenant.yml",
                root / "source",
                backup,
                None,
                runner=runner,
                digit_dir=digit,
            )
            with mock.patch.object(
                deploy.shutil, "disk_usage", return_value=SimpleNamespace(free=10**12)
            ):
                upgrade._project_metadata()
            self.assertEqual(["app"], upgrade.previous_services)
            self.assertEqual(["keep-volume"], [item["name"] for item in upgrade.volume_map])
            self.assertEqual(["keep-volume"], runner.inspected_volumes)


class PreviousStackRecoveryTests(unittest.TestCase):
    def make_upgrade(self, root, runner):
        upgrade = deploy.UpgradeDeployment(
            root / "run",
            root / "repo",
            "mycity",
            root / "tenant.yml",
            root / "source",
            root / "backups",
            None,
            runner=runner,
            digit_dir=root / "digit",
        )
        upgrade.project = "digit"
        upgrade.compose_files = ["/opt/digit/compose.yml"]
        upgrade.previous_services = ["app", "postgres-db"]
        upgrade.previous_containers = {"app": "app-id", "postgres-db": "db-id"}
        return upgrade

    def test_existing_previous_containers_restart_without_compose(self):
        class Runner:
            def __init__(self):
                self.calls = []

            def run(self, args, **_kwargs):
                self.calls.append(args)
                return deploy.subprocess.CompletedProcess(args, 0, stdout="[]", stderr="")

        with tempfile.TemporaryDirectory(dir=Path.cwd()) as name:
            runner = Runner()
            self.make_upgrade(Path(name), runner)._compose_up_previous()
        self.assertEqual(
            ["docker", "start", "app-id", "db-id"], runner.calls[-1]
        )
        self.assertFalse(any(call[:2] == ["docker", "compose"] for call in runner.calls))

    def test_missing_previous_container_recreates_without_dependencies(self):
        class Runner:
            def __init__(self):
                self.calls = []

            def run(self, args, **_kwargs):
                self.calls.append(args)
                return deploy.subprocess.CompletedProcess(
                    args,
                    1 if args[:3] == ["docker", "inspect", "app-id"] else 0,
                    stdout="",
                    stderr="",
                )

        with tempfile.TemporaryDirectory(dir=Path.cwd()) as name:
            runner = Runner()
            self.make_upgrade(Path(name), runner)._compose_up_previous()
        compose = runner.calls[-1]
        self.assertEqual(["docker", "compose"], compose[:2])
        self.assertIn("--no-deps", compose)
        self.assertEqual("never", compose[compose.index("--pull") + 1])


class CandidateComposeValidationTests(unittest.TestCase):
    def test_all_profiles_are_validated_before_deployment(self):
        class Runner:
            def __init__(self):
                self.calls = []

            def run(self, args, **kwargs):
                self.calls.append((args, kwargs))
                return deploy.subprocess.CompletedProcess(
                    args, 0, stdout="", stderr=""
                )

        with tempfile.TemporaryDirectory(dir=Path.cwd()) as name:
            root = Path(name)
            candidate = root / "run" / "candidate"
            candidate.mkdir(parents=True)
            for compose_name in (
                "docker-compose.egov-digit.yaml",
                "docker-compose.migrations.yml",
                "docker-compose.monitoring.yml",
                "docker-compose.matomo.yml",
                "docker-compose.opensre.yml",
                "docker-compose.upgrade-safe.yml",
            ):
                (candidate / compose_name).write_text("services: {}\n")
            runner = Runner()
            upgrade = deploy.UpgradeDeployment(
                root / "run",
                root / "repo",
                "mycity",
                root / "tenant.yml",
                root / "source",
                root / "backups",
                None,
                runner=runner,
                digit_dir=root / "digit",
            )
            upgrade._validate_candidate_compose()

        args, kwargs = runner.calls[-1]
        self.assertEqual(["docker", "compose"], args[:2])
        self.assertEqual(["--profile", "*", "config", "--quiet"], args[-4:])
        self.assertEqual(candidate, kwargs["cwd"])

    def test_missing_compose_file_is_rejected_without_running_docker(self):
        class Runner:
            def run(self, args, **kwargs):
                raise AssertionError((args, kwargs))

        with tempfile.TemporaryDirectory(dir=Path.cwd()) as name:
            root = Path(name)
            (root / "run" / "candidate").mkdir(parents=True)
            upgrade = deploy.UpgradeDeployment(
                root / "run",
                root / "repo",
                "mycity",
                root / "tenant.yml",
                root / "source",
                root / "backups",
                None,
                runner=Runner(),
                digit_dir=root / "digit",
            )
            with self.assertRaisesRegex(
                deploy.DeployError, "missing deployment Compose file"
            ):
                upgrade._validate_candidate_compose()


class MdmsSnapshotTests(unittest.TestCase):
    def test_summary_is_deterministic_and_records_counts(self):
        first = empty_snapshot()
        first["eg_mdms_data"] = {"mz|module.master|one": row()}
        second = empty_snapshot()
        second["eg_mdms_data"] = dict(reversed(list(first["eg_mdms_data"].items())))
        self.assertEqual(deploy.snapshot_summary(first), deploy.snapshot_summary(second))
        table = deploy.snapshot_summary(first)["eg_mdms_data"]
        self.assertEqual(1, table["count"])
        self.assertEqual(1, table["counts_by_tenant_schema"]["mz|module.master"])

    def test_target_update_and_delete_are_conflicts_but_addition_is_expected(self):
        before = empty_snapshot()
        before["eg_mdms_data"] = {
            "mz|module.master|one": row("one", "local"),
            "mz|module.master|gone": row("gone", "keep"),
        }
        target = empty_snapshot()
        target["eg_mdms_data"] = {
            "mz|module.master|one": row("one", "target"),
            "mz|module.master|new": row("new", "added"),
        }
        delta = deploy.mdms_delta(before, target)
        self.assertEqual(["delete", "modify"], sorted(item["kind"] for item in delta["conflicts"]))
        self.assertEqual("mz|module.master|new", delta["additions"][0]["key"])

    def test_audit_timestamp_differences_do_not_create_false_conflicts(self):
        before = empty_snapshot()
        target = empty_snapshot()
        old = row()
        old["lastmodifiedtime"] = 100
        new = dict(old)
        new["lastmodifiedtime"] = 200
        before["eg_mdms_data"]["mz|module.master|one"] = old
        target["eg_mdms_data"]["mz|module.master|one"] = new
        self.assertEqual([], deploy.mdms_delta(before, target)["conflicts"])
        self.assertEqual(deploy.snapshot_summary(before), deploy.snapshot_summary(target))

    def test_resolutions_require_every_exact_conflict_key(self):
        before = empty_snapshot()
        target = empty_snapshot()
        old = row("one", "local")
        new = row("one", "target")
        before["eg_mdms_data"]["mz|module.master|one"] = old
        target["eg_mdms_data"]["mz|module.master|one"] = new
        conflicts = deploy.mdms_delta(before, target)["conflicts"]
        with self.assertRaises(deploy.MdmsConflict):
            deploy.apply_resolutions(target, conflicts, {})
        expected, restore = deploy.apply_resolutions(
            target,
            conflicts,
            {"eg_mdms_data:mz|module.master|one": "backup"},
        )
        self.assertEqual(old, expected["eg_mdms_data"]["mz|module.master|one"])
        self.assertEqual(old, restore[0]["row"])


class OverlayTests(unittest.TestCase):
    def test_materializes_secret_assignment_from_live_file(self):
        candidate = "DOMAIN=example.test\nPASSWORD=<REDACTED>\n"
        live = "DOMAIN=old.test\nPASSWORD=current-secret\n"
        result = deploy.materialize_redactions(candidate, live, ".env.example")
        self.assertIn("DOMAIN=example.test", result)
        self.assertIn("PASSWORD=current-secret", result)
        self.assertNotIn(deploy.REDACTED, result)

    def test_restores_complete_backup_file_when_only_redacted_spans_differ(self):
        candidate = "header\n<REDACTED>\nTOKEN=<REDACTED>\nfooter\n"
        live = "header\nPRIVATE_KEY=line-1\nline-2\nTOKEN=live-token\nfooter\n"
        self.assertEqual(live, deploy.materialize_redactions(candidate, live, "compose.yml"))

    def test_materializes_embedded_shell_assignment_from_unique_live_line(self):
        candidate = "docker run -e USER=egov -e PASSWORD=<REDACTED> image\n"
        live = "docker run -e USER=egov -e PASSWORD=current-secret image\n"
        result = deploy.materialize_redactions(candidate, live, "test.sh")
        self.assertEqual(live, result)

    def test_rejects_ambiguous_embedded_shell_assignment(self):
        candidate = "docker run -e PASSWORD=<REDACTED> image\n"
        live = (
            "docker run -e PASSWORD=first image\n"
            "docker run -e PASSWORD=second image\n"
        )
        with self.assertRaises(deploy.DeployError):
            deploy.materialize_redactions(candidate, live, "test.sh")

    def test_materializes_repeated_placeholder_by_same_line_context(self):
        candidate = ': "<REDACTED>"\nunchanged\n: "<REDACTED>"\n'
        live = ': "first"\nunchanged\n: "second"\n'
        self.assertEqual(live, deploy.materialize_redactions(candidate, live, "seed.sh"))

    def test_materializes_unique_inline_json_field_after_target_edit(self):
        candidate = 'BODY="{\\"authToken\\":\\"<REDACTED>\\",\\"newField\\":true}"\n'
        live = 'BODY="{\\"authToken\\":\\"live-token\\",\\"oldField\\":true}"\n'
        expected = 'BODY="{\\"authToken\\":\\"live-token\\",\\"newField\\":true}"\n'
        self.assertEqual(expected, deploy.materialize_redactions(candidate, live, "seed.sh"))

    def test_rejects_redaction_without_matching_live_assignment(self):
        with self.assertRaises(deploy.DeployError):
            deploy.materialize_redactions('"password": "<REDACTED>"\n', "", "config.json")

    def test_materializes_nested_json_secret_from_live_file(self):
        candidate = json.dumps({"auth": {"token": deploy.REDACTED}, "enabled": True})
        live = json.dumps({"auth": {"token": "current-token"}, "enabled": False})
        result = json.loads(deploy.materialize_redactions(candidate, live, "config.json"))
        self.assertEqual("current-token", result["auth"]["token"])
        self.assertTrue(result["enabled"])

    def test_sanitizes_secret_values_in_conflict_details(self):
        value = {"data": {"password": "do-not-report", "name": "visible"}}
        clean = deploy.sanitize_structure(value)
        self.assertEqual(deploy.REDACTED, clean["data"]["password"])
        self.assertEqual("visible", clean["data"]["name"])

    def test_sanitizes_secret_values_in_command_diagnostics(self):
        command, detail = deploy.sanitized_command(
            ["docker", "run", "-e", "FLYWAY_PASSWORD=temporary-secret", "image"],
            "authentication failed for temporary-secret",
        )
        self.assertNotIn("temporary-secret", command)
        self.assertNotIn("temporary-secret", detail)
        self.assertIn("FLYWAY_PASSWORD=<REDACTED>", command)

    def test_materialized_overlay_skips_runtime_env_and_tracks_deletions(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as name:
            root = Path(name)
            run_dir = root / "run"
            candidate = run_dir / "candidate"
            live = root / "digit"
            candidate.mkdir(parents=True)
            live.mkdir()
            (candidate / ".env").write_text("PASSWORD=<REDACTED>\n", encoding="utf-8")
            (candidate / "config.yml").write_text("TOKEN=<REDACTED>\nvalue=new\n", encoding="utf-8")
            (live / "config.yml").write_text("TOKEN=live-secret\nvalue=old\n", encoding="utf-8")
            (run_dir / "report.json").write_text(
                json.dumps(
                    {
                        "status": "READY",
                        "rebase": {
                            "local_changes": [
                                {"status": "M", "path": ".env"},
                                {"status": "M", "path": "config.yml"},
                                {"status": "D", "path": "obsolete.yml"},
                            ]
                        },
                    }
                ),
                encoding="utf-8",
            )
            overlay, deleted, hashes = deploy.materialize_overlay(
                run_dir, live, live, live
            )
            self.assertFalse((overlay / ".env").exists())
            self.assertEqual(["obsolete.yml"], deleted)
            self.assertIn("config.yml", hashes)
            self.assertIn("TOKEN=live-secret", (overlay / "config.yml").read_text())

    def test_unsafe_metadata_path_is_rejected(self):
        for value in ("../etc/passwd", "/etc/passwd", ""):
            with self.assertRaises(deploy.DeployError):
                deploy.safe_relative(value)


class PlaybookCompatibilityTests(unittest.TestCase):
    def test_upgrade_overlay_is_opt_in_and_normal_seed_path_stays_enabled(self):
        root = Path(__file__).resolve().parents[2]
        playbook = (root / "local-setup/ansible/playbook-deploy.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "(' -f docker-compose.upgrade-safe.yml' if (upgrade_safe_mode | default(false) | bool) else '')",
            playbook,
        )
        self.assertIn(
            "and not (upgrade_safe_mode | default(false) | bool)", playbook
        )
        self.assertIn(
            "not (upgrade_safe_mode | default(false) | bool)", playbook
        )
        self.assertNotIn("upgrade_safe_mode | default(true)", playbook)


class DeployCliTests(unittest.TestCase):
    def test_deploy_accepts_the_verified_analysis_backup(self):
        args = dry.parse_args(
            [
                "--deploy-run", "run",
                "--repo", "repo",
                "--tenant", "mycity",
                "--tenant-vars", "mycity.yml",
                "--backup", "digit-backup",
                "--confirm-deploy",
            ]
        )
        self.assertEqual(Path("digit-backup"), args.backup)

    def test_deploy_requires_explicit_confirmation(self):
        with self.assertRaises(SystemExit):
            dry.parse_args(
                [
                    "--deploy-run", "run",
                    "--repo", "repo",
                    "--tenant", "mycity",
                    "--tenant-vars", "mycity.yml",
                ]
            )

    def test_deploy_mode_is_separate_from_resume(self):
        with self.assertRaises(SystemExit):
            dry.parse_args(
                [
                    "--deploy-run", "run",
                    "--resume-workspace", "workspace",
                    "--confirm-deploy",
                ]
            )


if __name__ == "__main__":
    unittest.main()
