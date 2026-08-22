# Tenant Bootstrap Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 bootstrap orchestrator (`digit-bootstrap` CLI) that takes a country template (Africa or India) and a target tenant, then drives the existing MCP tools (`tenant_bootstrap`, `city_setup`, `boundary_create`, `mdms_create`, `localization_upsert`) to produce a fully-seeded tenant root + city tenant ready for Phase 2 persona provisioning.

**Architecture:** Python 3.11+ CLI that posts JSON to the on-host MCP REST shim. Templates are YAML files validated by Pydantic schemas. Orchestrator is idempotent — each step probes for existing artifacts before creating. Outputs a `tenant.env` file with the resolved tenant identifiers for downstream phases.

**Tech Stack:** Python 3.11, Poetry, Pydantic v2 (schema validation), httpx (HTTP client), PyYAML, pytest, pytest-httpx (HTTP mocks). All bootstrap operations go through MCP — no direct DIGIT API calls, no dataloader.

**Scope note (out of plan):** Phase 2 personas, Phase 3 async, Phase 4 validation, Phase 5 test parameterization, Phase 6 suite runner, Phase 7 skip mechanism are NOT in this plan. Phase 1 only.

**Location decision:** Code lives at `local-setup/digit-bootstrap/`, not `tools/digit-bootstrap/` as the spec said. Rationale: `local-setup/` already houses deployment-time tooling (`ansible/`, `jupyter/`, `scripts/`). Spec gets updated in Task 0.

---

## Pre-flight assumptions (resolved in Task 1)

These open questions from the spec MUST be resolved against a live deployment before the orchestrator code is finalized. Task 1 probes them and pins answers. If any assumption breaks, the affected task body is updated.

1. **MCP REST shim URL pattern.** The skill descriptions reference "on-host MCP REST shim". The actual base URL + endpoint convention (e.g. `POST http://<host>:<port>/tools/<tool_name>`) needs confirmation.
2. **Does `tenant_bootstrap` copy ServiceDefs (complaint types)?** Schema says "all schema definitions, IdFormat records, Department records, Designation records, StateInfo, InboxQueryConfiguration" — ServiceDefs not listed. Need to verify whether they're transferred under "all schema definitions" or NOT.
3. **Sync vs async.** Is `tenant_bootstrap` blocking? If yes, time it.
4. **`localization_upsert` batch ceiling.** Single-call max records.
5. **Boundary entity bulk method.** `boundary_create` is single-entity. Is there a batch endpoint, or do we loop?
6. **`employee_update`** — does it accept `assignments[].reportingTo`? (Relevant for Phase 2; verifying now saves rework.)

---

## Task 0: Update spec location reference

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-tenant-bootstrap-and-smoke-pipeline-design.md`

- [ ] **Step 1: Update spec to reference the chosen location**

Find every occurrence of `tools/digit-bootstrap/` in the spec and replace with `local-setup/digit-bootstrap/`.

```bash
sed -i.bak 's|tools/digit-bootstrap/|local-setup/digit-bootstrap/|g' docs/superpowers/specs/2026-06-04-tenant-bootstrap-and-smoke-pipeline-design.md
rm docs/superpowers/specs/2026-06-04-tenant-bootstrap-and-smoke-pipeline-design.md.bak
```

- [ ] **Step 2: Verify replacement**

Run: `grep -n 'digit-bootstrap' docs/superpowers/specs/2026-06-04-tenant-bootstrap-and-smoke-pipeline-design.md`
Expected: every match prefixed with `local-setup/`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-04-tenant-bootstrap-and-smoke-pipeline-design.md
git commit -m "docs: align bootstrap spec location with local-setup/ convention"
```

---

## Task 1: Pre-flight MCP audit

**Files:**
- Create: `local-setup/digit-bootstrap/PREFLIGHT.md` (an audit log, not user-facing docs)

This task produces no code. It captures real findings against a live DIGIT instance and pins the open questions before any implementation. The remaining tasks may need their MCP calls adjusted based on what this finds.

- [ ] **Step 1: Identify the MCP REST shim base URL**

The MCP REST shim is invoked by other Claude skills (`digit-xlsx-onboard`). Locate how it's reached:

```bash
# Search for shim URL patterns in skill descriptions and existing scripts
grep -rE 'mcp.*(host|url|port|shim)' local-setup/ansible/ 2>/dev/null | head -20
grep -rE 'mcp.*(host|url|port|shim)' local-setup/scripts/ 2>/dev/null | head -20
# Likely candidate: a container/service exposed on the DIGIT host
docker ps 2>/dev/null | grep -iE 'mcp|shim' || echo "Run on DIGIT host"
```

Record the base URL in `PREFLIGHT.md` under heading `## MCP REST shim`.

- [ ] **Step 2: Probe `tenant_bootstrap` payload + response**

From a shell with access to the MCP shim, issue a dry-run-style call (read tool docs first; if no dry-run, use a throwaway tenant code):

```bash
curl -sS -X POST "$MCP_BASE/tools/tenant_bootstrap" \
  -H 'Content-Type: application/json' \
  -d '{"target_tenant":"probe1","source_tenant":"pg"}' | tee -a probe-tenant-bootstrap.json
```

Capture in `PREFLIGHT.md` under `## tenant_bootstrap probe`:
- Whether the response returns immediately (sync) or returns a job ID (async). Time with `time` if needed.
- Whether response includes which records were copied (look for `serviceDefs`, `localization`, `boundaries`).
- Status code on second call with same target (idempotent? error? overwrite?).

Then cleanup: `tenant_destroy` MCP if the probe tenant should be deleted.

- [ ] **Step 3: Probe what tenant_bootstrap actually copies**

After a probe bootstrap, query MDMS to see what landed on the target tenant:

```bash
# Departments
curl -sS -X POST "$MCP_BASE/tools/mdms_search" \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"probe1","schema_code":"common-masters.Department"}' | jq '.records | length'

# ServiceDefs (complaint types)
curl -sS -X POST "$MCP_BASE/tools/mdms_search" \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"probe1","schema_code":"RAINMAKER-PGR.ServiceDefs"}' | jq '.records | length'

# Localization
curl -sS -X POST "$MCP_BASE/tools/localization_search" \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"probe1","locale":"en_IN","module":"rainmaker-common"}' | jq '.messages | length'
```

Record counts in `PREFLIGHT.md` under `## What tenant_bootstrap copies`. This determines what the template must supply.

- [ ] **Step 4: Probe `localization_upsert` batch limit**

```bash
# Try increasing batch sizes until rejection
for N in 50 200 500 1000; do
  python3 -c "
import json
msgs = [{'code':f'PROBE_{i}','message':f'msg{i}','locale':'en_IN','module':'rainmaker-probe'} for i in range($N)]
print(json.dumps({'tenant_id':'probe1','messages':msgs}))
" | curl -sS -X POST "$MCP_BASE/tools/localization_upsert" -H 'Content-Type: application/json' -d @- -w "\nN=$N HTTP=%{http_code}\n"
done
```

Record the largest passing N in `PREFLIGHT.md`.

- [ ] **Step 5: Probe `boundary_create` (single) and look for batch alternative**

Check `mcp__subha_dev__boundary_mgmt_process` and `boundary_mgmt_generate` schemas — they may accept tree input.

```bash
# Try a single boundary create
curl -sS -X POST "$MCP_BASE/tools/boundary_create" \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"probe1","hierarchy_type":"ADMIN","code":"PROBE_BOUND","name":"Probe","boundary_type":"Locality","parent":null}'
```

Then test whether `boundary_mgmt_process` accepts an array. Record in `PREFLIGHT.md` under `## Boundary bulk method`.

- [ ] **Step 6: Probe `employee_update` for reportingTo support**

```bash
# After creating a probe employee, try setting reportingTo
curl -sS -X POST "$MCP_BASE/tools/employee_update" \
  -H 'Content-Type: application/json' \
  -d '{"tenant_id":"probe1.city","employee_id":"<id>","assignments":[{"reportingTo":"<supervisor-id>"}]}'
```

Record in `PREFLIGHT.md` whether the call shape works. (Phase 2 dependency; not needed for Phase 1 but worth verifying now.)

- [ ] **Step 7: Commit the audit log**

```bash
git add local-setup/digit-bootstrap/PREFLIGHT.md
git commit -m "chore: pre-flight MCP audit for tenant-bootstrap Phase 1"
```

- [ ] **Step 8: Adjust this plan based on findings**

For any assumption broken by the audit:
- If `tenant_bootstrap` already copies ServiceDefs → drop "complaint types" from template + remove Task 8.
- If `tenant_bootstrap` is async → add a polling sub-task to Task 5.
- If `localization_upsert` batch ceiling < expected → adjust Task 9 to page in chunks.
- If `boundary_mgmt_process` accepts trees → Task 7 uses it instead of looping `boundary_create`.

Update the affected task bodies inline and commit:
```bash
git add docs/superpowers/plans/2026-06-07-tenant-bootstrap-phase1.md
git commit -m "docs(plan): adjust Phase 1 tasks per pre-flight findings"
```

---

## Task 2: Project scaffolding

**Files:**
- Create: `local-setup/digit-bootstrap/pyproject.toml`
- Create: `local-setup/digit-bootstrap/digit_bootstrap/__init__.py`
- Create: `local-setup/digit-bootstrap/tests/__init__.py`
- Create: `local-setup/digit-bootstrap/tests/test_smoke.py`
- Create: `local-setup/digit-bootstrap/.gitignore`

- [ ] **Step 1: Write the failing smoke test**

`local-setup/digit-bootstrap/tests/test_smoke.py`:
```python
"""Verify the package imports cleanly."""

def test_package_imports():
    import digit_bootstrap
    assert digit_bootstrap.__name__ == "digit_bootstrap"
```

- [ ] **Step 2: Run it (expect FAIL — package doesn't exist yet)**

Run: `cd local-setup/digit-bootstrap && python -m pytest tests/test_smoke.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'digit_bootstrap'`.

- [ ] **Step 3: Create the package + pyproject + gitignore**

`local-setup/digit-bootstrap/pyproject.toml`:
```toml
[tool.poetry]
name = "digit-bootstrap"
version = "0.1.0"
description = "MCP-driven tenant bootstrap orchestrator for DIGIT"
authors = ["NCCG Platform <platform@nccg.test>"]
readme = "PREFLIGHT.md"
packages = [{include = "digit_bootstrap"}]

[tool.poetry.dependencies]
python = "^3.11"
httpx = "^0.27"
pydantic = "^2.8"
pyyaml = "^6.0"
typer = "^0.12"

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"
pytest-httpx = "^0.30"
mypy = "^1.10"

[tool.poetry.scripts]
digit-bootstrap = "digit_bootstrap.cli:app"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

`local-setup/digit-bootstrap/digit_bootstrap/__init__.py`:
```python
"""MCP-driven tenant bootstrap orchestrator for DIGIT."""

__version__ = "0.1.0"
```

`local-setup/digit-bootstrap/tests/__init__.py`: (empty)

`local-setup/digit-bootstrap/.gitignore`:
```
__pycache__/
*.pyc
.pytest_cache/
.venv/
dist/
build/
*.egg-info/
tenant.env
probe-*.json
```

- [ ] **Step 4: Install + re-run test**

```bash
cd local-setup/digit-bootstrap
poetry install
poetry run pytest tests/test_smoke.py -v
```
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/pyproject.toml local-setup/digit-bootstrap/digit_bootstrap local-setup/digit-bootstrap/tests local-setup/digit-bootstrap/.gitignore
git commit -m "feat(bootstrap): scaffold digit-bootstrap python package"
```

---

## Task 3: Template schema + loader

**Files:**
- Create: `local-setup/digit-bootstrap/digit_bootstrap/template.py`
- Create: `local-setup/digit-bootstrap/tests/test_template.py`
- Create: `local-setup/digit-bootstrap/tests/fixtures/minimal-template.yaml`

- [ ] **Step 1: Write the failing tests**

`local-setup/digit-bootstrap/tests/test_template.py`:
```python
"""Tests for template loading + schema validation."""
import pytest
from pathlib import Path
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
    bad = "name: bad\n"  # missing user_validation, boundary_hierarchy
    import yaml
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Template.model_validate(yaml.safe_load(bad))


def test_complaint_types_default_empty():
    tpl = load_template(FIXTURES / "minimal-template.yaml")
    assert tpl.complaint_types == []
    assert tpl.boundary_entities == []
    assert tpl.localizations == []
```

`local-setup/digit-bootstrap/tests/fixtures/minimal-template.yaml`:
```yaml
name: minimal
modeled_on: kenya
user_validation:
  - field_type: mobile
    pattern: '^[17][0-9]{8}$'
    min_length: 9
    max_length: 9
    error_message: 'Enter a 9-digit Kenya mobile'
mobile_display_prefix: '+254'
boundary_hierarchy:
  hierarchy_type: ADMIN
  levels: [Country, County, SubCounty, Ward, Locality]
  complaint_filing_level: Ward
```

- [ ] **Step 2: Run tests (expect FAIL — template module doesn't exist)**

Run: `poetry run pytest tests/test_template.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'digit_bootstrap.template'`.

- [ ] **Step 3: Implement the template module**

`local-setup/digit-bootstrap/digit_bootstrap/template.py`:
```python
"""YAML template schema + loader."""
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
    with open(path) as fh:
        data = yaml.safe_load(fh)
    return Template.model_validate(data)
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `poetry run pytest tests/test_template.py -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/template.py local-setup/digit-bootstrap/tests/test_template.py local-setup/digit-bootstrap/tests/fixtures/minimal-template.yaml
git commit -m "feat(bootstrap): template schema + loader"
```

---

## Task 4: MCP REST client wrapper

**Files:**
- Create: `local-setup/digit-bootstrap/digit_bootstrap/mcp_client.py`
- Create: `local-setup/digit-bootstrap/tests/test_mcp_client.py`

The base URL comes from `PREFLIGHT.md` (Task 1, Step 1). Substitute as appropriate; the example uses `http://localhost:8765/tools`.

- [ ] **Step 1: Write the failing tests**

`local-setup/digit-bootstrap/tests/test_mcp_client.py`:
```python
"""Tests for the MCP REST client wrapper."""
import pytest
from pytest_httpx import HTTPXMock
from digit_bootstrap.mcp_client import McpClient, McpError


def test_call_success(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="http://mock/tools/tenant_bootstrap",
        method="POST",
        json={"status": "ok", "tenant": "ke"},
    )
    client = McpClient(base_url="http://mock")
    result = client.call("tenant_bootstrap", {"target_tenant": "ke"})
    assert result == {"status": "ok", "tenant": "ke"}


def test_call_4xx_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="http://mock/tools/tenant_bootstrap",
        method="POST",
        status_code=400,
        json={"error": "bad input"},
    )
    client = McpClient(base_url="http://mock")
    with pytest.raises(McpError) as exc:
        client.call("tenant_bootstrap", {"target_tenant": ""})
    assert "bad input" in str(exc.value)


def test_call_5xx_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="http://mock/tools/whatever",
        method="POST",
        status_code=503,
        text="overloaded",
    )
    client = McpClient(base_url="http://mock")
    with pytest.raises(McpError):
        client.call("whatever", {})


def test_base_url_trailing_slash_normalized(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="http://mock/tools/x",
        method="POST",
        json={},
    )
    client = McpClient(base_url="http://mock/")
    client.call("x", {})
```

- [ ] **Step 2: Run tests (expect FAIL — module doesn't exist)**

Run: `poetry run pytest tests/test_mcp_client.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the client**

`local-setup/digit-bootstrap/digit_bootstrap/mcp_client.py`:
```python
"""Thin REST client for the on-host MCP shim.

Every method posts to {base_url}/tools/{tool_name} with a JSON body and
returns the parsed JSON response. Non-2xx responses raise McpError with the
server-supplied error payload (or text) attached.
"""
from __future__ import annotations
import httpx


class McpError(RuntimeError):
    def __init__(self, tool: str, status: int, payload: object):
        self.tool = tool
        self.status = status
        self.payload = payload
        super().__init__(f"MCP {tool} failed with {status}: {payload}")


class McpClient:
    def __init__(self, base_url: str, timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(timeout=timeout)

    def call(self, tool: str, payload: dict) -> dict:
        url = f"{self.base_url}/tools/{tool}"
        resp = self._client.post(url, json=payload)
        if resp.status_code >= 400:
            try:
                err_body = resp.json()
            except Exception:
                err_body = resp.text
            raise McpError(tool, resp.status_code, err_body)
        return resp.json()

    def close(self) -> None:
        self._client.close()
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `poetry run pytest tests/test_mcp_client.py -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/mcp_client.py local-setup/digit-bootstrap/tests/test_mcp_client.py
git commit -m "feat(bootstrap): MCP REST client wrapper"
```

---

## Task 5: Orchestrator — tenant_bootstrap call

**Files:**
- Create: `local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py`
- Create: `local-setup/digit-bootstrap/tests/test_orchestrator.py`

- [ ] **Step 1: Write the failing test**

`local-setup/digit-bootstrap/tests/test_orchestrator.py`:
```python
"""Tests for the bootstrap orchestrator (Phase 1)."""
from unittest.mock import MagicMock
from digit_bootstrap.orchestrator import Orchestrator
from digit_bootstrap.template import Template, UserValidation, BoundaryHierarchy


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


def test_bootstrap_tenant_calls_mcp_with_user_validation():
    mcp = MagicMock()
    mcp.call.return_value = {"status": "ok"}
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    orch.bootstrap_tenant(source="pg", target="ke")

    mcp.call.assert_called_once_with("tenant_bootstrap", {
        "source_tenant": "pg",
        "target_tenant": "ke",
        "user_validation": [{
            "fieldType": "mobile",
            "pattern": r"^[17][0-9]{8}$",
            "minLength": 9,
            "maxLength": 9,
        }],
    })


def test_bootstrap_tenant_skips_if_already_present():
    """Idempotency: validate_tenant first; if exists, skip the bootstrap call."""
    mcp = MagicMock()
    # First call: validate_tenant returns success (tenant exists)
    mcp.call.side_effect = [{"exists": True}]
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    orch.bootstrap_tenant(source="pg", target="ke")

    # Only validate_tenant called, not tenant_bootstrap
    assert mcp.call.call_count == 1
    assert mcp.call.call_args_list[0][0][0] == "validate_tenant"
```

- [ ] **Step 2: Run tests (expect FAIL — module doesn't exist)**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the orchestrator's bootstrap_tenant step**

`local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py`:
```python
"""Phase 1 bootstrap orchestrator.

Pipes a Template through the MCP REST shim to produce a fully-seeded
tenant root + city tenant. Each step is idempotent: probe first, create
only if missing.
"""
from __future__ import annotations
from typing import Protocol
from digit_bootstrap.template import Template


class McpLike(Protocol):
    def call(self, tool: str, payload: dict) -> dict: ...


class Orchestrator:
    def __init__(self, mcp: McpLike, template: Template):
        self.mcp = mcp
        self.template = template

    def bootstrap_tenant(self, source: str, target: str) -> None:
        """Idempotently bootstrap a tenant root from `source` into `target`."""
        # Idempotency check
        probe = self.mcp.call("validate_tenant", {"tenant_id": target})
        if probe.get("exists"):
            return

        payload = {
            "source_tenant": source,
            "target_tenant": target,
            "user_validation": [
                {
                    "fieldType": uv.field_type,
                    "pattern": uv.pattern,
                    **({"minLength": uv.min_length} if uv.min_length is not None else {}),
                    **({"maxLength": uv.max_length} if uv.max_length is not None else {}),
                    **({"errorMessage": uv.error_message} if uv.error_message else {}),
                }
                for uv in self.template.user_validation
            ],
        }
        self.mcp.call("tenant_bootstrap", payload)
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py local-setup/digit-bootstrap/tests/test_orchestrator.py
git commit -m "feat(bootstrap): orchestrator.bootstrap_tenant calls tenant_bootstrap idempotently"
```

---

## Task 6: Orchestrator — city_setup call

**Files:**
- Modify: `local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py`
- Modify: `local-setup/digit-bootstrap/tests/test_orchestrator.py`

- [ ] **Step 1: Add a failing test for setup_city**

Append to `tests/test_orchestrator.py`:
```python
def test_setup_city_calls_mcp():
    mcp = MagicMock()
    # First call: validate_tenant for city → not found, so we create.
    mcp.call.side_effect = [{"exists": False}, {"status": "ok"}]
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    orch.setup_city(root="ke", city_id="ke.nairobi", city_name="Nairobi")

    assert mcp.call.call_args_list[0][0] == ("validate_tenant", {"tenant_id": "ke.nairobi"})
    assert mcp.call.call_args_list[1][0] == ("city_setup", {
        "tenant_id": "ke.nairobi",
        "city_name": "Nairobi",
        "source_tenant": "ke",
        "create_boundaries": True,
    })


def test_setup_city_skips_if_present():
    mcp = MagicMock()
    mcp.call.return_value = {"exists": True}
    orch = Orchestrator(mcp=mcp, template=_minimal_template())

    orch.setup_city(root="ke", city_id="ke.nairobi", city_name="Nairobi")

    assert mcp.call.call_count == 1
```

- [ ] **Step 2: Run (expect FAIL — method doesn't exist)**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 2 PASS (from Task 5) + 2 FAIL with `AttributeError: 'Orchestrator' object has no attribute 'setup_city'`.

- [ ] **Step 3: Implement setup_city**

Append to `digit_bootstrap/orchestrator.py`:
```python
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
```

- [ ] **Step 4: Run tests to verify all PASS**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py local-setup/digit-bootstrap/tests/test_orchestrator.py
git commit -m "feat(bootstrap): orchestrator.setup_city wraps city_setup MCP"
```

---

## Task 7: Orchestrator — apply boundary entities

**Files:**
- Modify: `local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py`
- Modify: `local-setup/digit-bootstrap/tests/test_orchestrator.py`

The implementation here uses single-entity `boundary_create` calls in parent-first order. If Task 1's preflight found `boundary_mgmt_process` accepts a tree, swap the body for one batched call (still keeping the topological ordering).

- [ ] **Step 1: Add a failing test**

Append to `tests/test_orchestrator.py`:
```python
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


def test_apply_boundary_entities_creates_in_parent_order(httpx_mock=None):
    mcp = MagicMock()
    # boundary_entity_exists returns False for both
    mcp.call.return_value = {"exists": False}
    orch = Orchestrator(mcp=mcp, template=_template_with_boundaries())

    orch.apply_boundary_entities(city_id="ke.nairobi")

    # Filter for boundary_create calls only
    creates = [c for c in mcp.call.call_args_list if c[0][0] == "boundary_create"]
    assert len(creates) == 2
    # COUNTY1 first, then WARD1
    assert creates[0][0][1]["code"] == "COUNTY1"
    assert creates[1][0][1]["code"] == "WARD1"
    assert creates[1][0][1]["parent"] == "COUNTY1"


def test_apply_boundary_entities_skips_existing():
    mcp = MagicMock()
    # First entity exists, second doesn't
    mcp.call.side_effect = [
        {"exists": True},   # COUNTY1 exists
        {"exists": False},  # WARD1 doesn't
        {"status": "ok"},   # boundary_create for WARD1
    ]
    orch = Orchestrator(mcp=mcp, template=_template_with_boundaries())

    orch.apply_boundary_entities(city_id="ke.nairobi")

    # Only one create — for WARD1
    creates = [c for c in mcp.call.call_args_list if c[0][0] == "boundary_create"]
    assert len(creates) == 1
    assert creates[0][0][1]["code"] == "WARD1"
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 4 PASS + 2 FAIL with `AttributeError: 'Orchestrator' object has no attribute 'apply_boundary_entities'`.

- [ ] **Step 3: Implement apply_boundary_entities with topological sort**

Append to `digit_bootstrap/orchestrator.py`:
```python
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


def _topological_sort(entities):
    """Return entities ordered so each parent appears before its children."""
    by_code = {e.code: e for e in entities}
    visited: set[str] = set()
    out = []

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
```

- [ ] **Step 4: Run tests to verify all PASS**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py local-setup/digit-bootstrap/tests/test_orchestrator.py
git commit -m "feat(bootstrap): apply boundary entities in topological order"
```

---

## Task 8: Orchestrator — apply complaint types

**Files:**
- Modify: `local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py`
- Modify: `local-setup/digit-bootstrap/tests/test_orchestrator.py`

**Note:** Skip this task entirely if Task 1's preflight found that `tenant_bootstrap` already copies ServiceDefs. Otherwise proceed.

- [ ] **Step 1: Add a failing test**

Append to `tests/test_orchestrator.py`:
```python
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
    # mdms_search probe returns empty
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
    # mdms_search returns the existing record
    mcp.call.return_value = {"records": [{"serviceCode": "Pothole"}]}
    orch = Orchestrator(mcp=mcp, template=_template_with_complaint_types())

    orch.apply_complaint_types(tenant_id="ke")

    creates = [c for c in mcp.call.call_args_list if c[0][0] == "mdms_create"]
    assert len(creates) == 0
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 6 PASS + 2 FAIL with `AttributeError`.

- [ ] **Step 3: Implement apply_complaint_types**

Append to `digit_bootstrap/orchestrator.py`:
```python
    def apply_complaint_types(self, tenant_id: str) -> None:
        """Create complaint types via mdms_create against RAINMAKER-PGR.ServiceDefs."""
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
```

- [ ] **Step 4: Run tests to verify all PASS**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py local-setup/digit-bootstrap/tests/test_orchestrator.py
git commit -m "feat(bootstrap): apply complaint types via mdms_create"
```

---

## Task 9: Orchestrator — apply localizations (batched)

**Files:**
- Modify: `local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py`
- Modify: `local-setup/digit-bootstrap/tests/test_orchestrator.py`

Batch size comes from Task 1, Step 4. The example below uses 200 — replace with the verified ceiling.

- [ ] **Step 1: Add a failing test**

Append to `tests/test_orchestrator.py`:
```python
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
    # 200 + 200 + 50 = 3 batches
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
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 8 PASS + 2 FAIL with `TypeError: ... unexpected keyword argument 'localization_batch_size'`.

- [ ] **Step 3: Implement batched localization upsert**

Modify the `Orchestrator.__init__` and append `apply_localizations`:

In `digit_bootstrap/orchestrator.py`, change `__init__`:
```python
    def __init__(self, mcp: McpLike, template: Template, localization_batch_size: int = 200):
        self.mcp = mcp
        self.template = template
        self.localization_batch_size = localization_batch_size
```

Append method:
```python
    def apply_localizations(self, tenant_id: str) -> None:
        """Upsert localization rows in batches sized to the MCP ceiling."""
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
```

- [ ] **Step 4: Run tests to verify all PASS**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py local-setup/digit-bootstrap/tests/test_orchestrator.py
git commit -m "feat(bootstrap): apply localizations in batched upserts"
```

---

## Task 10: Orchestrator — emit tenant.env

**Files:**
- Modify: `local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py`
- Modify: `local-setup/digit-bootstrap/tests/test_orchestrator.py`

- [ ] **Step 1: Add a failing test**

Append to `tests/test_orchestrator.py`:
```python
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
    assert "MOBILE_PATTERN=^[17][0-9]{8}$" in text
    assert "MOBILE_PREFIX=+254" in text
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 10 PASS + 1 FAIL with `AttributeError`.

- [ ] **Step 3: Implement emit_env**

Append to `digit_bootstrap/orchestrator.py`:
```python
    def emit_env(self, path, root: str, city_id: str,
                 admin_user: str, admin_password: str) -> None:
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
```

- [ ] **Step 4: Run tests to verify all PASS**

Run: `poetry run pytest tests/test_orchestrator.py -v`
Expected: 11 PASS.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/orchestrator.py local-setup/digit-bootstrap/tests/test_orchestrator.py
git commit -m "feat(bootstrap): emit tenant.env for downstream phases"
```

---

## Task 11: Africa template content

**Files:**
- Create: `local-setup/digit-bootstrap/digit_bootstrap/templates/africa.yaml`
- Create: `local-setup/digit-bootstrap/digit_bootstrap/templates/india.yaml`
- Create: `local-setup/digit-bootstrap/tests/test_templates_load.py`

- [ ] **Step 1: Write the failing test**

`local-setup/digit-bootstrap/tests/test_templates_load.py`:
```python
"""Ensure shipped templates load and validate."""
from pathlib import Path
from digit_bootstrap.template import load_template

TEMPLATES = Path(__file__).resolve().parents[1] / "digit_bootstrap" / "templates"


def test_africa_template_loads():
    tpl = load_template(TEMPLATES / "africa.yaml")
    assert tpl.name == "africa"
    assert tpl.default is True
    assert tpl.mobile_display_prefix == "+254"
    assert any(uv.field_type == "mobile" for uv in tpl.user_validation)
    assert tpl.boundary_hierarchy.complaint_filing_level == "Ward"
    assert len(tpl.boundary_entities) >= 2
    assert len(tpl.complaint_types) >= 2
    assert len(tpl.localizations) >= 2


def test_india_template_loads():
    tpl = load_template(TEMPLATES / "india.yaml")
    assert tpl.name == "india"
    assert tpl.default is False
    assert tpl.mobile_display_prefix == "+91"
```

- [ ] **Step 2: Run (expect FAIL — templates don't exist)**

Run: `poetry run pytest tests/test_templates_load.py -v`
Expected: FAIL with `FileNotFoundError`.

- [ ] **Step 3: Create the templates**

`local-setup/digit-bootstrap/digit_bootstrap/templates/africa.yaml`:
```yaml
name: africa
modeled_on: kenya
default: true

user_validation:
  - field_type: mobile
    pattern: '^[17][0-9]{8}$'
    min_length: 9
    max_length: 9
    error_message: 'Enter a 9-digit Kenya mobile starting with 1 or 7'

mobile_display_prefix: '+254'

boundary_hierarchy:
  hierarchy_type: ADMIN
  levels: [Country, County, SubCounty, Ward, Locality]
  complaint_filing_level: Ward

boundary_entities:
  - { code: COUNTY_NAIROBI, name: Nairobi County, type: County, parent: null }
  - { code: SUBCOUNTY_WESTLANDS, name: Westlands, type: SubCounty, parent: COUNTY_NAIROBI }
  - { code: WARD_WESTLANDS, name: Westlands Ward, type: Ward, parent: SUBCOUNTY_WESTLANDS }
  - { code: LOC_WESTLANDS_1, name: Parklands, type: Locality, parent: WARD_WESTLANDS }

complaint_types:
  - { code: GarbageNotCollected, name: Garbage not collected, department: DEPT_Sanitation, sla_hours: 48 }
  - { code: Pothole, name: Pothole on road, department: DEPT_Roads, sla_hours: 72 }
  - { code: StreetlightNotWorking, name: Streetlight not working, department: DEPT_Electricity, sla_hours: 24 }

localizations:
  - { locale: sw_KE, module: rainmaker-common, code: CS_PGR_LOGIN, message: Ingia }
  - { locale: sw_KE, module: rainmaker-common, code: CS_PGR_LOGOUT, message: Toka }
  - { locale: sw_KE, module: rainmaker-pgr, code: SERVICEDEFS.GARBAGENOTCOLLECTED, message: 'Takataka hazijachukuliwa' }
```

`local-setup/digit-bootstrap/digit_bootstrap/templates/india.yaml`:
```yaml
name: india
modeled_on: punjab
default: false

user_validation:
  - field_type: mobile
    pattern: '^[6-9][0-9]{9}$'
    min_length: 10
    max_length: 10
    error_message: 'Enter a 10-digit Indian mobile starting with 6, 7, 8, or 9'

mobile_display_prefix: '+91'

boundary_hierarchy:
  hierarchy_type: ADMIN
  levels: [State, District, City, Locality]
  complaint_filing_level: Locality

boundary_entities: []
complaint_types: []
localizations: []
```

Add the templates dir to packaging in `pyproject.toml`:
```toml
[tool.poetry]
# ...add...
include = ["digit_bootstrap/templates/*.yaml"]
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `poetry run pytest tests/test_templates_load.py -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/templates local-setup/digit-bootstrap/tests/test_templates_load.py local-setup/digit-bootstrap/pyproject.toml
git commit -m "feat(bootstrap): africa + india templates"
```

---

## Task 12: CLI entry point

**Files:**
- Create: `local-setup/digit-bootstrap/digit_bootstrap/cli.py`
- Create: `local-setup/digit-bootstrap/tests/test_cli.py`

- [ ] **Step 1: Write the failing test**

`local-setup/digit-bootstrap/tests/test_cli.py`:
```python
"""Tests for the CLI wiring."""
from unittest.mock import patch, MagicMock
from typer.testing import CliRunner
from digit_bootstrap.cli import app

runner = CliRunner()


@patch("digit_bootstrap.cli.McpClient")
@patch("digit_bootstrap.cli.Orchestrator")
def test_bootstrap_invokes_orchestrator(MockOrch, MockMcp, tmp_path):
    out_env = tmp_path / "tenant.env"
    result = runner.invoke(app, [
        "--template", "africa",
        "--target", "ke",
        "--city", "ke.nairobi",
        "--city-name", "Nairobi",
        "--source", "pg",
        "--mcp-base", "http://mock",
        "--out-env", str(out_env),
    ])

    assert result.exit_code == 0, result.output
    MockOrch.assert_called_once()
    orch = MockOrch.return_value
    orch.bootstrap_tenant.assert_called_once_with(source="pg", target="ke")
    orch.setup_city.assert_called_once_with(root="ke", city_id="ke.nairobi", city_name="Nairobi")
    orch.apply_boundary_entities.assert_called_once_with(city_id="ke.nairobi")
    orch.apply_complaint_types.assert_called_once_with(tenant_id="ke")
    orch.apply_localizations.assert_called_once_with(tenant_id="ke")
    orch.emit_env.assert_called_once()


def test_bootstrap_rejects_unknown_template():
    result = runner.invoke(app, [
        "--template", "antarctica",
        "--target", "ke",
        "--city", "ke.nairobi",
        "--city-name", "Nairobi",
        "--mcp-base", "http://mock",
    ])
    assert result.exit_code != 0
    assert "antarctica" in result.output or "not found" in result.output.lower()
```

- [ ] **Step 2: Run (expect FAIL)**

Run: `poetry run pytest tests/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the CLI**

`local-setup/digit-bootstrap/digit_bootstrap/cli.py`:
```python
"""digit-bootstrap CLI entry point."""
from __future__ import annotations
from pathlib import Path
import typer
from digit_bootstrap.template import load_template
from digit_bootstrap.mcp_client import McpClient
from digit_bootstrap.orchestrator import Orchestrator

app = typer.Typer(
    add_completion=False,
    help="MCP-driven tenant bootstrap orchestrator for DIGIT (Phase 1)",
)

TEMPLATES_DIR = Path(__file__).parent / "templates"


def _resolve_template(name: str) -> Path:
    candidate = TEMPLATES_DIR / f"{name}.yaml"
    if not candidate.exists():
        raise typer.BadParameter(f"template '{name}' not found at {candidate}")
    return candidate


@app.callback(invoke_without_command=True)
def bootstrap(
    template: str = typer.Option(..., "--template", "-t",
                                 help="Country template name (africa, india)"),
    target: str = typer.Option(..., "--target", help="Target tenant root (e.g. ke)"),
    city: str = typer.Option(..., "--city", help="City tenant id (e.g. ke.nairobi)"),
    city_name: str = typer.Option(..., "--city-name", help="Human-readable city name"),
    source: str = typer.Option("pg", "--source", help="Source tenant to clone from"),
    mcp_base: str = typer.Option(..., "--mcp-base",
                                 help="Base URL of the MCP REST shim"),
    out_env: Path = typer.Option(Path("tenant.env"), "--out-env",
                                 help="Path to write the env file"),
    admin_user: str = typer.Option("", "--admin-user",
                                   help="Override the admin username "
                                        "(default: <target>-admin)"),
    admin_password: str = typer.Option("eGov@123", "--admin-password"),
) -> None:
    """Run the Phase 1 bootstrap pipeline end-to-end."""
    tpl = load_template(_resolve_template(template))
    mcp = McpClient(base_url=mcp_base)
    orch = Orchestrator(mcp=mcp, template=tpl)

    orch.bootstrap_tenant(source=source, target=target)
    orch.setup_city(root=target, city_id=city, city_name=city_name)
    orch.apply_boundary_entities(city_id=city)
    orch.apply_complaint_types(tenant_id=target)
    orch.apply_localizations(tenant_id=target)
    orch.emit_env(
        path=out_env,
        root=target,
        city_id=city,
        admin_user=admin_user or f"{target}-admin",
        admin_password=admin_password,
    )
    typer.echo(f"Bootstrap complete. Env written to {out_env}")
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `poetry run pytest tests/test_cli.py -v`
Expected: PASS, 2 tests.

- [ ] **Step 5: Confirm `digit-bootstrap --help` works**

```bash
poetry run digit-bootstrap --help
```
Expected: usage screen listing all the options above.

- [ ] **Step 6: Commit**

```bash
git add local-setup/digit-bootstrap/digit_bootstrap/cli.py local-setup/digit-bootstrap/tests/test_cli.py
git commit -m "feat(bootstrap): typer CLI wires template + MCP client + orchestrator"
```

---

## Task 13: End-to-end smoke against a live MCP

**Files:**
- Create: `local-setup/digit-bootstrap/tests/test_e2e_smoke.py` (gated by env var)

This is the only test that needs a real DIGIT + MCP shim. Skipped by default; runs in CI / on the host when `DIGIT_BOOTSTRAP_E2E=1` is set with `MCP_BASE` pointing to the shim.

- [ ] **Step 1: Write the smoke test**

`local-setup/digit-bootstrap/tests/test_e2e_smoke.py`:
```python
"""End-to-end smoke against a real MCP shim.

Skipped unless DIGIT_BOOTSTRAP_E2E=1 and MCP_BASE is set.
After the run, asserts the target tenant exists and a few seeded
records landed. Does NOT clean up the tenant — operator handles via
tenant_destroy MCP between runs.
"""
import os
import uuid
import pytest
from pathlib import Path
from digit_bootstrap.mcp_client import McpClient
from digit_bootstrap.orchestrator import Orchestrator
from digit_bootstrap.template import load_template

E2E = os.environ.get("DIGIT_BOOTSTRAP_E2E") == "1"
MCP_BASE = os.environ.get("MCP_BASE", "")

pytestmark = pytest.mark.skipif(not E2E, reason="DIGIT_BOOTSTRAP_E2E not set")

TEMPLATES = Path(__file__).resolve().parents[1] / "digit_bootstrap" / "templates"


def test_africa_end_to_end(tmp_path):
    suffix = uuid.uuid4().hex[:6]
    target = f"e2e{suffix}"
    city = f"{target}.test"

    mcp = McpClient(base_url=MCP_BASE)
    orch = Orchestrator(mcp=mcp, template=load_template(TEMPLATES / "africa.yaml"))

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

    # Post-conditions: validate_tenant should now return exists=True for both
    assert mcp.call("validate_tenant", {"tenant_id": target}).get("exists") is True
    assert mcp.call("validate_tenant", {"tenant_id": city}).get("exists") is True

    # Africa template ships 3 complaint types; at least 1 must land
    cts = mcp.call("mdms_search", {
        "tenant_id": target,
        "schema_code": "RAINMAKER-PGR.ServiceDefs",
    }).get("records", [])
    assert any(r.get("serviceCode") == "Pothole" for r in cts)

    # Africa template ships 4 boundary entities; at least 1 must land
    probe = mcp.call("boundary_entity_search", {
        "tenant_id": city,
        "code": "WARD_WESTLANDS",
    })
    assert probe.get("records") or probe.get("exists")
```

- [ ] **Step 2: Run locally with the gate off — confirm it skips**

```bash
poetry run pytest tests/test_e2e_smoke.py -v
```
Expected: 1 SKIPPED.

- [ ] **Step 3: Run on a DIGIT host with the gate on**

```bash
DIGIT_BOOTSTRAP_E2E=1 MCP_BASE=http://localhost:8765 poetry run pytest tests/test_e2e_smoke.py -v
```
Expected: 1 PASS. If FAIL, investigate via the PREFLIGHT.md probes — most likely the response shape differs from the orchestrator's assumptions.

- [ ] **Step 4: Cleanup the e2e tenant (manual)**

After a successful smoke, the e2e tenant lingers. The operator runs:
```bash
curl -sS -X POST "$MCP_BASE/tools/tenant_destroy" \
  -H 'Content-Type: application/json' \
  -d '{"target_tenant":"<the e2e tenant code>"}'
```
(Or wire this into a `tearDown` once the cleanup contract is stable.)

- [ ] **Step 5: Commit**

```bash
git add local-setup/digit-bootstrap/tests/test_e2e_smoke.py
git commit -m "test(bootstrap): e2e smoke against live MCP (gated)"
```

---

## Done — Phase 1 deliverables

After all tasks above:
- `digit-bootstrap` CLI installable via `poetry install` inside `local-setup/digit-bootstrap/`.
- Two shipped templates: `africa` (default, Kenya-modelled) and `india`.
- Unit tests for template loader, MCP client, orchestrator (all six steps), CLI wiring — green.
- One gated e2e smoke that proves the pipeline against a live MCP shim.
- `tenant.env` emitted for downstream consumption (Phase 2 personas + Phase 6 suite runner).

**Open for Phase 2:** persona provisioning (GRO, LME, ward-CSR, supervisor with reportingTo, test citizen).

**Open for Phase 3:** if `tenant_bootstrap` turned out to be async, add `digit-bootstrap status <job-id>` + `--wait` flag.
