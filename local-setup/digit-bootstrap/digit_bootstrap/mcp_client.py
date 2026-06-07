"""Thin REST client for the on-host MCP shim.

Every method posts to {base_url}/tools/{tool_name} with a JSON body and
returns the parsed JSON response. Non-2xx responses raise McpError with
the server-supplied error payload (or text) attached.
"""
from __future__ import annotations
import httpx


class McpError(RuntimeError):
    def __init__(self, tool: str, status: int, payload: object) -> None:
        self.tool = tool
        self.status = status
        self.payload = payload
        super().__init__(f"MCP {tool} failed with {status}: {payload}")


class McpClient:
    def __init__(self, base_url: str, timeout: float = 60.0) -> None:
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
