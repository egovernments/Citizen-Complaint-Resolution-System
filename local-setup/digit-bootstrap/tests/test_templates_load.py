"""Ensure shipped templates load and validate."""
from pathlib import Path

from digit_bootstrap.template import load_template

TEMPLATES = (
    Path(__file__).resolve().parents[1] / "digit_bootstrap" / "templates"
)


def test_africa_template_loads():
    tpl = load_template(TEMPLATES / "africa.yaml")
    assert tpl.name == "africa"
    assert tpl.default is True
    assert tpl.mobile_display_prefix == "+254"
    assert any(uv.field_type == "mobile" for uv in tpl.user_validation)
    assert tpl.boundary_hierarchy.complaint_filing_level == "Ward"
    assert len(tpl.boundary_entities) >= 2
    assert len(tpl.complaint_types) >= 2
    # Africa only ships locale deltas; baseline en_IN comes from source
    assert all(r.locale != "en_IN" for r in tpl.localizations)
    assert len(tpl.localizations) >= 1


def test_india_template_loads():
    tpl = load_template(TEMPLATES / "india.yaml")
    assert tpl.name == "india"
    assert tpl.default is False
    assert tpl.mobile_display_prefix == "+91"
    # India inherits everything from pg — no deltas
    assert tpl.boundary_entities == []
    assert tpl.complaint_types == []
    assert tpl.localizations == []
