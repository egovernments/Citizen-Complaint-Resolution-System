"""Tests for the CLI wiring."""
from unittest.mock import patch
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
    orch.setup_city.assert_called_once_with(
        root="ke", city_id="ke.nairobi", city_name="Nairobi"
    )
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
    output = result.output.lower()
    assert "antarctica" in output or "not found" in output
