#!/usr/bin/env bash
# hot-deploy.sh — push a local code change into the already-running
# (ansible-deployed) local-setup stack without a full docker compose /
# playbook re-run.
#
# Usage:
#   ./scripts/hot-deploy.sh backend        Rebuild + hot-swap pgr-services jar
#   ./scripts/hot-deploy.sh frontend       Rebuild + push digit-ui-esbuild bundle
#   ./scripts/hot-deploy.sh configurator   Rebuild + sync configurator SPA
#   ./scripts/hot-deploy.sh all            Run all three, in that order
#
# Env overrides:
#   CONFIGURATOR_WWW_DIR   nginx docroot for configurator (default: /var/www/configurator;
#                           set this to the bind-mounted dir on macOS/OrbStack setups)
#   SKIP_TESTS=1            (default) skip `mvn test` on backend rebuild
#   SKIP_SUBPKGS=1          skip rebuilding configurator/packages/* before `vite build`

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIGURATOR_WWW_DIR="${CONFIGURATOR_WWW_DIR:-/var/www/configurator}"
SKIP_SUBPKGS="${SKIP_SUBPKGS:-0}"

usage() {
    cat <<EOF
Usage: $(basename "$0") <target>

Targets:
  backend         Rebuild backend/pgr-services and hot-swap the jar into digit-pgr-services-1
  frontend        Rebuild digit-ui-esbuild and push the bundle into the digit-ui container
  configurator    Rebuild configurator/ and sync dist/ to $CONFIGURATOR_WWW_DIR
  all             Run backend, frontend, configurator in that order

Examples:
  ./scripts/hot-deploy.sh backend
  ./scripts/hot-deploy.sh all
EOF
    exit 1
}

log() { echo "[hot-deploy] $*"; }

require_container() {
    local name="$1"
    if ! docker ps --filter "name=^${name}\$" --format '{{.Names}}' | grep -q "^${name}\$"; then
        echo "[hot-deploy] ERROR: container '$name' is not running." >&2
        echo "[hot-deploy] Hot-swap only works against an already-deployed stack." >&2
        echo "[hot-deploy] Bring it up first (e.g. 'docker compose up -d' in local-setup/) and retry." >&2
        exit 1
    fi
}

cmd_backend() {
    log "building backend/pgr-services jar..."
    mvn -f "$REPO_ROOT/backend/pgr-services/pom.xml" clean package -DskipTests

    require_container digit-pgr-services-1

    local jar
    jar="$(ls "$REPO_ROOT"/backend/pgr-services/target/pgr-services-*.jar 2>/dev/null | head -1)"
    [ -n "$jar" ] || { echo "[hot-deploy] ERROR: no jar found under backend/pgr-services/target/" >&2; exit 1; }

    log "hot-swapping $(basename "$jar") into digit-pgr-services-1..."
    docker cp "$jar" digit-pgr-services-1:/app/app.jar
    docker restart digit-pgr-services-1 >/dev/null

    log "waiting for health check (Spring Boot restart, up to 60s)..."
    local i=0
    until docker exec digit-pgr-services-1 wget -qO- http://localhost:8080/pgr-services/health >/dev/null 2>&1; do
        i=$((i + 1))
        if [ "$i" -ge 30 ]; then
            echo "[hot-deploy] WARNING: health check still not responding after 60s — check 'docker logs digit-pgr-services-1'" >&2
            return 0
        fi
        sleep 2
    done
    log "backend OK"
}

cmd_frontend() {
    log "building digit-ui-esbuild bundle..."
    (cd "$REPO_ROOT/digit-ui-esbuild" && node esbuild.build.js)

    require_container digit-ui

    log "pushing build/ into digit-ui container..."
    tar -czf - -C "$REPO_ROOT/digit-ui-esbuild/build" . | docker exec -i digit-ui tar -xzf - -C /usr/share/nginx/html

    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:18080/digit-ui/ || true)"
    log "digit-ui responded with HTTP $code"
}

cmd_configurator() {
    if [ "$SKIP_SUBPKGS" != "1" ]; then
        for pkg in data-provider digit-datagrid; do
            local pkg_dir="$REPO_ROOT/configurator/packages/$pkg"
            if [ -d "$pkg_dir" ]; then
                log "building sub-package $pkg (if it has a build script)..."
                (cd "$pkg_dir" && npm run build --if-present)
            fi
        done
    fi

    log "building configurator SPA (vite build, no root typecheck)..."
    (cd "$REPO_ROOT/configurator" && npx vite build --base=/configurator/)

    log "syncing dist/ to $CONFIGURATOR_WWW_DIR..."
    # Try a plain copy first (works when the docroot and everything in it is
    # user-owned); some files in there may be root-owned leftovers from an
    # ansible/root-run build, in which case rm/cp fails partway through even
    # though the top-level directory itself is writable — fall back to sudo,
    # then to a throwaway root container, on failure rather than pre-checking
    # only the top-level directory's permissions.
    if rm -rf "${CONFIGURATOR_WWW_DIR:?}"/* 2>/dev/null && cp -r "$REPO_ROOT/configurator/dist/." "$CONFIGURATOR_WWW_DIR/" 2>/dev/null; then
        :
    elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        log "plain copy failed (likely root-owned leftovers) — retrying with sudo"
        sudo rm -rf "${CONFIGURATOR_WWW_DIR:?}"/*
        sudo cp -r "$REPO_ROOT/configurator/dist/." "$CONFIGURATOR_WWW_DIR/"
        sudo nginx -s reload 2>/dev/null || true
    else
        log "plain copy failed and no passwordless sudo — falling back to a throwaway container to copy as root"
        docker run --rm \
            -v "$REPO_ROOT/configurator/dist:/src:ro" \
            -v "$CONFIGURATOR_WWW_DIR:/dst" \
            alpine sh -c "rm -rf /dst/* && cp -r /src/. /dst/"
    fi

    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' http://localhost/configurator/ || true)"
    log "configurator responded with HTTP $code"
}

cmd_all() {
    cmd_backend
    cmd_frontend
    cmd_configurator
}

case "${1:-}" in
    backend)      cmd_backend ;;
    frontend)     cmd_frontend ;;
    configurator) cmd_configurator ;;
    all)          cmd_all ;;
    *)            usage ;;
esac
