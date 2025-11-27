FROM node:14-alpine3.16 AS build
RUN apk update

# install git, python3 and build tools (build-base provides gcc, g++ and make)
RUN apk add --no-cache git python3 build-base

# Ensure python points to python3 and force node-gyp to use it
RUN ln -sf /usr/bin/python3 /usr/bin/python
ENV PYTHON=/usr/bin/python3
RUN npm config set python /usr/bin/python3

ARG WORK_DIR
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=8168"

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