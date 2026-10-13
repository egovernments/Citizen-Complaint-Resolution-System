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

  test('the published default Novu admin password never reaches the bridge, and is moved off before anything signs in', () => {
    // A host_vars pin of the published default is a refused sign-in, never tried (the verify step
    // then switches the feature off, or stops on explicit true / provisioned workspaces).
    const verify = read('local-setup/ansible/tasks/novu-tenant-accounts-verify.yml');
    expect(verify).toContain(`nta_published_default: "{{ novu_admin_password_effective == 'Digit@12345' }}"`);
    expect(verify).toMatch(/- nta_login_override is not defined\n {4}- not \(nta_published_default \| bool\)/);
    expect(verify).toContain("'PUBLISHED-DEFAULT not tried' if (nta_published_default | bool)");
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
    // Both mint attempts sign in with the same effective password, through the environment
    // (a shell string is in the task result at -v and in `ps`), and log nothing.
    expect(playbook).not.toMatch(/NOVU_ADMIN_PASSWORD='/);
    expect(playbook.match(/ {2}NOVU_ADMIN_PASSWORD: "\{\{ novu_admin_password_effective \}\}"/g)?.length).toBe(2);
    for (const name of ['novu-bootstrap — mint Development API key (attempt 1: existing account)',
      'novu-bootstrap — mint Development API key (attempt 2: fresh signup)']) {
      const mint = playbook.slice(playbook.indexOf(`- name: "${name}"`) + 1);
      const body = mint.slice(0, mint.search(/\n\s+- name:/));
      expect(body).toContain('ansible.builtin.shell: bash {{ digit_dir }}/novu-mint-key.sh');
      expect(body).toContain('no_log: true');
    }
    // The script itself keeps the password and the JWT off argv.
    const mintScript = read('backend/novu-bridge/config/novu-mint-key.sh');
    expect(mintScript).not.toMatch(/password="\$PASS"|-d "\$\(_jbody|Authorization: Bearer \$jwt"/);
    expect(mintScript).toContain('NB_PASS="$PASS" python3');
    expect(mintScript.match(/--data-binary @-/g)?.length).toBe(2);
    expect(mintScript).toContain('-H @-');
  });

  test('with per-tenant accounts off, the mint signs in with the admin password Novu accepts', () => {
    // OpenBao is read whenever Novu runs, so a box the feature already moved keeps its key.
    expect(task('novu tenant accounts — re-read tenant secrets')).toContain('when: enable_novu | default(false) | bool');
    const login = task('novu tenant accounts — effective Novu admin login');
    expect(login).toMatch(/_without: >-\n\s+\{\{ \(novu_admin_password \| default\('', true\)\) or _held\n\s+or \(novu_admin_password_legacy \| default\('', true\)\) or 'Digit@12345' \}\}/);
    expect(login).toContain('if (novu_tenant_accounts_on | bool) else _without');
    const candidates = task('novu-bootstrap — the Novu admin passwords to try (per-tenant accounts off)');
    expect(candidates).toContain("[novu_admin_password_held, novu_admin_password_legacy | default(''), 'Digit@12345']");
    expect(candidates).toContain("- not (novu_admin_password | default('', true))");
    expect(candidates).toContain('no_log: true');
    const probe = task('novu-bootstrap — the Novu admin password the mint signs in with (per-tenant accounts off)');
    expect(probe).toContain('NB_CANDIDATES: "{{ novu_admin_password_candidates | to_json }}"');
    expect(probe).toContain('no_log: true');
    expect(probe).not.toMatch(/python3 -c|--password/);
    expect(task('novu-bootstrap — sign in with the one Novu accepted (per-tenant accounts off)'))
      .toContain('novu_admin_password_candidates[novu_admin_pick.stdout | trim | int]');
    const at = (name: string) => playbook.indexOf(`- name: "${name}`);
    expect(at('novu-bootstrap — sign in with the one Novu accepted (per-tenant accounts off)'))
      .toBeLessThan(at('novu-bootstrap — mint Development API key (attempt 1: existing account)'));
    // The preflight switch-off hands the mint the same fallback.
    expect(read('local-setup/ansible/tasks/novu-tenant-accounts-verify.yml'))
      .toContain('novu_admin_password_effective: "{{ novu_admin_password_without_tenant_accounts }}"');
  });

  test('the Novu admin sign-in is verified before the bridge relies on it (review S2)', () => {
    const at = (name: string) => {
      const i = playbook.indexOf(`- name: "${name}`);
      expect(i).toBeGreaterThan(-1);
      return i;
    };
    const preflight = at('novu tenant accounts — verify the Novu admin sign-in (preflight)');
    const postStart = at('novu tenant accounts — verify the Novu admin sign-in (post-start)');
    for (const name of ['novu tenant accounts — verify the Novu admin sign-in (preflight)',
      'novu tenant accounts — verify the Novu admin sign-in (post-start)']) {
      const t = task(name);
      expect(t).toContain('ansible.builtin.include_tasks: tasks/novu-tenant-accounts-verify.yml');
      expect(t).toContain('- novu_tenant_accounts_on | bool');
    }
    // Preflight: the password is known, the bridge has not been given it, the stack has not started.
    expect(preflight).toBeGreaterThan(at('novu tenant accounts — effective Novu admin login'));
    expect(preflight).toBeLessThan(at('novu tenant accounts — write secrets into compose .env'));
    expect(preflight).toBeLessThan(playbook.indexOf('- name: Start DIGIT stack (Linux/Debian)'));
    // Post-start: after the legacy-password move and the mint, before the bridge is recreated
    // and before anything provisions.
    expect(postStart).toBeGreaterThan(at('novu tenant accounts — move the Novu admin off the legacy password'));
    expect(postStart).toBeGreaterThan(at('novu-bootstrap — resolve effective Novu key (pinned or minted)'));
    const recreate = at('novu-bootstrap — recreate novu-bridge so it picks up NOVU_API_KEY and the state-root OTP tenant');
    const recreatePgr = at('novu tenant accounts — recreate pgr-services without the bridge admin token');
    expect(postStart).toBeLessThan(recreate);
    expect(postStart).toBeLessThan(recreatePgr);
    expect(postStart).toBeLessThan(at('novu tenant accounts — provision the tenants listed in novu_tenant_accounts_backfill'));
    // Switched off after the start: both holders of the old .env are recreated.
    expect(task('novu-bootstrap — recreate novu-bridge so it picks up NOVU_API_KEY and the state-root OTP tenant'))
      .toContain('novu_tenant_accounts_switched_off_after_start | default(false) | bool');
    const pgr = task('novu tenant accounts — recreate pgr-services without the bridge admin token');
    expect(pgr).toContain('up -d --no-deps --force-recreate pgr-services');
    expect(pgr).toContain('when: novu_tenant_accounts_switched_off_after_start | default(false) | bool');
  });

  test('the sign-in check keeps the passwords off the command line and the log, and decides on its own', () => {
    const verify = read('local-setup/ansible/tasks/novu-tenant-accounts-verify.yml');
    const probe = verify.slice(verify.indexOf('- name: "novu tenant accounts — sign in to Novu as the platform admin'),
      verify.indexOf('- name: "novu tenant accounts — read the sign-in outcome'));
    expect(probe).toContain('ansible.builtin.command: python3 -');
    expect(probe).toContain('NB_NEW: "{{ novu_admin_password_effective }}"');
    expect(probe).toContain('no_log: true');
    expect(probe).not.toMatch(/python3 -c|--password/);
    // Off for this deploy: the bridge gets neither the switch nor the secrets.
    expect(verify).toContain('line: NOVU_BRIDGE_TENANT_ACCOUNTS_ENABLED=false');
    expect(verify).toMatch(/marker: "# \{mark\} NOVU TENANT ACCOUNT SECRETS"\n {4}state: absent/);
    // The explicit switch and provisioned workspaces stop the deploy instead.
    expect(verify).toContain('- name: "novu tenant accounts — stop: novu_tenant_accounts is set to true');
    expect(verify).toContain('- name: "novu tenant accounts — stop: workspaces here already use their own account');
    // And the matrix that drives it runs in CI.
    expect(read('.github/workflows/local-setup-ci.yaml')).toContain('tests/novu-tenant-accounts-verify-test.yml');
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
