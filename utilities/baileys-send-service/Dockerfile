FROM node:20-slim

WORKDIR /app

# Install production deps first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production \
    PORT=3000 \
    AUTH_DIR=/data/baileys-auth

# Persisted WhatsApp auth/session state. Mount a named volume here so a
# pairing survives container recreation.
VOLUME ["/data"]

EXPOSE 3000

# node:20-slim (Debian slim) ships NEITHER wget NOR curl, so the healthcheck
# uses node itself: exit 0 only on HTTP 200 from /healthz (i.e. paired+open).
HEALTHCHECK --interval=15s --timeout=3s --retries=5 --start-period=20s \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:3000/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "src/server.js"]
