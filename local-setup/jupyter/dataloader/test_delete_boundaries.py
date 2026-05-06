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
    requests_stub.exceptions = types.SimpleNamespace(
        HTTPError=Exception,
        ConnectionError=Exception,
    )
    sys.modules["requests"] = requests_stub

from crs_loader import CRSLoader


def _build_loader():
    loader = CRSLoader("http://localhost:8080")
    loader._authenticated = True
    loader.tenant_id = "statea"
    loader.uploader = Mock()
    loader.uploader.search_boundary_hierarchies.return_value = [
        {
            "hierarchyType": "REVENUE",
            "boundaryHierarchy": [
                {"boundaryType": "State"},
                {"boundaryType": "District"},
                {"boundaryType": "Locality"},
            ],
        }
    ]
    loader.uploader.search_mdms_data_all.return_value = [
        {"hierarchy": "REVENUE", "_uniqueIdentifier": "cms-revenue"},
        {"hierarchy": "ADMIN", "_uniqueIdentifier": "cms-admin"},
    ]
    loader._fetch_boundary_codes_for_hierarchy = Mock(
        return_value=["STATEA", "STATEA_DISTRICT_1", "STATEA_LOCALITY_1"]
    )
    loader._fetch_boundary_codes_from_service = Mock(return_value=[])
    return loader


class DeleteBoundariesTests(unittest.TestCase):

    def test_build_boundary_cleanup_plan_uses_target_tenant_only(self):
        loader = _build_loader()

        plan = loader._build_boundary_cleanup_plan("statea.citya")

        self.assertEqual(plan["tenant"], "statea.citya")
        self.assertEqual(plan["hierarchy_types"], ["REVENUE"])
        self.assertEqual(
            plan["boundary_codes"],
            ["STATEA", "STATEA_DISTRICT_1", "STATEA_LOCALITY_1"],
        )
        self.assertNotIn("root_tenant", plan)
        loader.uploader.search_mdms_data_all.assert_not_called()

    def test_build_boundary_cleanup_sql_deletes_relationships_then_entities_then_hierarchy(self):
        loader = _build_loader()
        plan = loader._build_boundary_cleanup_plan("statea.citya")

        statements = loader._build_boundary_cleanup_sql(plan)

        self.assertEqual(
            statements,
            [
                "DELETE FROM boundary_relationship WHERE tenantid = 'statea.citya' AND hierarchytype IN ('REVENUE');",
                "DELETE FROM boundary WHERE tenantid = 'statea.citya' AND code IN ('STATEA', 'STATEA_DISTRICT_1', 'STATEA_LOCALITY_1');",
                "DELETE FROM boundary_hierarchy WHERE tenantid = 'statea.citya' AND hierarchytype IN ('REVENUE');",
            ],
        )

    def test_delete_boundaries_falls_back_to_kubectl_api_when_db_cleanup_skipped(self):
        loader = _build_loader()
        expected_plan = loader._build_boundary_cleanup_plan("statea.citya")
        loader._delete_boundaries_via_db = Mock(return_value={"status": "skipped"})
        loader._delete_boundaries_via_kubectl_api = Mock(
            return_value={"status": "success", "deleted": 3, "relationships_deleted": 3}
        )

        result = loader.delete_boundaries("statea.citya")

        loader._delete_boundaries_via_db.assert_called_once()
        loader._delete_boundaries_via_kubectl_api.assert_called_once_with(expected_plan)
        self.assertEqual(result["status"], "success")


if __name__ == "__main__":
    unittest.main()
