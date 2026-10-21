import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import posthog from 'posthog-js';
import {
  ANALYTICS_EVENTS,
  consoleMatomoRow,
  errorCode,
  resetAnalyticsForTests,
  safeProps,
  scrubCapture,
  scrubPath,
  startMatomo,
  track,
  trackPageView,
} from './analytics';

const MATOMO = {
  code: 'MATOMO_CONSOLE',
  type: 'MATOMO',
  enabled: true,
  siteId: '3',
  scriptUrl: '/matomo/matomo.js',
  surfaces: 'console',
};

const row = (data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ tenantId: 'pg', isActive: true, data, ...extra });

function mdmsAnswers(rows: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ mdms: rows }), { status: 200 }));
}

const paq = () => (window._paq ?? []) as unknown[][];

beforeEach(() => {
  resetAnalyticsForTests();
  vi.mocked(posthog.capture).mockClear();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem('digit.analytics.off');
});

describe('what may leave the browser', () => {
  it('keeps choices, codes and counts', () => {
    expect(safeProps({ country: 'KE', languages: 'en,sw', time_zone: 'Africa/Nairobi', count: 12, skipped: false })).toEqual({
      country: 'KE',
      languages: 'en,sw',
      time_zone: 'Africa/Nairobi',
      count: 12,
      skipped: false,
    });
  });

  it('drops personal keys, emails, phone numbers and long text, whatever the call site passed', () => {
    expect(
      safeProps({
        name: 'Amina Otieno',
        emailId: 'a@b.ke',
        mobileNumber: 712345678,
        activationEmail: 'password_setup',
        place: 'reach me on 0712 345678',
        contact: 'amina@example.com',
        note: 'x'.repeat(81),
        has_email: true,
        step: 'employees',
      }),
    ).toEqual({ has_email: true, step: 'employees' });
  });

  it('takes ids, queries and fragments out of paths', () => {
    expect(scrubPath('/configurator/manage/employees/EMP-KE-0042/show?x=1#y')).toBe('/configurator/manage/employees/:id/show');
    expect(scrubPath('/configurator/manage/users/a%40b.ke')).toBe('/configurator/manage/users/:id');
    expect(scrubPath('/configurator/signup?token=abc123')).toBe('/configurator/signup');
    expect(scrubPath('/configurator/onboarding/geography')).toBe('/configurator/onboarding/geography');
  });

  it('scrubs the URLs PostHog collects itself, and keeps only the origin of another site', () => {
    const origin = window.location.origin;
    const capture = scrubCapture({
      properties: {
        $current_url: `${origin}/configurator/signup?token=secret`,
        $referrer: 'https://mail.example.com/inbox/123?q=me@example.com',
        $pathname: '/configurator/manage/employees/EMP-1',
        step: 'account',
      },
      $set_once: { $initial_current_url: `${origin}/configurator/auth/callback?code=xyz` },
    });
    expect(capture.properties).toEqual({
      $current_url: `${origin}/configurator/signup`,
      $referrer: 'https://mail.example.com',
      $pathname: '/configurator/manage/employees/:id',
      step: 'account',
    });
    expect(capture.$set_once).toEqual({ $initial_current_url: `${origin}/configurator/auth/callback` });
  });

  it('reports an error by its code, never its message', () => {
    expect(errorCode({ errors: [{ code: 'duplicate_record', message: 'Mobile 0712345678 exists' }], statusCode: 400 })).toBe('DUPLICATE_RECORD');
    expect(errorCode({ errors: [{ code: 'Mobile 0712345678 exists' }], statusCode: 400 })).toBe('HTTP_400');
    expect(errorCode({ status: 503, code: null })).toBe('HTTP_503');
    expect(errorCode('SCHEMA_DEFINITION_NOT_FOUND')).toBe('SCHEMA_DEFINITION_NOT_FOUND');
    expect(errorCode('it broke for amina@example.com')).toBe('UNKNOWN');
    expect(errorCode(new TypeError('x is undefined'))).toBe('TypeError');
  });
});

describe('sending', () => {
  it('sends the event to PostHog with only the safe properties', () => {
    track('onboarding:method_select', { step: 'geography', method: 'fetch', email: 'a@b.ke' });
    expect(posthog.capture).toHaveBeenCalledWith('onboarding:method_select', { step: 'geography', method: 'fetch' });
  });

  it('sends nothing at all with telemetry switched off', async () => {
    window.localStorage.setItem('digit.analytics.off', '1');
    const fetch = mdmsAnswers([row(MATOMO)]);
    await startMatomo();
    track('app:help_open');
    trackPageView('/configurator/onboarding/home');
    expect(fetch).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(window._paq).toBeUndefined();
  });

  it('leaves PostHog alone when the deployment gave no key, and still sends to Matomo', async () => {
    const ph = posthog as unknown as { __loaded: boolean };
    ph.__loaded = false;
    try {
      mdmsAnswers([row(MATOMO)]);
      await startMatomo();
      track('app:help_open');
      trackPageView('/configurator/onboarding/home');
      expect(posthog.capture).not.toHaveBeenCalled();
      expect(paq().some((c) => c[0] === 'trackEvent')).toBe(true);
    } finally {
      ph.__loaded = true;
    }
  });

  it('maps events onto Matomo: category and action from the name, the label as Name, count as Value', async () => {
    mdmsAnswers([row(MATOMO)]);
    await startMatomo();
    track('onboarding:import_complete', { step: 'geography', entity: 'boundary', method: 'excel', count: 40, failed: 0 });
    track('onboarding:step_complete', { step: 'geography' });
    track('onboarding:flow_complete');
    expect(paq()).toEqual(
      expect.arrayContaining([
        ['trackEvent', 'onboarding', 'import_complete', 'boundary', 40],
        ['trackEvent', 'onboarding', 'step_complete', 'geography'],
        ['trackEvent', 'onboarding', 'flow_complete', ''],
      ]),
    );
  });

  it('holds events sent before the rows are read, then hands them to Matomo in order', async () => {
    mdmsAnswers([row(MATOMO)]);
    trackPageView('/configurator/signup');
    track('signup:step_view', { step: 'sign_in' });
    await startMatomo();
    const commands = paq();
    expect(commands.slice(0, 2)).toEqual([
      ['setTrackerUrl', '/matomo/matomo.php'],
      ['setSiteId', '3'],
    ]);
    const after = commands.map((c) => c[0]);
    expect(after.indexOf('trackPageView')).toBeLessThan(after.indexOf('trackEvent'));
    expect(commands).toContainEqual(['setCustomUrl', `${window.location.origin}/configurator/signup`]);
    expect(document.head.querySelector('script[src="/matomo/matomo.js"]')).not.toBeNull();
  });

  it('sends nothing to Matomo when no row is meant for the console', async () => {
    mdmsAnswers([row({ ...MATOMO, surfaces: '' }), row({ ...MATOMO, surfaces: 'citizen,employee' })]);
    track('app:help_open');
    await startMatomo();
    track('app:sign_out');
    expect(window._paq).toBeUndefined();
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('sends nothing to Matomo when the rows cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await startMatomo();
    track('app:help_open');
    expect(window._paq).toBeUndefined();
  });

  it('reads the rows anonymously, with one header, at the root tenant', async () => {
    const fetch = mdmsAnswers([]);
    await startMatomo();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/mdms-v2/v2/_search');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      MdmsCriteria: { tenantId: 'pg', schemaCode: 'common-masters.AnalyticsProvider', isActive: true, limit: 100, offset: 0 },
    });
  });
});

describe('which Matomo row is the console', () => {
  it('takes the enabled, valid Matomo row that lists the console, at the root only', () => {
    expect(consoleMatomoRow([row(MATOMO)], 'pg')).toEqual(MATOMO);
    expect(consoleMatomoRow([row({ ...MATOMO, surfaces: 'citizen, Console' })], 'pg')).not.toBeNull();
    expect(consoleMatomoRow([row(MATOMO, { tenantId: 'pg.city' })], 'pg')).toBeNull();
    expect(consoleMatomoRow([row(MATOMO, { isActive: false })], 'pg')).toBeNull();
    expect(consoleMatomoRow([row({ ...MATOMO, enabled: false })], 'pg')).toBeNull();
    expect(consoleMatomoRow([row({ ...MATOMO, siteId: '' })], 'pg')).toBeNull();
    expect(consoleMatomoRow([row({ ...MATOMO, scriptUrl: 'https://evil.example/matomo.js' })], 'pg')).toBeNull();
    expect(consoleMatomoRow([row({ ...MATOMO, type: 'POSTHOG' })], 'pg')).toBeNull();
    expect(consoleMatomoRow('nope', 'pg')).toBeNull();
  });
});

describe('the tracking plan', () => {
  it('lists every event the code can send, and nothing else', () => {
    const plan = readFileSync(path.resolve(__dirname, '../../../docs/analytics/tracking-plan.md'), 'utf8');
    const consoleSection = plan.slice(plan.indexOf('## Management console'), plan.indexOf('## Citizen and employee apps'));
    const documented = new Set([...consoleSection.matchAll(/`((?:app|signup|onboarding):[a-z_]+)`/g)].map((m) => m[1]));
    expect([...documented].sort()).toEqual([...ANALYTICS_EVENTS].sort());
  });

  it('names every event category:object_action', () => {
    for (const event of ANALYTICS_EVENTS) expect(event).toMatch(/^[a-z]+:[a-z]+(_[a-z]+)+$/);
  });
});
