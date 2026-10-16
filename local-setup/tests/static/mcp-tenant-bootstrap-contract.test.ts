import * as fs from 'fs';
import * as path from 'path';

// tenant_bootstrap copies localization packs only from an explicit source_tenant
// (#2269 review item 1b). Dropping it from the deploy would silently ship raw keys.
const playbook = fs.readFileSync(path.resolve(__dirname, '../../ansible/playbook-deploy.yml'), 'utf8');

function task(name: string): string {
  const start = playbook.indexOf(`- name: "${name}"`);
  expect(start).toBeGreaterThan(-1);
  const next = playbook.indexOf('\n    - name:', start + 1);
  return playbook.slice(start, next === -1 ? undefined : next);
}

describe('deploy tenant_bootstrap contract', () => {
  test.each([
    ['mcp-bootstrap — root tenant via /v1/tenant/bootstrap', 'pg'],
    ['mcp-bootstrap — city tenant via /v1/tenant/bootstrap', 'pg.citest'],
  ])('%s copies localizations from %s', (name, source) => {
    expect(task(name)).toContain(`source_tenant: "${source}"`);
  });

  test('the deploy stops on a reported workflow or localization failure', () => {
    const gate = task('mcp-bootstrap — fail if any seed step reported failures');
    expect(gate).toContain('mcp_root_bootstrap.json.success');
    expect(gate).toContain('mcp_city_bootstrap.json.success');
  });
});
