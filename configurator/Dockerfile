# Build from the repository root (`docker build -f configurator/Dockerfile .`)
# so both SPAs consume the same ui-shared feature-flag parser.
# digit-configurator — static SPA built with Vite, served by nginx under
# /configurator/. Mirrors local-setup/ansible/files/configurator-build.sh so the
# nightly image matches the proven on-box build:
#   - build the file: sub-packages first (their package.json `main` points at
#     dist/, which `npm ci` does NOT build), then
#   - `vite build` DIRECTLY (not the package.json `tsc -b && vite build`): the
#     root tsc -b has blocking app-level type errors upstream, but vite/esbuild
#     emits a working SPA without type-checking.
# Tenant-neutral by default. The only optional product switch below retains the
# old PGR dashboard as a rollback aid; nightly/reference images leave it off.
ARG NODE_IMAGE=node:20-bookworm-slim
ARG BASE_PATH=/configurator/

FROM ${NODE_IMAGE} AS build
WORKDIR /app/configurator
COPY configurator/package.json configurator/package-lock.json ./
COPY configurator/packages ./packages
# Install (fallback to install if the lockfile drifted, matching the on-box script).
RUN npm ci || npm install
# `npm ci` above can silently OMIT a platform's rollup native optional dependency
# (e.g. @rollup/rollup-linux-arm64-gnu) when package-lock.json was only ever
# regenerated on x64 hosts — npm/cli#4828. That's not a lockfile-mismatch error, so
# `npm ci` still exits 0 and the fallback above never triggers; the missing binary
# then only surfaces later as a `vite build` crash. A plain follow-up `npm install`
# does NOT fix this either — with the lock already present it reports "up to
# date" and never re-resolves the missing optional package. Detect it directly
# (requiring `rollup` is what actually throws) and, only when broken, drop the
# lock and node_modules for a clean re-resolve against the registry for THIS
# platform — verified this is the only combination that actually installs the
# right native binary on arm64.
RUN node -e "require('rollup')" || (rm -rf node_modules package-lock.json && npm install)
COPY ui-shared /app/ui-shared
COPY configurator .
# Build any file: sub-package that has a build script (vite needs their dist/).
RUN for sp in packages/*/; do \
      [ -f "${sp}package.json" ] || continue; \
      hasbuild="$(node -p "(require('./${sp}package.json').scripts||{}).build||''")"; \
      [ -n "$hasbuild" ] && (echo "build sub-package $sp" && cd "$sp" && npm run build); \
    done; true
ARG BASE_PATH
ARG VITE_ENABLE_LEGACY_PGR_DASHBOARD=false
ENV VITE_ENABLE_LEGACY_PGR_DASHBOARD=${VITE_ENABLE_LEGACY_PGR_DASHBOARD}
RUN npx vite build --base="${BASE_PATH}" \
 && test -f dist/index.html

# --- serve ---------------------------------------------------------------------
FROM nginx:1.27-alpine
ARG BASE_PATH
# Static bundle lives under the base path so absolute asset URLs (/configurator/…)
# resolve both when run standalone and when extracted into a host-nginx tree.
COPY --from=build /app/configurator/dist /usr/share/nginx/html${BASE_PATH}
# `root` (not `alias`) + try_files: with the bundle physically under the base
# path, $uri maps straight to disk and the SPA fallback is the base index.html —
# avoids the well-known alias+try_files path-doubling footgun and serves
# deep-link refreshes correctly.
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  location = / { return 302 %s; }\n\
  location %s {\n\
    try_files $uri $uri/ %sindex.html;\n\
  }\n\
}\n' "${BASE_PATH}" "${BASE_PATH}" "${BASE_PATH}" > /etc/nginx/conf.d/default.conf
EXPOSE 80
