FROM node:14-bullseye-slim AS build

# Install runtime/build deps: python2 (if node-sass/native modules need it),
# build-essential (gcc/g++/make), git and ca-certificates.
# Note: we intentionally DO NOT npm install -g yarn because the base image
# already provides a yarn binary which caused the EEXIST symlink error.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python2 \
      build-essential \
      git \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Ensure "python" resolves to python2 and force npm/node-gyp to use it
RUN ln -sf /usr/bin/python2 /usr/bin/python
ENV PYTHON=/usr/bin/python
RUN npm config set python /usr/bin/python

ARG WORK_DIR
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=8168"

COPY ${WORK_DIR} .
RUN ls -lah

WORKDIR /app/web

RUN chmod +x ./install-deps.sh
RUN ./install-deps.sh
RUN yarn config set network-timeout 600000

# Install strictly from the committed yarn.lock. --pure-lockfile installs the locked tree and
# never rewrites the lockfile, so an image build can't quietly drift from what's in git.
#
# Why not --frozen-lockfile (which additionally errors if the lockfile is out of date)?
# It cannot pass in this project, and the reason is worth knowing before anyone puts it back:
# react-scripts depends on babel-loader at exactly 8.1.0, while the `resolutions` block below
# force-overrides `**/babel-loader` to 8.2.2. yarn v1 honours the resolution, installs 8.2.2, and
# writes the lockfile entry `babel-loader@8.1.0, babel-loader@8.2.2: version "8.2.2"` — an entry it
# then rejects when it reads the file back ("Lockfile has incorrect entry ... Ignoring it"),
# because 8.2.2 does not satisfy the exact range 8.1.0. yarn generates a lockfile it will not
# accept, so --frozen-lockfile fails 100% of the time regardless of whether anything has drifted.
# Removing the resolution would fix the guard but changes the installed tree, which is a separate
# decision.
#
# NOTE: before yarn.lock was committed, --frozen-lockfile was a silent no-op here (yarn v1 does not
# fail when the lockfile is merely absent), so this is not a loss of a guarantee we ever had.
# For a real drift guard, run `yarn install && git diff --exit-code web/yarn.lock` in CI — a plain
# install against a current lockfile is byte-stable, so any diff means package.json moved without
# the lockfile.
RUN yarn install --pure-lockfile
RUN yarn build:webpack

FROM nginx:mainline-alpine
ENV WORK_DIR=/var/web/digit-ui
RUN mkdir -p ${WORK_DIR}
COPY --from=build /app/web/build ${WORK_DIR}/
COPY --from=build /app/web/docker/nginx.conf /etc/nginx/conf.d/default.conf