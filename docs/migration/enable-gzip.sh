#!/usr/bin/env bash
# enable-gzip.sh — guided, single-run gzip enablement for /digit-ui.
#
# RUN THIS ON THE BOX THAT SERVES THE SITE (the gzip phase edits that
# machine's nginx — running it anywhere else edits the wrong machine).
#
#   bash enable-gzip.sh                      # host defaults to http://127.0.0.1
#   HOST=http://localhost bash enable-gzip.sh
#   OAUTH_USER=ADMIN OAUTH_PASS='secret' bash enable-gzip.sh   # non-default creds
#
# Safe by design: shows a dry-run plan and waits for Enter before writing;
# the apply step itself takes a timestamped backup and auto-rolls-back if
# `nginx -t` rejects the change. Re-running any number of times is safe.

HOST="${HOST:-http://127.0.0.1}"
RUNNER="$(dirname "$0")/ccrs-migrate.cjs"
PROBE_URL="$HOST/digit-ui/index.js"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
pause(){ printf '\n'; read -r -p ">>> $1 — press Enter to continue (Ctrl+C to abort) "; }

say "═══ CCRS gzip enablement — $(hostname) ═══"

# ── 0. sanity: right machine? right files? ──────────────────────────────
if [ ! -f "$RUNNER" ]; then
  echo "✖ ccrs-migrate.cjs not found next to this script — run from the repo's docs/migration/ directory."
  exit 1
fi
if [ -e /etc/nginx/sites-enabled/localhost ] && [ "$(hostname)" != "${EXPECTED_HOSTNAME:-}" ]; then
  echo "⚠ This machine has an nginx site named 'localhost' — that usually means a LOCAL dev box."
  read -r -p ">>> Type YES if you are sure this is the serving box for $HOST: " ok
  [ "$ok" = "YES" ] || { echo "aborted."; exit 1; }
fi

# ── 1. baseline ─────────────────────────────────────────────────────────
say "[1/5] Baseline — current state of $PROBE_URL"
enc=$(curl -sI --max-time 15 -H 'Accept-Encoding: gzip' "$PROBE_URL" | grep -i '^content-encoding' | tr -d '\r')
size=$(curl -s --max-time 60 -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: gzip' --compressed "$PROBE_URL")
echo "    content-encoding: ${enc:-'(none)'}"
echo "    transferred:      ${size:-?} bytes"
if [ -n "$enc" ]; then
  echo "✔ gzip already active — nothing to do. (Re-run after a redeploy if it ever regresses.)"
  exit 0
fi
echo "→ gzip is OFF (raw transfer). Proceeding will enable it."

# ── 2. sudo prime (the runner shells out with sudo for nginx edits) ─────
say "[2/5] Priming sudo (nginx edit + test + reload need it)"
sudo -v || { echo "✖ sudo required"; exit 1; }

# ── 3. dry-run plan ──────────────────────────────────────────────────────
say "[3/5] Dry-run — plan only, no writes"
node "$RUNNER" --host "$HOST" --tenant "${TENANT:-mz}" --phases auth,gzip --gzip --dry-run --no-color || {
  echo "✖ dry-run failed (see AUTH_FAILED detail above: ENOTFOUND = wrong host; 400 = wrong creds — set OAUTH_USER/OAUTH_PASS; 500 JDBC = env DB down)"; exit 1; }
pause "Apply the plan above (backup → insert gzip block → nginx -t → reload)"

# ── 4. apply ─────────────────────────────────────────────────────────────
say "[4/5] Applying"
node "$RUNNER" --host "$HOST" --tenant "${TENANT:-mz}" --phases auth,gzip --gzip --no-color || { echo "✖ apply failed"; exit 1; }
# keep runner backups out of nginx's include glob (they confuse re-runs and get include-loaded)
sudo mkdir -p /etc/nginx/ccrs-backups
sudo mv /etc/nginx/sites-enabled/*.ccrs-gzip.bak* /etc/nginx/ccrs-backups/ 2>/dev/null || true

# ── 5. verify ────────────────────────────────────────────────────────────
say "[5/5] Verify"
enc=$(curl -sI --max-time 15 -H 'Accept-Encoding: gzip' "$PROBE_URL" | grep -i '^content-encoding' | tr -d '\r')
cc=$(curl -sI --max-time 15 -H 'Accept-Encoding: gzip' "$PROBE_URL" | grep -i '^cache-control' | head -1 | tr -d '\r')
size=$(curl -s --max-time 60 -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: gzip' --compressed "$PROBE_URL")
echo "    ${enc:-content-encoding: (none)}"
echo "    ${cc:-cache-control: (none)}"
echo "    transferred: ${size:-?} bytes"
case "$enc" in
  *gzip*) say "✔ SUCCESS — gzip active (expect ~2.1–2.5MB instead of ~8MB). Backups in /etc/nginx/ccrs-backups/." ;;
  *)      say "✖ still not compressed — send the [4/5] output to the team; backup untouched in /etc/nginx/ccrs-backups/." ; exit 1 ;;
esac
