#!/bin/bash
# Deprecated — kept as a shim so existing muscle memory still works.
# All deploys now go through ./deploy.sh.
#
# Migrate any callers (CI, runbooks, READMEs) to:
#   ./deploy.sh bomet
echo "WARNING: deploy-bomet.sh is deprecated; use ./deploy.sh bomet" >&2
exec "$(dirname "$0")/deploy.sh" bomet "$@"
