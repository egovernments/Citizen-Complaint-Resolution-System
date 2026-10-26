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
    const chart = read(`${DEPLOY}/charts/urban/configurator/templates/runtime-config.yaml`);
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
