"""Tests for the Phase 1 orchestrator.

The MCP layer is mocked so these tests cover behavior + call shape
without hitting a live DIGIT instance.
"""
from unittest.mock import MagicMock

from digit_bootstrap.orchestrator import Orchestrator
from digit_bootstrap.template import (
    BoundaryHierarchy,
    Template,
    UserValidation,
)


def _minimal_template() -> Template:
    return Template(
        name="t",
        user_validation=[
            UserValidation(
                field_type="mobile",
                pattern=r"^[17][0-9]{8}$",
                min_length=9,
                max_length=9,
            )
        ],
        mobile_display_prefix="+254",
        boundary_hierarchy=BoundaryHierarchy(
            hierarchy_type="ADMIN",
            levels=["Country", "Ward"],
            complaint_filing_level="Ward",
        ),
    )


# ── bootstrap_tenant ──────────────────────────────────────────────────────


def test_bootstrap_tenant_calls_mcp_with_user_validation():
    mcp = MagicMock()
    mcp.call.side_effect = [{"exists": False}, {"status": "ok"}]
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    orch.bootstrap_tenant(source="pg", target="ke")

    # First call: validate_tenant probe
    assert mcp.call.call_args_list[0][0] == (
        "validate_tenant",
        {"tenant_id": "ke"},
    )
    # Second call: tenant_bootstrap with mapped user_validation
    assert mcp.call.call_args_list[1][0] == (
        "tenant_bootstrap",
        {
            "source_tenant": "pg",
            "target_tenant": "ke",
            "user_validation": [
                {
                    "fieldType": "mobile",
                    "pattern": r"^[17][0-9]{8}$",
                    "minLength": 9,
                    "maxLength": 9,
                }
            ],
        },
    )


def test_bootstrap_tenant_skips_if_already_present():
    mcp = MagicMock()
    mcp.call.return_value = {"exists": True}
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    orch.bootstrap_tenant(source="pg", target="ke")

    # Only validate_tenant called, not tenant_bootstrap
    assert mcp.call.call_count == 1
    assert mcp.call.call_args_list[0][0][0] == "validate_tenant"


# ── setup_city ────────────────────────────────────────────────────────────


def test_setup_city_calls_mcp():
    mcp = MagicMock()
    mcp.call.side_effect = [{"exists": False}, {"status": "ok"}]
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    orch.setup_city(root="ke", city_id="ke.nairobi", city_name="Nairobi")

    assert mcp.call.call_args_list[0][0] == (
        "validate_tenant",
        {"tenant_id": "ke.nairobi"},
    )
    assert mcp.call.call_args_list[1][0] == (
        "city_setup",
        {
            "tenant_id": "ke.nairobi",
            "city_name": "Nairobi",
            "source_tenant": "ke",
            "create_boundaries": True,
        },
    )


def test_setup_city_skips_if_present():
    mcp = MagicMock()
    mcp.call.return_value = {"exists": True}
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    orch.setup_city(root="ke", city_id="ke.nairobi", city_name="Nairobi")

    assert mcp.call.call_count == 1


# ── apply_boundary_entities ───────────────────────────────────────────────


def _template_with_boundaries() -> Template:
    return Template(
        name="t",
        user_validation=[UserValidation(field_type="mobile", pattern=r"^.+$")],
        mobile_display_prefix="+254",
        boundary_hierarchy=BoundaryHierarchy(
            hierarchy_type="ADMIN",
            levels=["Country", "Ward"],
            complaint_filing_level="Ward",
        ),
        boundary_entities=[
            # Deliberately out of order — orchestrator must sort parent-first.
            {"code": "WARD1", "name": "Ward 1", "type": "Ward", "parent": "COUNTY1"},
            {"code": "COUNTY1", "name": "Nairobi", "type": "County", "parent": None},
        ],
    )


def test_apply_boundary_entities_creates_in_parent_order():
    mcp = MagicMock()
    mcp.call.return_value = {"exists": False}
    orch = Orchestrator(mcp=mcp, template=_template_with_boundaries())

    orch.apply_boundary_entities(city_id="ke.nairobi")

    creates = [c for c in mcp.call.call_args_list if c[0][0] == "boundary_create"]
    assert len(creates) == 2
    assert creates[0][0][1]["code"] == "COUNTY1"
    assert creates[1][0][1]["code"] == "WARD1"
    assert creates[1][0][1]["parent"] == "COUNTY1"


def test_apply_boundary_entities_skips_existing():
    mcp = MagicMock()
    mcp.call.side_effect = [
        {"exists": True},   # COUNTY1 probe says it exists
        {"exists": False},  # WARD1 probe says it doesn't
        {"status": "ok"},   # WARD1 boundary_create
    ]
    orch = Orchestrator(mcp=mcp, template=_template_with_boundaries())

    orch.apply_boundary_entities(city_id="ke.nairobi")

    creates = [c for c in mcp.call.call_args_list if c[0][0] == "boundary_create"]
    assert len(creates) == 1
    assert creates[0][0][1]["code"] == "WARD1"


# ── apply_complaint_types ─────────────────────────────────────────────────


def _template_with_complaint_types() -> Template:
    return Template(
        name="t",
        user_validation=[UserValidation(field_type="mobile", pattern=r"^.+$")],
        mobile_display_prefix="+254",
        boundary_hierarchy=BoundaryHierarchy(
            hierarchy_type="ADMIN", levels=["Country"], complaint_filing_level="Country"
        ),
        complaint_types=[
            {"code": "Pothole", "name": "Pothole on road",
             "department": "DEPT_Roads", "sla_hours": 72},
        ],
    )


def test_apply_complaint_types_creates_via_mdms():
    mcp = MagicMock()
    mcp.call.side_effect = [{"records": []}, {"status": "ok"}]
    orch = Orchestrator(mcp=mcp, template=_template_with_complaint_types())

    orch.apply_complaint_types(tenant_id="ke")

    creates = [c for c in mcp.call.call_args_list if c[0][0] == "mdms_create"]
    assert len(creates) == 1
    payload = creates[0][0][1]
    assert payload["tenant_id"] == "ke"
    assert payload["schema_code"] == "RAINMAKER-PGR.ServiceDefs"
    assert payload["record"]["serviceCode"] == "Pothole"
    assert payload["record"]["department"] == "DEPT_Roads"
    assert payload["record"]["slaHours"] == 72


def test_apply_complaint_types_skips_existing():
    mcp = MagicMock()
    mcp.call.return_value = {"records": [{"serviceCode": "Pothole"}]}
    orch = Orchestrator(mcp=mcp, template=_template_with_complaint_types())

    orch.apply_complaint_types(tenant_id="ke")

    creates = [c for c in mcp.call.call_args_list if c[0][0] == "mdms_create"]
    assert len(creates) == 0


# ── apply_localizations ───────────────────────────────────────────────────


def _template_with_localizations(n: int) -> Template:
    rows = [
        {"locale": "sw_KE", "module": "rainmaker-common",
         "code": f"K_{i}", "message": f"msg{i}"}
        for i in range(n)
    ]
    return Template(
        name="t",
        user_validation=[UserValidation(field_type="mobile", pattern=r"^.+$")],
        mobile_display_prefix="+254",
        boundary_hierarchy=BoundaryHierarchy(
            hierarchy_type="ADMIN", levels=["Country"], complaint_filing_level="Country"
        ),
        localizations=rows,
    )


def test_apply_localizations_batches_to_ceiling():
    mcp = MagicMock()
    mcp.call.return_value = {"status": "ok"}
    orch = Orchestrator(
        mcp=mcp,
        template=_template_with_localizations(n=450),
        localization_batch_size=200,
    )

    orch.apply_localizations(tenant_id="ke")

    upserts = [c for c in mcp.call.call_args_list if c[0][0] == "localization_upsert"]
    assert len(upserts) == 3
    batch_sizes = [len(c[0][1]["messages"]) for c in upserts]
    assert batch_sizes == [200, 200, 50]


def test_apply_localizations_empty_is_noop():
    mcp = MagicMock()
    orch = Orchestrator(
        mcp=mcp,
        template=_template_with_localizations(n=0),
        localization_batch_size=200,
    )
    orch.apply_localizations(tenant_id="ke")
    mcp.call.assert_not_called()


# ── apply_user_validation ─────────────────────────────────────────────────


def test_apply_user_validation_seeds_default_when_missing():
    mcp = MagicMock()
    mcp.call.side_effect = [
        {"records": []},          # mdms_search returns nothing
        {"status": "ok"},          # mdms_create lands
    ]
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    written = orch.apply_user_validation(tenant_id="ke")

    creates = [c for c in mcp.call.call_args_list if c[0][0] == "mdms_create"]
    assert len(creates) == 1
    payload = creates[0][0][1]
    assert payload["tenant_id"] == "ke"
    assert payload["schema_code"] == "common-masters.UserValidation"
    assert payload["record"]["fieldType"] == "mobile"
    assert payload["record"]["rules"]["pattern"] == r"^[17][0-9]{8}$"
    assert payload["record"]["attributes"]["prefix"] == "+254"
    assert orch._effective_mobile_pattern == r"^[17][0-9]{8}$"
    assert orch._effective_mobile_prefix == "+254"
    assert written["fieldType"] == "mobile"


def test_apply_user_validation_uses_existing_master():
    """If the deployment already has UserValidation, never overwrite — use it."""
    mcp = MagicMock()
    mcp.call.return_value = {
        "records": [{
            "data": {
                "fieldType": "mobile",
                "rules": {
                    "pattern": r"^0?[17][0-9]{8}$",   # trunk-zero variant
                    "minLength": 9,
                    "maxLength": 10,
                    "errorMessage": "CORE_COMMON_MOBILE_ERROR",
                },
                "attributes": {"prefix": "+254"},
            },
        }],
    }
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    rule = orch.apply_user_validation(tenant_id="ke")

    # No mdms_create — existing rule honored
    creates = [c for c in mcp.call.call_args_list if c[0][0] == "mdms_create"]
    assert creates == []
    # Effective rule pulled from the deployment
    assert orch._effective_mobile_pattern == r"^0?[17][0-9]{8}$"
    assert orch._effective_mobile_prefix == "+254"
    assert rule["rules"]["pattern"] == r"^0?[17][0-9]{8}$"


# ── emit_env ──────────────────────────────────────────────────────────────


def test_emit_env_writes_expected_keys(tmp_path):
    orch = Orchestrator(mcp=MagicMock(), template=_minimal_template())

    out_path = tmp_path / "tenant.env"
    orch.emit_env(
        path=out_path,
        root="ke",
        city_id="ke.nairobi",
        admin_user="ke-admin",
        admin_password="eGov@123",
    )

    text = out_path.read_text()
    assert "ROOT_TENANT=ke" in text
    assert "CITY_TENANT=ke.nairobi" in text
    assert "DIGIT_TENANT=ke.nairobi" in text
    assert "ADMIN_USER=ke-admin" in text
    assert "ADMIN_PASSWORD=eGov@123" in text
    # Falls back to template default when apply_user_validation hasn't run
    assert "MOBILE_PATTERN=^[17][0-9]{8}$" in text
    assert "MOBILE_PREFIX=+254" in text


def test_emit_env_prefers_effective_rule_over_template(tmp_path):
    """emit_env writes the deployment's actual rule, not the template's,
    when apply_user_validation has populated the effective fields."""
    orch = Orchestrator(mcp=MagicMock(), template=_minimal_template())
    # Simulate apply_user_validation having run with a different effective rule
    orch._effective_mobile_pattern = r"^0?[17][0-9]{8}$"
    orch._effective_mobile_prefix = "+254"

    out_path = tmp_path / "tenant.env"
    orch.emit_env(
        path=out_path,
        root="ke",
        city_id="ke.bomet",
        admin_user="ke-admin",
        admin_password="eGov@123",
    )

    text = out_path.read_text()
    assert "MOBILE_PATTERN=^0?[17][0-9]{8}$" in text
    assert "MOBILE_PREFIX=+254" in text
