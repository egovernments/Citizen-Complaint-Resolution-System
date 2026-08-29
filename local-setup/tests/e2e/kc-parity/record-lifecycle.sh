#!/usr/bin/env bash
# Record the UI-only PGR lifecycle on both deployments and stitch each run's
# three steps into one reviewable mp4.
#
#   ./record-lifecycle.sh            # both deployments
#   ./record-lifecycle.sh baseline   # just one
#
# Output: out/video/{baseline,kc}-lifecycle.mp4 plus the individual step clips.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/out/video"
mkdir -p "$OUT"

BASELINE_URL="${BASELINE_URL:?set BASELINE_URL to the native-auth deployment}"
KC_URL="${KC_URL:?set KC_URL to the Keycloak-fronted deployment}"

record() {
  local name="$1" url="$2"
  local raw="$TESTS/test-results-video-$name"
  rm -rf "$raw"
  echo "=== recording $name ($url)"
  (
    cd "$TESTS" || exit 1
    BASE_URL="$url" EMP_USER="${EMP_USER:-ADMIN}" EMP_PASS="${EMP_PASS:-eGov@123}" \
    VIDEO_OUT="$raw" \
      npx playwright test e2e/kc-parity/pgr-ui-lifecycle.spec.ts \
        --config=playwright.video.config.ts --project=chromium --workers=1 --reporter=list
  )
  local rc=$?
  echo "=== $name playwright exit=$rc"

  # Tests run serially, so modification time is execution order — more reliable
  # than the hashed directory names Playwright generates.
  mapfile -t clips < <(find "$raw" -name '*.webm' -printf '%T@ %p\n' 2>/dev/null | sort -n | cut -d' ' -f2-)
  if [ "${#clips[@]}" -eq 0 ]; then
    echo "=== $name: no video captured"
    return 1
  fi
  echo "=== $name: ${#clips[@]} clip(s)"

  local list="$OUT/$name-list.txt"
  : > "$list"
  local i=1
  for c in "${clips[@]}"; do
    cp "$c" "$OUT/$name-step$i.webm"
    printf "file '%s'\n" "$OUT/$name-step$i.webm" >> "$list"
    i=$((i + 1))
  done

  # Re-encode on concat: the clips are VP8 and we want one seekable H.264 file.
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" \
    -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -r 12 \
    -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
    "$OUT/$name-lifecycle.mp4" && echo "=== wrote $OUT/$name-lifecycle.mp4"
  rm -f "$list"
  return $rc
}

case "${1:-both}" in
  baseline) record baseline "$BASELINE_URL" ;;
  kc)       record kc "$KC_URL" ;;
  both)     record baseline "$BASELINE_URL"; record kc "$KC_URL" ;;
  *) echo "usage: $0 [baseline|kc|both]"; exit 2 ;;
esac

echo
ls -lh "$OUT"/*.mp4 2>/dev/null
