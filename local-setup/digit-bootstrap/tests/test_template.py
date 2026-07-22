"""Tests for template loading + schema validation."""
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from digit_bootstrap.template import Template, load_template

FIXTURES = Path(__file__).parent / "fixtures"


def test_load_minimal_template():
    tpl = load_template(FIXTURES / "minimal-template.yaml")
    assert tpl.name == "minimal"
    assert tpl.user_validation[0].field_type == "mobile"
    assert tpl.user_validation[0].pattern == r"^[17][0-9]{8}$"
    assert tpl.mobile_display_prefix == "+254"
    assert tpl.boundary_hierarchy.hierarchy_type == "ADMIN"
    assert tpl.boundary_hierarchy.complaint_filing_level == "Ward"


def test_missing_required_field_raises():
    """Templates without user_validation or boundary_hierarchy fail to validate."""
    bad = "name: bad\n"
    with pytest.raises(ValidationError):
        Template.model_validate(yaml.safe_load(bad))


def test_complaint_types_default_empty():
    tpl = load_template(FIXTURES / "minimal-template.yaml")
    assert tpl.complaint_types == []
    assert tpl.boundary_entities == []
    assert tpl.localizations == []
