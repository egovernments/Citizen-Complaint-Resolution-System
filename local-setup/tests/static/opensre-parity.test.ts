/**
 * OpenSRE tier parity — the compose tier and the Helm chart must ship the same
 * agent.
 *
 * Same philosophy as the Gatus endpoint-catalogue parity the gatus-coverage
 * workflow enforces: a Helm chart can only read files inside itself, so the
 * sweep loop and the redaction rules are duplicated into
 * charts/monitoring/opensre/files/. Duplication drifts silently — the compose
 * tier gets a fix and Kubernetes keeps the bug, or the redaction rules stop
 * matching on one tier only, which is a data-leak difference rather than a
 * cosmetic one. local-setup/opensre/ is the original; copy it into the chart.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..', '..'); // repo root
const COMPOSE_DIR = path.join(REPO, 'local-setup', 'opensre');
const CHART_DIR = path.join(REPO, 'devops', 'deploy-as-code', 'charts', 'monitoring', 'opensre');

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), 'utf8');

/**
 * Drop whole-line comments. Both files below explain in prose exactly what they
 * must never do ("never passes --allowed-tool", "no secrets"), so a naive scan
 * of the raw text matches its own documentation.
 */
const code = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

describe('OpenSRE compose/helm parity', () => {
  test.each(['run-sweeps.sh', 'guardrails.yml'])(
    '%s is byte-identical in both tiers',
    (file) => {
      expect(read(CHART_DIR, 'files', file)).toBe(read(COMPOSE_DIR, file));
    },
  );

  /**
   * Three files name the OpenSRE version: the Dockerfile builds it, the compose
   * overlay tags the image it builds, and the chart pulls a registry image built
   * from that same Dockerfile. A bump that misses one either rebuilds nothing
   * (compose reuses the old tag) or deploys a different version on Kubernetes
   * than the one tested on compose.
   */
  test('the pinned OpenSRE version matches across Dockerfile, compose and chart', () => {
    const dockerfile = read(COMPOSE_DIR, 'Dockerfile');
    const version = dockerfile.match(/^ARG OPENSRE_VERSION=(\S+)$/m)?.[1];
    expect(version).toBeDefined();

    const composeTag = read(REPO, 'local-setup', 'docker-compose.opensre.yml')
      .match(/^\s*image:\s*ccrs-opensre:(\S+)$/m)?.[1];
    expect(composeTag).toBe(version);

    const chartValues = read(CHART_DIR, 'values.yaml');
    expect(chartValues.match(/^\s*tag:\s*(\S+)$/m)?.[1]).toBe(version);
    expect(read(CHART_DIR, 'Chart.yaml').match(/^appVersion:\s*(\S+)$/m)?.[1]).toBe(version);
  });

  /**
   * The agent is diagnose-only on both tiers. `--dangerously-bypass-approvals`
   * or a blanket `--allowed-tool` in the sweep loop would let the model run
   * OpenSRE's mutating tools, which is the one property this deployment must
   * not lose.
   */
  test('the sweep loop never authorises approval-gated tools', () => {
    const loop = code(read(COMPOSE_DIR, 'run-sweeps.sh'));
    const invocation = loop.match(/^\s*set -- --json ask.*$/m)?.[0];
    expect(invocation).toBeDefined();
    expect(loop).not.toMatch(/--dangerously-bypass-approvals/);
    expect(loop).not.toMatch(/--allowed-tool/);
  });

  test('the Kubernetes RBAC stays read-only and excludes secrets', () => {
    const rbac = code(read(CHART_DIR, 'templates', 'rbac.yaml'));
    const verbs = [...rbac.matchAll(/^\s*verbs:\s*\[(.*)\]$/gm)].map((m) => m[1]);
    expect(verbs.length).toBeGreaterThan(0);
    for (const v of verbs) {
      expect(v.replace(/["'\s]/g, '').split(',').sort()).toEqual(['get', 'list']);
    }
    expect(rbac).not.toMatch(/\bsecrets\b/);
  });
});
