#!/usr/bin/env python3

# NOTE: if /mdms-v2/v2/_create/CRS.* returns HTTP 400 with ClassCastException
# (JSONObject cannot be cast to JSONArray), the registered schema's
# x-ref-schema field landed as {} instead of []. Run fix-xref-schema.sql
# against the MDMS postgres to repair in place.

"""
Register CRS.CategorySLA + CRS.StateSLA + CRS.SLAAuditLog schemas on a
target tenant via mdms-v2/schema/v1/_create.

Reads the schema JSON straight from the canonical source at
`utilities/default-data-handler/src/main/resources/schema/CRS.json` so
the registered definitions can never drift from the committed file.

Usage:
    python3 register_schemas.py \
        --base-url https://bometfeedbackhub.digit.org \
        --tenant ke \
        --username ADMIN --password 'eGov@123'
"""
import argparse
import json
import os
import sys
from pathlib import Path

import requests

SCHEMA_FILE = Path(__file__).resolve().parents[6] / "utilities/default-data-handler/src/main/resources/schema/CRS.json"


def login(base_url: str, tenant: str, username: str, password: str) -> str:
    r = requests.post(
        f"{base_url}/user/oauth/token",
        data={
            "username": username,
            "password": password,
            "userType": "EMPLOYEE",
            "tenantId": tenant,
            "scope": "read",
            "grant_type": "password",
        },
        auth=requests.auth.HTTPBasicAuth("egov-user-client", ""),
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def request_info(token: str) -> dict:
    return {
        "apiId": "Rainmaker", "ver": ".01", "ts": None, "action": "", "did": "1",
        "key": "", "msgId": "20170310130900|en_IN", "authToken": token,
    }


def register_one(base_url: str, token: str, tenant: str, schema: dict) -> None:
    payload = {
        "RequestInfo": request_info(token),
        "SchemaDefinition": {
            "tenantId": tenant,
            "code": schema["code"],
            "description": schema.get("description", ""),
            "definition": schema["definition"],
            "isActive": schema.get("isActive", True),
        },
    }
    r = requests.post(
        f"{base_url}/mdms-v2/schema/v1/_create",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    tag = "ok"
    if r.status_code != 200:
        tag = f"HTTP {r.status_code}: {r.text[:200]}"
    print(f"  {schema['code']}: {tag}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--tenant", default=os.environ.get("CRS_TENANT", "ke"))
    ap.add_argument("--username", default=os.environ.get("CRS_USERNAME", "ADMIN"))
    ap.add_argument("--password", default=os.environ.get("CRS_PASSWORD", "eGov@123"))
    args = ap.parse_args()

    schemas = json.loads(SCHEMA_FILE.read_text())
    # Replace {tenantid} placeholder with the actual tenant.
    for s in schemas:
        if isinstance(s.get("tenantId"), str):
            s["tenantId"] = s["tenantId"].replace("{tenantid}", args.tenant)

    print(f"[register] tenant={args.tenant} base={args.base_url}")
    token = login(args.base_url, args.tenant, args.username, args.password)
    print(f"[register] {len(schemas)} schemas")
    for s in schemas:
        register_one(args.base_url, token, args.tenant, s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
