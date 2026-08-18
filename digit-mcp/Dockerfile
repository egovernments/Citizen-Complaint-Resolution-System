FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/data-provider/package.json packages/data-provider/package.json
RUN npm ci
COPY tsconfig.json ./
COPY packages/data-provider/tsconfig.json packages/data-provider/tsconfig.json
COPY packages/data-provider/src/ packages/data-provider/src/
COPY src/ src/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY packages/data-provider/package.json packages/data-provider/package.json
RUN npm ci --omit=dev
COPY --from=builder /app/dist dist/
COPY --from=builder /app/packages/data-provider/dist packages/data-provider/dist/
# The session viewer is served from disk at runtime (serveStatic resolves
# ../ui relative to dist/). Without this the image 404s on `/` and every
# /api/* consumer of it — including the sign-in gate — is unreachable.
COPY ui/ ui/
# Writable paths, owned by the unprivileged runtime user. The logger mkdir's its
# own directory at import time, so it has to exist and be writable before we drop
# privileges. `artifacts` backs MCP_ARTIFACT_DIR (snapshot output confinement).
RUN mkdir -p /app/data/artifacts /var/log/digit-mcp \
 && chown -R node:node /app/data /var/log/digit-mcp

ENV MCP_TRANSPORT=http
ENV SESSION_DATA_DIR=/app/data
ENV MCP_PORT=3000
ENV SESSION_DB_HOST=localhost
ENV SESSION_DB_PORT=15433
ENV SESSION_DB_NAME=mcp_sessions
ENV SESSION_DB_USER=mcp
# SESSION_DB_PASSWORD is deliberately not set here. src/services/db.ts still
# falls back to the local-compose default so `docker compose up` works, but it
# warns on the HTTP transport — supply a real value in any networked deploy.
EXPOSE 3000

# Run unprivileged. Previously this ran as root, which turned any file-write bug
# into a write-anything bug (including over /app/dist).
USER node
CMD ["node", "dist/index.js"]
