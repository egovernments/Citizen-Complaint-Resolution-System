import io
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
            self.assertEqual("changed", result["findings"][0]["change"])
            for forbidden in (
                "old-secret",
                "local-secret",
                "target-secret",
                next(iter(backup_state[".env"].values())),
            ):
                self.assertNotIn(forbidden, serialized)

    def test_unverifiable_render_placeholder_warns_without_blocking(self):
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
            self.assertEqual("unverifiable", result["findings"][0]["change"])
            self.assertEqual("warning", result["findings"][0]["severity"])

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

    def test_secret_metadata_keys_are_not_treated_as_secret_values(self):
        values = dry.sensitive_values(
            {"secrets_path": "secret/digit/city", "token_user_type": "EMPLOYEE"}
        )
        self.assertEqual(set(), values)

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
            write(source, "custom/operator.conf", "keep=true\n")
            metadata = dry.normalize_tree(source, target)
            self.assertTrue((target / "custom/operator.conf").exists())
            self.assertFalse((target / ".openbao/init.json").exists())
            self.assertFalse((target / ".build/cache/file").exists())
            self.assertFalse((target / "ci-tests/result.txt").exists())
            self.assertFalse((target / "e2e-tests/result.txt").exists())
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


class MergeTests(unittest.TestCase):
    def merge(self, base_files, local_files, target_files):
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
        result = dry.three_way_merge(
            root / "base", root / "local", root / "target", root, output
        )
        return temp, root, output, result

    def test_non_overlapping_edits_merge(self):
        base = "a=1\n" + "\n".join(f"keep{i}=1" for i in range(10)) + "\nb=1\n"
        local = base.replace("a=1", "a=2", 1)
        target = base.replace("b=1", "b=2", 1)
        temp, _, output, result = self.merge(
            {"config": base},
            {"config": local},
            {"config": target},
        )
        self.addCleanup(temp.cleanup)
        self.assertEqual([], result["conflicts"])
        merged = (output / "merged-candidate/config").read_text()
        self.assertIn("a=2", merged)
        self.assertIn("b=2", merged)

    def test_same_line_edit_is_conflict_and_candidate_keeps_target(self):
        temp, _, output, result = self.merge(
            {"config": "value=old\n"},
            {"config": "value=local\n"},
            {"config": "value=target\n"},
        )
        self.addCleanup(temp.cleanup)
        self.assertEqual("config", result["conflicts"][0]["path"])
        self.assertIn("<<<<<<<", (output / "conflicts/config").read_text())
        self.assertEqual("value=target\n", (output / "merged-candidate/config").read_text())

    def test_add_delete_and_binary_change_are_bundled(self):
        temp, _, output, result = self.merge(
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
        temp, _, _, result = self.merge(
            {"binary": b"\0old"},
            {"binary": b"\0local"},
            {"binary": b"\0target"},
        )
        self.addCleanup(temp.cleanup)
        self.assertEqual("binary-or-file-level", result["conflicts"][0]["kind"])


class MDMSTests(unittest.TestCase):
    DATA_HEADER = (
        "COPY public.eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, "
        "isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime) FROM stdin;\n"
    )
    SCHEMA_HEADER = (
        "COPY public.eg_mdms_schema_definition (id, tenantid, code, description, definition, "
        "isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime) FROM stdin;\n"
    )

    def dump(self, data_rows, schema_rows):
        return (
            self.DATA_HEADER
            + "\n".join(data_rows)
            + "\n\\.\n"
            + self.SCHEMA_HEADER
            + "\n".join(schema_rows)
            + "\n\\.\n"
        )

    def test_ignores_order_and_audit_metadata(self):
        row1 = 'id1\tpg\tu1\tmodule.Master\t{"b":2,"a":1}\tt\tactor1\tactor1\t1\t2'
        row2 = 'id2\tpg\tu2\tmodule.Master\t{"x":1}\tt\tactor1\tactor1\t1\t2'
        schema = 's1\tpg\tmodule.Master\tdesc\t{"type":"object"}\tt\ta\ta\t1\t2'
        first = self.dump([row1, row2], [schema])
        changed_audit = row1.replace("actor1\tactor1\t1\t2", "actor2\tactor3\t9\t10")
        second = self.dump([row2, changed_audit], [schema])
        self.assertFalse(dry.compare_mdms(first, second)["changed"])

    def test_reports_only_identifier_for_changed_payload(self):
        old = self.dump(
            ['id1\tpg\tu1\tmodule.Master\t{"a":1}\tt\ta\ta\t1\t2'],
            ['s1\tpg\tmodule.Master\tdesc\t{"type":"object"}\tt\ta\ta\t1\t2'],
        )
        new = old.replace('{"a":1}', '{"a":2}')
        result = dry.compare_mdms(old, new)
        self.assertTrue(result["changed"])
        self.assertEqual("pg|module.Master|u1", result["changes"][0]["key"])
        self.assertNotIn('"a":2', json.dumps(result))


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

    def test_profile_support_is_fail_closed(self):
        self.assertEqual(
            "v2.12-beta",
            dry.profile_for(dry.LEGACY_COMMIT, dry.LEGACY_COMMIT, "a" * 40),
        )
        self.assertEqual("master", dry.profile_for("b" * 40, dry.LEGACY_COMMIT, "b" * 40))
        with self.assertRaises(dry.DryRunError):
            dry.profile_for("c" * 40, "c" * 40, "b" * 40)

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
