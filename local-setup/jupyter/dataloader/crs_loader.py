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

try:
    from .unified_loader import UnifiedExcelReader, APIUploader
except (ImportError, ModuleNotFoundError):
    from unified_loader import UnifiedExcelReader, APIUploader
from typing import Optional, Dict
from copy import deepcopy
import os
import json
import requests
import time

REQUEST_TIMEOUT = 30  # seconds - prevent indefinite hangs on unresponsive services

try:
    from .telemetry import send_event as _send_telemetry
except Exception:
    try:
        from telemetry import send_event as _send_telemetry
    except Exception:
        def _send_telemetry(*a, **kw): pass

# kubectl API server URL (for environments without kubectl access)
KUBECTL_API_URL = os.environ.get('KUBECTL_API_URL', 'http://localhost:8765')
KUBECTL_API_KEY = os.environ.get('KUBECTL_API_KEY', 'dev-only-key')


class CRSLoader:
    """Simple wrapper for CRS Data Loading operations"""

    def __init__(self, base_url: str, auto_detect_root: bool = True):
        """Initialize CRS Loader with DIGIT environment URL

        Args:
            base_url: DIGIT gateway URL (e.g., "https://unified-dev.digit.org")
            auto_detect_root: If True, automatically detects and uses the correct root tenant
        """
        self.base_url = base_url.rstrip('/')
        self.uploader: Optional[APIUploader] = None
        self.tenant_id: Optional[str] = None
        self._authenticated = False
        self.auto_detect_root = auto_detect_root
        self._root_tenant_cache = {}  # Cache for root tenant detection

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

        Automatically bootstraps new tenant roots. When creating a tenant like
        "ethiopia.kenya", detects that "ethiopia" is a new root (not "pg") and
        copies all required schema definitions and essential MDMS data from "pg"
        before creating the tenant.

        Args:
            tenant_code: Tenant code (e.g., "pg.citya", "ethiopia.kenya")
            display_name: Display name (derived from code if not provided)
            enable_modules: List of modules to enable (default: ["PGR", "HRMS"])
            users: List of users to create for this tenant. Each user is a dict:
                   {"username": str, "password": str, "name": str, "roles": list,
                    "mobile": str (optional), "email": str (optional), "type": str (optional)}
                   Default roles: ["EMPLOYEE"]. Type defaults to "EMPLOYEE".

        Returns:
            bool: True if tenant exists/was created and StateInfo is present

        Example:
            loader.login(username="ADMIN", password="eGov@123", tenant_id="pg")
            loader.create_tenant("statea.chakshu", "Chakshu State", users=[
                {"username": "ADMIN", "password": "eGov@123", "name": "Admin", "roles": ["SUPERUSER", "EMPLOYEE", "GRO", "DGRO"]},
                {"username": "GRO", "password": "eGov@123", "name": "GRO User", "roles": ["EMPLOYEE", "GRO", "DGRO"]}
            ])
        """
        self._check_auth()
        _send_telemetry("dataloader", "create", "tenant")

        if enable_modules is None:
            enable_modules = ["PGR", "HRMS"]

        # Determine root tenant: "ethiopia.kenya" -> "ethiopia", "pg.citya" -> "pg"
        root_tenant = tenant_code.split(".")[0] if "." in tenant_code else tenant_code

        # Check if tenant exists (search under both pg and the target root)
        existing_tenants = set()
        for search_root in {self.tenant_id, root_tenant}:
            records = self.uploader.search_mdms_data(
                schema_code='tenant.tenants', tenant=search_root, limit=500
            )
            for r in records:
                code = r.get('code', '')
                if code:
                    existing_tenants.add(code.lower())

        if tenant_code.lower() in existing_tenants:
            print(f"✅ Tenant '{tenant_code}' already exists")
            return self._ensure_stateinfo_for_tenant(tenant_code, display_name)

        print(f"📝 Creating tenant '{tenant_code}'...")

        # Derive display name if not provided
        if not display_name:
            display_name = tenant_code.replace(".", " ").title()

        # Check if this is a new root tenant and bootstrap it if needed
        session_root = self.tenant_id.split(".")[0] if "." in self.tenant_id else self.tenant_id
        if root_tenant != session_root:
            print(f"🔧 New root tenant detected: '{root_tenant}' (different from session root '{session_root}')")
            # Check if root tenant schemas exist by trying to search for tenant.tenants
            try:
                root_check = self.uploader.search_mdms_data(
                    schema_code='tenant.tenants', tenant=root_tenant, limit=1
                )
                if not root_check:  # No data means schemas don't exist, need bootstrap
                    print(f"🚀 Bootstrapping new root tenant '{root_tenant}'...")
                    if not self._bootstrap_tenant_root(root_tenant, source_tenant=session_root):
                        print(f"❌ Failed to bootstrap root tenant '{root_tenant}'")
                        return False
                    print(f"✅ Root tenant '{root_tenant}' bootstrapped successfully")
                else:
                    print(f"✅ Root tenant '{root_tenant}' already bootstrapped")
            except Exception as e:
                print(f"🚀 Root tenant '{root_tenant}' needs bootstrapping (search failed: {str(e)[:50]})")
                if not self._bootstrap_tenant_root(root_tenant, source_tenant=session_root):
                    print(f"❌ Failed to bootstrap root tenant '{root_tenant}'")
                    return False
                print(f"✅ Root tenant '{root_tenant}' bootstrapped successfully")
        else:
            print(f"✅ Using existing root tenant: '{session_root}'")

        # Create tenant record under its own root
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
                "tenantId": root_tenant,  # Create tenant under its own root, not hardcoded "pg"
                "schemaCode": "tenant.tenants",
                "data": tenant_data,
                "isActive": True
            }
        }

        resp = requests.post(create_url, json=create_payload, headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)

        if resp.ok:
            print(f"✅ Tenant '{tenant_code}' created successfully!")

            # Ensure tenant has branding metadata used by UI localization bootstrap
            if not self._ensure_stateinfo_for_tenant(tenant_code, display_name):
                print(f"❌ Failed to ensure StateInfo for '{tenant_code}'")
                return False

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

    def _bootstrap_tenant_root(self, target_root: str, source_tenant: str = "pg") -> bool:
        """Bootstrap a new tenant root by copying schemas and essential data from an existing root.

        When creating a tenant like "ethiopia.kenya", the "ethiopia" root needs all
        MDMS schema definitions and essential data (departments, designations, roles,
        ID formats, etc.) before any services can operate on it.

        This mirrors the MCP server's tenant_bootstrap tool.

        Args:
            target_root: New root tenant to bootstrap (e.g., "ethiopia")
            source_tenant: Existing root to copy from (default: "pg")

        Returns:
            bool: True if bootstrap succeeded
        """
        print(f"\n🔧 Bootstrapping new tenant root '{target_root}' from '{source_tenant}'...")
        
        # Update localStorage to set the new root tenant for UI rendering
        print(f"   📝 Setting STATE_LEVEL_TENANT_ID to '{target_root}' for UI rendering...")
        try:
            import os
            # This would be used by frontend applications to detect the current root tenant
            os.environ['STATE_LEVEL_TENANT_ID'] = target_root
            print(f"   ✓ Environment variable STATE_LEVEL_TENANT_ID set to '{target_root}'")
            
            # Also update globalConfigs.js for persistent UI configuration
            self._update_global_config_tenant(target_root)
            
        except Exception as e:
            print(f"   ⚠️  Could not set environment variable: {e}")

        # Step 1: Copy all schema definitions from source to target
        schema_search_url = f"{self.base_url}/mdms-v2/schema/v1/_search"
        schema_create_url = f"{self.base_url}/mdms-v2/schema/v1/_create"

        search_payload = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info
            },
            "SchemaDefCriteria": {
                "tenantId": source_tenant,
                "limit": 500,
                "offset": 0
            }
        }

        resp = requests.post(schema_search_url, json=search_payload,
                             headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
        if not resp.ok:
            print(f"   ❌ Failed to fetch schemas from '{source_tenant}': {resp.status_code}")
            return False

        schemas = resp.json().get("SchemaDefinitions", [])
        copied = 0
        skipped = 0
        failed = 0

        for schema in schemas:
            code = schema.get("code", "")
            create_payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "SchemaDefinition": {
                    "tenantId": target_root,
                    "code": code,
                    "description": schema.get("description", code),
                    "definition": schema.get("definition", {})
                }
            }
            try:
                r = requests.post(schema_create_url, json=create_payload,
                                  headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
                if r.ok:
                    copied += 1
                elif any(kw in r.text.lower() for kw in ["duplicate", "already exists", "unique"]):
                    skipped += 1
                else:
                    failed += 1
            except Exception:
                failed += 1

        print(f"   📋 Schemas: {copied} copied, {skipped} already existed, {failed} failed (of {len(schemas)} total)")

        if failed > 0:
            print(f"   ⚠️  Some schemas failed but continuing — non-critical schemas may be optional")
            
        # Wait for schema propagation before creating data
        if copied > 0:
            print(f"   ⏳ Waiting 10 seconds for schema propagation...")
            import time
            time.sleep(10)

        # Step 1.5: Create essential schemas that might be missing
        essential_schemas_to_create = {
            "common-masters.StateInfo": {
                "type": "object",
                "title": "State Information",
                "$schema": "http://json-schema.org/draft-07/schema#",
                "required": ["code", "name"],
                "x-unique": ["code"],
                "properties": {
                    "code": {"type": "string"},
                    "name": {"type": "string"},
                    "logoId": {"type": ["string", "null"]},
                    "bannerUrl": {"type": ["string", "null"]},
                    "hasLocalisation": {"type": "boolean"},
                    "defaultUrl": {"type": ["string", "null"]},
                    "localizationModules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "code": {"type": "string"},
                                "message": {"type": "string"}
                            }
                        }
                    },
                    "languages": {
                        "type": "array", 
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "value": {"type": "string"}
                            }
                        }
                    }
                }
            },
            "boundary-v2.BoundaryType": {
                "type": "object",
                "title": "Boundary Type",
                "$schema": "http://json-schema.org/draft-07/schema#",
                "required": ["code", "name", "hierarchyType"],
                "x-unique": ["code"],
                "properties": {
                    "code": {"type": "string"},
                    "name": {"type": "string"},
                    "hierarchyType": {"type": "string"},
                    "parent": {"type": ["string", "null"]},
                    "active": {"type": "boolean"}
                }
            },
            "boundary-v2.HierarchyType": {
                "type": "object", 
                "title": "Hierarchy Type",
                "$schema": "http://json-schema.org/draft-07/schema#",
                "required": ["code", "name"],
                "x-unique": ["code"],
                "properties": {
                    "code": {"type": "string"},
                    "name": {"type": "string"},
                    "active": {"type": "boolean"}
                }
            },
            "project-factory.CampaignType": {
                "type": "object",
                "title": "Campaign Type", 
                "$schema": "http://json-schema.org/draft-07/schema#",
                "required": ["code", "name"],
                "x-unique": ["code"],
                "properties": {
                    "code": {"type": "string"},
                    "name": {"type": "string"},
                    "active": {"type": "boolean"},
                    "description": {"type": ["string", "null"]}
                }
            }
        }
        
        for schema_code, definition in essential_schemas_to_create.items():
            create_payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "SchemaDefinition": {
                    "tenantId": target_root,
                    "code": schema_code,
                    "description": f"Essential schema: {schema_code}",
                    "definition": definition
                }
            }
            try:
                r = requests.post(schema_create_url, json=create_payload,
                                  headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
                if r.ok:
                    print(f"   ✅ Created essential schema: {schema_code}")
                elif any(kw in r.text.lower() for kw in ["duplicate", "already exists", "unique"]):
                    pass  # Already exists, fine
                else:
                    print(f"   ⚠️  Failed to create schema {schema_code}: {r.text[:100]}")
            except Exception as e:
                print(f"   ⚠️  Error creating schema {schema_code}: {e}")
                
        # Additional wait after essential schema creation
        print(f"   ⏳ Waiting 5 more seconds after essential schema creation...")
        import time
        time.sleep(5)

        # Step 1.6: Create essential boundary data for template generation
        essential_boundary_data = [
            {
                "schema_code": "boundary-v2.HierarchyType",
                "data": [
                    {"code": "ADMIN", "name": "Administrative", "active": True}
                ]
            },
            {
                "schema_code": "boundary-v2.BoundaryType", 
                "data": [
                    {"code": "State", "name": "State", "hierarchyType": "ADMIN", "active": True},
                    {"code": "District", "name": "District", "hierarchyType": "ADMIN", "parent": "State", "active": True},
                    {"code": "Locality", "name": "Locality", "hierarchyType": "ADMIN", "parent": "District", "active": True}
                ]
            },
            {
                "schema_code": "project-factory.CampaignType",
                "data": [
                    {"code": "BOUNDARY_SETUP", "name": "Boundary Setup Campaign", "active": True, "description": "Campaign for boundary template generation"}
                ]
            }
        ]
        
        for boundary_item in essential_boundary_data:
            try:
                result = self.uploader.create_mdms_data(
                    schema_code=boundary_item["schema_code"], 
                    data_list=boundary_item["data"], 
                    tenant=target_root
                )
                created = result.get('created', 0)
                if created > 0:
                    print(f"   ✅ Created {created} {boundary_item['schema_code']} records")
                else:
                    print(f"   ⚠️  {boundary_item['schema_code']} records already exist")
            except Exception as e:
                print(f"   ⚠️  Error creating {boundary_item['schema_code']} data: {e}")

        # Step 2: Create root self-record (required by idgen for city code resolution)
        root_data = {
            "code": target_root,
            "name": target_root.title(),
            "description": f"State tenant root: {target_root}",
            "city": {
                "code": target_root.upper(),
                "name": target_root.title(),
                "districtCode": target_root.upper(),
                "districtName": target_root.title()
            }
        }
        result = self.uploader.create_mdms_data(
            schema_code='tenant.tenants', data_list=[root_data], tenant=target_root
        )
        root_created = result.get('created', 0) + result.get('exists', 0)
        if root_created > 0:
            print(f"   ✅ Root tenant record created for '{target_root}'")
        else:
            print(f"   ❌ Could not create root tenant record (required for ID generation)")
            return False

        # Step 3: Copy essential MDMS data records from source
        essential_schemas = [
            'common-masters.IdFormat',          # ID generation patterns
            'common-masters.Department',        # Department hierarchy
            'common-masters.Designation',       # Employee designations  
            'common-masters.GenderType',        # Gender types
            'common-masters.StateInfo',         # UI branding and localization
            'egov-hrms.EmployeeStatus',        # HR configurations
            'egov-hrms.EmployeeType',
            'egov-hrms.DeactivationReason',
            'ACCESSCONTROL-ROLES.roles',       # User roles and permissions
            'RAINMAKER-PGR.ServiceDefs',       # Complaint type definitions
            'tenant.citymodule',               # CRITICAL: Copy citymodule configs for all modules
            'tenant.tenants',                  # Tenant registry
            'DataSecurity.EncryptionPolicy',   # Data security configurations
            'DataSecurity.DecryptionABAC',
            'DataSecurity.MaskingPatterns',
        ]

        data_copied = 0
        data_skipped = 0
        for schema_code in essential_schemas:
            records = self.uploader.search_mdms_data(
                schema_code=schema_code, tenant=source_tenant, limit=500
            )
            if not records:
                continue

            # Strip internal fields before copying
            clean_records = []
            for r in records:
                rec = {k: v for k, v in r.items() if not k.startswith('_')}
                
                # Special handling for tenant.citymodule: initialize with empty tenants for new root
                if schema_code == 'tenant.citymodule':
                    rec['tenants'] = []  # Start with empty tenant list for new root
                    print(f"   🔄 Initializing empty citymodule '{rec.get('code', 'unknown')}' for root '{target_root}'")
                
                clean_records.append(rec)

            result = self.uploader.create_mdms_data(
                schema_code=schema_code, data_list=clean_records, tenant=target_root
            )
            data_copied += result.get('created', 0)
            data_skipped += result.get('exists', 0)

        print(f"   📦 Data: {data_copied} records copied, {data_skipped} already existed")

        # Step 3.5: Copy ID generation formats to new root tenant
        print(f"   🔧 Copying ID generation formats...")
        try:
            idgen_copy_result = self._copy_idgen_formats(source_tenant, target_root)
            created = idgen_copy_result.get('created', 0)
            error = idgen_copy_result.get('error')
            
            if created > 0:
                print(f"   ✅ ID formats: {created} formats copied")
            elif error:
                print(f"   ⚠️  ID formats: {error}")
            else:
                print(f"   ℹ️  ID formats: No new formats needed (may already exist)")
        except Exception as e:
            print(f"   ⚠️  ID formats copy failed: {str(e)[:100]}")

        # Step 3.6: Create core admin user for new root tenant  
        print(f"   👤 Creating core admin user...")
        try:
            admin_result = self._create_core_admin_user(target_root)
            if admin_result:
                print(f"   ✅ Admin user created for root '{target_root}'")
            else:
                print(f"   ⚠️  Admin user may already exist")
        except Exception as e:
            print(f"   ⚠️  Admin user creation failed: {str(e)[:100]}")

        # Step 4: Skip workflow business service copying for root tenant
        # Root tenants don't need workflow business services - only child tenants do
        print(f"   ℹ️  Skipping workflow services for root tenant '{target_root}' (child tenants will get them)")

        # Step 5: Copy localization messages
        print(f"   🔧 Copying localization messages...")
        self._copy_localization_messages(source_tenant, target_root)

        # Step 6: Update global config placeholder
        print(f"   🔧 Updating global config for UI...")
        self._update_global_config_tenant(target_root)

        print(f"   ✅ Bootstrap complete for '{target_root}'\n")
        print(f"   💡 To use the new tenant in UI, restart: tilt up")
        return True

    def _copy_idgen_formats(self, source_tenant: str, target_root: str) -> Dict:
        """Copy ID generation formats from pg to new root tenant using direct DB connection"""
        try:
            import psycopg2
            
            # Database connection using Docker service name
            conn = psycopg2.connect(
                host="postgres-db",
                port="5432", 
                database="egov",
                user="egov",
                password="egov123"
            )
            
            with conn:
                with conn.cursor() as cur:
                    # Copy ID formats with proper tenant substitution
                    copy_sql = """
                    INSERT INTO id_generator (idname, tenantid, format, sequencenumber)
                    SELECT 
                        idname, 
                        %s as tenantid,
                        CASE 
                            WHEN format LIKE '%%PB-%%' THEN REPLACE(format, 'PB-', %s || '-')
                            ELSE format 
                        END as format,
                        1 as sequencenumber
                    FROM id_generator 
                    WHERE tenantid = %s
                    ON CONFLICT (idname, tenantid) DO NOTHING;
                    """
                    
                    cur.execute(copy_sql, (target_root, target_root.upper(), source_tenant))
                    
                    # Get count of copied formats
                    cur.execute("SELECT COUNT(*) FROM id_generator WHERE tenantid = %s", (target_root,))
                    actual_count = cur.fetchone()[0]
                    
                    print(f"   ✅ Copied ID formats from '{source_tenant}' to '{target_root}' (total: {actual_count})")
                    return {'created': actual_count}
                    
        except ImportError:
            print(f"   ⚠️  psycopg2 not available, skipping ID format copy")
            return {'created': 0, 'error': 'psycopg2 not installed'}
        except Exception as e:
            print(f"   ⚠️  ID format copy failed: {str(e)[:100]}")
            return {'created': 0, 'error': f'ID format copy failed: {str(e)}'}

    def _copy_localization_messages(self, source_tenant: str, target_root: str):
        """Copy localization messages from source tenant to target root tenant"""
        try:
            import psycopg2
            
            conn = psycopg2.connect(
                host="postgres-db",
                port="5432", 
                database="egov",
                user="egov",
                password="egov123"
            )
            
            with conn:
                with conn.cursor() as cur:
                    # Get count before copy for reference
                    cur.execute("SELECT COUNT(*) FROM message WHERE tenantid = %s", (target_root,))
                    before_count = cur.fetchone()[0]
                    
                    # Copy all localization messages with correct column names
                    copy_sql = """
                    INSERT INTO message (id, locale, code, message, tenantid, module, createdby, createddate, lastmodifiedby, lastmodifieddate)
                    SELECT 
                        gen_random_uuid() as id,
                        locale,
                        code, 
                        message,
                        %s as tenantid,
                        module,
                        createdby,
                        now() as createddate,
                        lastmodifiedby,
                        now() as lastmodifieddate
                    FROM message 
                    WHERE tenantid = %s
                    ON CONFLICT (tenantid, locale, module, code) DO NOTHING;
                    """
                    
                    cur.execute(copy_sql, (target_root, source_tenant))
                    copied_count = cur.rowcount
                    
                    # Get final count
                    cur.execute("SELECT COUNT(*) FROM message WHERE tenantid = %s", (target_root,))
                    after_count = cur.fetchone()[0]
                    
                    # Show modules copied
                    cur.execute("SELECT DISTINCT module FROM message WHERE tenantid = %s ORDER BY module", (target_root,))
                    modules = [row[0] for row in cur.fetchall()]
                    
                    print(f"   ✅ Localization: {copied_count} new messages copied to '{target_root}'")
                    print(f"   📊 Total messages: {after_count} across {len(modules)} modules")
                    print(f"   📦 Modules: {', '.join(modules)}")

        except Exception as e:
            print(f"   ⚠️  Localization copy failed: {str(e)[:100]}")

    def _create_core_admin_user(self, target_root: str) -> bool:
        """Create core admin user for new root tenant
        
        Creates ADMIN user with SUPERUSER, EMPLOYEE roles for basic system operations
        """
        try:
            # Create core roles first if they don't exist
            core_roles = [
                {"code": "SUPERUSER", "name": "Super User", "description": "System Administrator"},
                {"code": "EMPLOYEE", "name": "Employee", "description": "Default role for all employees"},
                {"code": "CITIZEN", "name": "Citizen", "description": "Citizen who can raise complaints"}
            ]
            
            self._ensure_roles_exist(target_root, [r['code'] for r in core_roles])
            
            # Create admin user
            admin_user = {
                "username": "ADMIN",
                "password": "eGov@123",  # Default password
                "name": "Administrator", 
                "mobile": "9999999999",
                "roles": ["SUPERUSER", "EMPLOYEE"],
                "type": "EMPLOYEE"
            }
            
            self._create_user_for_tenant(target_root, admin_user)
            return True
            
        except Exception as e:
            print(f"   Error creating admin user: {str(e)}")
            return False

    def _update_global_config_tenant(self, target_root: str):
        """Store the new root tenant in a config file that globalConfigs.js can read
        
        Creates/updates nginx/current-tenant.json with the active root tenant
        """
        try:
            import os
            import json
            
            # Create a simple config file to store current tenant
            config_dir = os.path.join(os.path.dirname(__file__), '../../nginx')
            tenant_config_path = os.path.join(config_dir, 'current-tenant.json')
            
            # Ensure directory exists
            os.makedirs(config_dir, exist_ok=True)
            
            # Store current tenant info
            tenant_config = {
                "currentRootTenant": target_root,
                "updatedAt": int(time.time() * 1000),
                "updatedBy": "crs_loader"
            }
            
            with open(tenant_config_path, 'w') as f:
                json.dump(tenant_config, f, indent=2)
                
            print(f"   ✅ Stored current root tenant '{target_root}' in nginx/current-tenant.json")
            print(f"   💡 GlobalConfigs.js can now read this file to get the active tenant")
            return True
            
        except Exception as e:
            print(f"   ⚠️  Could not store tenant config: {str(e)}")
            return False

    def _ensure_stateinfo_for_tenant(self, tenant_code: str, display_name: str = None) -> bool:
        """Ensure common-masters.StateInfo exists for tenant.

        DIGIT UI depends on StateInfo (especially localizationModules/languages)
        during login/bootstrap. Missing StateInfo can lead to raw i18n codes in UI.
        """
        # Already present for tenant -> nothing to do
        existing_records = self.uploader.search_mdms_data(
            schema_code='common-masters.StateInfo',
            tenant=tenant_code,
            limit=5
        )
        existing = any((r.get('code') or '').lower() == tenant_code.lower() for r in existing_records)
        if existing:
            print(f"   ✅ StateInfo already present for '{tenant_code}'")
            return True

        # Try to clone a baseline template from parent/root tenants
        candidate_tenants = []
        parent_tenant = tenant_code.split('.')[0] if '.' in tenant_code else tenant_code
        for candidate in [parent_tenant, self.tenant_id, "pg"]:
            if candidate and candidate not in candidate_tenants:
                candidate_tenants.append(candidate)

        template = None
        for candidate in candidate_tenants:
            records = self.uploader.search_mdms_data(
                schema_code='common-masters.StateInfo',
                tenant=candidate,
                limit=5
            )
            if records:
                matched = next((r for r in records if (r.get('code') or '').lower() == candidate.lower()), None)
                template = matched or records[0]
                break

        if not template:
            print(f"   ⚠️  Could not find a StateInfo template in tenants: {candidate_tenants}")
            print("   ⚠️  Run load_tenant() with Tenant And Branding Master to create branding manually.")
            return False

        stateinfo = deepcopy(template)
        stateinfo.pop('_isActive', None)
        stateinfo.pop('_uniqueIdentifier', None)
        stateinfo['code'] = tenant_code
        if display_name:
            stateinfo['name'] = display_name

        result = self.uploader.create_mdms_data(
            schema_code='common-masters.StateInfo',
            data_list=[stateinfo],
            tenant=tenant_code
        )
        created = result.get('created', 0)
        exists = result.get('exists', 0)
        if created > 0 or exists > 0:
            print(f"   ✅ StateInfo ensured for '{tenant_code}'")
            return True

        print(f"   ❌ Failed to create StateInfo for '{tenant_code}'")
        return False

    def _enable_module_for_tenant(self, tenant_code: str, module_code: str):
        """Add tenant to citymodule for a specific module
        
        Simple logic:
        1. Extract root from tenant_code (e.g., nitish.man -> nitish)
        2. Check if citymodule exists for this root
        3. If exists: append tenant to existing citymodule
        4. If not exists: create new citymodule entry with this tenant
        """
        root_tenant = tenant_code.split(".")[0] if "." in tenant_code else tenant_code
        
        print(f"   🔧 Adding '{tenant_code}' to {module_code} citymodule under root '{root_tenant}'")
        
        try:
            import psycopg2
            
            conn = psycopg2.connect(
                host="postgres-db",
                port="5432", 
                database="egov",
                user="egov",
                password="egov123"
            )
            
            with conn:
                with conn.cursor() as cur:
                    # Check if citymodule exists for this root and module
                    check_sql = """
                    SELECT COUNT(*) FROM eg_mdms_data 
                    WHERE tenantid = %s 
                      AND schemacode = 'tenant.citymodule' 
                      AND data->>'code' = %s;
                    """
                    
                    cur.execute(check_sql, (root_tenant, module_code))
                    citymodule_exists = cur.fetchone()[0] > 0
                    
                    if citymodule_exists:
                        # Append tenant to existing citymodule
                        update_sql = """
                        UPDATE eg_mdms_data
                        SET data = jsonb_set(
                            data, 
                            '{tenants}', 
                            COALESCE(data->'tenants', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('code', %s))
                        ),
                        lastmodifiedtime = EXTRACT(EPOCH FROM NOW())::bigint * 1000
                        WHERE tenantid = %s 
                          AND schemacode = 'tenant.citymodule'
                          AND data->>'code' = %s
                          AND NOT (data->'tenants' @> jsonb_build_array(jsonb_build_object('code', %s)));
                        """
                        
                        cur.execute(update_sql, (tenant_code, root_tenant, module_code, tenant_code))
                        
                        if cur.rowcount > 0:
                            print(f"   ✅ {module_code}: Added '{tenant_code}' to existing citymodule")
                        else:
                            print(f"   ℹ️  {module_code}: '{tenant_code}' already exists in citymodule")
                            
                    else:
                        # Create new citymodule entry for this root with the tenant
                        import json
                        citymodule_data = {
                            "code": module_code,
                            "module": module_code, 
                            "active": True,
                            "order": 2,
                            "tenants": [{"code": tenant_code}]
                        }
                        
                        insert_sql = """
                        INSERT INTO eg_mdms_data (
                            id, tenantid, uniqueidentifier, schemacode, data, isactive, 
                            createdby, lastmodifiedby, createdtime, lastmodifiedtime
                        ) VALUES (
                            gen_random_uuid(),
                            %s,
                            %s,
                            'tenant.citymodule',
                            %s,
                            true,
                            'system',
                            'system',
                            EXTRACT(EPOCH FROM NOW())::bigint * 1000,
                            EXTRACT(EPOCH FROM NOW())::bigint * 1000
                        );
                        """
                        
                        cur.execute(insert_sql, (root_tenant, module_code, json.dumps(citymodule_data)))
                        print(f"   ✅ {module_code}: Created new citymodule for root '{root_tenant}' with '{tenant_code}'")
                    
        except Exception as e:
            print(f"   ⚠️  {module_code}: Citymodule update failed - {str(e)[:100]}")


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
            resp = requests.post(search_url, json=search_payload, headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
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
                resp = requests.post(create_url, json=create_payload, headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
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
            resp = requests.post(create_url, json=user_payload, headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)

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

        # Step 3: Generate template (with fallback)
        print(f"\n[3/4] Generating template...")
        
        # First ensure we have the boundary schemas needed
        root_tenant = tenant.split('.')[0]
        
        # Check if boundary schemas exist, if not create them
        try:
            # Create boundary campaign type if missing
            campaign_data = [{
                "code": "BOUNDARY_SETUP",
                "name": "Boundary Setup Campaign",
                "active": True,
                "description": "Campaign for boundary template generation"
            }]
            
            self.uploader.create_mdms_data(
                schema_code="project-factory.CampaignType",
                data_list=campaign_data,
                tenant=root_tenant
            )
            print(f"   ✅ Ensured campaign type schema exists")
            
        except Exception as e:
            print(f"   ⚠️  Could not create campaign schema: {e}")
        
        # Try template generation
        try:
            gen_result = self.uploader.generate_boundary_template(tenant, name)
            if not gen_result:
                print(f"   ❌ Boundary service template generation failed")
                print(f"   💡 WORKAROUND: Create Excel manually with columns: Code | Name | Type | Parent")
                print(f"   📝 Example for {root_tenant}:")
                print(f"      {root_tenant.upper()}_STATE | {root_tenant.title()} State | State | ")
                if len(levels) > 1:
                    print(f"      {root_tenant.upper()}_DISTRICT | {root_tenant.title()} District | {levels[1]} | {root_tenant.upper()}_STATE")
                if len(levels) > 2:
                    print(f"      {root_tenant.upper()}_LOCALITY | {root_tenant.title()} Locality | {levels[2]} | {root_tenant.upper()}_DISTRICT")
                return None
                
        except Exception as e:
            print(f"   ❌ Template generation API failed: {e}")
            print(f"   💡 WORKAROUND: Create Excel manually with boundary structure shown above")
            return None

        # Step 4: Poll for completion and download
        print(f"\n[4/4] Waiting for template...")
        poll_result = self.uploader.poll_boundary_template_status(tenant, name)

        if not poll_result or poll_result.get('status') == 'failed':
            print(f"   ❌ Template generation failed")
            error = poll_result.get('additionalDetails', {}).get('error', {})
            if error:
                print(f"   🔍 Error details: {error}")
            print(f"   💡 SOLUTION: Create Excel manually with these columns:")
            print(f"      Code | Name | Type | Parent")
            print(f"   📝 Save as boundaries.xlsx and proceed to Phase 2b")
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
        _send_telemetry("dataloader", "load", "common-masters")

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

    def create_employee(self, tenant: str, username: str, password: str,
                        name: str = None, mobile: str = "9999999999",
                        roles: list = None, department: str = None,
                        designation: str = None) -> bool:
        """Create a single HRMS employee programmatically.

        Creates both the user account AND the HRMS employee record.
        Use this when PGR needs department info for the assignee.

        Args:
            tenant: Target tenant ID
            username: Employee username
            password: Employee password
            name: Display name (defaults to username)
            mobile: Mobile number
            roles: List of role codes (defaults to ["EMPLOYEE"])
            department: Department code (auto-detected if not provided)
            designation: Designation code (auto-detected if not provided)

        Returns:
            bool: True if employee was created or already exists
        """
        self._check_auth()
        _send_telemetry("dataloader", "create", "employee")

        state_tenant = tenant.split(".")[0] if "." in tenant else tenant
        name = name or username
        roles = roles or ["EMPLOYEE"]

        if not department or not designation:
            depts = self.uploader.fetch_departments(tenant)
            desigs = self.uploader.fetch_designations(tenant)
            if not department and depts:
                department = depts[0].get('code', 'DEPT_1')
            if not designation and desigs:
                designation = desigs[0].get('code', 'DESIG_01')

        if not department or not designation:
            print(f"   No departments/designations in MDMS. Load common masters first.")
            return False

        self._ensure_roles_exist(state_tenant, roles)
        role_objects = [{"code": r, "name": r, "tenantId": state_tenant} for r in roles]

        # HRMS _create ignores the password we pass and generates a random one.
        # unified_loader skips password update for "eGov@123", so use a sentinel.
        employee = {
            'tenantId': tenant, 'code': username,
            'employeeStatus': 'EMPLOYED', 'employeeType': 'PERMANENT',
            'dateOfAppointment': 1704067200000,
            'assignments': [{'fromDate': 1704067200000, 'isCurrentAssignment': True,
                             'department': department, 'designation': designation}],
            'jurisdictions': [{'hierarchy': 'REVENUE', 'boundaryType': 'City',
                               'boundary': tenant, 'tenantId': tenant, 'roles': role_objects}],
            'user': {'name': name, 'userName': username, 'mobileNumber': mobile,
                     'active': True, 'type': 'EMPLOYEE', 'tenantId': tenant,
                     'roles': role_objects, 'password': 'TempHRMS@999', 'otpReference': '12345'},
            'serviceHistory': [], 'education': [], 'tests': [],
        }

        print(f"   Creating HRMS employee '{username}' (dept={department}, desig={designation})")
        results = self.uploader.create_employees(employee_list=[employee], tenant=tenant)
        created = results.get('created', 0) > 0 or results.get('exists', 0) > 0

        # Set the real password via HRMS _update
        if created and password != 'TempHRMS@999':
            hrms_svc = os.environ.get("HRMS_SERVICE", "/egov-hrms")
            headers = {"Content-Type": "application/json"}
            try:
                sr = requests.post(f"{self.base_url}{hrms_svc}/employees/_search",
                    json={"RequestInfo": {"apiId": "Rainmaker", "authToken": self.auth_token,
                          "userInfo": self.user_info}, "codes": [username], "tenantId": tenant},
                    headers=headers, params={"tenantId": tenant, "codes": username},
                    timeout=REQUEST_TIMEOUT)
                emp = sr.json().get("Employees", [{}])[0] if sr.ok else {}
                if emp.get("id"):
                    emp["user"]["password"] = password
                    requests.post(f"{self.base_url}{hrms_svc}/employees/_update",
                        json={"RequestInfo": {"apiId": "Rainmaker", "authToken": self.auth_token,
                              "userInfo": self.user_info}, "Employees": [emp]},
                        headers=headers, timeout=REQUEST_TIMEOUT)
                    print(f"   Password set for '{username}'")
            except Exception as e:
                print(f"   Warning: password update failed: {e}")

        return created

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
        _send_telemetry("dataloader", "load", "localizations")

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

    def copy_localization_messages(self, source_tenant: str = "pg", target_tenant: str = None) -> Dict:
        """Copy all localization messages from source tenant to target tenant
        
        This method copies all localization messages across all modules from one tenant to another.
        Useful for bootstrapping new root tenants with complete localization coverage.
        
        Args:
            source_tenant: Source tenant to copy from (default: "pg")
            target_tenant: Target tenant to copy to (uses self.tenant_id if not provided)
            
        Returns:
            dict: Summary of copy operation with counts and modules
        """
        self._check_auth()
        _send_telemetry("dataloader", "copy", "localizations")
        
        if not target_tenant:
            target_tenant = self.tenant_id
            
        if not target_tenant:
            raise ValueError("target_tenant must be provided or set via login()")
            
        if source_tenant == target_tenant:
            raise ValueError("source_tenant and target_tenant cannot be the same")

        print(f"\n{'='*60}")
        print(f"COPY LOCALIZATION MESSAGES")
        print(f"{'='*60}")
        print(f"Source tenant: {source_tenant}")
        print(f"Target tenant: {target_tenant}")
        
        # Use the existing private method
        self._copy_localization_messages(source_tenant, target_tenant)
        
        return {"status": "completed", "source": source_tenant, "target": target_tenant}

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
        _send_telemetry("dataloader", "load", "workflow")

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

        # Database connection details (from environment or defaults for local Docker)
        db_host = os.environ.get("BOUNDARY_DB_HOST", "postgres")
        db_name = os.environ.get("BOUNDARY_DB_NAME", "egov")
        db_user = os.environ.get("BOUNDARY_DB_USER", "egov")

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

        # Delete relationships first, then boundaries (parameterized to prevent SQL injection)
        delete_sql = "DELETE FROM boundary_relationship WHERE tenantid = :'tenant_id'; DELETE FROM boundary WHERE tenantid = :'tenant_id';"
        result = subprocess.run(
            ["kubectl", "exec", "-n", "egov", "db-cleanup", "--",
             "psql", conn_str, "-t",
             "-v", f"tenant_id={tenant}",
             "-c", delete_sql],
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
