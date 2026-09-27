#!/usr/bin/env python3
"""
CI Data Loader - creates a test tenant and loads PGR data for Postman tests.

Flow:
  1. Login as superuser on root tenant
  2. Create target tenant (no users — HRMS employee created after masters)
  3. Load common masters (departments, designations, complaint types)
  4. Look up a ServiceDef to find its department
  5. Create CI user via HRMS in that department
  6. Load PGR workflow

Outputs the serviceCode to stdout for newman --env-var.

Environment variables:
  DIGIT_URL        - Kong gateway URL (default: http://localhost:18000)
  DIGIT_USERNAME   - Superuser username (default: ADMIN)
  DIGIT_PASSWORD   - Password (default: eGov@123)
  ROOT_TENANT      - Root tenant for login (default: pg)
  TARGET_TENANT    - Tenant to create and load data into (default: pg.citest)
"""

import os
import sys
import json
import time
import requests

# Add dataloader directory to path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATALOADER_DIR = os.path.join(SCRIPT_DIR, "..", "dataloader")
sys.path.insert(0, DATALOADER_DIR)

from crs_loader import CRSLoader

# Configuration from env
BASE_URL = os.environ.get("DIGIT_URL", "http://localhost:18000")
USERNAME = os.environ.get("DIGIT_USERNAME", "ADMIN")
PASSWORD = os.environ.get("DIGIT_PASSWORD", "eGov@123")
ROOT_TENANT = os.environ.get("ROOT_TENANT", "pg")
TARGET_TENANT = os.environ.get("TARGET_TENANT", "pg.citest")
TEMPLATES_DIR = os.path.join(DATALOADER_DIR, "templates")

# CI test user credentials (used by Postman collection)
CI_USER = "CI-ADMIN"
CI_PASSWORD = "eGov@123"
CI_MOBILE = "9999900001"
CI_ROLES = ["SUPERUSER", "EMPLOYEE", "CSR", "GRO", "DGRO", "PGR_LME", "PGR_VIEWER", "CFC"]


def lookup_service_def(base_url, state_tenant):
    """Find a leaf complaint type and return (serviceCode, department, departmentName).

    Reads the merged RAINMAKER-PGR.ComplaintHierarchy master and keeps only LEAF rows
    (those carrying a 'department'); a leaf row's 'code' IS the serviceCode.
    """
    headers = {"Content-Type": "application/json"}
    # Get ComplaintHierarchy rows (interior nodes + leaves)
    resp = requests.post(f"{base_url}/mdms-v2/v1/_search",
        json={"MdmsCriteria": {"tenantId": state_tenant,
              "moduleDetails": [{"moduleName": "RAINMAKER-PGR",
                                 "masterDetails": [{"name": "ComplaintHierarchy"}]}]},
              "RequestInfo": {"apiId": "Rainmaker"}},
        headers=headers, timeout=30)
    if not resp.ok:
        return None, None, None
    rows = resp.json().get("MdmsRes", {}).get("RAINMAKER-PGR", {}).get("ComplaintHierarchy", [])
    # Leaf rows carry a department (interior CATEGORY nodes do not).
    defs = [r for r in rows if r.get("department")]
    if not defs:
        return None, None, None
    svc = defs[0]
    dept_code = svc.get("department")

    # Get department name from state-level MDMS
    dept_name = dept_code
    resp2 = requests.post(f"{base_url}/mdms-v2/v1/_search",
        json={"MdmsCriteria": {"tenantId": state_tenant,
              "moduleDetails": [{"moduleName": "common-masters",
                                 "masterDetails": [{"name": "Department"}]}]},
              "RequestInfo": {"apiId": "Rainmaker"}},
        headers=headers, timeout=30)
    if resp2.ok:
        for d in resp2.json().get("MdmsRes", {}).get("common-masters", {}).get("Department", []):
            if d.get("code") == dept_code:
                dept_name = d.get("name", dept_code)
                break
    # For a ComplaintHierarchy leaf, the 'code' IS the serviceCode stored on a complaint.
    return svc.get("code"), dept_code, dept_name


def lookup_city_service_def(base_url, city_tenant):
    """Leaf complaint type from the city's OWN ComplaintHierarchy rows, or (None, None, None).

    Reads MDMS v2 search, which has no tenant inheritance: an empty answer means the city
    has no rows of its own (yet). v1 is not usable here — mdms-v2 persists creates
    asynchronously, so right after step 3 v1 answers with the INHERITED state rows. Picking
    a state leaf gives CI-ADMIN a department the city's complaint types don't use, and PGR
    then rejects Assign with INVALID_ASSIGNMENT.
    """
    resp = requests.post(f"{base_url}/mdms-v2/v2/_search",
        json={"MdmsCriteria": {"tenantId": city_tenant, "limit": 500,
                               "schemaCode": "RAINMAKER-PGR.ComplaintHierarchy"},
              "RequestInfo": {"apiId": "Rainmaker"}},
        headers={"Content-Type": "application/json"}, timeout=30)
    if not resp.ok:
        return None, None, None
    leaves = [m["data"] for m in resp.json().get("mdms", [])
              if m.get("tenantId") == city_tenant and m.get("isActive", True)
              and m.get("data", {}).get("department")]
    if not leaves:
        return None, None, None
    svc = leaves[0]
    return svc.get("code"), svc.get("department"), svc.get("department")


def ensure_department_for_tenant(loader, dept_code, dept_name, city_tenant):
    """Create a department at city tenant level so HRMS v1 can see it."""
    headers = {"Content-Type": "application/json"}
    create_url = f"{loader.base_url}/mdms-v2/v2/_create/common-masters.Department"
    payload = {
        "RequestInfo": {"apiId": "Rainmaker", "authToken": loader.auth_token,
                        "userInfo": loader.user_info},
        "Mdms": {"tenantId": city_tenant, "schemaCode": "common-masters.Department",
                 "data": {"code": dept_code, "name": dept_name, "active": True},
                 "isActive": True},
    }
    resp = requests.post(create_url, json=payload, headers=headers, timeout=30)
    if resp.ok:
        print(f"   Created {dept_code} ({dept_name}) for {city_tenant}")
    elif "already exists" in resp.text.lower() or "duplicate" in resp.text.lower():
        print(f"   {dept_code} already exists for {city_tenant}")
    else:
        print(f"   Warning: could not create {dept_code}: {resp.text[:200]}")


# Locality the complaints-demo Postman collection files its complaint under.
CI_LOCALITY_CODE = "JLC477"


def ensure_locality_for_tenant(loader, city_tenant):
    """Create the boundary the Postman collection's PGR Create uses.

    full-dump.sql ships no boundaries for pg.citest, so PGR Create fails with
    INVALID_BOUNDARY_CODE. Same seed as the Ansible post-bootstrap task on
    fix/ansible-doc-validation (c0ed248b); an existing boundary is fine.
    """
    headers = {"Content-Type": "application/json"}
    resp = requests.post(f"{loader.base_url}/boundary-service/boundary/_create",
        json={"RequestInfo": {"apiId": "Rainmaker", "authToken": loader.auth_token,
                              "userInfo": loader.user_info},
              "Boundary": [{"tenantId": city_tenant, "code": CI_LOCALITY_CODE, "geometry": None}]},
        headers=headers, timeout=30)
    if resp.ok:
        print(f"   Created boundary {CI_LOCALITY_CODE} for {city_tenant}")
    elif "already exists" in resp.text.lower() or "DUPLICATE" in resp.text.upper():
        print(f"   Boundary {CI_LOCALITY_CODE} already exists for {city_tenant}")
    else:
        print(f"   Warning: could not create boundary {CI_LOCALITY_CODE}: {resp.text[:200]}")


def main():
    print("=" * 60)
    print("CI Data Loader")
    print("=" * 60)
    print(f"URL:     {BASE_URL}")
    print(f"Tenant:  {TARGET_TENANT}")
    state_tenant = TARGET_TENANT.split(".")[0] if "." in TARGET_TENANT else TARGET_TENANT

    # Step 1: Login
    print("\n[1/6] Login")
    loader = CRSLoader(BASE_URL)
    if not loader.login(username=USERNAME, password=PASSWORD, tenant_id=ROOT_TENANT):
        print("FATAL: Login failed")
        return 1

    # Step 2: Create tenant
    print("\n[2/6] Create tenant")
    if not loader.create_tenant(TARGET_TENANT, "CI Test"):
        print("FATAL: Failed to create tenant")
        return 1

    # Step 3: Load common masters
    print("\n[3/6] Load common masters")
    common_file = os.path.join(TEMPLATES_DIR, "Common and Complaint Master.xlsx")
    if not os.path.exists(common_file):
        print(f"FATAL: {common_file} not found")
        return 1
    loader.load_common_masters(common_file, target_tenant=TARGET_TENANT)

    # Step 4: Look up a leaf complaint type and ensure its department exists at city level
    print("\n[4/6] Look up complaint type department")
    # City tenant first: PGR Create validates the serviceCode against the complaint's own
    # tenant, and a city with its own ComplaintHierarchy (pg.citest in full-dump.sql) does
    # not see the state's leaves — a state pick fails with INVALID_SERVICECODE.
    # Retry: step 3's rows reach the store asynchronously (see lookup_city_service_def).
    for _ in range(10):
        service_code, dept_code, dept_name = lookup_city_service_def(BASE_URL, TARGET_TENANT)
        if service_code and dept_code:
            break
        time.sleep(3)
    if not service_code or not dept_code:
        service_code, dept_code, dept_name = lookup_service_def(BASE_URL, state_tenant)
    if not service_code or not dept_code:
        print("FATAL: No leaf complaint types found in RAINMAKER-PGR.ComplaintHierarchy")
        return 1
    print(f"   Using: {service_code} -> dept {dept_code} ({dept_name})")
    # HRMS validates departments via MDMS v1 which has no tenant inheritance.
    # State-level departments aren't visible at city level, so create it explicitly.
    ensure_department_for_tenant(loader, dept_code, dept_name, TARGET_TENANT)
    ensure_locality_for_tenant(loader, TARGET_TENANT)

    # Step 5: Create CI user via HRMS in the complaint type's department
    print("\n[5/6] Create HRMS employee")
    if not loader.create_employee(
        tenant=TARGET_TENANT, username=CI_USER, password=CI_PASSWORD,
        name="CI Admin", mobile=CI_MOBILE, roles=CI_ROLES,
        department=dept_code,
        # PGR scopes employee search to the jurisdiction; it must cover the locality
        # the Postman collection files its complaint under, or PGR Search returns [].
        jurisdiction_boundary=CI_LOCALITY_CODE,
    ):
        print("FATAL: Failed to create HRMS employee")
        return 1

    # Verify login
    test_loader = CRSLoader(BASE_URL)
    if not test_loader.login(username=CI_USER, password=CI_PASSWORD, tenant_id=TARGET_TENANT):
        print("FATAL: CI user login failed")
        return 1

    # Step 6: Load workflow
    print("\n[6/6] Load workflow")
    workflow_file = os.path.join(TEMPLATES_DIR, "PgrWorkflowConfig.json")
    if not os.path.exists(workflow_file):
        print(f"FATAL: {workflow_file} not found")
        return 1
    loader.load_workflow(workflow_file, target_tenant=TARGET_TENANT)

    print("\n" + "=" * 60)
    print(f"CI_TENANT={TARGET_TENANT}")
    print(f"CI_USER={CI_USER}")
    print(f"CI_SERVICE_CODE={service_code}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
