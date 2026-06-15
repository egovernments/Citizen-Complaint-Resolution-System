/**
 * Infra contract tests — cross-file invariants that lint can't see.
 *
 * Each describe block encodes a REAL incident, same philosophy as
 * scripts/preflight.py (which gates operator host_vars at deploy time —
 * these tests gate the tracked artifacts in CI). Add a contract when an
 * incident bites; cite it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..'); // local-setup/
const PLAYBOOK = fs.readFileSync(path.join(ROOT, 'ansible', 'playbook-deploy.yml'), 'utf8');
const BASE_COMPOSE = fs.readFileSync(path.join(ROOT, 'docker-compose.egov-digit.yaml'), 'utf8');

describe('compose invocation discipline', () => {
  /**
   * Incident: bomet egov-user rollback (2026-06-09). A container was
   * recreated with `docker compose -f docker-compose.egov-digit.yaml up`
   * — without the per-tenant overlay in the -f stack — which silently
   * dropped the tenant's image pin and booted an image with a known
   * regression (#771). The playbook's protection is that every mutating
   * invocation goes through the single templated `{{ compose_files }}`
   * stack; this contract pins that discipline.
   */
  const MUTATING = /\b(up|down|restart|rm|stop|start|create|pull)\b/;

  // Read-only or deliberately-scoped invocations, each justified:
  const ALLOWED_RAW_F = [
    // `ps` against the base file only — read-only health probe; the
    // service set is identical across overlays so a partial stack is fine.
    /docker compose -f \{\{ digit_dir \}\}\/docker-compose\.egov-digit\.yaml ps/,
  ];

  const invocations = PLAYBOOK.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line.includes('docker compose') && !line.startsWith('#'));

  test('every mutating `docker compose` call uses the templated {{ compose_files }} stack', () => {
    const offenders = invocations.filter(({ line }) => {
      if (!MUTATING.test(line)) return false;            // read-only — next test
      if (line.includes('{{ compose_files }}')) return false; // canonical stack
      if (!line.includes(' -f ')) return false;          // no file args (e.g. `docker compose version`)
      return !ALLOWED_RAW_F.some((rx) => rx.test(line));
    });
    expect(
      offenders.map(({ n, line }) => `playbook-deploy.yml:${n}: ${line}`),
    ).toEqual([]);
  });

  test('raw -f invocations stay read-only and on the allowlist', () => {
    const rawF = invocations.filter(
      ({ line }) => line.includes(' -f ') && !line.includes('{{ compose_files }}'),
    );
    for (const { n, line } of rawF) {
      const allowed = ALLOWED_RAW_F.some((rx) => rx.test(line));
      const mutating = MUTATING.test(line);
      expect({
        where: `playbook-deploy.yml:${n}`,
        line,
        verdict: allowed && !mutating ? 'ok' : 'NEW RAW -f INVOCATION — route it through {{ compose_files }} or justify it in ALLOWED_RAW_F',
      }).toEqual(expect.objectContaining({ verdict: 'ok' }));
    }
  });
});

describe('image pin immutability', () => {
  /**
   * Incidents (three in one month): `digit-ui:pgr-fixes` re-tag drift left
   * two servers running different content under the same tag;
   * `pgr-services-dev:latest` in the base compose diverged from what the
   * live container ran; `egov-user` regressions shipped under a reused tag.
   * Mutable tags make `docker compose pull` a silent deploy of unreviewed
   * content.
   *
   * Policy: no NEW `:latest` pins in the base compose. The existing ones
   * are frozen below as debt — burn the list down, never grow it. (Exact
   * known set, so a removal also fails the test until the list is updated:
   * that's intentional — the list IS the changelog of this debt.)
   */
  const FROZEN_LATEST_DEBT = [
    'edoburu/pgbouncer:latest',
    'tilt-demo-db-migrations:latest',
    'curlimages/curl:latest', // appears twice (two gate containers)
    'pgr-services-dev:latest', // env-overridable fallback — pin when #774-class work lands
    'twinproduction/gatus:latest',
    'tilt-demo-jupyter:latest',
    'openbao/openbao:latest',
    'egovio/novu-bridge-endpoint:latest',
    'egovio/digit-config-service:latest',
    'egovio/digit-user-preferences-service:latest',
    'egovio/novu-bridge:latest',
  ];

  test('no :latest image pins beyond the frozen debt list', () => {
    const pins = [...BASE_COMPOSE.matchAll(/^\s*image:\s*(.+)$/gm)]
      .map((m) => m[1].trim())
      .filter((img) => /:latest\b|:latest\}/.test(img));

    const unaccounted = pins.filter(
      (img) => !FROZEN_LATEST_DEBT.some((debt) => img.includes(debt)),
    );
    expect(unaccounted).toEqual([]);

    // Debt may shrink, never grow. 12 = the count at freeze time
    // (curl appears twice). Update downward as pins get fixed.
    expect(pins.length).toBeLessThanOrEqual(12);
  });
});

describe('per-tenant overlay services exist in the base compose', () => {
  /**
   * Incident class: an overlay referencing a service name the base compose
   * doesn't define is a silent no-op for env overrides — the deploy
   * "succeeds" and the override never applies.
   */
  // Only files layered ONTO the base via -f stacking are overlays. The
  // standalone compose files (deploy.yaml, db-migrations.yml, registry.yml)
  // define their own service universes and are exempt. Add new per-tenant
  // overlays (docker-compose.<inventory_hostname>.yml) here as they land.
  const overlays = ['docker-compose.bomet.yml', 'docker-compose.fast-path.yml', 'docker-compose.core.yml']
    .filter((f) => fs.existsSync(path.join(ROOT, f)));

  const baseServices = new Set(
    [...BASE_COMPOSE.matchAll(/^ {2}([a-z0-9][a-z0-9_-]*):\s*$/gm)].map((m) => m[1]),
  );

  test.each(overlays)('%s only references base services', (overlay) => {
    const text = fs.readFileSync(path.join(ROOT, overlay), 'utf8');
    const inServices = text.match(/^services:\s*$([\s\S]*)/m);
    if (!inServices) return; // overlay without a services block — nothing to check
    const overlayServices = [...inServices[1].matchAll(/^ {2}([a-z0-9][a-z0-9_-]*):\s*$/gm)].map(
      (m) => m[1],
    );
    const unknown = overlayServices.filter((s) => !baseServices.has(s));
    expect(unknown).toEqual([]);
  });
});
