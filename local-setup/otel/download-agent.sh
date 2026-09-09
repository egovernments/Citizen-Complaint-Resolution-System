#!/bin/bash
# Downloads the OpenTelemetry Java Agent JAR for auto-instrumentation and
# verifies it against a checksum committed to this repo.
#
# Usage: ./otel/download-agent.sh
#
# Why verification matters here: this JAR is injected into EVERY JVM in the
# stack via JAVA_TOOL_OPTIONS -javaagent. A Java agent runs inside the target
# process with full access to its memory, classes and credentials, so a
# tampered agent is arbitrary code execution in every backend service at once.
# The download used to be an unauthenticated `curl -fSL` with no integrity
# check of any kind.
#
# Upstream publishes no .sha256 asset — only a detached GPG signature. So the
# primary control is agent-checksums.txt in this directory: digests recorded
# from jars whose .asc signature was verified against the OpenTelemetry Java
# signing key (3F05 DDA9 F317 301E 9271 36D4 17A2 7CE7 A60F F5F0). That also
# works on a box with no GPG and no keyserver reachability.
#
# Set OTEL_AGENT_VERIFY_GPG=1 to additionally verify the detached signature at
# download time (needs gpg and the key in the local keyring).

set -euo pipefail

AGENT_VERSION="${OTEL_AGENT_VERSION:-2.11.0}"
AGENT_JAR="opentelemetry-javaagent.jar"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$SCRIPT_DIR/$AGENT_JAR"
CHECKSUMS="$SCRIPT_DIR/agent-checksums.txt"
OTEL_SIGNING_KEY="3F05DDA9F317301E927136D417A27CE7A60FF5F0"

if [[ -f "$DEST" ]]; then
  echo "OTEL Java Agent already exists at $DEST"
  echo "To re-download, delete it first: rm $DEST"
  exit 0
fi

# Resolve the expected digest BEFORE downloading, so an unpinned version fails
# fast instead of installing something unverified.
if [[ ! -f "$CHECKSUMS" ]]; then
  echo "ERROR: $CHECKSUMS is missing — refusing to install an unverified agent." >&2
  exit 1
fi

EXPECTED="$(awk -v v="$AGENT_VERSION" '$1 !~ /^#/ && $2 == v { print $1 }' "$CHECKSUMS")"
if [[ -z "$EXPECTED" ]]; then
  echo "ERROR: no checksum pinned for OTEL agent version '$AGENT_VERSION'." >&2
  echo "       Add one to $CHECKSUMS (it documents how to verify first)," >&2
  echo "       or set OTEL_AGENT_VERSION to a version that is already pinned:" >&2
  awk '$1 !~ /^#/ && NF == 2 { print "         " $2 }' "$CHECKSUMS" >&2
  exit 1
fi

BASE="https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${AGENT_VERSION}"
URL="$BASE/$AGENT_JAR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading OpenTelemetry Java Agent v${AGENT_VERSION}..."
echo "  From: $URL"
echo "  To:   $DEST"

# Download to a temp path: the destination must never hold an unverified jar,
# not even briefly, since the compose stack may pick it up concurrently.
curl -fSL -o "$TMP/$AGENT_JAR" "$URL"

echo "Verifying SHA256..."
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP/$AGENT_JAR" | awk '{print $1}')"
else
  ACTUAL="$(shasum -a 256 "$TMP/$AGENT_JAR" | awk '{print $1}')"
fi

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "ERROR: checksum mismatch for OTEL agent v${AGENT_VERSION}." >&2
  echo "  expected: $EXPECTED" >&2
  echo "  actual:   $ACTUAL" >&2
  echo "The downloaded jar was DISCARDED. Do not install it." >&2
  exit 1
fi
echo "  OK: $ACTUAL"

if [[ "${OTEL_AGENT_VERIFY_GPG:-0}" == "1" ]]; then
  echo "Verifying GPG signature..."
  curl -fSL -o "$TMP/$AGENT_JAR.asc" "$BASE/$AGENT_JAR.asc"
  gpg --verify "$TMP/$AGENT_JAR.asc" "$TMP/$AGENT_JAR"
  # --verify alone exits 0 for a good signature from ANY key in the keyring;
  # pin the expected signer explicitly.
  gpg --status-fd 1 --verify "$TMP/$AGENT_JAR.asc" "$TMP/$AGENT_JAR" 2>/dev/null \
    | grep -q "VALIDSIG $OTEL_SIGNING_KEY" || {
      echo "ERROR: signature is not from the expected OpenTelemetry Java key" >&2
      echo "       ($OTEL_SIGNING_KEY). Discarded." >&2
      exit 1
    }
  echo "  OK: signed by $OTEL_SIGNING_KEY"
fi

mv "$TMP/$AGENT_JAR" "$DEST"
echo "Done. Agent saved to $DEST ($(du -h "$DEST" | cut -f1))"
