"""
Excel Template Validator
Validates Excel templates against YAML schema definitions
"""

import pandas as pd
import yaml
import os
import re
import json
import warnings
from typing import Dict, List, Any, Tuple
from pathlib import Path

# Suppress openpyxl data validation warnings
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')


class ExcelValidator:
    """Validates Excel files against YAML schemas"""

    def __init__(self, schemas_dir: str = "schemas", templates_dir: str = "templates"):
        self.schemas_dir = schemas_dir
        self.templates_dir = templates_dir
        self.loaded_data = {}  # Cache for loaded Excel data

    def load_schema(self, schema_file: str) -> Dict:
        """Load YAML schema file"""
        schema_path = os.path.join(self.schemas_dir, schema_file)
        with open(schema_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f)

    def load_excel(self, excel_file: str, sheet_name: str) -> pd.DataFrame:
        """Load Excel sheet"""
        cache_key = f"{excel_file}::{sheet_name}"

        if cache_key not in self.loaded_data:
            excel_path = os.path.join(self.templates_dir, excel_file)
            if not os.path.exists(excel_path):
                raise FileNotFoundError(f"Excel file not found: {excel_path}")

            self.loaded_data[cache_key] = pd.read_excel(excel_path, sheet_name=sheet_name)

        return self.loaded_data[cache_key]

    def validate_column_type(self, value: Any, col_schema: Dict) -> Tuple[bool, str]:
        """Validate a single value against column type definition"""
        col_type = col_schema.get('type', 'string')

        # Handle null/NaN values
        if pd.isna(value):
            if col_schema.get('required', False):
                return False, "Required field is empty"
            return True, ""

        # Convert value to string for pattern matching
        str_value = str(value).strip()

        # Type validation
        if col_type == 'string':
            if not isinstance(value, (str, int, float)):
                return False, f"Expected string, got {type(value).__name__}"

            # Check min/max length
            if 'min_length' in col_schema and len(str_value) < col_schema['min_length']:
                return False, f"Minimum length is {col_schema['min_length']}"
            if 'max_length' in col_schema and len(str_value) > col_schema['max_length']:
                return False, f"Maximum length is {col_schema['max_length']}"

        elif col_type == 'integer':
            try:
                int_value = int(float(value))
                if 'min_value' in col_schema and int_value < col_schema['min_value']:
                    return False, f"Minimum value is {col_schema['min_value']}"
                if 'max_value' in col_schema and int_value > col_schema['max_value']:
                    return False, f"Maximum value is {col_schema['max_value']}"
            except (ValueError, TypeError):
                return False, f"Expected integer, got '{value}'"

        elif col_type == 'float':
            try:
                float_value = float(value)
                if 'min_value' in col_schema and float_value < col_schema['min_value']:
                    return False, f"Minimum value is {col_schema['min_value']}"
                if 'max_value' in col_schema and float_value > col_schema['max_value']:
                    return False, f"Maximum value is {col_schema['max_value']}"
            except (ValueError, TypeError):
                return False, f"Expected number, got '{value}'"

        elif col_type == 'boolean':
            if 'enum' in col_schema:
                if str_value not in [str(e) for e in col_schema['enum']]:
                    allowed = ', '.join(str(e) for e in col_schema['enum'])
                    return False, f"Must be one of: {allowed}"

        elif col_type == 'email':
            email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
            if not re.match(email_pattern, str_value):
                return False, "Invalid email format"

        elif col_type == 'url':
            if not str_value.startswith(('http://', 'https://')):
                return False, "URL must start with http:// or https://"

        elif col_type == 'json_array':
            try:
                parsed = json.loads(str_value)
                if not isinstance(parsed, list):
                    return False, "Must be a JSON array"
            except json.JSONDecodeError:
                return False, "Invalid JSON format"

        # Pattern validation
        if 'pattern' in col_schema:
            pattern = col_schema['pattern']
            if not re.match(pattern, str_value):
                return False, f"Does not match pattern: {pattern}"

        # Enum validation
        if 'enum' in col_schema and col_type not in ['boolean']:
            if str_value not in col_schema['enum']:
                allowed = ', '.join(col_schema['enum'])
                return False, f"Must be one of: {allowed}"

        return True, ""

    def validate_sheet(self, df: pd.DataFrame, sheet_schema: Dict,
                      excel_file: str = None) -> List[Dict]:
        """Validate entire sheet against schema"""
        errors = []
        sheet_name = sheet_schema['name']

        # Check if required columns exist
        required_columns = {col['name'] for col in sheet_schema['columns']}
        actual_columns = set(df.columns)

        missing_columns = required_columns - actual_columns
        if missing_columns:
            errors.append({
                'sheet': sheet_name,
                'type': 'MISSING_COLUMNS',
                'message': f"Sheet '{sheet_name}': Missing required columns: {', '.join(missing_columns)}"
            })
            return errors

        # Check max_rows constraint
        if 'max_rows' in sheet_schema and len(df) > sheet_schema['max_rows']:
            errors.append({
                'sheet': sheet_name,
                'type': 'TOO_MANY_ROWS',
                'message': f"Sheet '{sheet_name}': Should have maximum {sheet_schema['max_rows']} row(s), found {len(df)}"
            })

        # Validate each row
        for row_idx, row in df.iterrows():
            for col_schema in sheet_schema['columns']:
                col_name = col_schema['name']

                if col_name not in df.columns:
                    continue

                value = row[col_name]

                # Validate type and constraints
                is_valid, error_msg = self.validate_column_type(value, col_schema)

                if not is_valid:
                    errors.append({
                        'sheet': sheet_name,
                        'row': row_idx + 2,  # +2 for header and 0-indexing
                        'column': col_name,
                        'value': value,
                        'type': 'VALIDATION_ERROR',
                        'message': error_msg
                    })

        return errors

    def validate_references(self, df: pd.DataFrame, col_schema: Dict, current_excel_file: str) -> List[Dict]:
        """Validate foreign key references"""
        errors = []

        if 'reference' not in col_schema:
            return errors

        ref = col_schema['reference']
        ref_template = ref.get('template')
        ref_sheet = ref['sheet']
        ref_column = ref['column']

        try:
            # Resolve reference source file
            source_excel = ref_template
            if source_excel is None or str(source_excel).strip().upper() in { 'SELF', 'CURRENT', 'THIS' }:
                source_excel = current_excel_file

            # Load reference data
            ref_df = self.load_excel(source_excel, ref_sheet)

            # Handle multiple columns (comma-separated)
            ref_columns = [col.strip() for col in ref_column.split(',')]
            valid_values = set()

            for col in ref_columns:
                if col in ref_df.columns:
                    valid_values.update(ref_df[col].dropna().astype(str))

            # Check each value
            col_name = col_schema['name']
            for row_idx, value in df[col_name].items():
                if pd.notna(value):
                    str_value = str(value).strip()
                    if str_value and str_value not in valid_values:
                        errors.append({
                        'sheet': ref_sheet,
                            'row': row_idx + 2,
                            'column': col_name,
                            'value': value,
                            'type': 'REFERENCE_ERROR',
                        'message': f"Value '{value}' not found in {source_excel}/{ref_sheet}/{ref_column}"
                        })

        except Exception as e:
            errors.append({
                'type': 'REFERENCE_LOAD_ERROR',
                'message': f"Failed to load reference data: {str(e)}"
            })

        return errors

    def validate_unique_codes(self, df: pd.DataFrame, columns: List[str],
                            sheet_name: str) -> List[Dict]:
        """Validate that specified columns have unique values"""
        errors = []

        for col_name in columns:
            if col_name not in df.columns:
                continue

            # Find duplicates
            duplicates = df[df[col_name].duplicated(keep=False)]

            if not duplicates.empty:
                for value in duplicates[col_name].unique():
                    rows = df[df[col_name] == value].index + 2  # +2 for header and 0-indexing
                    errors.append({
                        'sheet': sheet_name,
                        'column': col_name,
                        'value': value,
                        'rows': list(rows),
                        'type': 'DUPLICATE_ERROR',
                        'message': f"Duplicate value '{value}' found in rows: {list(rows)}"
                    })

        return errors

    def validate_file(self, excel_file: str, schema_file: str) -> Dict:
        """
        Validate an Excel file against its schema

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
            # Load schema
            schema = self.load_schema(schema_file)

            # Validate each sheet
            for sheet_schema in schema.get('sheets', []):
                sheet_name = sheet_schema['name']

                try:
                    # Load sheet
                    df = self.load_excel(excel_file, sheet_name)

                    # Validate sheet structure and data
                    sheet_errors = self.validate_sheet(df, sheet_schema, excel_file)
                    result['errors'].extend(sheet_errors)

                    # Validate references
                    for col_schema in sheet_schema.get('columns', []):
                        if 'reference' in col_schema:
                            ref_errors = self.validate_references(df, col_schema, excel_file)
                            result['errors'].extend(ref_errors)

                    # Validate uniqueness rules
                    for rule in schema.get('validation_rules', []):
                        rule_name = rule.get('rule', '')
                        # Support generic unique rules declared at schema-level
                        if rule_name == 'unique_codes' or rule_name.startswith('unique_'):
                            target_sheet = rule.get('sheet')
                            # If a specific sheet is mentioned, only run on that sheet
                            if target_sheet is not None and target_sheet != sheet_name:
                                continue
                            columns = rule.get('columns', [])
                            if columns:
                                unique_errors = self.validate_unique_codes(
                                    df, columns, sheet_name
                                )
                                result['errors'].extend(unique_errors)

                except Exception as e:
                    result['errors'].append({
                        'sheet': sheet_name,
                        'type': 'SHEET_ERROR',
                        'message': f"Sheet '{sheet_name}': Error reading sheet: {str(e)}"
                    })

            # Special validation rules
            self._apply_special_rules(schema, excel_file, result)

            result['valid'] = len(result['errors']) == 0

        except FileNotFoundError as e:
            result['valid'] = False
            result['errors'].append({
                'type': 'FILE_NOT_FOUND',
                'message': str(e)
            })
        except Exception as e:
            result['valid'] = False
            result['errors'].append({
                'type': 'VALIDATION_ERROR',
                'message': f"Validation failed: {str(e)}"
            })

        return result

    def _apply_special_rules(self, schema: Dict, excel_file: str, result: Dict):
        """Apply special validation rules defined in schema"""
        for rule in schema.get('validation_rules', []):
            rule_type = rule['rule']

            try:
                if rule_type == 'single_start_state':
                    self._validate_single_start_state(excel_file, result)

                elif rule_type == 'at_least_one_end_state':
                    self._validate_end_states(excel_file, result)

                elif rule_type == 'foreign_key':
                    # Already handled in validate_references
                    pass

            except Exception as e:
                result['warnings'].append({
                    'type': 'RULE_CHECK_FAILED',
                    'message': f"Failed to apply rule '{rule_type}': {str(e)}"
                })

    def _validate_single_start_state(self, excel_file: str, result: Dict):
        """Validate workflow has exactly one start state"""
        df = self.load_excel(excel_file, 'Workflow_States')
        start_states = df[df['Is Start State'].astype(str).str.upper() == 'TRUE']

        if len(start_states) == 0:
            result['errors'].append({
                'sheet': 'Workflow_States',
                'type': 'WORKFLOW_ERROR',
                'message': 'No start state defined. One state must have "Is Start State" = TRUE'
            })
        elif len(start_states) > 1:
            result['errors'].append({
                'sheet': 'Workflow_States',
                'type': 'WORKFLOW_ERROR',
                'message': f'Multiple start states found. Only one state can have "Is Start State" = TRUE'
            })

    def _validate_end_states(self, excel_file: str, result: Dict):
        """Validate workflow has at least one end state"""
        df = self.load_excel(excel_file, 'Workflow_States')
        end_states = df[df['Is End State'].astype(str).str.upper() == 'TRUE']

        if len(end_states) == 0:
            result['errors'].append({
                'sheet': 'Workflow_States',
                'type': 'WORKFLOW_ERROR',
                'message': 'No end state defined. At least one state must have "Is End State" = TRUE'
            })

    def print_validation_report(self, result: Dict):
        """Print formatted validation report"""
        print("="*80)
        print(f"VALIDATION REPORT: {result['file']}")
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
                        print(f"   {sheet_info}Row {error['row']}, Column '{error['column']}':")
                        print(f"      Value: {error.get('value', 'N/A')}")
                        print(f"      Error: {error['message']}")
                    else:
                        print(f"   {error['message']}")

                if len(errors) > 10:
                    print(f"   ... and {len(errors) - 10} more")

        if result.get('warnings'):
            print(f"\nWarnings ({len(result['warnings'])}):")
            for warning in result['warnings']:
                print(f"   - {warning['message']}")

        print("="*80)


def validate_all_templates():
    """Validate all Excel templates"""
    validator = ExcelValidator()

    templates = [
        ('Copy of NEW_PGR_Master_Data_UNIFIED.xlsx', 'pgr_master_data_unified_schema.yaml')
    ]

    all_valid = True
    results = []

    for excel_file, schema_file in templates:
        print(f"\nValidating {excel_file}...")
        result = validator.validate_file(excel_file, schema_file)
        results.append(result)

        if result['valid']:
            print(f"   PASSED")
        else:
            print(f"   FAILED - {len(result['errors'])} error(s)")
            all_valid = False

    # Summary
    print("\n" + "="*80)
    print("VALIDATION SUMMARY")
    print("="*80)

    for result in results:
        status = "PASSED" if result['valid'] else "FAILED"
        print(f"   {result['file']:<40} {status}")

    print("="*80)

    return all_valid, results


if __name__ == "__main__":
    # Run validation on all templates
    all_valid, results = validate_all_templates()

    # Print detailed report for failed validations
    for result in results:
        if not result['valid']:
            print("\n")
            validator = ExcelValidator()
            validator.print_validation_report(result)
