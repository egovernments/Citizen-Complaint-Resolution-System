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
      // charts/environments holds values and the shared base, not helmfiles.
      return dir !== 'environments' && fs.statSync(full).isDirectory()
        ? fs.readdirSync(full).filter((f) => /helmfile.*\.ya?ml$/.test(f)).map((f) => `${DEPLOY}/charts/${dir}/${f}`)
        : [];
    })
    .filter((f) => /^(environments:|bases:)/m.test(read(f))),
];

const BASE = `${DEPLOY}/charts/environments/environments.yaml`;

/** The value file list of one environment, in order: the helmfile's own
 *  `environments:`, or the shared base it lists under `bases:`. */
const environmentValues = (helmfile: string, env: string): string[] => {
  const own = read(helmfile);
  const text = /^bases:\n {2}- \.\.\/environments\/environments\.yaml$/m.test(own) && !/^environments:/m.test(own)
    ? read(BASE) : own;
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

describe('/egov-mdms-service is public on both tiers', () => {
  test('Kong routes it on Compose/Ansible; the shim chart routes it through the gateway', () => {
    // digit-ui's citizen home reads StateInfo at /egov-mdms-service/v1/_search; a 404 there
    // is CORE_SOMETHING_WENT_WRONG on every tenant's citizen link.
    expect(read('local-setup/kong/kong.yml')).toMatch(/- name: mdms-v1-compat-route\n {4}paths:\n {4}- \/egov-mdms-service\n/);
    const chart = `${DEPLOY}/charts/core-services/egov-mdms-service`;
    expect(read(`${chart}/values.yaml`)).toMatch(/^ingress:\n {2}enabled: true\n {2}zuul: true\n {2}context: "egov-mdms-service"$/m);
    expect(read(`${chart}/templates/ingress.yaml`)).toContain('{{- template "common.ingress" . -}}');
    expect(read(`${DEPLOY}/charts/environments/env.yaml`)).toMatch(/egov-open-endpoints-whitelist: ".*\/egov-mdms-service\/v1\/_search,/);
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
    expect(tpl).toContain('{{- else if and (ne (toString (index . "configuratorRedirect")) "false")');
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


describe('environments are defined once where helmfile allows', () => {
  test('every charts/<tier> helmfile without pre-defaults uses the shared base; the rest keep their own block', () => {
    const own = helmfiles.filter((f) => /^environments:/m.test(read(f))).map((f) => path.basename(f)).sort();
    expect(own).toEqual(['digit-helmfile.yaml', 'identity-helmfile.yaml', 'monitoring-helmfile.yaml']);
  });
});

describe('the /turbopass proxy keeps this site\'s credentials', () => {
  test('nginx clears Cookie and Authorization and hides upstream Set-Cookie', () => {
    const conf = read(`${DEPLOY}/charts/urban/turbopass-proxy/templates/_helpers.tpl`);
    expect(conf).toContain('proxy_set_header Cookie "";');
    expect(conf).toContain('proxy_set_header Authorization "";');
    expect(conf).toContain('proxy_hide_header Set-Cookie;');
    expect(read(`${DEPLOY}/charts/urban/urban-helmfile.yaml`)).toContain('installed: {{ ne (index $turbopassUpstream "host" | default "") "" }}');
  });
});

describe('cms-saas-secrets-from-cluster.sh', () => {
  test('lets the most recently upgraded release win instead of stopping', () => {
    const script = read(`${DEPLOY}/scripts/cms-saas-secrets-from-cluster.sh`);
    expect(script).toContain('for r in sorted(json.load(open(sys.argv[1])), key=updated):');
    expect(script).not.toContain('resolve it by hand');
  });
});

describe('review round 4', () => {
  test('turbopass-proxy verifies the upstream certificate', () => {
    const conf = read(`${DEPLOY}/charts/urban/turbopass-proxy/templates/_helpers.tpl`);
    expect(conf).toContain('proxy_ssl_verify on;');
    expect(conf).toContain('proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;');
  });

  test.each(['urban/turbopass-proxy', 'core-services/egov-mdms-service'])(
    '%s: nginx listens on the merged httpPort, as common\'s Deployment and Service do', (chart) => {
      const conf = read(`${DEPLOY}/charts/${chart}/templates/_helpers.tpl`);
      expect(conf).toContain('{{- $port := $over.httpPort | default .Values.httpPort -}}');
      expect(conf).toContain('listen {{ $port }};');
      expect(conf).not.toContain('listen {{ .Values.httpPort }};');
    });

  test('the bare-domain redirect needs configurator installed', () => {
    expect(read(`${DEPLOY}/charts/core-services/configmaps/templates/root-ingress.yaml`))
      .toContain('(not (has "configurator" ($.Values.disabledReleases | default list)))');
  });

  test('every release-backed status check follows disabledReleases', () => {
    const tpl = read(`${DEPLOY}/charts/monitoring/gatus/templates/configmap.yaml`);
    expect(tpl).toContain('{{- $disabled := .Values.disabledReleases | default list }}');
    // Each check whose host is an egov/backbone/novu Service sits in a release guard.
    const blocks = tpl.split(/\n(?= {6}- name: )/).slice(1);
    for (const b of blocks) {
      const url = /url: "([a-z]+):\/\/([a-z0-9-]+)\.(egov|backbone|novu)\b/.exec(b);
      if (!url) continue;
      const before = tpl.slice(0, tpl.indexOf(b));
      expect([url[2], /\{\{- if not \(has "[\w.-]+" \$disabled\) \}\}\n(?:\s*#.*\n)*$/.test(before)]).toEqual([url[2], true]);
    }
  });

  test('the secrets script orders releases in UTC and will not trust a stale copy', () => {
    const script = read(`${DEPLOY}/scripts/cms-saas-secrets-from-cluster.sh`);
    expect(script).toContain('t.astimezone(timezone.utc)');
    expect(script).toContain('--force');
    expect(script).toContain('differs from the cluster on:');
  });

  test('identity-bootstrap RBAC goes after a failed run too, the Job keeps its logs', () => {
    const rbac = read(`${DEPLOY}/charts/identity/identity-bootstrap/templates/rbac.yaml`);
    expect(rbac.match(/hook-delete-policy: before-hook-creation,hook-succeeded,hook-failed/g)).toHaveLength(3);
    const job = read(`${DEPLOY}/charts/identity/identity-bootstrap/templates/job.yaml`);
    expect(job).not.toContain('hook-failed');
  });
});
