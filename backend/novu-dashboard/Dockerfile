# Rebased Novu self-hosted dashboard — serves under a subpath (default /novu).
#
# WHY THIS EXISTS
# The official ghcr.io/novuhq/novu/dashboard image is a Vite SPA built with
# `base=/`. Its docker-entrypoint only injects API/WS hostnames into index.html
# at runtime (VITE_API_HOSTNAME / VITE_WEBSOCKET_HOSTNAME / VITE_LEGACY_DASHBOARD_URL);
# `VITE_BASE_PATH` is a *build-time* Vite var and is a no-op at runtime. So the
# stock image always emits `/assets/`, `/manifest.json`, `/favicon-*` at the
# domain root, which forces a pile of root-level nginx workaround locations and
# collides with anything else hosted at the same root (e.g. Keycloak at /auth).
#
# WHAT THIS DOES
# Bakes the base path into the already-built dist so the served HTML/JS reference
# `${NOVU_BASE_PATH}/assets/...` consistently:
#   1. BASE_URL          — Vite's import.meta.env.BASE_URL (asset + dynamic-chunk base)
#   2. BrowserRouter basename default — React-Router's client-route base
#   3. index.html root refs (css/js/favicon/manifest)
# The dist files stay at the container root, so nginx serves the subpath with a
# single trailing-slash `proxy_pass http://127.0.0.1:14000/;` that strips the
# prefix. See nginx-site.conf.j2 (enable_novu + build_novu_dashboard branch).
#
# KNOWN RESIDUE (handled in nginx, not here)
#  - Novu's auth shim hardcodes ROOT routes /auth/sign-in, /auth/sign-up,
#    /auth/organization-list and ignores the router basename; nginx scopes
#    exactly those three to the dashboard.
#  - A few decorative /images/* logos are fetched at root at runtime; nginx
#    keeps a /images/ passthrough.
#
# The seds are filename-agnostic (grep for the bundle that carries each token)
# and VERIFY their result — a future image bump that re-minifies differently
# fails the build loudly here instead of silently shipping a broken subpath.

ARG NOVU_DASHBOARD_VERSION=2.3.0
FROM ghcr.io/novuhq/novu/dashboard:${NOVU_DASHBOARD_VERSION}

# No leading/trailing slash — e.g. "/novu". BASE_URL gets a trailing slash,
# the router basename does not (React-Router convention).
ARG NOVU_BASE_PATH=/novu

RUN set -eu; \
    cd /app/dist; \
    base="${NOVU_BASE_PATH%/}"; \
    # 1. Vite asset/chunk base (import.meta.env.BASE_URL) — trailing slash.
    files="$(grep -rl 'BASE_URL:"/"' assets || true)"; \
    [ -n "$files" ] || { echo "REBASE FAIL: no BASE_URL:\"/\" token found (image layout changed?)"; exit 1; }; \
    for f in $files; do sed -i "s#BASE_URL:\"/\"#BASE_URL:\"${base}/\"#g" "$f"; done; \
    # 2. React-Router <BrowserRouter> default basename — no trailing slash.
    bn="$(grep -rl 'basename:t="/"' assets || true)"; \
    [ -n "$bn" ] || { echo "REBASE FAIL: no basename:t=\"/\" token found (image layout changed?)"; exit 1; }; \
    for f in $bn; do sed -i "s#basename:t=\"/\"#basename:t=\"${base}\"#g" "$f"; done; \
    # 3. index.html absolute root refs (css/js/favicon/manifest).
    sed -i "s#\(src\|href\)=\"/#\1=\"${base}/#g" index.html; \
    # Verify all three landed.
    grep -rq "BASE_URL:\"${base}/\"" assets || { echo "REBASE VERIFY FAIL: BASE_URL"; exit 1; }; \
    grep -rq "basename:t=\"${base}\"" assets || { echo "REBASE VERIFY FAIL: basename"; exit 1; }; \
    grep -q "src=\"${base}/assets/" index.html || { echo "REBASE VERIFY FAIL: index.html"; exit 1; }; \
    echo "novu-dashboard rebased to base ${base}/ OK"
