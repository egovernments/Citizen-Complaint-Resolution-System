/**
 * Validation rules for common-masters.AnalyticsProvider records.
 *
 * THIS IS A DELIBERATE MIRROR of validate() in
 * digit-ui-esbuild/public/analytics.js. That file is the source of truth: it is
 * what actually decides whether a destination initialises in the SPA. It cannot
 * be imported here — it is an untranspiled ES5 IIFE served as a static asset to
 * a different app — so the rules are duplicated, and analyticsProviderRules.test.ts
 * executes the real shim in a vm and asserts the two agree on a shared fixture
 * table. If you change one, that test tells you to change the other.
 *
 * Why the rules cannot live in the JSON Schema instead: MDMS validates with
 * org.everit draft-04, which has no if/then/else and no const, so "siteId is
 * required when type is MATOMO" is inexpressible there. And schema/v1/_update
 * returns HTTP 501, so the schema can never be amended anyway.
 */

export const PROVIDER_TYPES = ['MATOMO', 'GA4', 'POSTHOG', 'SENTRY', 'CUSTOM'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** Destinations that send data outside the cluster. Enabling one requires an
 *  explicit data-residency acknowledgement at save time (see requiresResidencyAck). */
export const CLOUD_TYPES: readonly string[] = ['GA4', 'POSTHOG', 'SENTRY', 'CUSTOM'];

/** Mirrors HOST_ALLOWLIST in analytics.js. MDMS cannot widen this; only the
 *  ops-controlled ANALYTICS_SCRIPT_HOSTS globalConfigs key can, which is why the
 *  editor shows a warning rather than silently accepting an unknown host.
 *
 *  Only exact hosts and dot-boundary '*.suffix' patterns are supported. There is
 *  deliberately no prefix wildcard — 'matomo.*' would have accepted
 *  matomo.<anything-an-attacker-registers>.com. A self-hosted collector's host is
 *  environment-specific and belongs in ANALYTICS_SCRIPT_HOSTS. */
export const HOST_ALLOWLIST: readonly string[] = [
  'www.googletagmanager.com',
  'js.sentry-cdn.com',
  'browser.sentry-cdn.com',
  '*.sentry.io',
  '*.posthog.com',
];

/** Globals a CUSTOM record may never claim. Mirrors GLOBAL_DENYLIST in analytics.js. */
export const GLOBAL_DENYLIST: readonly string[] = [
  'Digit', 'eGov', 'globalConfigs', 'contextPath', 'globalPath', 'i18next',
  '__applyTheme', '__DIGIT_USER_VALIDATION', 'XLSX', 'Keycloak', 'process',
  'dataLayer', 'posthog', 'Sentry',
];

/** The complete set of placeholders a CUSTOM call template may use.
 *  Mirrors PLACEHOLDERS in analytics.js. */
export const PLACEHOLDERS: readonly string[] = [
  'surface', 'entrance', 'stateTenant', 'cityTenant', 'page', 'locale',
  'module', 'contextPath', 'referrerHost', 'now', 'eventName',
  'eventCategory', 'eventAction', 'eventLabel', 'eventValue', 'errorName',
];

export const REASONS = {
  OK: 'ok',
  MISSING_CODE: 'missing_code',
  MISSING_TYPE: 'missing_type',
  UNKNOWN_TYPE: 'unknown_type',
  DISABLED: 'disabled',
  MISSING_SITE_ID: 'missing_site_id',
  MISSING_MEASUREMENT_ID: 'missing_measurement_id',
  MISSING_API_KEY: 'missing_api_key',
  MISSING_DSN: 'missing_dsn',
  MISSING_SCRIPT_URL: 'missing_script_url',
  SCRIPT_URL_NOT_HTTPS: 'script_url_not_https',
  SCRIPT_URL_HOST_NOT_ALLOWED: 'script_url_host_not_allowed',
  BAD_GLOBAL_NAME: 'bad_global_name',
  BAD_SAMPLE_RATE: 'bad_sample_rate',
  TEMPLATE_TOO_LARGE: 'template_too_large',
  BAD_PLACEHOLDER: 'bad_placeholder',
  FORBIDDEN_KEY: 'forbidden_key',
  CUSTOM_DISABLED_BY_OPS: 'custom_disabled_by_ops',
} as const;

export type Reason = (typeof REASONS)[keyof typeof REASONS];

export interface Verdict {
  ok: boolean;
  reason: Reason;
}

/** Human-readable text for each machine reason, for the editor's inline errors. */
export const REASON_TEXT: Record<string, string> = {
  [REASONS.MISSING_CODE]: 'A code is required — it is the permanent identity of this destination.',
  [REASONS.MISSING_TYPE]: 'Pick a provider type.',
  [REASONS.UNKNOWN_TYPE]: 'Unknown provider type — the SPA has no adapter for it and will ignore this row.',
  [REASONS.DISABLED]: 'This destination is switched off, so the SPA will not load it.',
  [REASONS.MISSING_SITE_ID]: 'Matomo needs a site ID.',
  [REASONS.MISSING_MEASUREMENT_ID]: 'GA4 needs a measurement ID (G-XXXXXXX).',
  [REASONS.MISSING_API_KEY]: 'PostHog needs a project API key.',
  [REASONS.MISSING_DSN]: 'Sentry needs a valid DSN (https://<key>@<host>/<projectId>).',
  [REASONS.MISSING_SCRIPT_URL]: 'A script URL is required.',
  [REASONS.SCRIPT_URL_NOT_HTTPS]: 'The script URL must use https.',
  [REASONS.SCRIPT_URL_HOST_NOT_ALLOWED]:
    'That host is not in the allowed script hosts. Ops must add it to ANALYTICS_SCRIPT_HOSTS in globalConfigs — it cannot be widened from here.',
  [REASONS.BAD_GLOBAL_NAME]: 'The global name must match /^_[A-Za-z0-9_]{1,40}$/ and must not shadow an app global.',
  [REASONS.BAD_SAMPLE_RATE]: 'Sample rate must be a number between 0 and 1.',
  [REASONS.TEMPLATE_TOO_LARGE]: 'The custom adapter definition is too large or too deeply nested.',
  [REASONS.BAD_PLACEHOLDER]: 'A call template uses an unknown or malformed {{placeholder}}.',
  [REASONS.FORBIDDEN_KEY]: 'The custom adapter contains a forbidden key (__proto__, constructor, prototype).',
  [REASONS.CUSTOM_DISABLED_BY_OPS]:
    'Custom destinations are switched off on this environment. Ops must set ANALYTICS_CUSTOM_ENABLED in globalConfigs.',
};

export interface AnalyticsProviderRecord {
  code?: string;
  type?: string;
  enabled?: boolean;
  order?: number;
  scriptUrl?: string;
  endpointUrl?: string;
  siteId?: string;
  measurementId?: string;
  apiKey?: string;
  dsn?: string;
  globalName?: string;
  sampleRate?: number;
  disablePageViews?: boolean;
  trackClicks?: boolean;
  trackErrors?: boolean;
  surfaces?: string;
  scrubPatterns?: string;
  settings?: Record<string, unknown>;
  adapter?: Record<string, unknown>;
}

const MAX_ADAPTER_BYTES = 8192;
const MAX_TEMPLATE_HOOKS = 3;
const MAX_TEMPLATE_ARGS = 8;
const MAX_ARG_CHARS = 200;
const RE_GLOBAL_NAME = /^_[A-Za-z0-9_]{1,40}$/;
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

const ok = (): Verdict => ({ ok: true, reason: REASONS.OK });
const fail = (reason: Reason): Verdict => ({ ok: false, reason });

const isStr = (v: unknown): v is string => typeof v === 'string';
const trim = (v: unknown): string => (isStr(v) ? v.trim() : '');

/** Host of an https URL, or '' when anything is uncertain. The authority must not
 *  carry userinfo: in 'https://matomo.io@evil.com/x.js' the real host is
 *  evil.com, but a naive parse reports 'matomo.io@evil.com' and would pass a host
 *  check. Mirrors urlHost() in analytics.js. */
export function urlHost(url: unknown): string {
  if (!isStr(url)) return '';
  const m = /^https:\/\/([^/?#]+)/i.exec(url);
  if (!m) return '';
  const authority = m[1];
  if (authority.includes('@')) return '';
  const host = authority.split(':')[0];
  if (!host || host.includes('..')) return '';
  return host;
}

/** A SAME-ORIGIN path, e.g. '/matomo/matomo.js'. Safer than any absolute URL: it
 *  cannot reach a third party, it inherits the page scheme (so it works on the
 *  http-only environments), and no host allowlist applies because the host is the
 *  portal's own. Mirrors isSameOriginPath() in analytics.js — anything that only
 *  LOOKS same-origin ('//evil.com', '/\\evil.com', '://', control characters) is
 *  refused. */
const RE_SAME_ORIGIN_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const RE_SAME_ORIGIN_QUERY = /^[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/;

/** The SPA entrance prefix. The Configurator cannot read the portal's
 *  globalConfigs, so it assumes the default; the shim uses getConfig("CONTEXT_PATH")
 *  and the parity test pins both to the same value. */
export const DEFAULT_CONTEXT_PATH = 'digit-ui';

export function isSameOriginPath(url: unknown, contextPath: string = DEFAULT_CONTEXT_PATH): boolean {
  if (!isStr(url) || url.length < 2) return false;
  if (url.charAt(0) !== '/' || url.charAt(1) === '/') return false;
  if (url.includes('\\')) return false;
  if (url.includes('://')) return false;
  if (url.includes('#')) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return false;

  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? '' : url.slice(q + 1);
  if (!RE_SAME_ORIGIN_PATH.test(path)) return false;
  if (query && !RE_SAME_ORIGIN_QUERY.test(query)) return false;

  // A path under the SPA's own entrance prefix is answered by
  // `try_files ... /index.html` with the HTML shell, and injecting that as a
  // script throws on every page load. Refuse it — mirrors analytics.js.
  const seg = path.split('/')[1] ?? '';
  if (contextPath && seg.startsWith(contextPath)) return false;

  return true;
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = String(host || '').toLowerCase();
  const p = String(pattern || '').toLowerCase();
  if (!h || !p) return false;
  if (p === h) return true;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1);
    return h.length > suffix.length && h.endsWith(suffix);
  }
  return false;
}

/** extraHosts mirrors the ops-only ANALYTICS_SCRIPT_HOSTS globalConfigs key. The
 *  editor cannot read that value (it belongs to the other app's config), so it
 *  validates against the compile-time list and says so in the error text. */
export function hostAllowed(host: string, extraHosts: readonly string[] = []): boolean {
  return [...HOST_ALLOWLIST, ...extraHosts].some((p) => hostMatches(host, p));
}

export function parseDsn(dsn: unknown): { key: string; host: string; project: string } | null {
  const m = /^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/i.exec(trim(dsn));
  return m ? { key: m[1], host: m[2], project: m[3] } : null;
}

export function posthogScriptUrl(rec: AnalyticsProviderRecord): string {
  const host = trim(rec.endpointUrl) || 'https://us.i.posthog.com';
  return host.replace(/\/+$/, '') + '/static/array.js';
}

export function sentryScriptUrl(rec: AnalyticsProviderRecord): string {
  const d = parseDsn(rec.dsn);
  return d ? `https://js.sentry-cdn.com/${d.key}.min.js` : '';
}

function validateScriptUrl(url: unknown, extraHosts: readonly string[] = []): Verdict {
  if (!isStr(url) || !url) return fail(REASONS.MISSING_SCRIPT_URL);
  if (isSameOriginPath(url)) return ok();
  if (!url.startsWith('https://')) return fail(REASONS.SCRIPT_URL_NOT_HTTPS);
  if (!hostAllowed(urlHost(url), extraHosts)) return fail(REASONS.SCRIPT_URL_HOST_NOT_ALLOWED);
  return ok();
}

function badTemplateString(s: string): boolean {
  const re = /\{\{([a-zA-Z]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (!PLACEHOLDERS.includes(m[1])) return true;
  }
  const residue = s.replace(/\{\{[a-zA-Z]+\}\}/g, '');
  return residue.includes('{') || residue.includes('}');
}

function validateCustomAdapter(rec: AnalyticsProviderRecord, extraHosts: readonly string[] = []): Verdict {
  const a = rec.adapter as Record<string, unknown> | undefined;
  if (!a || typeof a !== 'object') return fail(REASONS.MISSING_SCRIPT_URL);

  const urlCheck = validateScriptUrl((a.scriptUrl as string) || rec.scriptUrl, extraHosts);
  if (!urlCheck.ok) return urlCheck;

  const name = (a.globalName as string) || rec.globalName;
  if (!isStr(name) || !RE_GLOBAL_NAME.test(name) || GLOBAL_DENYLIST.includes(name)) {
    return fail(REASONS.BAD_GLOBAL_NAME);
  }

  let serialised: string;
  try {
    serialised = JSON.stringify(a);
  } catch {
    return fail(REASONS.TEMPLATE_TOO_LARGE);
  }
  if (!serialised || serialised.length > MAX_ADAPTER_BYTES) return fail(REASONS.TEMPLATE_TOO_LARGE);
  if (FORBIDDEN_KEYS.some((k) => serialised.includes(`"${k}"`))) return fail(REASONS.FORBIDDEN_KEY);

  const templates = a.callTemplates as Record<string, unknown> | undefined;
  if (!templates || typeof templates !== 'object') return fail(REASONS.BAD_PLACEHOLDER);

  let hookCount = 0;
  for (const hook of ['init', 'pageView', 'event']) {
    const calls = templates[hook];
    if (calls === undefined || calls === null) continue;
    if (!Array.isArray(calls)) return fail(REASONS.BAD_PLACEHOLDER);
    hookCount++;
    for (const args of calls) {
      if (!Array.isArray(args)) return fail(REASONS.BAD_PLACEHOLDER);
      if (args.length > MAX_TEMPLATE_ARGS) return fail(REASONS.TEMPLATE_TOO_LARGE);
      for (const v of args) {
        if (v === null) continue;
        const ty = typeof v;
        if (ty === 'number' || ty === 'boolean') continue;
        if (ty !== 'string') return fail(REASONS.BAD_PLACEHOLDER);
        if ((v as string).length > MAX_ARG_CHARS) return fail(REASONS.TEMPLATE_TOO_LARGE);
        if (badTemplateString(v as string)) return fail(REASONS.BAD_PLACEHOLDER);
      }
    }
  }
  if (hookCount > MAX_TEMPLATE_HOOKS) return fail(REASONS.TEMPLATE_TOO_LARGE);
  return ok();
}

export interface ValidateOptions {
  /** The shim always requires enabled === true before it will initialise a
   *  record. The editor sets this false so an admin can save an incomplete
   *  DRAFT while it is switched off — enabling it then requires it to be
   *  complete. Keep true for parity checks against the shim. */
  requireEnabled?: boolean;
  /** Mirrors the ops-only ANALYTICS_CUSTOM_ENABLED globalConfigs key. The editor
   *  cannot read the other app's config, so it validates the record's shape and
   *  warns separately that ops still has to switch CUSTOM on. */
  customEnabled?: boolean;
  /** Mirrors the ops-only ANALYTICS_SCRIPT_HOSTS key — hosts allowed ON TOP of the
   *  compile-time list. The Configurator runs in a different app and cannot read
   *  the portal's globalConfigs, so it passes nothing here and instead surfaces an
   *  unknown host as a WARNING (see hostIsUnverifiable). Parity checks against the
   *  shim must pass the same list the shim was given, or the two disagree by
   *  construction. */
  extraHosts?: readonly string[];
}

/** Mirror of validate() in digit-ui-esbuild/public/analytics.js. */
export function validateProviderRecord(
  rec: AnalyticsProviderRecord | null | undefined,
  opts: ValidateOptions = {}
): Verdict {
  const requireEnabled = opts.requireEnabled !== false;
  const customEnabled = opts.customEnabled === true;
  const extraHosts = opts.extraHosts ?? [];

  if (!rec || typeof rec !== 'object') return fail(REASONS.MISSING_CODE);
  if (!trim(rec.code)) return fail(REASONS.MISSING_CODE);
  if (!trim(rec.type)) return fail(REASONS.MISSING_TYPE);
  if (requireEnabled && rec.enabled !== true) return fail(REASONS.DISABLED);

  if (rec.sampleRate !== undefined && rec.sampleRate !== null) {
    if (typeof rec.sampleRate !== 'number' || rec.sampleRate < 0 || rec.sampleRate > 1) {
      return fail(REASONS.BAD_SAMPLE_RATE);
    }
  }

  const type = trim(rec.type).toUpperCase();
  if (type === 'MATOMO') {
    if (!trim(rec.siteId)) return fail(REASONS.MISSING_SITE_ID);
    return validateScriptUrl(rec.scriptUrl, extraHosts);
  }
  if (type === 'GA4') {
    if (!trim(rec.measurementId)) return fail(REASONS.MISSING_MEASUREMENT_ID);
    return ok();
  }
  if (type === 'POSTHOG') {
    if (!trim(rec.apiKey)) return fail(REASONS.MISSING_API_KEY);
    return validateScriptUrl(posthogScriptUrl(rec), extraHosts);
  }
  if (type === 'SENTRY') {
    if (!parseDsn(rec.dsn)) return fail(REASONS.MISSING_DSN);
    return validateScriptUrl(sentryScriptUrl(rec), extraHosts);
  }
  if (type === 'CUSTOM') {
    if (!customEnabled) return fail(REASONS.CUSTOM_DISABLED_BY_OPS);
    return validateCustomAdapter(rec, extraHosts);
  }
  return fail(REASONS.UNKNOWN_TYPE);
}

/** Which fields the editor should show for a given type. Everything else is
 *  noise for that provider and is hidden to keep the form honest. */
export function fieldsForType(type: string): string[] {
  const common = [
    'code', 'type', 'enabled', 'order', 'surfaces', 'sampleRate',
    'disablePageViews', 'trackClicks', 'trackErrors', 'scrubPatterns',
    // The open bucket. Editable because it is where residencyAck lives and where
    // options that have no field yet land — invisible would mean unrepairable.
    'settings',
  ];
  switch (String(type || '').toUpperCase()) {
    case 'MATOMO':
      return [...common, 'scriptUrl', 'endpointUrl', 'siteId'];
    case 'GA4':
      return [...common, 'measurementId'];
    case 'POSTHOG':
      return [...common, 'apiKey', 'endpointUrl'];
    case 'SENTRY':
      return [...common, 'dsn'];
    case 'CUSTOM':
      return [...common, 'adapter', 'globalName', 'scriptUrl'];
    default:
      return common;
  }
}

/** A cloud destination may not be ENABLED without an explicit data-residency
 *  acknowledgement. Stored at settings.residencyAck because the schema is
 *  `additionalProperties: false` and has no schema-update API — `settings` is the
 *  open bucket that exists precisely for additions like this. */
export function requiresResidencyAck(rec: AnalyticsProviderRecord): boolean {
  // trim() matters: validateProviderRecord trims `type`, so without it here a
  // record typed 'GA4 ' (trailing space, e.g. seeded over the API) would validate
  // as a cloud destination and skip the acknowledgement entirely.
  return rec.enabled === true && CLOUD_TYPES.includes(trim(rec.type).toUpperCase());
}

export function hasResidencyAck(rec: AnalyticsProviderRecord): boolean {
  return (rec.settings as Record<string, unknown> | undefined)?.residencyAck === true;
}

/** True when the record's script host is not in the compile-time allowlist.
 *
 *  This is NOT the same as "invalid": ops can legitimately widen the list with
 *  ANALYTICS_SCRIPT_HOSTS, and the Configurator — a separate app — cannot read
 *  that value. So the editor treats an unknown host as something to WARN about
 *  ("the portal will refuse this unless ops has declared the host") rather than
 *  as a hard save block it has no authority to impose. The shim is the enforcer. */
export function hostIsUnverifiable(rec: AnalyticsProviderRecord): string | null {
  const type = trim(rec.type).toUpperCase();
  let url = '';
  if (type === 'MATOMO') url = trim(rec.scriptUrl);
  else if (type === 'POSTHOG') url = posthogScriptUrl(rec);
  else if (type === 'SENTRY') url = sentryScriptUrl(rec);
  else if (type === 'CUSTOM') url = trim((rec.adapter?.scriptUrl as string) || rec.scriptUrl);
  if (!url || isSameOriginPath(url)) return null; // same-origin: nothing to verify
  if (!url.startsWith('https://')) return null;
  const host = urlHost(url);
  if (!host) return null; // a malformed authority is a hard failure, not a warning
  return hostAllowed(host) ? null : host;
}
