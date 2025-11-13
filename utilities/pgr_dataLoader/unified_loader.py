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

    def read_tenants(self):
        """Read tenant data from Tenants sheet"""
        df = pd.read_excel(self.excel_file, sheet_name='Tenants')

        if len(df) == 0:
            return []

        tenants = []
        for _, row in df.iterrows():
            # Parse pincodes
            pincodes = []
            if pd.notna(row['Pincode (comma separated)']):
                pincodes = [int(p.strip()) for p in str(row['Pincode (comma separated)']).split(',')]

            # Build office timings
            office_timings = {}
            if pd.notna(row['Office Timings Weekday']):
                office_timings['Mon - Fri'] = row['Office Timings Weekday']
            if pd.notna(row['Office Timings Saturday']):
                office_timings['Sat'] = row['Office Timings Saturday']

            # Build city object
            city = {
                'code': str(row['City Code']),
                'name': row['City Name'],
                'ulbGrade': row['City ULB Grade'],
                'districtCode': row['City District Code'] if pd.notna(row['City District Code']) else None,
                'districtName': row['City District Name'] if pd.notna(row['City District Name']) else None,
                'districtTenantCode': row['City District Tenant Code'],
                'ddrName': row['City DDR Name'] if pd.notna(row['City DDR Name']) else None,
                'latitude': float(row['City Latitude']),
                'longitude': float(row['City Longitude']),
                'regionName': row['City Region Name'] if pd.notna(row['City Region Name']) else None,
                'blockCode': row['City Block Code'] if pd.notna(row['City Block Code']) else None,
                'localName': row['City Local Name'] if pd.notna(row['City Local Name']) else None,
                'shapeFileLocation': row['City Shape File Location'] if pd.notna(row['City Shape File Location']) else None,
                'captcha': row['City Captcha'] if pd.notna(row['City Captcha']) else None
            }

            # Build tenant object
            tenant = {
                'code': row['Tenant Code'],
                'name': row['Tenant Name'],
                'type': row['Tenant Type'],
                'emailId': row['Email'],
                'contactNumber': row['Contact Number'],
                'address': row['Address'],
                'domainUrl': row['Domain URL'],
                'logoId': row['Logo URL'],
                'imageId': row['Image ID'] if pd.notna(row['Image ID']) else None,
                'description': row['Description'] if pd.notna(row['Description']) else None,
                'twitterUrl': row['Twitter URL'] if pd.notna(row['Twitter URL']) else None,
                'facebookUrl': row['Facebook URL'] if pd.notna(row['Facebook URL']) else None,
                'OfficeTimings': office_timings,
                'city': city
            }

            # Add helpline if present
            if pd.notna(row['Helpline Number']):
                tenant['helpLineNumber'] = row['Helpline Number']

            # Add pincodes if present
            if pincodes:
                tenant['pincode'] = pincodes

            tenants.append(tenant)

        return tenants

    def read_city_modules(self):
        """Read city module configuration"""
        df = pd.read_excel(self.excel_file, sheet_name='City_Modules')

        if len(df) == 0:
            return []

        modules = []
        for _, row in df.iterrows():
            # Parse tenant codes
            tenant_codes = []
            if pd.notna(row.get('Enabled Tenant Codes')):
                tenant_codes = [{'code': code.strip()} for code in str(row['Enabled Tenant Codes']).split(',')]

            module = {
                'code': row['Module Code'],
                'module': row['Module Name'],
                'order': int(row['Order']),
                'active': True,  # Default to True (no Active column in Excel)
                'tenants': tenant_codes
            }

            modules.append(module)

        return modules

    def read_departments(self):
        """Read departments"""
        df = pd.read_excel(self.excel_file, sheet_name='Departments')

        departments = []
        for _, row in df.iterrows():
            departments.append({
                'code': row['Department Code'],
                'name': row['Department Name'],
                'active': True,  # Default to True (no Active column in Excel)
            })

        return departments

    def read_designations(self):
        """Read designations"""
        df = pd.read_excel(self.excel_file, sheet_name='Designations')

        designations = []
        for _, row in df.iterrows():
            designations.append({
                'code': row['Designation Code'],
                'name': row['Designation Name'],
                'departmentCode': row['Department Code'],
                'active': True,  # Default to True (no Active column in Excel)
                'description': row.get('Description', '')
            })

        return designations

    def read_complaint_types(self):
        """Read complaint types"""
        df = pd.read_excel(self.excel_file, sheet_name='ComplaintTypes')

        complaint_types = []
        for _, row in df.iterrows():
            ct = {
                'serviceCode': row['Service Code'],
                'name': row['Complaint Name'],
                'menuPath': row['Category/Menu Path'],
                'active': True
            }

            # Add optional fields
            if pd.notna(row.get('Department Code')):
                ct['department'] = row['Department Code']
            if pd.notna(row.get('SLA Hours')):
                ct['slaHours'] = int(row['SLA Hours'])
            if pd.notna(row.get('Keywords (comma separated)')):
                ct['keywords'] = row['Keywords (comma separated)']
            if pd.notna(row.get('Priority')):
                ct['priority'] = row['Priority']

            complaint_types.append(ct)

        return complaint_types

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
        """Read localization - long format with one row per translation"""
        df = pd.read_excel(self.excel_file, sheet_name='localization')

        if len(df) == 0:
            return []

        localizations = []

        # Long format: Code, Message, Module, Locale (one row per translation)
        for _, row in df.iterrows():
            # Skip rows with missing required fields
            if pd.notna(row.get('Code')) and pd.notna(row.get('Message')) and pd.notna(row.get('Module')) and pd.notna(row.get('Locale')):
                localizations.append({
                    'code': str(row['Code']),
                    'message': str(row['Translation']),
                    'module': str(row['Module']),
                    'locale': str(row['Locale'])
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

    def create_mdms_data(self, schema_code: str, data_list: List[Dict], tenant: str):
        """Generic function to create MDMS v2 data"""
        url = f"{self.mdms_url}/mdms-v2/v2/_create/{{schema_code}}"

        results = {
            'created': 0,
            'exists': 0,
            'failed': 0,
            'errors': []
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

            try:
                response = requests.post(url, json=payload, headers=headers)
                response.raise_for_status()
                print(f"   [OK] [{i}/{len(data_list)}] {unique_id}")
                results['created'] += 1

            except requests.exceptions.HTTPError as e:
                error_text = e.response.text if hasattr(e.response, 'text') else str(e)

                if 'already exists' in error_text.lower() or 'duplicate' in error_text.lower():
                    print(f"   [EXISTS] [{i}/{len(data_list)}] {unique_id}")
                    results['exists'] += 1
                else:
                    print(f"   [FAILED] [{i}/{len(data_list)}] {unique_id}")
                    print(f"   ERROR: {error_text[:500]}")
                    results['failed'] += 1
                    results['errors'].append({
                        'id': unique_id,
                        'error': error_text[:500]
                    })

            except Exception as e:
                print(f"   [ERROR] [{i}/{len(data_list)}] {unique_id} - {str(e)[:100]}")
                results['failed'] += 1
                results['errors'].append({
                    'id': unique_id,
                    'error': str(e)[:200]
                })

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

        print("="*60)

        return results

    def create_localization_messages(self, localization_list: List[Dict], tenant: str):
        """Upload localization messages via localization service API"""
        url = f"{self.localization_url}/localization/messages/v1/_upsert"

        results = {
            'created': 0,
            'failed': 0,
            'errors': []
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

            try:
                response = requests.post(url, json=payload, headers=headers)
                response.raise_for_status()
                print(f"   [OK] Locale: {locale} - {len(messages)} messages uploaded")
                results['created'] += len(messages)

            except requests.exceptions.HTTPError as e:
                error_text = e.response.text if hasattr(e.response, 'text') else str(e)
                print(f"   [FAILED] Locale: {locale}")
                print(f"   ERROR: {error_text[:400]}")
                results['failed'] += len(messages)
                results['errors'].append({
                    'locale': locale,
                    'count': len(messages),
                    'error': error_text[:400]
                })

            except Exception as e:
                print(f"   [ERROR] Locale: {locale} - {str(e)[:200]}")
                results['failed'] += len(messages)
                results['errors'].append({
                    'locale': locale,
                    'count': len(messages),
                    'error': str(e)[:200]
                })

            time.sleep(0.2)

        # Summary
        print("="*60)
        print(f"[SUMMARY] Created: {results['created']}")
        print(f"[SUMMARY] Failed: {results['failed']}")

        if results['errors']:
            print(f"\n[ERRORS] Found {len(results['errors'])} error(s):")
            for err in results['errors']:
                print(f"   - Locale: {err['locale']} ({err['count']} messages)")
                print(f"     Error: {err['error'][:100]}")

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
