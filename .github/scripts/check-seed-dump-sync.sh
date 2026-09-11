#!/usr/bin/env bash
#
# Single-source-of-truth guard for the seed dump.
#
# The ansible/compose tier mounts local-setup/db/full-dump.sql directly into
# Postgres' initdb.d. The k8s db-seed chart CANNOT reference that file — Helm's
# .Files.Get only reads inside the chart dir — so it bundles a gzipped copy at
# db-seed/files/full-dump.sql.gz. That copy is DERIVED from the canonical dump,
# never hand-edited. This check fails if the two drift apart (which is exactly
# how the k8s tier once shipped 108 localizations while ansible had 2065).
#
# Run with --fix to regenerate the k8s copy from the canonical dump.
set -euo pipefail

CANON="local-setup/db/full-dump.sql"
GZ="devops/deploy-as-code/charts/backbone-services/db-seed/files/full-dump.sql.gz"

if [ "${1:-}" = "--fix" ]; then
  gzip -nc "$CANON" > "$GZ"   # -n: no name/timestamp, keeps regen deterministic
  echo "Regenerated $GZ from $CANON"
  exit 0
fi

if ! gzip -dc "$GZ" | diff -q - "$CANON" >/dev/null 2>&1; then
  echo "ERROR: k8s db-seed dump is OUT OF SYNC with the canonical dump."
  echo "  canonical : $CANON"
  echo "  k8s copy  : $GZ"
  echo "The k8s deploy would seed different data than ansible. Regenerate with:"
  echo "  bash .github/scripts/check-seed-dump-sync.sh --fix"
  exit 1
fi

echo "OK: k8s db-seed dump matches the canonical ansible dump ($CANON)."
