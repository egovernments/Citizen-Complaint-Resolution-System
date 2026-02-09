#!/bin/bash

BASEDIR="$(cd "$(dirname "$0")" && pwd)"

msg() {
  echo -e "\n\n\033[32;32m$1\033[0m"
}

msg "Building and publishing css"
cd "$BASEDIR/packages/css" && rm -rf dist && yarn && npm publish --tag campaign-1.0-develop

msg "Building and publishing cms module"
cd "$BASEDIR/packages/modules/pgr" && rm -rf dist && yarn && npm publish --tag cms-1.0-develop
