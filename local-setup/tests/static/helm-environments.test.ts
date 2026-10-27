/**
 * Static checks on the Helm tier's per-deployment environments
 * (devops/deploy-as-code). env.yaml and env-secrets.yaml are the shared
 * template; a deployment is a helmfile environment that layers its own file
 * over env.yaml and reads its real secrets from a git-ignored file.
 *
 * Run: npx jest --runInBand static/helm-environments.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPLOY = 'devops/deploy-as-code';
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const helmfiles = [
  `${DEPLOY}/digit-helmfile.yaml`,
  ...fs.readdirSync(path.join(REPO_ROOT, DEPLOY, 'charts'))
    .flatMap((dir) => {
      const full = path.join(REPO_ROOT, DEPLOY, 'charts', dir);
      return fs.statSync(full).isDirectory()
        ? fs.readdirSync(full).filter((f) => /helmfile.*\.ya?ml$/.test(f)).map((f) => `${DEPLOY}/charts/${dir}/${f}`)
        : [];
    })
    .filter((f) => /^environments:/m.test(read(f))),
];

/** The value file list of one environment, in order. */
const environmentValues = (helmfile: string, env: string): string[] => {
  const text = read(helmfile);
  const start = text.indexOf(`\n  ${env}:\n    values:\n`);
  if (start < 0) return [];
  const rest = text.slice(start + `\n  ${env}:\n    values:\n`.length);
  const end = rest.search(/\n {2}\S|\n---/);
  return [...rest.slice(0, end < 0 ? undefined : end).matchAll(/^ {6}- (\S+\.yaml)$/gm)].map((m) => m[1]);
};

describe('the cms-saas helmfile environment', () => {
  test('every helmfile with environments defines it', () => {
    expect(helmfiles.length).toBeGreaterThan(5);
    for (const f of helmfiles) {
      expect([f, environmentValues(f, 'cms-saas').length > 0]).toEqual([f, true]);
    }
  });

  test('it layers env.yaml, then cms-saas.yaml last, and reads the real secrets after the template', () => {
    for (const f of helmfiles) {
      const files = environmentValues(f, 'cms-saas').map((v) => path.basename(v));
      expect([f, files]).toEqual([f, ['env-secrets.yaml', 'cms-saas-secrets.yaml', 'env.yaml', 'cms-saas.yaml']]);
      // Same template files as `env`, so the two cannot drift apart.
      const env = environmentValues(f, 'env').map((v) => path.basename(v));
      expect([f, env]).toEqual([f, ['env-secrets.yaml', 'env.yaml']]);
    }
  });

  test('its secrets file is git-ignored and the template is not', () => {
    const ignored = (rel: string) => {
      try {
        execFileSync('git', ['check-ignore', '-q', rel], { cwd: REPO_ROOT });
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored(`${DEPLOY}/charts/environments/cms-saas-secrets.yaml`)).toBe(true);
    expect(ignored(`${DEPLOY}/charts/environments/env-secrets.yaml`)).toBe(false);
  });

  test('cms-saas.yaml holds no credential', () => {
    const values = read(`${DEPLOY}/charts/environments/cms-saas.yaml`);
    expect(values).not.toMatch(/^\s*secrets:/m);
    // A key named like a credential, with a value (comments may name Secret keys).
    expect(values).not.toMatch(/^\s*[\w.-]*(password|secret|token)[\w.-]*:\s*\S/im);
  });
});

describe('the configurator chart renders the same runtime config as Ansible', () => {
  test('config.js carries exactly the keys of configurator-config.js.j2', () => {
    const ansible = read('local-setup/ansible/templates/configurator-config.js.j2');
    const keysAnsible = [...ansible.matchAll(/^ {2}([A-Z_]+): \{\{/gm)].map((m) => m[1]).sort();
    const chart = read(`${DEPLOY}/charts/urban/configurator/templates/_helpers.tpl`);
    const list = /range \$key := list ((?:"[A-Z_]+" ?)+)/.exec(chart);
    expect(list).not.toBeNull();
    const keysChart = [...list![1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort();
    expect(keysAnsible.length).toBeGreaterThan(3);
    expect(keysChart).toEqual(keysAnsible);
    // Mounted over the copy the image ships, under the image's base path.
    const values = read(`${DEPLOY}/charts/urban/configurator/values.yaml`);
    expect(values).toContain('mountPath: /usr/share/nginx/html/configurator/config.js');
  });
});

describe('the bare domain lands on the Configurator on both tiers', () => {
  test('Ansible: root_to_configurator (default on) redirects / exactly, after root_to_digit_ui', () => {
    const nginx = read('local-setup/ansible/templates/nginx-site.conf.j2');
    const digitUi = nginx.indexOf('{% if nginx_features.root_to_digit_ui | default(false) %}');
    const configurator = nginx.indexOf('{% elif (nginx_features.root_to_configurator | default(true)) and nginx_features.configurator %}');
    expect(digitUi).toBeGreaterThan(-1);
    expect(configurator).toBeGreaterThan(digitUi);
    expect(nginx.slice(configurator)).toMatch(/^ {2}location = \/ \{ return 302 \/configurator\/; \}$/m);
    // In every digit_ui_mode: each mode's `location /` is a catch-all to Kong.
    expect(nginx.match(/^\{\{ root_location\(\) \}\}$/gm)).toHaveLength(3);
    expect(read('local-setup/ansible/inventory/group_vars/digit.yml')).toMatch(/^ {2}root_to_configurator: true\b/m);
  });

  test('Helm: root-ingress redirects /$ (exact under regex) to /configurator/ when no slug is set', () => {
    const tpl = read(`${DEPLOY}/charts/core-services/configmaps/templates/root-ingress.yaml`);
    expect(tpl).toContain('{{- else if ne (toString (index . "configuratorRedirect")) "false" }}');
    expect(tpl).toContain('nginx.ingress.kubernetes.io/temporal-redirect: {{ printf "%s://%s/configurator/" $scheme $.Values.global.domain | quote }}');
    expect(tpl).toMatch(/path: \/\$\n\s+pathType: ImplementationSpecific/);
    expect(read(`${DEPLOY}/charts/core-services/configmaps/values.yaml`)).toMatch(/^ {2}configuratorRedirect: true$/m);
  });
});

describe('pods roll when their mounted config changes', () => {
  // common sets no deployment-timestamp (disableAnnotationTimestamp: true), a
  // subPath mount never sees a ConfigMap update and nginx does not reload.
  test.each([
    ['urban/configurator', 'configurator.runtimeConfigJs'],
    ['core-services/egov-mdms-service', 'egov-mdms-service.conf'],
  ])('%s carries checksum/config of the content it mounts', (chart, tpl) => {
    const values = read(`${DEPLOY}/charts/${chart}/values.yaml`);
    expect(values).toContain(`checksum/config: {{ include "${tpl}" . | sha256sum | quote }}`);
    const templates = fs.readdirSync(path.join(REPO_ROOT, DEPLOY, 'charts', chart, 'templates'))
      .map((f) => read(`${DEPLOY}/charts/${chart}/templates/${f}`)).join('\n');
    expect(templates).toContain(`{{- define "${tpl}" -}}`);
    expect(templates).toContain(`{{- include "${tpl}" . | nindent 4 }}`);
  });
});

describe('releases an environment leaves out (disabledReleases)', () => {
  const always = [
    'backbone-services/backboneservices-helmfile.yaml', 'core-services/coreservices-helmfile.yaml',
    'common-services/common-services-helmfile.yaml', 'auxiliary-services/auxiliary-helmfile.yaml',
    'urban/urban-helmfile.yaml', 'monitoring/monitoring-helmfile.yaml',
  ];
  test.each(always)('%s: no release is unconditionally installed; each reads $disabled', (f) => {
    const text = read(`${DEPLOY}/charts/${f}`);
    expect(text).toContain('{{- $disabled := index .Values "disabledReleases" | default list }}');
    expect(text).not.toMatch(/^\s*installed: true\s*(#.*)?$/m);
    for (const m of text.matchAll(/^\s*installed: \{\{ not \(has "([\w.-]+)" \$disabled\) \}\}/gm)) {
      // the name it checks is the release it belongs to
      const before = text.slice(0, m.index);
      const owner = [...before.matchAll(/^\s*- name:\s*([\w.-]+)/gm)].pop();
      expect([m[1], owner?.[1]]).toEqual([m[1], m[1]]);
    }
  });

  test('env.yaml disables nothing; every name cms-saas disables is a real release', () => {
    expect(read(`${DEPLOY}/charts/environments/env.yaml`)).toMatch(/^disabledReleases: \[\]$/m);
    const cms = read(`${DEPLOY}/charts/environments/cms-saas.yaml`);
    const block = /^disabledReleases:\n((?: {2}- [\w.-]+.*\n)+)/m.exec(cms);
    expect(block).not.toBeNull();
    const names = [...block![1].matchAll(/- ([\w.-]+)/g)].map((m) => m[1]);
    const all = always.map((f) => read(`${DEPLOY}/charts/${f}`)).join('\n');
    for (const n of names) expect([n, all.includes(`(has "${n}" $disabled)`)]).toEqual([n, true]);
  });
});
