#!/usr/bin/env bash
# Runs the provider tests inside the stock Novu worker image they patch, so a pass
# means "works against these exact Novu internals". Override the image to check a
# Novu upgrade: NOVU_TEST_IMAGE=ghcr.io/novuhq/novu/worker:<ver> ./run-tests.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image="${NOVU_TEST_IMAGE:-ghcr.io/novuhq/novu/worker:2.3.0}"

# NEW_RELIC_ENABLED=false silences the image's agent bootstrap warning.
docker run --rm \
  -v "$here:/opt/digit-novu-providers:ro" \
  -e NEW_RELIC_ENABLED=false \
  --entrypoint sh \
  "$image" -c 'node --test /opt/digit-novu-providers/test/*.test.js'
