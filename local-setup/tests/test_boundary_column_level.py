#!/usr/bin/env python3

import os
import sys
import tempfile

import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "jupyter", "dataloader")))

from unified_loader import APIUploader


def test_process_boundary_data_generates_codes_for_name_only_level_columns():
    df = pd.DataFrame(
        [
            {"ADMIN_STATE": "ka", "ADMIN_DISTRICT": None, "ADMIN_LOCALITY": None, "CRS_BOUNDARY_CODE": None},
            {"ADMIN_STATE": "ka", "ADMIN_DISTRICT": "blr", "ADMIN_LOCALITY": None, "CRS_BOUNDARY_CODE": None},
            {"ADMIN_STATE": "ka", "ADMIN_DISTRICT": "blr", "ADMIN_LOCALITY": "ecitya", "CRS_BOUNDARY_CODE": None},
            {"ADMIN_STATE": "ka", "ADMIN_DISTRICT": "blr", "ADMIN_LOCALITY": "ecityb", "CRS_BOUNDARY_CODE": None},
            {"ADMIN_STATE": "ka", "ADMIN_DISTRICT": "blr", "ADMIN_LOCALITY": "ecityc", "CRS_BOUNDARY_CODE": None},
        ]
    )

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as handle:
        excel_path = handle.name

    try:
        with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="CRS_BOUNDARY_DATA")

        uploader = APIUploader(base_url="http://example.com")
        uploader.auth_token = "token"
        uploader.user_info = {"uuid": "test"}
        uploader._get_boundary_hierarchy = lambda tenant_id, hierarchy_type: {
            "boundaryHierarchy": [
                {"boundaryType": "State"},
                {"boundaryType": "District"},
                {"boundaryType": "Locality"},
            ]
        }

        created_entities = []
        created_relationships = []

        uploader._create_boundary_entity = lambda tenant_id, code: created_entities.append((tenant_id, code)) or True
        uploader._create_boundary_relationship = (
            lambda tenant_id, hierarchy_type, code, boundary_type, parent_code=None:
            created_relationships.append((tenant_id, hierarchy_type, code, boundary_type, parent_code)) or True
        )

        result = uploader.process_boundary_data(
            tenant_id="tenant",
            hierarchy_type="ADMIN",
            excel_file=excel_path,
        )

        assert result["status"] == "completed"
        assert result["boundaries_created"] == 5
        assert result["relationships_created"] == 5
        assert [code for _, code in created_entities] == [
            "KA",
            "KA_BLR",
            "KA_BLR_ECITYA",
            "KA_BLR_ECITYB",
            "KA_BLR_ECITYC",
        ]
        assert created_relationships == [
            ("tenant", "ADMIN", "KA", "State", None),
            ("tenant", "ADMIN", "KA_BLR", "District", "KA"),
            ("tenant", "ADMIN", "KA_BLR_ECITYA", "Locality", "KA_BLR"),
            ("tenant", "ADMIN", "KA_BLR_ECITYB", "Locality", "KA_BLR"),
            ("tenant", "ADMIN", "KA_BLR_ECITYC", "Locality", "KA_BLR"),
        ]
    finally:
        if os.path.exists(excel_path):
            os.unlink(excel_path)


def test_process_boundary_data_skips_duplicate_rows_and_respects_explicit_leaf_codes():
    df = pd.DataFrame(
        [
            {"ADMIN_STATE": "KA", "ADMIN_DISTRICT": None, "ADMIN_LOCALITY": None, "CRS_BOUNDARY_CODE": None},
            {"ADMIN_STATE": "KA", "ADMIN_DISTRICT": "BLR", "ADMIN_LOCALITY": None, "CRS_BOUNDARY_CODE": None},
            {"ADMIN_STATE": "KA", "ADMIN_DISTRICT": "BLR", "ADMIN_LOCALITY": "ecitya", "CRS_BOUNDARY_CODE": "LOC_100"},
            {"ADMIN_STATE": "KA", "ADMIN_DISTRICT": "BLR", "ADMIN_LOCALITY": "ecitya", "CRS_BOUNDARY_CODE": "LOC_100"},
            {"ADMIN_STATE": "KA", "ADMIN_DISTRICT": "BLR", "ADMIN_LOCALITY": "ecityb", "CRS_BOUNDARY_CODE": "LOC_101"},
        ]
    )

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as handle:
        excel_path = handle.name

    try:
        with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="CRS_BOUNDARY_DATA")

        uploader = APIUploader(base_url="http://example.com")
        uploader.auth_token = "token"
        uploader.user_info = {"uuid": "test"}
        uploader._get_boundary_hierarchy = lambda tenant_id, hierarchy_type: {
            "boundaryHierarchy": [
                {"boundaryType": "State"},
                {"boundaryType": "District"},
                {"boundaryType": "Locality"},
            ]
        }

        created_entities = []
        created_relationships = []

        uploader._create_boundary_entity = lambda tenant_id, code: created_entities.append((tenant_id, code)) or True
        uploader._create_boundary_relationship = (
            lambda tenant_id, hierarchy_type, code, boundary_type, parent_code=None:
            created_relationships.append((tenant_id, hierarchy_type, code, boundary_type, parent_code)) or True
        )

        result = uploader.process_boundary_data(
            tenant_id="tenant",
            hierarchy_type="ADMIN",
            excel_file=excel_path,
        )

        assert result["status"] == "completed"
        assert result["boundaries_created"] == 4
        assert result["relationships_created"] == 4
        assert [code for _, code in created_entities] == [
            "KA",
            "KA_BLR",
            "LOC_100",
            "LOC_101",
        ]
        assert created_relationships == [
            ("tenant", "ADMIN", "KA", "State", None),
            ("tenant", "ADMIN", "KA_BLR", "District", "KA"),
            ("tenant", "ADMIN", "LOC_100", "Locality", "KA_BLR"),
            ("tenant", "ADMIN", "LOC_101", "Locality", "KA_BLR"),
        ]
    finally:
        if os.path.exists(excel_path):
            os.unlink(excel_path)


def test_process_boundary_data_uses_codes_from_column_level_sheet_directly():
    df = pd.DataFrame(
        [
            {"ADMIN_STATE": "PB", "ADMIN_DISTRICT": None, "ADMIN_LOCALITY": None, "CRS_BOUNDARY_CODE": "PB"},
            {"ADMIN_STATE": "PB", "ADMIN_DISTRICT": "PB_PTL", "ADMIN_LOCALITY": None, "CRS_BOUNDARY_CODE": "PB_PTL"},
            {"ADMIN_STATE": "PB", "ADMIN_DISTRICT": "PB_PTL", "ADMIN_LOCALITY": "PB_PTL_SAM", "CRS_BOUNDARY_CODE": "PB_PTL_SAM"},
            {"ADMIN_STATE": "PB", "ADMIN_DISTRICT": "PB_PTL", "ADMIN_LOCALITY": "PB_PTL_NAB", "CRS_BOUNDARY_CODE": "PB_PTL_NAB"},
            {"ADMIN_STATE": "PB", "ADMIN_DISTRICT": "PB_PTK", "ADMIN_LOCALITY": None, "CRS_BOUNDARY_CODE": "PB_PTK"},
        ]
    )

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as handle:
        excel_path = handle.name

    try:
        with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="CRS_BOUNDARY_DATA")

        uploader = APIUploader(base_url="http://example.com")
        uploader.auth_token = "token"
        uploader.user_info = {"uuid": "test"}
        uploader._get_boundary_hierarchy = lambda tenant_id, hierarchy_type: {
            "boundaryHierarchy": [
                {"boundaryType": "State"},
                {"boundaryType": "District"},
                {"boundaryType": "Locality"},
            ]
        }

        created_entities = []
        created_relationships = []

        uploader._create_boundary_entity = lambda tenant_id, code: created_entities.append((tenant_id, code)) or True
        uploader._create_boundary_relationship = (
            lambda tenant_id, hierarchy_type, code, boundary_type, parent_code=None:
            created_relationships.append((tenant_id, hierarchy_type, code, boundary_type, parent_code)) or True
        )

        result = uploader.process_boundary_data(
            tenant_id="tenant",
            hierarchy_type="ADMIN",
            excel_file=excel_path,
        )

        assert result["status"] == "completed"
        assert result["boundaries_created"] == 5
        assert result["relationships_created"] == 5
        assert [code for _, code in created_entities] == [
            "PB",
            "PB_PTL",
            "PB_PTL_SAM",
            "PB_PTL_NAB",
            "PB_PTK",
        ]
        assert created_relationships == [
            ("tenant", "ADMIN", "PB", "State", None),
            ("tenant", "ADMIN", "PB_PTL", "District", "PB"),
            ("tenant", "ADMIN", "PB_PTL_SAM", "Locality", "PB_PTL"),
            ("tenant", "ADMIN", "PB_PTL_NAB", "Locality", "PB_PTL"),
            ("tenant", "ADMIN", "PB_PTK", "District", "PB"),
        ]
    finally:
        if os.path.exists(excel_path):
            os.unlink(excel_path)
