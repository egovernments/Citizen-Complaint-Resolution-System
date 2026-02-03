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
import requests

# kubectl API server URL (for environments without kubectl access)
KUBECTL_API_URL = os.environ.get('KUBECTL_API_URL', 'http://localhost:8765')
KUBECTL_API_KEY = os.environ.get('KUBECTL_API_KEY', 'dev-only-key')


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
                schema_code='tenant.branding',
                data_list=branding,
                tenant=target_tenant,
                sheet_name='Tenant Branding Details',
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
            action="create",
            excel_file=excel_path
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

    def load_localizations(self, excel_path: str, target_tenant: str = None,
                          language_label: str = None, locale_code: str = None) -> Dict:
        """Phase 5: Load bulk localization messages from Excel

        Args:
            excel_path: Path to localization Excel file
                       Must have 'Localization' or 'localization' sheet
                       Required columns: Code, Message, Locale (optional: Module)
            target_tenant: Target tenant ID
            language_label: Display name for new language (e.g., 'Hindi', 'ਪੰਜਾਬੀ')
                           If provided, updates StateInfo with this language
            locale_code: Locale code for new language (e.g., 'hi_IN', 'pa_IN')
                        Required if language_label is provided

        Returns:
            dict: Summary of localization upload and StateInfo update
        """
        self._check_auth()

        print(f"\n{'='*60}")
        print(f"PHASE 5: LOCALIZATIONS")
        print(f"{'='*60}")
        print(f"File: {os.path.basename(excel_path)}")

        tenant = target_tenant or self.tenant_id
        reader = UnifiedExcelReader(excel_path)
        results = {'messages': None, 'stateinfo': None}

        # 1. Read localization data from Excel
        print(f"\n[1/2] Reading localization data...")
        localization_data = reader.read_localization()

        if not localization_data:
            print("   No localization data found in Excel")
            print("   Make sure the Excel has a 'Localization' sheet with Code and Message columns")
            return results

        print(f"   Found {len(localization_data)} messages")

        # Show locale breakdown
        from collections import defaultdict
        by_locale = defaultdict(int)
        for loc in localization_data:
            by_locale[loc.get('locale', 'unknown')] += 1
        for locale, count in by_locale.items():
            print(f"   - {locale}: {count} messages")

        # 2. Upload localization messages
        print(f"\n[2/2] Uploading localization messages...")
        results['messages'] = self.uploader.create_localization_messages(
            localization_list=localization_data,
            tenant=tenant,
            sheet_name='Localization'
        )

        # 3. Optionally update StateInfo with new language
        if language_label and locale_code:
            print(f"\n[BONUS] Updating StateInfo with new language...")
            print(f"   Language: {language_label} ({locale_code})")
            results['stateinfo'] = self.uploader.update_stateinfo_language(
                language_label=language_label,
                language_value=locale_code,
                state_tenant=tenant
            )

        self._print_summary("Localizations", results)
        return results

    def delete_boundaries(self, target_tenant: str = None, use_db: bool = False) -> Dict:
        """Delete all boundary entities for a tenant

        Args:
            target_tenant: Tenant ID (e.g., 'statea', 'pg.citya')
            use_db: If True, use direct DB access (requires kubectl). Default: False (use API)

        Returns:
            dict: {deleted: int, relationships_deleted: int, status: str}
        """
        self._check_auth()
        tenant = target_tenant or self.tenant_id

        print(f"\n{'='*60}")
        print(f"DELETING BOUNDARIES")
        print(f"{'='*60}")
        print(f"Tenant: {tenant}")

        if use_db:
            return self._delete_boundaries_via_db(tenant)
        else:
            return self._delete_boundaries_via_api(tenant)

    def _delete_boundaries_via_api(self, tenant: str) -> Dict:
        """Delete boundaries using the boundary service API

        Fallback chain:
        1. Boundary service API (delete_all_boundaries)
        2. Direct kubectl DB access
        3. kubectl API server (for CI environments)
        """
        # Try boundary service API first
        result = self.uploader.delete_all_boundaries(tenant)

        deleted = result.get('deleted', 0)
        failed = result.get('failed', 0)

        # If API worked, return result
        if deleted > 0 or (deleted == 0 and failed == 0):
            print(f"   Boundaries deleted: {deleted}")
            print(f"   Failed: {failed}")
            print(f"{'='*60}")
            return {
                'deleted': deleted,
                'relationships_deleted': 0,
                'failed': failed,
                'status': 'success' if failed == 0 else 'partial'
            }

        # Try direct kubectl DB access
        print("   Boundary API didn't delete, trying DB method...")
        db_result = self._delete_boundaries_via_db(tenant)
        if db_result.get('status') == 'success':
            return db_result

        # Try kubectl API server (for CI without kubectl)
        if db_result.get('status') == 'skipped':
            print("   kubectl not available, trying kubectl API server...")
            return self._delete_boundaries_via_kubectl_api(tenant)

        return db_result

    def _delete_boundaries_via_db(self, tenant: str) -> Dict:
        """Delete boundaries using direct database access (requires kubectl)"""
        import subprocess

        # Database connection details
        db_host = "chakshu-pgr-db.czvokiourya9.ap-south-1.rds.amazonaws.com"
        db_name = "chakshupgrdb"
        db_user = "chakshupgr"

        # Get DB password from K8s secret
        pw_result = subprocess.run(
            ["kubectl", "get", "secret", "db", "-n", "egov", "-o", "jsonpath={.data.password}"],
            capture_output=True, text=True
        )

        if pw_result.returncode != 0:
            print("   WARNING: kubectl not available, cannot delete via DB")
            print(f"{'='*60}")
            return {'deleted': 0, 'relationships_deleted': 0, 'status': 'skipped',
                    'error': 'kubectl not available'}

        import base64
        db_pass = base64.b64decode(pw_result.stdout).decode()

        # Ensure cleanup pod exists
        subprocess.run(["kubectl", "delete", "pod", "db-cleanup", "-n", "egov", "--ignore-not-found"],
                      capture_output=True)
        subprocess.run(["kubectl", "run", "db-cleanup", "--image=postgres:15", "-n", "egov",
                       "--restart=Never", "--command", "--", "sleep", "3600"], capture_output=True)
        subprocess.run(["kubectl", "wait", "--for=condition=Ready", "pod/db-cleanup", "-n", "egov",
                       "--timeout=60s"], capture_output=True)

        conn_str = f"postgresql://{db_user}:{db_pass}@{db_host}:5432/{db_name}"

        # Delete relationships first, then boundaries
        result = subprocess.run(
            ["kubectl", "exec", "-n", "egov", "db-cleanup", "--",
             "psql", conn_str, "-t", "-c",
             f"DELETE FROM boundary_relationship WHERE tenantid='{tenant}'; "
             f"DELETE FROM boundary WHERE tenantid='{tenant}';"],
            capture_output=True, text=True
        )

        # Parse DELETE counts
        counts = [int(line.split()[1]) for line in result.stdout.strip().split('\n')
                  if line.strip().startswith('DELETE')]
        rel_deleted = counts[0] if len(counts) > 0 else 0
        deleted = counts[1] if len(counts) > 1 else 0

        print(f"   Relationships deleted: {rel_deleted}")
        print(f"   Boundaries deleted: {deleted}")
        print(f"{'='*60}")

        return {'deleted': deleted, 'relationships_deleted': rel_deleted, 'status': 'success'}

    def _delete_boundaries_via_kubectl_api(self, tenant: str, env: str = 'chakshu') -> Dict:
        """Delete boundaries using the kubectl API server (for CI environments)

        The kubectl API server wraps kubectl commands and exposes them via HTTP.
        Start it with: python kubectl_api.py
        Set KUBECTL_API_URL and KUBECTL_API_KEY environment variables.
        """
        try:
            response = requests.post(
                f"{KUBECTL_API_URL}/boundaries/delete",
                json={'tenant_id': tenant, 'env': env},
                headers={'X-API-Key': KUBECTL_API_KEY},
                timeout=120
            )

            if response.status_code == 200:
                data = response.json()
                deleted = data.get('boundaries_deleted', 0)
                rel_deleted = data.get('relationships_deleted', 0)
                print(f"   Boundaries deleted (via kubectl API): {deleted}")
                print(f"   Relationships deleted: {rel_deleted}")
                print(f"{'='*60}")
                return {
                    'deleted': deleted,
                    'relationships_deleted': rel_deleted,
                    'status': 'success'
                }
            else:
                error = response.json().get('error', response.text)
                print(f"   kubectl API error: {error}")
                return {'deleted': 0, 'relationships_deleted': 0, 'status': 'failed', 'error': error}

        except requests.exceptions.ConnectionError:
            print(f"   kubectl API server not available at {KUBECTL_API_URL}")
            return {'deleted': 0, 'relationships_deleted': 0, 'status': 'unavailable'}
        except Exception as e:
            print(f"   kubectl API error: {str(e)}")
            return {'deleted': 0, 'relationships_deleted': 0, 'status': 'error', 'error': str(e)}

    def delete_hierarchy(self, hierarchy_type: str, target_tenant: str = None) -> Dict:
        """Delete a boundary hierarchy definition

        Args:
            hierarchy_type: Hierarchy type (e.g., 'REVENUE', 'ADMIN')
            target_tenant: Tenant ID

        Returns:
            dict: {status: str, message: str}
        """
        self._check_auth()
        tenant = target_tenant or self.tenant_id
        return self.uploader.delete_boundary_hierarchy(tenant, hierarchy_type)

    def reset_boundaries(self, hierarchy_type: str = "REVENUE", target_tenant: str = None) -> Dict:
        """Full reset: delete all boundaries and hierarchy for a tenant

        Args:
            hierarchy_type: Hierarchy type to delete
            target_tenant: Tenant ID

        Returns:
            dict: Combined results
        """
        self._check_auth()
        tenant = target_tenant or self.tenant_id

        print(f"\n{'='*60}")
        print(f"RESETTING BOUNDARIES")
        print(f"{'='*60}")
        print(f"Tenant: {tenant}")
        print(f"Hierarchy: {hierarchy_type}")

        results = {}

        # 1. Delete boundaries
        results['boundaries'] = self.delete_boundaries(tenant)

        # 2. Delete hierarchy
        results['hierarchy'] = self.delete_hierarchy(hierarchy_type, tenant)

        print(f"\n{'─'*40}")
        print(f"Reset Complete")
        print(f"{'─'*40}")
        return results

    def delete_mdms(self, schema_code: str, target_tenant: str = None, unique_ids: list = None) -> Dict:
        """Delete MDMS data by setting isActive=false

        Args:
            schema_code: Schema code (e.g., 'common-masters.Department')
            target_tenant: Tenant ID
            unique_ids: Optional list of specific IDs to delete. If None, deletes all.

        Returns:
            dict: {deleted: count, failed: count, ...}
        """
        self._check_auth()
        tenant = target_tenant or self.tenant_id
        return self.uploader.delete_mdms_data(schema_code, tenant, unique_ids)

    def rollback_common_masters(self, target_tenant: str = None) -> Dict:
        """Rollback all common masters (departments, designations, complaint types)

        Args:
            target_tenant: Tenant ID

        Returns:
            dict: Results per schema
        """
        self._check_auth()
        tenant = target_tenant or self.tenant_id

        schemas = [
            'common-masters.Department',
            'common-masters.Designation',
            'RAINMAKER-PGR.ServiceDefs'
        ]
        return self.uploader.rollback_mdms_by_schema(schemas, tenant)

    def rollback_tenant(self, target_tenant: str = None) -> Dict:
        """Rollback tenant configuration (tenants, branding)

        Args:
            target_tenant: Tenant ID

        Returns:
            dict: Results per schema
        """
        self._check_auth()
        tenant = target_tenant or self.tenant_id

        schemas = [
            'tenant.tenants',
            'tenant.citymodule'
        ]
        return self.uploader.rollback_mdms_by_schema(schemas, tenant)

    def full_reset(self, hierarchy_type: str = "REVENUE", target_tenant: str = None) -> Dict:
        """Full reset: delete ALL data (MDMS + boundaries) for a tenant

        WARNING: This deletes everything! Use with caution.

        Args:
            hierarchy_type: Boundary hierarchy type
            target_tenant: Tenant ID

        Returns:
            dict: Combined results
        """
        self._check_auth()
        tenant = target_tenant or self.tenant_id

        print(f"\n{'='*60}")
        print(f"⚠️  FULL RESET - DELETING ALL DATA")
        print(f"{'='*60}")
        print(f"Tenant: {tenant}")

        results = {}

        # 1. Delete common masters
        print(f"\n[1/3] Deleting common masters...")
        results['common_masters'] = self.rollback_common_masters(tenant)

        # 2. Delete tenant config
        print(f"\n[2/3] Deleting tenant config...")
        results['tenant'] = self.rollback_tenant(tenant)

        # 3. Delete boundaries
        print(f"\n[3/3] Deleting boundaries...")
        results['boundaries'] = self.reset_boundaries(hierarchy_type, tenant)

        print(f"\n{'='*60}")
        print(f"FULL RESET COMPLETE")
        print(f"{'='*60}")
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
