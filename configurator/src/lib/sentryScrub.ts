/**
 * Masks emails and phone numbers in what Sentry sends. Server errors can quote
 * what was typed ("a user with mobile 0712 345 678 already exists"), so the
 * text of every error, breadcrumb and extra is masked before it leaves.
 */

import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import { maskPersonal } from './personalData';

function maskValues<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return maskPersonal(value) as T;
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => maskValues(item, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = maskValues(item, depth + 1);
  return out as T;
}

function withoutQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = maskPersonal(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = maskPersonal(exception.value);
  }
  if (event.extra) event.extra = maskValues(event.extra);
  if (event.request?.url) event.request.url = withoutQuery(event.request.url);
  if (event.request) delete event.request.query_string;
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubSentryBreadcrumb);
  return event;
}

export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) breadcrumb.message = maskPersonal(breadcrumb.message);
  if (breadcrumb.data) {
    const data = maskValues(breadcrumb.data);
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = withoutQuery(data[key] as string);
    }
    breadcrumb.data = data;
  }
  return breadcrumb;
}
