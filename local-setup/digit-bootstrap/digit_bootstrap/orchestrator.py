"""Phase 1 bootstrap orchestrator.

Pipes a Template through the MCP REST shim to produce a fully-seeded
tenant root + city tenant. Each step is idempotent: probe first,
create only if missing.

This file holds the entire Phase 1 surface. Phase 2 (persona
provisioning), Phase 3 (async/notify), and Phase 4 (seed validation)
land in separate modules.
"""
from __future__ import annotations
from pathlib import Path
from typing import Protocol

from digit_bootstrap.template import BoundaryEntity, Template


class McpLike(Protocol):
    def call(self, tool: str, payload: dict) -> dict: ...


class Orchestrator:
    def __init__(
        self,
        mcp: McpLike,
        template: Template,
        localization_batch_size: int = 200,
    ) -> None:
        self.mcp = mcp
        self.template = template
        self.localization_batch_size = localization_batch_size

    # ── Phase 1, step 1: tenant root ───────────────────────────────────────

    def bootstrap_tenant(self, source: str, target: str) -> None:
        """Idempotently bootstrap a tenant root from `source` into `target`.

        Probes via validate_tenant first; skips the call if the target
        already exists. Maps template.user_validation into the MCP's
        payload shape (camelCase fields).
        """
        probe = self.mcp.call("validate_tenant", {"tenant_id": target})
        if probe.get("exists"):
            return

        payload = {
            "source_tenant": source,
            "target_tenant": target,
            "user_validation": [
                _to_mcp_user_validation(uv) for uv in self.template.user_validation
            ],
        }
        self.mcp.call("tenant_bootstrap", payload)

    # ── Phase 1, step 2: city tenant ───────────────────────────────────────

    def setup_city(self, root: str, city_id: str, city_name: str) -> None:
        """Idempotently set up a city-level tenant under the root."""
        probe = self.mcp.call("validate_tenant", {"tenant_id": city_id})
        if probe.get("exists"):
            return
        self.mcp.call("city_setup", {
            "tenant_id": city_id,
            "city_name": city_name,
            "source_tenant": root,
            "create_boundaries": True,
        })

    # ── Phase 1, step 3: boundary entity tree ──────────────────────────────

    def apply_boundary_entities(self, city_id: str) -> None:
        """Create boundary entities from the template, parent-first."""
        sorted_entities = _topological_sort(self.template.boundary_entities)
        hierarchy_type = self.template.boundary_hierarchy.hierarchy_type
        for entity in sorted_entities:
            probe = self.mcp.call("boundary_entity_exists", {
                "tenant_id": city_id,
                "code": entity.code,
            })
            if probe.get("exists"):
                continue
            self.mcp.call("boundary_create", {
                "tenant_id": city_id,
                "hierarchy_type": hierarchy_type,
                "code": entity.code,
                "name": entity.name,
                "boundary_type": entity.type,
                "parent": entity.parent,
            })

    # ── Phase 1, step 4: complaint types (idempotent over tenant_bootstrap) ─

    def apply_complaint_types(self, tenant_id: str) -> None:
        """Create complaint types via mdms_create against RAINMAKER-PGR.ServiceDefs.

        Note: per PREFLIGHT.md, tenant_bootstrap already copies the source
        tenant's ServiceDefs. This method exists to add country-specific
        complaint types beyond the source baseline. The mdms_search probe
        makes it a no-op if the record is already present.
        """
        for ct in self.template.complaint_types:
            probe = self.mcp.call("mdms_search", {
                "tenant_id": tenant_id,
                "schema_code": "RAINMAKER-PGR.ServiceDefs",
                "filter": {"serviceCode": ct.code},
            })
            if probe.get("records"):
                continue
            self.mcp.call("mdms_create", {
                "tenant_id": tenant_id,
                "schema_code": "RAINMAKER-PGR.ServiceDefs",
                "record": {
                    "serviceCode": ct.code,
                    "name": ct.name,
                    "department": ct.department,
                    "slaHours": ct.sla_hours,
                    "active": True,
                },
            })

    # ── Phase 1, step 5: localization (sw_KE deltas etc., batched) ─────────

    def apply_localizations(self, tenant_id: str) -> None:
        """Upsert localization rows in batches sized to the MCP ceiling.

        Per PREFLIGHT.md, tenant_bootstrap already copies the source
        tenant's en_IN baseline. The template should carry only locale
        deltas (e.g. sw_KE rows). Empty list is a no-op.
        """
        rows = self.template.localizations
        if not rows:
            return
        for i in range(0, len(rows), self.localization_batch_size):
            chunk = rows[i:i + self.localization_batch_size]
            self.mcp.call("localization_upsert", {
                "tenant_id": tenant_id,
                "messages": [
                    {"locale": r.locale, "module": r.module,
                     "code": r.code, "message": r.message}
                    for r in chunk
                ],
            })

    # ── Phase 1, step 6: emit shell env for downstream phases ──────────────

    def emit_env(
        self,
        path: Path,
        root: str,
        city_id: str,
        admin_user: str,
        admin_password: str,
    ) -> None:
        """Write a sourceable shell env file for downstream phases."""
        mobile_uv = next(
            (uv for uv in self.template.user_validation if uv.field_type == "mobile"),
            None,
        )
        mobile_pattern = mobile_uv.pattern if mobile_uv else ""
        lines = [
            f"ROOT_TENANT={root}",
            f"CITY_TENANT={city_id}",
            f"DIGIT_TENANT={city_id}",
            f"ADMIN_USER={admin_user}",
            f"ADMIN_PASSWORD={admin_password}",
            f"MOBILE_PATTERN={mobile_pattern}",
            f"MOBILE_PREFIX={self.template.mobile_display_prefix}",
        ]
        with open(path, "w") as fh:
            fh.write("\n".join(lines) + "\n")


# ── helpers ────────────────────────────────────────────────────────────────


def _to_mcp_user_validation(uv) -> dict:
    out = {"fieldType": uv.field_type, "pattern": uv.pattern}
    if uv.min_length is not None:
        out["minLength"] = uv.min_length
    if uv.max_length is not None:
        out["maxLength"] = uv.max_length
    if uv.error_message:
        out["errorMessage"] = uv.error_message
    return out


def _topological_sort(entities: list[BoundaryEntity]) -> list[BoundaryEntity]:
    """Return entities ordered so each parent appears before its children."""
    by_code = {e.code: e for e in entities}
    visited: set[str] = set()
    out: list[BoundaryEntity] = []

    def visit(code: str) -> None:
        if code in visited or code not in by_code:
            return
        entity = by_code[code]
        if entity.parent:
            visit(entity.parent)
        visited.add(code)
        out.append(entity)

    for e in entities:
        visit(e.code)
    return out
