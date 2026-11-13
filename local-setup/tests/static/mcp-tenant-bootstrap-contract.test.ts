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
    // Each call is classified first: only a 200 whose body says success=true
    // counts — a 403/500/timeout or a skipped call (MCP unreachable) must not
    // read as success (#2783 gap 9, review of #2788).
    const classify = task('mcp-bootstrap — classify each bootstrap call (ran; answered 200 with success=true)');
    for (const side of ['root', 'city']) {
      expect(classify).toContain(`_mcp_${side}_bootstrap_ok:`);
      expect(classify).toContain(`(mcp_${side}_bootstrap.status | default(0) | int) == 200`);
      expect(classify).toContain(`(mcp_${side}_bootstrap.json.success | default(false) | bool)`);
      expect(classify).not.toContain(`mcp_${side}_bootstrap.json.success | default(true)`);
    }
    const gate = task('mcp-bootstrap — fail unless both bootstrap calls answered 200 with success=true');
    expect(gate).toContain('not ((_mcp_root_bootstrap_ok | bool) and (_mcp_city_bootstrap_ok | bool))');
    expect(gate).toContain('not (tolerate_bootstrap_failures | default(false))');
  });
});
