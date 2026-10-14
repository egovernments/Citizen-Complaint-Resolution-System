#!/usr/bin/env bash
# OpenSRE redaction, end to end: what the agent actually sends to the model
# provider.
#
# guardrails.yml only protects anything if OpenSRE applies it on the route the
# agent uses to reach the model. In 0.1.2026.9.21 its Anthropic SDK client
# does not, so the image reaches the model through the Claude Code CLI instead
# (opensre/claude-locked). This proves that end to end, with the real image
# and the real sweep loop:
#
#   1. Builds the image (SKIP_BUILD=1 reuses $OPENSRE_TEST_IMAGE).
#   2. Checks there is no Python in it (see the Dockerfile).
#   3. Starts capture_server.py as Gatus, Grafana/Loki and the Anthropic API
#      (ANTHROPIC_BASE_URL), and runs the container read-only, like the
#      Kubernetes tier, until one investigation is logged. The scripted model
#      calls query_grafana_logs, so the Loki lines in leaks.json come back as a
#      tool result and are sent in the next request.
#   4. Checks every captured request: all from the Claude Code CLI, none
#      offering the CLI's own tools, the tool result present, and no secret
#      or citizen phone number from leaks.json anywhere in it.
#
# Needs docker and python3 on the host (the server runs there, not in the
# image). CI: .github/workflows/opensre-redaction.yml.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
IMAGE=${OPENSRE_TEST_IMAGE:-ccrs-opensre:redaction-test}
PORT=${OPENSRE_TEST_PORT:-18765}
NAME=opensre-redaction-test
WORK=$(mktemp -d)
SERVER_PID=

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  if [ -n "${KEEP_WORK:-}" ]; then echo "work dir kept: $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "building $IMAGE"
  docker build -q -t "$IMAGE" "$REPO/local-setup/opensre" >/dev/null
fi

if found=$(docker run --rm --entrypoint sh "$IMAGE" -c 'command -v python3 || command -v python'); then
  fail "the image has a Python interpreter ($found); OpenSRE would offer execute_python_code"
fi
echo "ok: no Python in the image"

python3 "$HERE/capture_server.py" "$PORT" "$HERE/leaks.json" "$WORK/capture.jsonl" &
SERVER_PID=$!
for _ in $(seq 50); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.2
done

base=http://127.0.0.1:$PORT
docker run -d --name "$NAME" --network host --read-only \
  --tmpfs /tmp --tmpfs /home/opensre:uid=10001,gid=10001 --tmpfs /var/log/opensre:uid=10001,gid=10001 \
  -e OPENSRE_GATUS_URL="$base" -e GRAFANA_INSTANCE_URL="$base" -e GRAFANA_READ_TOKEN=capture-grafana-token \
  -e ANTHROPIC_BASE_URL="$base" -e ANTHROPIC_API_KEY=sk-ant-api03-capture-test-key \
  -e CLAUDE_CODE_MODEL=claude-opus-5 -e OPENSRE_DEPLOYMENT="A redaction test; nothing is real." \
  -e OPENSRE_SWEEP_INTERVAL_MINUTES=60 -e OPENSRE_INVESTIGATION_TIMEOUT_SECONDS=300 \
  -e OPENSRE_NO_TELEMETRY=1 -e OPENSRE_SENTRY_DISABLED=1 -e OPENSRE_PROMPT_LOG_DISABLED=1 \
  "$IMAGE" >/dev/null

echo "waiting for one investigation"
for _ in $(seq 300); do
  if docker logs "$NAME" 2>/dev/null | grep -q '"kind":"investigation"'; then break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != true ]; then break; fi
  sleep 1
done
docker logs "$NAME" > "$WORK/loop.log" 2>&1
docker exec "$NAME" cat /var/log/opensre/investigations.log > "$WORK/investigations.log" 2>/dev/null || true

python3 - "$WORK" "$HERE/leaks.json" <<'EOF'
import json, sys

work, leaks = sys.argv[1], json.load(open(sys.argv[2]))
loop = [json.loads(l) for l in open(f"{work}/loop.log") if l.startswith("{")]
runs = [r for r in loop if r.get("kind") == "investigation"]
problems = []

def check(ok, what):
    print(("ok: " if ok else "FAIL: ") + what)
    if not ok:
        problems.append(what)

check(len(runs) == 1, "the loop logged one investigation")
if runs:
    check(runs[0]["exit_code"] == 0, f"it completed (exit {runs[0]['exit_code']})")
    check("STUB-FINAL-REPORT" in json.dumps(runs[0]["result"]), "the model's final answer was recorded")
check("Model output, not verified" in open(f"{work}/investigations.log").read(),
      "investigations.log marks the report as unverified model output")

try:
    captured = [json.loads(l) for l in open(f"{work}/capture.jsonl")]
except FileNotFoundError:
    captured = []
messages = [c for c in captured if c["path"].split("?")[0].startswith("/v1/messages")]
check(len(messages) >= 2, f"{len(messages)} model requests captured (at least 2)")
check(all(c["user_agent"].startswith("claude-cli/") for c in captured),
      "every request came from the Claude Code CLI: " + ", ".join(sorted({c["user_agent"] for c in captured})))
check(not any(json.loads(c["body"]).get("tools") for c in messages),
      "no request offers the CLI's own tools (Bash, Read, ...)")
check(any("Tool result for query_grafana_logs" in c["body"] for c in messages),
      "the Loki lines went to the model as a tool result")

everything = "\n".join(c["body"] for c in captured)
lower = everything.lower()
check(leaks["secret_marker"] not in lower, "no secret from leaks.json in any request")
check(leaks["phone_marker"] not in lower, "no citizen phone number in any request")
check("[REDACTED:" in everything, "the redaction markers are there")
if leaks["secret_marker"] in lower or leaks["phone_marker"] in lower:
    for c in captured:
        body = c["body"]
        for marker in (leaks["secret_marker"], leaks["phone_marker"]):
            at = body.lower().find(marker)
            while at != -1:
                print("  leaked:", json.dumps(body[max(0, at - 120):at + 40]))
                at = body.lower().find(marker, at + 1)
sys.exit(1 if problems else 0)
EOF
