#!/usr/bin/env python3
"""Create uitest.city1 tenant using CRSLoader (the real onboarding flow)."""

import sys
sys.path.insert(0, '/root/code/digit-ui-fix/local-setup/jupyter/dataloader')

from crs_loader import CRSLoader

BASE_URL = "http://localhost:18000"

loader = CRSLoader(BASE_URL)
ok = loader.login(username="ADMIN", password="eGov@123", tenant_id="pg")
if not ok:
    print("Login failed")
    sys.exit(1)
print("Logged in as ADMIN on pg")

# Create uitest.city1 — this will auto-bootstrap the "uitest" root first
ok = loader.create_tenant(
    tenant_code="uitest.city1",
    display_name="UI Test City",
    enable_modules=["PGR", "HRMS"],
    users=[
        {
            "username": "UITEST_ADMIN",
            "password": "eGov@123",
            "name": "UI Test Admin",
            "roles": ["SUPERUSER", "EMPLOYEE", "GRO", "DGRO", "PGR_LME"],
            "mobile": "9876500001",
        },
    ],
)

if ok:
    print("\nTenant uitest.city1 created successfully!")

    # Create boundaries
    print("\nCreating boundaries...")
    try:
        loader.create_boundary(
            tenant_code="uitest.city1",
            hierarchy_type="ADMIN",
            boundaries=[
                {"code": "LOC_UTC1_1", "name": "Locality 1", "type": "Locality"},
                {"code": "LOC_UTC1_2", "name": "Locality 2", "type": "Locality"},
            ]
        )
    except AttributeError:
        print("   (create_boundary not available — will use MCP for boundaries)")
    except Exception as e:
        print(f"   Boundary creation: {e}")

    # Create a test PGR complaint
    print("\nCreating test PGR complaint...")
    try:
        loader.create_pgr_complaint(
            tenant_code="uitest.city1",
            service_code="StreetLightNotWorking",
            description="E2E test: street light not working near main road",
            locality_code="LOC_UTC1_1",
            citizen_name="Test Citizen",
            citizen_mobile="9888800001",
        )
    except AttributeError:
        print("   (create_pgr_complaint not available — will use API directly)")
    except Exception as e:
        print(f"   PGR complaint: {e}")
else:
    print("\nFailed to create tenant")
    sys.exit(1)
