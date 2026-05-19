import tempfile
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock

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
    loader._create_mdms_with_schema_retry = Mock(
        return_value={"created": 1, "exists": 0, "failed": 0, "errors": []}
    )
    return loader


class LoadHierarchyTests(unittest.TestCase):
    def test_load_hierarchy_creates_mdms_from_last_two_levels(self):
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

    def test_load_hierarchy_uses_single_level_for_both_highest_and_lowest(self):
        loader = _build_loader()

        with tempfile.TemporaryDirectory() as tmpdir:
            loader.load_hierarchy(
                name="ADMIN",
                levels=["State"],
                target_tenant="ke",
                output_dir=tmpdir,
            )

            loader._create_mdms_with_schema_retry.assert_called_once_with(
                schema_code="CMS-BOUNDARY.HierarchySchema",
                data_list=[{
                    "hierarchy": "ADMIN",
                    "department": "All",
                    "moduleName": "CMS",
                    "lowestHierarchy": "State",
                    "highestHierarchy": "State",
                }],
                tenant="ke",
            )


if __name__ == "__main__":
    unittest.main()
