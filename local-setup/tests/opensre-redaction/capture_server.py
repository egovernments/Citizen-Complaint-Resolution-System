"""Stand-in for Gatus, Grafana/Loki and the Anthropic API, for run.sh.

One HTTP server on 127.0.0.1:<port> plays three parts:
  - Gatus: one failing check, whose error text carries a secret
  - Grafana: a Loki datasource whose log lines carry the samples in leaks.json
  - Anthropic Messages API: answers the agent (first a call to
    query_grafana_logs, then a final report) and appends every request it
    receives, headers and body, to <capture>.

Everything the agent sends to the model provider passes through here, so
<capture> is exactly what would have left the box.

Usage: capture_server.py <port> <leaks.json> <capture.jsonl>
"""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(sys.argv[1])
LEAKS = json.load(open(sys.argv[2]))
CAPTURE = sys.argv[3]
LOCK = threading.Lock()

TOOL_CALL = json.dumps(
    {"tool_calls": [{"id": "call_1", "name": "query_grafana_logs", "input": {"service_name": "kong"}}]}
)
FINAL = "STUB-FINAL-REPORT: the capture server wrote this; cause unknown."


def gatus():
    ok = [{"success": True}]
    bad = [{"success": False}, {"success": False}, {"success": False, "errors": [LEAKS["gatus_error"]]}]
    return [
        {"key": "core_kong", "group": "core", "name": "Kong", "results": bad},
        {"key": "core_gatus", "group": "core", "name": "Gatus", "results": ok},
    ]


def loki():
    lines = [[str(1_800_000_000_000_000_000 + i), line] for i, line in enumerate(LEAKS["log_lines"])]
    return {
        "status": "success",
        "data": {"resultType": "streams", "result": [{"stream": {"service_name": "kong"}, "values": lines}]},
    }


def message(text):
    return {
        "id": "msg_capture",
        "type": "message",
        "role": "assistant",
        "model": "capture",
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }


def sse(text):
    start = message("")
    start["content"], start["stop_reason"] = [], None
    events = [
        ("message_start", {"type": "message_start", "message": start}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 1}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events).encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def send(self, status, body, content_type="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/v1/endpoints/statuses":
            return self.send(200, gatus())
        if path == "/api/user":
            return self.send(200, {"id": 1, "login": "capture"})
        if path == "/api/health":
            return self.send(200, {"database": "ok"})
        if path == "/api/datasources":
            return self.send(200, [{"uid": "loki", "type": "loki", "name": "Loki", "isDefault": True}])
        if path.endswith("/loki/api/v1/query_range"):
            return self.send(200, loki())
        if "/loki/api/v1/label/" in path:
            return self.send(200, {"status": "success", "data": ["kong"]})
        return self.send(404, {"error": "not served by the capture server"})

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8", "replace")
        record = {"path": self.path, "user_agent": self.headers.get("User-Agent", ""), "body": body}
        with LOCK, open(CAPTURE, "a") as f:
            f.write(json.dumps(record) + "\n")
        if not urlparse(self.path).path.startswith("/v1/messages"):
            return self.send(404, {"error": "not served by the capture server"})
        if urlparse(self.path).path.endswith("/count_tokens"):
            return self.send(200, {"input_tokens": 1})
        try:
            request = json.loads(body)
        except ValueError:
            request = {}
        if "Tool result for query_grafana_logs" in body or "tool-calling adapter" not in body:
            text = FINAL
        else:
            text = TOOL_CALL
        if request.get("stream"):
            return self.send(200, sse(text), "text/event-stream")
        return self.send(200, message(text))


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
