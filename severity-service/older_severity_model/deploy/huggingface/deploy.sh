#!/usr/bin/env bash
# Publish backend/severity-service to a Hugging Face Docker Space.
#
#   HF_TOKEN=hf_xxx ./deploy.sh <hf-user-or-org>/<space-name> [public]
#
# Creates the Space (PRIVATE unless you pass "public") if it does not exist, then pushes the
# service files. The token needs write access and is sent as a header, never stored in the
# remote URL. Re-run to redeploy: Spaces rebuild on every push.
set -euo pipefail

SPACE="${1:?usage: HF_TOKEN=... $0 <user>/<space-name> [public]}"
VIS="${2:-private}"
: "${HF_TOKEN:?set HF_TOKEN to a Hugging Face token with write access}"
command -v git-lfs >/dev/null || git lfs version >/dev/null || { echo "git-lfs is required"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
SVC="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ "$VIS" = "public" ]; then PRIVATE=false; else PRIVATE=true; fi
code=$(curl -s -o /tmp/hf_create.json -w '%{http_code}' -X POST https://huggingface.co/api/repos/create \
  -H "Authorization: Bearer $HF_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"type\":\"space\",\"sdk\":\"docker\",\"name\":\"${SPACE#*/}\",\"organization\":\"${SPACE%/*}\",\"private\":$PRIVATE}")
case "$code" in 200) echo "Created Space $SPACE ($VIS)";; 409) echo "Space $SPACE exists; updating";;
  *) echo "Could not create Space (HTTP $code):"; cat /tmp/hf_create.json; exit 1;; esac

GIT=(git -c "http.extraHeader=Authorization: Bearer $HF_TOKEN")
"${GIT[@]}" clone "https://huggingface.co/spaces/$SPACE" "$WORK/space"
cd "$WORK/space"

# Replace the Space contents with exactly what the service needs.
git rm -rq --ignore-unmatch . >/dev/null 2>&1 || true
mkdir -p app model
cp "$SVC"/app/*.py app/
cp "$SVC"/model/* model/
cp "$SVC/Dockerfile" "$SVC/requirements.txt" .
cp "$HERE/README.md" "$HERE/.gitattributes" .

git lfs install --local >/dev/null
git add -A
if git diff --cached --quiet; then echo "Nothing changed."; exit 0; fi
git -c user.name="${GIT_AUTHOR_NAME:-ccrs-deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-ccrs-deploy@users.noreply.huggingface.co}" \
  commit -q -m "Deploy severity-service from $(git -C "$SVC" rev-parse --short HEAD 2>/dev/null || echo local)"
"${GIT[@]}" push origin HEAD:main
echo
echo "Pushed. Build logs: https://huggingface.co/spaces/$SPACE"
echo "API (once Running): https://${SPACE%/*}-${SPACE#*/}.hf.space/docs  (lowercase, '_' becomes '-')"
echo "Set a Space secret SEVERITY_API_KEY (Settings -> Variables and secrets) to require X-API-Key."
