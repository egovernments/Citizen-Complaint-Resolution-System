# digit-configurator — static SPA built with Vite, served by nginx under
# /configurator/. Mirrors local-setup/ansible/files/configurator-build.sh so the
# nightly image matches the proven on-box build:
#   - build the file: sub-packages first (their package.json `main` points at
#     dist/, which `npm ci` does NOT build), then
#   - `vite build` DIRECTLY (not the package.json `tsc -b && vite build`): the
#     root tsc -b has blocking app-level type errors upstream, but vite/esbuild
#     emits a working SPA without type-checking.
# Tenant-neutral: configurator reads no VITE_* build-env (only import.meta.env.MODE),
# so a single image serves every tenant. Configuration is runtime (login + tenant
# pick), not baked. amd64 deploy target.
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
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  location = / { return 302 %s; }\n\
  location %s {\n\
    try_files $uri $uri/ %sindex.html;\n\
  }\n\
}\n' "${BASE_PATH}" "${BASE_PATH}" "${BASE_PATH}" > /etc/nginx/conf.d/default.conf
EXPOSE 80
