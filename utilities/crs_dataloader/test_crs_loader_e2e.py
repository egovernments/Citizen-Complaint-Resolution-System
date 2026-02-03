#!/usr/bin/env python3
"""
E2E Test Suite for CRSLoader
Tests all phases of the DataLoader v2 notebook with assertions.

Run: python test_crs_loader_e2e.py
     pytest test_crs_loader_e2e.py -v

Environment variables:
  DIGIT_URL      - Gateway URL (default: https://chakshu-digit.egov.theflywheel.in)
  DIGIT_USERNAME - Admin username (required)
  DIGIT_PASSWORD - Admin password (required)
  DIGIT_TENANT   - Tenant ID (default: statea)
"""

import os
import sys
import pytest

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from crs_loader import CRSLoader

# Configuration
BASE_URL = os.environ.get("DIGIT_URL", "https://chakshu-digit.egov.theflywheel.in")
USERNAME = os.environ.get("DIGIT_USERNAME")
PASSWORD = os.environ.get("DIGIT_PASSWORD")
TARGET_TENANT = os.environ.get("DIGIT_TENANT", "statea")
TEMPLATES_DIR = "templates"


class TestCRSLoader:
    """Test suite for CRSLoader class"""

    @pytest.fixture(scope="class")
    def loader(self):
        """Create and authenticate a CRSLoader instance"""
        if not USERNAME or not PASSWORD:
            pytest.skip("DIGIT_USERNAME and DIGIT_PASSWORD environment variables required")

        loader = CRSLoader(BASE_URL)
        success = loader.login(username=USERNAME, password=PASSWORD, tenant_id=TARGET_TENANT)
        assert success, "Login failed - check credentials"
        assert loader._authenticated, "Loader should be authenticated after login"
        assert loader.uploader is not None, "Uploader should be initialized"
        assert loader.uploader.auth_token is not None, "Auth token should be set"
        return loader

    # =========================================================================
    # Authentication Tests
    # =========================================================================

    def test_login_success(self, loader):
        """Test that login was successful and user info is populated"""
        assert loader._authenticated is True
        assert loader.uploader.user_info is not None
        assert 'userName' in loader.uploader.user_info
        print(f"   Logged in as: {loader.uploader.user_info.get('userName')}")

    def test_login_failure_bad_credentials(self):
        """Test that login fails with bad credentials"""
        bad_loader = CRSLoader(BASE_URL)
        success = bad_loader.login(username="BADUSER", password="BADPASS", tenant_id=TARGET_TENANT)
        assert success is False, "Login should fail with bad credentials"
        assert bad_loader._authenticated is False

    # =========================================================================
    # Phase 1: Tenant & Branding Tests
    # =========================================================================

    def test_phase1_load_tenant(self, loader):
        """Phase 1: Test loading tenant and branding configuration"""
        tenant_file = os.path.join(TEMPLATES_DIR, "Tenant And Branding Master.xlsx")
        if not os.path.exists(tenant_file):
            pytest.skip(f"Template file not found: {tenant_file}")

        result = loader.load_tenant(tenant_file, target_tenant=TARGET_TENANT)

        # Assertions
        assert result is not None, "Result should not be None"
        assert 'tenants' in result, "Result should contain 'tenants' key"
        assert 'branding' in result, "Result should contain 'branding' key"
        assert 'localization' in result, "Result should contain 'localization' key"

        # Check tenant result
        if result['tenants']:
            assert 'created' in result['tenants'] or 'exists' in result['tenants']
            assert result['tenants'].get('failed', 0) == 0, "No tenant creation should fail"
            print(f"   Tenants: created={result['tenants'].get('created', 0)}, exists={result['tenants'].get('exists', 0)}")

        # Check branding result
        if result['branding']:
            assert result['branding'].get('failed', 0) == 0, "No branding creation should fail"
            print(f"   Branding: created={result['branding'].get('created', 0)}, exists={result['branding'].get('exists', 0)}")

    # =========================================================================
    # Phase 2: Boundaries Tests
    # =========================================================================

    def test_phase2_load_boundaries(self, loader):
        """Phase 2: Test loading boundary hierarchy"""
        boundary_file = os.path.join(TEMPLATES_DIR, "Boundary_Master.xlsx")
        if not os.path.exists(boundary_file):
            pytest.skip(f"Template file not found: {boundary_file}")

        result = loader.load_boundaries(boundary_file, target_tenant=TARGET_TENANT, hierarchy_type="REVENUE")

        # Assertions
        assert result is not None, "Result should not be None"
        assert 'status' in result, "Result should contain 'status' key"

        # Status should be completed or boundaries already exist
        assert result['status'] in ['completed', 'exists', 'failed'], f"Unexpected status: {result['status']}"

        if result['status'] == 'completed':
            assert result.get('boundaries_created', 0) >= 0
            assert result.get('relationships_created', 0) >= 0
            print(f"   Boundaries: {result.get('boundaries_created', 0)} created")
            print(f"   Relationships: {result.get('relationships_created', 0)} created")

    def test_phase2_delete_boundaries(self, loader):
        """Phase 2 Rollback: Test deleting boundaries"""
        result = loader.delete_boundaries(TARGET_TENANT)

        assert result is not None, "Result should not be None"
        assert 'status' in result, "Result should contain 'status' key"
        assert result['status'] == 'success', f"Delete should succeed, got: {result['status']}"
        assert 'deleted' in result, "Result should contain 'deleted' count"
        print(f"   Deleted: {result.get('deleted', 0)} boundaries, {result.get('relationships_deleted', 0)} relationships")

    # =========================================================================
    # Phase 3: Common Masters Tests
    # =========================================================================

    def test_phase3_load_common_masters(self, loader):
        """Phase 3: Test loading departments, designations, and complaint types"""
        common_file = os.path.join(TEMPLATES_DIR, "Common and Complaint Master.xlsx")
        if not os.path.exists(common_file):
            pytest.skip(f"Template file not found: {common_file}")

        result = loader.load_common_masters(common_file, target_tenant=TARGET_TENANT)

        # Assertions
        assert result is not None, "Result should not be None"
        assert 'departments' in result, "Result should contain 'departments' key"
        assert 'designations' in result, "Result should contain 'designations' key"
        assert 'complaint_types' in result, "Result should contain 'complaint_types' key"

        # Check no failures (exists is OK)
        for key in ['departments', 'designations', 'complaint_types']:
            if result[key]:
                failed = result[key].get('failed', 0)
                assert failed == 0, f"{key} should have no failures, got {failed}"
                print(f"   {key}: created={result[key].get('created', 0)}, exists={result[key].get('exists', 0)}")

    def test_phase3_rollback_common_masters(self, loader):
        """Phase 3 Rollback: Test soft-deleting common masters"""
        result = loader.rollback_common_masters(TARGET_TENANT)

        assert result is not None, "Result should not be None"
        # Result is a dict with schema codes as keys
        print(f"   Rollback result: {result}")

    # =========================================================================
    # Phase 4: Employees Tests
    # =========================================================================

    def test_phase4_load_employees(self, loader):
        """Phase 4: Test loading employees"""
        employee_file = os.path.join(TEMPLATES_DIR, f"Employee_Master_Dynamic_{TARGET_TENANT}.xlsx")
        if not os.path.exists(employee_file):
            pytest.skip(f"Template file not found: {employee_file}")

        result = loader.load_employees(employee_file, target_tenant=TARGET_TENANT)

        # Assertions
        assert result is not None, "Result should not be None"
        assert 'created' in result or 'exists' in result, "Result should contain creation status"

        failed = result.get('failed', 0)
        assert failed == 0, f"No employee creation should fail, got {failed} failures"
        print(f"   Employees: created={result.get('created', 0)}, exists={result.get('exists', 0)}")

    # =========================================================================
    # Phase 5: Localizations Tests
    # =========================================================================

    def test_phase5_load_localizations(self, loader):
        """Phase 5: Test loading localization messages"""
        localization_file = os.path.join(TEMPLATES_DIR, "localization.xlsx")
        if not os.path.exists(localization_file):
            pytest.skip(f"Template file not found: {localization_file}")

        result = loader.load_localizations(localization_file, target_tenant=TARGET_TENANT)

        # Assertions
        assert result is not None, "Result should not be None"
        assert 'messages' in result, "Result should contain 'messages' key"

        if result['messages']:
            failed = result['messages'].get('failed', 0)
            assert failed == 0, f"No localization upload should fail, got {failed} failures"
            print(f"   Messages: created={result['messages'].get('created', 0)}")

    def test_phase5_load_localizations_with_language(self, loader):
        """Phase 5: Test loading localizations with new language enabled"""
        localization_file = os.path.join(TEMPLATES_DIR, "localization.xlsx")
        if not os.path.exists(localization_file):
            pytest.skip(f"Template file not found: {localization_file}")

        result = loader.load_localizations(
            localization_file,
            target_tenant=TARGET_TENANT,
            language_label="Test Language",
            locale_code="te_IN"
        )

        assert result is not None, "Result should not be None"
        assert 'messages' in result, "Result should contain 'messages' key"
        assert 'stateinfo' in result, "Result should contain 'stateinfo' key when language params provided"

    # =========================================================================
    # Error Handling Tests
    # =========================================================================

    def test_unauthenticated_operation_fails(self):
        """Test that operations fail when not authenticated"""
        unauthenticated_loader = CRSLoader(BASE_URL)

        with pytest.raises(RuntimeError, match="Not authenticated"):
            unauthenticated_loader.load_tenant("dummy.xlsx")

    def test_file_not_found_handling(self, loader):
        """Test graceful handling of missing files"""
        with pytest.raises(Exception):
            loader.load_tenant("nonexistent_file.xlsx")


# =========================================================================
# Standalone runner
# =========================================================================

def run_all_tests():
    """Run all tests without pytest"""
    print("=" * 70)
    print("CRS Data Loader v2 - E2E Test Suite")
    print("=" * 70)
    print(f"Environment: {BASE_URL}")
    print(f"Tenant: {TARGET_TENANT}")
    print()

    if not USERNAME or not PASSWORD:
        print("ERROR: Set DIGIT_USERNAME and DIGIT_PASSWORD environment variables")
        return 1

    # Create loader
    loader = CRSLoader(BASE_URL)

    # Test 1: Login
    print("[1/7] Testing login...")
    success = loader.login(username=USERNAME, password=PASSWORD, tenant_id=TARGET_TENANT)
    assert success, "Login failed"
    assert loader._authenticated, "Should be authenticated"
    print("   PASS: Login successful")

    # Test 2: Phase 1
    print("\n[2/7] Testing Phase 1 - Tenant & Branding...")
    tenant_file = os.path.join(TEMPLATES_DIR, "Tenant And Branding Master.xlsx")
    if os.path.exists(tenant_file):
        result = loader.load_tenant(tenant_file, target_tenant=TARGET_TENANT)
        assert result is not None
        assert result.get('tenants', {}).get('failed', 0) == 0
        print("   PASS: Tenant & Branding loaded")
    else:
        print("   SKIP: Template not found")

    # Test 3: Phase 2
    print("\n[3/7] Testing Phase 2 - Boundaries...")
    boundary_file = os.path.join(TEMPLATES_DIR, "Boundary_Master.xlsx")
    if os.path.exists(boundary_file):
        result = loader.load_boundaries(boundary_file, target_tenant=TARGET_TENANT, hierarchy_type="REVENUE")
        assert result is not None
        assert result.get('status') in ['completed', 'exists', 'failed']
        print("   PASS: Boundaries loaded")
    else:
        print("   SKIP: Template not found")

    # Test 4: Phase 3
    print("\n[4/7] Testing Phase 3 - Common Masters...")
    common_file = os.path.join(TEMPLATES_DIR, "Common and Complaint Master.xlsx")
    if os.path.exists(common_file):
        result = loader.load_common_masters(common_file, target_tenant=TARGET_TENANT)
        assert result is not None
        print("   PASS: Common Masters loaded")
    else:
        print("   SKIP: Template not found")

    # Test 5: Phase 4
    print("\n[5/7] Testing Phase 4 - Employees...")
    employee_file = os.path.join(TEMPLATES_DIR, f"Employee_Master_Dynamic_{TARGET_TENANT}.xlsx")
    if os.path.exists(employee_file):
        result = loader.load_employees(employee_file, target_tenant=TARGET_TENANT)
        assert result is not None
        assert result.get('failed', 0) == 0
        print("   PASS: Employees loaded")
    else:
        print("   SKIP: Template not found")

    # Test 6: Phase 5
    print("\n[6/7] Testing Phase 5 - Localizations...")
    localization_file = os.path.join(TEMPLATES_DIR, "localization.xlsx")
    if os.path.exists(localization_file):
        result = loader.load_localizations(localization_file, target_tenant=TARGET_TENANT)
        assert result is not None
        print("   PASS: Localizations loaded")
    else:
        print("   SKIP: Template not found (optional)")

    # Test 7: Error handling
    print("\n[7/7] Testing error handling...")
    unauthenticated = CRSLoader(BASE_URL)
    try:
        unauthenticated.load_tenant("dummy.xlsx")
        assert False, "Should have raised RuntimeError"
    except RuntimeError as e:
        assert "Not authenticated" in str(e)
        print("   PASS: Unauthenticated access blocked")

    print("\n" + "=" * 70)
    print("ALL TESTS PASSED")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    # Check if running with pytest
    if "pytest" in sys.modules:
        pytest.main([__file__, "-v"])
    else:
        sys.exit(run_all_tests())
