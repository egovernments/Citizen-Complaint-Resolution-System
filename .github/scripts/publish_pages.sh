#!/usr/bin/env bash
# Publish the current run's report to the gh-pages branch under /security_scan,
# keeping all previous reports so they can be switched/viewed on the dashboard.
# Public URL: https://<org>.github.io/<repo>/security_scan
set -euo pipefail

REPO="${GITHUB_REPOSITORY:?}"
RUN_ID="${GITHUB_RUN_ID:?}"
TOKEN="${GH_TOKEN:?}"
URL="https://x-access-token:${TOKEN}@github.com/${REPO}.git"
SUBDIR="security_scan"

work="$(mktemp -d)"
if git clone --depth 1 --branch gh-pages "$URL" "$work" 2>/dev/null; then
  echo "gh-pages exists"
else
  echo "creating gh-pages"
  git clone --depth 1 "$URL" "$work"
  ( cd "$work" && git checkout --orphan gh-pages && git rm -rf . >/dev/null 2>&1 || true )
fi

mkdir -p "$work/$SUBDIR/data"
# migrate any legacy reports published at the gh-pages root into the subdir
[ -d "$work/data" ] && cp -n "$work/data/"*.json "$work/$SUBDIR/data/" 2>/dev/null || true
# this run
cp run.json "$work/$SUBDIR/data/${RUN_ID}.json"
cp .github/security-dashboard/index.html "$work/$SUBDIR/index.html"
python3 .github/scripts/build_manifest.py "$work/$SUBDIR/data" > "$work/$SUBDIR/manifest.json"

# carry the LLM enrichment cache forward (kept at root, not web-served)
[ -f enrich-cache.json ] && cp enrich-cache.json "$work/enrich-cache.json" || true
touch "$work/.nojekyll"

# root redirect -> /security_scan, and remove any legacy root report artifacts
cat > "$work/index.html" <<'HTML'
<!doctype html><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./security_scan/">
<title>Security Dashboard</title>
<a href="./security_scan/">Go to the security dashboard</a>
HTML
rm -rf "$work/data" "$work/manifest.json"

cd "$work"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then
  echo "no changes to publish"; exit 0
fi
git commit -m "security dashboard: run ${RUN_ID}"
git push origin gh-pages
echo "published run ${RUN_ID} to ${SUBDIR}/"
