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
    """Delete all boundaries for a tenant

    POST /boundaries/delete
    Body: {"tenant_id": "statea", "env": "chakshu"}
    Headers: X-API-Key: <key>
    """
    if not check_auth():
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json or {}
    tenant_id = data.get('tenant_id')
    env = data.get('env', 'chakshu')

    if not tenant_id:
        return jsonify({'error': 'tenant_id required'}), 400

    try:
        sql = f"""
            DELETE FROM boundary_relationship WHERE tenantid='{tenant_id}';
            DELETE FROM boundary WHERE tenantid='{tenant_id}';
        """
        result = run_sql(sql, env)

        # Parse DELETE counts
        counts = []
        for line in result['stdout'].strip().split('\n'):
            if line.strip().startswith('DELETE'):
                try:
                    counts.append(int(line.split()[1]))
                except (IndexError, ValueError):
                    pass

        rel_deleted = counts[0] if len(counts) > 0 else 0
        deleted = counts[1] if len(counts) > 1 else 0

        return jsonify({
            'status': 'success',
            'relationships_deleted': rel_deleted,
            'boundaries_deleted': deleted,
            'tenant_id': tenant_id
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
