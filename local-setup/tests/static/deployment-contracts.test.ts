/**
 * Static contract tests for the deployment changes on this branch.
 * Pure file assertions — no running stack required — so regressions in
 * the playbook / compose / baked templates fail in CI, not on a fresh
 * tenant three deploys later.
 *
 * Each block names the incident it guards against.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('default-data-handler tenant template', () => {
  // ethiopia inherited pg's Indian pincodes [143001-143005] from this
  // template, vetoing every citizen submit with
  // CS_COMMON_PINCODE_NOT_SERVICABLE. The key must stay absent: the UI
  // treats absence as "all postal codes serviceable", and mdms-v2
  // rejects pincode: [] on update. Operators seed an allowlist via the
  // tenant_bootstrap pincode_allowlist arg instead.
  test('seeds no pincode allowlist onto new tenants', () => {
    const records = JSON.parse(
      read('utilities/default-data-handler/src/main/resources/mdmsData-dev/tenant/tenant.tenants.json')
    );
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record).not.toHaveProperty('pincode');
    }
  });
});

describe('ansible playbook-deploy.yml', () => {
  const playbook = read('local-setup/ansible/playbook-deploy.yml');

  // Optional per-tenant pincode allowlist (host_var pgr_pincode_allowlist)
  // must reach the MCP tenant_bootstrap on BOTH passes (root + city);
  // `default(omit)` keeps it absent — the only valid off state.
  test('both mcp-bootstrap calls forward pgr_pincode_allowlist', () => {
    const forwarded = playbook.match(
      /pincode_allowlist: "\{\{ pgr_pincode_allowlist \| default\(omit\) \}\}"/g
    );
    expect(forwarded).toHaveLength(2);
  });

  test('both 0→1 bootstrap passes forward the dashboard access role floor', () => {
    const forwarded = playbook.match(
      /dashboard_roles: "\{\{ dashboard_allowed_roles \}\}"/g
    );
    expect(forwarded).toHaveLength(2);
  });

  // HRMS crash-loops on non-pg tenants without the INTERNAL_USER system
  // user at state_root (its startup lookup is tenant-scoped).
  //
  // Asserts the BEHAVIOUR, not the task's display name. This test originally
  // pinned the exact task title and the payload's YAML form; c0a21204 rewrote
  // the task as a retrying curl POST — on the same day the test landed — and
  // broke both assertions without changing what they were protecting.
  //
  // Scoped to the request payload rather than scanning the whole playbook.
  // Three loose `toContain` calls would pass if userName and tenantId lived in
  // two unrelated tasks — they would prove both strings exist somewhere, not
  // that INTERNAL_USER is created AT state_root, which is the actual invariant.
  // Parsing the one payload that mentions INTERNAL_USER checks the fields
  // together, and survives task renames, field reordering and whitespace.
  test('seeds INTERNAL_USER on state_root after bootstrap', () => {
    // The Jinja expressions sit inside JSON string values, so the body is
    // still valid JSON — `{{ state_root }}` parses as a plain string.
    const payloads = [...playbook.matchAll(/body='(\{.*?\})'\s*$/gm)]
      .map((m) => m[1])
      .filter((b) => b.includes('INTERNAL_USER'));

    // Exactly one — two would mean a duplicate seed path, and this test would
    // silently only be covering whichever came first.
    expect(payloads).toHaveLength(1);

    const user = JSON.parse(payloads[0]).User;
    expect(user.userName).toBe('INTERNAL_USER');
    expect(user.tenantId).toBe('{{ state_root }}');
    // SYSTEM is what makes HRMS's startup lookup accept it.
    expect(user.type).toBe('SYSTEM');
    // The role is tenant-scoped too; on `pg` it would not satisfy the lookup.
    const roleTenants = (user.roles as Array<{ tenantId: string }>).map((r) => r.tenantId);
    expect(roleTenants).toEqual(['{{ state_root }}']);
  });

  // The HRMS prereq gate ships hardcoded to tenant pg; without the
  // rewrite HRMS waits forever for a user that lives on state_root.
  test('rewrites the HRMS prereq-gate tenant from pg to state_root', () => {
    expect(playbook).toContain(
      String.raw`'("tenantId":")pg(","roleCodes":\["INTERNAL_MICROSERVICE_ROLE"\])'`
    );
  });

  // Static mode must be able to serve a prebuilt registry bundle
  // (digit_ui_bundle_image) instead of force-resetting from the
  // (older) flywheel git checkout — which silently reverts UI fixes.
  test('supports digit_ui_bundle_image for static serving', () => {
    expect(playbook).toContain(
      'digit-ui mode=static — deploy prebuilt bundle from digit_ui_bundle_image'
    );
    // git/build path stays gated off when a bundle image is pinned
    expect(playbook).toContain("(digit_ui_bundle_image | default('')) | length == 0");
  });
});

describe('host_vars _example.yml', () => {
  test('documents the pgr_pincode_allowlist knob', () => {
    const example = read('local-setup/ansible/inventory/host_vars/_example.yml');
    expect(example).toContain('pgr_pincode_allowlist');
    expect(example).toMatch(/CS_COMMON_PINCODE_NOT_SERVICABLE/);
  });

  test('documents current dashboard access and excludes the legacy path', () => {
    const example = read('local-setup/ansible/inventory/host_vars/_example.yml');
    expect(example).toContain('dashboard_allowed_roles');
    expect(example).toContain('base analytics capabilities');
    expect(example).toContain('/dashboard path is outside this bootstrap contract');
  });
});

describe('docker-compose.egov-digit.yaml', () => {
  const compose = read('local-setup/docker-compose.egov-digit.yaml');

  test('digit-mcp falls back to a public ghcr image', () => {
    expect(compose).toMatch(
      /image: \$\{MCP_IMAGE:-ghcr\.io\/subhashini-egov\/digit-mcp:[0-9-]+\}/
    );
  });
});

describe('Novu workflow creation deployment contract', () => {
  const novuValues = read('devops/deploy-as-code/charts/backbone-services/novu/values.yaml');
  const dashboardValues = novuValues.slice(novuValues.lastIndexOf('\ndashboard:'));
  const novuIngress = read('devops/deploy-as-code/charts/backbone-services/novu/templates/ingress.yaml');
  const composeEnv = read('local-setup/ansible/templates/digit.env.j2');
  const composeNginx = read('local-setup/ansible/templates/nginx-site.conf.j2');
  const novuEnv = read('backend/novu-bridge/config/.env.novu');
  const dotenvLoader = path.join(
    REPO_ROOT,
    'backend/novu-bridge/config/load-dotenv.sh'
  );

  test('Helm gives browser code public API/WS URLs rather than cluster-only service names', () => {
    expect(novuValues).toContain('publicOrigin: "https://domain.com"');
    expect(novuValues).toContain('value: {{ printf "%s/novu-api" .Values.ingress.publicOrigin | quote }}');
    expect(novuValues).toContain('value: {{ .Values.ingress.publicOrigin | quote }}');
    // The worker correctly uses an in-cluster API URL; only values injected
    // into browser JavaScript must be public.
    expect(dashboardValues).not.toContain('value: {{ printf "http://%s:%d" .Values.api.name');
    expect(dashboardValues).not.toContain('value: {{ printf "http://%s:%d" .Values.ws.name');
  });

  test('Helm exposes API, websocket, and stock-dashboard absolute SPA routes', () => {
    expect(novuIngress).toContain('.Values.ingress.api.path');
    expect(novuIngress).toContain('.Values.ingress.ws.path');
    expect(novuIngress).toContain('range list "/env"');
    expect(novuIngress).toContain('"/auth/sign-in"');
    expect(novuIngress).toContain('"/integrations"');
    expect(novuIngress).toContain('"/assets"');
    expect(novuIngress).toContain('path: "/socket.io"');
    expect(novuIngress).toContain('name: {{ .Values.ingress.ws.service.name }}');
  });

  test('Compose routes Novu Socket.IO at the root path its 2.3.0 client actually uses', () => {
    expect(composeEnv).toContain(
      "NOVU_WS_PUBLIC_URL={{ novu_ws_public_url | default(novu_public_origin) }}"
    );
    expect(composeNginx).toContain('location /socket.io/');
    expect(composeNginx).toContain('proxy_pass http://127.0.0.1:14003/socket.io/;');
  });

  test('the tracked SMS body is quoted and dotenv loading preserves spaces and explicit env', () => {
    expect(novuEnv).toContain(
      "NOVU_SMS_BODY='Complaint {{payload.complaintNo}} status is {{payload.status}}'"
    );

    const probe = String.raw`
      set -euo pipefail
      source "$1"
      load_dotenv_defaults <(printf '%s\n' 'NOVU_SMS_BODY=Complaint {{payload.complaintNo}} status is {{payload.status}}')
      printf '%s\n' "$NOVU_SMS_BODY"
      NOVU_SMS_BODY='caller wins'
      load_dotenv_defaults <(printf '%s\n' 'NOVU_SMS_BODY=file loses')
      printf '%s\n' "$NOVU_SMS_BODY"
    `;
    const output = execFileSync('bash', ['-c', probe, 'bash', dotenvLoader], {
      encoding: 'utf8',
    }).trim().split('\n');

    expect(output).toEqual([
      'Complaint {{payload.complaintNo}} status is {{payload.status}}',
      'caller wins',
    ]);
  });
});
