import io
import importlib.util
import json
import os
import shutil
import stat
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import upgrade_dry_run as dry  # noqa: E402


def temp_directory():
    """Use the checkout because the Windows test sandbox restricts %TEMP%."""
    return tempfile.TemporaryDirectory(dir=Path.cwd())


def write(root: Path, relative: str, content: bytes | str) -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")
    return path


class RedactionAndNormalizationTests(unittest.TestCase):
    def test_detects_non_utf8_binary_without_nul_bytes(self):
        self.assertTrue(dry.is_binary_bytes(b"\xff\xfe\xfd"))
        self.assertFalse(dry.is_binary_bytes(b"plain text\n"))

    def test_redacts_assignments_and_json_without_touching_normal_values(self):
        value = (
            "DOMAIN=example.test\n"
            "POSTGRES_PASSWORD=actual-secret\n"
            '"apiToken": "actual-token", "enabled": true\n'
        )
        clean = dry.redact_text(value)
        self.assertIn("DOMAIN=example.test", clean)
        self.assertNotIn("actual-secret", clean)
        self.assertNotIn("actual-token", clean)
        self.assertGreaterEqual(clean.count("<REDACTED>"), 2)

    def test_secret_audit_finds_input_values_without_returning_values(self):
        values = dry.sensitive_values(
            {"domain": "example.test", "credentials": {"api_token": "hidden-123"}}
        )
        self.assertEqual({b"hidden-123"}, values)
        with temp_directory() as name:
            root = Path(name)
            write(root, "safe.env", "TOKEN=<REDACTED>\n")
            write(root, "unsafe.txt", "value=hidden-123\n")
            self.assertEqual(["unsafe.txt"], dry.find_secret_leaks(root, values))

    def test_exact_input_secret_is_redacted_outside_assignment(self):
        clean = dry.redact_text(
            "A documented default is hidden-123.\n", {b"hidden-123"}
        )
        self.assertEqual("A documented default is <REDACTED>.\n", clean)

    def test_secret_change_is_blocked_without_exposing_value_or_digest(self):
        with temp_directory() as name:
            root = Path(name)
            current = root / "current"
            backup = root / "backup"
            target = root / "target"
            write(current, ".env", "API_TOKEN=old-secret\n")
            write(backup, ".env", "API_TOKEN=local-secret\n")
            write(target, ".env", "API_TOKEN=target-secret\n")
            key = b"test-only-ephemeral-key"
            current_state, _ = dry.scan_tree_secrets(current, key)
            backup_state, _ = dry.scan_tree_secrets(backup, key)
            target_state, _ = dry.scan_tree_secrets(target, key)
            result = dry.compare_secret_states(
                current_state, backup_state, target_state
            )
            serialized = json.dumps(result)
            self.assertTrue(result["blocked"])
            self.assertEqual("conflict", result["findings"][0]["change"])
            for forbidden in (
                "old-secret",
                "local-secret",
                "target-secret",
                next(iter(backup_state[".env"].values())),
            ):
                self.assertNotIn(forbidden, serialized)

            output = root / "output"
            output.mkdir()
            report = {
                "status": "BLOCKED",
                "base_ref": "old",
                "base_commit": "a" * 40,
                "target_ref": "new",
                "target_commit": "b" * 40,
                "rebase": {"conflicts": [], "local_changes": []},
                "secrets": result,
            }
            dry.write_report(output, report)
            rendered_report = (output / "report.json").read_text() + (
                output / "report.md"
            ).read_text()
            self.assertNotIn("local-secret", rendered_report)
            self.assertNotIn(next(iter(backup_state[".env"].values())), rendered_report)

    def test_local_only_secret_change_warns_without_blocking(self):
        with temp_directory() as name:
            root = Path(name)
            current = root / "current"
            backup = root / "backup"
            target = root / "target"
            write(current, ".env", "API_TOKEN=<REDACTED>\n")
            write(backup, ".env", "API_TOKEN=runtime-secret\n")
            write(target, ".env", "API_TOKEN=<REDACTED>\n")
            key = b"test-only-ephemeral-key"
            current_state, _ = dry.scan_tree_secrets(current, key)
            backup_state, _ = dry.scan_tree_secrets(backup, key)
            target_state, _ = dry.scan_tree_secrets(target, key)
            result = dry.compare_secret_states(
                current_state, backup_state, target_state
            )
            self.assertFalse(result["blocked"])
            self.assertEqual("local-only", result["findings"][0]["change"])
            self.assertEqual("warning", result["findings"][0]["severity"])

    def test_secret_change_matching_target_is_not_a_conflict(self):
        with temp_directory() as name:
            root = Path(name)
            current = root / "current"
            backup = root / "backup"
            target = root / "target"
            write(current, ".env", "API_TOKEN=old-secret\n")
            write(backup, ".env", "API_TOKEN=new-secret\n")
            write(target, ".env", "API_TOKEN=new-secret\n")
            key = b"test-only-ephemeral-key"
            current_state, _ = dry.scan_tree_secrets(current, key)
            backup_state, _ = dry.scan_tree_secrets(backup, key)
            target_state, _ = dry.scan_tree_secrets(target, key)
            result = dry.compare_secret_states(
                current_state, backup_state, target_state
            )
            self.assertFalse(result["blocked"])
            self.assertEqual([], result["findings"])

    def test_scans_nested_yaml_and_json_secret_fields(self):
        with temp_directory() as name:
            root = Path(name)
            write(root, "config.yml", "service:\n  password: yaml-secret\n")
            write(root, "config.json", '{"auth":{"apiToken":"json-secret"}}')
            state, values = dry.scan_tree_secrets(root, b"ephemeral")
            self.assertTrue(
                any("password" in field for field in state["config.yml"])
            )
            self.assertIn("$.auth.apiToken", state["config.json"])
            self.assertEqual({b"yaml-secret", b"json-secret"}, values)

    def test_ignores_secret_metadata_and_source_variable_assignments(self):
        with temp_directory() as name:
            root = Path(name)
            source = root / "source"
            normalized = root / "normalized"
            write(source, ".env", "TOKEN_EXCHANGE_SYSTEM_USER_TYPE=EMPLOYEE\n")
            write(
                source,
                "loader.py",
                'self.password = password\napi_token = "literal-secret"\n',
            )
            state, values = dry.scan_tree_secrets(source, b"ephemeral")
            self.assertNotIn(".env", state)
            self.assertEqual({b"literal-secret"}, values)
            dry.normalize_tree(source, normalized, values)
            rendered = (normalized / "loader.py").read_text()
            self.assertIn("self.password = password", rendered)
            self.assertNotIn("literal-secret", rendered)

    def test_secret_metadata_keys_are_not_treated_as_secret_values(self):
        values = dry.sensitive_values(
            {"secrets_path": "secret/digit/city", "token_user_type": "EMPLOYEE"}
        )
        self.assertEqual(set(), values)

    def test_redacts_secret_values_in_manifest_structures(self):
        value = {
            "enable_novu": False,
            "bootstrap_secrets": {"postgres_password": "hidden-value"},
        }
        redacted = dry.redact_sensitive_structure(value)
        self.assertFalse(redacted["enable_novu"])
        self.assertEqual(
            "<REDACTED>", redacted["bootstrap_secrets"]["postgres_password"]
        )

    def test_excludes_openbao_cache_dump_and_progress_but_keeps_unknown_files(self):
        with temp_directory() as name:
            root = Path(name)
            source = root / "source"
            target = root / "target"
            write(source, ".openbao/init.json", "top-secret")
            write(source, ".build/cache/file", "cache")
            write(source, "db/full-dump.sql", "dump")
            write(source, "digit-stack-up.city.progress", "progress")
            write(source, "ci-tests/result.txt", "test output")
            write(source, "e2e-tests/result.txt", "test output")
            write(source, "configurator/assets/index.js", "built frontend")
            write(source, "digit-mcp/src/server.py", "locally built component")
            write(source, "custom/operator.conf", "keep=true\n")
            metadata = dry.normalize_tree(source, target)
            self.assertTrue((target / "custom/operator.conf").exists())
            self.assertFalse((target / ".openbao/init.json").exists())
            self.assertFalse((target / ".build/cache/file").exists())
            self.assertFalse((target / "ci-tests/result.txt").exists())
            self.assertFalse((target / "e2e-tests/result.txt").exists())
            self.assertFalse((target / "configurator/assets/index.js").exists())
            self.assertFalse((target / "digit-mcp/src/server.py").exists())
            self.assertNotIn("db/full-dump.sql", metadata)

    def test_records_symlink_and_executable_metadata(self):
        if os.name == "nt":
            self.skipTest("ordinary Windows sessions may not create symlinks")
        with temp_directory() as name:
            root = Path(name)
            source = root / "source"
            target = root / "target"
            script = write(source, "bin/run.sh", "#!/bin/sh\n")
            script.chmod(0o755)
            os.symlink("run.sh", source / "bin/link")
            metadata = dry.normalize_tree(source, target)
            self.assertEqual(metadata["bin/link"]["type"], "symlink")
            self.assertTrue(metadata["bin/run.sh"]["mode"] & stat.S_IXUSR)

    def test_supports_additional_exclusions(self):
        with temp_directory() as name:
            root = Path(name)
            source = root / "source"
            target = root / "target"
            write(source, "operator/keep.yml", "keep: true\n")
            write(source, "runtime/noise.bin", b"noise")
            metadata = dry.normalize_tree(
                source, target, extra_excludes=("runtime", "runtime/**")
            )
            self.assertIn("operator/keep.yml", metadata)
            self.assertNotIn("runtime/noise.bin", metadata)


class RebaseTests(unittest.TestCase):
    def rebase(self, base_files, local_files, target_files):
        temp = temp_directory()
        root = Path(temp.name)
        for directory, files in (
            (root / "base", base_files),
            (root / "local", local_files),
            (root / "target", target_files),
        ):
            directory.mkdir()
            for path, value in files.items():
                write(directory, path, value)
        output = root / "output"
        output.mkdir()
        result = dry.rebase_local_changes(
            root / "base", root / "local", root / "target", root, output
        )
        return temp, root, output, result

    def test_non_overlapping_edits_merge(self):
        base = "a=1\n" + "\n".join(f"keep{i}=1" for i in range(10)) + "\nb=1\n"
        local = base.replace("a=1", "a=2", 1)
        target = base.replace("b=1", "b=2", 1)
        temp, _, output, result = self.rebase(
            {"config": base},
            {"config": local},
            {"config": target},
        )
        self.addCleanup(temp.cleanup)
        self.assertEqual([], result["conflicts"])
        merged = (output / "candidate/config").read_text()
        self.assertIn("a=2", merged)
        self.assertIn("b=2", merged)

    def test_same_line_edit_is_conflict_and_candidate_is_not_created(self):
        temp, _, output, result = self.rebase(
            {"config": "value=old\n"},
            {"config": "value=local\n"},
            {"config": "value=target\n"},
        )
        self.addCleanup(temp.cleanup)
        self.assertEqual("config", result["conflicts"][0]["path"])
        self.assertIn("<<<<<<<", (output / "conflicts/config").read_text())
        self.assertFalse((output / "candidate").exists())
        workspace = output / "resolution-workspace"
        self.assertEqual(str(workspace), result["resolution_workspace"])
        self.assertTrue((workspace / "repository/.git").exists())
        state = json.loads((workspace / "state.json").read_text())
        self.assertEqual(2, state["version"])
        self.assertIn("config", state["allowed_resolution_paths"])
        self.assertIn(
            "config",
            dry.git(
                workspace / "repository",
                "diff",
                "--name-only",
                "--diff-filter=U",
            ).stdout,
        )

    def test_resume_requires_resolution_then_creates_candidate(self):
        temp, _, output, result = self.rebase(
            {"config": "value=old\n"},
            {"config": "value=local\n"},
            {"config": "value=target\n"},
        )
        self.addCleanup(temp.cleanup)
        workspace = output / "resolution-workspace"
        with self.assertRaises(dry.ResolutionPending):
            dry.resume_resolution_workspace(workspace)

        repository = workspace / "repository"
        dry.git(repository, "checkout", "--theirs", "--", "config")
        dry.git(repository, "add", "config")
        report = {
            "status": "BLOCKED",
            "base_ref": "old",
            "base_commit": "a" * 40,
            "target_ref": "new",
            "target_commit": "b" * 40,
            "rebase": result,
            "secrets": {
                "blocked": False,
                "blocker_count": 0,
                "warning_count": 0,
                "findings": [],
            },
            "output": str(output),
        }
        (output / "report.json").write_text(json.dumps(report))
        (output / "run-manifest.json").write_text(
            json.dumps({"candidate_created": False, "deployment_performed": False})
        )

        resumed = dry.resume_resolution_workspace(workspace)
        self.assertFalse(resumed["already_completed"])
        self.assertEqual(
            "value=local\n", (output / "candidate/config").read_text()
        )
        final_report = json.loads((output / "report.json").read_text())
        self.assertEqual("READY", final_report["status"])
        self.assertEqual([], final_report["rebase"]["conflicts"])
        self.assertEqual(1, len(final_report["rebase"]["original_conflicts"]))
        self.assertFalse((output / "candidate/.git").exists())

    def test_resume_requires_explicit_secret_review_acknowledgement(self):
        temp, _, output, result = self.rebase(
            {"config": "value=old\n"},
            {"config": "value=local\n"},
            {"config": "value=target\n"},
        )
        self.addCleanup(temp.cleanup)
        workspace = output / "resolution-workspace"
        repository = workspace / "repository"
        dry.git(repository, "checkout", "--theirs", "--", "config")
        dry.git(repository, "add", "config")
        report = {
            "status": "BLOCKED",
            "base_ref": "old",
            "base_commit": "a" * 40,
            "target_ref": "new",
            "target_commit": "b" * 40,
            "rebase": result,
            "secrets": {
                "blocked": True,
                "blocker_count": 1,
                "warning_count": 0,
                "findings": [],
            },
            "output": str(output),
        }
        (output / "report.json").write_text(json.dumps(report))
        (output / "run-manifest.json").write_text(
            json.dumps({"candidate_created": False, "deployment_performed": False})
        )
        with self.assertRaises(dry.ResolutionPending):
            dry.resume_resolution_workspace(workspace)
        resumed = dry.resume_resolution_workspace(
            workspace, acknowledge_secret_review=True
        )
        self.assertTrue(Path(resumed["candidate"]).is_dir())
        manifest = json.loads((output / "run-manifest.json").read_text())
        self.assertTrue(manifest["secret_review_acknowledged"])

    def test_add_delete_and_binary_change_are_bundled(self):
        temp, _, output, result = self.rebase(
            {"delete-me": "old", "binary": b"\0old"},
            {"added": "local", "binary": b"\0local"},
            {"delete-me": "old", "binary": b"\0old"},
        )
        self.addCleanup(temp.cleanup)
        self.assertEqual([], result["conflicts"])
        self.assertTrue((output / "local-files/added").exists())
        self.assertTrue((output / "local-files/binary").exists())
        self.assertIn("delete-me", json.loads((output / "deletions.json").read_text()))

    def test_binary_changed_on_both_sides_is_conflict(self):
        temp, _, output, result = self.rebase(
            {"binary": b"\0old"},
            {"binary": b"\0local"},
            {"binary": b"\0target"},
        )
        self.addCleanup(temp.cleanup)
        self.assertEqual("binary-or-file-level", result["conflicts"][0]["kind"])
        self.assertFalse((output / "candidate").exists())


class InputSafetyTests(unittest.TestCase):
    def test_rejects_archive_path_traversal(self):
        with temp_directory() as name:
            root = Path(name)
            archive = root / "bad.tar"
            with tarfile.open(archive, "w") as bundle:
                info = tarfile.TarInfo("../escape")
                payload = b"bad"
                info.size = len(payload)
                bundle.addfile(info, io.BytesIO(payload))
            with self.assertRaises(dry.DryRunError):
                dry.safe_extract_tar(archive, root / "out")

    def test_skips_unsafe_links_only_for_excluded_archive_paths(self):
        with temp_directory() as name:
            root = Path(name)
            archive = root / "excluded-link.tar"
            with tarfile.open(archive, "w") as bundle:
                info = tarfile.TarInfo("frontend/node_modules")
                info.type = tarfile.SYMTYPE
                info.linkname = "/developer/workstation/node_modules"
                bundle.addfile(info)
            destination = root / "out"
            destination.mkdir()
            dry.safe_extract_tar(archive, destination)
            self.assertFalse((destination / "frontend/node_modules").exists())

            unsafe_archive = root / "unsafe-link.tar"
            with tarfile.open(unsafe_archive, "w") as bundle:
                info = tarfile.TarInfo("configuration")
                info.type = tarfile.SYMTYPE
                info.linkname = "/etc/passwd"
                bundle.addfile(info)
            with self.assertRaises(dry.DryRunError):
                dry.safe_extract_tar(unsafe_archive, root / "unsafe-out")

    @unittest.skipUnless(importlib.util.find_spec("yaml"), "PyYAML is not installed")
    def test_base_override_is_applied_only_to_temporary_copy(self):
        with temp_directory() as name:
            root = Path(name)
            source = write(root, "tenant.yml", "enable_novu: true\ndomain: example.test\n")
            destination = root / "base.yml"
            overrides = dry.parse_base_overrides(["enable_novu=false"])
            rendered = dry.write_base_tenant_yaml(source, destination, overrides)
            self.assertFalse(rendered["enable_novu"])
            self.assertIn("enable_novu: true", source.read_text())
            self.assertIn("enable_novu: false", destination.read_text())

    @unittest.skipUnless(importlib.util.find_spec("yaml"), "PyYAML is not installed")
    def test_rejects_duplicate_or_malformed_base_overrides(self):
        with self.assertRaises(dry.DryRunError):
            dry.parse_base_overrides(["enable_novu=false", "enable_novu=true"])
        with self.assertRaises(dry.DryRunError):
            dry.parse_base_overrides(["missing-separator"])

    def test_rejects_malformed_tenant_yaml(self):
        with temp_directory() as name:
            path = write(Path(name), "tenant.yml", "tenant: [unterminated\n")
            with self.assertRaises(dry.DryRunError):
                dry.validate_tenant_yaml(path)

    def test_missing_git_ref_is_an_input_error(self):
        with temp_directory() as name:
            repo = Path(name)
            dry.run(["git", "init", "-q"], cwd=repo)
            with self.assertRaises(dry.DryRunError):
                dry.resolve_ref(repo, "does-not-exist")


class RendererContractTests(unittest.TestCase):
    def test_renderer_is_local_only_and_covers_core_destinations(self):
        root = Path(__file__).resolve().parents[1]
        renderer = (root / "ansible/playbook-render.yml").read_text(encoding="utf-8")
        forbidden = ("docker compose", "ansible.builtin.uri", "wait_for:", "deploy.sh")
        for value in forbidden:
            self.assertNotIn(value, renderer)
        for value in (
            "docker-compose.egov-digit.yaml",
            "digit.env.j2",
            "globalConfigs.js.j2",
            "configurator-config.js.j2",
            "keycloak-realm.json.j2",
            "notification-seed",
            "matomo-bootstrap.php",
            "matomo-db.ini",
        ):
            self.assertIn(value, renderer)

    def test_unknown_deployment_destination_fails_closed(self):
        with temp_directory() as name:
            root = Path(name)
            write(
                root,
                "local-setup/ansible/playbook-deploy.yml",
                '- copy:\n    dest: "{{ digit_dir }}/future-generated.conf"\n',
            )
            with self.assertRaises(dry.DryRunError):
                dry.validate_render_contract(root)

    def test_known_deployment_destination_is_accepted(self):
        with temp_directory() as name:
            root = Path(name)
            write(
                root,
                "local-setup/ansible/playbook-deploy.yml",
                '- template:\n    dest: "{{ digit_dir }}/nginx/globalConfigs.js"\n',
            )
            dry.validate_render_contract(root)

    def test_unknown_shell_destination_fails_closed(self):
        with temp_directory() as name:
            root = Path(name)
            write(
                root,
                "local-setup/ansible/playbook-deploy.yml",
                '- shell: echo value > "{{ digit_dir }}/future-generated.conf"\n',
            )
            with self.assertRaises(dry.DryRunError):
                dry.validate_render_contract(root)

    def test_unknown_destination_in_included_tasks_fails_closed(self):
        with temp_directory() as name:
            root = Path(name)
            write(
                root,
                "local-setup/ansible/playbook-deploy.yml",
                "- include_tasks: tasks/generated.yml\n",
            )
            write(
                root,
                "local-setup/ansible/tasks/generated.yml",
                '- command: touch "{{ digit_dir }}/future-generated.conf"\n',
            )
            with self.assertRaises(dry.DryRunError):
                dry.validate_render_contract(root)


if __name__ == "__main__":
    unittest.main()
