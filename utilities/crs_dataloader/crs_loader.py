"""
CRS Data Loader - Simple Wrapper
Provides clean abstraction over unified_loader.py for notebook usage.

Usage:
    from crs_loader import CRSLoader

    loader = CRSLoader("https://unified-dev.digit.org")
    loader.login("admin", "password", tenant_id="pg")

    loader.load_tenant("Tenant And Branding Master.xlsx")
    loader.load_boundaries("Boundary Master.xlsx")
    loader.load_common_masters("Common and Complaint Master.xlsx")
    loader.load_employees("Employee Master.xlsx")
"""

from unified_loader import UnifiedExcelReader, APIUploader
from typing import Optional, Dict
import os


class CRSLoader:
    """Simple wrapper for CRS Data Loading operations"""

    def __init__(self, base_url: str):
        """Initialize CRS Loader with DIGIT environment URL

        Args:
            base_url: DIGIT gateway URL (e.g., "https://unified-dev.digit.org")
        """
        self.base_url = base_url.rstrip('/')
        self.uploader: Optional[APIUploader] = None
        self.tenant_id: Optional[str] = None
        self._authenticated = False

    def login(self, username: str = None, password: str = None,
              tenant_id: str = "pg", user_type: str = "EMPLOYEE") -> bool:
        """Authenticate with DIGIT gateway

        Args:
            username: Admin username (prompts if not provided)
            password: Admin password (prompts if not provided)
            tenant_id: Root tenant ID (default: "pg")
            user_type: User type (default: "EMPLOYEE")

        Returns:
            bool: True if authentication successful
        """
        # Prompt for credentials if not provided
        if not username:
            username = input("Username: ")
        if not password:
            import getpass
            password = getpass.getpass("Password: ")

        self.tenant_id = tenant_id

        try:
            self.uploader = APIUploader(
                base_url=self.base_url,
                username=username,
                password=password,
                user_type=user_type,
                tenant_id=tenant_id
            )
            self._authenticated = self.uploader.authenticated
            return self._authenticated
        except Exception as e:
            print(f"Login failed: {e}")
            return False

    def _check_auth(self):
        """Check if authenticated before operations"""
        if not self._authenticated or not self.uploader:
            raise RuntimeError("Not authenticated. Call login() first.")

    def load_tenant(self, excel_path: str, target_tenant: str = None) -> Dict:
        """Phase 1: Load tenant configuration and branding

        Args:
            excel_path: Path to "Tenant And Branding Master.xlsx"
            target_tenant: Target tenant ID (uses tenant from Excel if not specified)

        Returns:
            dict: Summary of operations (created, exists, failed counts)
        """
        self._check_auth()

        print(f"\n{'='*60}")
        print(f"PHASE 1: TENANT & BRANDING")
        print(f"{'='*60}")
        print(f"File: {os.path.basename(excel_path)}")

        reader = UnifiedExcelReader(excel_path)
        results = {'tenants': None, 'branding': None, 'localization': None}

        # 1. Read and create tenants
        print(f"\n[1/3] Creating tenants...")
        tenants, localizations = reader.read_tenant_info()

        if not tenants:
            print("   No tenants found in Excel")
            return results

        # Use first tenant's code if target not specified
        if not target_tenant:
            target_tenant = tenants[0].get('code', self.tenant_id)

        # Upload tenants to MDMS
        results['tenants'] = self.uploader.create_mdms_data(
            schema_code='tenant.tenants',
            data_list=tenants,
            tenant=self.tenant_id,  # Tenants go to root tenant
            sheet_name='Tenant Info',
            excel_file=excel_path
        )

        # 2. Create branding
        print(f"\n[2/3] Creating branding...")
        branding = reader.read_tenant_branding(target_tenant)

        if branding:
            results['branding'] = self.uploader.create_mdms_data(
                schema_code='tenant.citymodule',
                data_list=branding,
                tenant=target_tenant,
                sheet_name='Tenant Branding Deatils',
                excel_file=excel_path
            )

        # 3. Create localizations
        print(f"\n[3/3] Creating localizations...")
        if localizations:
            results['localization'] = self.uploader.create_localization_messages(
                localization_list=localizations,
                tenant=target_tenant
            )

        self._print_summary("Tenant & Branding", results)
        return results

    def load_boundaries(self, excel_path: str, target_tenant: str = None,
                       hierarchy_type: str = "ADMIN") -> Dict:
        """Phase 2: Load boundary hierarchy from Excel

        Args:
            excel_path: Path to "Boundary Master.xlsx"
            target_tenant: Target tenant ID
            hierarchy_type: Hierarchy type (default: "ADMIN")

        Returns:
            dict: Processing result with status
        """
        self._check_auth()

        print(f"\n{'='*60}")
        print(f"PHASE 2: BOUNDARIES")
        print(f"{'='*60}")
        print(f"File: {os.path.basename(excel_path)}")
        print(f"Hierarchy: {hierarchy_type}")

        tenant = target_tenant or self.tenant_id

        # 1. Upload Excel to FileStore
        print(f"\n[1/2] Uploading boundary file...")
        filestore_id = self.uploader.upload_file_to_filestore(
            file_path=excel_path,
            tenant_id=tenant,
            module="HCM-ADMIN-CONSOLE"
        )

        if not filestore_id:
            print("   Failed to upload file")
            return {'status': 'failed', 'error': 'File upload failed'}

        print(f"   FileStore ID: {filestore_id}")

        # 2. Process boundaries
        print(f"\n[2/2] Processing boundary data...")
        result = self.uploader.process_boundary_data(
            tenant_id=tenant,
            filestore_id=filestore_id,
            hierarchy_type=hierarchy_type,
            action="create"
        )

        status = result.get('status', 'unknown')
        print(f"\n   Status: {status}")

        return result

    def load_common_masters(self, excel_path: str, target_tenant: str = None) -> Dict:
        """Phase 3: Load departments, designations, and complaint types

        Args:
            excel_path: Path to "Common and Complaint Master.xlsx"
            target_tenant: Target tenant ID

        Returns:
            dict: Summary of operations for each master type
        """
        self._check_auth()

        print(f"\n{'='*60}")
        print(f"PHASE 3: COMMON MASTERS")
        print(f"{'='*60}")
        print(f"File: {os.path.basename(excel_path)}")

        tenant = target_tenant or self.tenant_id
        reader = UnifiedExcelReader(excel_path)
        results = {'departments': None, 'designations': None, 'complaint_types': None}

        # 1. Load departments and designations
        print(f"\n[1/2] Loading departments & designations...")
        dept_data, desig_data, dept_loc, desig_loc, dept_name_to_code = \
            reader.read_departments_designations(tenant, self.uploader)

        # Upload departments
        if dept_data:
            print(f"   Creating {len(dept_data)} departments...")
            results['departments'] = self.uploader.create_mdms_data(
                schema_code='common-masters.Department',
                data_list=dept_data,
                tenant=tenant,
                sheet_name='Department',
                excel_file=excel_path
            )

            # Department localizations
            if dept_loc:
                self.uploader.create_localization_messages(dept_loc, tenant)

        # Upload designations
        if desig_data:
            print(f"   Creating {len(desig_data)} designations...")
            results['designations'] = self.uploader.create_mdms_data(
                schema_code='common-masters.Designation',
                data_list=desig_data,
                tenant=tenant,
                sheet_name='Designation',
                excel_file=excel_path
            )

            # Designation localizations
            if desig_loc:
                self.uploader.create_localization_messages(desig_loc, tenant)

        # 2. Load complaint types
        print(f"\n[2/2] Loading complaint types...")
        complaint_data, complaint_loc = reader.read_complaint_types(tenant, dept_name_to_code)

        if complaint_data:
            print(f"   Creating {len(complaint_data)} complaint types...")
            results['complaint_types'] = self.uploader.create_mdms_data(
                schema_code='RAINMAKER-PGR.ServiceDefs',
                data_list=complaint_data,
                tenant=tenant,
                sheet_name='Complaint Type',
                excel_file=excel_path
            )

            # Complaint type localizations
            if complaint_loc:
                self.uploader.create_localization_messages(complaint_loc, tenant)

        self._print_summary("Common Masters", results)
        return results

    def load_employees(self, excel_path: str, target_tenant: str = None) -> Dict:
        """Phase 4: Load employee master data

        Args:
            excel_path: Path to "Employee Master.xlsx"
            target_tenant: Target tenant ID

        Returns:
            dict: Summary of employee creation results
        """
        self._check_auth()

        print(f"\n{'='*60}")
        print(f"PHASE 4: EMPLOYEES")
        print(f"{'='*60}")
        print(f"File: {os.path.basename(excel_path)}")

        tenant = target_tenant or self.tenant_id
        reader = UnifiedExcelReader(excel_path)

        # 1. Read employee data (converts names to codes internally)
        print(f"\n[1/2] Reading employee data...")
        employees = reader.read_employees_bulk(tenant, self.uploader)

        if not employees:
            print("   No employees found in Excel")
            return {'created': 0, 'exists': 0, 'failed': 0}

        print(f"   Found {len(employees)} employees")

        # 2. Create employees via HRMS
        print(f"\n[2/2] Creating employees...")
        results = self.uploader.create_employees(
            employee_list=employees,
            tenant=tenant,
            sheet_name='Employee Master',
            excel_file=excel_path
        )

        self._print_summary("Employees", {'employees': results})
        return results

    def _print_summary(self, phase: str, results: Dict):
        """Print clean summary of results"""
        print(f"\n{'─'*40}")
        print(f"{phase} Summary:")

        total_created = 0
        total_exists = 0
        total_failed = 0

        for key, value in results.items():
            if value and isinstance(value, dict):
                created = value.get('created', 0)
                exists = value.get('exists', 0)
                failed = value.get('failed', 0)
                total_created += created
                total_exists += exists
                total_failed += failed

        print(f"   Created: {total_created}")
        print(f"   Already existed: {total_exists}")
        print(f"   Failed: {total_failed}")
        print(f"{'─'*40}")


# Convenience function for quick setup
def quick_start(url: str = "https://unified-dev.digit.org") -> CRSLoader:
    """Quick start - creates loader and prompts for login

    Args:
        url: DIGIT environment URL

    Returns:
        Authenticated CRSLoader instance
    """
    loader = CRSLoader(url)
    loader.login()
    return loader
