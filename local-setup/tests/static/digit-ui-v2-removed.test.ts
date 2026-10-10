/**
 * digit-ui-v2 removal contract.
 *
 * The Vite citizen SPA once served at <host>/citizen (digit-ui-v2) was removed
 * as unused. This pins that no build, deploy, Helm, CI or scan wiring for it
 * comes back, and that hosts whose (gitignored) host_vars still set
 * enable_digit_ui_v2 get a warning and a cleanup, never a failed deploy.
 *
 * Not to be confused with digit-ui-esbuild's citizen app at /digit-ui/citizen,
 * which stays.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const V2_PATTERN = 'digit-ui-v2|digit_ui_v2|DIGIT_UI_V2';

// Files allowed to mention digit-ui-v2, each for a stated reason. Anything
// else is leftover wiring or current-state docs that still describe the app.
const ALLOWED_PREFIXES = [
  'docs/releases/', // historical release notes, changelogs, migration guides
];
const ALLOWED_FILES = new Set([
  // deprecation warning for leftover host_vars keys + cleanup of old bundle
  'local-setup/ansible/playbook-deploy.yml',
  // preflight WARN rule for the same leftover keys (and its self-test cases)
  'local-setup/scripts/preflight.py',
  // this test
  'local-setup/tests/static/digit-ui-v2-removed.test.ts',
  // dated design/plan records describing what was true when they were written
  'docs/features/complaint-hierarchy/design.md',
  'docs/features/complaint-hierarchy/two-master-rework-plan.md',
  'docs/features/dashboard/design/20-attribute-resolution.md',
  'docs/features/dashboard/design/80-multi-tier-complaint-types.md',
]);

const gitGrepFiles = (pattern: string): string[] => {
  try {
    return execFileSync('git', ['grep', '-lE', pattern, '--', '.'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch (e: any) {
    if (e.status === 1) return []; // git grep: no matches
    throw e;
  }
};

describe('digit-ui-v2 is removed', () => {
  test('the app source and its Helm chart are gone', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'digit-ui-v2'))).toBe(false);
    expect(
      fs.existsSync(path.join(REPO_ROOT, 'devops/deploy-as-code/charts/urban/digit-ui-v2')),
    ).toBe(false);
  });

  test('no tracked file references digit-ui-v2 outside the allowlist', () => {
    const leftovers = gitGrepFiles(V2_PATTERN).filter(
      (f) => !ALLOWED_FILES.has(f) && !ALLOWED_PREFIXES.some((p) => f.startsWith(p)),
    );
    expect(leftovers).toEqual([]);
  });

  test('host nginx no longer has a /citizen location', () => {
    const nginx = read('local-setup/ansible/templates/nginx-site.conf.j2');
    expect(nginx).not.toMatch(/location\s+(?:[=^~]+\s*)?\/citizen\b/);
    expect(nginx).not.toContain('/var/www/citizen');
  });

  test('the playbook only warns about and cleans up digit-ui-v2', () => {
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    // Split into top-level task blocks (4-space "- name:" under tasks/pre_tasks).
    const tasks = playbook.split(/\n(?=    - name: )/);
    const v2Tasks = tasks.filter((t) => /digit[-_]ui[-_]v2/.test(t.split('\n')[0]));
    expect(v2Tasks).toHaveLength(2);

    const [warn, cleanup] = v2Tasks;
    // Leftover host_vars keys must never fail the deploy.
    expect(warn).toContain('ansible.builtin.debug:');
    expect(warn).not.toMatch(/ansible\.builtin\.(fail|assert):/);
    expect(warn).toContain('enable_digit_ui_v2');

    // Cleanup is unconditional on the old flag, idempotent, and removes only
    // the build output (no volumes, no data).
    expect(cleanup).toContain('ansible.builtin.file:');
    expect(cleanup).toContain('state: absent');
    expect(cleanup).toContain('- /opt/digit-ui-v2');
    expect(cleanup).toContain('- /var/www/citizen');
    expect(cleanup).not.toContain('enable_digit_ui_v2');

    // Nothing builds or serves it any more.
    expect(playbook).not.toMatch(/when:.*enable_digit_ui_v2/);
    expect(playbook).not.toContain('VITE_CITIZEN_TENANT');
  });

  test('preflight treats leftover digit-ui-v2 keys as a warning, not a failure', () => {
    const out = execFileSync(
      'python3',
      ['-c', [
        'import importlib.util, sys',
        "spec = importlib.util.spec_from_file_location('pf', 'local-setup/scripts/preflight.py')",
        'pf = importlib.util.module_from_spec(spec); spec.loader.exec_module(pf)',
        // A real leftover config: Keycloak on (D26 requires it), v2 keys still set.
        "cfg = {'enable_keycloak': True, 'enable_digit_ui_v2': True, 'nginx_features': {'digit_ui_v2': True, 'keycloak': True}}",
        'print(sorted({(s, r) for s, r, *_ in pf.run_rules(cfg)}))',
      ].join('\n')],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(out).toContain("('WARN', 'digit-ui-v2-removed')");
    expect(out).not.toContain("'FAIL'");
  });
});
