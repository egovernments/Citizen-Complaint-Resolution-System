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
    expect(template).toContain('PGR_ONBOARDING_RUNNER_ENABLED={{ pgr_onboarding_runner_enabled | default(true) | lower }}');
    expect(template).not.toMatch(/^IDENTITY_(?:DIGIT_PROVISIONER|ONBOARDING_WORKER|FOUNDATION_SOURCE)/m);
    expect(playbook).toContain('PGR_DIGIT_PROVISIONER_PASSWORD={{ bao_secrets_identity.json.data.data.pgr_digit_provisioner_password | default(bao_secrets_identity.json.data.data.identity_digit_provisioner_password');
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
});
