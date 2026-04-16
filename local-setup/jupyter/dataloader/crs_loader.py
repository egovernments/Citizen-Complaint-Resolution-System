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
import time
import requests

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
        session_root = self.tenant_id.split(".")[0] if "." in self.tenant_id else self.tenant_id

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
            # Existing tenant records may still be incomplete when the root was
            # created earlier without full bootstrap. Ensure root schemas/data
            # exist before trying tenant-scoped branding or user creation.
            if root_tenant != session_root:
                if not self._bootstrap_tenant_root(root_tenant, source_tenant=self.tenant_id):
                    print(f"❌ Failed to bootstrap root '{root_tenant}'")
                    return False

            stateinfo_ready = self._ensure_stateinfo_for_tenant(tenant_code, display_name)

            for module in enable_modules:
                self._enable_module_for_tenant(tenant_code, module)

            if users:
                print(f"\n👥 Ensuring {len(users)} user(s) for tenant '{tenant_code}'...")
                for user_def in users:
                    self._create_user_for_tenant(tenant_code, user_def)

            return stateinfo_ready

        print(f"📝 Creating tenant '{tenant_code}'...")

        # Use the canonical tenant code as the persisted label for generated
        # tenant records. This keeps tenant.tenants, StateInfo, and tenant
        # localization aligned with the actual tenant identifier instead of a
        # caller-provided friendly label.
        tenant_label = tenant_code

        # Bootstrap new root if needed (e.g. "ethiopia" when creating "ethiopia.kenya")
        if root_tenant != session_root:
            if not self._bootstrap_tenant_root(root_tenant, source_tenant=self.tenant_id):
                print(f"❌ Failed to bootstrap root '{root_tenant}'")
                return False

        # Create tenant record under its own root
        create_url = f"{self.base_url}/mdms-v2/v2/_create/tenant.tenants"
        tenant_data = {
            "code": tenant_code,
            "name": tenant_label,
            "tenantId": tenant_code,
            "type": "CITY",
            "city": {
                "code": tenant_code.upper().replace(".", "_"),
                "name": tenant_label,
                "districtName": tenant_label
            }
        }

        create_payload = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info
            },
            "Mdms": {
                "tenantId": root_tenant,
                "schemaCode": "tenant.tenants",
                "data": tenant_data,
                "isActive": True
            }
        }

        resp = requests.post(create_url, json=create_payload, headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)

        if resp.ok:
            print(f"✅ Tenant '{tenant_code}' created successfully!")

            # Ensure tenant has branding metadata used by UI localization bootstrap
            if not self._ensure_stateinfo_for_tenant(tenant_code, tenant_label):
                print(f"❌ Failed to ensure StateInfo for '{tenant_code}'")
                return False

            # Seed tenant display name localization (UI dropdown shows raw key without this)
            self._seed_tenant_name_localization(tenant_code, tenant_label, root_tenant)

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

    def bootstrap_tenant(self, target_tenant: str, source_tenant: str = "pg") -> bool:
        """Bootstrap a tenant root by copying schemas and essential data from a source.

        Safe to run on existing roots — schemas and data that already exist are
        skipped (idempotent). Use this to back-fill missing MDMS data on a root
        that was created before new essential_schemas entries were added.

        Args:
            target_tenant: Tenant code (e.g. "uitest" or "uitest.cityb").
                           The root is extracted automatically ("uitest").
            source_tenant: Existing root to copy from (default: "pg")

        Returns:
            bool: True if bootstrap succeeded
        """
        self._check_auth()
        target_root = target_tenant.split(".")[0]
        return self._bootstrap_tenant_root(target_root, source_tenant)

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
            defn = schema.get("definition", {})

            # MDMS v2 schema create rejects definitions without x-unique.
            # Seed-created schemas (e.g. tenant.tenants) may lack it.
            # Infer a sensible unique key from required fields.
            if "x-unique" not in defn or not defn.get("x-unique"):
                props = list(defn.get("properties", {}).keys())
                if "code" in props:
                    defn["x-unique"] = ["code"]
                elif props:
                    defn["x-unique"] = [props[0]]

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
                    "definition": defn
                }
            }
            try:
                r = requests.post(schema_create_url, json=create_payload,
                                  headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
                if r.ok:
                    copied += 1
                elif any(kw in r.text.lower() for kw in ["duplicate", "already exists"]):
                    skipped += 1
                else:
                    failed += 1
                    print(f"   ⚠️  Schema '{code}': {r.text[:150]}")
            except Exception:
                failed += 1

        print(f"   📋 Schemas: {copied} copied, {skipped} already existed, {failed} failed (of {len(schemas)} total)")

        if failed > 0:
            print(f"   ⚠️  Some schemas failed but continuing — non-critical schemas may be optional")

        # Schema create returning 200 does not always mean the runtime MDMS data
        # APIs can use the schema immediately. Wait for the critical tenant schema
        # to become visible before copying tenant-scoped bootstrap data.
        if not self._wait_for_schema_ready(target_root, "tenant.tenants"):
            print(f"   ❌ Schema 'tenant.tenants' is not yet usable on '{target_root}'")
            return False

        # Step 2: Copy essential MDMS data records from source.
        # Keep tenant.tenants limited to actual city tenants and skip adding a
        # synthetic root record like "juiceee".
        essential_schemas = [
            'common-masters.IdFormat',
            'common-masters.Department',
            'common-masters.Designation',
            'common-masters.GenderType',
            'egov-hrms.EmployeeStatus',
            'egov-hrms.EmployeeType',
            'egov-hrms.DeactivationReason',
            'ACCESSCONTROL-ROLES.roles',
            'RAINMAKER-PGR.ServiceDefs',
            # UI-critical schemas: without these the DIGIT UI shows blank pages or errors
            'common-masters.uiHomePage',
            'common-masters.wfSlaConfig',
            'common-masters.CronJobAPIConfig',
            'RAINMAKER-PGR.UIConstants',
            # Citizen home page service cards (File a Complaint, My Complaints, etc.)
            'ACCESSCONTROL-ACTIONS-TEST.actions-test',
            # Role-action mappings: without this, egov-accesscontrol returns
            # "Missing property ACCESSCONTROL-ROLEACTIONS" and the UI can't
            # determine which actions are permitted for each role.
            'ACCESSCONTROL-ROLEACTIONS.roleactions',
            # Inbox v2 query configuration: the inbox service looks up ES index
            # mapping by moduleName at the state-level tenant. Without this,
            # /inbox/v2/_search returns CONFIG_ERROR.
            'INBOX.InboxQueryConfiguration',
            # Boundary template generation depends on tenant-scoped MDMS data
            # under this schema, not just the schema definition itself.
            'CRS-ADMIN-CONSOLE.adminSchema',
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
                clean_records.append(rec)

            result = self._create_mdms_with_schema_retry(
                schema_code=schema_code, data_list=clean_records, tenant=target_root
            )
            data_copied += result.get('created', 0)
            data_skipped += result.get('exists', 0)

        print(f"   📦 Data: {data_copied} records copied, {data_skipped} already existed")

        # Step 2b: Ensure InboxQueryConfiguration has a "pgr-services" module record
        # The source may have "RAINMAKER-PGR" but the inbox service looks up by
        # moduleName from the UI request which is "pgr-services".
        self._ensure_inbox_pgr_config(target_root)

        # Step 3: Seed essential localization messages for new tenant
        # Without these, the DIGIT UI shows raw i18n keys (CORE_COMMON_LOGIN, etc.)
        self._seed_essential_localizations(target_root, source_tenant)

        # Step 4: Create citymodule entries so PGR/HRMS modules are enabled for the root
        self._bootstrap_citymodule(target_root, source_tenant)

        # Step 5: Copy workflow business service definitions
        # Note: workflow search requires tenantId as a query parameter, not in body
        wf_search_url = f"{self.base_url}/egov-workflow-v2/egov-wf/businessservice/_search"
        wf_create_url = f"{self.base_url}/egov-workflow-v2/egov-wf/businessservice/_create"

        wf_request_info = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info
            }
        }

        try:
            wf_resp = requests.post(
                wf_search_url, json=wf_request_info,
                params={"tenantId": source_tenant},
                headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
            if wf_resp.ok:
                business_services = wf_resp.json().get("BusinessServices", [])
                wf_copied = 0
                for bs in business_services:
                    # Clone for target root: strip IDs, update tenant
                    bs_copy = deepcopy(bs)
                    bs_copy.pop("uuid", None)
                    bs_copy.pop("auditDetails", None)
                    bs_copy["tenantId"] = target_root
                    for state in bs_copy.get("states", []):
                        state.pop("uuid", None)
                        state.pop("auditDetails", None)
                        state["tenantId"] = target_root
                        for action in state.get("actions", []):
                            action.pop("uuid", None)
                            action.pop("auditDetails", None)
                            action.pop("currentState", None)
                            action.pop("nextState", None)

                    create_wf = {
                        "RequestInfo": {
                            "apiId": "Rainmaker",
                            "authToken": self.auth_token,
                            "userInfo": self.user_info
                        },
                        "BusinessServices": [bs_copy]
                    }
                    try:
                        r = requests.post(wf_create_url, json=create_wf,
                                          headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
                        if r.ok:
                            wf_copied += 1
                        else:
                            print(f"   ⚠️  Workflow create for '{bs.get('businessService', '?')}': {r.text[:150]}")
                    except Exception as e:
                        print(f"   ⚠️  Workflow create error: {e}")

                if wf_copied > 0:
                    print(f"   ✅ Workflow: {wf_copied} business service(s) copied")
                elif business_services:
                    print(f"   ⚠️  Workflow: could not copy (may already exist)")
                else:
                    print(f"   ⚠️  Workflow: no business services found on '{source_tenant}'")
            else:
                print(f"   ⚠️  Workflow search failed: {wf_resp.text[:150]}")
        except Exception as e:
            print(f"   ⚠️  Workflow copy skipped (service may not be ready): {e}")

        print(f"   ✅ Bootstrap complete for '{target_root}'\n")
        return True

    def _wait_for_schema_ready(self, tenant: str, schema_code: str,
                               attempts: int = 10, delay_seconds: float = 1.5) -> bool:
        """Poll MDMS schema search until a schema is visible for runtime data APIs.

        In this environment, schema creation can persist before the data-create
        APIs are ready to resolve the new tenant's schema. Poll the schema API
        instead of using a blind sleep so bootstrap only waits when needed.
        """
        schema_search_url = f"{self.base_url}/mdms-v2/schema/v1/_search"

        for attempt in range(1, attempts + 1):
            payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "SchemaDefCriteria": {
                    "tenantId": tenant,
                    "codes": [schema_code],
                    "limit": 10,
                    "offset": 0
                }
            }

            try:
                resp = requests.post(
                    schema_search_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=REQUEST_TIMEOUT,
                )
                if resp.ok:
                    definitions = resp.json().get("SchemaDefinitions", [])
                    if any(d.get("code") == schema_code for d in definitions):
                        if attempt > 1:
                            print(f"   ✅ Schema '{schema_code}' became ready on attempt {attempt}/{attempts}")
                        return True
            except Exception:
                pass

            if attempt < attempts:
                print(f"   ⏳ Waiting for schema '{schema_code}' on '{tenant}' ({attempt}/{attempts})")
                time.sleep(delay_seconds)

        return False

    def _create_mdms_with_schema_retry(self, schema_code: str, data_list: list, tenant: str,
                                       attempts: int = 5, delay_seconds: float = 1.5) -> dict:
        """Retry MDMS create when the tenant schema exists but is not yet queryable.

        This is intentionally narrow: only the schema-not-found case is retried.
        Validation errors and other failures still fail fast.
        """
        last_result = None

        for attempt in range(1, attempts + 1):
            result = self.uploader.create_mdms_data(
                schema_code=schema_code,
                data_list=data_list,
                tenant=tenant,
            )
            last_result = result
            print(f"   Records: {last_result}")

            if result.get('created', 0) > 0 or result.get('exists', 0) > 0:
                return result

            errors = result.get('errors', [])
            schema_not_found = any(
                "schema definition against which data is being created is not found" in
                str(err.get('error', '')).lower()
                for err in errors
            )

            if not schema_not_found or attempt == attempts:
                return result

            print(
                f"   ⏳ Schema '{schema_code}' not ready for data create on '{tenant}' "
                f"(attempt {attempt}/{attempts}); retrying..."
            )
            time.sleep(delay_seconds)

        return last_result or {'created': 0, 'exists': 0, 'failed': len(data_list), 'errors': []}

    def _seed_essential_localizations(self, target_tenant: str, source_tenant: str = "pg"):
        """Seed all en_IN localization messages for a new tenant.

        Without these messages, the DIGIT UI shows raw i18n keys like
        CORE_COMMON_LOGIN, TENANT_TENANTS_UITEST, etc.

        Strategy:
          1. Try to copy from the source tenant API
          2. If the API returns < 500 messages (likely cache/seed issue),
             fall back to bundled JSON files from default-data-handler
          3. Always create the tenant-specific display name message
        """
        import time
        import json as _json

        loc_search_url = f"{self.base_url}/localization/messages/v1/_search"
        loc_upsert_url = f"{self.base_url}/localization/messages/v1/_upsert"

        MIN_EXPECTED_MESSAGES = 500  # If API returns fewer, use bundled JSONs
        copied = 0
        skipped = 0

        try:
            # Try to fetch from source tenant API first
            source_messages = []
            try:
                resp = requests.post(
                    loc_search_url,
                    params={"tenantId": source_tenant, "locale": "en_IN"},
                    json={"RequestInfo": {"apiId": "Rainmaker"}},
                    headers={"Content-Type": "application/json"},
                    timeout=60
                )
                if resp.ok:
                    source_messages = resp.json().get("messages", [])
            except Exception:
                pass

            # If API returned too few messages, load from bundled JSON files
            if len(source_messages) < MIN_EXPECTED_MESSAGES:
                bundled = self._load_bundled_localizations()
                if bundled:
                    print(f"   API returned {len(source_messages)} messages, using {len(bundled)} bundled messages")
                    source_messages = bundled

            if not source_messages:
                print(f"   ⚠️  No localization messages available (API or bundled)")
                return

            # Fetch existing messages on target to skip duplicates
            existing_codes = set()
            try:
                tr = requests.post(
                    loc_search_url,
                    params={"tenantId": target_tenant, "locale": "en_IN"},
                    json={"RequestInfo": {"apiId": "Rainmaker"}},
                    headers={"Content-Type": "application/json"},
                    timeout=60
                )
                if tr.ok:
                    for m in tr.json().get("messages", []):
                        existing_codes.add(m.get("code", ""))
            except Exception:
                pass

            # Filter to new messages only
            new_messages = []
            for msg in source_messages:
                code = msg.get("code", "")
                if code in existing_codes:
                    skipped += 1
                    continue
                new_messages.append({
                    "code": code,
                    "message": msg.get("message", code),
                    "module": msg.get("module", "rainmaker-common"),
                    "locale": "en_IN"
                })

            # Upsert in batches of 500
            for i in range(0, len(new_messages), 500):
                batch = new_messages[i:i+500]
                upsert_payload = {
                    "RequestInfo": {
                        "apiId": "Rainmaker",
                        "authToken": self.auth_token,
                        "userInfo": self.user_info
                    },
                    "tenantId": target_tenant,
                    "messages": batch
                }
                r = requests.post(loc_upsert_url, json=upsert_payload,
                                  headers={"Content-Type": "application/json"},
                                  timeout=60)
                if r.ok:
                    copied += len(batch)
                else:
                    print(f"   ⚠️  Batch upsert failed: {r.status_code} {r.text[:200]}")
                time.sleep(0.5)

        except Exception as e:
            print(f"   ⚠️  Localization seeding failed: {e}")

        # Create tenant-specific display name message
        tenant_key = "TENANT_TENANTS_" + target_tenant.upper().replace(".", "_")
        display_name = target_tenant.replace(".", " ").title()
        try:
            upsert_payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "tenantId": target_tenant,
                "messages": [{"code": tenant_key, "message": display_name,
                              "module": "rainmaker-common", "locale": "en_IN"}]
            }
            r = requests.post(loc_upsert_url, json=upsert_payload,
                              headers={"Content-Type": "application/json"},
                              timeout=REQUEST_TIMEOUT)
            if r.ok:
                copied += 1
        except Exception as e:
            print(f"   ⚠️  Tenant name localization failed: {e}")

        print(f"   🌐 Localization: {copied} copied, {skipped} skipped for '{target_tenant}'")

    def _load_bundled_localizations(self):
        """Load localization messages from bundled JSON files.

        Falls back to these when the source tenant API doesn't have enough messages
        (e.g., fresh install with minimal DB seed).
        """
        import json as _json

        # Look for bundled JSONs in templates/localisations/
        templates_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates", "localisations")
        if not os.path.isdir(templates_dir):
            return []

        messages = []
        seen_codes = set()
        for fname in sorted(os.listdir(templates_dir)):
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(templates_dir, fname)
            try:
                with open(fpath, "r") as f:
                    data = _json.load(f)
                for msg in data:
                    code = msg.get("code", "")
                    if code and code not in seen_codes:
                        seen_codes.add(code)
                        messages.append(msg)
            except Exception as e:
                print(f"   ⚠️  Failed to load {fname}: {e}")

        return messages

    def _ensure_inbox_pgr_config(self, target_root: str):
        """Ensure InboxQueryConfiguration has a record with module='pgr-services'.

        The inbox v2 service looks up configuration by moduleName from the UI request
        (which sends 'pgr-services'), but the standard DIGIT seed data uses
        module='RAINMAKER-PGR'. This creates the matching record if missing.
        """
        existing = self.uploader.search_mdms_data(
            schema_code='INBOX.InboxQueryConfiguration', tenant=target_root, limit=50
        )
        for rec in existing:
            if rec.get('module') == 'pgr-services':
                print("   ✅ InboxQueryConfiguration 'pgr-services' already exists")
                return

        inbox_config = {
            "index": "inbox-pgr-services",
            "module": "pgr-services",
            "sortBy": {"path": "Data.service.auditDetails.createdTime", "defaultOrder": "ASC"},
            "sourceFilterPathList": [
                "Data.currentProcessInstance",
                "Data.service.serviceRequestId",
                "Data.service.address.locality.code",
                "Data.service.applicationStatus",
                "Data.service.citizen",
                "Data.service.auditDetails.createdTime",
                "Data.auditDetails",
                "Data.tenantId"
            ],
            "allowedSearchCriteria": [
                {"name": "area", "path": "Data.service.address.locality.code.keyword", "operator": "EQUAL", "isMandatory": False},
                {"name": "status", "path": "Data.currentProcessInstance.state.uuid.keyword", "operator": "EQUAL", "isMandatory": False},
                {"name": "assignedToMe", "path": "Data.workflow.assignes.*.uuid.keyword", "operator": "EQUAL", "isMandatory": False},
                {"name": "fromDate", "path": "Data.service.auditDetails.createdTime", "operator": "GTE", "isMandatory": False},
                {"name": "toDate", "path": "Data.service.auditDetails.createdTime", "operator": "LTE", "isMandatory": False},
                {"name": "complaintNumber", "path": "Data.service.serviceRequestId.keyword", "operator": "EQUAL", "isMandatory": False},
                {"name": "mobileNumber", "path": "Data.service.citizen.mobileNumber.keyword", "operator": "EQUAL", "isMandatory": False},
                {"name": "tenantId", "path": "Data.service.tenantId.keyword", "operator": "EQUAL", "isMandatory": False},
                {"name": "assignee", "path": "Data.currentProcessInstance.assignes.uuid.keyword", "operator": "EQUAL", "isMandatory": False}
            ]
        }
        result = self.uploader.create_mdms_data(
            schema_code='INBOX.InboxQueryConfiguration', data_list=[inbox_config], tenant=target_root
        )
        if result.get('created', 0) > 0:
            print("   ✅ InboxQueryConfiguration 'pgr-services' created")
        else:
            print("   ⚠️  InboxQueryConfiguration 'pgr-services' creation returned no new records")

    def _bootstrap_citymodule(self, target_root: str, source_tenant: str = "pg"):
        """Create citymodule entries for a new root tenant.

        Copies module definitions (PGR, HRMS, etc.) from source tenant and
        creates them under the target root without pre-seeding the root tenant
        into each module's tenants list. Actual city tenants are added later by
        _enable_module_for_tenant().
        """
        # Search citymodule from source
        search_url = f"{self.base_url}/mdms-v2/v1/_search"
        search_payload = {
            "MdmsCriteria": {
                "tenantId": source_tenant,
                "moduleDetails": [{"moduleName": "tenant", "masterDetails": [{"name": "citymodule"}]}]
            },
            "RequestInfo": {"apiId": "Rainmaker"}
        }

        resp = requests.post(search_url, json=search_payload,
                             headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
        if not resp.ok:
            print(f"   ⚠️  Could not fetch citymodule from '{source_tenant}'")
            return

        source_modules = resp.json().get("MdmsRes", {}).get("tenant", {}).get("citymodule", [])
        if not source_modules:
            print(f"   ⚠️  No citymodule entries found on '{source_tenant}'")
            return

        # Create each module entry under the target root
        created = 0
        for module in source_modules:
            module_copy = deepcopy(module)
            # Do not pre-seed the root tenant into citymodule. Keep the module
            # definition present on the root tenant, but let actual city tenants
            # like "juiceee.kwale" be added explicitly later.
            module_copy["tenants"] = []

            create_payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "Mdms": {
                    "tenantId": target_root,
                    "schemaCode": "tenant.citymodule",
                    "data": module_copy,
                    "isActive": True
                }
            }

            try:
                r = requests.post(
                    f"{self.base_url}/mdms-v2/v2/_create/tenant.citymodule",
                    json=create_payload,
                    headers={"Content-Type": "application/json"},
                    timeout=REQUEST_TIMEOUT
                )
                if r.ok:
                    created += 1
                elif "already exists" in r.text.lower() or "duplicate" in r.text.lower():
                    pass  # Already exists, skip silently
                else:
                    print(f"   ⚠️  citymodule '{module.get('code', '?')}': {r.text[:150]}")
            except Exception as e:
                print(f"   ⚠️  citymodule error: {e}")

        if created > 0:
            print(f"   📦 Citymodule: {created} module(s) created for '{target_root}'")
        else:
            print(f"   📦 Citymodule: modules already exist for '{target_root}'")

    def _seed_tenant_name_localization(self, tenant_code: str, display_name: str,
                                       root_tenant: str):
        """Create localization message for a tenant's display name.

        The DIGIT UI city dropdown shows TENANT_TENANTS_<CODE> as raw text
        unless a localization message maps it to a human-readable name.
        """
        loc_upsert_url = f"{self.base_url}/localization/messages/v1/_upsert"
        tenant_key = "TENANT_TENANTS_" + tenant_code.upper().replace(".", "_")

        messages = [
            {"code": tenant_key, "message": display_name,
             "module": "rainmaker-common", "locale": "en_IN"},
        ]

        try:
            upsert_payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "tenantId": root_tenant,
                "messages": messages
            }
            r = requests.post(loc_upsert_url, json=upsert_payload,
                              headers={"Content-Type": "application/json"},
                              timeout=REQUEST_TIMEOUT)
            if r.ok:
                print(f"   🌐 Localization: '{tenant_key}' = '{display_name}'")
        except Exception as e:
            print(f"   ⚠️  Tenant name localization failed: {e}")

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
        # Strip all internal MDMS fields (prefixed with _)
        for key in list(stateinfo.keys()):
            if key.startswith('_'):
                stateinfo.pop(key)
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
        """Add tenant to citymodule for a specific module via MDMS v2 update API."""
        root_tenant = tenant_code.split(".")[0] if "." in tenant_code else tenant_code

        # Search citymodule records via MDMS v2 API (returns full records with id + auditDetails)
        search_url = f"{self.base_url}/mdms-v2/v2/_search"
        update_url = f"{self.base_url}/mdms-v2/v2/_update/tenant.citymodule"
        records = []
        citymodule_tenant = root_tenant

        for search_tenant in [root_tenant, self.tenant_id]:
            search_payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "MdmsCriteria": {
                    "tenantId": search_tenant,
                    "schemaCode": "tenant.citymodule",
                    "limit": 50
                }
            }
            resp = requests.post(search_url, json=search_payload,
                                 headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
            if resp.ok:
                records = resp.json().get("mdms", [])
                if records:
                    citymodule_tenant = search_tenant
                    break

        if not records:
            print(f"   ⚠️  Could not fetch citymodule config for {module_code}")
            return

        # Find the matching module record
        module_record = None
        for r in records:
            if r.get("data", {}).get("code") == module_code:
                module_record = r
                break

        if not module_record:
            print(f"   ⚠️  Module '{module_code}' not found in citymodule")
            return

        # Check if tenant already present
        existing_tenants = [t.get("code", "").lower() for t in module_record["data"].get("tenants", [])]
        if tenant_code.lower() in existing_tenants:
            print(f"   ✅ {module_code} already enabled")
            return

        # Add tenant and update via MDMS v2 API
        module_record["data"]["tenants"] = module_record["data"].get("tenants", []) + [{"code": tenant_code}]
        update_payload = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info
            },
            "Mdms": module_record
        }
        resp = requests.post(update_url, json=update_payload,
                             headers={"Content-Type": "application/json"}, timeout=REQUEST_TIMEOUT)
        if resp.ok or resp.status_code == 202:
            print(f"   ✅ {module_code} enabled for '{tenant_code}'")
        else:
            print(f"   ❌ {module_code}: failed to enable for '{tenant_code}': {resp.text[:200]}")

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

        if not levels:
            raise ValueError("levels must contain at least one boundary level")

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

        # Step 2b: Create CMS boundary hierarchy schema MDMS entry
        print(f"\n[2b/4] Creating boundary hierarchy MDMS config...")
        mdms_payload = self._build_boundary_hierarchy_mdms(name=name, levels=levels)
        try:
            mdms_result = self._create_mdms_with_schema_retry(
                schema_code="CMS-BOUNDARY.HierarchySchema",
                data_list=[mdms_payload],
                tenant=tenant,
            )
            if mdms_result.get('failed'):
                print(f"   ERROR: Failed to create CMS boundary hierarchy MDMS config")
                for err in mdms_result.get('errors', [])[:3]:
                    print(f"   Details: {err.get('error', err)}")
                return None
            if mdms_result.get('exists'):
                print(f"   Boundary hierarchy MDMS config already exists (OK)")
            else:
                print(f"   Boundary hierarchy MDMS config created successfully")
        except Exception as e:
            print(f"   ERROR: Failed to create CMS boundary hierarchy MDMS config: {e}")
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

    def _build_boundary_hierarchy_mdms(self, name: str, levels: list) -> Dict:
        """Build CMS boundary hierarchy MDMS data from the last two boundary levels."""
        lowest_hierarchy = levels[-1]
        highest_hierarchy = levels[-2] if len(levels) > 1 else levels[-1]

        return {
            "hierarchy": name,
            "department": "All",
            "moduleName": "CMS",
            "lowestHierarchy": lowest_hierarchy,
            "highestHierarchy": highest_hierarchy,
        }

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
        complaint_tenant = tenant.split(".")[0] if "." in tenant else tenant

        if complaint_data:
            print(f"   Creating {len(complaint_data)} complaint types on '{complaint_tenant}'...")
            results['complaint_types'] = self.uploader.create_mdms_data(
                schema_code='RAINMAKER-PGR.ServiceDefs',
                data_list=complaint_data,
                tenant=complaint_tenant,
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
                     'dob': 946684800000,
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

        # Fix 1: Restore original username from Excel (unified_loader strips underscores).
        # Re-read the User Name* column and apply only uppercase + space→underscore,
        # preserving underscores that unified_loader would have dropped.
        try:
            import pandas as pd
            df = pd.read_excel(excel_path, sheet_name='Employee Master')
            original_names = [
                str(row).strip().upper().replace(' ', '_')
                for row in df.get('User Name*', df.iloc[:, 0])
                if pd.notna(row)
            ]
            for emp, original in zip(employees, original_names):
                emp['code'] = original
                emp.setdefault('user', {})['userName'] = original
        except Exception as e:
            print(f"   Warning: could not restore original usernames: {e}")

        # Fix 2: Ensure every employee has a password; default to eGov@123 if missing
        for emp in employees:
            if not emp.get('user', {}).get('password'):
                emp.setdefault('user', {})['password'] = 'eGov@123'

        # 2. Create employees via HRMS
        print(f"\n[2/2] Creating employees...")
        results = self.uploader.create_employees(
            employee_list=employees,
            tenant=tenant,
            sheet_name='Employee Master',
            excel_file=excel_path
        )

        # Fix 3: Force password update for ALL employees (created + exists) via HRMS _update.
        # unified_loader skips password update for EXISTS case, so we handle it here.
        hrms_svc = os.environ.get("HRMS_SERVICE", "/egov-hrms")
        headers = {"Content-Type": "application/json"}
        print(f"\n[2b/2] Setting passwords...")
        for emp in employees:
            username = emp.get('code')
            password = emp.get('user', {}).get('password', 'eGov@123')
            try:
                sr = requests.post(
                    f"{self.base_url}{hrms_svc}/employees/_search",
                    json={"RequestInfo": {"apiId": "Rainmaker", "authToken": self.auth_token,
                          "userInfo": self.user_info}, "codes": [username], "tenantId": tenant},
                    headers=headers, params={"tenantId": tenant, "codes": username},
                    timeout=REQUEST_TIMEOUT)
                emp_data = sr.json().get("Employees", [{}])[0] if sr.ok else {}
                if emp_data.get("id"):
                    emp_data["user"]["password"] = password
                    requests.post(
                        f"{self.base_url}{hrms_svc}/employees/_update",
                        json={"RequestInfo": {"apiId": "Rainmaker", "authToken": self.auth_token,
                              "userInfo": self.user_info}, "Employees": [emp_data]},
                        headers=headers, timeout=REQUEST_TIMEOUT)
                    print(f"   Password set for '{username}'")
            except Exception as e:
                print(f"   Warning: password update failed for '{username}': {e}")

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
        workflow_tenant = tenant.split(".")[0] if "." in tenant else tenant
        print(f"Tenant: {workflow_tenant}")
        print(f"Business Service: {business_service}")

        # Load workflow config from JSON file
        print(f"\n[1/3] Loading workflow config from JSON...")
        workflow_config = self._load_workflow_from_json(json_path, workflow_tenant)

        if not workflow_config:
            return {'status': 'failed', 'error': 'Failed to load workflow config from JSON'}

        # Ensure business service code is set
        workflow_config['businessService'] = business_service
        print(f"   Loaded {len(workflow_config.get('states', []))} states")

        # Check if workflow already exists
        print(f"\n[2/3] Checking for existing workflow...")
        existing = self.uploader.search_workflow(workflow_tenant, business_service)

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

            result = self.uploader.update_workflow(workflow_tenant, workflow_config)

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

            result = self.uploader.create_workflow(workflow_tenant, workflow_config)

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
