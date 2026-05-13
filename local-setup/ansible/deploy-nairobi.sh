#!/bin/bash
# Deprecated — kept as a shim so existing muscle memory still works.
# All deploys now go through ./deploy.sh.
#
# Migrate any callers (CI, runbooks, READMEs) to:
#   ./deploy.sh nairobi
echo "WARNING: deploy-nairobi.sh is deprecated; use ./deploy.sh nairobi" >&2
exec "$(dirname "$0")/deploy.sh" nairobi "$@"
