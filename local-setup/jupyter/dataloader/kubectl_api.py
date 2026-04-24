#!/usr/bin/env python3
"""
Simple API server that wraps kubectl commands for boundary/database operations.

Run on dev server: python kubectl_api.py
Endpoint: http://localhost:8765

This allows CI environments without kubectl access to perform DB operations.
"""

import subprocess
import base64
import os
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configuration
DB_CONFIG = {
    'chakshu': {
        'host': 'chakshu-pgr-db.czvokiourya9.ap-south-1.rds.amazonaws.com',
        'name': 'chakshupgrdb',
        'user': 'chakshupgr',
        'k8s_context': 'arn:aws:eks:ap-south-1:349271159511:cluster/chakshu-pgr',
        'namespace': 'egov'
    },
    'unified-dev': {
        'host': 'unified-dev-db.example.com',  # Update with actual host
        'name': 'egov',
        'user': 'egov',
        'k8s_context': 'unified-dev',
        'namespace': 'egov'
    }
}

# Simple API key for basic auth (set via env var)
API_KEY = os.environ.get('KUBECTL_API_KEY', 'dev-only-key')


def check_auth():
    """Check API key in header"""
    key = request.headers.get('X-API-Key')
    if key != API_KEY:
        return False
    return True


def get_db_password(env: str = 'chakshu') -> str:
    """Get DB password from K8s secret"""
    config = DB_CONFIG.get(env, DB_CONFIG['chakshu'])

    result = subprocess.run(
        ['kubectl', '--context', config['k8s_context'],
         'get', 'secret', 'db', '-n', config['namespace'],
         '-o', 'jsonpath={.data.password}'],
        capture_output=True, text=True
    )

    if result.returncode != 0:
        raise Exception(f"Failed to get DB password: {result.stderr}")

    return base64.b64decode(result.stdout).decode()


def run_sql(sql: str, env: str = 'chakshu') -> dict:
    """Run SQL command via kubectl exec"""
    config = DB_CONFIG.get(env, DB_CONFIG['chakshu'])
    db_pass = get_db_password(env)

    conn_str = f"postgresql://{config['user']}:{db_pass}@{config['host']}:5432/{config['name']}"

    # Ensure cleanup pod exists
    subprocess.run(
        ['kubectl', '--context', config['k8s_context'],
         'delete', 'pod', 'db-cleanup', '-n', config['namespace'], '--ignore-not-found'],
        capture_output=True
    )
    subprocess.run(
        ['kubectl', '--context', config['k8s_context'],
         'run', 'db-cleanup', '--image=postgres:15', '-n', config['namespace'],
         '--restart=Never', '--command', '--', 'sleep', '3600'],
        capture_output=True
    )
    subprocess.run(
        ['kubectl', '--context', config['k8s_context'],
         'wait', '--for=condition=Ready', 'pod/db-cleanup', '-n', config['namespace'],
         '--timeout=60s'],
        capture_output=True
    )

    # Run SQL
    result = subprocess.run(
        ['kubectl', '--context', config['k8s_context'],
         'exec', '-n', config['namespace'], 'db-cleanup', '--',
         'psql', conn_str, '-t', '-c', sql],
        capture_output=True, text=True
    )

    return {
        'stdout': result.stdout,
        'stderr': result.stderr,
        'returncode': result.returncode
    }


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok'})


@app.route('/boundaries/delete', methods=['POST'])
def delete_boundaries():
    """Delete all boundary-related data for a tenant.

    POST /boundaries/delete
    Body:
      {
        "tenant_id": "statea",
        "root_tenant": "statea",
        "hierarchy_types": ["REVENUE"],
        "boundary_codes": ["STATEA", "STATEA_DISTRICT_1"],
        "hierarchy_level_codes": ["REVENUE_STATE", "REVENUE_DISTRICT", "REVENUE"],
        "mdms_unique_ids": ["CMS|All|REVENUE"],
        "env": "chakshu"
      }
    Headers: X-API-Key: <key>
    """
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json or {}
    tenant_id = data.get('tenant_id')
    root_tenant = data.get('root_tenant') or tenant_id
    hierarchy_types = data.get('hierarchy_types') or []
    boundary_codes = data.get('boundary_codes') or []
    hierarchy_level_codes = data.get('hierarchy_level_codes') or []
    mdms_unique_ids = data.get('mdms_unique_ids') or []
    env = data.get('env', 'chakshu')

    if not tenant_id:
        return jsonify({'error': 'tenant_id required'}), 400

    try:
        def sql_literal(value):
            return "'" + str(value).replace("'", "''") + "'"

        def sql_in(values):
            return ", ".join(sql_literal(value) for value in values if value)

        sql_parts = []
        if hierarchy_types:
            hierarchy_in = sql_in(hierarchy_types)
            sql_parts.append(
                f"DELETE FROM eg_bm_generated_template "
                f"WHERE tenantid={sql_literal(tenant_id)} AND hierarchytype IN ({hierarchy_in});"
            )
            sql_parts.append(
                f"DELETE FROM eg_bm_processed_template "
                f"WHERE tenantid={sql_literal(tenant_id)} AND hierarchytype IN ({hierarchy_in});"
            )
            sql_parts.append(
                f"DELETE FROM boundary_hierarchy "
                f"WHERE tenantid={sql_literal(tenant_id)} AND hierarchytype IN ({hierarchy_in});"
            )
            sql_parts.append(
                f"DELETE FROM boundary_relationship "
                f"WHERE tenantid={sql_literal(tenant_id)} AND hierarchytype IN ({hierarchy_in});"
            )
        else:
            sql_parts.append(f"DELETE FROM eg_bm_generated_template WHERE tenantid={sql_literal(tenant_id)};")
            sql_parts.append(f"DELETE FROM eg_bm_processed_template WHERE tenantid={sql_literal(tenant_id)};")
            sql_parts.append(f"DELETE FROM boundary_hierarchy WHERE tenantid={sql_literal(tenant_id)};")
            sql_parts.append(f"DELETE FROM boundary_relationship WHERE tenantid={sql_literal(tenant_id)};")

        if boundary_codes:
            boundary_in = sql_in(boundary_codes)
            sql_parts.insert(
                3,
                f"DELETE FROM boundary "
                f"WHERE tenantid={sql_literal(tenant_id)} AND code IN ({boundary_in});"
            )
            sql_parts.append(
                f"DELETE FROM message "
                f"WHERE tenantid={sql_literal(root_tenant)} AND module='rainmaker-pgr' "
                f"AND code IN ({boundary_in});"
            )
        else:
            sql_parts.insert(3, f"DELETE FROM boundary WHERE tenantid={sql_literal(tenant_id)};")

        if hierarchy_level_codes:
            level_code_in = sql_in(hierarchy_level_codes)
            sql_parts.append(
                f"DELETE FROM message "
                f"WHERE tenantid={sql_literal(root_tenant)} AND module='rainmaker-common' "
                f"AND code IN ({level_code_in});"
            )

        if mdms_unique_ids:
            mdms_in = sql_in(mdms_unique_ids)
            sql_parts.append(
                f"UPDATE eg_mdms_data "
                f"SET isactive=false "
                f"WHERE tenantid={sql_literal(root_tenant)} "
                f"AND schemacode='CMS-BOUNDARY.HierarchySchema' "
                f"AND uniqueidentifier IN ({mdms_in}) "
                f"AND isactive=true;"
            )

        sql = "\n".join(sql_parts)
        result = run_sql(sql, env)

        delete_counts = []
        update_counts = []
        for line in result['stdout'].strip().split('\n'):
            if line.strip().startswith('DELETE'):
                try:
                    delete_counts.append(int(line.split()[1]))
                except (IndexError, ValueError):
                    pass
            elif line.strip().startswith('UPDATE'):
                try:
                    update_counts.append(int(line.split()[1]))
                except (IndexError, ValueError):
                    pass

        delete_labels = [
            'generated_templates_deleted',
            'processed_templates_deleted',
            'hierarchies_deleted',
            'boundaries_deleted',
            'relationships_deleted',
        ]
        if boundary_codes:
            delete_labels.append('boundary_localizations_deleted')
        if hierarchy_level_codes:
            delete_labels.append('hierarchy_localizations_deleted')

        delete_totals = {label: 0 for label in delete_labels}
        for label, count in zip(delete_labels, delete_counts):
            delete_totals[label] = count

        return jsonify({
            'status': 'success',
            'tenant_id': tenant_id,
            'root_tenant': root_tenant,
            'generated_templates_deleted': delete_totals.get('generated_templates_deleted', 0),
            'processed_templates_deleted': delete_totals.get('processed_templates_deleted', 0),
            'hierarchies_deleted': delete_totals.get('hierarchies_deleted', 0),
            'boundaries_deleted': delete_totals.get('boundaries_deleted', 0),
            'relationships_deleted': delete_totals.get('relationships_deleted', 0),
            'boundary_localizations_deleted': delete_totals.get('boundary_localizations_deleted', 0),
            'hierarchy_localizations_deleted': delete_totals.get('hierarchy_localizations_deleted', 0),
            'mdms_deactivated': update_counts[0] if update_counts else 0,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/boundaries/count', methods=['GET'])
def count_boundaries():
    """Count boundaries for a tenant

    GET /boundaries/count?tenant_id=statea&env=chakshu
    Headers: X-API-Key: <key>
    """
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    tenant_id = request.args.get('tenant_id')
    env = request.args.get('env', 'chakshu')

    if not tenant_id:
        return jsonify({'error': 'tenant_id required'}), 400

    try:
        sql = f"""
            SELECT
                (SELECT COUNT(*) FROM boundary WHERE tenantid='{tenant_id}') as boundaries,
                (SELECT COUNT(*) FROM boundary_relationship WHERE tenantid='{tenant_id}') as relationships;
        """
        result = run_sql(sql, env)

        # Parse counts from output
        lines = [l.strip() for l in result['stdout'].strip().split('\n') if l.strip()]
        if lines:
            parts = lines[0].split('|')
            boundaries = int(parts[0].strip()) if len(parts) > 0 else 0
            relationships = int(parts[1].strip()) if len(parts) > 1 else 0
        else:
            boundaries = 0
            relationships = 0

        return jsonify({
            'tenant_id': tenant_id,
            'boundaries': boundaries,
            'relationships': relationships
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/sql/execute', methods=['POST'])
def execute_sql():
    """Execute arbitrary SQL (use with caution!)

    POST /sql/execute
    Body: {"sql": "SELECT ...", "env": "chakshu"}
    Headers: X-API-Key: <key>
    """
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json or {}
    sql = data.get('sql')
    env = data.get('env', 'chakshu')

    if not sql:
        return jsonify({'error': 'sql required'}), 400

    # Block dangerous operations
    sql_upper = sql.upper()
    if any(kw in sql_upper for kw in ['DROP TABLE', 'DROP DATABASE', 'TRUNCATE']):
        return jsonify({'error': 'Dangerous operation blocked'}), 403

    try:
        result = run_sql(sql, env)
        return jsonify({
            'status': 'success' if result['returncode'] == 0 else 'error',
            'output': result['stdout'],
            'error': result['stderr']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8765))
    print(f"Starting kubectl API server on port {port}")
    print(f"API Key: {API_KEY[:8]}...")
    print("\nEndpoints:")
    print("  GET  /health")
    print("  POST /boundaries/delete")
    print("  GET  /boundaries/count")
    print("  POST /sql/execute")
    app.run(host='0.0.0.0', port=port, debug=False)
