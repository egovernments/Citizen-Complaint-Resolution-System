# digit-configurator — static SPA built with Vite, served by nginx under
# /configurator/. Mirrors local-setup/ansible/files/configurator-build.sh so the
# nightly image matches the proven on-box build:
#   - build the file: sub-packages first (their package.json `main` points at
#     dist/, which `npm ci` does NOT build), then
#   - `vite build` DIRECTLY (not the package.json `tsc -b && vite build`): the
#     root tsc -b has blocking app-level type errors upstream, but vite/esbuild
#     emits a working SPA without type-checking.
# Tenant-neutral — but by construction, not by accident. The app DOES read four
# deployment values (state tenant, Overpass/Turbopass endpoints, boundary search
# limit); they are resolved at RUNTIME from `<base>/config.js`
# (window.__CONFIGURATOR_CONFIG__), which the deploy renders per-tenant and drops
# next to the bundle — the same pattern as digit-ui's globalConfigs.js. A neutral
# public/config.js ships in the image so an unconfigured run falls through to the
# in-code defaults. Do NOT reintroduce VITE_* build args: baking them here is what
# made a pre-built image silently deployment-specific (empty tenant on the login
# form, public rate-limited Overpass). See configurator/src/api/runtimeConfig.ts.
# amd64 deploy target.
ARG NODE_IMAGE=node:20-bookworm-slim
ARG BASE_PATH=/configurator/

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
# Install (fallback to install if the lockfile drifted, matching the on-box script).
RUN npm ci || npm install
COPY . .
# Build any file: sub-package that has a build script (vite needs their dist/).
RUN for sp in packages/*/; do \
      [ -f "${sp}package.json" ] || continue; \
      hasbuild="$(node -p "(require('./${sp}package.json').scripts||{}).build||''")"; \
      [ -n "$hasbuild" ] && (echo "build sub-package $sp" && cd "$sp" && npm run build); \
    done; true
ARG BASE_PATH
RUN npx vite build --base="${BASE_PATH}" \
 && test -f dist/index.html

# --- serve ---------------------------------------------------------------------
FROM nginx:1.27-alpine
ARG BASE_PATH
# Static bundle lives under the base path so absolute asset URLs (/configurator/…)
# resolve both when run standalone and when extracted into a host-nginx tree.
COPY --from=build /app/dist /usr/share/nginx/html${BASE_PATH}
# `root` (not `alias`) + try_files: with the bundle physically under the base
# path, $uri maps straight to disk and the SPA fallback is the base index.html —
# avoids the well-known alias+try_files path-doubling footgun and serves
# deep-link refreshes correctly.
# config.js MUST NOT be cached. It is the runtime deployment config, so it has a
# STABLE name and MUTABLE content — the opposite of the hashed assets/ bundle,
# which is content-addressed and safe to cache forever. Without an explicit
# Cache-Control, nginx sends only ETag/Last-Modified and browsers apply
# heuristic freshness: an operator changes a tenant value, redeploys, and users
# keep serving the old config until a hard refresh. That is precisely the silent
# staleness this runtime-config mechanism exists to remove.
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  location = / { return 302 %s; }\n\
  location = %sconfig.js {\n\
    add_header Cache-Control "no-store, must-revalidate" always;\n\
    try_files $uri =404;\n\
  }\n\
  location %s {\n\
    try_files $uri $uri/ %sindex.html;\n\
  }\n\
}\n' "${BASE_PATH}" "${BASE_PATH}" "${BASE_PATH}" "${BASE_PATH}" > /etc/nginx/conf.d/default.conf
EXPOSE 80
