#!/usr/bin/env python3
"""
E2E Test script for CRSLoader - runs all notebook phases
Run: python test_crs_loader.py

Environment variables:
  DIGIT_URL      - Gateway URL (default: https://chakshu-digit.egov.theflywheel.in)
  DIGIT_USERNAME - Admin username
  DIGIT_PASSWORD - Admin password
  DIGIT_TENANT   - Tenant ID (default: statea)
"""

import os
import sys

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from crs_loader import CRSLoader

# Configuration
BASE_URL = os.environ.get("DIGIT_URL", "https://chakshu-digit.egov.theflywheel.in")
TEMPLATES_DIR = "templates"
TARGET_TENANT = os.environ.get("DIGIT_TENANT", "statea")

def main():
    print("=" * 60)
    print("CRS Data Loader v2 - E2E Test Run")
    print("=" * 60)
    print(f"Environment: {BASE_URL}")
    print(f"Target Tenant: {TARGET_TENANT}")
    print()

    # Cell 1: Setup (already done via import)
    print("[1/7] Setup - Import successful")

    # Cell 2: Login
    print("\n[2/7] Login")
    loader = CRSLoader(BASE_URL)

    # Get credentials from env or prompt
    username = os.environ.get("DIGIT_USERNAME")
    password = os.environ.get("DIGIT_PASSWORD")
    tenant_id = TARGET_TENANT

    if not username or not password:
        print("   Enter credentials (or set DIGIT_USERNAME/DIGIT_PASSWORD env vars)")

    success = loader.login(username=username, password=password, tenant_id=tenant_id)

    if not success:
        print("\n[ABORT] Login failed. Cannot continue.")
        return 1

    # Cell 3: Phase 1 - Tenant & Branding
    print("\n[3/7] Phase 1 - Tenant & Branding")
    tenant_file = os.path.join(TEMPLATES_DIR, "Tenant And Branding Master.xlsx")
    if os.path.exists(tenant_file):
        result = loader.load_tenant(tenant_file, target_tenant=TARGET_TENANT)
    else:
        print(f"   SKIP: {tenant_file} not found")

    # Cell 4: Phase 2 - Boundaries
    print("\n[4/7] Phase 2 - Boundaries")
    boundary_file = os.path.join(TEMPLATES_DIR, "Boundary_Master.xlsx")
    if os.path.exists(boundary_file):
        result = loader.load_boundaries(boundary_file, target_tenant=TARGET_TENANT, hierarchy_type="REVENUE")
    else:
        print(f"   SKIP: {boundary_file} not found")

    # Cell 5: Phase 3 - Common Masters
    print("\n[5/7] Phase 3 - Common Masters")
    common_file = os.path.join(TEMPLATES_DIR, "Common and Complaint Master.xlsx")
    if os.path.exists(common_file):
        result = loader.load_common_masters(common_file, target_tenant=TARGET_TENANT)
    else:
        print(f"   SKIP: {common_file} not found")

    # Cell 6: Phase 4 - Employees
    print("\n[6/7] Phase 4 - Employees")
    employee_file = os.path.join(TEMPLATES_DIR, f"Employee_Master_Dynamic_{TARGET_TENANT}.xlsx")
    if os.path.exists(employee_file):
        result = loader.load_employees(employee_file, target_tenant=TARGET_TENANT)
    else:
        print(f"   SKIP: {employee_file} not found")

    # Cell 7: Phase 5 - Localizations (Optional)
    print("\n[7/7] Phase 5 - Localizations (Optional)")
    localization_file = os.path.join(TEMPLATES_DIR, "localization.xlsx")
    if os.path.exists(localization_file):
        result = loader.load_localizations(localization_file, target_tenant=TARGET_TENANT)
    else:
        print(f"   SKIP: {localization_file} not found (optional phase)")

    print("\n" + "=" * 60)
    print("E2E Test completed")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
