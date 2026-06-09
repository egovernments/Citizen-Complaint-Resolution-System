#!/usr/bin/env python3
"""
Seed CRS.CategorySLA + CRS.StateSLA on a target tenant from BRD Appendix A.

Usage:
    python3 import_appendix_a.py \
        --base-url https://bometfeedbackhub.digit.org \
        --tenant ke \
        --username ADMIN \
        --password 'eGov@123'

The script is intentionally idempotent: re-running it against an already-
seeded tenant produces phantom-200 responses from MDMS (empty `mdms`
array on duplicate) and the script reports them as "already present".

Two things land per run:
    1. CRS.StateSLA singleton (uniqueIdentifier = "default") with BRD §5.2
       defaults — new=0, triage=24, forwarded=48, investigation=120,
       awaiting=120, resolved=360.
    2. One CRS.CategorySLA row per non-empty Appendix A line, with the
       `investigation` cell populated from the spreadsheet's hour value
       (the BRD's per-state grid is the singleton above, not the
       category-level matrix).
"""
import argparse
import csv
import os
import sys
import urllib.parse
from pathlib import Path
from typing import Optional

import requests

# BRD §5.2 — Case Life Cycle table. Used to seed CRS.StateSLA singleton.
STATE_DEFAULTS = {
    "new": 0,
    "triage": 24,
    "forwarded": 48,
    "investigation": 120,
    "awaiting": 120,
    "resolved": 360,
}

SEED_CSV = Path(__file__).parent / "appendix-a.csv"


def login(base_url: str, tenant: str, username: str, password: str) -> str:
    url = f"{base_url}/user/oauth/token"
    body = {
        "username": username,
        "password": password,
        "userType": "EMPLOYEE",
        "tenantId": tenant,
        "scope": "read",
        "grant_type": "password",
    }
    # client id "egov-user-client", empty secret — standard DIGIT OAuth pattern.
    auth = requests.auth.HTTPBasicAuth("egov-user-client", "")
    r = requests.post(url, data=body, auth=auth, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def request_info(token: str) -> dict:
    # Minimal RequestInfo — egov-mdms-service only needs authToken to identify
    # the caller (and we pass the JWT via the Authorization header anyway).
    return {
        "apiId": "Rainmaker",
        "ver": ".01",
        "ts": None,
        "action": "",
        "did": "1",
        "key": "",
        "msgId": "20170310130900|en_IN",
        "authToken": token,
    }


def mdms_create(base_url: str, token: str, tenant: str, schema_code: str, uid: str, data: dict) -> tuple[bool, str]:
    url = f"{base_url}/mdms-v2/v2/_create/{urllib.parse.quote(schema_code, safe='')}"
    payload = {
        "RequestInfo": request_info(token),
        "Mdms": {
            "tenantId": tenant,
            "schemaCode": schema_code,
            "uniqueIdentifier": uid,
            "data": data,
            "isActive": True,
        },
    }
    r = requests.post(url, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code != 200:
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    body = r.json()
    rows = body.get("mdms", [])
    if not rows:
        return False, "phantom-200 (likely duplicate)"
    return True, str(rows[0].get("id"))


def parse_cell(raw: str) -> Optional[object]:
    if not raw:
        return None
    raw = raw.strip()
    if "-" in raw:
        lo, hi = raw.split("-", 1)
        return [int(lo.strip()), int(hi.strip())]
    return int(raw)


def seed_state_sla(base_url: str, token: str, tenant: str) -> None:
    ok, detail = mdms_create(base_url, token, tenant, "CRS.StateSLA", "default", {"stateDefaults": STATE_DEFAULTS})
    print(f"  StateSLA singleton: {'ok' if ok else 'skip'} ({detail})")


def seed_category_sla(base_url: str, token: str, tenant: str) -> tuple[int, int]:
    ok_count = 0
    skip_count = 0
    with SEED_CSV.open() as fh:
        for row in csv.DictReader(fh):
            sla_by_state = {
                "new": parse_cell(row.get("sla_new", "")),
                "triage": parse_cell(row.get("sla_triage", "")),
                "forwarded": parse_cell(row.get("sla_forwarded", "")),
                "investigation": parse_cell(row.get("sla_investigation", "")),
                "awaiting": parse_cell(row.get("sla_awaiting", "")),
                "resolved": parse_cell(row.get("sla_resolved", "")),
            }
            data = {
                "path": row["path"].strip(),
                "category": row["category"].strip(),
                "subcategoryL1": row["subcategoryL1"].strip(),
                "slaHoursByState": sla_by_state,
                "isActive": True,
            }
            uid = f"{data['path']}:{data['category']}:{data['subcategoryL1']}"
            ok, detail = mdms_create(base_url, token, tenant, "CRS.CategorySLA", uid, data)
            if ok:
                ok_count += 1
                print(f"  + {uid}")
            else:
                skip_count += 1
                print(f"  ~ {uid} ({detail})")
    return ok_count, skip_count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True, help="DIGIT base URL, e.g. https://bometfeedbackhub.digit.org")
    ap.add_argument("--tenant", default=os.environ.get("CRS_TENANT", "ke"))
    ap.add_argument("--username", default=os.environ.get("CRS_USERNAME", "ADMIN"))
    ap.add_argument("--password", default=os.environ.get("CRS_PASSWORD", "eGov@123"))
    args = ap.parse_args()

    print(f"[seed] tenant={args.tenant} base={args.base_url}")
    token = login(args.base_url, args.tenant, args.username, args.password)
    print("[seed] logged in")

    print("[seed] CRS.StateSLA")
    seed_state_sla(args.base_url, token, args.tenant)

    print("[seed] CRS.CategorySLA (BRD Appendix A)")
    ok, skip = seed_category_sla(args.base_url, token, args.tenant)
    print(f"[seed] done: {ok} created, {skip} skipped (already present)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
