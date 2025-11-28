"""
Unified PGR Data Loader - Core Module
All code for reading Excel and generating API payloads
Users should not modify this file directly
"""

import pandas as pd
import json
import math
import warnings
import requests
import time
from typing import Dict, List, Any
from datetime import datetime

warnings.filterwarnings('ignore')


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def clean_nans(obj):
    """
    Recursively clean NaN values and convert dates for JSON serialization
    """
    if isinstance(obj, dict):
        cleaned = {}
        for k, v in obj.items():
            cleaned[k] = clean_nans(v)
        return cleaned
    elif isinstance(obj, list):
        return [clean_nans(item) for item in obj]
    elif isinstance(obj, float) and math.isnan(obj):
        return None  # Convert NaN to null
    elif isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()  # Convert Timestamp/datetime to ISO string
    elif pd.isna(obj):
        return None  # Handle any other pandas NA types
    else:
        return obj  # Keep None as None (will be null in JSON)


# ============================================================================
# EXCEL READER CLASS
# ============================================================================

class UnifiedExcelReader:
    """Read unified Excel template and generate API payloads"""

    def __init__(self, excel_file: str):
        self.excel_file = excel_file

    # ========================================================================
    # TENANT MASTER READERS (PHASE 1)
    # ========================================================================

    def read_tenant_info(self):
        """Read Tenant Info sheet with ADMIN0/ADMIN1/ADMIN2 hierarchy
        Transforms to API-compatible structure with auto-generated codes

        Returns:
            tuple: (tenants_list, localization_list)
        """
        df = pd.read_excel(self.excel_file, sheet_name='Tenant Info')

        if len(df) == 0:
            return [], []

        tenants = []
        localizations = []
        district_counter = {}  # For auto-generating district codes
        region_counter = {}    # For auto-generating region codes

        for _, row in df.iterrows():
            # Skip completely empty rows
            if pd.isna(row.get('Tenant Display Name*')) and pd.isna(row.get('Tenant Code*\n(To be filled by ADMIN)')):
                continue

            # Read tenant code (handle multi-line column name)
            tenant_code_col = 'Tenant Code*\n(To be filled by ADMIN)'
            ulb_code = str(row[tenant_code_col]).strip().lower() if pd.notna(row.get(tenant_code_col)) else ""
            ulb_name = str(row['Tenant Display Name*']).strip() if pd.notna(row.get('Tenant Display Name*')) else ""

            if not ulb_code or not ulb_name or ulb_code == 'nan':
                continue

            # Determine tenant type based on code pattern
            tenant_type = str(row.get('Tenant Type*', 'City')).strip()
            if not tenant_type or tenant_type == 'nan':
                tenant_type = 'CITY' if '.' in ulb_code else 'State'

            # Extract ADMIN hierarchy
            admin0 = str(row.get('ADMIN0 Name', '')) if pd.notna(row.get('ADMIN0 Name')) else ""
            admin1 = str(row.get('ADMIN1 Name', '')) if pd.notna(row.get('ADMIN1 Name')) else ""
            admin2 = str(row.get('ADMIN2 Name', '')) if pd.notna(row.get('ADMIN2 Name')) else ""
            region_name = str(row.get('Administrative Region Name (Geographical entity to which the tenant belongs)', '')) if pd.notna(row.get('Administrative Region Name (Geographical entity to which the tenant belongs)')) else ""

            # Auto-generate district code from ADMIN2
            district_code = ""
            if admin2:
                if admin2 not in district_counter:
                    district_counter[admin2] = len(district_counter) + 1
                district_code = f"ADMIN2_{district_counter[admin2]:03d}"

            # Auto-generate region code
            region_code = ""
            if region_name:
                if region_name not in region_counter:
                    region_counter[region_name] = len(region_counter) + 1
                region_code = f"REGION_{region_counter[region_name]:03d}"

            # Build city object with transformed fields
            city = {
                'code': ulb_code.split('.')[-1].upper() if '.' in ulb_code else ulb_code.upper(),
                'name': ulb_name,
                'ulbGrade': tenant_type,
                'districtCode': district_code,  # Auto-generated from ADMIN2
                'districtName': admin2,  # ADMIN2 → districtName
                'districtTenantCode': ulb_code,
                'ddrName': region_name,  # Administrative Region
                'latitude': float(row['Latitude']) if pd.notna(row.get('Latitude')) else 0.0,
                'longitude': float(row['Longitude']) if pd.notna(row.get('Longitude')) else 0.0,
                'regionName': region_name,  # Administrative Region
                'regionCode': region_code,  # Auto-generated
                'localName': ulb_name,  # Use tenant name as local name
                'shapeFileLocation': "",
                'captcha': 'true'
            }

            # Build tenant object
            tenant = {
                'code': ulb_code,
                'name': ulb_name,
                'type': tenant_type,
                'emailId': "",  # Empty string for optional field
                'contactNumber': "",  # Empty string for optional field
                'address': str(row.get('Address', '')) if pd.notna(row.get('Address')) else "",
                'domainUrl': str(row.get('Tenant Website', 'https://example.com')) if pd.notna(row.get('Tenant Website')) else "https://example.com",
                'logoId': str(row.get('Logo File Path*', '')) if pd.notna(row.get('Logo File Path*')) else "",
                'imageId': str(row.get('Logo File Path*', 'default-logo.png')) if pd.notna(row.get('Logo File Path*')) else "default-logo.png",
                'description': f'{ulb_name} - {tenant_type}',
                'twitterUrl': "",
                'facebookUrl': "",
                'OfficeTimings': {'Mon - Fri': '10:00 AM - 5:00 PM'},
                'city': city
            }

            tenants.append(tenant)

            # AUTO-GENERATE LOCALIZATION
            loc_code = f"TENANT_TENANTS_{tenant['code'].upper().replace('.', '_')}"
            localizations.append({
                'code': loc_code,
                'message': tenant['name'],
                'module': 'rainmaker-common',
                'locale': 'en_IN'
            })

        return tenants, localizations

    def read_tenant_branding(self):
        """Read Tenant Branding sheet

        Returns:
            list: Branding information records for MDMS upload
        """
        try:
            df = pd.read_excel(self.excel_file, sheet_name='Tenant Branding Deatils')
        except Exception as e:
            print(f"⚠️ Could not read 'Tenant Branding Deatils' sheet: {str(e)}")
            return []

        branding_list = []
        for _, row in df.iterrows():
            tenant_code = str(row.get('Tenant Code', '')).strip().lower()
            if tenant_code and tenant_code != 'nan':
                branding_record = {
                    'code': tenant_code,  # Tenant code
                    'bannerUrl': str(row.get('Banner URL', '')) if pd.notna(row.get('Banner URL')) else "",
                    'logoUrl': str(row.get('Logo URL', '')) if pd.notna(row.get('Logo URL')) else "",
                    'logoUrlWhite': str(row.get('Logo URL (White)', '')) if pd.notna(row.get('Logo URL (White)')) else "",
                    'stateLogo': str(row.get('State Logo', '')) if pd.notna(row.get('State Logo')) else ""
                }
                branding_list.append(branding_record)

        return branding_list

    # ========================================================================
    # COMMON MASTER READERS (PHASE 2)
    # ========================================================================

    def read_departments_designations(self, tenant_id: str):
        """Read combined Department and Designation sheet from Common Master Excel
        Auto-generates codes for departments and designations

        Args:
            tenant_id: Tenant ID for localization context

        Returns:
            tuple: (departments_list, designations_list, dept_localization, desig_localization, dept_name_to_code_mapping)
        """
        df = pd.read_excel(self.excel_file, sheet_name='Department And Desgination Mast')

        departments = []
        designations = []
        dept_localizations = []
        desig_localizations = []

        dept_counter = {}
        dept_name_to_code = {}  # Mapping for complaint types
        desig_counter = 1

        for _, row in df.iterrows():
            dept_name = row.get('Department Name*')
            desig_name = row.get('Designation Name*')

            # Skip empty rows
            if pd.isna(dept_name) or str(dept_name).strip() == '':
                continue

            dept_name = str(dept_name).strip()

            # Auto-generate department code
            if dept_name not in dept_counter:
                dept_counter[dept_name] = len(dept_counter) + 1
                dept_code = f"DEPT_{dept_counter[dept_name]}"

                # Store mapping from name to code
                dept_name_to_code[dept_name] = dept_code

                # Add department
                departments.append({
                    'code': dept_code,
                    'name': dept_name,
                    'active': True
                })

                # Auto-generate department localization
                loc_code = f"COMMON_MASTERS_DEPARTMENT_{dept_code}"
                dept_localizations.append({
                    'code': loc_code,
                    'message': dept_name,
                    'module': 'rainmaker-common',
                    'locale': 'en_IN'
                })
            else:
                dept_code = f"DEPT_{dept_counter[dept_name]}"

            # Add designation if present
            if pd.notna(desig_name) and str(desig_name).strip() != '':
                desig_name = str(desig_name).strip()
                desig_code = f"DESIG_{desig_counter:02d}"
                desig_counter += 1

                designations.append({
                    'code': desig_code,
                    'name': desig_name,
                    'departmentCode': dept_code,
                    'active': True,
                    'description': f'{desig_name} - {dept_name}'
                })

                # Auto-generate designation localization
                loc_code = f"COMMON_MASTERS_{desig_code}"
                desig_localizations.append({
                    'code': loc_code,
                    'message': desig_name,
                    'module': 'rainmaker-common',
                    'locale': 'en_IN'
                })

        return departments, designations, dept_localizations, desig_localizations, dept_name_to_code

    def read_complaint_types(self, tenant_id: str, dept_name_to_code: dict = None):
        """Read Complaint Type Master from Common Master Excel
        Auto-generates service codes and handles hierarchical structure

        Args:
            tenant_id: Tenant ID for context
            dept_name_to_code: Dictionary mapping department names to codes

        Returns:
            tuple: (complaint_types_list, localization_list)
        """
        df = pd.read_excel(self.excel_file, sheet_name='Complaint Type Master')

        complaint_types = []
        localizations = []
        current_parent = None
        localized_parent_types = set()

        # If no mapping provided, create empty dict
        if dept_name_to_code is None:
            dept_name_to_code = {}

        for _, row in df.iterrows():
            # Check if this is a parent row (has Complaint Type* filled)
            if pd.notna(row.get('Complaint Type*')):
                parent_type = str(row['Complaint Type*']).strip()

                # Get department name and convert to code
                dept_name = str(row['Department Name*']).strip() if pd.notna(row.get('Department Name*')) else None
                dept_code = dept_name_to_code.get(dept_name, dept_name) if dept_name else None

                current_parent = {
                    'type': parent_type,
                    'department': dept_code,
                    'slaHours': int(float(row['Resolution Time (Hours)*'])) if pd.notna(row.get('Resolution Time (Hours)*')) else None,
                    'keywords': str(row['Search Words (comma separated)*']).strip() if pd.notna(row.get('Search Words (comma separated)*')) else None,
                    'priority': int(float(row['Priority'])) if pd.notna(row.get('Priority')) else None
                }

                # Auto-generate localization for parent type (only once)
                if parent_type not in localized_parent_types:
                    parent_type_code = ''.join(word.capitalize() for word in parent_type.split())
                    loc_code = f"SERVICEDFS.{parent_type_code.upper()}"
                    localizations.append({
                        'code': loc_code,
                        'message': parent_type,
                        'module': 'rainmaker-pgr',
                        'locale': 'en_IN'
                    })
                    localized_parent_types.add(parent_type)

            # Every row should have a sub-type
            if pd.notna(row.get('Complaint sub type*')) and str(row['Complaint sub type*']).strip() != '':
                sub_type_name = str(row['Complaint sub type*']).strip()

                # Auto-generate service code from sub-type name
                service_code = ''.join(word.capitalize() for word in sub_type_name.split())

                ct = {
                    'serviceCode': service_code,
                    'name': sub_type_name,
                    'menuPath': current_parent['type'] if current_parent else sub_type_name,
                    'active': True
                }

                # Add parent-level fields
                if current_parent:
                    if current_parent.get('department'):
                        ct['department'] = current_parent['department']
                    if current_parent.get('slaHours'):
                        ct['slaHours'] = current_parent['slaHours']
                    if current_parent.get('keywords'):
                        ct['keywords'] = current_parent['keywords']
                    if current_parent.get('priority'):
                        ct['priority'] = current_parent['priority']

                complaint_types.append(ct)

                # Auto-generate localization for sub-type
                loc_code = f"SERVICEDFS.{service_code.upper()}"
                localizations.append({
                    'code': loc_code,
                    'message': sub_type_name,
                    'module': 'rainmaker-pgr',
                    'locale': 'en_IN'
                })

        return complaint_types, localizations

    # ========================================================================
    # OTHER UTILITY READERS (Employee, Boundary, Workflow, Localization)
    # ========================================================================

    def read_employees(self):
        """Read employee data from Employee sheet (with embedded jurisdiction data)"""
        df = pd.read_excel(self.excel_file, sheet_name='Employee')

        employees = []
        for _, row in df.iterrows():
            emp = {
                'code': row['Employee Code'],
                'tenantId': row['Tenant ID'],
                'employeeStatus': row['Employee Status'],
                'employeeType': row['Employee Type'],
                'dateOfAppointment': row['Date of Appointment'],
                'assignments': [{
                    'fromDate': row['Assignment From Date'],
                    'toDate': row['Assignment To Date'] if pd.notna(row['Assignment To Date']) else None,
                    'isCurrentAssignment': str(row['Is Current Assignment']).upper() == 'TRUE',
                    'department': row['Department Code'],
                    'designation': row['Designation Code']
                }],
                'user': {
                    'mobileNumber': row['User Mobile Number'],
                    'name': row['User Name'],
                    'emailId': row['User Email'] if pd.notna(row['User Email']) else '',
                    'gender': row['User Gender'],
                    'dob': row['User Date of Birth'],
                    'correspondenceAddress': row['User Correspondence Address']
                }
            }

            # Read embedded jurisdiction data
            jurisdiction_roles = []
            if pd.notna(row.get('Jurisdiction Roles (comma separated)')):
                role_codes = [r.strip() for r in str(row['Jurisdiction Roles (comma separated)']).split(',')]
                jurisdiction_roles = [{'code': code, 'name': code, 'tenantId': row['Jurisdiction Tenant ID']} for code in role_codes]

            # Read user roles
            user_roles = []
            if pd.notna(row.get('User Roles (comma separated)')):
                user_role_codes = [r.strip() for r in str(row['User Roles (comma separated)']).split(',')]
                user_roles = [{'code': code, 'name': code, 'tenantId': row['Tenant ID']} for code in user_role_codes]

            emp['user']['roles'] = user_roles

            emp['jurisdictions'] = [{
                'hierarchy': row['Jurisdiction Hierarchy'],
                'boundaryType': row['Jurisdiction Boundary Type'],
                'boundary': row['Jurisdiction Boundary Code'],
                'tenantId': row['Jurisdiction Tenant ID'],
                'roles': jurisdiction_roles
            }]

            # Add optional fields
            emp['serviceHistory'] = []
            emp['education'] = []
            emp['tests'] = []

            if pd.notna(row.get('Service History')):
                emp['serviceHistory'] = [row['Service History']]
            if pd.notna(row.get('Education')):
                emp['education'] = [row['Education']]
            if pd.notna(row.get('Tests')):
                emp['tests'] = [row['Tests']]

            employees.append(emp)

        return employees

    def read_boundary_hierarchy(self):
        """Read boundary hierarchy definition"""
        df = pd.read_excel(self.excel_file, sheet_name='Hierarchy_Definition')

        if len(df) == 0:
            return None

        row = df.iloc[0]
        hierarchy = {
            'tenantId': row['City Code'],
            'hierarchyType': row['Hierarchy Type'],
            'boundaryHierarchy': []
        }
        prev_level = None

        for col in df.columns:
            if col.startswith('Level'):
                level_name = row[col]
                if pd.notna(level_name):
                    hierarchy['boundaryHierarchy'].append({
                        'boundaryType': str(level_name),
                        'parentBoundaryType': prev_level,
                        'active': True
                    })
                    prev_level = str(level_name)

        return hierarchy

    def read_boundary_entities(self):
        """Read boundary entities with GeoJSON"""
        df = pd.read_excel(self.excel_file, sheet_name='Boundary_Entities')

        boundaries = []
        for _, row in df.iterrows():
            # Read coordinates - column is 'Polygon Coordinates (JSON)'
            coord_string = row['Polygon Coordinates (JSON)']

            if pd.notna(coord_string):
                try:
                    coordinates_array = json.loads(coord_string)
                    coordinates = [coordinates_array]
                except:
                    coordinates = [[[]]]
            else:
                coordinates = [[[]]]

            boundary = {
                'tenantId': row['Tenant ID'],
                'code': row['Boundary Code'],
                'geometry': {
                    'type': 'Polygon',
                    'coordinates': coordinates
                }
            }

            # Add description if present
            if pd.notna(row.get('Description')):
                boundary['description'] = row['Description']

            boundaries.append(boundary)

        return boundaries

    def read_boundary_relationships(self):
        """Read boundary parent-child relationships"""
        df = pd.read_excel(self.excel_file, sheet_name='Boundary_Relationships')

        if len(df) == 0:
            return []

        relationships = []
        for _, row in df.iterrows():
            relationship = {
                'tenantId': row['Tenant ID'],
                'code': row['Boundary Code'],
                'hierarchyType': row['Hierarchy Type'],
                'boundaryType': row['Boundary Type'],
                'parent': row['Parent'] if pd.notna(row['Parent']) else ''
            }
            relationships.append(relationship)

        return relationships

    def read_workflow_states(self):
        """Read workflow states"""
        df = pd.read_excel(self.excel_file, sheet_name='Workflow_States')

        if len(df) == 0:
            return []

        states = []
        for _, row in df.iterrows():
            state_code = row['State Code']

            state = {
                '_stateCode': state_code,
                'state': state_code,
                'applicationStatus': row['State Name'],
                'isStartState': str(row['Is Start State']).upper() == 'TRUE',
                'isTerminateState': str(row['Is End State']).upper() == 'TRUE',
                'actions': []
            }

            if pd.notna(row.get('SLA Days')):
                sla_days = float(row['SLA Days'])
                state['sla'] = int(sla_days * 24 * 60 * 60 * 1000)

            states.append(state)

        return states

    def read_workflow_actions(self):
        """Read workflow actions"""
        df = pd.read_excel(self.excel_file, sheet_name='Workflow_Actions')

        if len(df) == 0:
            return []

        actions = []
        for _, row in df.iterrows():
            action = {
                'fromState': row['From State'],
                'toState': row['To State'],
                'actionName': row['Action Name'],
                'roleRequired': row['Role Required'],
                'commentRequired': str(row['Comment Required']).upper() == 'TRUE'
            }
            actions.append(action)

        return actions

    def read_localization(self):
        """Read localization with auto-determination of module and locale based on code pattern"""
        try:
            df = pd.read_excel(self.excel_file, sheet_name='Localization')
        except:
            # Try lowercase sheet name
            try:
                df = pd.read_excel(self.excel_file, sheet_name='localization')
            except:
                return []

        if len(df) == 0:
            return []

        localizations = []

        for _, row in df.iterrows():
            # Skip rows with missing required fields
            if pd.notna(row.get('Code')) and pd.notna(row.get('Message')):
                code = str(row['Code']).strip()
                message = str(row['Message']).strip()

                # Determine module and locale based on code pattern
                if code.startswith('SERVICEDFS.'):
                    # Service definitions → rainmaker-pgr
                    module = 'rainmaker-pgr'
                    locale = 'en_IN'
                elif code.startswith('COMMON_MASTERS_') or code.startswith('TENANT_TENANTS_'):
                    # Common masters (departments, designations, tenants) → rainmaker-common
                    module = 'rainmaker-common'
                    locale = 'en_IN'
                else:
                    # Default fallback
                    module = 'rainmaker-common'
                    locale = 'en_IN'

                localizations.append({
                    'code': code,
                    'message': message,
                    'module': module,
                    'locale': locale
                })

        return localizations


# ============================================================================
# WORKFLOW BUILDER
# ============================================================================

def build_workflow_business_service(workflow_states, workflow_actions, config):
    """Build complete workflow BusinessService structure"""

    # Map actions to states
    for action_data in workflow_actions:
        from_state = action_data['fromState']
        to_state = action_data['toState']
        action_name = action_data['actionName']

        roles = (
            action_data['roleRequired'].split(',')
            if ',' in str(action_data['roleRequired'])
            else [action_data['roleRequired']]
        )
        roles = [role.strip() for role in roles]

        for state in workflow_states:
            state_code = state.get('_stateCode')

            if state_code == from_state:
                action_obj = {
                    'action': action_name,
                    'nextState': to_state,
                    'roles': roles,
                }

                if action_data.get('commentRequired'):
                    action_obj['isCommentRequired'] = True

                if state.get('actions') is not None:
                    state['actions'].append(action_obj)
                break

    # Clean up temporary _stateCode field
    for state in workflow_states:
        if '_stateCode' in state:
            del state['_stateCode']

    # Build final BusinessService object
    workflow_data = {
        'tenantId': config['workflow_tenant'],
        'businessService': config['workflow_business_service'],
        'business': 'pgr-services',
        'businessServiceSla': 432000000,
        'states': workflow_states,
    }

    return workflow_data


# ============================================================================
# API UPLOADER CLASS
# ============================================================================

class APIUploader:
    """Handles API uploads for PGR master data

    Service URLs are hardcoded and NOT configurable:
    - MDMS Service: :8094 (tenant, departments, designations, complaint types, employees)
    - Boundary Service: :8081 (boundaries, hierarchy, relationships)
    - Workflow Service: :8280 (workflow business services)
    - Localization Service: :8087 (localization/translations)
    """

    def __init__(self):
        # Hardcoded service URLs - DO NOT CHANGE
        self.mdms_url = "http://localhost:8094"
        self.boundary_url = "http://localhost:8081"
        self.workflow_url = "http://localhost:8280"
        self.localization_url = "http://localhost:8087"

        self.auth_token = "2a57ee8c-410c-4023-a9d3-5111b4f6e304"
        self.user_info = {
            "id": 595,
            "uuid": "1fda5623-448a-4a59-ad17-657986742d67",
            "userName": "UNIFIED_DEV_USERR",
            "name": "Unified dev user",
            "mobileNumber": "8788788851",
            "emailId": "",
            "locale": None,
            "type": "EMPLOYEE",
            "roles": [
                {
                    "name": "Localisation admin",
                    "code": "LOC_ADMIN",
                    "tenantId": "pg"
                },
                {
                    "name": "Employee",
                    "code": "EMPLOYEE",
                    "tenantId": "pg"
                },
                {
                    "name": "MDMS Admin",
                    "code": "MDMS_ADMIN",
                    "tenantId": "pg"
                },
                {
                    "name": "SUPER USER",
                    "code": "SUPERUSER",
                    "tenantId": "pg"
                }
            ],
            "active": True,
            "tenantId": "pg",
            "permanentCity": None
        }

    def create_mdms_data(self, schema_code: str, data_list: List[Dict], tenant: str, sheet_name: str = None):
        """Generic function to create MDMS v2 data

        Args:
            schema_code: MDMS schema code
            data_list: List of data objects to upload
            tenant: Tenant ID
            sheet_name: Optional sheet name for error Excel generation
        """
        url = f"{self.mdms_url}/mdms-v2/v2/_create/{{schema_code}}"

        results = {
            'created': 0,
            'exists': 0,
            'failed': 0,
            'errors': [],
            'failed_records': []  # Store full failed records for Excel export
        }

        print(f"\n[UPLOADING] {schema_code}")
        print(f"   Tenant: {tenant}")
        print(f"   Records: {len(data_list)}")
        print(f"   API URL: {url}")
        print("="*60)

        for i, data_obj in enumerate(data_list, 1):
            unique_id = (
                data_obj.get('code') or
                data_obj.get('serviceCode') or
                data_obj.get('userName') or
                str(i)
            )

            payload = {
                "RequestInfo": {
                    "apiId": "Rainmaker",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info,
                    "msgId": "1695889012604|en_IN",
                    "plainAccessRequest": {}
                },
                "Mdms": {
                    "tenantId": tenant,
                    "schemaCode": schema_code,
                    "uniqueIdentifier": unique_id,
                    "data": data_obj,
                    "isActive": True
                }
            }

            headers = {'Content-Type': 'application/json'}
            status_code = None
            error_message = None

            try:
                response = requests.post(url, json=payload, headers=headers)
                status_code = response.status_code
                response.raise_for_status()
                print(f"   [OK] [{i}/{len(data_list)}] {unique_id}")
                results['created'] += 1

            except requests.exceptions.HTTPError as e:
                status_code = e.response.status_code if hasattr(e.response, 'status_code') else 500
                error_text = e.response.text if hasattr(e.response, 'text') else str(e)
                error_message = error_text[:500]

                if 'already exists' in error_text.lower() or 'duplicate' in error_text.lower():
                    print(f"   [EXISTS] [{i}/{len(data_list)}] {unique_id}")
                    results['exists'] += 1
                    # DON'T add to failed_records - already exists is not a failure!
                else:
                    print(f"   [FAILED] [{i}/{len(data_list)}] {unique_id}")
                    print(f"   ERROR: {error_message}")
                    results['failed'] += 1
                    results['errors'].append({
                        'id': unique_id,
                        'error': error_message
                    })

                    # Store full record for Excel export - ONLY TRUE FAILURES
                    failed_record = data_obj.copy()
                    failed_record['_STATUS'] = 'FAILED'
                    failed_record['_STATUS_CODE'] = status_code
                    failed_record['_ERROR_MESSAGE'] = error_message
                    results['failed_records'].append(failed_record)

            except Exception as e:
                error_message = str(e)[:200]
                status_code = 404
                print(f"   [ERROR] [{i}/{len(data_list)}] {unique_id} - {error_message[:100]}")
                results['failed'] += 1
                results['errors'].append({
                    'id': unique_id,
                    'error': error_message
                })

                # Store full record for Excel export
                failed_record = data_obj.copy()
                failed_record['_STATUS'] = 'FAILED'
                failed_record['_STATUS_CODE'] = status_code
                failed_record['_ERROR_MESSAGE'] = error_message
                results['failed_records'].append(failed_record)

            time.sleep(0.1)

        # Summary
        print("="*60)
        print(f"[SUMMARY] Created: {results['created']}")
        print(f"[SUMMARY] Already Exists: {results['exists']}")
        print(f"[SUMMARY] Failed: {results['failed']}")

        if results['errors']:
            print(f"\n[ERRORS] Found {len(results['errors'])} error(s):")
            for err in results['errors'][:3]:
                print(f"   - {err['id']}: {err['error'][:80]}")

        # Generate error Excel if there are failures
        if results['failed_records'] and sheet_name:
            # Get reverse mapping if available
            dept_mapping = getattr(self, '_dept_code_to_name', None)
            error_file = self._generate_error_excel(results['failed_records'], schema_code, sheet_name, dept_mapping)
            results['error_file'] = error_file

        print("="*60)

        return results

    def _generate_error_excel(self, failed_records: List[Dict], schema_code: str, sheet_name: str, dept_code_to_name: Dict = None) -> str:
        """Append failed records to a single consolidated error Excel file

        Args:
            failed_records: List of failed data records with status info
            schema_code: Schema code for naming
            sheet_name: Sheet name for the error file
            dept_code_to_name: Reverse mapping from department codes to names

        Returns:
            str: Path to the error Excel file
        """
        try:
            import pandas as pd
            from datetime import datetime
            import os
            from openpyxl import load_workbook

            # Create errors directory if it doesn't exist
            error_dir = 'errors'
            os.makedirs(error_dir, exist_ok=True)

            # Use a single consolidated filename
            filename = f"{error_dir}/FAILED_RECORDS.xlsx"

            # Transform records back to Excel template format
            transformed_records = self._transform_to_excel_format(failed_records, schema_code, dept_code_to_name)

            # Flatten nested structures into readable columns
            flattened_records = []
            for record in transformed_records:
                flat_record = {}

                for key, value in record.items():
                    # Handle nested objects (like city, jurisdiction, etc.)
                    if isinstance(value, dict):
                        # Flatten nested dict with prefix
                        for nested_key, nested_value in value.items():
                            flat_record[f"{key}.{nested_key}"] = nested_value
                    # Handle lists (like tenants in citymodule, roles, etc.)
                    elif isinstance(value, list):
                        if len(value) > 0:
                            # For list of dicts (like tenants: [{'code': 'pg'}, {'code': 'pg.citya'}])
                            if isinstance(value[0], dict):
                                # Extract codes/names and join with comma
                                codes = [item.get('code', item.get('name', str(item))) for item in value]
                                flat_record[key] = ', '.join(str(c) for c in codes)
                            else:
                                # Simple list (like pincodes)
                                flat_record[key] = ', '.join(str(v) for v in value)
                        else:
                            flat_record[key] = ''
                    else:
                        flat_record[key] = value

                flattened_records.append(flat_record)

            # Convert to DataFrame
            df = pd.DataFrame(flattened_records)

            # Define columns to exclude (internal/auto-generated fields only)
            exclude_cols = [
                'active', 'isActive', 'tenantId', 'uniqueIdentifier'
            ]

            # Remove excluded columns
            cols_to_keep = [col for col in df.columns if col not in exclude_cols]
            df = df[cols_to_keep]

            # Reorder columns to put status columns at the END
            status_cols = ['_STATUS', '_STATUS_CODE', '_ERROR_MESSAGE']
            other_cols = [col for col in df.columns if col not in status_cols]
            df = df[other_cols + status_cols]

            # Check if file exists
            if os.path.exists(filename):
                # Append to existing file
                with pd.ExcelWriter(filename, engine='openpyxl', mode='a', if_sheet_exists='replace') as writer:
                    df.to_excel(writer, sheet_name=sheet_name, index=False)
            else:
                # Create new file
                df.to_excel(filename, sheet_name=sheet_name, index=False)

            # Apply sheet protection to error columns
            self._protect_error_columns(filename, sheet_name, len(other_cols))

            print(f"\n📊 ERROR REPORT UPDATED:")
            print(f"   File: {filename}")
            print(f"   Sheet: {sheet_name}")
            print(f"   Failed Records: {len(failed_records)}")
            print(f"   💡 Fix the errors and re-upload this file (Error columns are protected)")

            return filename

        except Exception as e:
            print(f"\n⚠️  Could not generate error Excel: {str(e)}")
            return None

    def _transform_to_excel_format(self, records: List[Dict], schema_code: str, dept_code_to_name: Dict = None) -> List[Dict]:
        """Transform API payload format back to Excel template format

        Args:
            records: List of records in API format
            schema_code: Schema code to determine transformation rules
            dept_code_to_name: Reverse mapping from department codes to names

        Returns:
            List of records in Excel template format
        """
        if dept_code_to_name is None:
            dept_code_to_name = {}

        transformed = []

        # Handle Departments - rename 'code' and 'name' to match template
        if 'Department' in schema_code:
            for record in records:
                excel_record = {
                    'Department Name*': record.get('name', ''),
                    '_STATUS': record.get('_STATUS'),
                    '_STATUS_CODE': record.get('_STATUS_CODE'),
                    '_ERROR_MESSAGE': record.get('_ERROR_MESSAGE')
                }
                transformed.append(excel_record)

        # Handle Designations - show department name instead of code
        elif 'Designation' in schema_code:
            for record in records:
                dept_code = record.get('departmentCode', '')
                dept_name = dept_code_to_name.get(dept_code, dept_code)

                excel_record = {
                    'Department Name*': dept_name,
                    'Designation Name*': record.get('name', ''),
                    '_STATUS': record.get('_STATUS'),
                    '_STATUS_CODE': record.get('_STATUS_CODE'),
                    '_ERROR_MESSAGE': record.get('_ERROR_MESSAGE')
                }
                transformed.append(excel_record)

        # Handle Complaint Types - show department name and extract complaint type/subtype
        elif 'ServiceDefs' in schema_code:
            for record in records:
                dept_code = record.get('department', '')
                dept_name = dept_code_to_name.get(dept_code, dept_code)

                excel_record = {
                    'Complaint Type*': record.get('menuPath', ''),
                    'Complaint sub type*': record.get('name', ''),
                    'Department Name*': dept_name,
                    'Resolution Time (Hours)*': record.get('slaHours', ''),
                    'Search Words (comma separated)*': record.get('keywords', ''),
                    'Priority': record.get('priority', ''),
                    '_STATUS': record.get('_STATUS'),
                    '_STATUS_CODE': record.get('_STATUS_CODE'),
                    '_ERROR_MESSAGE': record.get('_ERROR_MESSAGE')
                }
                transformed.append(excel_record)

        # Default: return records as-is (ensuring status fields are preserved)
        else:
            # Make sure status fields are always included
            for record in records:
                excel_record = record.copy()
                # Ensure status fields exist
                if '_STATUS' not in excel_record:
                    excel_record['_STATUS'] = record.get('_STATUS')
                if '_STATUS_CODE' not in excel_record:
                    excel_record['_STATUS_CODE'] = record.get('_STATUS_CODE')
                if '_ERROR_MESSAGE' not in excel_record:
                    excel_record['_ERROR_MESSAGE'] = record.get('_ERROR_MESSAGE')
                transformed.append(excel_record)

        return transformed

    def _protect_error_columns(self, filename: str, sheet_name: str, data_col_count: int):
        """Protect the error status columns (last 3 columns) in the Excel sheet

        Args:
            filename: Path to Excel file
            sheet_name: Sheet name to protect
            data_col_count: Number of data columns (non-error columns)
        """
        try:
            from openpyxl import load_workbook
            from openpyxl.styles import PatternFill, Font
            from openpyxl.utils import get_column_letter

            wb = load_workbook(filename)
            ws = wb[sheet_name]

            # Get total columns
            total_cols = ws.max_column

            # Error columns are the last 3 columns
            error_col_start = data_col_count + 1  # +1 because Excel is 1-indexed

            # Apply gray background and bold font to error column headers
            gray_fill = PatternFill(start_color="D3D3D3", end_color="D3D3D3", fill_type="solid")
            bold_font = Font(bold=True)

            for col_idx in range(error_col_start, total_cols + 1):
                col_letter = get_column_letter(col_idx)

                # Style header
                header_cell = ws[f'{col_letter}1']
                header_cell.fill = gray_fill
                header_cell.font = bold_font

                # Lock all cells in error columns (data + header)
                for row in range(1, ws.max_row + 1):
                    cell = ws[f'{col_letter}{row}']
                    cell.protection = cell.protection.copy(locked=True)

            # Unlock all data columns so users can edit them
            for col_idx in range(1, error_col_start):
                col_letter = get_column_letter(col_idx)
                for row in range(2, ws.max_row + 1):  # Skip header row
                    cell = ws[f'{col_letter}{row}']
                    cell.protection = cell.protection.copy(locked=False)

            # Protect the sheet (allow users to edit unlocked cells only)
            ws.protection.sheet = True
            ws.protection.password = ''  # Empty password (no password)
            ws.protection.selectLockedCells = True
            ws.protection.selectUnlockedCells = True

            wb.save(filename)

        except Exception as e:
            # Don't fail if protection doesn't work
            print(f"   ⚠️  Could not apply sheet protection: {str(e)}")

    def create_localization_messages(self, localization_list: List[Dict], tenant: str, sheet_name: str = 'Localization'):
        """Upload localization messages via localization service API"""
        url = f"{self.localization_url}/localization/messages/v1/_upsert"

        results = {
            'created': 0,
            'exists': 0,
            'failed': 0,
            'errors': [],
            'failed_records': []
        }

        print(f"\n[UPLOADING] Localization Messages")
        print(f"   Tenant: {tenant}")
        print(f"   Total Messages: {len(localization_list)}")
        print(f"   API URL: {url}")
        print("="*60)

        # Group messages by locale for batch upload
        from collections import defaultdict
        by_locale = defaultdict(list)
        for loc in localization_list:
            by_locale[loc['locale']].append(loc)

        print(f"\n   Found {len(by_locale)} locales: {', '.join(by_locale.keys())}")
        print("="*60)

        # Upload each locale batch
        for locale, messages in by_locale.items():
            payload = {
                "RequestInfo": {
                    "apiId": "emp",
                    "ver": "1.0",
                    "action": "create",
                    "msgId": f"{int(time.time() * 1000)}",
                    "authToken": self.auth_token,
                    "userInfo": self.user_info
                },
                "locale": locale,
                "tenantId": tenant,
                "messages": messages
            }

            headers = {'Content-Type': 'application/json'}
            status_code = None

            try:
                response = requests.post(url, json=payload, headers=headers)
                status_code = response.status_code
                response.raise_for_status()
                print(f"   [OK] Locale: {locale} - {len(messages)} messages uploaded")
                results['created'] += len(messages)

            except requests.exceptions.HTTPError as e:
                status_code = e.response.status_code if hasattr(e.response, 'status_code') else 500
                error_text = e.response.text if hasattr(e.response, 'text') else str(e)
                error_message = error_text[:400]

                # Check for duplicate/already exists errors
                if ('duplicate' in error_text.lower() or
                    'already exists' in error_text.lower() or
                    'DUPLICATE_RECORDS' in error_text or
                    'DuplicateMessageIdentityException' in error_text or
                    'unique_message_entry' in error_text.lower()):
                    print(f"   [EXISTS] Locale: {locale} - {len(messages)} messages already exist")
                    results['exists'] += len(messages)
                    # DON'T add to failed_records - already exists is not a failure!
                else:
                    # True failure
                    print(f"   [FAILED] Locale: {locale}")
                    print(f"   ERROR: {error_message}")
                    results['failed'] += len(messages)
                    results['errors'].append({
                        'locale': locale,
                        'count': len(messages),
                        'error': error_message
                    })

                    # Store failed messages for Excel export - ONLY TRUE FAILURES
                    for msg in messages:
                        failed_record = msg.copy()
                        failed_record['_STATUS'] = 'FAILED'
                        failed_record['_STATUS_CODE'] = status_code
                        failed_record['_ERROR_MESSAGE'] = error_message
                        results['failed_records'].append(failed_record)

            except Exception as e:
                error_message = str(e)[:200]
                status_code = 0
                print(f"   [ERROR] Locale: {locale} - {error_message}")
                results['failed'] += len(messages)
                results['errors'].append({
                    'locale': locale,
                    'count': len(messages),
                    'error': error_message
                })

                # Store failed messages for Excel export
                for msg in messages:
                    failed_record = msg.copy()
                    failed_record['_STATUS'] = 'FAILED'
                    failed_record['_STATUS_CODE'] = status_code
                    failed_record['_ERROR_MESSAGE'] = error_message
                    results['failed_records'].append(failed_record)

            time.sleep(0.2)

        # Summary
        print("="*60)
        print(f"[SUMMARY] Created: {results['created']}")
        print(f"[SUMMARY] Already Exists: {results['exists']}")
        print(f"[SUMMARY] Failed: {results['failed']}")

        if results['errors']:
            print(f"\n[ERRORS] Found {len(results['errors'])} error(s):")
            for err in results['errors']:
                print(f"   - Locale: {err['locale']} ({err['count']} messages)")
                print(f"     Error: {err['error'][:100]}")

        # Generate error Excel if there are failures
        if results['failed_records'] and sheet_name:
            error_file = self._generate_error_excel(results['failed_records'], 'localization.messages', sheet_name)
            results['error_file'] = error_file

        print("="*60)

        return results

    def create_boundary_hierarchy(self, hierarchy_data: Dict):
        """Create boundary hierarchy definition"""
        url = f"{self.boundary_url}/boundary-service/boundary-hierarchy-definition/_create"

        payload = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info,
                "msgId": "1695889012604|en_IN",
                "plainAccessRequest": {}
            },
            'BoundaryHierarchy': hierarchy_data
        }

        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            print(f"   [SUCCESS] Boundary hierarchy created")
            return response.json()
        except requests.exceptions.HTTPError as e:
            error_text = e.response.text if hasattr(e.response, 'text') else str(e)
            print(f"   [ERROR] Failed: HTTP {e.response.status_code}")
            print(f"   ERROR Details: {error_text[:500]}")
            raise
        except Exception as e:
            print(f"   [ERROR] Failed: {str(e)}")
            raise

    def create_boundary_entities(self, boundaries: List[Dict]):
        """Create boundary entities"""
        url = f"{self.boundary_url}/boundary-service/boundary/_create"

        payload = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info
            },
            'Boundary': clean_nans(boundaries)
        }

        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            print(f"   [SUCCESS] {len(boundaries)} boundary entities created")
            return response.json()
        except requests.exceptions.HTTPError as e:
            error_text = e.response.text if hasattr(e.response, 'text') else str(e)
            print(f"   [ERROR] Failed: HTTP {e.response.status_code}")
            print(f"   ERROR Details: {error_text[:500]}")
            raise
        except Exception as e:
            print(f"   [ERROR] Failed: {str(e)}")
            raise

    def create_boundary_relationship(self, relationship: Dict):
        """Create boundary relationship"""
        url = f"{self.boundary_url}/boundary-service/boundary-relationships/_create"

        payload = {
             "RequestInfo": {
        "apiId": "asset-services",
        "ver": None,
        "ts": None,
        "action": None,
        "did": None,
        "key": None,
        "msgId": "search with from and to values",
        "authToken": "das323223-21",
        "correlationId": None,
        "userInfo": {"id":30274,"uuid":"bd5f8ea6-a022-4e74-ac2c-edf3392c6fa4","userName":"MDMSADMIN","name":"MDMSADMIN","mobileNumber":"9035169726","emailId":None,"locale":None,"type":"EMPLOYEE","roles":[{"name":"Localisation admin","code":"LOC_ADMIN","tenantId":"pg"},{"name":"MDMS Admin","code":"MDMS_ADMIN","tenantId":"pg.citya"},{"name":"MDMS Admin","code":"MDMS_ADMIN","tenantId":"pg"}],"active":True,"tenantId":"pg","permanentCity":None}
    },
            'BoundaryRelationship': relationship
        }

        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()

            # Boundary relationships are processed asynchronously via Kafka
            # Wait 2 seconds to allow Kafka consumer to process and commit to DB
            time.sleep(2)

            return response.json()
        except requests.exceptions.HTTPError as e:
            error_text = e.response.text if hasattr(e.response, 'text') else str(e)
            raise Exception(f"HTTP {e.response.status_code}: {error_text}")
        except Exception as e:
            raise Exception(f"Request failed: {str(e)}")

    def create_workflow_businessservice(self, workflow_data: Dict):
        """Create workflow via Workflow-v2 API"""
        url = f"{self.workflow_url}/egov-workflow-v2/egov-wf/businessservice/_create"

        payload = {
            "RequestInfo": {
                "apiId": "Rainmaker",
                "authToken": self.auth_token,
                "userInfo": self.user_info,
                "msgId": f"{int(time.time() * 1000)}|en_IN",
                "plainAccessRequest": {}
            },
            "BusinessServices": [workflow_data]
        }

        headers = {'Content-Type': 'application/json'}

        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            print("   [SUCCESS] Workflow created successfully")
            return response.json()

        except requests.exceptions.HTTPError as e:
            error_text = e.response.text if hasattr(e.response, 'text') else str(e)
            if 'already exists' in error_text.lower() or 'duplicate' in error_text.lower():
                print("   [EXISTS] Workflow already exists")
                return {'success': True, 'exists': True}
            else:
                print(f"   [ERROR] Failed: {error_text[:200]}")
                raise

        except Exception as e:
            print(f"   [ERROR] Failed: {str(e)}")
            raise

    def update_tenant_language(self, tenant_ids: List[str], language_label: str, language_value: str, state_tenant: str = "pg"):
        """
        Update tenant data to add a new language

        Args:
            tenant_ids: List of tenant IDs to update (e.g., ['pg.citya', 'pg.cityb'])
            language_label: Display name of language (e.g., 'हिंदी', 'ਪੰਜਾਬੀ')
            language_value: Locale code (e.g., 'hi_IN', 'pa_IN')
            state_tenant: State tenant ID (default: 'pg')

        Returns:
            Dict with results of update operations
        """
        search_url = f"{self.mdms_url}/mdms-v2/v2/_search"
        update_url = f"{self.mdms_url}/mdms-v2/v2/_update/tenant.tenants"

        results = {
            'updated': 0,
            'failed': 0,
            'skipped': 0,
            'errors': []
        }

        print(f"\n[UPDATING TENANT LANGUAGES]")
        print(f"   Adding: {language_label} ({language_value})")
        print(f"   Tenants: {', '.join(tenant_ids)}")
        print("="*60)

        for i, tenant_id in enumerate(tenant_ids, 1):
            try:
                # Step 1: Search for existing tenant data
                search_payload = {
                    "MdmsCriteria": {
                        "tenantId": state_tenant,
                        "schemaCode": "tenant.tenants",
                        "uniqueIdentifiers": [tenant_id]
                    }
                }

                headers = {'Content-Type': 'application/json'}
                search_response = requests.post(search_url, json=search_payload, headers=headers)
                search_response.raise_for_status()
                search_data = search_response.json()

                # Check if tenant exists
                if not search_data.get('mdms') or len(search_data['mdms']) == 0:
                    print(f"   [SKIP] [{i}/{len(tenant_ids)}] {tenant_id} - Tenant not found")
                    results['skipped'] += 1
                    results['errors'].append({
                        'tenant': tenant_id,
                        'error': 'Tenant not found in database'
                    })
                    continue

                mdms_record = search_data['mdms'][0]
                tenant_data = mdms_record['data']

                # Step 2: Check if language already exists
                existing_languages = tenant_data.get('languages', [])
                language_exists = any(
                    lang.get('value') == language_value
                    for lang in existing_languages
                )

                if language_exists:
                    print(f"   [EXISTS] [{i}/{len(tenant_ids)}] {tenant_id} - Language already exists")
                    results['skipped'] += 1
                    continue

                # Step 3: Add new language to the list
                new_language = {
                    "label": language_label,
                    "value": language_value
                }
                tenant_data['languages'] = existing_languages + [new_language]

                # Step 4: Update tenant with new language
                update_payload = {
                    "RequestInfo": {
                        "apiId": "asset-services",
                        "msgId": "update-language",
                        "authToken": self.auth_token,
                        "userInfo": self.user_info
                    },
                    "Mdms": {
                        "tenantId": state_tenant,
                        "schemaCode": "tenant.tenants",
                        "id": mdms_record['id'],
                        "data": tenant_data,
                        "auditDetails": mdms_record['auditDetails'],
                        "isActive": mdms_record['isActive']
                    }
                }

                update_response = requests.post(update_url, json=update_payload, headers=headers)
                update_response.raise_for_status()

                print(f"   [OK] [{i}/{len(tenant_ids)}] {tenant_id} - Language added successfully")
                results['updated'] += 1

            except requests.exceptions.HTTPError as e:
                error_text = e.response.text if hasattr(e.response, 'text') else str(e)
                print(f"   [FAILED] [{i}/{len(tenant_ids)}] {tenant_id}")
                print(f"   ERROR: {error_text[:200]}")
                results['failed'] += 1
                results['errors'].append({
                    'tenant': tenant_id,
                    'error': error_text[:200]
                })

            except Exception as e:
                print(f"   [ERROR] [{i}/{len(tenant_ids)}] {tenant_id} - {str(e)[:100]}")
                results['failed'] += 1
                results['errors'].append({
                    'tenant': tenant_id,
                    'error': str(e)[:200]
                })

            time.sleep(0.2)

        # Summary
        print("="*60)
        print(f"[SUMMARY] Updated: {results['updated']}")
        print(f"[SUMMARY] Skipped: {results['skipped']}")
        print(f"[SUMMARY] Failed: {results['failed']}")

        if results['errors']:
            print(f"\n[ERRORS] Found {len(results['errors'])} error(s):")
            for err in results['errors'][:5]:
                print(f"   - {err['tenant']}: {err['error'][:80]}")

        print("="*60)

        return results
