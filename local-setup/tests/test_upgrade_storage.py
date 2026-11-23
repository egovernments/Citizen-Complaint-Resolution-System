"""Real cold-volume backup/restore; opt in on a local Docker host as root."""

import json
import os
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "local-setup/scripts"))

import deploy_state  # noqa: E402
from digit_upgrade import deploy  # noqa: E402
from digit_upgrade.common import run  # noqa: E402


@unittest.skipUnless(os.environ.get("DIGIT_UPGRADE_STORAGE_TESTS") == "1", "requires an explicit disposable Docker test run")
class ColdVolumeStorageTests(unittest.TestCase):
    def setUp(self):
        self.assertEqual(0, os.geteuid(), "run this integration suite as root to read local Docker storage")
        run(["docker", "info"])
        self.temporary = tempfile.TemporaryDirectory(prefix="digit-upgrade-storage-test-")
        self.addCleanup(self.temporary.cleanup)
        self.tmp = Path(self.temporary.name)

    def exercise(self, bind):
        label = "digit-upgrade-storage-test-" + uuid.uuid4().hex
        volume, container = label + "-volume", label + "-container"
        device = self.tmp / "host-data"
        device.mkdir()
        args = ["docker", "volume", "create", "--driver", "local"]
        if bind:
            args += ["--opt", "type=none", "--opt", "o=bind", "--opt", f"device={device}"]
        run([*args, volume])
        self.addCleanup(lambda: run(["docker", "volume", "rm", volume], check=False))
        self.addCleanup(lambda: run(["docker", "rm", "-f", container], check=False))
        run(["docker", "run", "-d", "--name", container, "--mount", f"type=volume,src={volume},dst=/data",
             "busybox:1.37.0", "sh", "-c", "echo original > /data/marker; sleep 300"])
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            result = run(["docker", "exec", container, "cat", "/data/marker"], check=False)
            if result.returncode == 0 and result.stdout == "original\n":
                break
            time.sleep(0.2)
        else:
            self.fail("test container never wrote its marker")

        d = deploy.Deployment.__new__(deploy.Deployment)
        d.docker, d.log = deploy.Docker(), lambda _: None
        d.backup_parent = self.tmp / "backups"
        storage = d._volume_storage(volume)
        data = Path(storage["path"])
        marker = data / "marker"
        marker.chmod(0o640)
        run(["docker", "stop", "--time", "1", container])
        if bind:
            info = json.loads(run(["docker", "volume", "inspect", volume]).stdout)[0]
            self.assertFalse((Path(info["Mountpoint"]) / "marker").exists(), "fixture must reproduce the unmounted Docker directory")
            self.assertEqual(device, data)
        self.assertEqual("original\n", marker.read_text())

        digit = self.tmp / "digit"
        (digit / "configs").mkdir(parents=True)
        (digit / "configs/example.yml").write_text("before: true\n")
        stack = deploy.StackRecord(str(digit), label, [], [], {}, [volume], "/unused",
                                   analysed_files=deploy_state.analysed_files(str(digit)),
                                   volume_storage={volume: storage})
        backup = self.tmp / "backup"
        d._archive_directory(digit, backup / "digit.tar.zst")
        d._archive_directory(data, backup / "volumes" / f"{volume}.tar.zst")
        marker.write_text("migration changed this\n")
        marker.chmod(0o600)
        d._start_previous = mock.Mock()
        with mock.patch.object(deploy.shutil, "which", return_value=None):
            d._rollback(backup, stack)
        self.assertEqual("original\n", marker.read_text())
        self.assertEqual(0o640, marker.stat().st_mode & 0o777)
        self.assertEqual("before: true\n", (digit / "configs/example.yml").read_text())
        d._start_previous.assert_called_once()

    def test_bind_volume_restores_the_real_device_after_stop(self):
        self.exercise(bind=True)

    def test_ordinary_volume_restores_its_mountpoint_after_stop(self):
        self.exercise(bind=False)

    def test_fast_path_keeps_flyway_history_without_initdb_mounts(self):
        import yaml
        base = self.tmp / "base.yml"
        base.write_text(yaml.safe_dump({"services": {
            "postgres-db": {"image": "postgres:16", "volumes": ["postgres_data:/var/lib/docker-postgresql/data"]},
            "egov-url-shortening": {"image": "busybox:1.37.0"},
            "user-seed": {"image": "busybox:1.37.0"},
        }, "volumes": {"postgres_data": {}}}))
        files = deploy.compose_chain("test", {"db_fast_path": True}, guarded=True, source_root=ROOT)
        self.assertIn("docker-compose.fast-path.yml", files)
        config = json.loads(run([
            "docker", "compose", "-f", str(base),
            "-f", str(ROOT / "local-setup/docker-compose.fast-path.yml"),
            "-f", str(ROOT / "local-setup/docker-compose.upgrade-safe.yml"),
            "config", "--no-interpolate", "--format", "json",
        ]).stdout)
        self.assertEqual("egov_url_shortening_schema_version",
                         config["services"]["egov-url-shortening"]["environment"]["SPRING_FLYWAY_TABLE"])
        mounts = config["services"]["postgres-db"]["volumes"]
        self.assertEqual(["/var/lib/postgresql/data"], [m["target"] for m in mounts])
        self.assertEqual("postgres_data", mounts[0]["source"])


if __name__ == "__main__":
    unittest.main()
