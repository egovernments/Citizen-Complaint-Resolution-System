import tempfile
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, call

if "unified_loader" not in sys.modules:
    unified_loader_stub = types.ModuleType("unified_loader")
    unified_loader_stub.UnifiedExcelReader = type("UnifiedExcelReader", (), {})
    unified_loader_stub.APIUploader = type("APIUploader", (), {})
    sys.modules["unified_loader"] = unified_loader_stub

if "requests" not in sys.modules:
    requests_stub = types.ModuleType("requests")
    requests_stub.exceptions = types.SimpleNamespace(HTTPError=Exception)
    sys.modules["requests"] = requests_stub

from crs_loader import CRSLoader


def _build_loader():
    loader = CRSLoader("http://localhost:8080")
    loader._authenticated = True
    loader.tenant_id = "statea"
    loader.uploader = Mock()
    loader.uploader.create_boundary_hierarchy.return_value = {"success": True}
    loader.uploader.generate_boundary_template.return_value = {"jobId": "job-1"}
    loader.uploader.poll_boundary_template_status.return_value = {
        "status": "completed",
        "fileStoreid": "file-1",
    }
    loader.uploader.download_boundary_template.side_effect = (
        lambda tenant_id, filestore_id, hierarchy_type, output_path: output_path
    )
    loader.uploader._build_boundary_level_localizations.return_value = [
        {"code": "ADMIN_STATE",    "message": "State",    "module": "rainmaker-common", "locale": "en_IN"},
        {"code": "ADMIN_DISTRICT", "message": "District", "module": "rainmaker-common", "locale": "en_IN"},
        {"code": "ADMIN_LOCALITY", "message": "Locality", "module": "rainmaker-common", "locale": "en_IN"},
        {"code": "ADMIN",          "message": "ADMIN",    "module": "rainmaker-common", "locale": "en_IN"},
    ]
    loader.uploader.create_localization_messages.return_value = {
        "upserted": 4, "created": 4, "exists": 0, "failed": 0
    }
    loader._create_mdms_with_schema_retry = Mock(
        return_value={"created": 1, "exists": 0, "failed": 0, "errors": []}
    )
    return loader


class LoadHierarchyTests(unittest.TestCase):

    def test_load_hierarchy_creates_mdms_from_last_two_levels(self):
        """MDMS config uses second-to-last as highestHierarchy and last as lowestHierarchy."""
        loader = _build_loader()

        with tempfile.TemporaryDirectory() as tmpdir:
            output = loader.load_hierarchy(
                name="ADMIN",
                levels=["State", "District", "Locality"],
                target_tenant="ke",
                output_dir=tmpdir,
            )

            self.assertEqual(output, str(Path(tmpdir) / "Boundary_Template_ke_ADMIN.xlsx"))
            loader._create_mdms_with_schema_retry.assert_called_once_with(
                schema_code="CMS-BOUNDARY.HierarchySchema",
                data_list=[{
                    "hierarchy": "ADMIN",
                    "department": "All",
                    "moduleName": "CMS",
                    "lowestHierarchy": "Locality",
                    "highestHierarchy": "District",
                }],
                tenant="ke",
            )

    def test_load_hierarchy_uploads_level_localizations(self):
        """Level localizations are built and uploaded after hierarchy creation."""
        loader = _build_loader()

        with tempfile.TemporaryDirectory() as tmpdir:
            loader.load_hierarchy(
                name="ADMIN",
                levels=["State", "District", "Locality"],
                target_tenant="ke",
                output_dir=tmpdir,
            )

        # _build_boundary_level_localizations called with correct records and hierarchy
        call_args = loader.uploader._build_boundary_level_localizations.call_args
        records = call_args[1]["records"] if "records" in call_args[1] else call_args[0][0]
        hierarchy = call_args[1].get("hierarchy_type") or call_args[0][1]
        self.assertEqual([r["boundaryType"] for r in records], ["State", "District", "Locality"])
        self.assertEqual(hierarchy, "ADMIN")

        # create_localization_messages called with the built messages and correct tenant
        loader.uploader.create_localization_messages.assert_called_once()
        loc_call = loader.uploader.create_localization_messages.call_args
        self.assertEqual(loc_call[0][1], "ke")  # tenant positional arg

    def test_load_hierarchy_raises_for_empty_levels(self):
        """Empty levels list raises ValueError."""
        loader = _build_loader()

        with tempfile.TemporaryDirectory() as tmpdir:
            with self.assertRaises(ValueError) as ctx:
                loader.load_hierarchy(
                    name="ADMIN",
                    levels=[],
                    target_tenant="ke",
                    output_dir=tmpdir,
                )
        self.assertIn("two", str(ctx.exception))

    def test_load_hierarchy_raises_for_single_level(self):
        """Single level raises ValueError since highestHierarchy and lowestHierarchy must differ."""
        loader = _build_loader()

        with tempfile.TemporaryDirectory() as tmpdir:
            with self.assertRaises(ValueError) as ctx:
                loader.load_hierarchy(
                    name="ADMIN",
                    levels=["State"],
                    target_tenant="ke",
                    output_dir=tmpdir,
                )
        self.assertIn("two", str(ctx.exception))

    def test_load_hierarchy_two_levels(self):
        """Two levels is the minimum valid input."""
        loader = _build_loader()
        loader.uploader._build_boundary_level_localizations.return_value = [
            {"code": "ADMIN_STATE",    "message": "State",    "module": "rainmaker-common", "locale": "en_IN"},
            {"code": "ADMIN_DISTRICT", "message": "District", "module": "rainmaker-common", "locale": "en_IN"},
            {"code": "ADMIN",          "message": "ADMIN",    "module": "rainmaker-common", "locale": "en_IN"},
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            output = loader.load_hierarchy(
                name="ADMIN",
                levels=["State", "District"],
                target_tenant="ke",
                output_dir=tmpdir,
            )

        self.assertIsNotNone(output)
        loader._create_mdms_with_schema_retry.assert_called_once_with(
            schema_code="CMS-BOUNDARY.HierarchySchema",
            data_list=[{
                "hierarchy": "ADMIN",
                "department": "All",
                "moduleName": "CMS",
                "lowestHierarchy": "District",
                "highestHierarchy": "State",
            }],
            tenant="ke",
        )

    def test_load_hierarchy_returns_none_on_hierarchy_creation_failure(self):
        """Returns None if boundary hierarchy API call fails."""
        loader = _build_loader()
        loader.uploader.create_boundary_hierarchy.side_effect = Exception("API error")

        with tempfile.TemporaryDirectory() as tmpdir:
            output = loader.load_hierarchy(
                name="ADMIN",
                levels=["State", "District", "Locality"],
                target_tenant="ke",
                output_dir=tmpdir,
            )

        self.assertIsNone(output)

    def test_load_hierarchy_returns_none_on_template_generation_failure(self):
        """Returns None if template generation returns empty result."""
        loader = _build_loader()
        loader.uploader.generate_boundary_template.return_value = {}

        with tempfile.TemporaryDirectory() as tmpdir:
            output = loader.load_hierarchy(
                name="ADMIN",
                levels=["State", "District", "Locality"],
                target_tenant="ke",
                output_dir=tmpdir,
            )

        self.assertIsNone(output)


if __name__ == "__main__":
    unittest.main()
