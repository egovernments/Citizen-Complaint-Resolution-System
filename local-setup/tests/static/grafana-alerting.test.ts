/**
 * Grafana alerting provisioning contracts (#1611).
 *
 * Why these are worth a CI guard at all: unlike Gatus -- which drops a
 * misconfigured alert provider with a warning and keeps running -- Grafana
 * treats a provisioning file it cannot validate as a FATAL startup error. A
 * typo in these files does not degrade alerting, it takes the whole dashboard
 * down, and it does so on the deployed box rather than here. There is no
 * `grafana --check-config`, so the invariants have to be asserted directly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

const ALERTING = path.resolve(__dirname, '..', '..', 'otel', 'grafana', 'provisioning', 'alerting');
const DATASOURCES = path.resolve(__dirname, '..', '..', 'otel', 'grafana', 'provisioning', 'datasources');

const load = (f: string): any => yaml.load(fs.readFileSync(path.join(ALERTING, f), 'utf8'));

const rules = load('rules.yaml');
const contactPoints = load('contactpoints.yaml');
const policies = load('policies.yaml');

/** Every datasource uid Grafana will actually know about at runtime. */
const provisionedUids = new Set<string>(
  fs.readdirSync(DATASOURCES)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => {
      const doc: any = yaml.load(fs.readFileSync(path.join(DATASOURCES, f), 'utf8'));
      return (doc?.datasources ?? []).map((d: any) => d.uid);
    })
    .filter(Boolean),
);

const allRules: any[] = (rules.groups ?? []).flatMap((g: any) => g.rules ?? []);

describe('grafana alert rule provisioning', () => {
  it('provisions at least one rule', () => {
    expect(allRules.length).toBeGreaterThan(0);
  });

  /**
   * Grafana rejects a group missing any of these and refuses to start.
   * `interval` in particular is parsed with ParseDuration, which errors on "".
   */
  it('every group declares name, folder and interval', () => {
    for (const g of rules.groups) {
      expect(`${g.name}`).toBeTruthy();
      expect(`${g.folder}`).toBeTruthy();
      expect(`${g.interval}`).toMatch(/^\d+[smh]$/);
    }
  });

  it('every rule declares uid, title, condition, for and non-empty data', () => {
    for (const r of allRules) {
      expect(r.uid).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.condition).toBeTruthy();
      expect(`${r.for}`).toMatch(/^\d+[smh]$/);
      expect(Array.isArray(r.data) && r.data.length > 0).toBe(true);
    }
  });

  /** A duplicate uid makes provisioning fail; they are the identity Grafana keys on. */
  it('rule uids are unique', () => {
    const uids = allRules.map((r) => r.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  /**
   * A rule whose `condition` names a refId that does not exist is accepted by
   * YAML and then never fires -- indistinguishable from "nothing is wrong".
   */
  it('each rule condition references one of its own refIds', () => {
    for (const r of allRules) {
      const refs = new Set(r.data.map((d: any) => d.refId));
      expect(refs.has(r.condition)).toBe(true);
    }
  });

  it('expression nodes chain to a refId that exists in the same rule', () => {
    for (const r of allRules) {
      const refs = new Set(r.data.map((d: any) => d.refId));
      for (const d of r.data) {
        if (d.model?.expression) expect(refs.has(d.model.expression)).toBe(true);
        // Grafana keys the query off model.refId, not the outer one; a mismatch
        // silently evaluates the wrong node.
        expect(d.model.refId).toBe(d.refId);
      }
    }
  });

  /**
   * The uid must match a PROVISIONED datasource. Pointing at a uid that only
   * exists on one operator's box is the classic way these files pass review and
   * then produce a permanent DatasourceError on everyone else's.
   */
  it('every datasource uid is either provisioned or the builtin expression node', () => {
    for (const r of allRules) {
      for (const d of r.data) {
        if (d.datasourceUid === '__expr__') continue;
        expect(provisionedUids.has(d.datasourceUid)).toBe(true);
      }
    }
  });

  /**
   * node-exporter ships in the docker-compose.monitoring.yml OVERLAY and the JVM
   * metrics need the OTEL pipeline, so "no data" normally means "this deployment
   * does not run that component" -- a valid configuration. Alerting on it would
   * put a permanent unfixable alert in the channel, and a channel with a
   * permanent alert gets muted, which disables every other rule here too.
   */
  it('no rule alerts on missing data', () => {
    for (const r of allRules) expect(r.noDataState).toBe('OK');
  });

  /**
   * Gatus owns up/down (#1609). A second engine alerting on the same outage
   * means two messages per incident, which teaches people to ignore both.
   *
   * The guard is on the METRIC, not on one spelling of the comparison. `up == 0`
   * is merely the most obvious phrasing: `count(up) == 0`, `absent(up{job="x"})`,
   * `min by (job) (up) < 1` and Blackbox's `probe_success == 0` are the same
   * alert wearing a different hat, and a `/\bup\s*==\s*0/` regex lets every one
   * of them through. Since no capacity or error-trend rule has any reason to
   * read an availability metric, referencing one at all is the failure -- which
   * is both stricter and simpler than trying to enumerate the comparisons.
   *
   * Label VALUES are stripped before matching, so a legitimate `{job="up-sync"}`
   * is not mistaken for the `up` metric. Word boundaries keep `group_right()`
   * and `sum by (redpanda_group)` clear: the "up" inside them is preceded by a
   * word character, so `\bup\b` does not match.
   */
  const AVAILABILITY_METRIC = /\b(up|probe_success)\b/;
  const stripLabelValues = (expr: string): string => expr.replace(/"[^"]*"|'[^']*'/g, '""');

  it('does not duplicate Gatus by alerting on service availability', () => {
    for (const r of allRules) {
      for (const d of r.data) {
        if (d.datasourceUid === '__expr__') continue;
        expect(stripLabelValues(d.model.expr ?? '')).not.toMatch(AVAILABILITY_METRIC);
      }
    }
  });

  /**
   * The error-spike threshold cannot be derived from first principles -- it
   * needs an observed baseline per tenant. Shipping it live with a guessed
   * number either cries wolf until the channel is muted, or never fires and
   * looks exactly like "no errors". It stays paused until someone tunes it.
   */
  it('the log error spike rule ships paused, with the reason documented', () => {
    const spike = allRules.find((r) => r.uid === 'digit-log-error-spike');
    expect(spike).toBeDefined();
    expect(spike.isPaused).toBe(true);
    expect(fs.readFileSync(path.join(ALERTING, 'rules.yaml'), 'utf8')).toContain('TO ENABLE:');
  });
});

describe('grafana alerting delivery', () => {
  it('routes to a contact point that is actually defined', () => {
    const names = new Set(contactPoints.contactPoints.map((c: any) => c.name));
    for (const p of policies.policies) expect(names.has(p.receiver)).toBe(true);
  });

  /**
   * The webhook is a credential -- anyone holding it can post into the channel.
   * It must arrive from the environment, never as a literal in a tracked file.
   */
  it('reads the webhook from the environment rather than committing it', () => {
    for (const c of contactPoints.contactPoints) {
      for (const r of c.receivers) {
        const url = `${r.settings?.url ?? ''}`;
        expect(url).toMatch(/^\$[A-Z_]+$/);
        expect(url).not.toMatch(/hooks\.slack\.com/);
      }
    }
  });

  /**
   * Grafana expands $VAR with os.ExpandEnv semantics: no `${VAR:-default}`, and
   * an unset variable becomes an empty string. Since bad provisioning is fatal,
   * the default has to come from compose -- and it has to be a syntactically
   * valid, permanently unresolvable URL (RFC 2606 reserves .invalid) rather
   * than an empty string, or an unconfigured deployment risks crash-looping
   * Grafana instead of simply not delivering alerts.
   */
  it('compose supplies an unreachable default so an unset webhook cannot brick Grafana', () => {
    const compose = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'docker-compose.egov-digit.yaml'),
      'utf8',
    );
    const line = compose
      .split('\n')
      .find((l) => l.includes('GRAFANA_SLACK_WEBHOOK_URL:'));
    expect(line).toBeDefined();
    expect(line).toMatch(/\$\{GRAFANA_SLACK_WEBHOOK_URL:-https:\/\/example\.invalid\//);
  });
});
