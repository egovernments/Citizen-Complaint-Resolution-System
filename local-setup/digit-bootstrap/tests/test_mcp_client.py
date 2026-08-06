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
