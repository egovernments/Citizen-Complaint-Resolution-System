"""End-to-end smoke against a real MCP shim.

Skipped unless DIGIT_BOOTSTRAP_E2E=1 and MCP_BASE is set.

After the run, asserts the target tenant exists and a few seeded
records landed. Does NOT clean up the tenant — operator handles
via tenant_destroy MCP between runs.
"""
import os
import uuid
from pathlib import Path

import pytest

from digit_bootstrap.mcp_client import McpClient
from digit_bootstrap.orchestrator import Orchestrator
from digit_bootstrap.template import load_template

E2E = os.environ.get("DIGIT_BOOTSTRAP_E2E") == "1"
MCP_BASE = os.environ.get("MCP_BASE", "")

pytestmark = pytest.mark.skipif(not E2E, reason="DIGIT_BOOTSTRAP_E2E not set")

TEMPLATES = (
    Path(__file__).resolve().parents[1] / "digit_bootstrap" / "templates"
)


def test_africa_end_to_end(tmp_path):
    suffix = uuid.uuid4().hex[:6]
    target = f"e2e{suffix}"
    city = f"{target}.test"

    mcp = McpClient(base_url=MCP_BASE)
    orch = Orchestrator(
        mcp=mcp, template=load_template(TEMPLATES / "africa.yaml")
    )

    orch.bootstrap_tenant(source="pg", target=target)
    orch.setup_city(root=target, city_id=city, city_name="E2E City")
    orch.apply_boundary_entities(city_id=city)
    orch.apply_complaint_types(tenant_id=target)
    orch.apply_localizations(tenant_id=target)
    orch.emit_env(
        path=tmp_path / "tenant.env",
        root=target,
        city_id=city,
        admin_user=f"{target}-admin",
        admin_password="eGov@123",
    )

    # Post-conditions: validate_tenant must return exists=True for both
    assert mcp.call("validate_tenant", {"tenant_id": target}).get("exists") is True
    assert mcp.call("validate_tenant", {"tenant_id": city}).get("exists") is True

    # Africa ships 3 complaint types; at least Pothole must land at root
    cts = mcp.call("mdms_search", {
        "tenant_id": target,
        "schema_code": "RAINMAKER-PGR.ServiceDefs",
    }).get("records", [])
    assert any(
        (r.get("data") or {}).get("serviceCode") == "Pothole"
        or r.get("serviceCode") == "Pothole"
        for r in cts
    ), "Pothole complaint type not found on bootstrapped tenant"

    # Africa ships 4 boundary entities; at least WARD_WESTLANDS must land
    probe = mcp.call("boundary_entity_search", {
        "tenant_id": city,
        "codes": ["WARD_WESTLANDS"],
    })
    has_entities = bool(probe.get("records") or probe.get("entities"))
    assert has_entities, "WARD_WESTLANDS boundary entity not found"
