# digit-ui-v2 (digit-citizen-ui) — Vite/React citizen SPA, served by nginx under
# /citizen/. Mirrors the playbook "digit-ui-v2 — build (vite) with env contract"
# task: Vite bakes VITE_* at build time, so they are build-args here (one image
# per env contract). Defaults match the playbook: the relative values
# (/auth, /token-exchange) are tenant-NEUTRAL — nginx proxies them per tenant —
# while the realm/tenant args are genuinely tenant-specific and default empty.
#
# A nightly built with the defaults is a tenant-neutral reference image; a deploy
# that needs baked Keycloak SSO passes the realm/tenant build-args (or awaits the
# runtime-config follow-up that lets one image serve every tenant). See
# build/NIGHTLY-BUILDS.md. amd64 deploy target.
ARG NODE_IMAGE=node:20-bookworm-slim
ARG BASE_PATH=/citizen/

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci || npm install
COPY . .
# Build file: sub-packages first (their `main` points at dist/, not built by npm ci).
RUN for sp in packages/*/; do \
      [ -f "${sp}package.json" ] || continue; \
      hasbuild="$(node -p "(require('./${sp}package.json').scripts||{}).build||''")"; \
      [ -n "$hasbuild" ] && (echo "build sub-package $sp" && cd "$sp" && npm run build); \
    done; true

# --- tenant env contract (Vite bakes these into the bundle) --------------------
ARG VITE_AUTH_PROVIDER=""
ARG VITE_KEYCLOAK_URL=/auth
ARG VITE_KEYCLOAK_REALM=""
ARG VITE_KEYCLOAK_CLIENT_ID=digit-ui
ARG VITE_TOKEN_EXCHANGE_URL=/token-exchange
ARG VITE_CITIZEN_STATE_TENANT=""
ARG VITE_CITIZEN_TENANT=""
ENV VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER} \
    VITE_KEYCLOAK_URL=${VITE_KEYCLOAK_URL} \
    VITE_KEYCLOAK_REALM=${VITE_KEYCLOAK_REALM} \
    VITE_KEYCLOAK_CLIENT_ID=${VITE_KEYCLOAK_CLIENT_ID} \
    VITE_TOKEN_EXCHANGE_URL=${VITE_TOKEN_EXCHANGE_URL} \
    VITE_CITIZEN_STATE_TENANT=${VITE_CITIZEN_STATE_TENANT} \
    VITE_CITIZEN_TENANT=${VITE_CITIZEN_TENANT}
# v2's proven recipe is the package.json build (tsc -b && vite build); base
# (/citizen/) comes from vite.config.ts. Strict (no vite-only fallback): a type
# error should fail the nightly loudly, not ship an unchecked citizen bundle.
RUN npm run build \
 && test -f dist/index.html

# --- serve ---------------------------------------------------------------------
FROM nginx:1.27-alpine
ARG BASE_PATH
COPY --from=build /app/dist /usr/share/nginx/html${BASE_PATH}
# `root` (not `alias`) + try_files: avoids the alias+try_files path-doubling
# footgun and serves deep-link refreshes under the base path correctly.
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  location = / { return 302 %s; }\n\
  location %s {\n\
    try_files $uri $uri/ %sindex.html;\n\
  }\n\
}\n' "${BASE_PATH}" "${BASE_PATH}" "${BASE_PATH}" > /etc/nginx/conf.d/default.conf
EXPOSE 80
