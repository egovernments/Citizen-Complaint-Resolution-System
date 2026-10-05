import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const compose = read('local-setup/docker-compose.egov-digit.yaml');

function service(name: string): string {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^networks:|^volumes:|(?![\\s\\S]))`, 'm'));
  if (!match) throw new Error(`Missing Compose service: ${name}`);
  return match[1];
}

function setting(block: string, key: string): string {
  const match = block.match(new RegExp(`^      ${key}: (.+)$`, 'm'));
  if (!match) throw new Error(`Missing service setting: ${key}`);
  return match[1];
}

describe('PGR onboarding cutover deployment contract', () => {
  const pgr = service('pgr-services');
  const bff = service('identity-bff');

  test('both sides use the dedicated onboarding token, without operator or introspection fallback', () => {
    const token = setting(pgr, 'PGR_ONBOARDING_IDENTITY_BFF_TOKEN');
    expect(token).toBe(setting(bff, 'IDENTITY_ONBOARDING_TOKEN'));
    expect(token).toBe('${IDENTITY_ONBOARDING_TOKEN:-}');
    expect(token).not.toMatch(/SESSION_INTROSPECTION|CONTROL_PLANE|dev-only/);
  });

  test('only PGR receives the provisioner credential and the worker is no longer configured in BFF', () => {
    for (const suffix of ['USERNAME', 'PASSWORD', 'TENANT_ID']) {
      expect(setting(pgr, `DIGIT_PROVISIONER_${suffix}`)).toBe(`\${PGR_DIGIT_PROVISIONER_${suffix}:-}`);
      expect(bff).not.toMatch(new RegExp(`^      DIGIT_PROVISIONER_${suffix}:`, 'm'));
    }
    expect(bff).not.toMatch(/^      (?:ONBOARDING_WORKER|PGR_ONBOARDING_WORKER|ONBOARDING_TENANT_ADMIN|DIGIT_FOUNDATION_SOURCE_TENANT)/m);
    expect(bff).not.toMatch(/^      DIGIT_(?:MDMS_CREATE_URL|MDMS_SCHEMA_CREATE_URL|ENC_GENERATE_KEY_URL):/m);
    expect(setting(pgr, 'PGR_ONBOARDING_RUNNER_ENABLED')).toBe('${PGR_ONBOARDING_RUNNER_ENABLED:-true}');
  });

  test('the external worker lease API and its token are gone; only the in-process runner claims work', () => {
    expect(pgr).not.toMatch(/^      PGR_ONBOARDING_WORKER_TOKEN:/m);
    expect(read('backend/pgr-services/src/main/resources/application.properties')).not.toMatch(/pgr\.onboarding\.worker\.|PGR_ONBOARDING_WORKER_TOKEN/);
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    expect(playbook).not.toMatch(/pgr_onboarding_worker_token|PGR_ONBOARDING_WORKER_TOKEN/);
    expect(fs.existsSync(path.join(root, 'backend/pgr-services/src/main/java/org/egov/pgr/web/controllers/OnboardingWorkerController.java'))).toBe(false);
  });

  test('workspace writes have a separate Kong origin with no implicit internal fallback', () => {
    expect(setting(pgr, 'EGOV_GATEWAY_HOST')).toBe('http://kong:8000');
    const properties = read('backend/pgr-services/src/main/resources/application.properties');
    expect(properties).toContain('egov.gateway.host=${EGOV_GATEWAY_HOST:}');
    expect(setting(pgr, 'EGOV_GATEWAY_HOST')).not.toBe(setting(pgr, 'EGOV_MDMS_HOST'));
  });

  test('new tenant bootstrap reaches internal APIs without target-tenant gateway RBAC', () => {
    const hosts: Record<string, string> = {
      MDMS: 'egov-mdms-service:8094', HRMS: 'egov-hrms:8092',
      USER: 'egov-user-proxy:8107', LOCALIZATION: 'egov-localization:8096',
      BOUNDARY: 'boundary-service:8081', ENC: 'egov-enc-service:1234',
    };
    for (const [name, host] of Object.entries(hosts)) {
      expect(setting(pgr, `EGOV_${name}_HOST`).replace(/\/$/, '')).toBe(`http://${host}`);
    }
  });

  test('only the writable MCP service receives the internal bootstrap MDMS host', () => {
    expect(setting(service('digit-mcp'), 'EGOV_MDMS_HOST')).toBe('http://egov-mdms-service:8094');
    expect(service('digit-mcp-readonly')).not.toMatch(/^      EGOV_MDMS_HOST:/m);
    expect(setting(service('digit-mcp'), 'CRS_API_URL')).toBe('http://kong:8000');
    for (const name of ['digit-mcp', 'digit-mcp-readonly']) {
      expect(service(name)).not.toMatch(/^      MCP_PLATFORM_BOOTSTRAP_DIRECT:/m);
    }
  });

  test('Ansible preserves stored provisioner credentials while rendering them only for PGR', () => {
    const template = read('local-setup/ansible/templates/digit.env.j2');
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    expect(template).toContain('PGR_ONBOARDING_RUNNER_ENABLED={{ pgr_onboarding_runner_effective | bool | lower }}');
    expect(template).toContain('PGR_DIGIT_PROVISIONER_USERNAME={{ pgr_provisioner_username }}');
    expect(template).toContain('PGR_DIGIT_PROVISIONER_TENANT_ID={{ pgr_provisioner_tenant_id }}');
    expect(template).not.toMatch(/^IDENTITY_(?:DIGIT_PROVISIONER|ONBOARDING_WORKER|FOUNDATION_SOURCE)/m);
    expect(playbook).toContain('PGR_DIGIT_PROVISIONER_PASSWORD={{ identity_secrets.pgr_digit_provisioner_password }}');
    const password = playbook.match(/pgr_digit_provisioner_password: >-\n([\s\S]*?)(?=\n      when:)/)?.[1];
    // Stored value, then the legacy BFF provisioner's, then a generated one egov-user accepts.
    expect(password).toMatch(/_identity_stored\.pgr_digit_provisioner_password[\s\S]*_identity_stored\.identity_digit_provisioner_password[\s\S]*lookup\('password'/);
    expect(playbook).not.toMatch(/^\s+IDENTITY_DIGIT_PROVISIONER_PASSWORD=/m);
    expect(playbook).toContain('IDENTITY_ONBOARDING_TOKEN={{ identity_secrets.identity_onboarding_token }}');
    const resolver = playbook.match(/identity_onboarding_token: >-\n([\s\S]*?)(?=\n          \S)/)?.[1];
    expect(resolver).toContain('_identity_stored.identity_onboarding_token');
    expect(resolver).toContain("lookup('password', '/dev/null length=48 chars=ascii_letters,digits')");
    expect(resolver).not.toContain('keycloak_admin_password');
    const secretScan = read('local-setup/ansible/scripts/check-committed-secrets.sh');
    expect(secretScan).toContain('"pgr_digit_provisioner_password"');
    expect(secretScan).toContain('"pgr_digit_oauth_client_secret"');
  });

  // Review #2269 item 7: the runner is on by default, so the deploy must create the
  // provisioner it signs in as, or fail with the fix.
  test('Ansible ensures the provisioner account with the roles PGR re-verifies', () => {
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    const groupVars = read('local-setup/ansible/inventory/group_vars/digit.yml');
    expect(groupVars).toContain("pgr_onboarding_runner_effective: \"{{ (pgr_onboarding_runner_enabled | default(true) | bool) and (enable_keycloak | default(false) | bool) }}\"");
    expect(groupVars).toMatch(/^pgr_provisioner_username: .*or 'PGR_PROVISIONER' }}"$/m);
    expect(groupVars).toMatch(/^pgr_provisioner_tenant_id: .*or state_root \| default\('', true\) or 'pg' }}"$/m);

    const ensure = playbook.match(/- name: "onboarding provisioner — ensure the account exists[\s\S]*?(?=\n    - name: )/)?.[0];
    expect(ensure).toBeDefined();
    expect(ensure).toContain('http://egov-user-proxy:8107/user/users/_createnovalidate'); // never through Kong
    expect(ensure).toContain('DuplicateUserName');
    expect(ensure).toContain('password: "{{ identity_secrets.pgr_digit_provisioner_password }}"');
    expect(ensure).toContain('no_log: true');
    expect(ensure).toContain('when: pgr_onboarding_runner_effective | bool');
    const client = read('backend/pgr-services/src/main/java/org/egov/pgr/onboarding/OnboardingProvisionerClient.java');
    for (const role of ['MDMS_ADMIN', 'ACCOUNT_ADMIN', 'LOC_ADMIN', 'HRMS_ADMIN']) {
      expect(client).toContain(`"${role}"`);
      expect(ensure).toContain(`code: ${role}, `);
    }

    const verify = playbook.match(/- name: "onboarding provisioner — can sign in with the onboarding admin roles"[\s\S]*?(?=\n    - name: )/)?.[0];
    expect(verify).toContain("['MDMS_ADMIN', 'ACCOUNT_ADMIN', 'LOC_ADMIN', 'HRMS_ADMIN'] | difference(_roles)");
    expect(verify).toContain('pgr_provisioner_login.status == 200');
    // #2269 round-3 review item 2: a refused login after PGR ran with a wrong password may be
    // egov-user's lockout; the message says so and gives both tables of the reset.
    expect(verify).toContain('error_description');
    expect(verify).toMatch(/LOCKOUT/);
    expect(verify).toContain('UPDATE eg_user SET accountlocked=false');
    expect(verify).toContain('eg_user_login_failed_attempts SET active=false');
    expect(playbook.indexOf('onboarding provisioner — settings are usable'))
      .toBeLessThan(playbook.indexOf('onboarding provisioner — ensure the account exists'));
  });

  test('Helm wires onboarding with the runner off by default', () => {
    const values = read('devops/deploy-as-code/charts/urban/pgr-services/values.yaml');
    expect(values).toMatch(/^onboarding:\n  runnerEnabled: false$/m);
    expect(values).toContain('- name: PGR_ONBOARDING_RUNNER_ENABLED\n    value: {{ .Values.onboarding.runnerEnabled | quote }}');
    for (const name of ['PGR_ONBOARDING_IDENTITY_BFF_URL', 'PGR_ONBOARDING_IDENTITY_BFF_TOKEN', 'DIGIT_PROVISIONER_USERNAME',
      'DIGIT_PROVISIONER_TENANT_ID', 'DIGIT_PROVISIONER_PASSWORD']) {
      expect(values).toContain(`- name: ${name}\n`);
    }
    expect(values).toMatch(/- name: DIGIT_PROVISIONER_PASSWORD\n    valueFrom:\n      secretKeyRef:/);
  });
});

describe('pgr-services onboarding reserves the canonical URL slugs (identity-bff docs §2.4.1)', () => {
  test('OnboardingIdentifierService.RESERVED_URL_SLUGS equals the documented list', () => {
    const doc = read('backend/identity-bff/docs/identity-bff.md');
    const block = /<!-- reserved-url-slugs:begin -->([\s\S]*?)<!-- reserved-url-slugs:end -->/.exec(doc);
    expect(block).not.toBeNull();
    const documented = block![1].split('\n').map((line) => line.trim()).filter((line) => /^[a-z0-9-]+$/.test(line));
    const java = read('backend/pgr-services/src/main/java/org/egov/pgr/onboarding/OnboardingIdentifierService.java');
    const list = /RESERVED_URL_SLUGS = Set\.of\(([\s\S]*?)\);/.exec(java);
    expect(list).not.toBeNull();
    const reserved = [...list![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(10);
    expect(reserved.sort()).toEqual(documented.sort());
  });
});
