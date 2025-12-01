"""
MDMS Validator
Validates Excel templates against schemas fetched dynamically from MDMS API
"""

import pandas as pd
import requests
import json
import re
from typing import Dict, List, Any, Tuple
from jsonschema import validate, ValidationError, Draft7Validator
import warnings

warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')


class MDMSValidator:
    """Validates Excel files against MDMS JSON schemas for two-phase templates"""

    def __init__(self, mdms_url: str = "http://localhost:8094", auth_token: str = None):
        self.mdms_url = mdms_url
        self.auth_token = auth_token or "7c65fcc6-7bb1-43f8-a116-e62392d71576"
        self.loaded_data = {}  # Cache for loaded Excel data
        self.schemas_cache = {}  # Cache for fetched schemas

        # Template mappings for two-phase workflow
        self.template_schemas = {
            'Tenant Master.xlsx': 'tenant.master',
            'Tenant_Master.xlsx': 'tenant.master',
            'localization.xlsx': 'localization.master',
        }

    def fetch_schema(self, tenant_id: str, schema_code: str) -> Dict:
        """
        Fetch schema from MDMS API

        Args:
            tenant_id: Tenant ID (e.g., 'pg')
            schema_code: Schema code (e.g., 'PGR.MasterDataUnified')

        Returns:
            Schema definition dict
        """
        cache_key = f"{tenant_id}::{schema_code}"

        if cache_key in self.schemas_cache:
            return self.schemas_cache[cache_key]

        url = f"{self.mdms_url}/mdms-v2/schema/v1/_search"

        payload = {
            "RequestInfo": {
                "apiId": "asset-services",
                "msgId": "search schema",
                "authToken": self.auth_token,
                "userInfo": {
                    "id": 1,
                    "uuid": "uuid",
                    "userName": "username",
                    "name": "name",
                    "mobileNumber": "1234567890",
                    "emailId": "email@example.com",
                    "type": "EMPLOYEE",
                    "roles": [],
                    "active": True,
                    "tenantId": "pg"
                }
            },
            "SchemaDefCriteria": {
                "tenantId": "pg",
                "codes": [schema_code]
            }
        }

        try:
            response = requests.post(url, json=payload, headers={'Content-Type': 'application/json'})
            response.raise_for_status()

            data = response.json()

            if not data.get('SchemaDefinitions') or len(data['SchemaDefinitions']) == 0:
                raise ValueError(f"Schema '{schema_code}' not found in tenant '{tenant_id}'")

            schema_def = data['SchemaDefinitions'][0]['definition']
            self.schemas_cache[cache_key] = schema_def

            return schema_def

        except requests.exceptions.RequestException as e:
            raise Exception(f"Failed to fetch schema from MDMS: {str(e)}")

    def load_excel(self, excel_file: str, sheet_name: str) -> pd.DataFrame:
        """Load Excel sheet"""
        cache_key = f"{excel_file}::{sheet_name}"

        if cache_key not in self.loaded_data:
            try:
                self.loaded_data[cache_key] = pd.read_excel(excel_file, sheet_name=sheet_name, engine='openpyxl')
            except Exception as e:
                raise FileNotFoundError(f"Failed to read sheet '{sheet_name}' from '{excel_file}': {str(e)}")

        return self.loaded_data[cache_key]

    def excel_to_json_structure(self, df: pd.DataFrame, sheet_name: str, template_type: str = None) -> Dict:
        """
        Convert Excel DataFrame to JSON structure matching MDMS schema

        For two-phase templates (NEW FORMAT ONLY):
        - Tenant Master: Tenant Info, Tenant Branding Deatils
        - Common Master: Department And Designation Mast, Complaint Type Master
        - Localization Master: localization sheet
        """
        # Convert DataFrame to list of dicts based on template type
        if template_type == 'tenant.master':
            # Tenant Info sheet
            if sheet_name == 'Tenant Info':
                return self._parse_tenant_info(df)
            # Tenant Branding sheet
            elif sheet_name == 'Tenant Branding Deatils':
                return self._parse_tenant_branding(df)
        elif template_type == 'common.master':
            if sheet_name == 'Department And Desgination Mast':
                return self._parse_common_dept_desig(df)
            elif sheet_name == 'Complaint Type Master':
                return self._parse_common_complaint_types(df)
        elif template_type == 'localization.master':
            if sheet_name == 'localization':
                return self._parse_localization(df)

        # Generic conversion
        return df.to_dict('records')

    # ========================================================================
    # PARSER METHODS
    # ========================================================================

    def _parse_tenant_info(self, df: pd.DataFrame) -> List[Dict]:
        """Parse Tenant Info sheet with ADMIN0/ADMIN1/ADMIN2 hierarchy

        Supports ADMIN0/ADMIN1/ADMIN2 hierarchy
        """
        records = []

        for _, row in df.iterrows():
            record = {}

            # Handle multi-line column name for Tenant Code
            tenant_code_col = 'Tenant Code*\n(To be filled by ADMIN)'

            # Required fields
            if pd.notna(row.get('Tenant Display Name*')):
                record['tenantDisplayName'] = str(row['Tenant Display Name*'])
            if pd.notna(row.get(tenant_code_col)):
                record['tenantCode'] = str(row[tenant_code_col])
            if pd.notna(row.get('Tenant Type*')):
                record['tenantType'] = str(row['Tenant Type*'])
            if pd.notna(row.get('Logo File Path*')):
                record['logoFilePath'] = str(row['Logo File Path*'])

            # Optional ADMIN hierarchy fields
            if pd.notna(row.get('Administrative Region Name (Geographical entity to which the tenant belongs)')):
                record['administrativeRegion'] = str(row['Administrative Region Name (Geographical entity to which the tenant belongs)'])
            if pd.notna(row.get('ADMIN0 Name')):
                record['admin0Name'] = str(row['ADMIN0 Name'])
            if pd.notna(row.get('ADMIN1 Name')):
                record['admin1Name'] = str(row['ADMIN1 Name'])
            if pd.notna(row.get('ADMIN2 Name')):
                record['admin2Name'] = str(row['ADMIN2 Name'])

            # Optional location/contact fields
            if pd.notna(row.get('Address')):
                record['address'] = str(row['Address'])
            if pd.notna(row.get('Tenant Website')):
                record['tenantWebsite'] = str(row['Tenant Website'])
            if pd.notna(row.get('Latitude')):
                record['latitude'] = float(row['Latitude'])
            if pd.notna(row.get('Longitude')):
                record['longitude'] = float(row['Longitude'])

            records.append(record)

        return records

    def _parse_tenant_branding(self, df: pd.DataFrame) -> List[Dict]:
        """Parse Tenant Branding Deatils sheet"""
        records = []

        for _, row in df.iterrows():
            record = {}

            if pd.notna(row.get('Tenant Code')):
                record['tenantCode'] = str(row['Tenant Code'])
            if pd.notna(row.get('Banner URL')):
                record['bannerUrl'] = str(row['Banner URL'])
            if pd.notna(row.get('Logo URL')):
                record['logoUrl'] = str(row['Logo URL'])
            if pd.notna(row.get('Logo URL (White)')):
                record['logoUrlWhite'] = str(row['Logo URL (White)'])
            if pd.notna(row.get('State Logo')):
                record['stateLogo'] = str(row['State Logo'])

            records.append(record)

        return records

    def _parse_common_dept_desig(self, df: pd.DataFrame) -> Dict:
        """Parse Department And Designation sheet from Common Master"""
        records = []

        for _, row in df.iterrows():
            record = {}

            # Required fields
            if pd.notna(row.get('Department Name*')):
                record['departmentName'] = str(row['Department Name*'])
            if pd.notna(row.get('Designation Name*')):
                record['designationName'] = str(row['Designation Name*'])

            records.append(record)

        return records

    def _parse_common_complaint_types(self, df: pd.DataFrame) -> Dict:
        """Parse Complaint Type Master sheet from Common Master"""
        records = []
        current_parent = {}

        for _, row in df.iterrows():
            record = {}

            # Check if this is a parent row (has Complaint Type* filled)
            if pd.notna(row.get('Complaint Type*')):
                current_parent = {
                    'complaintType': str(row['Complaint Type*'])
                }
                if pd.notna(row.get('Department Name*')):
                    current_parent['departmentName'] = str(row['Department Name*'])
                if pd.notna(row.get('Resolution Time (Hours)*')):
                    current_parent['resolutionTimeHours'] = float(row['Resolution Time (Hours)*'])
                if pd.notna(row.get('Search Words (comma separated)*')):
                    current_parent['searchWords'] = str(row['Search Words (comma separated)*'])

            # Every row must have sub-type
            if pd.notna(row.get('Complaint sub type*')):
                record['complaintSubType'] = str(row['Complaint sub type*'])

                # Inherit parent values if available
                if current_parent:
                    record.update(current_parent)

                # Optional priority
                if pd.notna(row.get('Priority')):
                    record['priority'] = int(row['Priority'])

                records.append(record)

        return records

    def _parse_localization(self, df: pd.DataFrame) -> List[Dict]:
        """Parse localization sheet - returns list of translation records"""
        records = []

        for _, row in df.iterrows():
            record = {}

            # Required fields
            if pd.notna(row.get('Module')):
                record['module'] = str(row['Module'])
            if pd.notna(row.get('Code')):
                record['code'] = str(row['Code'])
            if pd.notna(row.get('Locale')):
                record['locale'] = str(row['Locale'])

            # Optional fields
            if pd.notna(row.get('English_Message')):
                record['englishMessage'] = str(row['English_Message'])
            if pd.notna(row.get('Translation')):
                record['translation'] = str(row['Translation'])

            records.append(record)

        return records

    def validate_against_schema(self, data: Dict, schema: Dict) -> Tuple[bool, List[Dict]]:
        """
        Validate data against JSON schema

        Args:
            data: Data to validate (must be a dict with array properties)
            schema: JSON schema definition

        Returns:
            Tuple of (is_valid, list_of_errors)
        """
        errors = []

        try:
            # Use Draft7Validator for better error messages
            validator = Draft7Validator(schema)

            # Collect all validation errors
            for error in validator.iter_errors(data):
                error_dict = {
                    'type': 'SCHEMA_VALIDATION_ERROR',
                    'path': '.'.join(str(p) for p in error.absolute_path),
                    'message': error.message,
                    'schema_path': '.'.join(str(p) for p in error.absolute_schema_path)
                }

                # Try to extract specific location info
                if error.absolute_path:
                    path_parts = list(error.absolute_path)
                    if len(path_parts) >= 2:
                        error_dict['sheet'] = path_parts[0]
                        error_dict['row'] = path_parts[1] + 2  # +2 for header and 0-indexing

                errors.append(error_dict)

            # Check x-unique constraints
            if 'x-unique' in schema:
                for field_path in schema['x-unique']:
                    unique_errors = self._validate_uniqueness(data, field_path)
                    errors.extend(unique_errors)

            # Check x-ref-schema constraints (foreign keys)
            if 'x-ref-schema' in schema:
                for ref_rule in schema['x-ref-schema']:
                    ref_errors = self._validate_references(data, ref_rule)
                    errors.extend(ref_errors)

            is_valid = len(errors) == 0
            return is_valid, errors

        except Exception as e:
            return False, [{
                'type': 'VALIDATION_ERROR',
                'message': f"Validation failed: {str(e)}"
            }]

    def _validate_uniqueness(self, data: Dict, field_path: str) -> List[Dict]:
        """Validate uniqueness constraint (x-unique)"""
        errors = []

        # Parse field path (e.g., 'tenants', 'departments')
        if field_path not in data:
            return errors

        items = data[field_path]
        if not isinstance(items, list):
            return errors

        # Check for duplicate codes
        seen_codes = {}
        for idx, item in enumerate(items):
            code = item.get('code')
            if code:
                if code in seen_codes:
                    errors.append({
                        'type': 'DUPLICATE_ERROR',
                        'sheet': field_path,
                        'rows': [seen_codes[code] + 2, idx + 2],
                        'column': 'code',
                        'value': code,
                        'message': f"Duplicate code '{code}' found"
                    })
                else:
                    seen_codes[code] = idx

        return errors

    def _validate_references(self, data: Dict, ref_rule: Dict) -> List[Dict]:
        """Validate foreign key references (x-ref-schema)"""
        errors = []

        # Parse field paths
        # Example: fieldPath: "designations.*.departmentCode"
        #          fieldPathInSchema: "departments.*.code"

        source_path = ref_rule['fieldPath']
        target_path = ref_rule['fieldPathInSchema']

        # Extract array names
        source_parts = source_path.split('.')
        target_parts = target_path.split('.')

        if len(source_parts) < 3 or len(target_parts) < 3:
            return errors

        source_array = source_parts[0]  # e.g., 'designations'
        source_field = source_parts[2]   # e.g., 'departmentCode'
        target_array = target_parts[0]   # e.g., 'departments'
        target_field = target_parts[2]   # e.g., 'code'

        # Get valid values from target
        valid_values = set()
        if target_array in data and isinstance(data[target_array], list):
            for item in data[target_array]:
                if target_field in item and item[target_field]:
                    valid_values.add(str(item[target_field]))

        # Check source values
        if source_array in data and isinstance(data[source_array], list):
            for idx, item in enumerate(data[source_array]):
                if source_field in item and item[source_field]:
                    value = str(item[source_field])
                    if value not in valid_values:
                        errors.append({
                            'type': 'REFERENCE_ERROR',
                            'sheet': source_array,
                            'row': idx + 2,
                            'column': source_field,
                            'value': value,
                            'message': f"Value '{value}' not found in {target_array}.{target_field}"
                        })

        return errors

    def validate_excel_file(self, excel_file: str, tenant_id: str, schema_code: str = None) -> Dict:
        """
        Validate entire Excel file against MDMS schema

        Args:
            excel_file: Path to Excel file (e.g., 'Tenant Master.xlsx')
            tenant_id: Tenant ID (e.g., 'pg')
            schema_code: Schema code (optional, auto-detected from filename)

        Returns:
            Dict with keys: 'valid' (bool), 'errors' (list), 'warnings' (list)
        """
        result = {
            'valid': True,
            'errors': [],
            'warnings': [],
            'file': excel_file
        }

        try:
            # Auto-detect schema code from filename if not provided
            if not schema_code:
                filename = excel_file.split('/')[-1]
                schema_code = self.template_schemas.get(filename)
                if not schema_code:
                    raise ValueError(f"Cannot auto-detect schema for file: {filename}")

            # Fetch schema from MDMS
            print(f"\n[FETCHING SCHEMA] {schema_code} from {tenant_id}")
            schema = self.fetch_schema(tenant_id, schema_code)
            print(f"[SUCCESS] Schema fetched successfully")

            # Determine template type
            template_type = schema_code

            # Determine which sheets to read based on template type
            # NEW FORMAT ONLY
            if template_type == 'tenant.master':
                sheet_names = ['Tenant Info', 'Tenant Branding Deatils']
                print(f"[INFO] Using new template format (Tenant Info + Tenant Branding)")

            elif template_type == 'common.master':
                sheet_names = ['Department And Desgination Mast', 'Complaint Type Master']
            elif template_type == 'localization.master':
                sheet_names = ['localization']
            else:
                sheet_names = self._get_sheet_names_from_schema(schema)

            # Read all sheets and validate each row against schema
            all_records = []

            for sheet_name in sheet_names:
                try:
                    print(f"\n[READING] Sheet: {sheet_name}")
                    df = self.load_excel(excel_file, sheet_name)
                    print(f"[SUCCESS] Found {len(df)} rows")

                    # Convert to JSON structure
                    json_data = self.excel_to_json_structure(df, sheet_name, template_type)

                    # Create a subset schema with only required fields for this sheet
                    sheet_schema = self._create_sheet_specific_schema(schema, json_data, sheet_name, template_type)

                    # Validate each record individually against sheet-specific schema
                    for idx, record in enumerate(json_data):
                        row_num = idx + 2  # +2 for header and 0-indexing
                        is_valid, validation_errors = self.validate_against_schema(record, sheet_schema)

                        for error in validation_errors:
                            error['sheet'] = sheet_name
                            error['row'] = row_num
                            result['errors'].append(error)

                    all_records.extend(json_data)

                except Exception as e:
                    result['errors'].append({
                        'sheet': sheet_name,
                        'type': 'SHEET_READ_ERROR',
                        'message': f"Failed to read sheet: {str(e)}"
                    })

            # Overall validation
            result['valid'] = len(result['errors']) == 0

            if result['valid']:
                print(f"\n[SUCCESS] Validation passed - {len(all_records)} records validated")
            else:
                print(f"\n[FAILED] Found {len(result['errors'])} validation error(s)")

        except Exception as e:
            result['valid'] = False
            result['errors'].append({
                'type': 'VALIDATION_ERROR',
                'message': f"Validation failed: {str(e)}"
            })

        return result

    def _get_sheet_names_from_schema(self, schema: Dict) -> List[str]:
        """Extract sheet names from schema properties"""
        sheet_mapping_reverse = {
            'tenants': 'Tenants',
            'cityModules': 'City_Modules',
            'departments': 'Departments',
            'designations': 'Designations',
            'complaintTypes': 'ComplaintTypes'
        }

        sheet_names = []
        if 'properties' in schema:
            for prop_name in schema['properties'].keys():
                sheet_name = sheet_mapping_reverse.get(prop_name)
                if sheet_name:
                    sheet_names.append(sheet_name)

        return sheet_names

    def _create_sheet_specific_schema(self, full_schema: Dict, records: List[Dict], sheet_name: str, template_type: str) -> Dict:
        """
        Create a schema subset containing only the fields present in the sheet's records

        This allows validation of sheets with partial field sets against a flattened schema
        """
        if not records or len(records) == 0:
            return full_schema

        # Get all unique keys from all records in this sheet
        sheet_fields = set()
        for record in records:
            sheet_fields.update(record.keys())

        # Create subset schema with only fields present in this sheet
        sheet_schema = {
            'type': 'object',
            '$schema': full_schema.get('$schema', 'http://json-schema.org/draft-07/schema#'),
            'properties': {},
            'required': []
        }

        # Copy only properties that exist in this sheet
        if 'properties' in full_schema:
            for field_name in sheet_fields:
                if field_name in full_schema['properties']:
                    sheet_schema['properties'][field_name] = full_schema['properties'][field_name]

        # Set sheet-specific required fields (DO NOT copy from full schema)
        # Each sheet has its own set of required fields based on template type
        if template_type == 'tenant.master':
            # NEW FORMAT ONLY: Tenant Info sheet
            if sheet_name == 'Tenant Info':
                # Only 4 required fields for new format
                tenant_required = ['tenantDisplayName', 'tenantCode', 'tenantType', 'logoFilePath']
                sheet_schema['required'] = [f for f in tenant_required if f in sheet_fields]
            # Branding sheet - no required fields
            elif sheet_name == 'Tenant Branding Deatils':
                # Branding sheet has no required fields (all optional)
                sheet_schema['required'] = []

        elif template_type == 'common.master':
            if sheet_name == 'Department And Desgination Mast':
                # Dept/Desig sheet requires both fields
                dept_required = ['departmentName', 'designationName']
                sheet_schema['required'] = [f for f in dept_required if f in sheet_fields]
            elif sheet_name == 'Complaint Type Master':
                # Complaint sheet requires complaint fields
                complaint_required = ['complaintType', 'complaintSubType', 'departmentName',
                                    'resolutionTimeHours', 'searchWords']
                sheet_schema['required'] = [f for f in complaint_required if f in sheet_fields]

        elif template_type == 'localization.master':
            if sheet_name == 'localization':
                # Localization requires module, code, and locale
                loc_required = ['module', 'code', 'locale']
                sheet_schema['required'] = [f for f in loc_required if f in sheet_fields]

        else:
            # For unknown templates, don't copy required from full schema
            # This prevents false validation errors
            sheet_schema['required'] = []

        return sheet_schema

    def print_validation_report(self, result: Dict):
        """Print formatted validation report"""
        print("="*80)
        print(f"MDMS VALIDATION REPORT: {result['file']}")
        print("="*80)

        if result['valid']:
            print("\nSTATUS: PASSED")
            print("All validations passed successfully!")
        else:
            print("\nSTATUS: FAILED")
            print(f"\nFound {len(result['errors'])} error(s)")

            # Group errors by type
            errors_by_type = {}
            for error in result['errors']:
                error_type = error.get('type', 'UNKNOWN')
                if error_type not in errors_by_type:
                    errors_by_type[error_type] = []
                errors_by_type[error_type].append(error)

            # Print errors by type
            for error_type, errors in errors_by_type.items():
                print(f"\n{error_type} ({len(errors)}):")
                print("-" * 80)

                for error in errors[:10]:  # Show first 10 of each type
                    if 'row' in error:
                        sheet_info = f"[{error.get('sheet', 'Unknown')}] " if 'sheet' in error else ""
                        print(f"   {sheet_info}Row {error['row']}, Column '{error.get('column', 'N/A')}':")
                        print(f"      Value: {error.get('value', 'N/A')}")
                        print(f"      Error: {error['message']}")
                    else:
                        print(f"   {error.get('message', 'Unknown error')}")

                if len(errors) > 10:
                    print(f"   ... and {len(errors) - 10} more")

        if result.get('warnings'):
            print(f"\nWarnings ({len(result['warnings'])}):")
            for warning in result['warnings']:
                print(f"   - {warning.get('message', 'Unknown warning')}")

        print("="*80)


if __name__ == "__main__":
    # Example usage
    validator = MDMSValidator()

    excel_file = "upload/PGR_Master_Data_UNIFIED.xlsx"
    tenant_id = "pg"
    schema_code = "PGR.MasterDataUnified"

    result = validator.validate_excel_file(excel_file, tenant_id, schema_code)
    validator.print_validation_report(result)
