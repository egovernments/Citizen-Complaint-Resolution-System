"""YAML template schema + loader.

Templates describe the deltas a country-specific tenant needs on top of
what `tenant_bootstrap` already copies from the source tenant. They are
the input to the Phase 1 orchestrator.
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional
import yaml
from pydantic import BaseModel, Field


class UserValidation(BaseModel):
    field_type: str = Field(..., description="e.g. 'mobile', 'email'")
    pattern: str
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    error_message: Optional[str] = None


class BoundaryHierarchy(BaseModel):
    hierarchy_type: str
    levels: list[str]
    complaint_filing_level: str


class BoundaryEntity(BaseModel):
    code: str
    name: str
    type: str
    parent: Optional[str] = None


class ComplaintType(BaseModel):
    code: str
    name: str
    department: str
    sla_hours: int = 48


class LocalizationRow(BaseModel):
    locale: str
    module: str
    code: str
    message: str


class Template(BaseModel):
    name: str
    modeled_on: Optional[str] = None
    default: bool = False
    user_validation: list[UserValidation]
    mobile_display_prefix: str = ""
    boundary_hierarchy: BoundaryHierarchy
    boundary_entities: list[BoundaryEntity] = Field(default_factory=list)
    complaint_types: list[ComplaintType] = Field(default_factory=list)
    localizations: list[LocalizationRow] = Field(default_factory=list)


def load_template(path: Path) -> Template:
    """Read a YAML template file and validate it against the schema."""
    with open(path) as fh:
        data = yaml.safe_load(fh)
    return Template.model_validate(data)
