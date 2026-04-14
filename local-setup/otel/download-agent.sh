#!/bin/bash
# Downloads the OpenTelemetry Java Agent JAR for auto-instrumentation.
# Run this once before starting the OTEL overlay.
#
# Usage: ./otel/download-agent.sh

set -euo pipefail

AGENT_VERSION="${OTEL_AGENT_VERSION:-2.11.0}"
AGENT_JAR="opentelemetry-javaagent.jar"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$SCRIPT_DIR/$AGENT_JAR"

if [[ -f "$DEST" ]]; then
  echo "OTEL Java Agent already exists at $DEST"
  echo "To re-download, delete it first: rm $DEST"
  exit 0
fi

URL="https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${AGENT_VERSION}/${AGENT_JAR}"

echo "Downloading OpenTelemetry Java Agent v${AGENT_VERSION}..."
echo "  From: $URL"
echo "  To:   $DEST"

curl -fSL -o "$DEST" "$URL"

echo "Done. Agent saved to $DEST ($(du -h "$DEST" | cut -f1))"
