# FROM egovio/alpine-node-builder-14:yarn AS build
FROM node:14-alpine AS build
RUN apk update && apk upgrade
RUN apk add --no-cache git>2.30.0 python3 make g++
ARG WORK_DIR
WORKDIR /app
ENV NODE_OPTIONS "--max-old-space-size=8168"
ENV PYTHON=/usr/bin/python3

COPY ${WORK_DIR} .
RUN ls -lah

RUN cd web/ \
    && chmod +x install-deps.sh \
    && yarn install \
    && yarn build:webpack 

FROM nginx:mainline-alpine
#FROM ghcr.io/egovernments/nginx:mainline-alpine
ENV WORK_DIR=/var/web/digit-ui

RUN mkdir -p ${WORK_DIR}

COPY --from=build /app/web/build ${WORK_DIR}/
COPY --from=build /app/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
