# Build stage
# bookworm-slim (glibc) so better-sqlite3 installs its prebuilt binary — no
# node-gyp/python/g++ toolchain needed, unlike alpine/musl.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Committed Trie hierarchies mounted at /data (see search.service.ts).
ENV DATA_DIR=/data
# Offline Overture SQLite DB mounted here (see boundary.service.ts); absent
# mounts just disable the overture source, they don't break startup.
ENV OVERTURE_DB_PATH=/overture-data/boundaries.sqlite
EXPOSE 3000
CMD ["node", "dist/main"]
