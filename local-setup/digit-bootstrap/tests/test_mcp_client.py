"""Tests for the MCP-protocol client wrapper.

The MCP server speaks JSON-RPC 2.0 over `{base_url}/mcp` with SSE
responses. Tests mock the SSE envelope shape.
"""
import json

import pytest
from pytest_httpx import HTTPXMock

from digit_bootstrap.mcp_client import McpClient, McpError


def _sse_envelope(payload: dict) -> str:
    """Build an `event: message` SSE body wrapping a JSON-RPC envelope."""
    return f"event: message\ndata: {json.dumps(payload)}\n\n"


def _initialize_response() -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {"listChanged": True}},
            "serverInfo": {"name": "digit-mcp", "version": "1.0.0"},
        },
    }


def _tool_response(id_: int, tool_result: dict) -> dict:
    """Build a JSON-RPC envelope wrapping a tools/call result.

    Mirrors the digit-mcp shape: result has a `content` list where the
    first entry is a `text` block whose `text` is the JSON-encoded
    tool output.
    """
    return {
        "jsonrpc": "2.0",
        "id": id_,
        "result": {
            "content": [
                {"type": "text", "text": json.dumps(tool_result)},
            ],
        },
    }


def test_call_success(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_initialize_response()),
        headers={"Content-Type": "text/event-stream"},
    )
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_tool_response(2, {"valid": True, "tenant": "ke"})),
        headers={"Content-Type": "text/event-stream"},
    )

    client = McpClient(base_url="http://mock")
    result = client.call("validate_tenant", {"tenant_id": "ke"})
    assert result == {"valid": True, "tenant": "ke"}


def test_call_initializes_once(httpx_mock: HTTPXMock):
    """Second call reuses the initialized client — no second initialize."""
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_initialize_response()),
        headers={"Content-Type": "text/event-stream"},
    )
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_tool_response(2, {"valid": True})),
        headers={"Content-Type": "text/event-stream"},
    )
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_tool_response(3, {"records": [{"k": "v"}]})),
        headers={"Content-Type": "text/event-stream"},
    )

    client = McpClient(base_url="http://mock")
    client.call("validate_tenant", {"tenant_id": "ke"})
    client.call("mdms_search", {"tenant_id": "ke", "schema_code": "S"})

    # 3 POSTs total: initialize + 2 tool calls
    assert len(httpx_mock.get_requests()) == 3
    methods = [
        json.loads(r.content).get("method") for r in httpx_mock.get_requests()
    ]
    assert methods == ["initialize", "tools/call", "tools/call"]


def test_call_jsonrpc_error_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_initialize_response()),
        headers={"Content-Type": "text/event-stream"},
    )
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope({
            "jsonrpc": "2.0",
            "id": 2,
            "error": {"code": -32602, "message": "Invalid tenant"},
        }),
        headers={"Content-Type": "text/event-stream"},
    )
    client = McpClient(base_url="http://mock")
    with pytest.raises(McpError) as exc:
        client.call("validate_tenant", {"tenant_id": ""})
    assert "Invalid tenant" in str(exc.value)


def test_call_5xx_raises(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        status_code=503,
        text="overloaded",
    )
    client = McpClient(base_url="http://mock")
    with pytest.raises(McpError):
        client.call("anything", {})


def test_base_url_trailing_slash_normalized(httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_initialize_response()),
        headers={"Content-Type": "text/event-stream"},
    )
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_tool_response(2, {})),
        headers={"Content-Type": "text/event-stream"},
    )
    client = McpClient(base_url="http://mock/")
    client.call("x", {})


def test_session_id_echoed_on_subsequent_requests(httpx_mock: HTTPXMock):
    """If the server pins a Mcp-Session-Id, the client must echo it back."""
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_initialize_response()),
        headers={
            "Content-Type": "text/event-stream",
            "Mcp-Session-Id": "abc123",
        },
    )
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        text=_sse_envelope(_tool_response(2, {"ok": True})),
        headers={"Content-Type": "text/event-stream"},
    )
    client = McpClient(base_url="http://mock")
    client.call("x", {})

    second_req = httpx_mock.get_requests()[1]
    assert second_req.headers.get("Mcp-Session-Id") == "abc123"


def test_plain_json_response_also_accepted(httpx_mock: HTTPXMock):
    """Some servers reply with Content-Type: application/json instead of SSE."""
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        json=_initialize_response(),
    )
    httpx_mock.add_response(
        url="http://mock/mcp",
        method="POST",
        json=_tool_response(2, {"hi": "there"}),
    )
    client = McpClient(base_url="http://mock")
    result = client.call("x", {})
    assert result == {"hi": "there"}
