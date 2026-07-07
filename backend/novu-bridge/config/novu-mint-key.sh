#!/usr/bin/env bash
# Programmatically mint (or fetch) a self-hosted Novu **Development**-environment
# API key — exactly what the /novu/ dashboard signup does, but over REST. No human.
#
# On a FRESH Novu (empty Mongo) `POST /v1/auth/register` creates the first user +
# organization + Development/Production environments and returns a JWT. We then
# read the Development environment's API key. On a re-run the user already exists,
# so we `POST /v1/auth/login` instead. Idempotent — safe to run every deploy.
#
# Verified against Novu self-hosted api:2.3.0:
#   register 201 -> {data:{user, token}} ; GET /v1/environments (Bearer) ->
#   [{name:"Development", apiKeys:[{key}]}, {name:"Production", ...}]
#
# Env:
#   NOVU_API_URL        default http://localhost:14002   (the novu-api port, NOT /novu/ dashboard 14000)
#   NOVU_ADMIN_EMAIL    default admin@digit.local
#   NOVU_ADMIN_PASSWORD default Digit@12345  (Novu policy: >=8, upper/lower/number/special)
#   NOVU_ADMIN_FIRST / NOVU_ADMIN_LAST / NOVU_ORG_NAME
#   NOVU_ENV_NAME       default Development  (which env's key to return)
#
# Prints ONLY the API key on stdout (so it can be captured); diagnostics go to stderr.
set -euo pipefail

API="${NOVU_API_URL:-http://localhost:14002}"
EMAIL="${NOVU_ADMIN_EMAIL:-admin@digit.local}"
PASS="${NOVU_ADMIN_PASSWORD:-Digit@12345}"
FIRST="${NOVU_ADMIN_FIRST:-Digit}"
LAST="${NOVU_ADMIN_LAST:-Admin}"
ORG="${NOVU_ORG_NAME:-DIGIT}"
ENV_NAME="${NOVU_ENV_NAME:-Development}"

command -v curl >/dev/null || { echo "curl required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }

_jget() { python3 -c 'import sys,json;
d=json.load(sys.stdin)
cur=d
for k in sys.argv[1].split("."):
    if isinstance(cur,list):
        try: cur=cur[int(k)]
        except: cur=None; break
    else: cur=(cur or {}).get(k)
print(cur if cur is not None else "")' "$1" 2>/dev/null; }

echo "novu-mint-key: API=$API email=$EMAIL env=$ENV_NAME" >&2

# 1) register (fresh) → JWT; on 4xx (user exists) fall back to login.
reg=$(curl -s -w '\n%{http_code}' -X POST "$API/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"firstName\":\"$FIRST\",\"lastName\":\"$LAST\",\"organizationName\":\"$ORG\"}")
code=$(tail -n1 <<<"$reg"); body=$(sed '$d' <<<"$reg")

if [[ "$code" == "201" || "$code" == "200" ]]; then
  echo "  registered new Novu org (first user)" >&2
  jwt=$(_jget 'data.token' <<<"$body")
else
  echo "  register -> $code (user likely exists); logging in" >&2
  login=$(curl -s -X POST "$API/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
  jwt=$(_jget 'data.token' <<<"$login")
fi

if [[ -z "$jwt" ]]; then
  echo "ERROR: could not obtain JWT (register code=$code). Body head: ${body:0:200}" >&2
  exit 1
fi

# 2) read the requested environment's API key (JWT in Bearer; envs carry apiKeys inline).
key=$(curl -s "$API/v1/environments" -H "Authorization: Bearer $jwt" | python3 -c '
import sys, json
want = sys.argv[1].lower()
d = json.load(sys.stdin); data = d.get("data", d)
for e in data:
    if str(e.get("name","")).lower() == want:
        ks = e.get("apiKeys") or []
        if ks: print(ks[0].get("key","")); break
' "$ENV_NAME" 2>/dev/null)

if [[ -z "$key" ]]; then
  echo "ERROR: obtained JWT but could not read a '$ENV_NAME' API key" >&2
  exit 1
fi

echo "  minted/fetched $ENV_NAME key: ${key:0:6}…" >&2
printf '%s\n' "$key"
