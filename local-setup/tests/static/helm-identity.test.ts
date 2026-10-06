/**
 * Static contract tests for the Helm identity stack
 * (devops/deploy-as-code/charts/identity). Pure file reads, like the other
 * chart checks in deployment-contracts.test.ts: no helm binary, no cluster.
 *
 * After legacy identity removal (#2271) every digit-ui sign-in needs
 * /identity/v1 (the Identity BFF) and Keycloak, so a Helm deploy that is
 * missing a route, a BFF setting or the realm reconcile has no sign-in.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const CHARTS = 'devops/deploy-as-code/charts/identity';
const BFF = `${CHARTS}/identity-bff`;
const KC = `${CHARTS}/keycloak`;

// A chart's values.yaml plus every template, as one text.
const chartText = (dir: string) => {
  const templates = path.join(REPO_ROOT, dir, 'templates');
  return [
    read(`${dir}/values.yaml`),
    ...fs.readdirSync(templates).map((f) => read(`${dir}/templates/${f}`)),
  ].join('\n');
};

// The `environment:` keys of one Compose service, read by layout.
const composeServiceEnv = (compose: string, service: string) => {
  const start = compose.indexOf(`\n  ${service}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:\n/);
  const block = next === -1 ? rest : rest.slice(0, next + 1);
  const env = block.slice(block.indexOf('    environment:\n'));
  return [...env.matchAll(/^ {6}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
};

describe('identity-bff chart: /identity/v1 ingress', () => {
  const ingress = read(`${BFF}/templates/ingress.yaml`);
  const values = read(`${BFF}/values.yaml`);

  test('routes /identity/v1, anchored, unrewritten, straight to the BFF', () => {
    expect(values).toMatch(/^ingress:\n {2}enabled: true\n {2}context: "identity\/v1"$/m);
    // The path is "/<context>(/|$)": /identity/v1 and everything under it,
    // not /identity/v1foo, and never /internal/identity/v1/* (the control plane).
    expect(ingress).toContain('- path: {{ printf "/%s(/|$)" (trimAll "/" .Values.ingress.context) }}');
    expect(ingress).toContain('pathType: ImplementationSpecific');
    expect(ingress).toContain('"nginx.ingress.kubernetes.io/use-regex" "true"');
    expect(ingress).not.toContain('rewrite-target');
    expect(ingress).toMatch(/service:\n\s+name: \{\{ template "common.name" \. \}\}\n\s+port:\n\s+number: \{\{ \.Values\.httpPort \}\}/);
    expect(values).toMatch(/^httpPort: 3000$/m);
    expect(values).not.toMatch(/^\s+zuul: true/m);
  });

  test('liveness is /livez and readiness is /readyz', () => {
    expect(values).toMatch(/livenessProbe: \|\n\s+httpGet:\n\s+path: \/livez/);
    expect(values).toMatch(/readinessProbe: \|\n\s+httpGet:\n\s+path: \/readyz/);
  });
});

describe('keycloak chart: /auth ingress', () => {
  const ingress = read(`${KC}/templates/ingress.yaml`);
  const values = read(`${KC}/values.yaml`);

  test('publishes only the identity realm and theme resources, prefix stripped', () => {
    expect(values).toMatch(/^ {2}pathPrefix: "\/auth"$/m);
    expect(ingress).toContain('{{ printf "%s/(realms/%s/.*)" $prefix (regexQuoteMeta $realm) }}');
    expect(ingress).toContain('{{ printf "%s/(resources/.*)" $prefix }}');
    expect(ingress).toContain('"nginx.ingress.kubernetes.io/rewrite-target" "/$1"');
    // Exactly the two paths: nothing that could reach /admin or the master realm.
    expect(ingress.match(/^\s+- path: /gm)).toHaveLength(2);
    expect(ingress).not.toMatch(/path: [^\n]*(admin|master)/);
  });

  test('Keycloak serves at / with the public /auth prefix in KC_HOSTNAME, as Compose does', () => {
    expect(values).toContain('- name: KC_HOSTNAME\n    value: {{ printf "%s%s" (include "common.identity.publicUrl" .) .Values.ingress.pathPrefix | quote }}');
    expect(values).toMatch(/- name: KC_PROXY_HEADERS\n {4}value: xforwarded/);
    expect(values).toMatch(/- name: KC_HOSTNAME_BACKCHANNEL_DYNAMIC\n {4}value: "true"/);
    expect(values).toMatch(/^httpPort: 8180$/m);
  });
});

describe('identity-bff chart exposes every BFF setting', () => {
  const text = chartText(BFF);
  const src = (rel: string) => read(`backend/identity-bff/src/${rel}`);
  const configKeys = [
    ...src('infrastructure/config.ts').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g),
    ...src('infrastructure/staff-credential-config.ts').matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g),
    ...src('modules/revocation/poller.ts').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g),
  ].map((m) => m[1]);

  // Read by the BFF but deliberately not exposed, each with its reason.
  const NOT_EXPOSED: Record<string, string> = {
    IDENTITY_ALLOWED_ORIGIN: 'older alias of IDENTITY_ALLOWED_ORIGINS, which the chart derives',
    IDENTITY_CITIZEN_OTP_SENDER: 'older alias of IDENTITY_OTP_SENDER, which the chart sets',
    DIGIT_BOOTSTRAP_SOURCE_TENANT: 'older alias of DIGIT_FOUNDATION_SOURCE_TENANT',
    DIGIT_IDENTITY_CLIENT_ID: 'older alias of DIGIT_ROLE_CLIENT_ID',
    KEYCLOAK_ADMIN_USERNAME: 'master-admin password grant; the BFF uses the digit-identity-admin client',
    KEYCLOAK_ADMIN_PASSWORD: 'master-admin password grant; the BFF uses the digit-identity-admin client',
  };

  test('config.ts still reads the settings this test was written against', () => {
    expect(configKeys.length).toBeGreaterThan(90);
    for (const key of Object.keys(NOT_EXPOSED)) expect(configKeys).toContain(key);
  });

  test.each([...new Set(configKeys)].filter((k) => !(k in NOT_EXPOSED)))('%s', (key) => {
    expect(text).toMatch(new RegExp(`\\b${key}\\b`));
  });

  test('every variable the Compose/Ansible identity-bff service sets', () => {
    const composeKeys = composeServiceEnv(read('local-setup/docker-compose.egov-digit.yaml'), 'identity-bff');
    expect(composeKeys.length).toBeGreaterThan(50);
    const missing = composeKeys.filter((k) => !(k in NOT_EXPOSED) && !new RegExp(`\\b${k}\\b`).test(text));
    expect(missing).toEqual([]);
  });

  test('secrets come from a Secret, never from values', () => {
    const helpers = read(`${BFF}/templates/_helpers.tpl`);
    for (const env of [
      'KEYCLOAK_BFF_CLIENT_SECRET', 'KEYCLOAK_ADMIN_CLIENT_SECRET', 'KEYCLOAK_EMPLOYEE_CLIENT_SECRET',
      'KEYCLOAK_CITIZEN_CLIENT_SECRET', 'KEYCLOAK_MAGIC_LINK_CLIENT_SECRET', 'DIGIT_ADMIN_PASSWORD',
      'DIGIT_PROVISIONER_PASSWORD', 'IDENTITY_CONTROL_PLANE_TOKEN', 'IDENTITY_SESSION_INTROSPECTION_TOKEN',
      'IDENTITY_ONBOARDING_TOKEN', 'PGR_ONBOARDING_WORKER_TOKEN', 'IDENTITY_CITIZEN_OTP_SECRET',
      'IDENTITY_CREDENTIAL_KEYS', 'IDENTITY_CREDENTIAL_KEY_CURRENT', 'IDENTITY_SURFACES_JSON',
    ]) {
      expect(helpers).toMatch(new RegExp(`^[a-z-]+: ${env}$`, 'm'));
      expect(read(`${BFF}/values.yaml`)).not.toMatch(new RegExp(`^ {2}${env}:`, 'm'));
    }
  });
});

describe('keycloak chart: realm-configure Job', () => {
  const job = read(`${KC}/templates/configure-job.yaml`);

  test('is a post-install and post-upgrade hook', () => {
    expect(job).toContain('"helm.sh/hook": post-install,post-upgrade');
    expect(job).toContain('command: ["/bin/bash", "/opt/identity/configure-keycloak.sh"]');
    expect(job).toMatch(/- name: KEYCLOAK_REALM_CONFIG\n\s+value: \/opt\/identity\/realm\.json/);
  });

  // The Job runs the script and realm baked into the image it runs in, so the
  // chart carries no copies to keep in sync.
  test('runs the script and realm.json from the Keycloak image, not chart copies', () => {
    expect(read('keycloak/Dockerfile')).toMatch(/^COPY configure-keycloak\.sh realm\.json \/opt\/identity\/$/m);
    expect(fs.existsSync(path.join(REPO_ROOT, KC, 'files'))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, KC, 'templates/configure-configmap.yaml'))).toBe(false);
    expect(job).not.toMatch(/configMap:|volumeMounts:|\.Files\.Get/);
  });

  // Hook Jobs are recreated on every hook run (before-hook-creation), so a
  // pod-template checksum triggers nothing; and with wait: true Helm starts
  // post-install/upgrade hooks only once the Deployment is Ready.
  test('carries no pod-template checksum and no wait loop, only a short login retry', () => {
    expect(job).not.toContain('checksum/realm-config');
    expect(job).not.toContain('/dev/tcp');
    expect(job).toMatch(/- name: KEYCLOAK_LOGIN_ATTEMPTS\n\s+value: \{\{ \.Values\.configure\.loginAttempts \| toString \| quote \}\}/);
    expect(read(`${KC}/values.yaml`)).toMatch(/^ {2}loginAttempts: \d+$/m);
    // One attempt under Compose/Ansible, which run the script on a healthy container.
    expect(read('keycloak/configure-keycloak.sh')).toContain('readonly LOGIN_ATTEMPTS=${KEYCLOAK_LOGIN_ATTEMPTS:-1}');
  });

  test('the Job image has the tools the script runs outside kcadm', () => {
    // bash, head and tr ship in the Keycloak base image; jq does not.
    expect(read('keycloak/Dockerfile')).toMatch(/^COPY --from=jq \/jq \/usr\/bin\/jq$/m);
    // Under Kubernetes kcadm runs in the Job pod, so its server is the Service.
    expect(read('keycloak/configure-keycloak.sh')).toContain(
      'readonly KCADM_SERVER=${KEYCLOAK_KCADM_SERVER:-http://127.0.0.1:8180}');
    expect(job).toMatch(/- name: KEYCLOAK_KCADM_SERVER\n\s+value: \{\{ include "keycloak.serviceUrl" \. \| quote \}\}/);
    // ...and kcadm runs in the Job's own container, not through `docker exec`.
    const script = read('keycloak/configure-keycloak.sh');
    expect(script.match(/docker exec /g)).toHaveLength(1);
    expect(script).toContain('if [ -z "${KEYCLOAK_KCADM_SERVER:-}" ]; then\n    docker exec ${opts[@]+"${opts[@]}"} "$KEYCLOAK_CONTAINER" "$@"');
  });

  // smtpServer.auth=true with no login makes every Keycloak mail fail at
  // SMTP login while the install reports success.
  test('SMTP auth defaults to off, as in the script, and auth without credentials is refused', () => {
    expect(read(`${KC}/values.yaml`)).toMatch(/^ {4}auth: false$/m);
    expect(read('keycloak/configure-keycloak.sh')).toContain('local smtp_auth=${KEYCLOAK_SMTP_AUTH:-false}');
    expect(job).toContain('configure.smtp.auth is true but configure.smtp.user is empty');
    expect(job).toContain('configure.smtp.auth is true but the Secret has no keycloak-smtp-password');
    expect(job).toMatch(/key: keycloak-smtp-password\n\s+optional: \{\{ not \$smtpAuth \}\}/);
  });

  // With existingSecret a rotated client secret changes nothing in the chart,
  // so without this the hook (and Keycloak's copy of the secret) never updates.
  test("reruns on a rotated existingSecret: its data's checksum is on the hook Job", () => {
    expect(job).toContain('lookup "v1" "Secret" .Release.Namespace .Values.secret.existingSecret');
    expect(job).toContain('$existing.data | default dict | toJson | sha256sum');
    // No cluster (helm template, client-side diff): render, do not fail.
    expect(job).toContain('$secretChecksum = "unavailable"');
    const meta = job.slice(job.indexOf('kind: Job'), job.indexOf('\nspec:'));
    expect(meta).toContain('checksum/existing-secret: {{ $secretChecksum | quote }}');
  });

  // Keycloak drops an empty client attribute, and the BFF reads a missing
  // digit.auth.signin.methods on the citizen client as misconfigured: /readyz
  // stays 503 and the pod never takes traffic.
  test('declares the citizen client sign-in methods (never empty)', () => {
    expect(read(`${KC}/values.yaml`)).toMatch(/^ {2}citizenSigninMethods: "phone_otp"$/m);
    expect(job).toMatch(/- name: KEYCLOAK_CITIZEN_SIGNIN_METHODS\n\s+value: \{\{ \.Values\.configure\.citizenSigninMethods \| quote \}\}/);
  });

  test('sets every variable the Ansible reconcile task passes the script', () => {
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    const start = playbook.indexOf('- name: "identity-bootstrap — reconcile Organizations realm and BFF clients"');
    expect(start).toBeGreaterThan(-1);
    const task = playbook.slice(start, playbook.indexOf('\n      when:', start));
    const keys = [...task.matchAll(/^ {8}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(25);
    // IDENTITY_ENV_DIR points the script at a Compose host's env file; the Job has none.
    const missing = keys.filter((k) => k !== 'IDENTITY_ENV_DIR' && !job.includes(`${k}`));
    expect(missing).toEqual([]);
  });
});

// Keycloak's redirect URIs and the BFF's issuer and redirect URI must come
// from one public-URL rule, and both Secrets refuse the same placeholders.
describe('helpers the identity charts share live in charts/common', () => {
  const common = [
    read('devops/deploy-as-code/charts/common/templates/_helpers.tpl'),
    read('devops/deploy-as-code/charts/common/templates/_identity.tpl'),
  ].join('\n');
  const kc = chartText(KC);
  const bff = chartText(BFF);

  test.each(['common.identity.publicUrl', 'common.pullPolicy', 'common.refuseSecretPlaceholders'])('%s', (helper) => {
    expect(common).toContain(`define "${helper}"`);
    expect(kc).toContain(`include "${helper}"`);
    expect(bff).toContain(`include "${helper}"`);
  });

  test('no chart-local copies remain', () => {
    for (const text of [kc, bff]) {
      expect(text).not.toMatch(/define "(keycloak|identity-bff)\.(publicUrl|pullPolicy)"/);
      expect(text).not.toContain('regexMatch "^<.*>$"');
      expect(text).not.toContain('nightly-.*');
    }
  });
});

describe('identity helmfile wiring', () => {
  const helmfile = read(`${CHARTS}/identity-helmfile.yaml`);

  test('both releases are gated on identity.enabled, default off', () => {
    expect(helmfile.match(/^ {4}installed: \{\{ \$enabled \}\}$/gm)).toHaveLength(2);
    expect(helmfile).toMatch(/- identity:\n {10}enabled: false/);
    expect(read('devops/deploy-as-code/charts/environments/env.yaml')).toMatch(/^identity:\n {2}enabled: false$/m);
  });

  test('Keycloak is ready, and its realm configured, before the BFF starts', () => {
    expect(helmfile).toMatch(/- name: keycloak\n[\s\S]*?wait: true/);
    expect(helmfile).toMatch(/- name: identity-bff\n[\s\S]*?needs:\n\s+- keycloak/);
  });

  test("the keycloak release's timeout outlasts the realm-configure Job's deadline", () => {
    const timeout = Number(/- name: keycloak\n[\s\S]*?\n {4}timeout: (\d+)\n/.exec(helmfile)?.[1]);
    const deadline = Number(/^ {2}activeDeadlineSeconds: (\d+)$/m.exec(read(`${KC}/values.yaml`))?.[1]);
    expect(deadline).toBeGreaterThan(0);
    expect(timeout).toBeGreaterThan(deadline);
  });

  // A Keycloak URL hard-coded in the BFF chart kept pointing at
  // keycloak.egov:8180 when the port, name or namespace moved.
  test('the BFF reaches Keycloak through the same shared values and helper as the keycloak chart', () => {
    expect(helmfile).toMatch(/"httpPort" \(index \$kcOverrides "httpPort" \| default 8180\)/);
    expect(helmfile).toContain('"keycloak" $keycloak }}');
    expect(helmfile.match(/^ {4}namespace: \{\{ \$namespace \}\}$/gm)).toHaveLength(2);
    expect(read(`${BFF}/templates/_helpers.tpl`)).toContain('{{- $kc := include "common.identity.keycloakUrl" . -}}');
    expect(read(`${KC}/templates/_helpers.tpl`)).toContain('{{- include "common.identity.keycloakUrl" . -}}');
    expect(read('devops/deploy-as-code/charts/common/templates/_identity.tpl')).toContain('define "common.identity.keycloakUrl"');
    expect(read(`${BFF}/values.yaml`)).not.toMatch(/^keycloak:/m);
    // The helmfile's default port is the keycloak chart's.
    expect(read(`${KC}/values.yaml`)).toMatch(/^httpPort: 8180$/m);
  });

  test('digit-helmfile.yaml includes it', () => {
    expect(read('devops/deploy-as-code/digit-helmfile.yaml')).toMatch(
      /^ {2}- path: \.\/charts\/identity\/identity-helmfile\.yaml$/m);
  });

  test('the secret reference defaults to an out-of-band Secret', () => {
    expect(read('devops/deploy-as-code/charts/environments/env-secrets.yaml')).toMatch(
      /^ {4}identity:\n {8}existingSecret: identity-secrets\n {8}values: \{\}$/m);
  });
});
