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

    def test_build_boundary_cleanup_plan_uses_root_tenant_for_root_scoped_data(self):
        loader = _build_loader()

        plan = loader._build_boundary_cleanup_plan("statea.citya")

        self.assertEqual(plan["tenant"], "statea.citya")
        self.assertEqual(plan["root_tenant"], "statea")
        self.assertEqual(plan["hierarchy_types"], ["REVENUE"])
        self.assertEqual(
            plan["boundary_codes"],
            ["STATEA", "STATEA_DISTRICT_1", "STATEA_LOCALITY_1"],
        )
        self.assertEqual(plan["mdms_unique_ids"], ["cms-revenue"])
        self.assertEqual(
            plan["hierarchy_level_codes"],
            ["REVENUE", "REVENUE_DISTRICT", "REVENUE_LOCALITY", "REVENUE_STATE"],
        )
        loader.uploader.search_mdms_data_all.assert_called_once_with(
            schema_code="CMS-BOUNDARY.HierarchySchema",
            tenant="statea",
        )

    def test_build_boundary_cleanup_sql_covers_boundary_tables_messages_and_mdms(self):
        loader = _build_loader()
        plan = loader._build_boundary_cleanup_plan("statea.citya")

        statements = loader._build_boundary_cleanup_sql(plan)

        self.assertEqual(
            statements[:5],
            [
                "DELETE FROM eg_bm_generated_template WHERE tenantid = 'statea.citya' AND hierarchytype IN ('REVENUE');",
                "DELETE FROM eg_bm_processed_template WHERE tenantid = 'statea.citya' AND hierarchytype IN ('REVENUE');",
                "DELETE FROM boundary_hierarchy WHERE tenantid = 'statea.citya' AND hierarchytype IN ('REVENUE');",
                "DELETE FROM boundary WHERE tenantid = 'statea.citya' AND code IN ('STATEA', 'STATEA_DISTRICT_1', 'STATEA_LOCALITY_1');",
                "DELETE FROM boundary_relationship WHERE tenantid = 'statea.citya' AND hierarchytype IN ('REVENUE');",
            ],
        )
        self.assertIn(
            "DELETE FROM message WHERE tenantid = 'statea' AND module = 'rainmaker-pgr' AND code IN ('STATEA', 'STATEA_DISTRICT_1', 'STATEA_LOCALITY_1');",
            statements,
        )
        self.assertIn(
            "DELETE FROM message WHERE tenantid = 'statea' AND module = 'rainmaker-common' AND code IN ('REVENUE', 'REVENUE_DISTRICT', 'REVENUE_LOCALITY', 'REVENUE_STATE');",
            statements,
        )
        self.assertIn(
            "UPDATE eg_mdms_data SET isactive = false, lastmodifiedtime = ",
            statements[-1],
        )
        self.assertIn(
            "AND uniqueidentifier IN ('cms-revenue')",
            statements[-1],
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
