FROM node:14-alpine3.16 AS build
RUN apk update
RUN apk add --no-cache git>2.30.0 python3 make g++
ARG WORK_DIR
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=8168"

# ✅ Force node-gyp to use python3
ENV PYTHON=/usr/bin/python3
RUN npm config set python /usr/bin/python3

COPY ${WORK_DIR} .
RUN ls -lah

WORKDIR /app/web

RUN chmod +x ./install-deps.sh
RUN ./install-deps.sh
RUN yarn config set network-timeout 600000
RUN yarn install
RUN yarn build:webpack

FROM nginx:mainline-alpine
ENV WORK_DIR=/var/web/digit-ui
RUN mkdir -p ${WORK_DIR}
COPY --from=build /app/web/build ${WORK_DIR}/
COPY --from=build /app/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
