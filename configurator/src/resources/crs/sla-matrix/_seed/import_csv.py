#!/usr/bin/env python3
"""
Seed CRS.CategorySLA on a target tenant from a CSV.

Usage:
    python3 import_csv.py \
        --base-url https://your-tenant.example.org \
        --tenant <tenantId> \
        --username ADMIN \
        --password '<password>' \
        [--csv /path/to/your.csv]

If --csv is omitted, the script falls back to `example.csv` shipped next
to this file — a tiny 3-row placeholder used to demonstrate the expected
CSV shape. Operators are expected to point --csv at their own file.

The script is intentionally idempotent: re-running it against an already-
seeded tenant produces phantom-200 responses from MDMS (empty `mdms`
array on duplicate) and the script reports them as "already present".

CRS.StateSLA (the per-state default singleton) is NOT seeded by this
script — operators populate it via the configurator UI at
/manage/crs-sla-matrix once they decide on their per-state default
hours. Until that record exists, the page falls back to in-memory
defaults at render time.

CSV columns (header row required):
    path, category, subcategoryL1, subcategoryL2,
    sla_new, sla_triage, sla_forwarded, sla_investigation,
    sla_awaiting, sla_resolved

`subcategoryL2` is informational only — the SLA table keys off
(path, category, subcategoryL1). Empty SLA cells are stored as null
and fall back to CRS.StateSLA at scheduler time.
"""
import argparse
import csv
import os
import sys
import urllib.parse
from pathlib import Path
from typing import Optional

import requests

DEFAULT_CSV = Path(__file__).parent / "example.csv"


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


def seed_category_sla(base_url: str, token: str, tenant: str, csv_path: Path) -> tuple[int, int]:
    ok_count = 0
    skip_count = 0
    with csv_path.open() as fh:
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
    ap.add_argument("--base-url", required=True, help="DIGIT base URL, e.g. https://your-tenant.example.org")
    ap.add_argument("--tenant", default=os.environ.get("CRS_TENANT", "ke"))
    ap.add_argument("--username", default=os.environ.get("CRS_USERNAME", "ADMIN"))
    ap.add_argument("--password", default=os.environ.get("CRS_PASSWORD", "eGov@123"))
    ap.add_argument("--csv", default=str(DEFAULT_CSV),
                    help=f"Path to CSV file (default: {DEFAULT_CSV.name} next to this script)")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"[seed] ERROR: csv not found: {csv_path}")
        return 1

    print(f"[seed] tenant={args.tenant} base={args.base_url} csv={csv_path.name}")
    token = login(args.base_url, args.tenant, args.username, args.password)
    print("[seed] logged in")

    print(f"[seed] CategorySLA from {csv_path.name}")
    ok, skip = seed_category_sla(args.base_url, token, args.tenant, csv_path)
    print(f"[seed] done: {ok} created, {skip} skipped (already present)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
