"""digit-bootstrap CLI entry point (Phase 1).

One command runs the whole pipeline:
  digit-bootstrap --template africa --target ke --city ke.nairobi \\
                  --city-name Nairobi --mcp-base http://<host>/mcp
"""
from __future__ import annotations
from pathlib import Path

import typer

from digit_bootstrap.mcp_client import McpClient
from digit_bootstrap.orchestrator import Orchestrator
from digit_bootstrap.template import load_template

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
    template: str = typer.Option(
        ..., "--template", "-t",
        help="Country template name (africa, india)",
    ),
    target: str = typer.Option(
        ..., "--target",
        help="Target tenant root (e.g. ke)",
    ),
    city: str = typer.Option(
        ..., "--city",
        help="City tenant id (e.g. ke.nairobi)",
    ),
    city_name: str = typer.Option(
        ..., "--city-name",
        help="Human-readable city name",
    ),
    source: str = typer.Option(
        "pg", "--source",
        help="Source tenant to clone from",
    ),
    mcp_base: str = typer.Option(
        ..., "--mcp-base",
        help="Base URL of the MCP REST shim",
    ),
    out_env: Path = typer.Option(
        Path("tenant.env"), "--out-env",
        help="Path to write the env file",
    ),
    admin_user: str = typer.Option(
        "", "--admin-user",
        help="Override the admin username (default: <target>-admin)",
    ),
    admin_password: str = typer.Option(
        "eGov@123", "--admin-password",
    ),
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
