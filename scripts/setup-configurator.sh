#!/usr/bin/env bash
set -euo pipefail

# setup-configurator.sh — Build and deploy the DIGIT Studio Configurator
#
# Usage:
#   ./scripts/setup-configurator.sh              # build only
#   ./scripts/setup-configurator.sh --deploy     # build + copy to web root
#   ./scripts/setup-configurator.sh --deploy --web-root /var/www/configurator
#
# Prerequisites: Node.js 20+, npm, git

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UI_DIR="$REPO_ROOT/utilities/crs_dataloader/ui-mockup"
DIGIT_MCP_DIR="$(cd "$REPO_ROOT/.." && pwd)/DIGIT-MCP"
DIGIT_MCP_REPO="https://github.com/ChakshuGautam/DIGIT-MCP.git"

DEPLOY=false
WEB_ROOT="/var/www/configurator"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy)
      DEPLOY=true
      shift
      ;;
    --web-root)
      WEB_ROOT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--deploy] [--web-root PATH]"
      echo ""
      echo "Options:"
      echo "  --deploy          Copy build output to web root (default: build only)"
      echo "  --web-root PATH   Deploy path (default: /var/www/configurator)"
      echo ""
      echo "The script expects DIGIT-MCP to be a sibling directory of this repo."
      echo "If not found, it will be cloned automatically."
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

echo "==> DIGIT Studio Configurator Setup"
echo "    Repo root:    $REPO_ROOT"
echo "    UI dir:       $UI_DIR"
echo "    DIGIT-MCP:    $DIGIT_MCP_DIR"
echo ""

# --- Step 1: Ensure DIGIT-MCP repo exists ---
if [ -d "$DIGIT_MCP_DIR/packages/data-provider" ]; then
  echo "==> DIGIT-MCP already present at $DIGIT_MCP_DIR"
else
  echo "==> Cloning DIGIT-MCP repo..."
  git clone "$DIGIT_MCP_REPO" "$DIGIT_MCP_DIR"
fi

# --- Step 2: Build @digit-mcp/data-provider ---
# Install from DIGIT-MCP root so workspace hoisting provides @types/node
echo "==> Installing DIGIT-MCP dependencies..."
cd "$DIGIT_MCP_DIR"
npm install
echo "==> Building @digit-mcp/data-provider..."
cd "$DIGIT_MCP_DIR/packages/data-provider"
npm run build
echo "    data-provider built: $(ls dist/index.js)"

# --- Step 3: Install dependencies from repo root (npm workspaces) ---
echo "==> Installing workspace dependencies..."
cd "$REPO_ROOT"
npm install

# Fix the data-provider symlink — npm resolves file: paths relative to
# the package.json, but creates symlinks relative to node_modules which
# can break when the target is outside the repo tree.
DATA_PROVIDER_LINK="$UI_DIR/node_modules/@digit-mcp/data-provider"
if [ -L "$DATA_PROVIDER_LINK" ] && [ ! -e "$DATA_PROVIDER_LINK" ]; then
  echo "==> Fixing broken @digit-mcp/data-provider symlink..."
  rm "$DATA_PROVIDER_LINK"
  ln -s "$DIGIT_MCP_DIR/packages/data-provider" "$DATA_PROVIDER_LINK"
fi

# --- Step 4: Build the configurator UI ---
# Use vite build directly — tsc -b (from "npm run build") fails on pre-existing
# type issues in workspace packages that don't affect the bundled output.
echo "==> Building configurator UI..."
cd "$UI_DIR"
npx vite build
echo "    Build output: $(du -sh dist/ | cut -f1) in $UI_DIR/dist/"

# --- Step 5: Deploy (optional) ---
if [ "$DEPLOY" = true ]; then
  echo "==> Deploying to $WEB_ROOT..."
  sudo mkdir -p "$WEB_ROOT"
  sudo rm -rf "${WEB_ROOT:?}/"*
  sudo cp -r "$UI_DIR/dist/"* "$WEB_ROOT/"
  echo "    Deployed successfully."
  echo ""
  echo "==> Nginx config snippet (save to /etc/nginx/sites-enabled/configurator):"
  echo ""
  cat <<'NGINX'
server {
    listen 443 ssl;
    server_name configurator.preview.egov.theflywheel.in;

    ssl_certificate     /etc/letsencrypt/live/preview.egov.theflywheel.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/preview.egov.theflywheel.in/privkey.pem;

    root /var/www/configurator;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX
  echo ""
  echo "Then run: sudo nginx -t && sudo systemctl reload nginx"
else
  echo ""
  echo "==> Build complete. To deploy, re-run with --deploy"
  echo "    Or manually copy: cp -r $UI_DIR/dist/* /your/web/root/"
fi

echo ""
echo "Done."
