#!/usr/bin/env python3
"""
CI Cross-Root Bootstrap Test — verifies that create_tenant auto-bootstraps
a completely new tenant root and that PGR works end-to-end on it.

This is the regression test for issue #225: creating tenants like
"ethiopia.kenya" when logged into "pg".

Flow:
  1. Login as superuser on pg
  2. Create tenant under a NEW root (triggers auto-bootstrap)
  3. Create boundary hierarchy + one locality for PGR
  4. Look up a ServiceDef, create HRMS employee in that department
  5. Load PGR workflow
  6. Output serviceCode for newman

Environment variables:
  DIGIT_URL        - Kong gateway URL (default: http://localhost:18000)
  DIGIT_USERNAME   - Superuser username (default: ADMIN)
  DIGIT_PASSWORD   - Password (default: eGov@123)
  ROOT_TENANT      - Root tenant for login (default: pg)
  BOOT_TENANT      - Cross-root tenant to create (default: ciboot.city1)
"""

import os
import sys
import json
import time
import requests

# Add dataloader directory to path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATALOADER_DIR = os.path.join(SCRIPT_DIR, "..", "jupyter", "dataloader")
sys.path.insert(0, DATALOADER_DIR)

from crs_loader import CRSLoader

# Configuration from env
BASE_URL = os.environ.get("DIGIT_URL", "http://localhost:18000")
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
ROOT_TENANT = os.environ.get("ROOT_TENANT", "pg")
BOOT_TENANT = os.environ.get("BOOT_TENANT", "ciboot.citya")
BOOT_ROOT = BOOT_TENANT.split(".")[0]

# CI test user
CI_USER = "BOOT-ADMIN"
CI_PASSWORD = "eGov@123"
CI_MOBILE = "9999900002"
CI_ROLES = ["SUPERUSER", "EMPLOYEE", "CSR", "GRO", "DGRO", "PGR_LME", "PGR_VIEWER", "CFC"]
# Locality code matching the Postman collection's hardcoded value
LOCALITY_CODE = "JLC477"

REQUEST_TIMEOUT = 30


def create_boundary(loader, tenant):
    """Create a minimal ADMIN boundary hierarchy with one locality for PGR."""
    headers = {"Content-Type": "application/json"}
    auth_info = {
        "apiId": "Rainmaker",
        "authToken": loader.auth_token,
        "userInfo": loader.user_info,
    }

    # Step 1: Create hierarchy definition
    print("   Creating boundary hierarchy...")
    hierarchy_url = f"{loader.base_url}/boundary-service/boundary-hierarchy-definition/_create"
    hierarchy_payload = {
        "RequestInfo": auth_info,
        "BoundaryHierarchy": {
            "tenantId": tenant,
            "hierarchyType": "ADMIN",
            "boundaryHierarchy": [
                {"boundaryType": "Country", "parentBoundaryType": None},
                {"boundaryType": "State", "parentBoundaryType": "Country"},
                {"boundaryType": "District", "parentBoundaryType": "State"},
                {"boundaryType": "City", "parentBoundaryType": "District"},
                {"boundaryType": "Ward", "parentBoundaryType": "City"},
                {"boundaryType": "Locality", "parentBoundaryType": "Ward"},
            ],
        },
    }
    resp = requests.post(hierarchy_url, json=hierarchy_payload, headers=headers, timeout=REQUEST_TIMEOUT)
    if resp.ok:
        print("   Hierarchy created")
    elif "already exists" in resp.text.lower() or "duplicate" in resp.text.lower():
        print("   Hierarchy already exists")
    else:
        print(f"   Warning: hierarchy creation: {resp.text[:200]}")
        # Continue anyway — hierarchy might exist from a previous run

    # Step 2: Create boundary entities (batch — just code + tenantId + geometry)
    print("   Creating boundary entities...")
    entity_url = f"{loader.base_url}/boundary-service/boundary/_create"
    boundaries = [
        {"code": f"{BOOT_ROOT.upper()}_COUNTRY", "boundaryType": "Country", "parent": None},
        {"code": f"{BOOT_ROOT.upper()}_STATE", "boundaryType": "State", "parent": f"{BOOT_ROOT.upper()}_COUNTRY"},
        {"code": f"{BOOT_ROOT.upper()}_DIST", "boundaryType": "District", "parent": f"{BOOT_ROOT.upper()}_STATE"},
        {"code": f"{BOOT_ROOT.upper()}_CITY", "boundaryType": "City", "parent": f"{BOOT_ROOT.upper()}_DIST"},
        {"code": f"{BOOT_ROOT.upper()}_WARD1", "boundaryType": "Ward", "parent": f"{BOOT_ROOT.upper()}_CITY"},
        {"code": LOCALITY_CODE, "boundaryType": "Locality", "parent": f"{BOOT_ROOT.upper()}_WARD1"},
    ]

    # Boundary entities only need code, tenantId, and geometry
    default_geometry = {"type": "Point", "coordinates": [0, 0]}
    entity_payload = {
        "RequestInfo": auth_info,
        "Boundary": [
            {"tenantId": tenant, "code": bnd["code"], "geometry": default_geometry}
            for bnd in boundaries
        ],
    }
    resp = requests.post(entity_url, json=entity_payload, headers=headers, timeout=REQUEST_TIMEOUT)
    if resp.ok:
        print(f"   Created {len(boundaries)} boundary entities")
    elif "already exists" in resp.text.lower() or "duplicate" in resp.text.lower():
        print("   Some entities already exist, creating one-by-one...")
        for bnd in boundaries:
            single_payload = {
                "RequestInfo": auth_info,
                "Boundary": [{"tenantId": tenant, "code": bnd["code"], "geometry": default_geometry}],
            }
            r = requests.post(entity_url, json=single_payload, headers=headers, timeout=REQUEST_TIMEOUT)
            if not r.ok and "already exists" not in r.text.lower() and "duplicate" not in r.text.lower():
                print(f"   Warning: boundary {bnd['code']}: {r.text[:150]}")
    else:
        print(f"   Warning: batch entity creation: {resp.text[:200]}")
        # Try one-by-one as fallback
        for bnd in boundaries:
            single_payload = {
                "RequestInfo": auth_info,
                "Boundary": [{"tenantId": tenant, "code": bnd["code"], "geometry": default_geometry}],
            }
            r = requests.post(entity_url, json=single_payload, headers=headers, timeout=REQUEST_TIMEOUT)
            if not r.ok and "already exists" not in r.text.lower() and "duplicate" not in r.text.lower():
                print(f"   Warning: boundary {bnd['code']}: {r.text[:150]}")

    # Step 3: Create parent-child relationships (boundaryType goes here, not in entity)
    print("   Creating boundary relationships...")
    relation_url = f"{loader.base_url}/boundary-service/boundary-relationships/_create"
    for bnd in boundaries:
        rel_payload = {
            "RequestInfo": auth_info,
            "BoundaryRelationship": {
                "tenantId": tenant,
                "code": bnd["code"],
                "hierarchyType": "ADMIN",
                "boundaryType": bnd["boundaryType"],
            },
        }
        # Add parent only if it exists (root boundary has no parent)
        if bnd["parent"]:
            rel_payload["BoundaryRelationship"]["parent"] = bnd["parent"]
        resp = requests.post(relation_url, json=rel_payload, headers=headers, timeout=REQUEST_TIMEOUT)
        if not resp.ok and "already exists" not in resp.text.lower() and "duplicate" not in resp.text.lower():
            print(f"   Warning: relationship {bnd['code']}: {resp.text[:150]}")

    print(f"   Boundary tree created with locality {LOCALITY_CODE}")
    return True


def lookup_service_def(base_url, state_tenant):
    """Find a ServiceDef and return (serviceCode, department)."""
    headers = {"Content-Type": "application/json"}
    resp = requests.post(
        f"{base_url}/mdms-v2/v1/_search",
        json={
            "MdmsCriteria": {
                "tenantId": state_tenant,
                "moduleDetails": [
                    {"moduleName": "RAINMAKER-PGR", "masterDetails": [{"name": "ServiceDefs"}]}
                ],
            },
            "RequestInfo": {"apiId": "Rainmaker"},
        },
        headers=headers,
        timeout=REQUEST_TIMEOUT,
    )
    if not resp.ok:
        return None, None
    defs = resp.json().get("MdmsRes", {}).get("RAINMAKER-PGR", {}).get("ServiceDefs", [])
    if not defs:
        return None, None
    svc = defs[0]
    return svc.get("serviceCode"), svc.get("department")


def ensure_department_for_tenant(loader, dept_code, city_tenant):
    """Create department at city level for HRMS validation."""
    headers = {"Content-Type": "application/json"}
    # Get department name from root
    state_tenant = city_tenant.split(".")[0]
    resp = requests.post(
        f"{loader.base_url}/mdms-v2/v1/_search",
        json={
            "MdmsCriteria": {
                "tenantId": state_tenant,
                "moduleDetails": [
                    {"moduleName": "common-masters", "masterDetails": [{"name": "Department"}]}
                ],
            },
            "RequestInfo": {"apiId": "Rainmaker"},
        },
        headers=headers,
        timeout=REQUEST_TIMEOUT,
    )
    dept_name = dept_code
    if resp.ok:
        for d in resp.json().get("MdmsRes", {}).get("common-masters", {}).get("Department", []):
            if d.get("code") == dept_code:
                dept_name = d.get("name", dept_code)
                break

    create_url = f"{loader.base_url}/mdms-v2/v2/_create/common-masters.Department"
    payload = {
        "RequestInfo": {
            "apiId": "Rainmaker",
            "authToken": loader.auth_token,
            "userInfo": loader.user_info,
        },
        "Mdms": {
            "tenantId": city_tenant,
            "schemaCode": "common-masters.Department",
            "data": {"code": dept_code, "name": dept_name, "active": True},
            "isActive": True,
        },
    }
    resp = requests.post(create_url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT)
    if resp.ok:
        print(f"   Created {dept_code} for {city_tenant}")
    elif "already exists" in resp.text.lower() or "duplicate" in resp.text.lower():
        print(f"   {dept_code} already exists for {city_tenant}")
    else:
        print(f"   Warning: {dept_code}: {resp.text[:200]}")


def main():
    print("=" * 60)
    print("CI Cross-Root Bootstrap Test")
    print("=" * 60)
    print(f"URL:          {BASE_URL}")
    print(f"Boot tenant:  {BOOT_TENANT}")
    print(f"Boot root:    {BOOT_ROOT}")

    # Step 1: Login
    print("\n[1/6] Login as superuser on root tenant")
    loader = CRSLoader(BASE_URL)
    if not loader.login(username=USERNAME, password=PASSWORD, tenant_id=ROOT_TENANT):
        print("FATAL: Login failed")
        return 1

    # Step 2: Create tenant (this triggers auto-bootstrap of the new root)
    print(f"\n[2/6] Create tenant '{BOOT_TENANT}' (auto-bootstrap of '{BOOT_ROOT}')")
    if not loader.create_tenant(BOOT_TENANT, "Bootstrap Test City"):
        print("FATAL: create_tenant failed")
        return 1

    # Step 3: Create boundaries
    print(f"\n[3/6] Create boundary hierarchy for '{BOOT_TENANT}'")
    if not create_boundary(loader, BOOT_TENANT):
        print("FATAL: boundary creation failed")
        return 1

    # Step 4: Look up ServiceDef from bootstrapped data
    print(f"\n[4/6] Look up ServiceDef on '{BOOT_ROOT}'")
    service_code, dept_code = lookup_service_def(BASE_URL, BOOT_ROOT)
    if not service_code or not dept_code:
        print("FATAL: No ServiceDefs found on bootstrapped root")
        return 1
    print(f"   Using: {service_code} -> dept {dept_code}")
    ensure_department_for_tenant(loader, dept_code, BOOT_TENANT)

    # Step 5: Create HRMS employee
    print(f"\n[5/6] Create HRMS employee on '{BOOT_TENANT}'")
    if not loader.create_employee(
        tenant=BOOT_TENANT,
        username=CI_USER,
        password=CI_PASSWORD,
        name="Bootstrap Admin",
        mobile=CI_MOBILE,
        roles=CI_ROLES,
        department=dept_code,
    ):
        print("FATAL: Failed to create HRMS employee")
        return 1

    # Verify login
    test_loader = CRSLoader(BASE_URL)
    if not test_loader.login(username=CI_USER, password=CI_PASSWORD, tenant_id=BOOT_TENANT):
        print("FATAL: Bootstrap user login failed")
        return 1

    # Step 6: Load workflow at ROOT level (PGR resolves city tenant to root internally)
    print(f"\n[6/6] Load PGR workflow on '{BOOT_ROOT}' (root level)")
    templates_dir = os.path.join(DATALOADER_DIR, "templates")
    workflow_file = os.path.join(templates_dir, "PgrWorkflowConfig.json")
    if not os.path.exists(workflow_file):
        print(f"FATAL: {workflow_file} not found")
        return 1
    loader.load_workflow(workflow_file, target_tenant=BOOT_ROOT)

    print("\n" + "=" * 60)
    print("BOOTSTRAP TEST PASSED")
    print(f"BOOT_TENANT={BOOT_TENANT}")
    print(f"BOOT_ROOT={BOOT_ROOT}")
    print(f"BOOT_USER={CI_USER}")
    print(f"BOOT_SERVICE_CODE={service_code}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
