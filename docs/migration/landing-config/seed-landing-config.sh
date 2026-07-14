#!/usr/bin/env bash
# seed-landing-config.sh — one-shot, idempotent rollout of the config-driven
# landing data (CCSD-2004: P0 schemas + rows + localization) onto a target
# environment. Frontend deploys carry only CODE; this carries the DATA.
#
# What it does (all via the platform's public APIs, nothing destructive):
#   1. Registers the 2 MDMS v2 schemas (skips if already registered)
#   2. Creates the 10 LandingSection rows + the LandingPageConfig singleton
#      (skips any row that already exists — never overwrites live config)
#   3. Upserts all PGR_LANDING_* localization keys (en_IN + pt_PT),
#      one locale per call (mixed-locale batches are dropped silently)
#   4. Verifies via the v1 read path the runtime actually uses
#
# Source of truth = the DDH seed files in the merged repo (no inline copies).
#
# Usage:
#   ./seed-landing-config.sh <HOST> <STATE_TENANT> [ADMIN_USER] [ADMIN_PASS]
#   e.g. ./seed-landing-config.sh http://127.0.0.1 mz
#        ./seed-landing-config.sh http://<azure-host> mz ADMIN 'eGov@123'
# Env:
#   REPO=/path/to/Citizen-Complaint-Resolution-System   (default: ~/Documents/CCRS/...)
set -uo pipefail

HOST="${1:?usage: seed-landing-config.sh <HOST> <STATE_TENANT> [USER] [PASS]}"
TENANT="${2:?state tenant required (e.g. mz)}"
ADMIN_USER="${3:-ADMIN}"
ADMIN_PASS="${4:-eGov@123}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
RES="$REPO/utilities/default-data-handler/src/main/resources"

SCHEMA_FILE="$RES/schema/rainmaker-pgr-landing.json"
SECTIONS_FILE="$RES/mdmsData/RAINMAKER-PGR/RAINMAKER-PGR.LandingSection.json"
CONFIG_FILE="$RES/mdmsData/RAINMAKER-PGR/RAINMAKER-PGR.LandingPageConfig.json"
LOC_EN="$RES/localisations/en_IN/rainmaker-pgr.json"
LOC_PT="$RES/localisations/pt_PT/rainmaker-pgr.json"

for f in "$SCHEMA_FILE" "$SECTIONS_FILE" "$CONFIG_FILE" "$LOC_EN" "$LOC_PT"; do
  [ -f "$f" ] || { echo "✗ missing seed file: $f (is the landing PR chain merged + repo pulled?)"; exit 1; }
done

echo "── Landing config rollout → $HOST (tenant $TENANT)"

# ── 1. auth ──────────────────────────────────────────────────────────────
TOKEN=$(curl -s -X POST "$HOST/user/oauth/token" \
  -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "username=$ADMIN_USER" --data-urlencode "password=$ADMIN_PASS" \
  --data-urlencode "tenantId=$TENANT" --data-urlencode 'userType=EMPLOYEE' \
  --data-urlencode 'scope=read' --data-urlencode 'grant_type=password' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
[ -n "$TOKEN" ] || { echo "✗ auth failed for $ADMIN_USER@$TENANT on $HOST"; exit 1; }
echo "✓ authenticated (${#TOKEN}-char token)"

export HOST TENANT TOKEN SCHEMA_FILE SECTIONS_FILE CONFIG_FILE LOC_EN LOC_PT

python3 <<'PY'
import json, os, sys, urllib.request

HOST, TENANT, TOKEN = os.environ['HOST'], os.environ['TENANT'], os.environ['TOKEN']
RI = {"apiId": "seed", "ver": "1.0", "authToken": TOKEN}

def post(path, body):
    req = urllib.request.Request(HOST + path, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or "{}")
        except Exception: return e.code, {}

fail = False

# ── 2. schemas (skip-if-exists; schema _update is unsupported, never retry-modify) ──
schemas = json.load(open(os.environ['SCHEMA_FILE']))
st, res = post("/mdms-v2/schema/v1/_search",
    {"RequestInfo": RI, "SchemaDefCriteria": {"tenantId": TENANT,
     "codes": [s["code"] for s in schemas]}})
existing = {s.get("code") for s in (res.get("SchemaDefinitions") or [])}
for s in schemas:
    if s["code"] in existing:
        print(f"  = schema {s['code']} already registered — skip")
        continue
    # ASCII-sanitize the description: older MDMS images have silently dropped
    # schema-create messages carrying non-ASCII (seen on the pilot box).
    safe = {**s, "tenantId": TENANT,
            "description": s.get("description", "").encode("ascii", "ignore").decode()[:500]}
    body = {"RequestInfo": RI, "SchemaDefinition": safe}
    st, res = post("/mdms-v2/schema/v1/_create", body)
    ok = st == 200 or st == 202
    print(f"  {'✓' if ok else '✗'} schema {s['code']} create → HTTP {st}"
          + ("" if ok else f" {json.dumps(res)[:200]}"))
    fail |= not ok

# ── 3. data rows (skip-if-exists — never overwrites live config) ─────────
def seed_rows(schema_code, path):
    rows = json.load(open(path))
    global fail
    for row in rows:
        uid = row["code"]
        st, res = post("/mdms-v2/v2/_search",
            {"RequestInfo": RI, "MdmsCriteria": {"tenantId": TENANT,
             "schemaCode": schema_code, "uniqueIdentifiers": [uid]}})
        if any(m.get("isActive") for m in (res.get("mdms") or [])):
            print(f"  = {schema_code.split('.')[1]}/{uid} exists — skip")
            continue
        st, res = post(f"/mdms-v2/v2/_create/{schema_code}",
            {"RequestInfo": RI, "Mdms": {"tenantId": TENANT, "schemaCode": schema_code,
             "uniqueIdentifier": uid, "data": row, "isActive": True}})
        ok = st in (200, 202) and (res.get("mdms") or res.get("Mdms"))
        print(f"  {'✓' if ok else '✗'} {schema_code.split('.')[1]}/{uid} create → HTTP {st}"
              + ("" if ok else f" {json.dumps(res)[:200]}"))
        fail |= not ok

seed_rows("RAINMAKER-PGR.LandingSection", os.environ['SECTIONS_FILE'])
seed_rows("RAINMAKER-PGR.LandingPageConfig", os.environ['CONFIG_FILE'])

# ── 4. localization (PGR_LANDING_* only; ONE locale per call) ────────────
for path, locale in ((os.environ['LOC_EN'], "en_IN"), (os.environ['LOC_PT'], "pt_PT")):
    msgs = [{"code": m["code"], "message": m["message"], "module": "rainmaker-pgr",
             "locale": locale}
            for m in json.load(open(path)) if m["code"].startswith("PGR_LANDING_")]
    st, res = post(f"/localization/messages/v1/_upsert?tenantId={TENANT}",
        {"RequestInfo": RI, "tenantId": TENANT, "messages": msgs})
    ok = st == 200
    print(f"  {'✓' if ok else '✗'} localization {locale}: upsert {len(msgs)} keys → HTTP {st}")
    fail |= not ok

# ── 5. verify via the v1 read path the page actually uses ────────────────
st, res = post("/egov-mdms-service/v1/_search",
    {"RequestInfo": {"apiId": "seed"}, "MdmsCriteria": {"tenantId": TENANT,
     "moduleDetails": [{"moduleName": "RAINMAKER-PGR",
       "masterDetails": [{"name": "LandingSection"}, {"name": "LandingPageConfig"}]}]}})
pgr = (res.get("MdmsRes") or {}).get("RAINMAKER-PGR") or {}
sections = pgr.get("LandingSection") or []
config = pgr.get("LandingPageConfig") or []
print(f"\n── verify: {len(sections)} sections readable, config singleton: "
      f"{'yes' if config else 'MISSING'}")
if len(sections) < 10 or not config:
    fail = True
sys.exit(1 if fail else 0)
PY
rc=$?
if [ $rc -eq 0 ]; then
  echo "── DONE. Open $HOST/digit-ui/landing (page) and $HOST/configurator/manage/landing-builder (Builder)."
else
  echo "── FINISHED WITH ERRORS — review the ✗ lines above (safe to re-run; the script skips whatever succeeded)."
fi
exit $rc
