#!/usr/bin/env bash
# Does each image ref exist in its registry? Used by the one-tag deploy (#1729)
# to reject a tag before .env is rewritten.
#
#   check-image-tags.sh <image:tag> [<image:tag> ...]
#
# Prints one line per ref and always exits 0 — the playbook decides:
#   ok          <ref>             the registry has it
#   MISSING     <ref>  (detail)   the registry says the tag does not exist
#   UNVERIFIED  <ref>  (detail)   could not tell (rate limit, auth, network)
#
# Docker Hub refs are checked with a manifest HEAD request. Docker Hub does not
# count HEADs against the pull rate limit; `docker manifest inspect` does a GET,
# which does count, so checking a dozen images that way before pulling the same
# dozen doubled what every tagged deploy spent against an anonymous box's
# limit. A HEAD is still refused (429) once the limit is spent, which is why
# that case is UNVERIFIED rather than MISSING: the tag may well exist.
# Other registries fall back to `docker manifest inspect`.
set -uo pipefail

ACCEPT='application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'

hub_repo() {
  local repo=${1%:*}
  [[ $repo == */* ]] || repo="library/$repo"
  printf '%s' "$repo"
}

is_hub() {
  # Docker Hub unless the first path component names a registry host.
  local first=${1%%/*}
  [[ $1 != */* || ( $first != *.* && $first != *:* && $first != localhost ) ]]
}

# ONE anonymous token for every Docker Hub repo being checked: the token
# endpoint takes repeated `scope=` parameters, so a dozen refs cost one token
# round-trip instead of a dozen (Vinoth review on #2166). No token (network
# down) leaves HUB_TOKEN empty; the HEADs then come back 401 → UNVERIFIED.
hub_token() {
  local url="https://auth.docker.io/token?service=registry.docker.io" ref
  for ref in "$@"; do
    is_hub "$ref" && url+="&scope=repository:$(hub_repo "$ref"):pull"
  done
  [[ $url == *scope=* ]] || return 0
  curl -fsS --max-time 20 "$url" 2>/dev/null | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

check_hub() {
  local ref=$1 repo tag=${1##*:} code
  repo=$(hub_repo "$1")
  code=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' -I \
    -H "Authorization: Bearer ${HUB_TOKEN}" -H "Accept: ${ACCEPT}" \
    "https://registry-1.docker.io/v2/${repo}/manifests/${tag}")
  case $code in
    200) echo "ok          $ref" ;;
    404) echo "MISSING     $ref  (Docker Hub: no such tag)" ;;
    429) echo "UNVERIFIED  $ref  (Docker Hub rate limit reached)" ;;
    401) echo "UNVERIFIED  $ref  (Docker Hub 401: repository missing or private)" ;;
    000) echo "UNVERIFIED  $ref  (Docker Hub unreachable)" ;;
    *)   echo "UNVERIFIED  $ref  (Docker Hub HTTP $code)" ;;
  esac
}

check_other() {
  local ref=$1 out
  if out=$(docker manifest inspect "$ref" 2>&1 >/dev/null); then
    echo "ok          $ref"
  elif grep -qiE 'no such manifest|manifest unknown|not found' <<<"$out"; then
    echo "MISSING     $ref  ($(tail -n1 <<<"$out"))"
  else
    echo "UNVERIFIED  $ref  ($(tail -n1 <<<"$out"))"
  fi
}

check() {
  if is_hub "$1"; then
    check_hub "$1"
  else
    check_other "$1"
  fi
}

HUB_TOKEN=$(hub_token "$@")

# In parallel: each check is a registry round-trip of a few seconds.
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
i=0
for ref in "$@"; do
  i=$((i + 1))
  check "$ref" >"$dir/$i" &
done
wait
[[ $i -gt 0 ]] && cat "$dir"/* | sort -k2
exit 0
