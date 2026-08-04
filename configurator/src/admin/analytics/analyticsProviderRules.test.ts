/**
 * Parity + behaviour tests for the AnalyticsProvider validation rules.
 *
 * The load-bearing test here is the PARITY one: it executes the real shim
 * (digit-ui-esbuild/public/analytics.js) inside a vm and asserts that its
 * validate() and this package's validateProviderRecord() reach the SAME verdict,
 * with the same machine reason, for every fixture. The two implementations exist
 * because the shim is untranspiled ES5 served to a different app and cannot be
 * imported here — this test is what stops them drifting apart, which would let
 * the Configurator happily save a destination the SPA then silently refuses.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  validateProviderRecord,
  fieldsForType,
  requiresResidencyAck,
  hasResidencyAck,
  hostAllowed,
  parseDsn,
  REASONS,
  PROVIDER_TYPES,
  type AnalyticsProviderRecord,
} from './analyticsProviderRules';

/** The shim lives in the sibling package, outside this app's Vite root, so it
 *  cannot be imported (`?raw` is refused by Vite's fs policy) — it is read from
 *  disk instead. The app tsconfig deliberately limits ambient types to
 *  vite/client, and widening that so one test can see node builtins would also
 *  let application code reach for them; hence the single local suppression. */
let shimSource = '';

beforeAll(async () => {
  // @ts-expect-error node:fs is intentionally outside this app's ambient types
  const fs = await import('node:fs');
  // @ts-expect-error node:process is intentionally outside this app's ambient types
  const proc = await import('node:process');
  // import.meta.url is not a file: URL under the vitest module runner, so resolve
  // from the run root instead and accept either the package root or the repo root.
  const candidates = [
    `${proc.cwd()}/../digit-ui-esbuild/public/analytics.js`,
    `${proc.cwd()}/digit-ui-esbuild/public/analytics.js`,
  ];
  const found = candidates.find((c: string) => fs.existsSync(c));
  if (!found) throw new Error(`cannot locate the analytics shim; looked in: ${candidates.join(', ')}`);
  shimSource = fs.readFileSync(found, 'utf8');
});

interface ShimInternal {
  validate: (rec: unknown) => { ok: boolean; reason: string };
  hostAllowed: (host: string) => boolean;
  REASONS: Record<string, string>;
}

/** Execute the real shim against stubbed browser globals and hand back its
 *  internals. The stub localStorage carries the opt-out flag so boot() returns
 *  before touching the network; the internals are published before boot() runs,
 *  so validate() is reachable either way. Passing the globals as function
 *  parameters keeps the shim off the real jsdom window, so nothing leaks between
 *  tests. */
function loadShim(config: Record<string, unknown> = {}): ShimInternal {
  const win: Record<string, unknown> = {};
  win.window = win;
  win.console = { debug() {}, warn() {}, error() {}, log() {} };
  win.location = { pathname: '/digit-ui/employee', search: '' };
  win.localStorage = {
    getItem: (k: string) => (k === 'digit.analytics.off' ? '1' : null),
    setItem() {},
  };
  win.sessionStorage = { getItem: () => null, setItem() {} };
  win.globalConfigs = { getConfig: (k: string) => config[k] };
  win.addEventListener = () => {};
  win.setTimeout = () => 0;

  const doc = {
    readyState: 'complete',
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    createElement: () => ({}),
    addEventListener() {},
    referrer: '',
  };
  const nav = { doNotTrack: null };
  const hist = { pushState() {}, replaceState() {} };
  const Xhr = function () {
    return { open() {}, setRequestHeader() {}, send() {} };
  };

  win.history = hist;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('window', 'document', 'navigator', 'history', 'XMLHttpRequest', 'setTimeout', shimSource);
  run(win, doc, nav, hist, Xhr, () => 0);

  const api = win.DigitAnalytics as { _internal: ShimInternal } | undefined;
  if (!api?._internal) throw new Error('shim did not expose _internal');
  return api._internal;
}

const MATOMO_OK: AnalyticsProviderRecord = {
  code: 'matomo-state',
  type: 'MATOMO',
  enabled: true,
  siteId: '7',
  scriptUrl: 'https://matomo.mz.gov.mz/matomo.js',
  endpointUrl: 'https://matomo.mz.gov.mz/matomo.php',
};

/** Every fixture is run through BOTH implementations. customEnabled mirrors the
 *  ops-only globalConfigs flag the shim reads for CUSTOM records. */
const FIXTURES: Array<{ name: string; rec: AnalyticsProviderRecord; customEnabled?: boolean }> = [
  { name: 'empty record', rec: {} },
  { name: 'code only', rec: { code: 'x' } },
  { name: 'not enabled', rec: { code: 'x', type: 'MATOMO' } },
  { name: 'unknown type', rec: { code: 'x', type: 'NOPE', enabled: true } },
  { name: 'matomo without siteId', rec: { code: 'x', type: 'MATOMO', enabled: true } },
  { name: 'matomo without scriptUrl', rec: { code: 'x', type: 'MATOMO', enabled: true, siteId: '1' } },
  {
    name: 'matomo with http scriptUrl',
    rec: { code: 'x', type: 'MATOMO', enabled: true, siteId: '1', scriptUrl: 'http://matomo.mz.gov.mz/matomo.js' },
  },
  {
    name: 'matomo with disallowed host',
    rec: { code: 'x', type: 'MATOMO', enabled: true, siteId: '1', scriptUrl: 'https://evil.example.com/m.js' },
  },
  { name: 'matomo valid', rec: MATOMO_OK },
  { name: 'matomo bad sampleRate', rec: { ...MATOMO_OK, sampleRate: 2 } },
  { name: 'matomo sampleRate 0.5', rec: { ...MATOMO_OK, sampleRate: 0.5 } },
  { name: 'ga4 without measurementId', rec: { code: 'g', type: 'GA4', enabled: true } },
  { name: 'ga4 valid', rec: { code: 'g', type: 'GA4', enabled: true, measurementId: 'G-ABC123' } },
  { name: 'posthog without apiKey', rec: { code: 'p', type: 'POSTHOG', enabled: true } },
  { name: 'posthog valid (default host)', rec: { code: 'p', type: 'POSTHOG', enabled: true, apiKey: 'phc_x' } },
  {
    name: 'posthog with disallowed host',
    rec: { code: 'p', type: 'POSTHOG', enabled: true, apiKey: 'phc_x', endpointUrl: 'https://evil.example.com' },
  },
  { name: 'sentry without dsn', rec: { code: 's', type: 'SENTRY', enabled: true } },
  { name: 'sentry with malformed dsn', rec: { code: 's', type: 'SENTRY', enabled: true, dsn: 'not-a-dsn' } },
  {
    name: 'sentry valid',
    rec: { code: 's', type: 'SENTRY', enabled: true, dsn: 'https://abc123@o1.ingest.us.sentry.io/456' },
  },
  {
    name: 'custom while ops has it off',
    rec: {
      code: 'c', type: 'CUSTOM', enabled: true,
      adapter: { scriptUrl: 'https://matomo.mz.gov.mz/x.js', globalName: '_xq', callTemplates: { pageView: [['p', '{{page}}']] } },
    },
    customEnabled: false,
  },
  {
    name: 'custom valid with ops on',
    rec: {
      code: 'c', type: 'CUSTOM', enabled: true,
      adapter: { scriptUrl: 'https://matomo.mz.gov.mz/x.js', globalName: '_xq', callTemplates: { pageView: [['p', '{{page}}']] } },
    },
    customEnabled: true,
  },
  {
    name: 'custom claiming an app global',
    rec: {
      code: 'c', type: 'CUSTOM', enabled: true,
      adapter: { scriptUrl: 'https://matomo.mz.gov.mz/x.js', globalName: 'Digit', callTemplates: { pageView: [['p', '{{page}}']] } },
    },
    customEnabled: true,
  },
  {
    name: 'custom with unknown placeholder',
    rec: {
      code: 'c', type: 'CUSTOM', enabled: true,
      adapter: { scriptUrl: 'https://matomo.mz.gov.mz/x.js', globalName: '_xq', callTemplates: { pageView: [['p', '{{token}}']] } },
    },
    customEnabled: true,
  },
  {
    name: 'custom with nested placeholder smuggling',
    rec: {
      code: 'c', type: 'CUSTOM', enabled: true,
      adapter: { scriptUrl: 'https://matomo.mz.gov.mz/x.js', globalName: '_xq', callTemplates: { pageView: [['p', '{{sur{{page}}face}}']] } },
    },
    customEnabled: true,
  },
  {
    name: 'custom with oversize template',
    rec: {
      code: 'c', type: 'CUSTOM', enabled: true,
      adapter: { scriptUrl: 'https://matomo.mz.gov.mz/x.js', globalName: '_xq', callTemplates: { pageView: [['p', 'z'.repeat(800)]] } },
    },
    customEnabled: true,
  },
];

describe('parity with the shim in digit-ui-esbuild/public/analytics.js', () => {
  it('the shim source is reachable and is the file we think it is', () => {
    expect(shimSource).toContain('common-masters.AnalyticsProvider');
    expect(shimSource).toContain('function validate(');
  });

  it.each(FIXTURES)('agrees on: $name', ({ rec, customEnabled }) => {
    const shim = loadShim({ ANALYTICS_CUSTOM_ENABLED: customEnabled === true });
    const theirs = shim.validate(rec);
    const ours = validateProviderRecord(rec, { requireEnabled: true, customEnabled: customEnabled === true });
    expect({ ok: ours.ok, reason: ours.reason }).toEqual({ ok: theirs.ok, reason: theirs.reason });
  });

  it('exposes the same reason vocabulary', () => {
    const shim = loadShim();
    expect(Object.values(shim.REASONS).sort()).toEqual(Object.values(REASONS).sort());
  });

  it('agrees on the script host allowlist', () => {
    const shim = loadShim();
    for (const h of ['www.googletagmanager.com', 'js.sentry-cdn.com', 'o1.ingest.us.sentry.io', 'eu.posthog.com', 'matomo.mz.gov.mz']) {
      expect(hostAllowed(h)).toBe(true);
      expect(shim.hostAllowed(h)).toBe(true);
    }
    for (const h of ['evil.example.com', 'posthog.com.evil.net', 'notmatomo.com', '']) {
      expect(hostAllowed(h)).toBe(false);
      expect(shim.hostAllowed(h)).toBe(false);
    }
  });
});

describe('editor-specific rules', () => {
  it('lets an incomplete DRAFT save while it is switched off', () => {
    const draft: AnalyticsProviderRecord = { code: 'draft', type: 'MATOMO', enabled: false };
    expect(validateProviderRecord(draft, { requireEnabled: true }).ok).toBe(false);
    expect(validateProviderRecord(draft, { requireEnabled: false }).reason).toBe(REASONS.MISSING_SITE_ID);
  });

  it('still refuses to ENABLE an incomplete destination', () => {
    const rec: AnalyticsProviderRecord = { code: 'x', type: 'GA4', enabled: true };
    expect(validateProviderRecord(rec, { requireEnabled: false }).reason).toBe(REASONS.MISSING_MEASUREMENT_ID);
  });

  it('requires a residency acknowledgement for every cloud destination, but not for self-hosted Matomo', () => {
    for (const type of ['GA4', 'POSTHOG', 'SENTRY', 'CUSTOM']) {
      expect(requiresResidencyAck({ code: 'x', type, enabled: true })).toBe(true);
    }
    expect(requiresResidencyAck({ code: 'x', type: 'MATOMO', enabled: true })).toBe(false);
  });

  it('does not require the acknowledgement while the destination is off', () => {
    expect(requiresResidencyAck({ code: 'x', type: 'POSTHOG', enabled: false })).toBe(false);
  });

  it('reads the acknowledgement out of the settings bucket', () => {
    expect(hasResidencyAck({ settings: { residencyAck: true } })).toBe(true);
    expect(hasResidencyAck({ settings: { residencyAck: 'yes' } })).toBe(false);
    expect(hasResidencyAck({})).toBe(false);
  });

  it('shows only the fields that matter for the chosen type', () => {
    expect(fieldsForType('MATOMO')).toContain('siteId');
    expect(fieldsForType('MATOMO')).not.toContain('dsn');
    expect(fieldsForType('SENTRY')).toContain('dsn');
    expect(fieldsForType('SENTRY')).not.toContain('siteId');
    expect(fieldsForType('CUSTOM')).toContain('adapter');
    for (const t of PROVIDER_TYPES) {
      expect(fieldsForType(t)).toContain('code');
      expect(fieldsForType(t)).toContain('enabled');
    }
  });

  it('parses a Sentry DSN and rejects a malformed one', () => {
    expect(parseDsn('https://abc123@o1.ingest.us.sentry.io/456')?.project).toBe('456');
    expect(parseDsn('https://o1.ingest.us.sentry.io/456')).toBeNull();
    expect(parseDsn('')).toBeNull();
  });
});
