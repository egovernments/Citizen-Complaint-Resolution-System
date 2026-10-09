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
 * must never do ("never passes --dangerously-bypass-approvals", "no secrets"), so a naive scan
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
   * The agent is diagnose-only on both tiers. `opensre ask` denies every tool
   * that does not declare itself read-only, and in the pinned release that is
   * almost all of them, so the loop approves a fixed list by name. Each tool
   * on it was read and only reads. Growing the list must be a reviewed change,
   * so the expected set lives here too. `--dangerously-bypass-approvals` would
   * let the model run OpenSRE's mutating tools.
   */
  const READ_ONLY_TOOLS = [
    'get_kafka_consumer_group_lag',
    'get_kafka_topic_health',
    'kubernetes_describe_pod',
    'kubernetes_get_events',
    'kubernetes_get_pod_logs',
    'kubernetes_get_resource',
    'kubernetes_list_configmaps',
    'kubernetes_list_daemonsets',
    'kubernetes_list_deployments',
    'kubernetes_list_ingresses',
    'kubernetes_list_nodes',
    'kubernetes_list_pods',
    'kubernetes_list_services',
    'kubernetes_list_statefulsets',
    'query_grafana_alert_rules',
    'query_grafana_annotations',
    'query_grafana_logs',
    'query_grafana_metrics',
    'query_grafana_service_names',
    'query_grafana_traces',
    'query_tempo',
  ];

  test('the sweep loop approves only the reviewed read-only tools', () => {
    const loop = code(read(COMPOSE_DIR, 'run-sweeps.sh'));
    expect(loop).toMatch(/^\s*set -- --json ask.*$/m);
    expect(loop).not.toMatch(/--dangerously-bypass-approvals/);

    const list = loop.match(/^READ_ONLY_TOOLS="([^"]*)"/m)?.[1];
    expect(list).toBeDefined();
    expect(list!.split(/\s+/).filter(Boolean).sort()).toEqual(READ_ONLY_TOOLS);

    // The list is the only source of approvals: one --allowed-tool, fed by it.
    const approvals = [...loop.matchAll(/--allowed-tool\s+([^\s;]+)/g)].map((m) => m[1]);
    expect(approvals).toEqual(['"$tool"']);
    expect(loop).toMatch(/for tool in \$READ_ONLY_TOOLS; do set -- "\$@" --allowed-tool "\$tool"; done/);
  });

  /**
   * The container-state page is built from `docker inspect`, whose .Config.Env
   * carries the stack's passwords and tokens. The filter may read state fields
   * only, and the Docker API may only be read.
   */
  test('the container-state page never copies env, command or args, and only reads Docker', () => {
    const loop = code(read(COMPOSE_DIR, 'run-sweeps.sh'));
    const filter = loop.match(/^CONTAINER_STATE_FILTER='([^']*)'/m)?.[1];
    expect(filter).toBeDefined();
    expect(filter).toMatch(/\.State\b/);
    for (const forbidden of [/\.Config\b/, /\.Args\b/, /\.Path\b/, /\.Mounts\b/, /\.NetworkSettings\b/, /\bEnv\b/]) {
      expect(filter).not.toMatch(forbidden);
    }

    // Join `\`-continued lines first, so a flag on the next line still counts.
    const dockerCalls = loop
      .replace(/\\\n\s*/g, ' ')
      .split('\n')
      .filter((l) => l.includes('$DOCKER_API_URL/'));
    expect(dockerCalls.length).toBeGreaterThan(0);
    for (const line of dockerCalls) {
      expect(line).not.toMatch(/(^|\s)(-X|--request)\b/);
      if (/--data/.test(line)) expect(line).toMatch(/\s-G\s/);
    }
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
