/**
 * Static contract tests for per-tenant Novu accounts (#2203): one Novu organization per root
 * tenant, managed by novu-bridge. Pure file reads, no running stack.
 *
 * What they guard: the internal APIs (/tenants/**, /messages/**) never become reachable through
 * Kong; the new secrets come from OpenBao and are never given a published default; the Novu admin
 * the bridge signs in as is moved off its published default password BEFORE anything signs in;
 * and Compose, Helm and the Ansible .env agree on every variable name.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const BRIDGE_VARS = [
  'NOVU_BRIDGE_NOVU_ADMIN_EMAIL',
  'NOVU_BRIDGE_NOVU_ADMIN_PASSWORD',
  'NOVU_BRIDGE_TENANT_KEY_ENCRYPTION_KEY',
  'NOVU_BRIDGE_TENANT_KEY_ENCRYPTION_KEY_PREVIOUS',
  'NOVU_BRIDGE_INTERNAL_ADMIN_TOKEN',
  'NOVU_BRIDGE_INTERNAL_SEND_TOKEN',
];
const INTERNAL_PREFIXES = ['/novu-bridge/novu-adapter/v1/tenants', '/novu-bridge/novu-adapter/v1/messages'];

/** The text of one top-level Compose service block. */
const composeService = (compose: string, service: string) => {
  const start = compose.indexOf(`\n  ${service}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

/**
 * kong.yml's services and the paths of their routes, read by layout (declarative config: a
 * service starts at `- name:` in column 0, route paths are `    - /...` lines), so this test needs
 * no YAML library. Each service also keeps its own text for the plugin checks.
 */
const kongServices = (text: string) => {
  const services: Array<{ name: string; paths: string[]; text: string }> = [];
  for (const line of text.split('\n')) {
    const service = line.match(/^- name: (\S+)/);
    if (service) {
      services.push({ name: service[1], paths: [], text: '' });
      continue;
    }
    const current = services[services.length - 1];
    if (!current) continue;
    current.text += line + '\n';
    const routePath = line.match(/^ {4}- (\/\S*)$/);
    if (routePath) current.paths.push(routePath[1]);
  }
  return services;
};

describe('Kong never routes the internal tenant-account and send APIs', () => {
  const services = kongServices(read('local-setup/kong/kong.yml'));

  test('the parser sees the routes it must judge', () => {
    // A layout change that hid every path from the parser would pass the next test vacuously.
    expect(services.find((s) => s.name === 'novu-bridge-proxy')?.paths).toContain('/novu-bridge/novu-adapter/v1/providers');
  });

  test('no routed service has a path that reaches them', () => {
    for (const service of services) {
      if (service.name === 'novu-bridge-internal-tenant-api-deny') continue;
      for (const p of service.paths) {
        for (const prefix of INTERNAL_PREFIXES) {
          // Kong matches paths as prefixes: a route on any ancestor would expose them.
          expect(prefix.startsWith(p) ? `${service.name} ${p}` : '').toBe('');
          expect(p.startsWith(prefix) ? `${service.name} ${p}` : '').toBe('');
        }
      }
    }
  });

  test('an explicit route terminates both prefixes with 404, in front of a dead upstream', () => {
    const deny = services.find((s) => s.name === 'novu-bridge-internal-tenant-api-deny');
    expect(deny).toBeDefined();
    expect(deny!.text).toContain('  url: http://localhost:9999\n');
    expect(deny!.paths).toEqual(INTERNAL_PREFIXES);
    expect(deny!.text).toMatch(/- name: request-termination\n {4}config:\n {6}status_code: 404\n/);
  });

  test('neither prefix is in the auth-optional whitelist', () => {
    const lua = read('local-setup/kong/kong.yml');
    expect(lua).not.toMatch(/\["\/novu-bridge\/novu-adapter\/v1\/(tenants|messages)/);
  });
});

describe('Compose wiring', () => {
  const compose = read('local-setup/docker-compose.egov-digit.yaml');
  const bridge = composeService(compose, 'novu-bridge');
  const pgr = composeService(compose, 'pgr-services');

  test('novu-bridge takes every tenant-account secret from .env, with no default value', () => {
    for (const v of BRIDGE_VARS) {
      expect(bridge).toContain(`      ${v}: \${${v}:-}\n`);
    }
    // Off unless the deploy turns it on.
    expect(bridge).toContain('      NOVU_BRIDGE_TENANT_ACCOUNTS_ENABLED: ${NOVU_BRIDGE_TENANT_ACCOUNTS_ENABLED:-false}\n');
  });

  test('pgr-services provisions through the bridge INSIDE the network, with the bridge admin token', () => {
    expect(pgr).toContain('PGR_ONBOARDING_NOTIFICATION_ACCOUNT_URL: ${PGR_ONBOARDING_NOTIFICATION_ACCOUNT_URL:-http://novu-bridge:8080/novu-bridge}');
    expect(pgr).toContain('PGR_ONBOARDING_NOTIFICATION_ACCOUNT_TOKEN: ${NOVU_BRIDGE_INTERNAL_ADMIN_TOKEN:-}');
  });

  test('the bridge application defaults are off and secret-free', () => {
    const props = read('backend/novu-bridge/src/main/resources/application.properties');
    expect(props).toContain('novu.bridge.tenant.accounts.enabled=${NOVU_BRIDGE_TENANT_ACCOUNTS_ENABLED:false}');
    for (const key of ['admin.password=${NOVU_BRIDGE_NOVU_ADMIN_PASSWORD:}', 'encryption.key=${NOVU_BRIDGE_TENANT_KEY_ENCRYPTION_KEY:}',
      'internal.admin.token=${NOVU_BRIDGE_INTERNAL_ADMIN_TOKEN:}', 'internal.send.token=${NOVU_BRIDGE_INTERNAL_SEND_TOKEN:}']) {
      expect(props).toContain(key);
    }
  });
});

describe('Ansible', () => {
  const playbook = read('local-setup/ansible/playbook-deploy.yml');
  const envTemplate = read('local-setup/ansible/templates/digit.env.j2');
  const task = (name: string) => {
    const start = playbook.indexOf(`- name: "${name}`);
    expect(start).toBeGreaterThan(-1);
    const next = playbook.indexOf('\n    - name:', start + 1);
    return playbook.slice(start, next === -1 ? undefined : next);
  };

  test('the switch defaults to on only where self-serve signup and Novu both run', () => {
    const t = task('novu tenant accounts — resolve the switch');
    expect(t).toContain("(enable_novu | default(false) | bool)");
    expect(t).toContain("novu_tenant_accounts | default(enable_keycloak | default(false)) | bool");
    expect(playbook.indexOf('- name: "novu tenant accounts — resolve the switch"'))
      .toBeLessThan(playbook.indexOf('- name: Write per-tenant compose .env'));
    expect(envTemplate).toContain('NOVU_BRIDGE_TENANT_ACCOUNTS_ENABLED={{ novu_tenant_accounts_on | default(false) | string | lower }}');
  });

  test('every secret is generated only when OpenBao has none, and never logged', () => {
    const t = task('novu tenant accounts — resolve secrets (generate any that are absent)');
    for (const key of ['novu_bridge_tenant_key_encryption_key', 'novu_bridge_internal_admin_token',
      'novu_bridge_internal_send_token', 'novu_admin_password']) {
      // `or` short-circuits, so the generator never runs when a value is stored (see the Grafana note).
      expect(t).toMatch(new RegExp(`_stored\\.${key} \\| default\\('', true\\)\\s+or `));
    }
    expect(t).toContain('no_log: true');
    expect(task('novu tenant accounts — persist any generated secrets')).toContain("'cas': bao_secrets_novu_accounts.json.data.metadata.version");
    expect(task('novu tenant accounts — persist any generated secrets')).toContain('no_log: true');
  });

  test('.env carries the secrets in their own block, restored across regeneration and removed when off', () => {
    const write = task('novu tenant accounts — write secrets into compose .env');
    expect(write).toContain('marker: "# {mark} NOVU TENANT ACCOUNT SECRETS"');
    for (const v of BRIDGE_VARS.filter((x) => x !== 'NOVU_BRIDGE_TENANT_KEY_ENCRYPTION_KEY_PREVIOUS')) {
      expect(write).toContain(`${v}=`);
    }
    expect(write).toContain('no_log: true');
    expect(task('Restore OpenBao secret blocks into the regenerated .env')).toContain('- NOVU TENANT ACCOUNT SECRETS');
    const off = task('novu tenant accounts — remove the secrets block when switched off');
    expect(off).toContain('state: absent');
    expect(off).toContain("when: not (novu_tenant_accounts_on | bool)");
    // Written before the stack starts, so the bridge never comes up without them.
    expect(playbook.indexOf('- name: "novu tenant accounts — write secrets into compose .env"'))
      .toBeLessThan(playbook.indexOf('- name: Start DIGIT stack (Linux/Debian)'));
  });

  test('the published default Novu admin password is refused, and moved off before anything signs in', () => {
    expect(task('novu tenant accounts — refuse the published default admin password')).toContain("novu_admin_password_effective != 'Digit@12345'");
    const rotate = playbook.indexOf('- name: "novu tenant accounts — move the Novu admin off the legacy password"');
    const mint1 = playbook.indexOf('- name: "novu-bootstrap — mint Development API key (attempt 1: existing account)"');
    const health = playbook.indexOf('- name: "novu-bootstrap — wait for novu-api health"');
    expect(rotate).toBeGreaterThan(health);
    expect(rotate).toBeLessThan(mint1);
    const t = task('novu tenant accounts — move the Novu admin off the legacy password');
    // Passwords travel in the environment, never on a command line.
    expect(t).toContain('NB_NEW: "{{ novu_admin_password_effective }}"');
    expect(t).not.toMatch(/python3 -c|--password/);
    expect(t).toContain('/v1/auth/update-password');
    // Both mint attempts sign in with the same effective password the bridge gets.
    const mints = playbook.match(/ NOVU_ADMIN_PASSWORD='/g) ?? [];
    expect(mints.length).toBe(2);
    expect(playbook).not.toContain(`NOVU_ADMIN_PASSWORD='{{ novu_admin_password | default("Digit@12345") }}'`);
    expect(playbook.match(/NOVU_ADMIN_PASSWORD='\{\{ novu_admin_password_effective \}\}'/g)?.length).toBe(2);
  });

  test('the optional backfill passes the token by environment, never on the command line', () => {
    const t = task('novu tenant accounts — provision the tenants listed in novu_tenant_accounts_backfill');
    expect(t).toContain('NB_TOKEN: "{{ novu_accounts_secrets.novu_bridge_internal_admin_token }}"');
    expect(t).toContain('X-Novu-Bridge-Token: $NB_TOKEN');
    expect(t).toContain('failed_when: false');
  });
});

describe('Helm parity', () => {
  const bridge = read('devops/deploy-as-code/charts/common-services/novu-bridge/values.yaml');
  const pgr = read('devops/deploy-as-code/charts/urban/pgr-services/values.yaml');

  test('the bridge reads every tenant-account secret from a Secret, only when enabled', () => {
    expect(bridge).toMatch(/tenant-accounts:\n {2}enabled: false\n {2}secretName: "novu-bridge-tenant-accounts"/);
    const gated = bridge.slice(bridge.indexOf('{{- if index .Values "tenant-accounts" "enabled" }}'));
    for (const [v, key] of [['NOVU_BRIDGE_NOVU_ADMIN_EMAIL', 'novu-admin-email'], ['NOVU_BRIDGE_NOVU_ADMIN_PASSWORD', 'novu-admin-password'],
      ['NOVU_BRIDGE_TENANT_KEY_ENCRYPTION_KEY', 'encryption-key'], ['NOVU_BRIDGE_INTERNAL_ADMIN_TOKEN', 'internal-admin-token'],
      ['NOVU_BRIDGE_INTERNAL_SEND_TOKEN', 'internal-send-token']]) {
      expect(gated).toMatch(new RegExp(`- name: ${v}\\n {4}valueFrom:\\n {6}secretKeyRef:\\n {8}name: \\{\\{ index .Values "tenant-accounts" "secretName" \\}\\}\\n {8}key: ${key}\\n`));
    }
  });

  test('pgr-services uses the bridge admin token from the same Secret', () => {
    expect(pgr).toContain('notificationAccountSecretName: "novu-bridge-tenant-accounts"');
    expect(pgr).toMatch(/- name: PGR_ONBOARDING_NOTIFICATION_ACCOUNT_TOKEN\n {4}valueFrom:\n {6}secretKeyRef:\n {8}name: \{\{ .Values.onboarding.notificationAccountSecretName \}\}\n {8}key: internal-admin-token/);
  });
});

describe('published contract', () => {
  test('the docs copy of the OpenAPI is the one the bridge serves', () => {
    expect(read('docs/releases/2.20/notifications/contract/openapi.yaml'))
      .toBe(read('backend/novu-bridge/src/main/resources/contract/openapi.yaml'));
  });

  test('both internal APIs and the three distinct _send failures are documented', () => {
    const api = read('backend/novu-bridge/src/main/resources/contract/openapi.yaml');
    for (const p of ['/tenants/{tenantId}/_provision', '/tenants/{tenantId}', '/tenants/{tenantId}/_deprovision',
      '/tenants/{tenantId}/providers', '/tenants/_backfill', '/messages/_send']) {
      expect(api).toContain(`\n  /novu-bridge/novu-adapter/v1${p}:\n`);
    }
    const send = api.slice(api.indexOf('\n  /novu-bridge/novu-adapter/v1/messages/_send:\n'));
    const responses = send.slice(send.indexOf('      responses:'), send.indexOf('\ncomponents:'));
    for (const status of ['200', '202', '409', '422', '502', '503']) {
      expect(responses).toContain(`        "${status}":`);
    }
    for (const code of ['NB_TENANT_NOT_PROVISIONED', 'NB_NO_PROVIDER_FOR_CHANNEL', 'NB_PROVIDER_FAILED']) {
      expect(send).toContain(code);
    }
  });
});
