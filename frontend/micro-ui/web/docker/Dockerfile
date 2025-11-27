# ---------- BUILD STAGE ----------
FROM node:14-bullseye AS build

# Install required OS dependencies
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

ARG WORK_DIR
WORKDIR /app

ENV NODE_OPTIONS="--max-old-space-size=8168"
ENV PYTHON=/usr/bin/python3

COPY ${WORK_DIR} .

RUN ls -lah

RUN cd web/ \
    && chmod +x install-deps.sh \
    && ./install-deps.sh \
    && yarn install \
    && yarn build:webpack


# ---------- RUNTIME STAGE ----------
FROM nginx:mainline-alpine

ENV WORK_DIR=/var/web/digit-ui
RUN mkdir -p ${WORK_DIR}

COPY --from=build /app/web/build ${WORK_DIR}/
COPY --from=build /app/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
