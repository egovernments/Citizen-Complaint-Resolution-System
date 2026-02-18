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
import json
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

    @property
    def auth_token(self) -> str:
        """Get current auth token"""
        return self.uploader.auth_token if self.uploader else None

    @property
    def user_info(self) -> dict:
        """Get current user info"""
        return self.uploader.user_info if self.uploader else None

    def create_tenant(self, tenant_code: str, display_name: str = None,
                      enable_modules: list = None, users: list = None) -> bool:
        """Create a tenant if it doesn't exist

        Args:
            tenant_code: Tenant code (e.g., "statea.chakshu", "pg.citya")
            display_name: Display name (derived from code if not provided)
            enable_modules: List of modules to enable (default: ["PGR", "HRMS"])
            users: List of users to create for this tenant. Each user is a dict:
                   {"username": str, "password": str, "name": str, "roles": list,
                    "mobile": str (optional), "email": str (optional), "type": str (optional)}
                   Default roles: ["EMPLOYEE"]. Type defaults to "EMPLOYEE".

        Returns:
            bool: True if tenant exists or was created successfully

        Example:
            loader.login(username="ADMIN", password="eGov@123", tenant_id="pg")
            loader.create_tenant("statea.chakshu", "Chakshu State", users=[
                {"username": "ADMIN", "password": "eGov@123", "name": "Admin", "roles": ["SUPERUSER", "EMPLOYEE", "GRO", "DGRO"]},
                {"username": "GRO", "password": "eGov@123", "name": "GRO User", "roles": ["EMPLOYEE", "GRO", "DGRO"]}
            ])
        """
        self._check_auth()

        if enable_modules is None:
            enable_modules = ["PGR", "HRMS"]

        # Check if tenant exists
        search_url = f"{self.base_url}/mdms-v2/v1/_search"
        search_payload = {
            "MdmsCriteria": {
                "tenantId": "pg",
                "moduleDetails": [{"moduleName": "tenant", "masterDetails": [{"name": "tenants"}]}]
            },
            "RequestInfo": {"apiId": "Rainmaker"}
        }

        resp = requests.post(search_url, json=search_payload, headers={"Content-Type": "application/json"})
        existing_tenants = []
        if resp.ok:
            try:
                tenants = resp.json().get("MdmsRes", {}).get("tenant", {}).get("tenants", [])
                existing_tenants = [t.get("code", "").lower() for t in tenants]
            except:
                pass

        if tenant_code.lower() in existing_tenants:
            print(f"✅ Tenant '{tenant_code}' already exists")
            return True

        print(f"📝 Creating tenant '{tenant_code}'...")

        # Derive display name if not provided
        if not display_name:
            display_name = tenant_code.replace(".", " ").title()

        # Create tenant via MDMS v2 API
        create_url = f"{self.base_url}/mdms-v2/v2/_create/tenant.tenants"
        tenant_data = {
            "code": tenant_code,
            "name": display_name,
            "tenantId": tenant_code,
            "type": "CITY",
            "city": {
                "code": tenant_code.upper().replace(".", "_"),
                "name": display_name,
                "districtName": display_name
            }
        }

        create_payload = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info
            },
            "Mdms": {
                "tenantId": "pg",
                "schemaCode": "tenant.tenants",
                "data": tenant_data,
                "isActive": True
            }
        }

        resp = requests.post(create_url, json=create_payload, headers={"Content-Type": "application/json"})

        if resp.ok:
            print(f"✅ Tenant '{tenant_code}' created successfully!")

            # Enable modules for the tenant
            for module in enable_modules:
                self._enable_module_for_tenant(tenant_code, module)

            # Create users for the tenant
            if users:
                print(f"\n👥 Creating {len(users)} user(s) for tenant '{tenant_code}'...")
                for user_def in users:
                    self._create_user_for_tenant(tenant_code, user_def)

            return True
        else:
            print(f"❌ Failed to create tenant: {resp.status_code}")
            try:
                error = resp.json()
                # Check if it's a "already exists" error
                if "already exists" in str(error).lower() or "duplicate" in str(error).lower():
                    print(f"   (Tenant may already exist)")
                    return True
                print(f"   Error: {error}")
            except:
                print(f"   Response: {resp.text[:200]}")
            return False

    def _enable_module_for_tenant(self, tenant_code: str, module_code: str):
        """Add tenant to citymodule for a specific module (internal)

        Note: MDMS v2 API doesn't support updating unique fields or deleting records easily.
        This function updates the database directly via SQL if the API approach fails.
        """
        # Search for existing citymodule config
        search_url = f"{self.base_url}/mdms-v2/v1/_search"
        search_payload = {
            "MdmsCriteria": {
                "tenantId": "pg",
                "moduleDetails": [{"moduleName": "tenant", "masterDetails": [{"name": "citymodule"}]}]
            },
            "RequestInfo": {"apiId": "Rainmaker"}
        }

        resp = requests.post(search_url, json=search_payload, headers={"Content-Type": "application/json"})
        if not resp.ok:
            print(f"   ⚠️  Could not fetch citymodule config for {module_code}")
            return

        citymodules = resp.json().get("MdmsRes", {}).get("tenant", {}).get("citymodule", [])

        # Find the module config
        module_config = None
        for cm in citymodules:
            if cm.get("code") == module_code:
                module_config = cm
                break

        if not module_config:
            print(f"   ⚠️  Module '{module_code}' not found in citymodule")
            return

        # Check if tenant already in module
        existing_tenants = [t.get("code", "").lower() for t in module_config.get("tenants", [])]
        if tenant_code.lower() in existing_tenants:
            print(f"   ✅ {module_code} already enabled")
            return

        # Try database update via persister (if available)
        # This uses the internal MDMS database update
        try:
            self._update_citymodule_db(module_code, tenant_code, module_config)
        except Exception as e:
            print(f"   ⚠️  {module_code}: Add tenant manually to citymodule (MDMS v2 API limitation)")

    def _update_citymodule_db(self, module_code: str, tenant_code: str, current_config: dict):
        """Update citymodule via database query through boundary-service workaround"""
        import subprocess
        import json as json_lib

        # Add tenant to config
        new_tenants = current_config.get("tenants", []) + [{"code": tenant_code}]
        new_config = current_config.copy()
        new_config["tenants"] = new_tenants

        # Try to use psql to update directly (if running locally with Docker)
        try:
            module_code_escaped = module_code.replace("'", "''")
            json_payload = json_lib.dumps(new_config, separators=(',', ':'), ensure_ascii=False)

            dollar_tag = "$json$"
            while dollar_tag in json_payload:
                dollar_tag = f"${dollar_tag.strip('$')}_x$"

            # Construct SQL update
            sql = f"""
            UPDATE eg_mdms_data
            SET data = {dollar_tag}{json_payload}{dollar_tag}::jsonb,
                lastmodifiedtime = EXTRACT(EPOCH FROM NOW())::bigint * 1000
            WHERE schemacode = 'tenant.citymodule'
              AND tenantid = 'pg'
              AND data->>'code' = '{module_code_escaped}';
            """

            result = subprocess.run(
                ["docker", "exec", "docker-postgres", "psql", "-U", "egov", "-d", "egov", "-c", sql],
                capture_output=True, text=True, timeout=10
            )

            if result.returncode == 0 and "UPDATE 1" in result.stdout:
                print(f"   ✅ {module_code} enabled (via DB)")
            else:
                raise Exception(f"SQL update failed: {result.stderr or result.stdout}")

        except subprocess.TimeoutExpired:
            raise Exception("Database update timed out")
        except FileNotFoundError:
            raise Exception("Docker not available")
        except Exception as e:
            raise Exception(str(e))

    def _ensure_roles_exist(self, state_tenant: str, role_codes: list):
        """Ensure all required roles exist for the state tenant, create if missing

        Args:
            state_tenant: State-level tenant ID where roles should be defined
            role_codes: List of role codes to check/create
        """
        # Standard role definitions
        role_definitions = {
            "SUPERUSER": {"name": "Super User", "description": "System Administrator"},
            "EMPLOYEE": {"name": "Employee", "description": "Default role for all employees"},
            "GRO": {"name": "Grievance Routing Officer", "description": "One who will assess & assign complaints"},
            "DGRO": {"name": "Department GRO", "description": "Department Grievance Routing Officer"},
            "CSR": {"name": "Complainant", "description": "One who will create complaints"},
            "PGR_LME": {"name": "Complaint Resolver", "description": "One who will resolve complaints"},
            "CITIZEN": {"name": "Citizen", "description": "Citizen who can raise complaint"},
            "HRMS_ADMIN": {"name": "HRMS Admin", "description": "HRMS Admin"},
            "MDMS_ADMIN": {"name": "MDMS Admin", "description": "MDMS User that can create and search schema"},
        }

        # Get existing roles for the state tenant
        search_url = f"{self.base_url}/mdms-v2/v1/_search"
        search_payload = {
            "MdmsCriteria": {
                "tenantId": state_tenant,
                "moduleDetails": [{"moduleName": "ACCESSCONTROL-ROLES", "masterDetails": [{"name": "roles"}]}]
            },
            "RequestInfo": {"apiId": "Rainmaker"}
        }

        existing_roles = set()
        try:
            resp = requests.post(search_url, json=search_payload, headers={"Content-Type": "application/json"})
            if resp.ok:
                roles_data = resp.json().get("MdmsRes", {}).get("ACCESSCONTROL-ROLES", {}).get("roles", [])
                existing_roles = {r.get("code") for r in roles_data}
        except:
            pass

        # Find missing roles
        missing_roles = [r for r in role_codes if r not in existing_roles]

        if not missing_roles:
            return

        # Create missing roles via MDMS v2 API
        create_url = f"{self.base_url}/mdms-v2/v2/_create/ACCESSCONTROL-ROLES.roles"

        for role_code in missing_roles:
            role_def = role_definitions.get(role_code, {"name": role_code, "description": role_code})
            role_data = {
                "code": role_code,
                "name": role_def["name"],
                "description": role_def["description"]
            }

            create_payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "Mdms": {
                    "tenantId": state_tenant,
                    "schemaCode": "ACCESSCONTROL-ROLES.roles",
                    "data": role_data,
                    "isActive": True
                }
            }

            try:
                resp = requests.post(create_url, json=create_payload, headers={"Content-Type": "application/json"})
                if resp.ok:
                    print(f"   ✅ Created role '{role_code}' for tenant '{state_tenant}'")
                elif "already exists" in resp.text.lower() or "duplicate" in resp.text.lower():
                    pass  # Role already exists, skip silently
                else:
                    print(f"   ⚠️  Could not create role '{role_code}': {resp.text[:100]}")
            except Exception as e:
                print(f"   ⚠️  Error creating role '{role_code}': {str(e)}")

    def _create_user_for_tenant(self, tenant_code: str, user_def: dict):
        """Create a user for a specific tenant via egov-user API

        Args:
            tenant_code: Tenant ID for the user
            user_def: User definition dict with keys:
                - username (required): User's login name
                - password (required): User's password
                - name (optional): Display name (defaults to username)
                - roles (optional): List of role codes (defaults to ["EMPLOYEE"])
                - mobile (optional): Mobile number (defaults to "9999999999")
                - email (optional): Email address
                - type (optional): User type - "EMPLOYEE" or "CITIZEN" (defaults to "EMPLOYEE")
        """
        username = user_def.get("username")
        password = user_def.get("password")

        if not username or not password:
            print(f"   ⚠️  Skipping user - missing username or password")
            return

        name = user_def.get("name", username)
        roles = user_def.get("roles", ["EMPLOYEE"])
        mobile = user_def.get("mobile", "9999999999")
        email = user_def.get("email", f"{username.lower()}@digit.org")
        user_type = user_def.get("type", "EMPLOYEE")

        # Build roles array with state-level tenant ID (roles are defined at state level)
        # Extract state tenant: "statea.c" -> "statea", "pg.citya" -> "pg"
        state_tenant = tenant_code.split(".")[0] if "." in tenant_code else tenant_code

        # Ensure all required roles exist for the state tenant
        self._ensure_roles_exist(state_tenant, roles)

        roles_array = [
            {"code": role, "name": role, "tenantId": state_tenant}
            for role in roles
        ]

        # Create user via egov-user API
        create_url = f"{self.base_url}/user/users/_createnovalidate"
        user_payload = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info
            },
            "User": {
                "userName": username,
                "name": name,
                "mobileNumber": mobile,
                "emailId": email,
                "gender": "MALE",
                "active": True,
                "type": user_type,
                "tenantId": tenant_code,
                "password": password,
                "roles": roles_array
            }
        }

        try:
            resp = requests.post(create_url, json=user_payload, headers={"Content-Type": "application/json"})

            if resp.ok:
                result = resp.json()
                if result.get("User") or result.get("user"):
                    print(f"   ✅ User '{username}' created with roles: {roles}")
                    return

            # Check for duplicate user error
            error_text = resp.text.lower()
            if "duplicate" in error_text or "already exists" in error_text:
                print(f"   ℹ️  User '{username}' already exists")
                return

            print(f"   ❌ Failed to create user '{username}': {resp.status_code}")
            try:
                print(f"      Error: {resp.json()}")
            except:
                print(f"      Response: {resp.text[:200]}")

        except Exception as e:
            print(f"   ❌ Error creating user '{username}': {str(e)}")

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

        # 2. Create branding (StateInfo)
        print(f"\n[2/3] Creating branding (StateInfo)...")
        branding = reader.read_tenant_branding(target_tenant)

        if branding:
            results['branding'] = self.uploader.create_mdms_data(
                schema_code='common-masters.StateInfo',
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

    def load_hierarchy(self, name: str, levels: list, target_tenant: str = None,
                       output_dir: str = "upload") -> str:
        """Phase 2a: Create boundary hierarchy and generate template

        Creates a boundary hierarchy definition and generates a downloadable
        Excel template that can be filled with boundary data.

        Args:
            name: Hierarchy type name (e.g., "REVENUE", "ADMIN")
            levels: List of boundary level names from top to bottom
                   (e.g., ["State", "District", "Block", "Village"])
            target_tenant: Target tenant ID
            output_dir: Directory to save the template (default: "upload")

        Returns:
            str: Path to downloaded template file, or None if failed

        Example:
            template = loader.load_hierarchy(
                name="REVENUE",
                levels=["State", "District", "Block"],
                target_tenant="statea"
            )
        """
        self._check_auth()

        print(f"\n{'='*60}")
        print(f"PHASE 2a: BOUNDARY HIERARCHY & TEMPLATE")
        print(f"{'='*60}")

        tenant = target_tenant or self.tenant_id
        print(f"Tenant: {tenant}")
        print(f"Hierarchy: {name}")
        print(f"Levels: {' -> '.join(levels)}")

        # Ensure output directory exists
        os.makedirs(output_dir, exist_ok=True)

        # Step 1: Build hierarchy data structure
        print(f"\n[1/4] Building hierarchy definition...")
        boundary_hierarchy = []
        for i, level in enumerate(levels):
            level_data = {
                "boundaryType": level,
                "boundaryTypeHierarchyOrder": i + 1,
                "active": True
            }
            # Add parent reference for non-root levels
            if i > 0:
                level_data["parentBoundaryType"] = levels[i - 1]
            boundary_hierarchy.append(level_data)

        hierarchy_data = {
            "tenantId": tenant,
            "hierarchyType": name,
            "boundaryHierarchy": boundary_hierarchy
        }

        print(f"   Created {len(levels)} level definitions")

        # Step 2: Create hierarchy
        print(f"\n[2/4] Creating hierarchy...")
        try:
            result = self.uploader.create_boundary_hierarchy(hierarchy_data)
            if result.get('exists'):
                print(f"   Hierarchy already exists (OK)")
            else:
                print(f"   Hierarchy created successfully")
        except Exception as e:
            print(f"   ERROR: Failed to create hierarchy: {e}")
            return None

        # Step 3: Generate template
        print(f"\n[3/4] Generating template...")
        gen_result = self.uploader.generate_boundary_template(tenant, name)

        if not gen_result:
            print(f"   ERROR: Template generation failed")
            return None

        # Step 4: Poll for completion and download
        print(f"\n[4/4] Waiting for template...")
        poll_result = self.uploader.poll_boundary_template_status(tenant, name)

        if not poll_result or poll_result.get('status') == 'failed':
            print(f"   ERROR: Template generation failed")
            error = poll_result.get('error') if poll_result else 'Unknown error'
            print(f"   Details: {error}")
            return None

        filestore_id = poll_result.get('fileStoreid')
        if not filestore_id:
            print(f"   ERROR: No filestore ID returned")
            return None

        # Download template
        output_path = os.path.join(output_dir, f"Boundary_Template_{tenant}_{name}.xlsx")
        downloaded_path = self.uploader.download_boundary_template(
            tenant_id=tenant,
            filestore_id=filestore_id,
            hierarchy_type=name,
            output_path=output_path
        )

        if downloaded_path:
            print(f"\n{'─'*40}")
            print(f"Template downloaded: {downloaded_path}")
            print(f"{'─'*40}")
            print(f"\nNext steps:")
            print(f"1. Open {downloaded_path}")
            print(f"2. Fill in boundary data (codes and names)")
            print(f"3. Use loader.load_boundaries() to upload")
            return downloaded_path
        else:
            print(f"   ERROR: Failed to download template")
            return None

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

    def load_workflow(self, json_path: str, target_tenant: str = None,
                      business_service: str = "PGR") -> Dict:
        """Phase 6: Load/update workflow business service configuration from JSON file

        Args:
            json_path: Path to workflow JSON file (e.g., PgrWorkflowConfig.json)
                      The JSON should have a "BusinessServices" array with the workflow config.
            target_tenant: Target tenant ID
            business_service: Business service code (default: 'PGR')

        Returns:
            dict: {status: 'created'|'updated'|'exists'|'failed', error: str or None}
        """
        self._check_auth()

        print(f"\n{'='*60}")
        print(f"PHASE 6: WORKFLOW")
        print(f"{'='*60}")
        print(f"File: {os.path.basename(json_path)}")

        tenant = target_tenant or self.tenant_id
        print(f"Tenant: {tenant}")
        print(f"Business Service: {business_service}")

        # Load workflow config from JSON file
        print(f"\n[1/3] Loading workflow config from JSON...")
        workflow_config = self._load_workflow_from_json(json_path, tenant)

        if not workflow_config:
            return {'status': 'failed', 'error': 'Failed to load workflow config from JSON'}

        # Ensure business service code is set
        workflow_config['businessService'] = business_service
        print(f"   Loaded {len(workflow_config.get('states', []))} states")

        # Check if workflow already exists
        print(f"\n[2/3] Checking for existing workflow...")
        existing = self.uploader.search_workflow(tenant, business_service)

        if existing:
            print(f"   Found existing workflow: {existing.get('businessService')}")
            print(f"   States: {len(existing.get('states', []))}")

            # Check if we should update
            existing_states = len(existing.get('states', []))
            new_states = len(workflow_config.get('states', []))

            if existing_states == new_states:
                print(f"\n[3/3] Workflow already configured (same state count)")
                return {'status': 'exists', 'error': None, 'states': existing_states}

            # Update existing workflow
            print(f"\n[3/3] Updating workflow ({existing_states} -> {new_states} states)...")

            # Copy UUIDs from existing to new config for update
            workflow_config = self._merge_workflow_uuids(existing, workflow_config)

            result = self.uploader.update_workflow(tenant, workflow_config)

            if result.get('updated'):
                print(f"   Workflow updated successfully")
                return {'status': 'updated', 'error': None, 'states': new_states}
            else:
                print(f"   Update failed: {result.get('error')}")
                return {'status': 'failed', 'error': result.get('error')}

        else:
            # Create new workflow
            print(f"   No existing workflow found")
            print(f"\n[3/3] Creating workflow...")

            result = self.uploader.create_workflow(tenant, workflow_config)

            if result.get('created'):
                states = len(workflow_config.get('states', []))
                print(f"   Workflow created successfully ({states} states)")
                return {'status': 'created', 'error': None, 'states': states}
            else:
                print(f"   Create failed: {result.get('error')}")
                return {'status': 'failed', 'error': result.get('error')}

    def _load_workflow_from_json(self, json_path: str, tenant: str) -> Optional[Dict]:
        """Load workflow configuration from JSON file

        Args:
            json_path: Path to workflow JSON file
            tenant: Target tenant ID (replaces {tenantid} placeholders)

        Returns:
            BusinessService config dict, or None if failed
        """
        try:
            with open(json_path, 'r') as f:
                data = json.load(f)

            # Extract BusinessServices array
            business_services = data.get('BusinessServices', [])
            if not business_services:
                print(f"   ERROR: No BusinessServices found in JSON")
                return None

            # Get first business service config
            workflow_config = business_services[0]

            # Replace {tenantid} placeholders with actual tenant
            workflow_json = json.dumps(workflow_config)
            workflow_json = workflow_json.replace('{tenantid}', tenant)
            workflow_config = json.loads(workflow_json)

            return workflow_config

        except FileNotFoundError:
            print(f"   ERROR: File not found: {json_path}")
            return None
        except json.JSONDecodeError as e:
            print(f"   ERROR: Invalid JSON: {e}")
            return None
        except Exception as e:
            print(f"   ERROR: Failed to load workflow: {e}")
            return None

    def _merge_workflow_uuids(self, existing: Dict, new_config: Dict) -> Dict:
        """Merge UUIDs from existing workflow into new config for update

        The workflow service requires UUIDs to be preserved when updating.
        """
        # Copy top-level UUID
        if existing.get('uuid'):
            new_config['uuid'] = existing['uuid']

        # Build a map of state name -> state object from existing
        existing_states = {s.get('state'): s for s in existing.get('states', [])}

        # Merge UUIDs for matching states
        for new_state in new_config.get('states', []):
            state_name = new_state.get('state')
            if state_name in existing_states:
                old_state = existing_states[state_name]
                new_state['uuid'] = old_state.get('uuid')

                # Build action map for this state
                old_actions = {a.get('action'): a for a in old_state.get('actions', []) or []}

                # Merge action UUIDs
                for new_action in new_state.get('actions', []) or []:
                    action_name = new_action.get('action')
                    if action_name in old_actions:
                        new_action['uuid'] = old_actions[action_name].get('uuid')

        return new_config

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
