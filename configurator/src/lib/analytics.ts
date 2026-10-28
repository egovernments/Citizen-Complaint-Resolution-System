/**
 * The console's product analytics: the tracking plan's events, sent to PostHog
 * and to the deployment's Matomo.
 *
 * docs/analytics/tracking-plan.md is the plan: every event, its properties and
 * what each tool receives. A new event is added there first, then to EVENTS.
 *
 * Nothing that identifies a person is sent. Properties carry choices, kinds of
 * record and counts; a property whose key or value looks personal (a name, an
 * email, a phone number, free text) is dropped here, whatever the call site
 * passed, and URLs go out without their query string or record ids.
 */

import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';
import { isPosthogOn, isTelemetryKilled } from './telemetryGate';
import { looksPersonal } from './personalData';
import { getConfiguredRootTenant, ENDPOINTS } from '@/api/config';
import { validateProviderRecord, type AnalyticsProviderRecord } from '@/admin/analytics/analyticsProviderRules';

/**
 * Every event in the plan, with the property Matomo reports as the event's
 * Name (null for none). Matomo's Category and Action are the two halves of the
 * event name, and its Value is `count`.
 */
const EVENTS = {
  'app:session_restore': null,
  'app:sign_out': null,
  'app:locale_change': 'to',
  'app:theme_change': 'to',
  'app:help_open': null,
  'app:docs_open': 'link',

  'signup:step_view': 'step',
  'signup:method_select': 'method',
  'signup:link_send': null,
  'signup:step_complete': 'step',
  'signup:account_submit': 'country',
  'signup:provision_complete': null,
  'signup:provision_fail': 'error_code',
  'signup:details_change': 'error_code',

  'onboarding:home_view': null,
  'onboarding:tour_open': null,
  'onboarding:tour_page_view': 'page',
  'onboarding:tour_close': 'page',
  'onboarding:video_play': 'video',
  'onboarding:step_view': 'step',
  'onboarding:method_select': 'method',
  'onboarding:method_cancel': 'method',
  'onboarding:geography_area_search': 'method',
  'onboarding:geography_levels_select': 'method',
  'onboarding:template_download': 'entity',
  'onboarding:upload_refuse': 'error_code',
  'onboarding:record_save': 'entity',
  'onboarding:import_complete': 'entity',
  'onboarding:invite_send': 'outcome',
  'onboarding:step_complete': 'step',
  'onboarding:step_fail': 'error_code',
  'onboarding:flow_complete': null,
} as const satisfies Record<string, string | null>;

export type AnalyticsEvent = keyof typeof EVENTS;
export type AnalyticsProps = Record<string, string | number | boolean | undefined>;

export const ANALYTICS_EVENTS = Object.keys(EVENTS) as AnalyticsEvent[];

// ============================================
// What may leave the browser
// ============================================

/** Keys that name a person or their contact details, matched anywhere in the key. */
const PERSONAL_KEY = /name|email|mobile|phone|address|uuid|password|token/i;
/** Longer than any code or choice the plan sends, so most likely typed text. */
const MAX_VALUE_CHARS = 80;

/** The properties with anything that could be personal removed. */
export function safeProps(props: AnalyticsProps = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    // A yes/no can't carry anything personal, so `has_email: true` is kept.
    if (PERSONAL_KEY.test(key) && typeof value !== 'boolean') continue;
    if (typeof value === 'string' && (value.length > MAX_VALUE_CHARS || looksPersonal(value))) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * A path or URL without its query, fragment or record ids, e.g.
 * `/configurator/manage/employees/EMP-KE-0042/show?x=1` becomes
 * `/configurator/manage/employees/:id/show`. Route names are words; a segment
 * with a digit, an @ or an escape in it is a record's id or code.
 */
export function scrubPath(url: string): string {
  let path = url;
  try {
    path = new URL(url, window.location.origin).pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  return path
    .split('/')
    .map((segment) => (/[\d@%]/.test(segment) ? ':id' : segment))
    .join('/');
}

/** A URL as PostHog may keep it: this origin with a scrubbed path, or only another site's origin. A bare path stays a path. */
function scrubUrl(url: string): string {
  if (url.startsWith('/') && !url.startsWith('//')) return scrubPath(url);
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return parsed.origin;
    return parsed.origin + scrubPath(parsed.pathname);
  } catch {
    return scrubPath(url);
  }
}

const URL_KEY = /url|pathname|referrer/i;

/** PostHog's before_send: the URLs and referrers it collects itself go through the same scrub. */
export function scrubCapture<T extends { properties?: Record<string, unknown>; $set?: Record<string, unknown>; $set_once?: Record<string, unknown> } | null>(
  capture: T,
): T {
  if (!capture) return capture;
  for (const bag of [capture.properties, capture.$set, capture.$set_once]) {
    if (!bag) continue;
    for (const [key, value] of Object.entries(bag)) {
      if (typeof value === 'string' && value && URL_KEY.test(key) && value !== '$direct') bag[key] = scrubUrl(value);
    }
  }
  return capture;
}

/** The stable code of an error, never its message, which can quote what was typed. */
export function errorCode(error: unknown): string {
  const raw = error as { code?: unknown; status?: unknown; statusCode?: unknown; errors?: { code?: unknown }[]; name?: unknown } | null;
  const code = raw?.errors?.[0]?.code ?? raw?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(code) && !looksPersonal(code)) return code.toUpperCase();
  const status = raw?.statusCode ?? raw?.status;
  if (typeof status === 'number' && status > 0) return `HTTP_${status}`;
  if (typeof error === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(error)) return error;
  return typeof raw?.name === 'string' && /^[A-Za-z]{1,40}$/.test(raw.name) ? raw.name : 'UNKNOWN';
}

// ============================================
// Context sent with every event
// ============================================

/** The workspace (or city) the admin is working in, sent with every PostHog event as `tenant_id`. */
export function setAnalyticsTenant(tenant: string): void {
  if (!isPosthogOn()) return;
  if (tenant) posthog.register({ app: 'console', tenant_id: tenant });
  else posthog.register({ app: 'console' });
}

// ============================================
// Matomo, from the deployment's AnalyticsProvider rows
// ============================================

declare global {
  interface Window {
    _paq?: unknown[][];
  }
}

const MATOMO_SURFACE = 'console';
const MATOMO_TIMEOUT_MS = 6000;
/** Events sent before the rows are read wait here; beyond this they are dropped. */
const MATOMO_BUFFER = 50;

type MatomoState = 'pending' | 'on' | 'off';
let matomoState: MatomoState = 'pending';
let matomoStarted = false;
let pageViewsOff = false;
const matomoBuffer: unknown[][] = [];

function doNotTrack(): boolean {
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  return [nav.doNotTrack, win.doNotTrack, nav.msDoNotTrack].some((v) => v === '1' || v === 'yes');
}

function toMatomo(command: unknown[]): void {
  if (matomoState === 'off') return;
  if (matomoState === 'on') {
    (window._paq = window._paq || []).push(command);
    return;
  }
  if (matomoBuffer.length < MATOMO_BUFFER) matomoBuffer.push(command);
}

/** The enabled Matomo row that lists the console among its surfaces. */
export function consoleMatomoRow(rows: unknown, rootTenant: string): AnalyticsProviderRecord | null {
  if (!Array.isArray(rows)) return null;
  for (const row of rows as { tenantId?: string; isActive?: boolean; data?: AnalyticsProviderRecord }[]) {
    if (!row || row.tenantId !== rootTenant || row.isActive === false || !row.data) continue;
    const rec = row.data;
    if (String(rec.type || '').toUpperCase() !== 'MATOMO') continue;
    const surfaces = String(rec.surfaces || '').split(',').map((s) => s.trim().toLowerCase());
    if (!surfaces.includes(MATOMO_SURFACE)) continue;
    if (!validateProviderRecord(rec).ok) continue;
    return rec;
  }
  return null;
}

function matomoEndpoint(rec: AnalyticsProviderRecord): string {
  if (rec.endpointUrl) return rec.endpointUrl;
  return String(rec.scriptUrl || '').replace(/matomo\.js(\?.*)?$/, 'matomo.php');
}

function startMatomoWith(rec: AnalyticsProviderRecord | null): void {
  if (!rec || doNotTrack() || (typeof rec.sampleRate === 'number' && Math.random() >= rec.sampleRate)) {
    matomoState = 'off';
    matomoBuffer.length = 0;
    return;
  }
  pageViewsOff = rec.disablePageViews === true;
  const paq = (window._paq = window._paq || []);
  paq.push(['setTrackerUrl', matomoEndpoint(rec)]);
  paq.push(['setSiteId', String(rec.siteId)]);
  paq.push(['disableCookies']);
  paq.push(['enableLinkTracking', false]);
  matomoState = 'on';
  for (const command of matomoBuffer.splice(0)) {
    if (pageViewsOff && command.includes('trackPageView')) continue;
    paq.push(command);
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = String(rec.scriptUrl);
  document.head.appendChild(script);
}

/**
 * Reads the deployment's AnalyticsProvider rows and starts Matomo when one is
 * meant for the console. Anonymous, like the portal's own read, because sign-up
 * is tracked before anyone has signed in. Rows live at the deployment's root
 * tenant; a row is the console's when its Surfaces list `console`, so a Matomo
 * site set up for citizens doesn't start counting admins.
 */
export async function startMatomo(): Promise<void> {
  if (matomoStarted || isTelemetryKilled()) return;
  matomoStarted = true;
  const root = getConfiguredRootTenant();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), MATOMO_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINTS.MDMS_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        MdmsCriteria: { tenantId: root, schemaCode: 'common-masters.AnalyticsProvider', isActive: true, limit: 100, offset: 0 },
      }),
      signal: controller.signal,
    });
    const body = res.ok ? await res.json() : null;
    startMatomoWith(consoleMatomoRow(body?.mdms, root));
  } catch {
    startMatomoWith(null);
  } finally {
    window.clearTimeout(timer);
  }
}

// ============================================
// Sending
// ============================================

/** One tracking-plan event, to PostHog and Matomo. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (isTelemetryKilled()) return;
  const clean = safeProps(props);
  if (isPosthogOn()) posthog.capture(event, clean);
  Sentry.addBreadcrumb({ category: 'user-action', message: event, data: clean, level: 'info' });

  const [category, action] = event.split(':');
  const labelKey = EVENTS[event];
  const label = labelKey && clean[labelKey] !== undefined ? String(clean[labelKey]) : '';
  const value = typeof clean.count === 'number' ? clean.count : undefined;
  toMatomo(value === undefined ? ['trackEvent', category, action, label] : ['trackEvent', category, action, label, value]);
}

/** A page view, with the path scrubbed of ids and queries. */
export function trackPageView(pathname: string): void {
  if (isTelemetryKilled()) return;
  const path = scrubPath(pathname);
  if (isPosthogOn()) posthog.capture('$pageview', { $current_url: window.location.origin + path, path });
  if (pageViewsOff) return;
  toMatomo(['setCustomUrl', window.location.origin + path]);
  toMatomo(['setDocumentTitle', path]);
  toMatomo(['trackPageView']);
}

/** Test seam: forget what this module has started. */
export function resetAnalyticsForTests(): void {
  matomoState = 'pending';
  matomoStarted = false;
  pageViewsOff = false;
  matomoBuffer.length = 0;
  delete window._paq;
}
