"""MCP-protocol client for the on-host digit-mcp server.

Speaks JSON-RPC 2.0 over HTTP at `{base_url}/mcp` with SSE responses
(`Content-Type: text/event-stream`). One `initialize` handshake is
performed lazily on the first `.call()`; subsequent calls reuse the
client and bump the JSON-RPC `id` counter.

Surface mirrors the previous REST-shape McpClient — `.call(tool, payload)`
returns the tool's `arguments` -> JSON result. McpError carries the
JSON-RPC error envelope or transport details on failure.

Notes:
- httpx is constructed with `trust_env=False` so ambient SOCKS/HTTP
  proxies don't intercept the call.
- The MCP server may issue a `Mcp-Session-Id` header on the
  initialize response; if so, it's echoed on subsequent requests.
- The server-side response is SSE-encoded; we parse the first
  `event: message\\ndata: <json>` block as the JSON-RPC envelope.
- For authentication, callers must seed credentials by invoking the
  `configure` tool as the first `.call()` (it accepts username/
  password/tenant in arguments).
"""
from __future__ import annotations
import itertools
import json
from typing import Any

import httpx


class McpError(RuntimeError):
    """Raised when the MCP server returns a JSON-RPC error or HTTP failure."""

    def __init__(self, tool: str, status: int, payload: object) -> None:
        self.tool = tool
        self.status = status
        self.payload = payload
        super().__init__(f"MCP {tool} failed with {status}: {payload}")


def _parse_sse_payload(body: str) -> dict:
    """Extract the first `event: message` JSON-RPC envelope from an SSE body.

    The MCP server returns:
        event: message\\n
        data: {...JSON-RPC envelope...}\\n\\n
    Some servers may stream multiple data lines per event — we
    concatenate them.
    """
    data_lines: list[str] = []
    for line in body.splitlines():
        if line.startswith("data:"):
            data_lines.append(line[len("data:") :].lstrip())
    if not data_lines:
        # Fall back: treat the body as raw JSON (some MCP servers
        # respond with application/json instead of text/event-stream).
        return json.loads(body)
    return json.loads("".join(data_lines))


class McpClient:
    """JSON-RPC 2.0 client for an MCP server at `{base_url}/mcp`."""

    def __init__(
        self,
        base_url: str,
        timeout: float = 60.0,
        client_name: str = "digit-bootstrap",
        client_version: str = "0.1.0",
        protocol_version: str = "2025-06-18",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._url = f"{self.base_url}/mcp"
        # trust_env=False so a SOCKS/HTTP proxy in the shell env (common
        # on dev machines) doesn't intercept calls to the MCP shim.
        # Operator passes the shim URL directly via --mcp-base.
        self._client = httpx.Client(timeout=timeout, trust_env=False)
        self._client_name = client_name
        self._client_version = client_version
        self._protocol_version = protocol_version
        self._initialized = False
        self._session_id: str | None = None
        self._id_counter = itertools.count(1)

    def _next_id(self) -> int:
        return next(self._id_counter)

    def _headers(self) -> dict[str, str]:
        h = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self._session_id is not None:
            h["Mcp-Session-Id"] = self._session_id
        return h

    def _post(self, body: dict[str, Any]) -> tuple[httpx.Response, dict]:
        resp = self._client.post(self._url, headers=self._headers(), json=body)
        if resp.status_code >= 400:
            raise McpError(
                body.get("params", {}).get("name", body.get("method", "?")),
                resp.status_code,
                resp.text,
            )
        # Echo back any session id the server pinned to us
        sid = resp.headers.get("Mcp-Session-Id")
        if sid:
            self._session_id = sid
        envelope = _parse_sse_payload(resp.text)
        return resp, envelope

    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        body = {
            "jsonrpc": "2.0",
            "method": "initialize",
            "params": {
                "protocolVersion": self._protocol_version,
                "capabilities": {},
                "clientInfo": {
                    "name": self._client_name,
                    "version": self._client_version,
                },
            },
            "id": self._next_id(),
        }
        _, envelope = self._post(body)
        if "error" in envelope:
            raise McpError("initialize", 0, envelope["error"])
        self._initialized = True

    def call(self, tool: str, payload: dict) -> dict:
        """Invoke `tool` with `payload` as `tools/call` arguments.

        Returns the tool's structured content (the inner JSON object the
        tool produced). Raises McpError on JSON-RPC errors or non-2xx
        transport responses.
        """
        self._ensure_initialized()
        body = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": tool, "arguments": payload},
            "id": self._next_id(),
        }
        _, envelope = self._post(body)
        if "error" in envelope:
            raise McpError(tool, 0, envelope["error"])
        result = envelope.get("result", {})
        # MCP tools return a `content` list — each entry is either text
        # or a structured content block. The digit-mcp server typically
        # returns one block with `type: "text"` whose `text` is a JSON
        # string. Unwrap it.
        content = result.get("content")
        if isinstance(content, list) and content:
            first = content[0]
            if isinstance(first, dict):
                if first.get("type") == "text" and "text" in first:
                    try:
                        return json.loads(first["text"])
                    except (TypeError, json.JSONDecodeError):
                        return {"raw": first["text"]}
                if "json" in first:
                    return first["json"]
        # Fallback: return the whole result envelope
        return result

    def close(self) -> None:
        self._client.close()
